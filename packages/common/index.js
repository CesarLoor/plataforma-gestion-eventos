// Utilidades compartidas por los servicios: HTTP, base de datos, mensajería, autenticación y firmas.
import crypto from 'node:crypto';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import pg from 'pg';
import { connect, JSONCodec, AckPolicy, DeliverPolicy, nanos } from 'nats';
import { SignJWT, jwtVerify } from 'jose';

export function env(nombre, porDefecto) {
  const valor = process.env[nombre] || porDefecto;
  if (valor === undefined) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

// Las claves viajan en .env como PEM codificado en base64 (una sola línea)
const pem = (nombre) => Buffer.from(env(nombre), 'base64').toString('utf8');
export const clavePrivada = (nombre) => crypto.createPrivateKey(pem(nombre));
export const clavePublica = (nombre) => crypto.createPublicKey(pem(nombre));

export const error = (codigo, mensaje) => Object.assign(new Error(mensaje), { statusCode: codigo });
export const conId = { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } };

// ---------- HTTP ----------

export async function crearApp(nombre, descripcion) {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 100_000,
    logger: {
      level: env('LOG_LEVEL', 'info'),
      redact: { paths: ['*.password', '*.token', '*.accessToken', '*.qr', '*.correo', '*.tarjeta'], censor: '[oculto]' },
    },
    // removeAdditional: descarta campos que la ruta no declara (evita asignación masiva)
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: true } },
  });
  await app.register(swagger, { openapi: { info: { title: `Servicio ${nombre}`, description: descripcion, version: '0.1.0' } } });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.get('/health', { logLevel: 'warn', schema: { hide: true } }, async () => ({ ok: true, servicio: nombre }));
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ mensaje: 'Datos no válidos', detalle: err.message });
    const codigo = err.statusCode ?? 500;
    if (codigo >= 500) {
      req.log.error(err);
      return reply.code(500).send({ mensaje: 'Error interno' });
    }
    return reply.code(codigo).send({ mensaje: err.message });
  });
  return app;
}

export async function iniciar(app, alCerrar = async () => {}) {
  await app.listen({ host: '0.0.0.0', port: Number(env('PORT', 3000)) });
  const cerrar = async () => {
    await app.close();
    await alCerrar();
    process.exit(0);
  };
  process.once('SIGTERM', cerrar);
  process.once('SIGINT', cerrar);
}

// ---------- Base de datos ----------

export const crearDb = () => new pg.Pool({ connectionString: env('DATABASE_URL'), max: Number(env('DB_POOL', 10)) });

const ESQUEMA_COMUN = `
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  datos jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  publicado_en timestamptz);
CREATE INDEX IF NOT EXISTS outbox_pendientes ON outbox (creado_en) WHERE publicado_en IS NULL;
CREATE TABLE IF NOT EXISTS mensajes_procesados (id uuid PRIMARY KEY, procesado_en timestamptz NOT NULL DEFAULT now());
`;

export const migrar = (db, sql) => db.query(ESQUEMA_COMUN + sql);

export async function tx(db, fn) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// Outbox: el evento se guarda en la misma transacción que el cambio de estado
export const encolar = (c, tipo, datos) => c.query('INSERT INTO outbox (tipo, datos) VALUES ($1, $2)', [tipo, datos]);

// ---------- Mensajería (NATS JetStream) ----------

const jc = JSONCodec();

