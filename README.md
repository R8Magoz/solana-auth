# Solana — Gestión de Gastos

Expense & invoice tracker for small teams.

## Layout

```
solana/
├── frontend/          # SPA (Cloudflare Pages → publish this folder)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── icon-192.png
│   ├── icon-512.png
│   └── logo.png
├── server/            # API (Render → rootDir: server in render.yaml)
│   ├── server.js
│   ├── package.json
│   ├── seed.js
│   └── …routes, db, jobs
├── docs/
│   ├── DEPLOY.md                 # Sanitized deploy steps (no secrets)
│   └── POST_DEPLOY_CHECKLIST.md
├── render.yaml
├── README.md
└── solana-context.mdc            # Cursor rules (copy under .cursor/rules/ if needed)
```

## Stack

- **Frontend:** Single-file React SPA (`frontend/index.html`, Babel in-browser) on **Cloudflare Pages**
- **Backend:** Node.js + Express + SQLite on **Render** (`server/`)
- **Email:** Resend
- **Receipts:** Cloudinary (optional; otherwise local `data/receipts/` on the Render disk)

## Local development

```bash
cd server
npm install
node server.js
```

Serve `frontend/` with any static server. Set `window.__SOLANA_AUTH_URL__` in `frontend/index.html` to `http://localhost:3001` (default `PORT`) so the SPA talks to your local API.

## Deploy

- **Details:** [`docs/DEPLOY.md`](docs/DEPLOY.md)
- **After deploy:** [`docs/POST_DEPLOY_CHECKLIST.md`](docs/POST_DEPLOY_CHECKLIST.md)
- **API:** Render reads `render.yaml` (`rootDir: server`). Set secrets only in the Render dashboard.
- **Frontend:** Cloudflare Pages — **publish directory:** `frontend`
