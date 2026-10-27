// payment-sim: pasarela de pagos SIMULADA (actor externo). La tarjeta se escribe aquí, nunca en la plataforma (RN09).
// shortcut: guarda sesiones y pagos en memoria (se pierden al reiniciar); cambiar por la pasarela real en modo de pruebas.
import crypto from 'node:crypto';
import { crearApp, firmaHmac, error, env, iniciar } from '@plataforma/common';

const API_KEY = env('PAYMENT_API_KEY');
const SECRETO_WEBHOOK = env('PAYMENT_WEBHOOK_SECRET');
const sesiones = new Map();
const pagos = new Map(); // ordenId -> último pago

// Tarjetas de prueba: el último bloque decide el resultado
const TARJETAS = {
  4242424242424242: { estado: 'APROBADO', avisos: 1 },
  4000000000000002: { estado: 'RECHAZADO', avisos: 1 },
  4000000000009995: { estado: 'APROBADO', avisos: 0 }, // no envía webhook: la plataforma debe consultar
  4000000000000259: { estado: 'APROBADO', avisos: 2 }, // envía el webhook dos veces (idempotencia)
};

const app = await crearApp('payment-sim', 'Pasarela de pagos simulada (actor externo)');
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, cuerpo, listo) => listo(null, Object.fromEntries(new URLSearchParams(cuerpo))));

const conApiKey = async (req) => {
  if (req.headers['x-api-key'] !== API_KEY) throw error(401, 'API key no válida');
};

app.post('/sessions', {
  preHandler: conApiKey,
  schema: { body: { type: 'object', required: ['ordenId', 'monto', 'returnUrl', 'webhookUrl'], properties: { ordenId: { type: 'string' }, monto: { type: 'number', minimum: 0 }, returnUrl: { type: 'string' }, webhookUrl: { type: 'string' } } } },
}, async (req) => {
  const sessionId = crypto.randomUUID();
  sesiones.set(sessionId, { ...req.body, creada: Date.now() });
  return { sessionId };
});

const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pagina = (cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pasarela de pagos (pruebas)</title><link rel="stylesheet" href="/pasarela/estilos.css"></head><body><main>${cuerpo}</main></body></html>`;

app.get('/estilos.css', async (req, reply) => {
  reply.type('text/css').send(`
body{margin:0;background:#F5F6F8;font-family:system-ui,sans-serif;color:#12151C}
main{max-width:420px;margin:0 auto;padding:32px 20px}
.marca{display:flex;align-items:center;gap:8px;font-weight:700;color:#4F5665;font-size:14px}
.aviso{background:#FFF4D6;border:1px solid #F5B82E;border-radius:12px;padding:10px 12px;font-size:14px;margin:16px 0}
h1{font-size:26px;margin:8px 0}
.monto{font-size:34px;font-weight:800;margin:4px 0 20px}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}
input{width:100%;box-sizing:border-box;height:48px;border:1px solid #C9CED6;border-radius:12px;padding:0 14px;font-size:17px;background:#fff}
.fila{display:grid;grid-template-columns:1fr 1fr;gap:10px}
button{margin-top:22px;width:100%;height:52px;border:0;border-radius:14px;background:#12151C;color:#fff;font-size:16px;font-weight:700}
ul{font-size:13px;color:#4F5665;padding-left:18px;line-height:1.6}
code{background:#fff;border:1px solid #E2E5EA;border-radius:6px;padding:1px 5px}`);
});

app.get('/checkout/:id', async (req, reply) => {
  const s = sesiones.get(req.params.id);
  if (!s) return reply.code(404).type('text/html').send(pagina('<h1>Sesión de pago no encontrada</h1>'));
  reply.type('text/html').send(pagina(`
    <div class="marca">PagoSeguro · entorno de pruebas</div>
    <div class="aviso">Pasarela <strong>simulada</strong>: no uses una tarjeta real.</div>
    <h1>Pagar orden</h1>
    <div class="monto">$${escapar(s.monto.toFixed(2))}</div>
    <form method="post" action="/pasarela/checkout/${escapar(req.params.id)}" autocomplete="off">
      <label for="tarjeta">Número de tarjeta</label>
      <input id="tarjeta" name="tarjeta" inputmode="numeric" value="4242 4242 4242 4242" required>
      <div class="fila">
        <div><label for="vence">Vence</label><input id="vence" name="vence" value="12/29" required></div>
        <div><label for="cvc">CVC</label><input id="cvc" name="cvc" inputmode="numeric" value="123" required></div>
      </div>
      <button type="submit">Pagar $${escapar(s.monto.toFixed(2))}</button>
    </form>
    <ul>
      <li><code>4242 4242 4242 4242</code> aprueba</li>
      <li><code>4000 0000 0000 0002</code> rechaza</li>
      <li><code>4000 0000 0000 9995</code> aprueba sin aviso (la plataforma consulta)</li>
      <li><code>4000 0000 0000 0259</code> aprueba y envía el aviso dos veces</li>
    </ul>`));
});

async function avisar(s, pago) {
  const cuerpo = JSON.stringify({ paymentId: pago.paymentId, ordenId: s.ordenId, estado: pago.estado, monto: s.monto });
  const r = await fetch(s.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-firma': firmaHmac(SECRETO_WEBHOOK, cuerpo) }, body: cuerpo, signal: AbortSignal.timeout(8000) });
  app.log.info({ ordenId: s.ordenId, status: r.status }, 'webhook enviado');
}

app.post('/checkout/:id', async (req, reply) => {
  const s = sesiones.get(req.params.id);
  if (!s) return reply.code(404).type('text/html').send(pagina('<h1>Sesión de pago no encontrada</h1>'));
  const numero = String(req.body?.tarjeta ?? '').replace(/\D/g, '');
  const regla = TARJETAS[numero] ?? { estado: 'RECHAZADO', avisos: 1 };
  const pago = { paymentId: `pay_${crypto.randomBytes(8).toString('hex')}`, estado: regla.estado, monto: s.monto };
  pagos.set(s.ordenId, pago);
  sesiones.delete(req.params.id);
  for (let i = 0; i < regla.avisos; i++) await avisar(s, pago).catch((e) => app.log.warn({ err: e }, 'webhook sin respuesta'));
  reply.redirect(s.returnUrl, 303);
});

app.get('/payments', { preHandler: conApiKey, schema: { querystring: { type: 'object', required: ['ordenId'], properties: { ordenId: { type: 'string' } } } } }, async (req) => pagos.get(req.query.ordenId) ?? {});

app.post('/refunds', {
  preHandler: conApiKey,
  schema: { body: { type: 'object', required: ['paymentId', 'monto'], properties: { paymentId: { type: 'string' }, monto: { type: 'number' }, idempotencyKey: { type: 'string' } } } },
}, async (req) => {
  app.log.info({ paymentId: req.body.paymentId, monto: req.body.monto }, 'reembolso simulado');
  return { refundId: `re_${crypto.createHash('sha256').update(req.body.idempotencyKey ?? req.body.paymentId).digest('hex').slice(0, 16)}`, estado: 'REEMBOLSADO' };
});

await iniciar(app);
