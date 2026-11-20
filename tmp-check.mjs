import { createRemoteJWKSet, jwtVerify } from 'jose';

const base = process.argv[2] ?? 'http://localhost:5000';
const email = 'vendor-test@example.com';
const password = 'Passw0rd';

const signin = await fetch(`${base}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
  body: JSON.stringify({ email, password }),
});
if (!signin.ok) console.log('signin body:', await signin.text());
const cookie = signin.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ')
  ?? signin.headers.get('set-cookie')?.split(';')[0];
console.log('signin', signin.status, 'cookie?', Boolean(cookie));

const tokRes = await fetch(`${base}/api/auth/token`, { headers: { cookie } });
const { token } = await tokRes.json();
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
console.log('iss/aud:', payload.iss, '|', payload.aud);

const raw = `${base}/`;
const jwksRaw = `${raw}/api/auth/jwks`;
console.log('raw env:', raw, '-> jwks url:', jwksRaw);
const r = await fetch(jwksRaw);
console.log('jwks fetch:', r.status);

const set = createRemoteJWKSet(new URL(jwksRaw));
for (const iss of [raw, base]) {
  try {
    const { payload: p } = await jwtVerify(token, set, { issuer: iss, audience: iss });
    console.log(`issuer ${JSON.stringify(iss)} -> OK sub=${p.sub}`);
  } catch (e) {
    console.log(`issuer ${JSON.stringify(iss)} -> FAIL ${e.code ?? e.message}`);
  }
}
