// orders: órdenes, pago con la pasarela (simulada), webhook idempotente y reembolsos (RF12, RF14, RF15, RNF14, RN06, RN09, RN11)
import { crearApp, crearDb, crearBus, migrar, tx, encolar, requiere, llamar, hmacValido, error, env, iniciar, conId } from '@plataforma/common';

const INVENTORY = env('INVENTORY_URL', 'http://inventory:3000');
const CATALOG = env('CATALOG_URL', 'http://catalog:3000');
const PASARELA = env('PAYMENT_URL', 'http://payment-sim:3000');
const PUBLIC_URL = env('PUBLIC_URL');
const SECRETO_WEBHOOK = env('PAYMENT_WEBHOOK_SECRET');
const API_KEY = env('PAYMENT_API_KEY');
const db = crearDb();

await migrar(db, `
CREATE TABLE IF NOT EXISTS ordenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  evento_id uuid NOT NULL,
  reserva_id uuid NOT NULL UNIQUE,
  estado text NOT NULL DEFAULT 'PENDIENTE_PAGO' CHECK (estado IN ('PENDIENTE_PAGO','PAGADA','PAGO_FALLIDO','EXPIRADA','REEMBOLSADA')),
  evento jsonb NOT NULL,
  items jsonb NOT NULL,
  subtotal numeric(10,2) NOT NULL,
  descuento numeric(10,2) NOT NULL,
  total numeric(10,2) NOT NULL,
  codigo text,
  nombre text NOT NULL,
  correo text NOT NULL,
  expira_en timestamptz NOT NULL,
  checkout_url text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ordenes_usuario ON ordenes (usuario_id);
-- RN06: el id del pago es la clave de idempotencia del webhook
CREATE TABLE IF NOT EXISTS pagos (
  id text PRIMARY KEY,
  orden_id uuid NOT NULL REFERENCES ordenes(id),
  estado text NOT NULL,
  monto numeric(10,2) NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reembolsos (
  orden_id uuid PRIMARY KEY REFERENCES ordenes(id),
  monto numeric(10,2) NOT NULL,
  motivo text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now());
`);

const app = await crearApp('orders', 'Órdenes, pagos con pasarela simulada y reembolsos');
const bus = await crearBus('orders', db, app.log);

// El webhook se valida sobre el cuerpo exacto recibido, así que se conserva el texto original
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, cuerpo, listo) => {
  req.cuerpoCrudo = cuerpo;
  try {
    listo(null, cuerpo ? JSON.parse(cuerpo) : {});
  } catch {
    listo(Object.assign(new Error('JSON no válido'), { statusCode: 400 }));
  }
});

const VISTA = `id, estado, evento, items, subtotal::float, descuento::float, total::float, codigo, nombre, expira_en AS "expiraEn", checkout_url AS "checkoutUrl", creado_en AS "creadoEn"`;

