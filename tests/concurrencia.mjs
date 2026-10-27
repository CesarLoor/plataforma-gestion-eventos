// RNF03 / OE1: 200 usuarios reservan a la vez 1 entrada de un tipo con cupo 50 -> exactamente 50 reservas, cero sobreventa
import crypto from 'node:crypto';
import { URL, http, login, tokenDePrueba, crearEvento, comprobar, terminar } from './util.mjs';

const USUARIOS = 200;
const CUPO = 50;

console.log(`\nPrueba de concurrencia: ${USUARIOS} usuarios contra un cupo de ${CUPO}`);
const org = await login('organizador@eventos.ec');
const evento = await crearEvento(org, [{ nombre: 'General', precio: 5, cupo: CUPO }]);
const tipo = evento.tipos[0];
const tokens = Array.from({ length: USUARIOS }, () => tokenDePrueba(crypto.randomUUID()));

// Calentamiento: abre las 200 conexiones HTTP y las del pool de Postgres antes de medir, para que el p95
// refleje la reserva y no los handshakes TCP y SCRAM de un servicio recién arrancado
await Promise.all(tokens.map(() => fetch(`${URL.inventory}/availability/${evento.id}`).then((r) => r.text())));

const inicio = Date.now();
const respuestas = await Promise.all(tokens.map(async (token) => {
  const t0 = performance.now();
  const r = await http('POST', `${URL.inventory}/reservations`, { token, body: { eventoId: evento.id, items: [{ tipoEntradaId: tipo.id, cantidad: 1 }] } });
  return { status: r.status, ms: performance.now() - t0 };
}));
const duracion = Date.now() - inicio;

const cuenta = (s) => respuestas.filter((r) => r.status === s).length;
const tiempos = respuestas.map((r) => r.ms).sort((a, b) => a - b);
const p95 = tiempos[Math.floor(tiempos.length * 0.95)];
const disponible = (await http('GET', `${URL.inventory}/availability/${evento.id}`)).datos[0].disponible;

console.log(`  ${USUARIOS} solicitudes en ${duracion} ms · p95 ${p95.toFixed(0)} ms · 201=${cuenta(201)} 409=${cuenta(409)} otros=${USUARIOS - cuenta(201) - cuenta(409)}`);
comprobar(cuenta(201) === CUPO, `exactamente ${CUPO} reservas confirmadas (hubo ${cuenta(201)})`);
comprobar(cuenta(409) === USUARIOS - CUPO, `${USUARIOS - CUPO} rechazadas por falta de cupo (hubo ${cuenta(409)})`);
comprobar(disponible === 0, `cupos disponibles al final = 0 (quedó ${disponible}), sin sobreventa`);
comprobar(respuestas.every((r) => r.status < 500), 'ningún error 5xx (RNF02)');
comprobar(p95 < 500, `p95 menor a 500 ms (RNF01): ${p95.toFixed(0)} ms`);
await http('POST', `${URL.catalog}/events/${evento.id}/cancel`, { token: org }); // fuera del catálogo de la demo
terminar('Concurrencia');
