// catalog: eventos, tipos de entrada, códigos de descuento y búsqueda (RF04, RF05, RF06, RF13)
import { crearApp, crearDb, crearBus, migrar, tx, encolar, requiere, soloServicios, usuarioDe, error, iniciar, conId } from '@plataforma/common';

const db = crearDb();

const ORG = '00000000-0000-4000-8000-000000000002';
await migrar(db, `
CREATE TABLE IF NOT EXISTS eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizador_id uuid NOT NULL,
  organizador_nombre text NOT NULL,
  titulo text NOT NULL,
  descripcion text NOT NULL DEFAULT '',
  categoria text NOT NULL,
  ciudad text NOT NULL,
  lugar text NOT NULL,
  fecha timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','PUBLICADO','CANCELADO')),
  creado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tipos_entrada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES eventos(id),
  nombre text NOT NULL,
  precio numeric(10,2) NOT NULL CHECK (precio >= 0),
  cupo int NOT NULL CHECK (cupo > 0),
  venta_desde timestamptz,
  venta_hasta timestamptz);
CREATE TABLE IF NOT EXISTS descuentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES eventos(id),
  codigo text NOT NULL,
  porcentaje int CHECK (porcentaje BETWEEN 1 AND 100),
  monto numeric(10,2) CHECK (monto > 0),
  vigente_hasta timestamptz,
  limite_usos int,
  usos int NOT NULL DEFAULT 0,
  UNIQUE (evento_id, codigo));

-- Semilla (ficticia): mismos ids en inventory y reports
INSERT INTO eventos (id, organizador_id, organizador_nombre, titulo, descripcion, categoria, ciudad, lugar, fecha, estado) VALUES
 ('10000000-0000-4000-8000-000000000001', '${ORG}', 'Colectivo Jazz UIO', 'Noche de Jazz en La Ronda', 'Tres bandas locales de jazz y bossa nova en una noche al aire libre en el Centro Histórico.', 'Música', 'Quito', 'Calle La Ronda, Centro Histórico', '2026-11-21T20:00:00-05:00', 'PUBLICADO'),
 ('10000000-0000-4000-8000-000000000002', '${ORG}', 'Colectivo Jazz UIO', 'Feria Gastronómica del Valle', 'Productores y cocineros del Valle de los Chillos con degustaciones y música en vivo.', 'Gastronomía', 'Sangolquí', 'Campus ESPE', '2026-11-29T10:00:00-05:00', 'PUBLICADO'),
 ('10000000-0000-4000-8000-000000000003', '${ORG}', 'Colectivo Jazz UIO', 'Festival Malecón Sonoro', 'Festival de música urbana y tropical frente al río Guayas.', 'Música', 'Guayaquil', 'Malecón 2000', '2026-12-04T18:00:00-05:00', 'PUBLICADO')
ON CONFLICT DO NOTHING;
INSERT INTO tipos_entrada (id, evento_id, nombre, precio, cupo) VALUES
 ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'General', 15, 200),
 ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'VIP', 35, 50),
 ('20000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000002', 'Entrada general', 5, 400),
 ('20000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000002', 'Degustación completa', 12, 100),
 ('20000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000003', 'General', 25, 300),
 ('20000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000003', 'Preferencia', 45, 80)
ON CONFLICT DO NOTHING;
INSERT INTO descuentos (evento_id, codigo, porcentaje, vigente_hasta, limite_usos)
SELECT id, 'ESPE10', 10, '2026-12-31T23:59:59-05:00', 500 FROM eventos WHERE organizador_id = '${ORG}'
ON CONFLICT DO NOTHING;
`);

const app = await crearApp('catalog', 'Eventos, tipos de entrada, descuentos y búsqueda');
const bus = await crearBus('catalog', db, app.log);

const centavos = (n) => Math.round(Number(n) * 100);