async function pasarela(ruta, body) {
  const r = await fetch(`${PASARELA}${ruta}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-api-key': API_KEY, ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`pasarela respondió ${r.status}`);
  return r.json();
}

async function abrirCobro(c, orden) {
  const sesion = await pasarela('/sessions', { ordenId: orden.id, monto: Number(orden.total), returnUrl: `${PUBLIC_URL}/#/orden/${orden.id}`, webhookUrl: 'http://orders:3000/webhooks/payment' });
  const checkoutUrl = `${PUBLIC_URL}/pasarela/checkout/${sesion.sessionId}`;
  await c.query('UPDATE ordenes SET checkout_url = $2 WHERE id = $1', [orden.id, checkoutUrl]);
  return checkoutUrl;
}

async function reembolsar(c, orden, motivo) {
  const { rows: [pago] } = await c.query("SELECT id FROM pagos WHERE orden_id = $1 AND estado = 'APROBADO'", [orden.id]);
  if (pago) await pasarela('/refunds', { paymentId: pago.id, monto: Number(orden.total), idempotencyKey: orden.id });
  await c.query('INSERT INTO reembolsos (orden_id, monto, motivo) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [orden.id, orden.total, motivo]);
  await c.query("UPDATE ordenes SET estado = 'REEMBOLSADA', actualizado_en = now() WHERE id = $1", [orden.id]);
  await encolar(c, 'orden.reembolsada', { ordenId: orden.id, eventoId: orden.evento_id, usuarioId: orden.usuario_id, monto: Number(orden.total), motivo, correo: orden.correo, nombre: orden.nombre });
  app.log.info({ accion: 'reembolso', ordenId: orden.id, motivo }, 'acción crítica'); // RN10
}

app.post('/orders', {
  preHandler: requiere('ASISTENTE'),
  schema: {
    body: {
      type: 'object',
      required: ['reservaId', 'nombre', 'correo', 'aceptaTerminos'],
      properties: {
        reservaId: { type: 'string', format: 'uuid' },
        codigo: { type: 'string', maxLength: 20 },
        nombre: { type: 'string', minLength: 2, maxLength: 80 },
        correo: { type: 'string', format: 'email', maxLength: 120 },
        aceptaTerminos: { type: 'boolean', const: true },
      },
    },
  },
}, async (req, reply) => {
  const b = req.body;
  const { rows: [existente] } = await db.query(`SELECT ${VISTA}, usuario_id FROM ordenes WHERE reserva_id = $1`, [b.reservaId]);
  if (existente) {
    if (existente.usuario_id !== req.usuario.id) throw error(404, 'Reserva no encontrada');
    const { usuario_id: _u, ...orden } = existente;
    return orden;
  }
  const reserva = await llamar('orders', `${INVENTORY}/internal/reservations/${b.reservaId}`);
  if (!reserva.ok || reserva.datos.usuarioId !== req.usuario.id) throw error(404, 'Reserva no encontrada');
  if (reserva.datos.estado !== 'ACTIVA') throw error(409, 'La reserva ya no está activa');
  const cotizacion = await llamar('orders', `${CATALOG}/internal/quote`, { method: 'POST', body: { eventoId: reserva.datos.eventoId, items: reserva.datos.items, codigo: b.codigo } });
  if (!cotizacion.ok) throw error(cotizacion.status, cotizacion.datos?.mensaje ?? 'No se pudo cotizar la orden');
  const q = cotizacion.datos;
  const orden = await tx(db, async (c) => {
    const { rows: [o] } = await c.query(`
      INSERT INTO ordenes (usuario_id, evento_id, reserva_id, evento, items, subtotal, descuento, total, codigo, nombre, correo, expira_en)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.usuario.id, reserva.datos.eventoId, b.reservaId, q.evento, JSON.stringify(q.items), q.subtotal, q.descuento, q.total, q.codigo, b.nombre, b.correo, reserva.datos.expiraEn]);
    await abrirCobro(c, o);
    return o;
  });
  const { rows: [vista] } = await db.query(`SELECT ${VISTA} FROM ordenes WHERE id = $1`, [orden.id]);
  reply.code(201);
  return { ...vista, codigoRechazado: q.codigoRechazado };
});

app.get('/me/orders', { preHandler: requiere() }, async (req) => {
  const { rows } = await db.query(`SELECT ${VISTA} FROM ordenes WHERE usuario_id = $1 ORDER BY creado_en DESC`, [req.usuario.id]);
  return rows;
});

app.get('/orders/:id', { preHandler: requiere(), schema: conId }, async (req) => {
  const { rows: [o] } = await db.query(`SELECT ${VISTA} FROM ordenes WHERE id = $1 AND usuario_id = $2`, [req.params.id, req.usuario.id]);
  if (!o) throw error(404, 'Orden no encontrada'); // sin IDOR: otra persona recibe lo mismo que si no existiera
  return o;
});

app.post('/orders/:id/retry', { preHandler: requiere('ASISTENTE'), schema: conId }, async (req) => {
  return tx(db, async (c) => {
    const { rows: [o] } = await c.query('SELECT * FROM ordenes WHERE id = $1 AND usuario_id = $2 FOR UPDATE', [req.params.id, req.usuario.id]);
    if (!o) throw error(404, 'Orden no encontrada');
    if (o.estado !== 'PAGO_FALLIDO' || o.expira_en < new Date()) throw error(409, 'Esta orden ya no se puede reintentar');
    await c.query("UPDATE ordenes SET estado = 'PENDIENTE_PAGO', actualizado_en = now() WHERE id = $1", [o.id]);
    return { checkoutUrl: await abrirCobro(c, o) };
  });
});

// Procesa un aviso de pago (webhook o consulta). Un aviso repetido no cobra ni emite dos veces.
async function procesarPago({ paymentId, ordenId, estado, monto }) {
  return tx(db, async (c) => {
    const { rows: [o] } = await c.query('SELECT * FROM ordenes WHERE id = $1 FOR UPDATE', [ordenId]);
    if (!o) throw error(404, 'Orden no encontrada');
    const { rowCount } = await c.query('INSERT INTO pagos (id, orden_id, estado, monto) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [paymentId, ordenId, estado, monto]);
    if (!rowCount) return { duplicado: true, estado: o.estado };

    if (estado !== 'APROBADO') {
      if (o.estado === 'PENDIENTE_PAGO') {
        await c.query("UPDATE ordenes SET estado = 'PAGO_FALLIDO', actualizado_en = now() WHERE id = $1", [o.id]);
        await encolar(c, 'orden.fallida', { ordenId: o.id, usuarioId: o.usuario_id });
      }
      return { estado: 'PAGO_FALLIDO' };
    }
    if (o.estado === 'PAGADA' || o.estado === 'REEMBOLSADA') return { estado: o.estado };
    if (Number(monto) !== Number(o.total)) throw error(400, 'El monto pagado no coincide con la orden');

    const confirmacion = o.estado === 'EXPIRADA' ? { status: 409 } : await llamar('orders', `${INVENTORY}/internal/reservations/${o.reserva_id}/confirm`, { method: 'POST', body: { ordenId: o.id } });
    if (confirmacion.status === 409) {
      // CU06 4c: el cobro llegó cuando la reserva ya había vencido: se devuelve el dinero
      await reembolsar(c, o, 'La reserva venció antes de confirmar el pago');
      return { estado: 'REEMBOLSADA' };
    }
    if (!confirmacion.ok) throw new Error(`inventory respondió ${confirmacion.status}`);
    await c.query("UPDATE ordenes SET estado = 'PAGADA', actualizado_en = now() WHERE id = $1", [o.id]);
    await encolar(c, 'orden.pagada', {
      ordenId: o.id, usuarioId: o.usuario_id, eventoId: o.evento_id, evento: o.evento, items: o.items,
      total: Number(o.total), codigo: o.codigo, nombre: o.nombre, correo: o.correo,
    });
    app.log.info({ accion: 'compra', ordenId: o.id, total: Number(o.total) }, 'acción crítica'); // RN10
    return { estado: 'PAGADA' };
  });
}

app.post('/webhooks/payment', {
  schema: {
    body: {
      type: 'object',
      required: ['paymentId', 'ordenId', 'estado', 'monto'],
      properties: { paymentId: { type: 'string', maxLength: 64 }, ordenId: { type: 'string', format: 'uuid' }, estado: { type: 'string', enum: ['APROBADO', 'RECHAZADO'] }, monto: { type: 'number' } },
    },
  },
}, async (req) => {
  if (!hmacValido(SECRETO_WEBHOOK, req.cuerpoCrudo ?? '', req.headers['x-firma'])) throw error(401, 'Firma no válida');
  return procesarPago(req.body);
});

// CU06 4b: si el aviso no llega, se consulta el estado a la pasarela por id de orden
async function consultarPendientes() {
  const { rows } = await db.query("SELECT id FROM ordenes WHERE estado = 'PENDIENTE_PAGO' AND checkout_url IS NOT NULL AND actualizado_en < now() - interval '20 seconds'");
  for (const { id } of rows) {
    const p = await pasarela(`/payments?ordenId=${id}`).catch(() => null);
    if (p?.paymentId) await procesarPago({ ...p, ordenId: id }).catch((e) => app.log.warn({ err: e, ordenId: id }, 'consulta de pago'));
  }
}
const temporizador = setInterval(() => consultarPendientes().catch((e) => app.log.error(e)), 15_000);

await bus.suscribir(['reserva.expirada', 'evento.cancelado'], async ({ tipo, datos }, c) => {
  if (tipo === 'reserva.expirada') {
    await c.query("UPDATE ordenes SET estado = 'EXPIRADA', actualizado_en = now() WHERE reserva_id = $1 AND estado IN ('PENDIENTE_PAGO','PAGO_FALLIDO')", [datos.reservaId]);
    return;
  }
  // RN07: cancelar el evento reembolsa todas sus órdenes pagadas
  const { rows } = await c.query("SELECT * FROM ordenes WHERE evento_id = $1 AND estado = 'PAGADA' FOR UPDATE", [datos.eventoId]);
  for (const o of rows) await reembolsar(c, o, 'Evento cancelado por el organizador');
});

await iniciar(app, async () => {
  clearInterval(temporizador);
  await bus.cerrar();
});
