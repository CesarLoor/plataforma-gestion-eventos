// Flujo completo y controles de seguridad: reserva -> orden -> pago (webhook repetido) -> tickets -> ingreso único
import crypto from 'node:crypto';
import { URL, http, login, esperar, crearEvento, comprobar, terminar } from './util.mjs';

console.log('\nPrueba del flujo de compra y de seguridad');
const org = await login('organizador@eventos.ec');
const ana = await login('asistente@eventos.ec');
const otro = await login('asistente2@eventos.ec');
const acceso = await login('acceso@eventos.ec');

const correoAna = `ana-${Date.now()}@prueba.ec`;
const evento = await crearEvento(org, [{ nombre: 'General', precio: 10, cupo: 20 }, { nombre: 'VIP', precio: 25, cupo: 5 }]);
const [general] = evento.tipos;
await http('POST', `${URL.catalog}/events/${evento.id}/discounts`, { token: org, body: { codigo: 'ESPE10', porcentaje: 10 } });

// CU03: reserva temporal
const reserva = await http('POST', `${URL.inventory}/reservations`, { token: ana, body: { eventoId: evento.id, items: [{ tipoEntradaId: general.id, cantidad: 2 }] } });
comprobar(reserva.status === 201 && reserva.datos.estado === 'ACTIVA', 'CU03: reserva ACTIVA con vencimiento (RF08)');
const minutos = (new Date(reserva.datos.expiraEn) - Date.now()) / 60000;
comprobar(minutos > 9 && minutos <= 10, `RN01: la reserva vence en 10 min (${minutos.toFixed(1)})`);

// CU06: orden con descuento
const orden = await http('POST', `${URL.orders}/orders`, { token: ana, body: { reservaId: reserva.datos.id, codigo: 'espe10', nombre: 'Ana Prueba', correo: correoAna, aceptaTerminos: true } });
comprobar(orden.status === 201 && orden.datos.estado === 'PENDIENTE_PAGO', 'CU06: orden PENDIENTE_PAGO (RF12)');
comprobar(orden.datos.total === 18, `CU05: ESPE10 aplica 10 % (total ${orden.datos.total}, esperado 18)`);

// V1 sin IDOR: otra persona no ve la orden ni puede usar la reserva
comprobar((await http('GET', `${URL.orders}/orders/${orden.datos.id}`, { token: otro })).status === 404, 'V1: otra persona recibe 404 al pedir la orden ajena');
comprobar((await http('GET', `${URL.inventory}/reservations/${reserva.datos.id}`, { token: otro })).status === 404, 'V1: otra persona recibe 404 al pedir la reserva ajena');

