# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Solana is a Spanish-language expense & invoice tracker for small teams. See `README.md` for layout and stack.

Three separate `package.json` directories require `npm install`: root (Playwright tests), `server/` (Express API), `client/` (Vite React SPA).

### Starting the backend

```bash
cd server
node --env-file=.env server.js
```

`TOKEN_SECRET` is **mandatory** — the server exits immediately without it. Copy `server/.env.example` to `server/.env` and generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The server does **not** use `dotenv`; you must pass `--env-file=.env` (Node 20+) or export vars manually.

### Starting the Vite dev client

```bash
cd client
cp .env.example .env   # sets VITE_AUTH_URL=http://localhost:3001
npm run dev             # port 5173, proxies /api to localhost:3001
```

**Known issue:** The Vite client (`client/`) has a pre-existing runtime error ("Cannot access 'go' before initialization" in `AppBody.jsx`) that prevents the app from loading in the browser. The legacy frontend (`frontend/index.html`) works as a fallback.

### Legacy frontend

Serve `frontend/` with any static server (e.g. `npx http-server ./frontend -p 4173 -c-1`). By default it points at the production API (`https://solana-auth.onrender.com`). For local dev, set `window.__SOLANA_AUTH_URL__ = "http://localhost:3001"` in the browser console, or temporarily edit line 46 of `frontend/index.html`. Also update `CORS_ORIGIN` in `server/.env` to match the frontend's origin (e.g. `http://localhost:4173`).

### Seeding the database

```bash
cd server
ALLOW_SEED=true SEED_ADMIN_EMAIL=admin@solana-dev.local SEED_ADMIN_PASSWORD=AdminPass123! node seed.js
```

This creates a superadmin and test user accounts. See `server/seed.js` for all env vars.

### Running E2E tests

```bash
npm install              # root package.json
npx playwright install chromium
npx playwright install-deps chromium
npm run test:e2e
```

Tests mock the API — no backend required. **Note:** There is a pre-existing syntax error in `tests/e2e/critical-flows.spec.ts` line 906 (extra closing parenthesis) that prevents tests from running.

### Lint

No ESLint or linter is configured in this codebase.

### Build

```bash
cd client && npm run build   # outputs to ../public/
```

### Key gotchas

- SQLite is embedded via `better-sqlite3` — no external database server needed.
- External services (Resend email, Cloudinary, Anthropic AI) are all optional and degrade gracefully.
- `ALLOW_SEED=true` enables seed/bootstrap endpoints — never set in production.
- The Express server serves static files from `public/` (the Vite build output) in addition to the API routes.
- API routes are mounted without `/api` prefix: `/auth/*`, `/expenses/*`, `/departments/*`, `/admin/*`, `/reports/*`, `/ai/*`, `/settings/*`.
