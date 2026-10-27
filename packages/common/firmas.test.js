import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { firmarQr, verificarQr, firmaHmac, hmacValido } from './index.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const payload = { tid: 't-1', eid: 'e-1', tipo: 'General', iat: 1 };

describe('QR firmado (RN04, RNF07)', () => {
  it('acepta un QR firmado con la clave del servicio de tickets', () => {
    expect(verificarQr(firmarQr(payload, privateKey), publicKey)).toEqual(payload);
  });

  it('rechaza un QR con el contenido alterado', () => {
    const [, firma] = firmarQr(payload, privateKey).split('.');
    const alterado = Buffer.from(JSON.stringify({ ...payload, tipo: 'VIP' })).toString('base64url');
    expect(verificarQr(`${alterado}.${firma}`, publicKey)).toBeNull();
  });

  it('rechaza un QR firmado con otra clave', () => {
    const otra = crypto.generateKeyPairSync('ed25519').privateKey;
    expect(verificarQr(firmarQr(payload, otra), publicKey)).toBeNull();
  });

  it('rechaza texto que no es un QR', () => {
    expect(verificarQr('cualquier-cosa', publicKey)).toBeNull();
    expect(verificarQr('a.b.c', publicKey)).toBeNull();
  });
});

describe('firma del webhook de la pasarela (RNF14)', () => {
  it('valida solo la firma correcta del cuerpo exacto', () => {
    const cuerpo = '{"paymentId":"p1"}';
    expect(hmacValido('secreto', cuerpo, firmaHmac('secreto', cuerpo))).toBe(true);
    expect(hmacValido('secreto', cuerpo + ' ', firmaHmac('secreto', cuerpo))).toBe(false);
    expect(hmacValido('secreto', cuerpo, undefined)).toBe(false);
  });
});