// Pago con la tarjeta que envía el webhook DOS veces (RNF14)
const sesion = orden.datos.checkoutUrl.split('/').pop();
const pago = await http('POST', `${URL.pasarela}/checkout/${sesion}`, { crudo: 'tarjeta=4000000000000259&vence=12/29&cvc=123', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
comprobar(pago.status === 303, 'la pasarela cobra y devuelve a la app (303)');
const pagada = await esperar('orden PAGADA', async () => {
  const o = await http('GET', `${URL.orders}/orders/${orden.datos.id}`, { token: ana });
  return o.datos.estado === 'PAGADA' && o.datos;
});
comprobar(pagada.estado === 'PAGADA', 'RN11: orden PENDIENTE_PAGO -> PAGADA');

// RF17: un ticket por entrada, sin duplicados pese al webhook repetido
const deLaOrden = async () => (await http('GET', `${URL.tickets}/me/tickets`, { token: ana })).datos.filter((t) => t.eventoId === evento.id);
await esperar('tickets emitidos', async () => (await deLaOrden()).length >= 2);
await new Promise((r) => setTimeout(r, 2000));
const tickets = await deLaOrden();
comprobar(tickets.length === 2, `RNF14: webhook repetido -> 2 tickets, no 4 (hay ${tickets.length})`);
comprobar(tickets.every((t) => t.qr.split('.').length === 2), 'RF17: cada ticket tiene un QR firmado');
comprobar((await http('GET', `${URL.tickets}/tickets/${tickets[0].id}`, { token: otro })).status === 404, 'V1: otra persona recibe 404 al pedir un ticket ajeno');

// Webhook falsificado: sin firma válida se rechaza
const falso = JSON.stringify({ paymentId: 'pay_falso', ordenId: orden.datos.id, estado: 'APROBADO', monto: 18 });
comprobar((await http('POST', `${URL.orders}/webhooks/payment`, { crudo: falso, headers: { 'content-type': 'application/json', 'x-firma': 'abc' } })).status === 401, 'RN06: webhook con firma falsa -> 401');

// CU20: ingreso único
await esperar('checkin conoce los tickets', async () => (await http('GET', `${URL.checkin}/events/${evento.id}/offline-package`, { token: acceso })).datos.tickets?.length === 2);
const validar = (qr, eventoId = evento.id) => http('POST', `${URL.checkin}/validate`, { token: acceso, body: { qr, eventoId } });
const v1 = await validar(tickets[0].qr);
comprobar(v1.datos.resultado === 'VALIDO', 'CU20: primer escaneo -> VALIDO (RF21, RF22)');
const v2 = await validar(tickets[0].qr);
comprobar(v2.datos.resultado === 'USADO' && Boolean(v2.datos.primerIngreso), 'RN05: segundo escaneo -> USADO con la hora del primero');
const [datos, firma] = tickets[1].qr.split('.');
const alterado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(datos, 'base64url')), tipo: 'VIP' })).toString('base64url');
comprobar((await validar(`${alterado}.${firma}`)).datos.resultado === 'INVALIDO', 'RNF07: QR alterado -> INVALIDO');
comprobar((await validar(tickets[1].qr, crypto.randomUUID())).datos.resultado === 'INVALIDO', 'CU20 3b: ticket de otro evento -> INVALIDO');
comprobar((await http('POST', `${URL.checkin}/validate`, { token: ana, body: { qr: tickets[1].qr, eventoId: evento.id } })).status === 403, 'roles: un asistente no puede validar tickets (403)');

// RF23: sincronización con duplicado (dos lectores sin conexión)
const sync = await http('POST', `${URL.checkin}/sync`, { token: acceso, body: { dispositivo: 'puerta-2', registros: [{ tid: tickets[1].id, escaneadoEn: new Date().toISOString() }, { tid: tickets[0].id, escaneadoEn: new Date().toISOString() }] } });
comprobar(sync.datos.duplicados === 1 && sync.datos.resultados[0].resultado === 'ACEPTADO', 'R10: la sincronización acepta el nuevo y marca el duplicado');

// RF25: el panel refleja la venta
const panel = await esperar('panel actualizado', async () => {
  const d = (await http('GET', `${URL.reports}/events/${evento.id}/dashboard`, { token: org })).datos;
  return d.vendidas === 2 && d.ingresos === 2 && d;
});
comprobar(panel.recaudado === 18, `RF25: panel con 2 vendidas, 2 ingresos y $18 recaudados (${panel.recaudado})`);
comprobar((await http('GET', `${URL.reports}/events/${evento.id}/dashboard`, { token: otro })).status === 403, 'roles: un asistente no ve el panel (403)');
comprobar((await http('GET', `${URL.auth}/users`, { token: org })).status === 403, 'RF03: solo el administrador lista las cuentas (403)');
const admin = await login('admin@eventos.ec');
const cuentas = (await http('GET', `${URL.auth}/users`, { token: admin })).datos;
comprobar(Array.isArray(cuentas) && cuentas.some((u) => u.correo === 'acceso@eventos.ec') && !('hash' in cuentas[0]), 'RF03: el administrador lista las cuentas sin el hash de la contraseña');
const yo = cuentas.find((u) => u.correo === 'admin@eventos.ec');
comprobar((await http('PATCH', `${URL.auth}/users/${yo.id}/role`, { token: admin, body: { rol: 'ASISTENTE', motivo: 'prueba' } })).status === 400, 'RF03: el administrador no puede cambiar su propio rol (400)');

