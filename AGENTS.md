# AGENTS.md

Guidance for agents working in this repository.

## Project

Minimal Express 5 API server backed by MongoDB, written in ES modules. This is a learning/assignment project: no tests, no build step, no linter.

- Entry point: `index.js` (Express app, middleware, routes, server start)
- Database layer: `src/config/db.js`
- Module system: ESM (`"type": "module"` in `package.json`)

## Commands

```bash
npm install        # install dependencies
node index.js      # start the server (no npm start script exists)
```

There is no working `npm test` (it is the default placeholder that exits 1). There is no dev watcher; restart manually after changes.

## Environment

`dotenv/config` is imported in `index.js`, so `.env` is loaded automatically. Required variables:

- `MONGODB_URI` — standard `mongodb://` connection string listing the three Atlas shard hosts explicitly, with `ssl=true`, `replicaSet=atlas-owomm0-shard-0`, `authSource=admin`, `retryWrites=true&w=majority`. The `mongodb+srv://` form is NOT used because it needs DNS SRV lookups, which fail on this machine (dead IPv6 placeholder DNS servers break Node's c-ares resolver). Password must be percent-encoded if it contains URI-special characters.
- `DB_NAME` — database to use (currently `assignment9`)
- `CLIENT_URL` — allowed CORS origin (e.g. the frontend dev URL)
- `PORT` — optional, defaults to `5000`

`.env` is gitignored. Never commit credentials, and never inline them into source or docs.

## Structure

- `index.js`
  - Creates the Express app and registers `express.json()` and `cors()` middleware; CORS origin comes from `CLIENT_URL` (falls back to `*` when unset).
  - Top-level `await connectDB()` runs before `app.listen`, so Express never starts unless MongoDB is reachable; connection failures log the error and exit the process with code 1.
  - Routes are registered directly on `app`; the only route today is `GET /` returning `Hello World!`.
- `src/config/db.js`
  - `connectDB()` creates one shared `MongoClient` from `MONGODB_URI`, connects, pings `DB_NAME`, logs success, and returns the `Db` handle.
  - `getDB()` returns the connected `Db` handle for use in routes; it throws if called before `connectDB()` succeeds.

## Conventions

- Plain JavaScript, no TypeScript, no framework abstractions. Routes stay in `index.js`; database access goes through `src/config/db.js`.
- 2-space indentation; single quotes; semicolons.
- Add new endpoints on `app` alongside the existing route block, and read collections via `getDB()` from `src/config/db.js` rather than creating extra `MongoClient` instances.

## Gotchas

- Express 5: route handlers may be async and rejected promises are forwarded to the error handler, but this app has no error-handling middleware yet.
- `index.js` connects and starts listening at import time; importing it from anywhere else will also start the server.
- `DB_PASSWORD`/`DB_USER` in `.env` are kept only as the source for building `MONGODB_URI`; the app itself reads only `MONGODB_URI`.
- No authentication, validation, or rate limiting is implemented.
