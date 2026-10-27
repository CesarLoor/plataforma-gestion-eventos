// Cliente de la API. El token de acceso vive solo en memoria (no en localStorage, a salvo de XSS persistente);
// la sesión se recupera con la cookie HttpOnly de renovación.
let token = null;
let usuario = null;
const oyentes = new Set();

export const sesion = () => usuario;
export const alCambiarSesion = (fn) => {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
};
function fijarSesion(datos) {
  token = datos?.accessToken ?? null;
  usuario = datos?.usuario ?? null;
  oyentes.forEach((fn) => fn(usuario));
}

export class ErrorApi extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

async function pedir(ruta, { method = 'GET', body } = {}) {
  return fetch(`/api${ruta}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
}

export async function renovar() {
  const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  fijarSesion(r?.ok ? await r.json() : null);
  return usuario;
}

export async function api(ruta, opciones) {
  let r = await pedir(ruta, opciones);
  if (r.status === 401 && token && (await renovar())) r = await pedir(ruta, opciones);
  const tipo = r.headers.get('content-type') ?? '';
  const datos = tipo.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ErrorApi(r.status, datos?.mensaje ?? 'No se pudo completar la acción');
  return datos;
}

export async function entrar(ruta, body) {
  fijarSesion(await api(ruta, { method: 'POST', body }));
  return usuario;
}

export async function salir() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  fijarSesion(null);
}

// Descarga autenticada (exportación CSV)
export async function descargar(ruta, nombre) {
  const r = await pedir(ruta);
  if (!r.ok) throw new ErrorApi(r.status, 'No se pudo descargar');
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  a.click();
  URL.revokeObjectURL(url);
}

export const dinero = (n) => `$${Number(n).toFixed(2).replace('.', ',')}`;
export const fechaCorta = (f) =>
  new Date(f).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const hora = (f) => new Date(f).toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit' });
