// auth: registro, inicio de sesión, bloqueo por intentos fallidos, sesiones y roles (RF01, RF03, RNF05)
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import cookie from '@fastify/cookie';
import { SignJWT } from 'jose';
import { crearApp, crearDb, crearBus, migrar, tx, encolar, requiere, error, env, clavePrivada, iniciar, conId } from '@plataforma/common';

const MAX_INTENTOS = Number(env('MAX_INTENTOS', 5));
const BLOQUEO_MIN = 15;
const ROLES = ['ASISTENTE', 'ORGANIZADOR', 'ACCESO', 'ADMIN'];
const privada = clavePrivada('AUTH_PRIVATE_KEY');
const db = crearDb();

await migrar(db, `
CREATE TABLE IF NOT EXISTS usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  correo text NOT NULL,
  hash text NOT NULL,
  rol text NOT NULL CHECK (rol IN ('ASISTENTE','ORGANIZADOR','ACCESO','ADMIN')),
  intentos_fallidos int NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo ON usuarios (lower(correo));
CREATE TABLE IF NOT EXISTS sesiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  hash_token text NOT NULL UNIQUE,
  expira_en timestamptz NOT NULL,
  revocada boolean NOT NULL DEFAULT false);
`);

// Usuarios semilla, uno por rol (los ids fijos los usan las semillas de los demás servicios)
const hashSemilla = await bcrypt.hash(env('SEED_PASSWORD'), 10);
for (const [id, nombre, correo, rol] of [
  ['00000000-0000-4000-8000-000000000001', 'Administración', 'admin@eventos.ec', 'ADMIN'],
  ['00000000-0000-4000-8000-000000000002', 'Colectivo Jazz UIO', 'organizador@eventos.ec', 'ORGANIZADOR'],
  ['00000000-0000-4000-8000-000000000003', 'Puerta 1', 'acceso@eventos.ec', 'ACCESO'],
  ['00000000-0000-4000-8000-000000000004', 'María Fernanda Torres', 'asistente@eventos.ec', 'ASISTENTE'],
  ['00000000-0000-4000-8000-000000000005', 'Carlos Andrade', 'asistente2@eventos.ec', 'ASISTENTE'],
]) {
  await db.query('INSERT INTO usuarios (id, nombre, correo, hash, rol) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [id, nombre, correo, hashSemilla, rol]);
}

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const hora = (f) => f.toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit' });

const firmarAcceso = (u) =>
  new SignJWT({ rol: u.rol, nombre: u.nombre, correo: u.correo })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(u.id)
    .setIssuer('auth')
    .setAudience('plataforma')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privada);

