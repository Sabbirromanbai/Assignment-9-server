import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { getDB, getMongoClient } from './db.js';

const ALLOWED_SIGNUP_ROLES = ['customer', 'vendor'];

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

  return betterAuth({
    // MongoDB adapter reusing the existing shared client
    database: mongodbAdapter(db, { client }),

    // Trust only the configured frontend origin (never a wildcard);
    // if CLIENT_URL is unset, Better Auth falls back to trusting baseURL only
    trustedOrigins: [process.env.CLIENT_URL].filter(Boolean),

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

    // JWT plugin
    plugins: [jwt()],

    hooks: {
      before: createAuthMiddleware((ctx) => {
        // 2 & 4: role selectable at signup as customer/vendor only — never admin
        if (ctx.path.startsWith('/sign-up')) {
          const role = ctx.body?.role;
          if (role && !ALLOWED_SIGNUP_ROLES.includes(role)) {
            throw new APIError('BAD_REQUEST', {
              message: 'Role must be "customer" or "vendor"',
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
