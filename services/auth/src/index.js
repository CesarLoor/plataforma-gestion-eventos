// auth: registro, inicio de sesión, bloqueo por intentos fallidos, sesiones y roles (RF01, RF03, RNF05)
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import cookie from '@fastify/cookie';
import { SignJWT } from 'jose';
import { crearApp, crearDb, crearBus, migrar, tx, encolar, requiere, error, env, clavePrivada, iniciar, conId } from '@plataforma/common';

const MAX_INTENTOS = Number(env('MAX_INTENTOS', 3));
const BLOQUEO_MIN = 15;
const ROLES = ['ASISTENTE', 'ORGANIZADOR', 'ACCESO', 'ADMIN'];
const privada = clavePrivada('AUTH_PRIVATE_KEY');
const db = crearDb();

// Identidad separada: persona (datos personales) 1:0..1 usuario (credenciales) N:M rol vía usuario_roles
await migrar(db, `
CREATE TABLE IF NOT EXISTS personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombres text NOT NULL,
  apellidos text,
  identificacion text UNIQUE,
  correo text NOT NULL,
  telefono text,
  estado boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL UNIQUE REFERENCES personas(id),
  correo text NOT NULL,
  hash text NOT NULL,
  intentos_fallidos int NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  estado boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo ON usuarios (lower(correo));
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  descripcion text,
  estado boolean NOT NULL DEFAULT true);
INSERT INTO roles (nombre, descripcion) VALUES
  ('ASISTENTE', 'Compra entradas y consulta sus tickets'),
  ('ORGANIZADOR', 'Publica y administra sus eventos'),
  ('ACCESO', 'Valida tickets en la puerta'),
  ('ADMIN', 'Administra cuentas y roles')
ON CONFLICT (nombre) DO NOTHING;
CREATE TABLE IF NOT EXISTS usuario_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  rol_id uuid NOT NULL REFERENCES roles(id),
  asignado_en timestamptz NOT NULL DEFAULT now(),
  estado boolean NOT NULL DEFAULT true,
  UNIQUE (usuario_id, rol_id));
CREATE TABLE IF NOT EXISTS sesiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  hash_token text NOT NULL UNIQUE,
  expira_en timestamptz NOT NULL,
  revocada boolean NOT NULL DEFAULT false);

-- Bases creadas con el esquema anterior (usuarios.nombre y usuarios.rol): se migran una sola vez sin perder cuentas
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'rol') THEN
    INSERT INTO personas (id, nombres, correo) SELECT id, nombre, correo FROM usuarios;
    ALTER TABLE usuarios ADD COLUMN persona_id uuid UNIQUE REFERENCES personas(id), ADD COLUMN estado boolean NOT NULL DEFAULT true;
    UPDATE usuarios SET persona_id = id;
    ALTER TABLE usuarios ALTER COLUMN persona_id SET NOT NULL;
    INSERT INTO usuario_roles (usuario_id, rol_id) SELECT u.id, r.id FROM usuarios u JOIN roles r ON r.nombre = u.rol;
    ALTER TABLE usuarios DROP COLUMN rol, DROP COLUMN nombre;
  END IF;
END $$;

-- Vista de lectura: lo que el resto del servicio necesita de una cuenta (nombre completo y rol vigente)
-- shortcut: la app usa un solo rol activo (el más reciente); si se habilitan varios a la vez, el JWT debe llevar la lista
CREATE OR REPLACE VIEW cuentas AS
  SELECT u.id, u.correo, u.hash, u.intentos_fallidos, u.bloqueado_hasta, u.creado_en, u.estado,
         concat_ws(' ', p.nombres, p.apellidos) AS nombre,
         (SELECT r.nombre FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
           WHERE ur.usuario_id = u.id AND ur.estado AND r.estado ORDER BY ur.asignado_en DESC LIMIT 1) AS rol
    FROM usuarios u JOIN personas p ON p.id = u.persona_id;
`);

