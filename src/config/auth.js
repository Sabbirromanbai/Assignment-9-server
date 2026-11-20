import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { getDB, getMongoClient } from './db.js';

const ALLOWED_SIGNUP_ROLES = ['customer', 'vendor'];

/**
 * Proxies that write `X-Forwarded-For` on Render.
 *
 * Public traffic reaches a Render web service as:
 *   client -> Cloudflare (Render's DDoS/edge layer) -> Render load balancer -> app
 *
 * The client cannot control the right-hand entries: each proxy appends the
 * address it received the request from, so the header arrives as
 * "<client>, <cloudflare-edge>" (plus an internal hop in some topologies).
 * The leftmost entry is whatever the caller sent, so it is never used.
 *
 * Better Auth walks the header right to left and stops at the first entry that
 * is not listed here. Only ranges that cannot be a real client address are
 * listed: Cloudflare's published edge ranges (https://www.cloudflare.com/ips)
 * and private/loopback space used by Render's internal load balancer.
 */
const TRUSTED_PROXIES = [
  // Cloudflare edge, IPv4
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  // Cloudflare edge, IPv6
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
  // Render internal load balancer / loopback
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '::1/128',
];

/**
 * Creates the Better Auth instance. Must be called only after
 * connectDB() has succeeded — getDB()/getMongoClient() throw otherwise.
 */
export function createAuth() {
  const db = getDB(); // throws if MongoDB is not connected yet
  const client = getMongoClient(); // shared client, enables transactions

  const socialProviders = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;

  return betterAuth({
    // Explicit secret and base URL. BETTER_AUTH_SECRET must be provided in .env.
    secret,
    baseURL,

    // MongoDB adapter reusing the existing shared client
    database: mongodbAdapter(db, { client }),

    // Trust only the configured frontend origin (never a wildcard);
    // if CLIENT_URL is unset, Better Auth falls back to trusting baseURL only
    trustedOrigins: [process.env.CLIENT_URL, baseURL].filter(Boolean),

    // Email & password with assignment minimum length
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
    },

    // Google OAuth (enabled when credentials are present in .env)
    socialProviders,

    // Extra user fields; `input: false` makes a field fully server-controlled:
    // Better Auth rejects any client attempt to set it ("X is not allowed to be set")
    user: {
      additionalFields: {
        // Client-selectable at SIGNUP ONLY (validated in the hook below)
        role: { type: 'string', defaultValue: 'customer' },
        isBlocked: { type: 'boolean', defaultValue: false, input: false },
        businessName: { type: 'string', required: false, input: false },
        subscriptionPlan: { type: 'string', defaultValue: 'free', input: false },
        subscriptionExpiresAt: { type: 'date', required: false, input: false },
      },
    },

    // JWT plugin with issuer and audience pinned to the backend URL.
    // In Better Auth 1.7.x these options are nested under `jwt`; top-level
    // issuer/audience values are ignored by the plugin.
    plugins: [jwt({ jwt: { issuer: baseURL, audience: baseURL } })],

    // Secure cookies in production; keep local development usable over HTTP.
    advanced: {
      database: { joins: true },
      // Resolve the real client IP behind Render's proxy chain. Without this,
      // a multi-hop X-Forwarded-For yields no address and every client shares
      // one rate-limit bucket (Better Auth logs a warning once).
      ipAddress: {
        // Render forwards the client address in X-Forwarded-For.
        ipAddressHeaders: ['x-forwarded-for'],
        // Skip the proxy-written hops (right to left) so a spoofed leftmost
        // value supplied by the caller is never treated as the client IP.
        trustedProxies: TRUSTED_PROXIES,
      },
      useSecureCookies: process.env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    },

    hooks: {
      before: createAuthMiddleware((ctx) => {
        // 2 & 4: role selectable at signup as customer/vendor only — never admin
        if (ctx.path.startsWith('/sign-up')) {
          const role = ctx.body?.role;
          if (role !== undefined && !ALLOWED_SIGNUP_ROLES.includes(role)) {
            throw new APIError('BAD_REQUEST', {
              message: 'Role must be "customer" or "vendor"',
            });
          }

          if (
            ctx.path === '/sign-up/email'
            && (typeof ctx.body?.password !== 'string'
              || !/[A-Z]/.test(ctx.body.password)
              || !/[a-z]/.test(ctx.body.password))
          ) {
            throw new APIError('BAD_REQUEST', {
              message: 'Password must include at least one uppercase and one lowercase letter',
            });
          }
        }

        // 3: reject role changes through profile update APIs
        if (ctx.path === '/update-user' && 'role' in (ctx.body ?? {})) {
          throw new APIError('BAD_REQUEST', {
            message: 'Role cannot be changed after signup',
          });
        }
      }),
    },
  });
}
