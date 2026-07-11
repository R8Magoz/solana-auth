# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Solana is a Spanish-language expense & invoice tracker for small teams. See `README.md` for layout and stack.

Three separate `package.json` directories require `npm install`: root (Playwright tests) and `server/` (Express API).

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

### Starting the frontend (local dev)

`frontend/index.html` is the **sole source of truth** for the UI (single-file React, Babel in-browser). Cloudflare Pages publishes the `frontend/` folder directly — there is no Vite build step.

```bash
npx http-server ./frontend -p 4173 -c-1
```

For local API dev, set `window.__SOLANA_AUTH_URL__ = "http://localhost:3001"` in the browser console, or edit `frontend/index.html`. Update `CORS_ORIGIN` in `server/.env` to match the frontend origin (e.g. `http://localhost:4173`).

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

### Key gotchas

- SQLite is embedded via `better-sqlite3` — no external database server needed.
- External services (Resend email, Cloudinary, Anthropic AI) are all optional and degrade gracefully.
- `ALLOW_SEED=true` enables seed/bootstrap endpoints — never set in production.
- The Express server may serve static files from `public/` if present; production UI is **`frontend/`** on Cloudflare Pages.
- API routes are mounted without `/api` prefix: `/auth/*`, `/expenses/*`, `/departments/*`, `/admin/*`, `/reports/*`, `/ai/*`, `/settings/*`.