// Token de acceso de 15 min en la respuesta; token de renovación rotativo en cookie HttpOnly
async function abrirSesion(reply, u) {
  const renovacion = crypto.randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sesiones (usuario_id, hash_token, expira_en) VALUES ($1, $2, now() + interval '7 days')", [u.id, sha256(renovacion)]);
  reply.setCookie('rt', renovacion, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth', maxAge: 7 * 86400 });
  return { accessToken: await firmarAcceso(u), usuario: { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol } };
}

const app = await crearApp('auth', 'Registro, inicio de sesión, sesiones y roles');
await app.register(cookie);
const bus = await crearBus('auth', db, app.log);

const correo = { type: 'string', format: 'email', maxLength: 120 };

app.post('/register', {
  schema: {
    body: {
      type: 'object',
      required: ['nombre', 'correo', 'password'],
      properties: {
        nombre: { type: 'string', minLength: 2, maxLength: 80 },
        correo,
        password: { type: 'string', minLength: 10, maxLength: 200 },
        rol: { type: 'string', enum: ['ASISTENTE', 'ORGANIZADOR'], default: 'ASISTENTE' },
      },
    },
  },
}, async (req, reply) => {
  const { nombre, password, rol } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const u = await tx(db, async (c) => {
    const { rows } = await c.query('INSERT INTO usuarios (nombre, correo, hash, rol) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id, nombre, correo, rol', [nombre, req.body.correo, hash, rol]);
    if (!rows[0]) throw error(409, 'Ya existe una cuenta con ese correo');
    await encolar(c, 'usuario.registrado', { usuarioId: rows[0].id, nombre, correo: req.body.correo });
    return rows[0];
  });
  reply.code(201);
  return abrirSesion(reply, u);
});

app.post('/login', {
  schema: { body: { type: 'object', required: ['correo', 'password'], properties: { correo, password: { type: 'string', minLength: 1, maxLength: 200 } } } },
}, async (req, reply) => {
  const { rows: [u] } = await db.query('SELECT * FROM usuarios WHERE lower(correo) = lower($1)', [req.body.correo]);
  if (u?.bloqueado_hasta > new Date()) throw error(423, `Cuenta bloqueada por intentos fallidos. Intenta de nuevo después de las ${hora(u.bloqueado_hasta)}.`);
  if (!u) {
    await bcrypt.compare(req.body.password, hashSemilla); // mismo tiempo de respuesta exista o no la cuenta
    throw error(401, 'Correo o contraseña incorrectos.');
  }
  if (!(await bcrypt.compare(req.body.password, u.hash))) {
    const { rows: [r] } = await db.query(`
      UPDATE usuarios
         SET intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0 ELSE intentos_fallidos + 1 END,
             bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2 THEN now() + interval '${BLOQUEO_MIN} minutes' END
       WHERE id = $1 RETURNING intentos_fallidos, bloqueado_hasta`, [u.id, MAX_INTENTOS]);
    req.log.warn({ accion: 'login_fallido', usuarioId: u.id, bloqueada: Boolean(r.bloqueado_hasta) }, 'inicio de sesión fallido');
    if (r.bloqueado_hasta) throw error(423, `Demasiados intentos fallidos: la cuenta queda bloqueada ${BLOQUEO_MIN} minutos.`);
    throw error(401, `Correo o contraseña incorrectos. Te quedan ${MAX_INTENTOS - r.intentos_fallidos} intentos antes del bloqueo.`);
  }
  await db.query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [u.id]);
  return abrirSesion(reply, u);
});

app.post('/refresh', async (req, reply) => {
  const token = req.cookies.rt;
  if (!token) throw error(401, 'Sin sesión');
  const { rows: [s] } = await db.query('SELECT s.*, u.nombre, u.correo, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.hash_token = $1', [sha256(token)]);
  if (!s || s.expira_en < new Date()) throw error(401, 'Sesión vencida');
  if (s.revocada) {
    // Un token de renovación ya usado volvió a aparecer: posible robo, se cierran todas las sesiones
    await db.query('UPDATE sesiones SET revocada = true WHERE usuario_id = $1', [s.usuario_id]);
    req.log.warn({ accion: 'reuso_token_renovacion', usuarioId: s.usuario_id }, 'se cierran todas las sesiones del usuario');
    throw error(401, 'Sesión no válida');
  }
  await db.query('UPDATE sesiones SET revocada = true WHERE id = $1', [s.id]);
  return abrirSesion(reply, { id: s.usuario_id, nombre: s.nombre, correo: s.correo, rol: s.rol });
});

app.post('/logout', async (req, reply) => {
  if (req.cookies.rt) await db.query('UPDATE sesiones SET revocada = true WHERE hash_token = $1', [sha256(req.cookies.rt)]);
  reply.clearCookie('rt', { path: '/api/auth' });
  return { ok: true };
});

app.get('/me', { preHandler: requiere() }, async (req) => req.usuario);

app.patch('/users/:id/role', {
  preHandler: requiere('ADMIN'),
  schema: { ...conId, body: { type: 'object', required: ['rol'], properties: { rol: { type: 'string', enum: ROLES } } } },
}, async (req) => {
  const { rows: [u] } = await db.query('UPDATE usuarios SET rol = $2 WHERE id = $1 RETURNING id, nombre, rol', [req.params.id, req.body.rol]);
  if (!u) throw error(404, 'Usuario no encontrado');
  req.log.info({ accion: 'cambio_rol', adminId: req.usuario.id, usuarioId: u.id, rol: u.rol }, 'acción crítica'); // RN10
  return u;
});

await iniciar(app, bus.cerrar);