async function propio(id, usuario) {
  const { rows: [e] } = await db.query('SELECT * FROM eventos WHERE id = $1', [id]);
  if (!e || (e.organizador_id !== usuario.id && usuario.rol !== 'ADMIN')) throw error(404, 'Evento no encontrado');
  return e;
}

const DETALLE = `
  SELECT e.id, e.titulo, e.descripcion, e.categoria, e.ciudad, e.lugar, e.fecha, e.estado, e.organizador_id AS "organizadorId", e.organizador_nombre AS "organizador",
         json_agg(json_build_object('id', t.id, 'nombre', t.nombre, 'precio', t.precio::float, 'cupo', t.cupo, 'ventaDesde', t.venta_desde, 'ventaHasta', t.venta_hasta) ORDER BY t.precio) AS tipos
    FROM eventos e JOIN tipos_entrada t ON t.evento_id = e.id`;

// Descuento vigente (RN08): devuelve null si no existe, venció o llegó al límite de usos
async function descuentoVigente(eventoId, codigo) {
  const { rows: [d] } = await db.query(`
    SELECT codigo, porcentaje, monto::float AS monto FROM descuentos
     WHERE evento_id = $1 AND codigo = upper($2) AND (vigente_hasta IS NULL OR vigente_hasta > now()) AND (limite_usos IS NULL OR usos < limite_usos)`, [eventoId, codigo]);
  return d ?? null;
}

app.get('/events', {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 80 },
        categoria: { type: 'string', maxLength: 40 },
        ciudad: { type: 'string', maxLength: 40 },
        desde: { type: 'string', format: 'date' },
        hasta: { type: 'string', format: 'date' },
        precioMax: { type: 'number', minimum: 0 },
      },
    },
  },
}, async (req) => {
  const { q, categoria, ciudad, desde, hasta, precioMax } = req.query;
  const { rows } = await db.query(`
    SELECT e.id, e.titulo, e.categoria, e.ciudad, e.lugar, e.fecha, min(t.precio)::float AS "precioDesde", sum(t.cupo)::int AS aforo
      FROM eventos e JOIN tipos_entrada t ON t.evento_id = e.id
     WHERE e.estado = 'PUBLICADO'
       AND ($1::text IS NULL OR e.titulo ILIKE '%' || $1 || '%' OR e.lugar ILIKE '%' || $1 || '%' OR e.ciudad ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR e.categoria = $2)
       AND ($3::text IS NULL OR e.ciudad = $3)
       AND ($4::date IS NULL OR e.fecha >= $4::date)
       AND ($5::date IS NULL OR e.fecha < $5::date + 1)
     GROUP BY e.id
    HAVING ($6::numeric IS NULL OR min(t.precio) <= $6)
     ORDER BY e.fecha`, [q || null, categoria || null, ciudad || null, desde || null, hasta || null, precioMax ?? null]);
  return rows;
});

app.get('/events/:id', { schema: conId }, async (req) => {
  const { rows: [e] } = await db.query(`${DETALLE} WHERE e.id = $1 GROUP BY e.id`, [req.params.id]);
  if (!e) throw error(404, 'Evento no encontrado');
  if (e.estado === 'BORRADOR') {
    const u = await usuarioDe(req).catch(() => null);
    if (!u || (u.id !== e.organizadorId && u.rol !== 'ADMIN')) throw error(404, 'Evento no encontrado');
  }
  return e;
});

app.get('/mine', { preHandler: requiere('ORGANIZADOR', 'ADMIN') }, async (req) => {
  const { rows } = await db.query(`${DETALLE} WHERE e.organizador_id = $1 GROUP BY e.id ORDER BY e.fecha`, [req.usuario.id]);
  return rows;
});

