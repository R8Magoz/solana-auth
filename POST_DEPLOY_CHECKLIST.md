# Post-deploy testing checklist — Solana

Run after every phase deployment. Record **date**, **environment** (staging/prod), and **tester**.

**Base URL** — set `BASE` to your API origin (no trailing slash), e.g. `export BASE=https://your-api.onrender.com`.

**Auth legend**

| Mechanism | Use |
|-----------|-----|
| **Admin key** | Header `X-Admin-Key: <ADMIN_KEY>` (env on server). |
| **User session** | Header `Authorization: Bearer <sessionToken>` from `POST /auth/login`. |
| **Admin session** | Same Bearer token when user role is `admin` or `superadmin`. Some routes also accept **Admin key** instead of Bearer (`requireAdminSession`). |

---

## Auth

- [ ] **GET** `/health` → `200`, JSON with `ok: true`, SQLite reachable; may include `ts`, `disk`, `receiptsDir`. If DB fails → `503`, `ok: false`.
- [ ] **POST** `/auth/signup` (new email, valid password ≥8 chars, not common list) → `200`, `{ ok: true }`; **admin notification** email to `ADMIN_EMAIL` (or `[EMAIL-STUB]` in logs if `RESEND_API_KEY` unset).
- [ ] **POST** `/auth/signup` (duplicate email) → still `200` with generic message (no account enumeration).
- [ ] **POST** `/auth/login` (valid active user) → `200`, `user` + `sessionToken`.
- [ ] **POST** `/auth/login` (wrong password) → `401`.
- [ ] **POST** `/auth/login` (pending user) → `403`, body includes `code: "PENDING_APPROVAL"`.
- [ ] **POST** `/auth/login` (denied user) → `403`, body includes `code: "ACCESS_DENIED"`.
- [ ] **POST** `/auth/change-password` (**Bearer** same user) body `{ "userId": "<id>", "newPassword": "<strong>" }` → `200`, password updated; next login works.
- [ ] **POST** `/auth/forgot-password` body `{ "email": "<ADMIN_EMAIL>" }` → `200`; temp password path (email stub or Resend to admin).
- [ ] **POST** `/auth/forgot-password` body `{ "email": "<non-admin email>" }` → `200`; **admin notification** only (requesting user gets generic success, no leak).
- [ ] **POST** `/auth/refresh` (valid Bearer) → `200`, new `sessionToken`.
- [ ] **POST** `/auth/refresh` (expired token **within** grace — 30 min after `exp`) → `200`, new `sessionToken`.
- [ ] **POST** `/auth/refresh` (beyond grace / invalid token) → `401`.
- [ ] **POST** `/auth/logout` (Bearer optional) → `200`, `{ ok: true }`.
- [ ] **GET** `/auth/verify` (legacy link) → `410` HTML “enlace no válido”.

---

## User management

- [ ] **GET** `/admin/users/pending` (**X-Admin-Key**) → `200`, `{ users: [...] }`.
- [ ] **GET** `/admin/users/all` (**X-Admin-Key**) → `200`, `{ users: [...] }`.
- [ ] **POST** `/admin/users/create` (**X-Admin-Key** *or* **Bearer** admin/superadmin) body `{ "name", "email", "tempPassword", ... }` → `200`, new active user (`mustChangePassword` true).
- [ ] **POST** `/admin/users/:id/approve` (**X-Admin-Key**) → user `active`, access-granted email (or stub).
- [ ] **POST** `/admin/users/:id/deny` (**X-Admin-Key**) → user `denied`, denial email (or stub).

---

## Expenses

Use **Bearer** of a normal user unless noted.

- [ ] **POST** `/expenses` → expense created; `userId` matches caller.
- [ ] **GET** `/expenses` (regular user) → only own rows.
- [ ] **GET** `/expenses` (admin user or query as admin) → broader access per `listExpenses` rules (admin sees all / filter by `userId`).
- [ ] **PUT** `/expenses/:id` (owner, `draft`/`submitted`/`rejected`) → updated.
- [ ] **PUT** `/expenses/:id` (non-owner, non-admin) → `403`.
- [ ] **PUT** `/expenses/:id` (`approved`, non-admin) → `403`.
- [ ] **DELETE** `/expenses/:id` (owner, `draft`/`submitted`/`rejected`) → deleted / soft-deleted per implementation.
- [ ] **POST** `/expenses/:id/approve` (**admin session**: Bearer admin *or* **X-Admin-Key** per `requireAdminSession`) → `approved`.
- [ ] **POST** `/expenses/:id/reject` (same admin auth) → `rejected`.
- [ ] **POST** `/expenses/:id/receipt` (JSON `b64`, `mediaType` jpeg/png/webp) → `200`, `receiptPath` set.
- [ ] **GET** `/expenses/:id/receipt` → image bytes, correct `Content-Type`.
- [ ] Non-EUR expense → `currency` + `amountEUR` persisted (`POST` body).

