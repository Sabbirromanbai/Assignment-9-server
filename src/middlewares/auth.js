import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

// Reused across requests: jose caches the JWKS and refreshes on unknown kid
const JWKS_URL = new URL('/api/auth/jwks', process.env.BETTER_AUTH_URL);
const AUTH_DIAGNOSTICS = process.env.AUTH_JWT_DIAGNOSTICS === 'true';
const JWKS = createRemoteJWKSet(JWKS_URL);

const ISSUER = process.env.BETTER_AUTH_URL;
const AUDIENCE = process.env.BETTER_AUTH_URL;

/**
 * Bearer-JWT authentication middleware (Better Auth JWT plugin).
 * - 401: missing/invalid/expired token, invalid sub, or user not found
 * - 403: user blocked in the database
 * Attaches fresh DB user to req.user and verified JWT payload to req.jwtPayload.
 */
export function createAuthenticate({
  jwks = JWKS,
  issuer = ISSUER,
  audience = AUDIENCE,
  findUser = (id) => getDB().collection('user').findOne(
    { _id: new ObjectId(id) },
    { projection: {
      role: 1,
      isBlocked: 1,
      businessName: 1,
      subscriptionPlan: 1,
      subscriptionExpiresAt: 1,
      name: 1,
      email: 1,
    } }
  ),
  diagnostics = AUTH_DIAGNOSTICS,
} = {}) {
  return async function authenticateRequest(req, res, next) {
    const header = req.headers.authorization;
    const token = (header ?? '').replace(/^Bearer\s+/i, '');
    if (!token) {
      if (diagnostics) {
        console.warn('[auth-jwt] request rejected', {
          reason: 'missing_bearer_token',
          authorizationHeaderPresent: Boolean(header),
          expectedIssuer: issuer,
          expectedAudience: audience,
        });
      }
      return res.status(401).json({ message: 'No token provided' });
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer, audience }));
    } catch (err) {
      if (diagnostics) {
        let actualClaims = {};
        try {
          const { iss, aud, exp } = decodeJwt(token);
          actualClaims = { issuer: iss ?? null, audience: aud ?? null, expiresAt: exp ?? null };
        } catch {
          actualClaims = { malformedJwt: true };
        }

        console.warn('[auth-jwt] verification failed', {
          authorizationHeaderPresent: Boolean(header),
          expectedIssuer: issuer,
          expectedAudience: audience,
          actualClaims,
          errorName: typeof err?.name === 'string' ? err.name.slice(0, 80) : 'UnknownError',
          errorCode: typeof err?.code === 'string' ? err.code.slice(0, 80) : null,
          errorMessage: typeof err?.message === 'string'
            ? err.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 240)
            : 'Unknown verification error',
          jwksUrl: JWKS_URL.origin + JWKS_URL.pathname,
          jwksLoaded: Boolean(jwks.jwks?.()),
        });
      }
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    let user;
    try {
      user = await findUser(payload.sub);
    } catch {
      // invalid ObjectId in sub (wrong length/format)
      return res.status(401).json({ message: 'Invalid token subject' });
    }

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account is blocked' });
    }

    req.user = user;
    req.jwtPayload = payload;
    return next();
  };
}

export const authenticate = createAuthenticate();

/**
 * Role-based authorization middleware. Must run after authenticate().
 * Usage: app.get('/x', authenticate, verifyRole('vendor', 'admin'), handler)
 */
export function verifyRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}
