// Genera .env a partir de .env.example con contraseñas y claves aleatorias.
// Uso: node scripts/generar-env.mjs [--domain 34-230-232-119.sslip.io] [--force]
import crypto from 'node:crypto';
import fs from 'node:fs';

const args = process.argv.slice(2);
const dominio = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : 'localhost';
if (fs.existsSync('.env') && !args.includes('--force')) {
  console.error('.env ya existe. Usa --force para reemplazarlo (se pierden las claves actuales).');
  process.exit(1);
}

const aleatorio = () => crypto.randomBytes(24).toString('base64url');
const b64 = (texto) => Buffer.from(texto).toString('base64');
const parEd25519 = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return [b64(privateKey.export({ type: 'pkcs8', format: 'pem' })), b64(publicKey.export({ type: 'spki', format: 'pem' }))];
};
const [authPriv, authPub] = parEd25519();
const [ticketsPriv, ticketsPub] = parEd25519();
const fijos = {
  DOMAIN: dominio,
  PUBLIC_URL: `https://${dominio}`,
  AUTH_PRIVATE_KEY: authPriv,
  AUTH_PUBLIC_KEY: authPub,
  TICKETS_PRIVATE_KEY: ticketsPriv,
  TICKETS_PUBLIC_KEY: ticketsPub,
  SEED_PASSWORD: `Demo-${crypto.randomBytes(4).toString('hex')}`,
};

const salida = fs.readFileSync('.env.example', 'utf8').split(/\r?\n/).map((linea) => {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) return linea;
  const [, clave, valor] = m;
  return `${clave}=${fijos[clave] ?? (valor || aleatorio())}`;
});
fs.writeFileSync('.env', salida.join('\n'), { mode: 0o600 });
console.log(`.env creado para ${dominio}. Contraseña de los usuarios semilla: ${fijos.SEED_PASSWORD}`);
