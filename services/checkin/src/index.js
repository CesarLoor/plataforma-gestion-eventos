// checkin: validación del QR, ingreso único, paquete sin conexión y sincronización (RF21-RF23, RN05, R10)
import { crearApp, crearDb, crearBus, migrar, tx, encolar, requiere, verificarQr, clavePublica, iniciar, conId } from '@plataforma/common';

const publica = clavePublica('TICKETS_PUBLIC_KEY');
const clavePublicaJwk = publica.export({ format: 'jwk' }); // la PWA verifica la firma con WebCrypto sin conexión
const db = crearDb();

await migrar(db, `
CREATE TABLE IF NOT EXISTS tickets (
  tid uuid PRIMARY KEY,
  evento_id uuid NOT NULL,
  tipo text NOT NULL,
  titular text NOT NULL,
  estado text NOT NULL DEFAULT 'VALIDO' CHECK (estado IN ('VALIDO','INVALIDADO')),
  motivo text);
CREATE INDEX IF NOT EXISTS tickets_evento ON tickets (evento_id);
CREATE TABLE IF NOT EXISTS ingresos (
  tid uuid PRIMARY KEY REFERENCES tickets(tid),
  evento_id uuid NOT NULL,
  ingreso_en timestamptz NOT NULL,
  usuario_id uuid NOT NULL,
  dispositivo text,
  origen text NOT NULL CHECK (origen IN ('en_linea','sincronizado')));
`);

const app = await crearApp('checkin', 'Validación de tickets, ingreso único y modo sin conexión');
const bus = await crearBus('checkin', db, app.log);
const personal = requiere('ACCESO', 'ADMIN');

// RN05: el primer INSERT gana; los siguientes devuelven la hora del primer ingreso
async function registrarIngreso(c, t, usuarioId, { ingresoEn = new Date(), dispositivo = null, origen = 'en_linea' } = {}) {
  const { rows: [nuevo] } = await c.query(`
    INSERT INTO ingresos (tid, evento_id, ingreso_en, usuario_id, dispositivo, origen) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tid) DO NOTHING RETURNING ingreso_en`, [t.tid, t.evento_id, ingresoEn, usuarioId, dispositivo, origen]);
  if (nuevo) {
    await encolar(c, 'ingreso.registrado', { tid: t.tid, eventoId: t.evento_id, ingresoEn: nuevo.ingreso_en, origen });
    return { resultado: 'VALIDO', tipo: t.tipo, titular: t.titular, ingresoEn: nuevo.ingreso_en };
  }
  const { rows: [primero] } = await c.query('SELECT ingreso_en, dispositivo FROM ingresos WHERE tid = $1', [t.tid]);
  return { resultado: 'USADO', tipo: t.tipo, titular: t.titular, primerIngreso: primero.ingreso_en, dispositivo: primero.dispositivo };
}

app.post('/validate', {
  preHandler: personal,
  schema: { body: { type: 'object', required: ['qr', 'eventoId'], properties: { qr: { type: 'string', maxLength: 2000 }, eventoId: { type: 'string', format: 'uuid' }, dispositivo: { type: 'string', maxLength: 60 } } } },
}, async (req) => {
  const datos = verificarQr(req.body.qr, publica);
  if (!datos) return { resultado: 'INVALIDO', motivo: 'La firma no es válida: posible copia o falsificación' };
  if (datos.eid !== req.body.eventoId) return { resultado: 'INVALIDO', motivo: 'El ticket es de otro evento' };
  return tx(db, async (c) => {
    const { rows: [t] } = await c.query('SELECT * FROM tickets WHERE tid = $1', [datos.tid]);
    if (!t) return { resultado: 'INVALIDO', motivo: 'Ticket desconocido para este evento' };
    if (t.estado === 'INVALIDADO') return { resultado: 'INVALIDO', motivo: `Ticket anulado: ${t.motivo}` };
    return registrarIngreso(c, t, req.usuario.id, { dispositivo: req.body.dispositivo });
  });
});

app.get('/events/:id/offline-package', { preHandler: personal, schema: conId }, async (req) => {
  const { rows } = await db.query(`
    SELECT t.tid, t.tipo, t.titular, t.estado, i.ingreso_en AS "ingresoEn"
      FROM tickets t LEFT JOIN ingresos i ON i.tid = t.tid WHERE t.evento_id = $1`, [req.params.id]);
  return { eventoId: req.params.id, clavePublica: clavePublicaJwk, tickets: rows, generadoEn: new Date() };
});

app.post('/sync', {
  preHandler: personal,
  schema: {
    body: {
      type: 'object',
      required: ['dispositivo', 'registros'],
      properties: {
        dispositivo: { type: 'string', maxLength: 60 },
        registros: { type: 'array', maxItems: 500, items: { type: 'object', required: ['tid', 'escaneadoEn'], properties: { tid: { type: 'string', format: 'uuid' }, escaneadoEn: { type: 'string', format: 'date-time' } } } },
      },
    },
  },
}, async (req) => {
  const resultados = [];
  for (const r of req.body.registros) {
    resultados.push(await tx(db, async (c) => {
      const { rows: [t] } = await c.query('SELECT * FROM tickets WHERE tid = $1', [r.tid]);
      if (!t || t.estado === 'INVALIDADO') return { tid: r.tid, resultado: 'INVALIDO' };
      const res = await registrarIngreso(c, t, req.usuario.id, { ingresoEn: r.escaneadoEn, dispositivo: req.body.dispositivo, origen: 'sincronizado' });
      return { tid: r.tid, ...res, resultado: res.resultado === 'VALIDO' ? 'ACEPTADO' : 'DUPLICADO' };
    }));
  }
  const duplicados = resultados.filter((r) => r.resultado === 'DUPLICADO').length;
  if (duplicados) app.log.warn({ accion: 'sync_duplicados', duplicados, dispositivo: req.body.dispositivo }, 'ingresos duplicados entre lectores sin conexión'); // R10
  return { resultados, duplicados };
});

app.get('/events/:id/summary', { preHandler: requiere('ACCESO', 'ORGANIZADOR', 'ADMIN'), schema: conId }, async (req) => {
  const { rows: [r] } = await db.query(`
    SELECT count(*) FILTER (WHERE t.estado = 'VALIDO')::int AS emitidos, count(i.tid)::int AS ingresos
      FROM tickets t LEFT JOIN ingresos i ON i.tid = t.tid WHERE t.evento_id = $1`, [req.params.id]);
  return r;
});

await bus.suscribir(['ticket.emitido', 'ticket.invalidado'], async ({ tipo, datos }, c) => {
  if (tipo === 'ticket.emitido') {
    await c.query('INSERT INTO tickets (tid, evento_id, tipo, titular) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [datos.tid, datos.eventoId, datos.tipo, datos.titular]);
  } else {
    await c.query("UPDATE tickets SET estado = 'INVALIDADO', motivo = $2 WHERE tid = $1", [datos.tid, datos.motivo]);
  }
});

await iniciar(app, bus.cerrar);