app.post('/events', {
  preHandler: requiere('ORGANIZADOR'),
  schema: {
    body: {
      type: 'object',
      required: ['titulo', 'categoria', 'ciudad', 'lugar', 'fecha', 'tipos'],
      properties: {
        titulo: { type: 'string', minLength: 3, maxLength: 100 },
        descripcion: { type: 'string', maxLength: 1000, default: '' },
        categoria: { type: 'string', enum: ['Música', 'Gastronomía', 'Teatro', 'Universidad', 'Deportes', 'Otro'] },
        ciudad: { type: 'string', minLength: 2, maxLength: 40 },
        lugar: { type: 'string', minLength: 2, maxLength: 120 },
        fecha: { type: 'string', format: 'date-time' },
        tipos: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            required: ['nombre', 'precio', 'cupo'],
            properties: {
              nombre: { type: 'string', minLength: 2, maxLength: 40 },
              precio: { type: 'number', minimum: 0, maximum: 10000 },
              cupo: { type: 'integer', minimum: 1, maximum: 100000 },
              ventaDesde: { type: 'string', format: 'date-time' },
              ventaHasta: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  },
}, async (req, reply) => {
  const b = req.body;
  const id = await tx(db, async (c) => {
    const { rows: [e] } = await c.query(
      'INSERT INTO eventos (organizador_id, organizador_nombre, titulo, descripcion, categoria, ciudad, lugar, fecha) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
      [req.usuario.id, req.usuario.nombre, b.titulo, b.descripcion, b.categoria, b.ciudad, b.lugar, b.fecha]);
    for (const t of b.tipos) {
      await c.query('INSERT INTO tipos_entrada (evento_id, nombre, precio, cupo, venta_desde, venta_hasta) VALUES ($1, $2, $3, $4, $5, $6)',
        [e.id, t.nombre, t.precio, t.cupo, t.ventaDesde ?? null, t.ventaHasta ?? null]);
    }
    return e.id;
  });
  reply.code(201);
  return { id, estado: 'BORRADOR' };
});

app.post('/events/:id/publish', { preHandler: requiere('ORGANIZADOR', 'ADMIN'), schema: conId }, async (req) => {
  await propio(req.params.id, req.usuario);
  return tx(db, async (c) => {
    const { rows: [e] } = await c.query("UPDATE eventos SET estado = 'PUBLICADO' WHERE id = $1 AND estado = 'BORRADOR' RETURNING *", [req.params.id]);
    if (!e) throw error(409, 'Solo se puede publicar un evento en borrador');
    const { rows: tipos } = await c.query('SELECT id, nombre, precio::float AS precio, cupo, venta_desde AS "ventaDesde", venta_hasta AS "ventaHasta" FROM tipos_entrada WHERE evento_id = $1', [e.id]);
    await encolar(c, 'evento.publicado', { eventoId: e.id, organizadorId: e.organizador_id, titulo: e.titulo, fecha: e.fecha, tiposEntrada: tipos });
    return { id: e.id, estado: e.estado };
  });
});

app.post('/events/:id/cancel', { preHandler: requiere('ORGANIZADOR', 'ADMIN'), schema: conId }, async (req) => {
  await propio(req.params.id, req.usuario);
  return tx(db, async (c) => {
    const { rows: [e] } = await c.query("UPDATE eventos SET estado = 'CANCELADO' WHERE id = $1 AND estado = 'PUBLICADO' RETURNING id, titulo, estado", [req.params.id]);
    if (!e) throw error(409, 'Solo se puede cancelar un evento publicado');
    await encolar(c, 'evento.cancelado', { eventoId: e.id, titulo: e.titulo, motivo: 'Cancelado por el organizador' });
    req.log.info({ accion: 'cancelar_evento', usuarioId: req.usuario.id, eventoId: e.id }, 'acción crítica'); // RN07, RN10
    return e;
  });
});

app.post('/events/:id/discounts', {
  preHandler: requiere('ORGANIZADOR', 'ADMIN'),
  schema: {
    ...conId,
    body: {
      type: 'object',
      required: ['codigo'],
      properties: {
        codigo: { type: 'string', pattern: '^[A-Za-z0-9]{3,20}$' },
        porcentaje: { type: 'integer', minimum: 1, maximum: 100 },
        monto: { type: 'number', exclusiveMinimum: 0 },
        vigenteHasta: { type: 'string', format: 'date-time' },
        limiteUsos: { type: 'integer', minimum: 1 },
      },
    },
  },
}, async (req, reply) => {
  await propio(req.params.id, req.usuario);
  const b = req.body;
  if (Boolean(b.porcentaje) === Boolean(b.monto)) throw error(400, 'Indica un porcentaje o un monto, no ambos');
  const { rows: [d] } = await db.query(`
    INSERT INTO descuentos (evento_id, codigo, porcentaje, monto, vigente_hasta, limite_usos) VALUES ($1, upper($2), $3, $4, $5, $6)
    ON CONFLICT DO NOTHING RETURNING codigo`, [req.params.id, b.codigo, b.porcentaje ?? null, b.monto ?? null, b.vigenteHasta ?? null, b.limiteUsos ?? null]);
  if (!d) throw error(409, 'Ese código ya existe en el evento');
  reply.code(201);
  return d;
});

app.get('/events/:id/discounts/:codigo', {
  schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, codigo: { type: 'string', pattern: '^[A-Za-z0-9]{1,20}$' } } } },
}, async (req) => {
  const d = await descuentoVigente(req.params.id, req.params.codigo);
  return d ? { valido: true, ...d } : { valido: false };
});

