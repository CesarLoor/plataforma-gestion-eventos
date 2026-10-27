// notifications: correos de bienvenida, comprobante y reembolso (RF16, RF24). En el prototipo llegan a Mailpit.
// Es un servicio secundario: si cae, la compra sigue (RNF04) y los correos salen al volver.
import nodemailer from 'nodemailer';
import { crearApp, crearDb, crearBus, migrar, env, iniciar } from '@plataforma/common';

const PUBLIC_URL = env('PUBLIC_URL');
const correo = nodemailer.createTransport({ host: env('SMTP_HOST', 'mailpit'), port: Number(env('SMTP_PORT', 1025)), secure: false });
const db = crearDb();
await migrar(db, '');

const app = await crearApp('notifications', 'Correos de confirmación y avisos');
const bus = await crearBus('notifications', db, app.log);

const dinero = (n) => `$${Number(n).toFixed(2)}`;
const enviar = (para, asunto, texto) => correo.sendMail({ from: '"Aforo" <no-responder@aforo.ec>', to: para, subject: asunto, text: texto });

await bus.suscribir(['usuario.registrado', 'orden.pagada', 'orden.reembolsada'], async ({ tipo, datos }) => {
  if (tipo === 'usuario.registrado') {
    await enviar(datos.correo, 'Bienvenida a Aforo', `Hola ${datos.nombre}, tu cuenta está lista.\n\n${PUBLIC_URL}`);
  } else if (tipo === 'orden.pagada') {
    const lineas = datos.items.map((i) => `  ${i.cantidad} × ${i.nombre} (${dinero(i.precio)})`).join('\n');
    await enviar(datos.correo, `Comprobante: ${datos.evento.titulo}`,
      `Hola ${datos.nombre}, tu pago fue aprobado.\n\n${datos.evento.titulo}\n${new Date(datos.evento.fecha).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })} · ${datos.evento.lugar}, ${datos.evento.ciudad}\n\n${lineas}\nTotal pagado: ${dinero(datos.total)}\nOrden: ${datos.ordenId}\n\nTus tickets con QR están en ${PUBLIC_URL}/#/tickets y también funcionan sin conexión.`);
  } else {
    await enviar(datos.correo, 'Reembolso de tu compra', `Hola ${datos.nombre}, registramos un reembolso de ${dinero(datos.monto)}.\nMotivo: ${datos.motivo}\nOrden: ${datos.ordenId}\n\nTus tickets de esa orden quedaron anulados.`);
  }
  app.log.info({ tipo }, 'correo enviado');
});

await iniciar(app, bus.cerrar);
