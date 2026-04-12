# Solana — deployment (no secrets in this file)

**Never commit** API keys, `ADMIN_KEY`, `TOKEN_SECRET`, `BOOTSTRAP_SECRET`, or passwords. Set them only in **Render** (and Resend) dashboards.

## Repository layout

```
solana/
├── frontend/     ← Cloudflare Pages publish root (static SPA)
├── server/       ← Render web service (`render.yaml` → rootDir: server)
├── docs/         ← This guide + post-deploy checklist
├── render.yaml
└── README.md
```

## 1. Backend (Render)

1. Connect the Git repo to **Render** → New **Web Service**.
2. Render reads **`render.yaml`**: build runs in **`server/`** (`npm install`, `node server.js`).
3. Add environment variables in the Render UI (examples — use your own values):
   - `RESEND_API_KEY`, `FROM_EMAIL`, `ADMIN_EMAIL`
   - `ADMIN_KEY`, `TOKEN_SECRET`
   - `APP_URL`, `CORS_ORIGIN` (your **Cloudflare Pages** site URL)
   - Optional receipts: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
   - `DATA_DIR` is set in `render.yaml` for the persistent disk
4. **Bootstrap** (only if your process uses seed/bootstrap): enable `ALLOW_SEED`, `BOOTSTRAP_SECRET`, etc., run the documented bootstrap request, then **remove** bootstrap vars from production.

Health check: `GET https://<your-service>.onrender.com/health`

## 2. Frontend (Cloudflare Pages)

1. New project → connect the same repo.
2. **Build command:** none (or leave default) if you only publish static files.
3. **Publish directory:** `frontend`
4. Set `window.__SOLANA_AUTH_URL__` in `frontend/index.html` to your **Render** API origin (or use Cloudflare environment / inject at build if you add a build step later).

## 3. Email (Resend)

Create an API key at [resend.com](https://resend.com). Use a verified `FROM_EMAIL` (your domain or Resend’s onboarding domain per their docs).

## 4. After deploy

Run through **`docs/POST_DEPLOY_CHECKLIST.md`**.

## Local API

From `server/`:

```bash
npm install
node server.js
```

Default port **3001** unless `PORT` is set. Point the SPA at `http://localhost:3001` for `AUTH_URL` while developing.