---

## Bills

- [ ] **POST** `/bills` → bill created, owned by caller.
- [ ] **GET** `/bills` → filtered by ownership (non-admin sees own).
- [ ] **PUT** `/bills/:id` → updated (authorized).
- [ ] **DELETE** `/bills/:id` → deleted.
- [ ] **POST** `/bills/:id/mark-paid` → `status = paid`, `paidAt` / `paidBy` set.
- [ ] **Recurring bill paid → next occurrence** — `runBillMaintenance` runs on **server start** and then on a **24-hour** interval. After marking a recurring bill paid, **restart the server** (or wait for the next run) and confirm a **new pending** bill row with the next `dueDate` and the old paid row `recurring` cleared per `billJobs.js`.

---

## Reports

Admin auth: **Bearer** (admin/superadmin) **or** **X-Admin-Key** (`requireAdminSession`).

- [ ] **GET** `/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` → aggregations JSON (`totalExpenses`, `byCategory`, …).
- [ ] **GET** `/reports/export/csv?from=...&to=...&type=expenses` (or `bills` / `all`) → `200`, CSV attachment, parseable.

---

## Backups

All **X-Admin-Key**.

- [ ] **POST** `/admin/backup` → backup file created; JSON with `filename`, `sizeBytes`.
- [ ] **GET** `/admin/backups` → list of backups.
- [ ] **POST** `/admin/restore` — header **`X-Confirm: RESTORE`**, body `{ "filename": "<backup-file-name>" }` → **destructive** (DB replaced, process restarts). Run only on staging or with a known-good backup.

---

## Frontend (against deployed API + static app)

- [ ] Login → expenses load from server.
- [ ] Add expense → survives refresh / second device.
- [ ] Edit expense → persisted server-side.
- [ ] Delete expense → removed server-side.
- [ ] Offline → queue write → toast **saved locally** (wording may vary).
- [ ] Reconnect → queue flush → toast **synced**.
- [ ] Token refresh → short expiry mitigated by `/auth/refresh` (no hard logout).
- [ ] Session fully invalid → user returned to login.
- [ ] Reports → CSV export downloads.
- [ ] Receipt scan → fields filled + image on server (`POST …/receipt` / detail thumbnail).
- [ ] Currency selector → non-EUR + EUR equivalent path works.
- [ ] Approvals tab → approve / reject (admin).
- [ ] **localStorage migration** (AUTH mode): old local data uploads once, local cleared as implemented.
- [ ] **PWA** — Add to Home Screen → standalone, icon, splash as configured in `manifest.json` / meta tags.

---

## Security & hardening

- [ ] **Security headers** on responses: at least `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (see `server.js` middleware).
- [ ] **Rate limits** trigger after thresholds (signup, login, forgot-password, scan, expenses, bills, reports, receipt upload, backup) — expect `429` or JSON error with limit message.
- [ ] **IDOR**: cannot **GET/PUT/DELETE** another user’s expense/bill by guessing `id` (403/404 as implemented).
- [ ] **Seed / bootstrap**: **`ALLOW_SEED` not `true` in production** → `POST /admin/seed/bootstrap` (and related seed routes) → `403` disabled. When enabled in dev: also requires **`X-Admin-Key`** + **`X-Bootstrap-Secret`** matching `BOOTSTRAP_SECRET`.

---

## Optional API smoke (curl)

```bash
curl -sS "$BASE/health" | jq .
curl -sS -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"***"}' | jq .
# Then:
curl -sS "$BASE/expenses" -H "Authorization: Bearer $TOKEN" | jq .
curl -sS "$BASE/admin/users/pending" -H "X-Admin-Key: $ADMIN_KEY" | jq .
```

---

## AI scan (if `ANTHROPIC_API_KEY` set)

- [ ] **POST** `/ai/scan-receipt` (**Bearer**) body `{ "b64", "mediaType" }` → `200`, `{ result: { ... } }` or documented error.

---

*Generated to match `server/server.js`, `expensesRoutes.js`, `billsRoutes.js`, `reportsRoutes.js`, `billJobs.js` as of the repo revision that added this file.*
