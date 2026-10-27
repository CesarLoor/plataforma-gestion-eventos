// Utilidades de las pruebas: corren dentro de la red de Docker (docker compose --profile pruebas run --rm pruebas)
import crypto from 'node:crypto';

export const URL = {
  auth: 'http://auth:3000',
  catalog: 'http://catalog:3000',
  inventory: 'http://inventory:3000',
  orders: 'http://orders:3000',
  pasarela: 'http://payment-sim:3000',
  tickets: 'http://tickets:3000',
  checkin: 'http://checkin:3000',
  reports: 'http://reports:3000',
  mailpit: 'http://mailpit:8025',
};

export async function http(metodo, url, { token, body, headers = {}, crudo } = {}) {
  const r = await fetch(url, {
    method: metodo,
    redirect: 'manual',
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body && !crudo && { 'content-type': 'application/json' }), ...headers },
    body: crudo ?? (body && JSON.stringify(body)),
  });
  const texto = await r.text();
  let datos = texto;
  try {
    datos = JSON.parse(texto);
  } catch {
    // no es JSON
  }
  return { status: r.status, datos, headers: r.headers };
}

export async function login(correo) {
  const r = await http('POST', `${URL.auth}/login`, { body: { correo, password: process.env.SEED_PASSWORD } });
  if (r.status !== 200) throw new Error(`login de ${correo}: ${r.status} ${JSON.stringify(r.datos)}`);
  return r.datos.accessToken;
}

// JWT de prueba firmado con la clave de auth (solo el arnés de pruebas la usa, para no crear 200 cuentas)
export function tokenDePrueba(sub, rol = 'ASISTENTE') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'EdDSA' })}.${b64({ sub, rol, nombre: `Prueba ${sub.slice(0, 4)}`, correo: `${sub.slice(0, 8)}@prueba.ec`, iss: 'auth', aud: 'plataforma', iat: ahora, exp: ahora + 600 })}`;
  const clave = crypto.createPrivateKey(Buffer.from(process.env.AUTH_PRIVATE_KEY, 'base64').toString());
  return `${cuerpo}.${crypto.sign(null, Buffer.from(cuerpo), clave).toString('base64url')}`;
}

export async function esperar(descripcion, fn, segundos = 30) {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Tiempo agotado esperando: ${descripcion}`);
}

// Crea y publica un evento de prueba y espera a que inventory tenga sus cupos
export async function crearEvento(tokenOrg, tipos) {
  const e = await http('POST', `${URL.catalog}/events`, {
    token: tokenOrg,
    body: { titulo: `Prueba ${new Date().toISOString()}`, categoria: 'Universidad', ciudad: 'Sangolquí', lugar: 'Campus ESPE', fecha: '2026-12-15T19:00:00-05:00', tipos },
  });
  if (e.status !== 201) throw new Error(`crear evento: ${e.status} ${JSON.stringify(e.datos)}`);
  const p = await http('POST', `${URL.catalog}/events/${e.datos.id}/publish`, { token: tokenOrg });
  if (p.status !== 200) throw new Error(`publicar evento: ${p.status}`);
  const detalle = await http('GET', `${URL.catalog}/events/${e.datos.id}`);
  await esperar('cupos en inventory', async () => (await http('GET', `${URL.inventory}/availability/${e.datos.id}`)).datos.length === tipos.length);
  return detalle.datos;
}

let fallos = 0;
export function comprobar(condicion, mensaje) {
  console.log(`${condicion ? '  OK  ' : '  FALLA'} ${mensaje}`);
  if (!condicion) fallos += 1;
}
export function terminar(nombre) {
  console.log(fallos ? `\n${nombre}: ${fallos} comprobación(es) fallaron\n` : `\n${nombre}: todo correcto\n`);
  process.exitCode = fallos ? 1 : 0;
}