// Cotización para armar la orden: precios, ventana de venta (RN03) y descuento (RN08)
app.post('/internal/quote', {
  preHandler: soloServicios('orders'),
  schema: {
    body: {
      type: 'object',
      required: ['eventoId', 'items'],
      properties: {
        eventoId: { type: 'string', format: 'uuid' },
        codigo: { type: 'string', maxLength: 20 },
        items: { type: 'array', minItems: 1, items: { type: 'object', required: ['tipoEntradaId', 'cantidad'], properties: { tipoEntradaId: { type: 'string', format: 'uuid' }, cantidad: { type: 'integer', minimum: 1 } } } },
      },
    },
  },
}, async (req) => {
  const { eventoId, items, codigo } = req.body;
  const { rows: [e] } = await db.query(`${DETALLE} WHERE e.id = $1 GROUP BY e.id`, [eventoId]);
  if (!e || e.estado !== 'PUBLICADO') throw error(409, 'El evento no está a la venta');
  const ahora = new Date();
  const lineas = items.map((i) => {
    const t = e.tipos.find((x) => x.id === i.tipoEntradaId);
    if (!t) throw error(400, 'Tipo de entrada no pertenece al evento');
    if ((t.ventaDesde && new Date(t.ventaDesde) > ahora) || (t.ventaHasta && new Date(t.ventaHasta) < ahora)) throw error(409, `La venta de ${t.nombre} no está abierta`);
    return { tipoEntradaId: t.id, nombre: t.nombre, precio: t.precio, cantidad: i.cantidad };
  });
  const subtotal = lineas.reduce((s, l) => s + centavos(l.precio) * l.cantidad, 0);
  const d = codigo ? await descuentoVigente(eventoId, codigo) : null;
  const descuento = !d ? 0 : d.porcentaje ? Math.round((subtotal * d.porcentaje) / 100) : Math.min(subtotal, centavos(d.monto));
  return {
    evento: { id: e.id, titulo: e.titulo, fecha: e.fecha, lugar: e.lugar, ciudad: e.ciudad },
    items: lineas,
    subtotal: subtotal / 100,
    descuento: descuento / 100,
    total: (subtotal - descuento) / 100,
    codigo: d?.codigo ?? null,
    codigoRechazado: Boolean(codigo && !d),
  };
});

// Usos del código de descuento: se cuentan cuando la orden queda pagada
await bus.suscribir(['orden.pagada'], async ({ datos }, c) => {
  if (datos.codigo) await c.query('UPDATE descuentos SET usos = usos + 1 WHERE evento_id = $1 AND codigo = $2', [datos.eventoId, datos.codigo]);
});

await iniciar(app, bus.cerrar);
