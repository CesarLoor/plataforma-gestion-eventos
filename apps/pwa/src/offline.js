// Datos que deben funcionar en modo avión (RF18, RF23, RNF09), guardados en IndexedDB
import { get, set, del } from 'idb-keyval';

export const guardarTickets = (tickets) => set('tickets', tickets);
export const ticketsGuardados = async () => (await get('tickets')) ?? [];

export const guardarPaquete = (paquete) => set(`paquete:${paquete.eventoId}`, paquete);
export const paqueteGuardado = (eventoId) => get(`paquete:${eventoId}`);

export const pendientes = async () => (await get('pendientes')) ?? [];
export const agregarPendiente = async (registro) => set('pendientes', [...(await pendientes()), registro]);
export const limpiarPendientes = () => del('pendientes');

const desdeB64url = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// Verifica la firma Ed25519 del QR con la clave pública del paquete del evento (WebCrypto, sin red)
export async function verificarQrLocal(qr, jwk) {
  const partes = String(qr).trim().split('.');
  if (partes.length !== 2) return null;
  try {
    const clave = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, clave, desdeB64url(partes[1]), new TextEncoder().encode(partes[0]));
    return ok ? JSON.parse(new TextDecoder().decode(desdeB64url(partes[0]))) : null;
  } catch {
    return null;
  }
}

// Validación local: firma, evento, estado y uso previo en este dispositivo
export async function validarSinConexion(qr, paquete) {
  const datos = await verificarQrLocal(qr, paquete.clavePublica);
  if (!datos) return { resultado: 'INVALIDO', motivo: 'La firma no es válida: posible copia o falsificación' };
  if (datos.eid !== paquete.eventoId) return { resultado: 'INVALIDO', motivo: 'El ticket es de otro evento' };
  const t = paquete.tickets.find((x) => x.tid === datos.tid);
  if (!t) return { resultado: 'INVALIDO', motivo: 'Ticket desconocido para este evento' };
  if (t.estado === 'INVALIDADO') return { resultado: 'INVALIDO', motivo: 'Ticket anulado' };
  if (t.ingresoEn) return { resultado: 'USADO', tipo: t.tipo, titular: t.titular, primerIngreso: t.ingresoEn };
  t.ingresoEn = new Date().toISOString();
  await guardarPaquete(paquete);
  await agregarPendiente({ tid: t.tid, escaneadoEn: t.ingresoEn });
  return { resultado: 'VALIDO', tipo: t.tipo, titular: t.titular, ingresoEn: t.ingresoEn, local: true };
}