// Laboratorio 01: CRUD de personas (separadas de la cuenta de usuario)
const ident = `PRUEBA-${Date.now()}`;
const nueva = await http('POST', `${URL.auth}/personas`, { token: admin, body: { nombres: 'Ana', apellidos: 'Perez', identificacion: ident, correo: 'ana.prueba@example.com', telefono: '0991234567' } });
comprobar(nueva.status === 201 && nueva.datos.estado === true, 'Lab01: POST /personas crea la persona (201)');
comprobar((await http('POST', `${URL.auth}/personas`, { token: admin, body: { nombres: 'Otra', identificacion: ident, correo: 'otra@example.com' } })).status === 409, 'Lab01: identificación duplicada -> 409');
comprobar((await http('POST', `${URL.auth}/personas`, { token: admin, body: { nombres: 'Carlos', correo: 'correo-invalido' } })).status === 400, 'Lab01: correo inválido -> 400');
comprobar((await http('GET', `${URL.auth}/personas`, { token: org })).status === 403, 'Lab01: solo el administrador gestiona personas (403)');
comprobar((await http('GET', `${URL.auth}/personas`, { token: admin })).datos.some((p) => p.identificacion === ident), 'Lab01: GET /personas lista la persona');
const editada = await http('PATCH', `${URL.auth}/personas/${nueva.datos.id}`, { token: admin, body: { telefono: '0987654321' } });
comprobar(editada.datos.telefono === '0987654321' && editada.datos.nombres === 'Ana', 'Lab01: PATCH cambia solo el teléfono');
comprobar((await http('DELETE', `${URL.auth}/personas/${yo.id}`, { token: admin })).status === 409, 'Lab01: no se elimina una persona con cuenta (409)');
comprobar((await http('DELETE', `${URL.auth}/personas/${nueva.datos.id}`, { token: admin })).status === 204, 'Lab01: DELETE elimina la persona (204)');
comprobar((await http('GET', `${URL.auth}/personas/${nueva.datos.id}`, { token: admin })).status === 404, 'Lab01: persona eliminada -> 404');

// Seguridad de acceso
comprobar((await http('GET', `${URL.inventory}/internal/reservations/${reserva.datos.id}`)).status === 403, 'V6: ruta interna sin token de servicio -> 403');
comprobar((await http('GET', `${URL.tickets}/me/tickets`, { token: `${ana.slice(0, -4)}AAAA` })).status === 401, 'V2: token alterado -> 401');
const correo = `bloqueo-${Date.now()}@prueba.ec`;
await http('POST', `${URL.auth}/register`, { body: { nombre: 'Bloqueo', correo, password: 'una-clave-larga-1' } });
let ultimo;
for (let i = 0; i < 3; i++) ultimo = await http('POST', `${URL.auth}/login`, { body: { correo, password: 'incorrecta' } });
const correcta = await http('POST', `${URL.auth}/login`, { body: { correo, password: 'una-clave-larga-1' } });
comprobar(ultimo.status === 423 && correcta.status === 423, 'RNF05: 3 intentos fallidos bloquean la cuenta, incluso con la clave correcta');

// RF16: comprobante por correo
const correos = await esperar('comprobante en Mailpit', async () => {
  const m = (await http('GET', `${URL.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${correoAna}`)}`)).datos;
  return m.messages_count > 0 && m;
});
comprobar(correos.messages_count === 1, `RF16/RNF14: un solo comprobante pese al webhook repetido (${correos.messages_count})`);

// CU15/CU16 · RN07: cancelar el evento reembolsa y anula sus tickets (y lo saca del catálogo de la demo)
comprobar((await http('POST', `${URL.catalog}/events/${evento.id}/cancel`, { token: org })).status === 200, 'CU15: el organizador cancela el evento');
const reembolsada = await esperar('orden reembolsada', async () => (await http('GET', `${URL.orders}/orders/${orden.datos.id}`, { token: ana })).datos.estado === 'REEMBOLSADA');
comprobar(reembolsada, 'RN07: la orden pagada pasa a REEMBOLSADA');
const anulados = await esperar('tickets anulados', async () => (await deLaOrden()).every((t) => t.estado !== 'VALIDO') && deLaOrden());
comprobar(anulados.length === 2, 'CU16: los tickets del evento cancelado quedan anulados');

terminar('Flujo');
