import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

// Reused across requests: jose caches the JWKS and refreshes on unknown kid
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`)
);

const ISSUER = process.env.BETTER_AUTH_URL;
const AUDIENCE = process.env.BETTER_AUTH_URL;

/**
 * Bearer-JWT authentication middleware (Better Auth JWT plugin).
 * - 401: missing/invalid/expired token, invalid sub, or user not found
 * - 403: user blocked in the database
 * Attaches fresh DB user to req.user and verified JWT payload to req.jwtPayload.
 */
export async function authenticate(req, res, next) {
  try {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    let user;
    try {
      user = await getDB().collection('user').findOne(
        { _id: new ObjectId(payload.sub) },
        {
          projection: {
            role: 1,
            isBlocked: 1,
            businessName: 1,
            subscriptionPlan: 1,
            subscriptionExpiresAt: 1,
            name: 1,
            email: 1,
          },
        }
      );
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
    next();
  } catch {
    // covers expired/invalid signature/issuer-audience mismatch from jwtVerify
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

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
