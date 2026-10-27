// inventory: cupos, reservas temporales y liberación automática, sin sobreventa (RF07-RF10, RN01-RN03, RN12)
import { crearApp, crearDb, crearBus, migrar, tx, encolar, requiere, soloServicios, error, env, iniciar, conId } from '@plataforma/common';

const RESERVA_MINUTOS = Number(env('RESERVA_MINUTOS', 10));
const db = crearDb();

await migrar(db, `
CREATE TABLE IF NOT EXISTS cupos (
  tipo_entrada_id uuid PRIMARY KEY,
  evento_id uuid NOT NULL,
  nombre text NOT NULL,
  cupo int NOT NULL,
  disponible int NOT NULL CHECK (disponible >= 0),
  venta_desde timestamptz,
  venta_hasta timestamptz,
  activo boolean NOT NULL DEFAULT true);
CREATE INDEX IF NOT EXISTS cupos_evento ON cupos (evento_id);
CREATE TABLE IF NOT EXISTS reservas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  evento_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','CONFIRMADA','EXPIRADA','CANCELADA')),
  expira_en timestamptz NOT NULL,
  orden_id uuid,
  creado_en timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS reservas_activas ON reservas (expira_en) WHERE estado = 'ACTIVA';
CREATE TABLE IF NOT EXISTS reserva_items (
  reserva_id uuid NOT NULL REFERENCES reservas(id),
  tipo_entrada_id uuid NOT NULL REFERENCES cupos(tipo_entrada_id),
  cantidad int NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (reserva_id, tipo_entrada_id));

-- Semilla: ventas previas de los eventos de ejemplo (uno casi agotado y otro agotado)
INSERT INTO cupos (tipo_entrada_id, evento_id, nombre, cupo, disponible) VALUES
 ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'General', 200, 38),
 ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'VIP', 50, 4),
 ('20000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000002', 'Entrada general', 400, 280),
 ('20000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000002', 'Degustación completa', 100, 30),
 ('20000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000003', 'General', 300, 0),
 ('20000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000003', 'Preferencia', 80, 0)
ON CONFLICT DO NOTHING;
`);

const app = await crearApp('inventory', 'Disponibilidad, reservas temporales y liberación automática');
const bus = await crearBus('inventory', db, app.log);

app.get('/availability/:id', { schema: conId }, async (req) => {
  const { rows } = await db.query('SELECT tipo_entrada_id AS "tipoEntradaId", nombre, cupo, disponible, activo FROM cupos WHERE evento_id = $1 ORDER BY nombre', [req.params.id]);
  return rows;
});

// Disponibilidad total de varios eventos para el catálogo
app.get('/availability', {
  schema: { querystring: { type: 'object', required: ['eventos'], properties: { eventos: { type: 'string', pattern: '^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,49}$' } } } },
}, async (req) => {
  const { rows } = await db.query('SELECT evento_id, sum(disponible)::int AS disponible, sum(cupo)::int AS cupo FROM cupos WHERE evento_id = ANY($1::uuid[]) AND activo GROUP BY evento_id', [req.query.eventos.split(',')]);
  return Object.fromEntries(rows.map((r) => [r.evento_id, { disponible: r.disponible, cupo: r.cupo }]));
});

app.post('/reservations', {
  preHandler: requiere('ASISTENTE'),
  schema: {
    body: {
      type: 'object',
      required: ['eventoId', 'items'],
      properties: {
        eventoId: { type: 'string', format: 'uuid' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: { type: 'object', required: ['tipoEntradaId', 'cantidad'], properties: { tipoEntradaId: { type: 'string', format: 'uuid' }, cantidad: { type: 'integer', minimum: 1, maximum: 10 } } },
        },
      },
    },
  },
}, async (req, reply) => {
  const { eventoId, items } = req.body;
  if (new Set(items.map((i) => i.tipoEntradaId)).size !== items.length) throw error(400, 'Tipo de entrada repetido');
  const reserva = await tx(db, async (c) => {
    // Primero se inserta la reserva y al final se descuenta: el bloqueo de la fila de cupos dura solo hasta el COMMIT
    const { rows: [r] } = await c.query(`INSERT INTO reservas (usuario_id, evento_id, expira_en) VALUES ($1, $2, now() + interval '${RESERVA_MINUTOS} minutes') RETURNING id, estado, expira_en AS "expiraEn"`, [req.usuario.id, eventoId]);
    for (const i of items) await c.query('INSERT INTO reserva_items VALUES ($1, $2, $3)', [r.id, i.tipoEntradaId, i.cantidad]).catch(() => {
      throw error(409, 'Tipo de entrada no disponible');
    });
    for (const i of items) {
      // RN02: se comprueba y se descuenta en la misma sentencia; con compras simultáneas solo pasa quien alcanza cupo
      const { rowCount } = await c.query(`
        UPDATE cupos SET disponible = disponible - $2
         WHERE tipo_entrada_id = $1 AND evento_id = $3 AND activo AND disponible >= $2
           AND (venta_desde IS NULL OR venta_desde <= now()) AND (venta_hasta IS NULL OR venta_hasta >= now())`, [i.tipoEntradaId, i.cantidad, eventoId]);
      if (!rowCount) {
        const { rows: [cupo] } = await c.query('SELECT nombre, disponible FROM cupos WHERE tipo_entrada_id = $1', [i.tipoEntradaId]);
        throw Object.assign(error(409, cupo ? `No hay cupos suficientes de ${cupo.nombre}: quedan ${cupo.disponible}` : 'Tipo de entrada no disponible'), { disponible: cupo?.disponible ?? 0 });
      }
    }
    return r;
  });
  reply.code(201);
  return reserva;
});

