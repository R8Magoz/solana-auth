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

## 5. Off-disk database backups

The API keeps **two** backup layers:

| Layer | Schedule | Location | Purpose |
|-------|----------|----------|---------|
| On-disk | Startup + every 6 h | `DATA_DIR/backups/` (Render persistent disk) | Fast local restore via admin UI |
| Off-disk | Startup + every 24 h | **Cloudinary** (`CLOUDINARY_BACKUPS_FOLDER`, default `solana-db-backups`) | Survives Render disk loss |

Off-disk backups use the **better-sqlite3 `.backup()`** API (safe with an open DB), upload as **raw** files to Cloudinary, and retain the **7 most recent** copies (older ones are pruned automatically).

### Required env vars (off-disk)

Same as receipts — all three must be set in Render:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Optional:

- `CLOUDINARY_BACKUPS_FOLDER` — Cloudinary folder prefix (default `solana-db-backups`)

If Cloudinary is **not** configured, off-disk backups are **skipped** with a console warning; the server continues normally. On-disk backups still run.

Audit events: `db_backup_succeeded` / `db_backup_failed` (with size and timestamp).

### Restore from an off-disk backup

1. In the [Cloudinary Media Library](https://cloudinary.com/console), open folder **`solana-db-backups`** (or your `CLOUDINARY_BACKUPS_FOLDER`).
2. Download the desired `solana-YYYY-MM-DD-HHmm.db` file.
3. Stop the Render service (or scale to zero) so nothing holds the live DB open.
4. Replace the live database:
   - Via admin API: `POST /admin/backups/restore` with a file already placed under `DATA_DIR/backups/` (copy the download there first), **or**
   - Manually: copy the downloaded file over `DATA_DIR/solana.db` on the Render shell/disk, remove `solana.db-wal` and `solana.db-shm` if present.
5. Restart the service and verify `GET /health`.

For routine restore from **on-disk** copies (same Render disk), use **Ajustes → Copias de seguridad** or `GET /admin/backups` / `POST /admin/backup`.