export async function crearBus(nombre, db, log) {
  const nc = await connect({ servers: env('NATS_URL'), name: nombre, maxReconnectAttempts: -1 });
  const jsm = await nc.jetstreamManager();
  // duplicate_window: JetStream descarta un mismo Nats-Msg-Id repetido dentro de 5 min
  const stream = { name: 'DOMINIO', subjects: ['dominio.>'], duplicate_window: nanos(5 * 60_000) };
  try {
    await jsm.streams.add(stream);
  } catch {
    await jsm.streams.update('DOMINIO', stream);
  }
  const js = nc.jetstream();

  let ocupado = false;
  const relay = setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      const { rows } = await db.query('SELECT id, tipo, datos, creado_en FROM outbox WHERE publicado_en IS NULL ORDER BY creado_en LIMIT 200');
      for (const r of rows) {
        const sobre = { id: r.id, tipo: r.tipo, version: 1, ocurridoEn: r.creado_en, datos: r.datos };
        await js.publish(`dominio.${r.tipo}`, jc.encode(sobre), { msgID: r.id });
        await db.query('UPDATE outbox SET publicado_en = now() WHERE id = $1', [r.id]);
      }
    } catch (e) {
      log.error({ err: e }, 'relay del outbox');
    } finally {
      ocupado = false;
    }
  }, 300);

  // Consumidor durable e idempotente: el id del evento se registra en la misma transacción que su efecto
  async function suscribir(tipos, manejar) {
    const filter_subjects = tipos.map((t) => `dominio.${t}`);
    try {
      await jsm.consumers.add('DOMINIO', { durable_name: nombre, ack_policy: AckPolicy.Explicit, deliver_policy: DeliverPolicy.All, ack_wait: nanos(30_000), filter_subjects });
    } catch {
      await jsm.consumers.update('DOMINIO', nombre, { filter_subjects });
    }
    const mensajes = await (await js.consumers.get('DOMINIO', nombre)).consume();
    (async () => {
      for await (const m of mensajes) {
        let sobre;
        try {
          sobre = jc.decode(m.data);
        } catch {
          m.term();
          continue;
        }
        try {
          await tx(db, async (c) => {
            const { rowCount } = await c.query('INSERT INTO mensajes_procesados (id) VALUES ($1) ON CONFLICT DO NOTHING', [sobre.id]);
            if (rowCount) await manejar(sobre, c);
          });
          m.ack();
        } catch (e) {
          log.error({ err: e, tipo: sobre.tipo }, 'error al procesar un evento; se reintentará');
          m.nak(5000);
        }
      }
    })();
  }

  return {
    suscribir,
    cerrar: async () => {
      clearInterval(relay);
      await nc.drain();
    },
  };
}

// ---------- Autenticación ----------

let publicaAuth;
export async function usuarioDe(req) {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) throw error(401, 'Inicia sesión para continuar');
  publicaAuth ??= clavePublica('AUTH_PUBLIC_KEY');
  try {
    const { payload } = await jwtVerify(h.slice(7), publicaAuth, { issuer: 'auth', audience: 'plataforma', algorithms: ['EdDSA'] });
    return { id: payload.sub, rol: payload.rol, nombre: payload.nombre, correo: payload.correo };
  } catch {
    throw error(401, 'Sesión no válida o vencida');
  }
}

// preHandler: exige sesión y, si se indican, uno de los roles
export const requiere = (...roles) => async (req) => {
  req.usuario = await usuarioDe(req);
  if (roles.length && !roles.includes(req.usuario.rol)) throw error(403, 'No tienes permiso para esta acción');
};

// Llamadas entre servicios: JWT HS256 de 60 s con aud=internal y sub=<servicio que llama>
const secretoInterno = () => new TextEncoder().encode(env('INTERNAL_JWT_SECRET'));

export const soloServicios = (...permitidos) => async (req) => {
  try {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const { payload } = await jwtVerify(token, secretoInterno(), { audience: 'internal', algorithms: ['HS256'] });
    if (!permitidos.includes(payload.sub)) throw new Error('servicio no permitido');
  } catch {
    throw error(403, 'Solo para servicios internos');
  }
};

export async function llamar(origen, url, { method = 'GET', body } = {}) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(origen).setAudience('internal').setIssuedAt().setExpirationTime('60s').sign(secretoInterno());
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const datos = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  return { status: r.status, ok: r.ok, datos };
}

// ---------- Firmas ----------

// QR del ticket: base64url(payload) + "." + base64url(firma Ed25519 sobre ese texto)
export function firmarQr(payload, privada) {
  const datos = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${datos}.${crypto.sign(null, Buffer.from(datos), privada).toString('base64url')}`;
}

export function verificarQr(qr, publica) {
  const partes = String(qr).trim().split('.');
  if (partes.length !== 2) return null;
  try {
    if (!crypto.verify(null, Buffer.from(partes[0]), publica, Buffer.from(partes[1], 'base64url'))) return null;
    return JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export const firmaHmac = (secreto, cuerpo) => crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');

export function hmacValido(secreto, cuerpo, firma) {
  const esperada = Buffer.from(firmaHmac(secreto, cuerpo));
  const recibida = Buffer.from(String(firma ?? ''));
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}