const RESERVA = `
  SELECT r.id, r.usuario_id AS "usuarioId", r.evento_id AS "eventoId", r.estado, r.expira_en AS "expiraEn", r.orden_id AS "ordenId",
         json_agg(json_build_object('tipoEntradaId', i.tipo_entrada_id, 'cantidad', i.cantidad)) AS items
    FROM reservas r JOIN reserva_items i ON i.reserva_id = r.id WHERE r.id = $1 GROUP BY r.id`;

app.get('/reservations/:id', { preHandler: requiere('ASISTENTE'), schema: conId }, async (req) => {
  const { rows: [r] } = await db.query(RESERVA, [req.params.id]);
  if (!r || r.usuarioId !== req.usuario.id) throw error(404, 'Reserva no encontrada'); // sin IDOR
  return r;
});

app.get('/internal/reservations/:id', { preHandler: soloServicios('orders'), schema: conId }, async (req) => {
  const { rows: [r] } = await db.query(RESERVA, [req.params.id]);
  if (!r) throw error(404, 'Reserva no encontrada');
  return r;
});

// Confirmación al pagar: solo si sigue ACTIVA y no venció; idempotente para la misma orden
app.post('/internal/reservations/:id/confirm', {
  preHandler: soloServicios('orders'),
  schema: { ...conId, body: { type: 'object', required: ['ordenId'], properties: { ordenId: { type: 'string', format: 'uuid' } } } },
}, async (req) => {
  const { rows: [r] } = await db.query(`
    UPDATE reservas SET estado = 'CONFIRMADA', orden_id = $2
     WHERE id = $1 AND estado = 'ACTIVA' AND expira_en > now() RETURNING estado`, [req.params.id, req.body.ordenId]);
  if (r) return r;
  const { rows: [actual] } = await db.query('SELECT estado, orden_id FROM reservas WHERE id = $1', [req.params.id]);
  if (actual?.estado === 'CONFIRMADA' && actual.orden_id === req.body.ordenId) return { estado: 'CONFIRMADA' };
  throw error(409, actual ? `La reserva está ${actual.estado}` : 'Reserva no encontrada');
});

// RN01: libera las reservas vencidas y devuelve sus cupos
async function expirarVencidas() {
  await tx(db, async (c) => {
    const { rows } = await c.query("SELECT id FROM reservas WHERE estado = 'ACTIVA' AND expira_en < now() ORDER BY expira_en LIMIT 500 FOR UPDATE SKIP LOCKED");
    if (!rows.length) return;
    const ids = rows.map((r) => r.id);
    await c.query("UPDATE reservas SET estado = 'EXPIRADA' WHERE id = ANY($1)", [ids]);
    await c.query(`
      UPDATE cupos SET disponible = disponible + s.cantidad
        FROM (SELECT tipo_entrada_id, sum(cantidad) AS cantidad FROM reserva_items WHERE reserva_id = ANY($1) GROUP BY tipo_entrada_id) s
       WHERE cupos.tipo_entrada_id = s.tipo_entrada_id`, [ids]);
    for (const id of ids) await encolar(c, 'reserva.expirada', { reservaId: id });
    app.log.info({ cantidad: ids.length }, 'reservas expiradas y cupos liberados');
  });
}
const temporizador = setInterval(() => expirarVencidas().catch((e) => app.log.error(e)), 15_000);

await bus.suscribir(['evento.publicado', 'evento.cancelado'], async ({ tipo, datos }, c) => {
  if (tipo === 'evento.publicado') {
    for (const t of datos.tiposEntrada) {
      await c.query('INSERT INTO cupos (tipo_entrada_id, evento_id, nombre, cupo, disponible, venta_desde, venta_hasta) VALUES ($1, $2, $3, $4, $4, $5, $6) ON CONFLICT DO NOTHING',
        [t.id, datos.eventoId, t.nombre, t.cupo, t.ventaDesde, t.ventaHasta]);
    }
  } else {
    await c.query('UPDATE cupos SET activo = false WHERE evento_id = $1', [datos.eventoId]);
  }
});

await iniciar(app, async () => {
  clearInterval(temporizador);
  await bus.cerrar();
});
