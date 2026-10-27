// reports: proyección de ventas, recaudado, aforo e ingresos para el panel del organizador; exportación CSV (RF25, RF26)
import { crearApp, crearDb, crearBus, migrar, requiere, error, iniciar, conId } from '@plataforma/common';

const db = crearDb();
const ORG = '00000000-0000-4000-8000-000000000002';

await migrar(db, `
CREATE TABLE IF NOT EXISTS eventos (
  evento_id uuid PRIMARY KEY,
  organizador_id uuid NOT NULL,
  titulo text NOT NULL,
  recaudado numeric(12,2) NOT NULL DEFAULT 0,
  ingresos int NOT NULL DEFAULT 0,
  actualizado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ventas (
  tipo_entrada_id uuid PRIMARY KEY,
  evento_id uuid NOT NULL REFERENCES eventos(evento_id),
  nombre text NOT NULL,
  precio numeric(10,2) NOT NULL,
  cupo int NOT NULL,
  vendidas int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ordenes (
  orden_id uuid PRIMARY KEY,
  evento_id uuid NOT NULL,
  entradas int NOT NULL,
  total numeric(10,2) NOT NULL,
  estado text NOT NULL,
  items jsonb NOT NULL,
  pagada_en timestamptz NOT NULL);

-- Semilla: ventas previas de los eventos de ejemplo (coinciden con inventory)
INSERT INTO eventos (evento_id, organizador_id, titulo, recaudado) VALUES
 ('10000000-0000-4000-8000-000000000001', '${ORG}', 'Noche de Jazz en La Ronda', 3974),
 ('10000000-0000-4000-8000-000000000002', '${ORG}', 'Feria Gastronómica del Valle', 1440),
 ('10000000-0000-4000-8000-000000000003', '${ORG}', 'Festival Malecón Sonoro', 11100)
ON CONFLICT DO NOTHING;
INSERT INTO ventas (tipo_entrada_id, evento_id, nombre, precio, cupo, vendidas) VALUES
 ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'General', 15, 200, 162),
 ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'VIP', 35, 50, 46),
 ('20000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000002', 'Entrada general', 5, 400, 120),
 ('20000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000002', 'Degustación completa', 12, 100, 70),
 ('20000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000003', 'General', 25, 300, 300),
 ('20000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000003', 'Preferencia', 45, 80, 80)
ON CONFLICT DO NOTHING;
`);

const app = await crearApp('reports', 'Panel del organizador y exportación');
const bus = await crearBus('reports', db, app.log);

async function eventoPropio(id, usuario) {
  const { rows: [e] } = await db.query('SELECT * FROM eventos WHERE evento_id = $1', [id]);
  if (!e || (e.organizador_id !== usuario.id && usuario.rol !== 'ADMIN')) throw error(404, 'Evento no encontrado'); // solo el dueño ve sus datos
  return e;
}

app.get('/events/:id/dashboard', { preHandler: requiere('ORGANIZADOR', 'ADMIN'), schema: conId }, async (req) => {
  const e = await eventoPropio(req.params.id, req.usuario);
  const { rows: porTipo } = await db.query('SELECT nombre, precio::float, cupo, vendidas FROM ventas WHERE evento_id = $1 ORDER BY precio', [e.evento_id]);
  const { rows: [r] } = await db.query("SELECT count(*) FILTER (WHERE estado = 'REEMBOLSADA')::int AS reembolsadas FROM ordenes WHERE evento_id = $1", [e.evento_id]);
  const vendidas = porTipo.reduce((s, t) => s + t.vendidas, 0);
  const aforo = porTipo.reduce((s, t) => s + t.cupo, 0);
  return {
    eventoId: e.evento_id,
    titulo: e.titulo,
    vendidas,
    aforo,
    ocupacion: aforo ? Math.round((vendidas / aforo) * 100) : 0,
    recaudado: Number(e.recaudado),
    ingresos: e.ingresos,
    reembolsadas: r.reembolsadas,
    porTipo,
    actualizadoEn: e.actualizado_en,
  };
});

// Exportación sin datos personales de los compradores (LOPDP): solo orden, fecha, entradas y montos
app.get('/events/:id/export.csv', { preHandler: requiere('ORGANIZADOR', 'ADMIN'), schema: conId }, async (req, reply) => {
  const e = await eventoPropio(req.params.id, req.usuario);
  const { rows } = await db.query('SELECT orden_id, pagada_en, estado, entradas, total::float FROM ordenes WHERE evento_id = $1 ORDER BY pagada_en', [e.evento_id]);
  const csv = ['orden,fecha,estado,entradas,total', ...rows.map((o) => [o.orden_id, o.pagada_en.toISOString(), o.estado, o.entradas, o.total.toFixed(2)].join(','))].join('\n');
  reply.header('content-disposition', `attachment; filename="ventas-${e.evento_id}.csv"`).type('text/csv; charset=utf-8').send(csv);
});

await bus.suscribir(['evento.publicado', 'orden.pagada', 'orden.reembolsada', 'ingreso.registrado'], async ({ tipo, datos }, c) => {
  if (tipo === 'evento.publicado') {
    await c.query('INSERT INTO eventos (evento_id, organizador_id, titulo) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [datos.eventoId, datos.organizadorId, datos.titulo]);
    for (const t of datos.tiposEntrada) {
      await c.query('INSERT INTO ventas (tipo_entrada_id, evento_id, nombre, precio, cupo) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [t.id, datos.eventoId, t.nombre, t.precio, t.cupo]);
    }
  } else if (tipo === 'orden.pagada') {
    const entradas = datos.items.reduce((s, i) => s + i.cantidad, 0);
    await c.query("INSERT INTO ordenes VALUES ($1, $2, $3, $4, 'PAGADA', $5, now()) ON CONFLICT DO NOTHING", [datos.ordenId, datos.eventoId, entradas, datos.total, JSON.stringify(datos.items)]);
    await c.query('UPDATE eventos SET recaudado = recaudado + $2 WHERE evento_id = $1', [datos.eventoId, datos.total]);
    for (const i of datos.items) await c.query('UPDATE ventas SET vendidas = vendidas + $2 WHERE tipo_entrada_id = $1', [i.tipoEntradaId, i.cantidad]);
  } else if (tipo === 'orden.reembolsada') {
    const { rows: [o] } = await c.query("UPDATE ordenes SET estado = 'REEMBOLSADA' WHERE orden_id = $1 AND estado = 'PAGADA' RETURNING items, total", [datos.ordenId]);
    if (o) await c.query('UPDATE eventos SET recaudado = recaudado - $2 WHERE evento_id = $1', [datos.eventoId, o.total]);
    for (const i of o?.items ?? []) await c.query('UPDATE ventas SET vendidas = vendidas - $2 WHERE tipo_entrada_id = $1', [i.tipoEntradaId, i.cantidad]);
  } else {
    await c.query('UPDATE eventos SET ingresos = ingresos + 1 WHERE evento_id = $1', [datos.eventoId]);
  }
  if (datos.eventoId) await c.query('UPDATE eventos SET actualizado_en = now() WHERE evento_id = $1', [datos.eventoId]);
});

await iniciar(app, bus.cerrar);