// Usuarios semilla, uno por rol (los ids fijos los usan las semillas de los demás servicios; persona usa el mismo id)
const hashSemilla = await bcrypt.hash(env('SEED_PASSWORD'), 10);
for (const [id, nombre, correo, rol] of [
  ['00000000-0000-4000-8000-000000000001', 'Administración', 'admin@eventos.ec', 'ADMIN'],
  ['00000000-0000-4000-8000-000000000002', 'Colectivo Jazz UIO', 'organizador@eventos.ec', 'ORGANIZADOR'],
  ['00000000-0000-4000-8000-000000000003', 'Puerta 1', 'acceso@eventos.ec', 'ACCESO'],
  ['00000000-0000-4000-8000-000000000004', 'María Fernanda Torres', 'asistente@eventos.ec', 'ASISTENTE'],
  ['00000000-0000-4000-8000-000000000005', 'Carlos Andrade', 'asistente2@eventos.ec', 'ASISTENTE'],
]) {
  await db.query('INSERT INTO personas (id, nombres, correo) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, nombre, correo]);
  await db.query('INSERT INTO usuarios (id, persona_id, correo, hash) VALUES ($1, $1, $2, $3) ON CONFLICT DO NOTHING', [id, correo, hashSemilla]);
  await db.query('INSERT INTO usuario_roles (usuario_id, rol_id) SELECT $1, id FROM roles WHERE nombre = $2 ON CONFLICT DO NOTHING', [id, rol]);
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
    const { rows: [p] } = await c.query('INSERT INTO personas (nombres, correo) VALUES ($1, $2) RETURNING id', [nombre, req.body.correo]);
    const { rows } = await c.query('INSERT INTO usuarios (persona_id, correo, hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id, correo', [p.id, req.body.correo, hash]);
    if (!rows[0]) throw error(409, 'Ya existe una cuenta con ese correo'); // el ROLLBACK descarta también la persona
    await c.query('INSERT INTO usuario_roles (usuario_id, rol_id) SELECT $1, id FROM roles WHERE nombre = $2', [rows[0].id, rol]);
    await encolar(c, 'usuario.registrado', { usuarioId: rows[0].id, nombre, correo: req.body.correo });
    return { ...rows[0], nombre, rol };
  });
  reply.code(201);
  return abrirSesion(reply, u);
});

