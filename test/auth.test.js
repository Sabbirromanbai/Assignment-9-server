import test from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';

const ISSUER = 'https://assignment-9-server-b934.onrender.com';
process.env.BETTER_AUTH_URL = ISSUER;
const { createAuthenticate, verifyRole } = await import('../src/middlewares/auth.js');
const USER_ID = '507f1f77bcf86cd799439011';
const NOW = Math.floor(Date.now() / 1000);

const { publicKey, privateKey } = await generateKeyPair('EdDSA');
const jwk = await exportJWK(publicKey);
jwk.kid = 'test-key';
jwk.alg = 'EdDSA';
jwk.use = 'sig';
const JWKS = createLocalJWKSet({ keys: [jwk] });

async function issueToken({ role = 'vendor', blocked = false, expiresAt = NOW + 60, key = privateKey } = {}) {
  return new SignJWT({ role, isBlocked: blocked })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
    .setSubject(USER_ID)
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt(NOW)
    .setExpirationTime(expiresAt)
    .sign(key);
}

async function request(token, user = { _id: USER_ID, role: 'vendor', isBlocked: false }) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const result = { status: 200, body: null };
  const res = {
    status(status) { result.status = status; return this; },
    json(body) { result.body = body; return this; },
  };
  const authenticate = createAuthenticate({
    jwks: JWKS,
    issuer: ISSUER,
    audience: ISSUER,
    findUser: async () => user,
  });
  await authenticate(req, res, () => {
    verifyRole('vendor')(req, res, () => { result.status = 200; });
  });
  return result;
}

test('valid vendor JWT reaches the vendor dashboard handler', async () => {
  assert.equal((await request(await issueToken())).status, 200);
});

test('missing JWT is rejected with 401', async () => {
  assert.equal((await request()).status, 401);
});

test('invalid JWT is rejected with 401', async () => {
  assert.equal((await request('not.a.jwt')).status, 401);
});

test('expired JWT is rejected with 401', async () => {
  assert.equal((await request(await issueToken({ expiresAt: NOW - 1 }))).status, 401);
});

test('customer JWT is rejected with 403', async () => {
  assert.equal((await request(await issueToken({ role: 'customer' }), {
    _id: USER_ID, role: 'customer', isBlocked: false,
  })).status, 403);
});

test('blocked vendor is rejected with 403', async () => {
  const result = await request(await issueToken(), { _id: USER_ID, role: 'vendor', isBlocked: true });
  assert.equal(result.status, 403);
  assert.equal(result.body.message, 'Account is blocked');
});
