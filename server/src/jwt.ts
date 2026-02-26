import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
const kid = 'calixte-ed25519-1';

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function signToken(payload: Record<string, unknown>): string {
  const header = { alg: 'EdDSA', typ: 'JWT', kid };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(null, Buffer.from(data), privateKey);
  return `${data}.${b64url(signature)}`;
}

export function getJwks() {
  return {
    keys: [
      {
        ...publicJwk,
        kid,
        use: 'sig',
        alg: 'EdDSA'
      }
    ]
  };
}

export function publicKeyFromJwk(jwk: JsonWebKey) {
  return createPublicKey({ key: jwk, format: 'jwk' });
}