app.post('/login', {
  schema: { body: { type: 'object', required: ['correo', 'password'], properties: { correo, password: { type: 'string', minLength: 1, maxLength: 200 } } } },
}, async (req, reply) => {
  const { rows: [u] } = await db.query('SELECT * FROM cuentas WHERE lower(correo) = lower($1)', [req.body.correo]);
  if (u?.bloqueado_hasta > new Date()) throw error(423, `Cuenta bloqueada por intentos fallidos. Intenta de nuevo después de las ${hora(u.bloqueado_hasta)}.`);
  if (!u || !u.estado || !u.rol) { // cuenta inexistente, desactivada o sin rol vigente: misma respuesta
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
  const { rows: [s] } = await db.query('SELECT s.*, u.nombre, u.correo, u.rol FROM sesiones s JOIN cuentas u ON u.id = s.usuario_id WHERE s.hash_token = $1 AND u.estado AND u.rol IS NOT NULL', [sha256(token)]);
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

// Pantalla 7 · CU18 · RF03: lista de cuentas para el administrador
app.get('/users', { preHandler: requiere('ADMIN') }, async () =>
  (await db.query('SELECT id, nombre, correo, rol, bloqueado_hasta > now() AS bloqueado, creado_en FROM cuentas ORDER BY creado_en DESC LIMIT 500')).rows);

app.patch('/users/:id/role', {
  preHandler: requiere('ADMIN'),
  schema: { ...conId, body: { type: 'object', required: ['rol'], properties: { rol: { type: 'string', enum: ROLES }, motivo: { type: 'string', maxLength: 300 } } } },
}, async (req) => {
  if (req.params.id === req.usuario.id) throw error(400, 'No puedes cambiar tu propio rol');
  // Reemplaza el rol: revoca los demás y asigna el nuevo, respetando UNIQUE (usuario_id, rol_id)
  const u = await tx(db, async (c) => {
    const { rows: [existe] } = await c.query('SELECT 1 FROM usuarios WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existe) throw error(404, 'Usuario no encontrado');
    await c.query('DELETE FROM usuario_roles WHERE usuario_id = $1 AND rol_id <> (SELECT id FROM roles WHERE nombre = $2)', [req.params.id, req.body.rol]);
    await c.query('INSERT INTO usuario_roles (usuario_id, rol_id) SELECT $1, id FROM roles WHERE nombre = $2 ON CONFLICT (usuario_id, rol_id) DO UPDATE SET estado = true', [req.params.id, req.body.rol]);
    return (await c.query('SELECT id, nombre, rol FROM cuentas WHERE id = $1', [req.params.id])).rows[0];
  });
  req.log.info({ accion: 'cambio_rol', adminId: req.usuario.id, usuarioId: u.id, rol: u.rol, motivo: req.body.motivo }, 'acción crítica'); // RN10
  return u;
});

// ---------- CRUD de personas (Laboratorio 01 · RF03): datos personales, independientes de la cuenta ----------
const camposPersona = {
  nombres: { type: 'string', minLength: 2, maxLength: 100 },
  apellidos: { type: 'string', maxLength: 100 },
  identificacion: { type: 'string', pattern: '^[0-9A-Za-z-]{5,20}$' },
  correo: { ...correo, maxLength: 150 },
  telefono: { type: 'string', pattern: '^[0-9+ ]{7,20}$' },
  estado: { type: 'boolean' },
};
const COLUMNAS_PERSONA = 'id, nombres, apellidos, identificacion, correo, telefono, estado, creado_en';

// Violaciones de restricciones de PostgreSQL -> 409 con mensaje claro (en vez de 500)
const conflicto = (e) => {
  if (e.code === '23505') throw error(409, 'Ya existe una persona con esa identificación');
  if (e.code === '23503') throw error(409, 'La persona tiene una cuenta de usuario asociada; desactívala en lugar de eliminarla');
  throw e;
};

app.post('/personas', {
  preHandler: requiere('ADMIN'),
  schema: { body: { type: 'object', required: ['nombres', 'correo'], additionalProperties: false, properties: camposPersona } },
}, async (req, reply) => {
  const { nombres, apellidos, identificacion, correo: c, telefono, estado = true } = req.body;
  const { rows: [p] } = await db.query(
    `INSERT INTO personas (nombres, apellidos, identificacion, correo, telefono, estado) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNAS_PERSONA}`,
    [nombres, apellidos, identificacion, c, telefono, estado]).catch(conflicto);
  reply.code(201);
  return p;
});

app.get('/personas', { preHandler: requiere('ADMIN') }, async () =>
  (await db.query(`SELECT ${COLUMNAS_PERSONA} FROM personas ORDER BY creado_en DESC LIMIT 500`)).rows);

app.get('/personas/:id', { preHandler: requiere('ADMIN'), schema: conId }, async (req) => {
  const { rows: [p] } = await db.query(`SELECT ${COLUMNAS_PERSONA} FROM personas WHERE id = $1`, [req.params.id]);
  if (!p) throw error(404, 'Persona no encontrada');
  return p;
});

app.patch('/personas/:id', {
  preHandler: requiere('ADMIN'),
  schema: { ...conId, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: camposPersona } },
}, async (req) => {
  const { nombres, apellidos, identificacion, correo: c, telefono, estado } = req.body;
  // COALESCE: solo cambian los campos enviados; sin SQL dinámico
  const { rows: [p] } = await db.query(
    `UPDATE personas SET nombres = COALESCE($2, nombres), apellidos = COALESCE($3, apellidos), identificacion = COALESCE($4, identificacion),
            correo = COALESCE($5, correo), telefono = COALESCE($6, telefono), estado = COALESCE($7, estado)
      WHERE id = $1 RETURNING ${COLUMNAS_PERSONA}`,
    [req.params.id, nombres, apellidos, identificacion, c, telefono, estado]).catch(conflicto);
  if (!p) throw error(404, 'Persona no encontrada');
  return p;
});

app.delete('/personas/:id', { preHandler: requiere('ADMIN'), schema: conId }, async (req, reply) => {
  const { rowCount } = await db.query('DELETE FROM personas WHERE id = $1', [req.params.id]).catch(conflicto);
  if (!rowCount) throw error(404, 'Persona no encontrada');
  req.log.info({ accion: 'eliminar_persona', adminId: req.usuario.id, personaId: req.params.id }, 'acción crítica'); // RN10
  reply.code(204);
});

await iniciar(app, bus.cerrar);
