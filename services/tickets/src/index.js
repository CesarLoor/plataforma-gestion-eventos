// tickets: emisión de tickets con QR firmado, consulta e invalidación (RF17, RF18, RF20, RN04)
import crypto from 'node:crypto';
import { crearApp, crearDb, crearBus, migrar, encolar, requiere, firmarQr, error, clavePrivada, iniciar, conId } from '@plataforma/common';

const privada = clavePrivada('TICKETS_PRIVATE_KEY'); // solo este servicio puede firmar
const db = crearDb();

await migrar(db, `
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY,
  orden_id uuid NOT NULL,
  n int NOT NULL,
  usuario_id uuid NOT NULL,
  evento_id uuid NOT NULL,
  evento jsonb NOT NULL,
  tipo text NOT NULL,
  titular text NOT NULL,
  estado text NOT NULL DEFAULT 'VALIDO' CHECK (estado IN ('VALIDO','USADO','INVALIDADO')),
  motivo text,
  qr text NOT NULL,
  emitido_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (orden_id, n));
CREATE INDEX IF NOT EXISTS tickets_usuario ON tickets (usuario_id);
CREATE INDEX IF NOT EXISTS tickets_evento ON tickets (evento_id);
`);

const app = await crearApp('tickets', 'Emisión de tickets con QR firmado e invalidación');
const bus = await crearBus('tickets', db, app.log);

const VISTA = 'id, evento_id AS "eventoId", evento, tipo, titular, estado, motivo, qr, emitido_en AS "emitidoEn"';

app.get('/me/tickets', { preHandler: requiere() }, async (req) => {
  const { rows } = await db.query(`SELECT ${VISTA} FROM tickets WHERE usuario_id = $1 ORDER BY (evento->>'fecha'), emitido_en`, [req.usuario.id]);
  return rows;
});

app.get('/tickets/:id', { preHandler: requiere(), schema: conId }, async (req) => {
  const { rows: [t] } = await db.query(`SELECT ${VISTA} FROM tickets WHERE id = $1 AND usuario_id = $2`, [req.params.id, req.usuario.id]);
  if (!t) throw error(404, 'Ticket no encontrado'); // sin IDOR
  return t;
});

app.post('/tickets/:id/transfer', { preHandler: requiere(), schema: conId }, async () => {
  throw error(501, 'La transferencia de tickets estará disponible próximamente'); // RF19, prioridad baja
});

async function invalidar(c, filtro, valor, motivo) {
  const { rows } = await c.query(`UPDATE tickets SET estado = 'INVALIDADO', motivo = $2 WHERE ${filtro} = $1 AND estado = 'VALIDO' RETURNING id, evento_id`, [valor, motivo]);
  for (const t of rows) await encolar(c, 'ticket.invalidado', { tid: t.id, eventoId: t.evento_id, motivo });
  if (rows.length) app.log.info({ accion: 'invalidar_tickets', cantidad: rows.length, motivo }, 'acción crítica'); // RN10
}

await bus.suscribir(['orden.pagada', 'orden.reembolsada', 'evento.cancelado', 'ingreso.registrado'], async ({ tipo, datos }, c) => {
  if (tipo === 'ingreso.registrado') {
    await c.query("UPDATE tickets SET estado = 'USADO' WHERE id = $1 AND estado = 'VALIDO'", [datos.tid]);
  } else if (tipo === 'orden.pagada') {
    // Un ticket por entrada; UNIQUE (orden_id, n) impide duplicados aunque el evento llegue dos veces
    let n = 0;
    for (const item of datos.items) {
      for (let i = 0; i < item.cantidad; i++) {
        n += 1;
        const tid = crypto.randomUUID();
        const qr = firmarQr({ tid, eid: datos.eventoId, tipo: item.nombre, iat: Math.floor(Date.now() / 1000) }, privada);
        const { rowCount } = await c.query(`
          INSERT INTO tickets (id, orden_id, n, usuario_id, evento_id, evento, tipo, titular, qr) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (orden_id, n) DO NOTHING`, [tid, datos.ordenId, n, datos.usuarioId, datos.eventoId, datos.evento, item.nombre, datos.nombre, qr]);
        if (rowCount) await encolar(c, 'ticket.emitido', { tid, eventoId: datos.eventoId, tipo: item.nombre, titular: datos.nombre });
      }
    }
  } else if (tipo === 'orden.reembolsada') {
    await invalidar(c, 'orden_id', datos.ordenId, 'Reembolsado');
  } else {
    await invalidar(c, 'evento_id', datos.eventoId, 'Evento cancelado');
  }
});

await iniciar(app, bus.cerrar);
