/**
 * SOLANA AUTH SERVER  v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles: signup → email verification → admin approval → login gate
 *
 * Storage : SQLite (./data/solana.db); audit en tabla audit_log (migración one-time desde audit.log)
 *
 * Email   : Resend API (https://resend.com — free 100 emails/day).
 *           Set RESEND_API_KEY env variable.
 *
 * Deploy  : node server.js   (PORT env, default 3001)
 *           Runs alongside the static SPA served by Cloudflare Pages / any CDN.
 *
 * ENV VARIABLES (required in production, see .env.example):
 *   PORT              — default 3001
 *   RESEND_API_KEY    — from resend.com
 *   FROM_EMAIL        — verified sender domain, e.g. noreply@solana.app
 *   ADMIN_EMAIL       — notification recipient (admin email)
 *   APP_URL           — public URL of the app, e.g. https://your-app.pages.dev
 *   CORS_ORIGIN       — allowed origin for the frontend
 *   TOKEN_SECRET      — random 32-byte hex string for HMAC token signing
 *
 * Receipts (Cloudinary — recommended on Render; if unset, files go to DATA_DIR/receipts/):
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *   CLOUDINARY_RECEIPTS_FOLDER — optional, default solana-receipts
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const cors       = require('cors');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const { spawn }  = require('child_process');
const { Resend } = require('resend');
const userStore = require('./userStore');
const { runUsersJsonMigration } = require('./migrate');
const { createExpensesRouter } = require('./expensesRoutes');
const { sanitizeRequestBody } = require('./middleware/sanitize');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT         || 3001;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.FROM_EMAIL   || 'noreply@solana.app';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  || '';
const APP_URL      = process.env.APP_URL      || 'http://localhost:3001';
const CORS_ORIGIN  = process.env.CORS_ORIGIN  || null;
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!process.env.TOKEN_SECRET) {
  console.error('[SOLANA-AUTH] FATAL: TOKEN_SECRET env var must be set. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const BCRYPT_ROUNDS = 12;

// ── SESSION TOKEN HELPERS ────────────────────────────────────────────────────
// Lightweight signed session token: base64(payload).HMAC
// Used to authorize admin actions via signed Bearer session tokens.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** POST /auth/refresh may re-issue a token this long after exp (sliding grace). */
const SESSION_REFRESH_GRACE_MS = 30 * 60 * 1000; // 30 minutes

function signSessionToken(userId, role) {
  const payload = Buffer.from(JSON.stringify({ userId, role, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySessionToken(token, allowGrace = false) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const GRACE_MS = 30 * 60 * 1000; // 30 minutes
    if (allowGrace) {
      if (Date.now() > data.exp + GRACE_MS) return null;
    } else {
      if (Date.now() > data.exp) return null;
    }
    return data;
  } catch { return null; }
}

// ── SEED GUARD ─────────────────────────────────────────────────────────────
// ALLOW_SEED must be set to 'true' in env for any seed/bootstrap endpoint to work.
// Never set this in production.
const ALLOW_SEED       = process.env.ALLOW_SEED === 'true';
const BOOTSTRAP_SECRET = process.env.BOOTSTRAP_SECRET || null;
const SEED_TAG         = 'seeded'; // marker on seeded user records

if (!RESEND_KEY) {
  console.warn('[SOLANA-AUTH] RESEND_API_KEY not set — emails will be logged but not sent');
}

const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;

// ── DATA DIR + DB + AUDIT (SQLite audit_log; one-time import desde audit.log) ─
const DATA_DIR   = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const AUDIT_LEGACY = path.join(DATA_DIR, 'audit.log');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const maintenanceLock = require('./lib/maintenanceLock');
maintenanceLock.unlock();

const db = require('./db');
const { seedDefaults } = require('./seeds/defaults');
seedDefaults(db);
const { runBackup, listBackups, resolveSafeBackupPath, replaceLiveDatabase } = require('./backup');
const auditLog = require('./auditLog');
auditLog.migrateLegacyFile(AUDIT_LEGACY);

const settingsCache = require('./lib/settingsCache');
settingsCache.setDb(db);
settingsCache.warmUp();

function audit(event, data = {}) {
  auditLog.write(event, data);
  console.log('[AUDIT]', event, data);
}


// ── PASSWORD STRENGTH ─────────────────────────────────────────────────────────
const COMMON_PASSWORDS = new Set([
  'password','123456','password1','12345678','qwerty','abc123','letmein',
  'monkey','1234567','dragon','master','sunshine','princess','welcome',
  'shadow','superman','michael','football','baseball','iloveyou',
]);

function checkPassword(pw) {
  if (!pw || pw.length < 8)  return 'Mínimo 8 caracteres.';
  if (pw.length > 128)        return 'Máximo 128 caracteres.';
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 'Contraseña demasiado común.';
  return null; // OK
}

// ── EMAIL SENDER ──────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, logEvent, logData = {} }) {
  if (!resend) {
    console.log(`[EMAIL-STUB] To: ${to} | Subject: ${subject}`);
    audit(logEvent, { to, ...logData, stub: true });
    return { ok: true, stub: true };
  }
  try {
    await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    audit(logEvent, { to, ...logData });
    return { ok: true };
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
    audit(logEvent + '_failed', { to, error: err.message, ...logData });
    return { ok: false, error: err.message };
  }
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────────────────────
/** Absolute logo URL for HTML emails (same host as the static app / Cloudflare Pages). */
function emailLogoHeaderHtml() {
  const base = String(APP_URL || '').replace(/\/+$/, '');
  if (!base) {
    return '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:24px;color:#3C0A37;margin-bottom:6px;text-align:center;font-weight:700">Solana</div>';
  }
  const src = `${base}/logo.png`;
  return `<div style="text-align:center;margin-bottom:8px">
  <img src="${src}" alt="Solana" width="140" style="max-width:200px;width:70%;height:auto;display:inline-block;border:0;vertical-align:middle"/>
</div>`;
}

const emailBase = (content) => `
<!DOCTYPE html><html><body style="font-family:'DM Sans',Arial,sans-serif;background:#F5F0EA;padding:32px;color:#1A2B1E">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 6px rgba(0,0,0,0.08)">
  ${emailLogoHeaderHtml()}
  <div style="font-size:11px;color:#9CAA9F;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:24px;text-align:center">Gestión de Gastos</div>
  ${content}
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #F5F0EA;font-size:10px;color:#9CAA9F">
    Solana · Barcelona · 2026 — Este mensaje fue generado automáticamente.
  </div>
</div></body></html>`;


const adminNotificationHtml = (user) => emailBase(`
  <p style="font-size:15px;font-weight:600;margin-bottom:8px">Nueva solicitud de acceso</p>
  <p style="font-size:13px;line-height:1.6;color:#4B5E52;margin-bottom:16px">
    Un usuario ha solicitado acceso y está esperando aprobación.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px">
    <tr><td style="padding:6px 0;color:#9CAA9F;width:120px">Nombre</td><td style="padding:6px 0;font-weight:500">${user.name || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#9CAA9F">Email</td><td style="padding:6px 0;font-weight:500">${user.email}</td></tr>
    <tr><td style="padding:6px 0;color:#9CAA9F">Solicitado</td><td style="padding:6px 0">${new Date(user.createdAt).toLocaleString('es-ES')}</td></tr>
  </table>
  <p style="font-size:12px;color:#4B5E52;margin-bottom:12px">Para aprobar o denegar: Solana → Ajustes → Usuarios pendientes de aprobación.</p>
  <p style="font-size:11px;color:#9CAA9F">ID de usuario: <code>${user.id}</code></p>`);

const accessGrantedHtml = (name) => emailBase(`
  <p style="font-size:15px;font-weight:600;margin-bottom:8px">¡Bienvenido/a${name ? ', ' + name : ''}!</p>
  <p style="font-size:13px;line-height:1.6;color:#4B5E52;margin-bottom:20px">
    Tu cuenta ha sido aprobada. Ya puedes acceder a Solana.
  </p>
  <a href="${APP_URL}" style="display:inline-block;background:#1C3A2F;color:#fff;text-decoration:none;padding:12px 24px;border-radius:7px;font-size:14px;font-weight:600">
    Entrar en Solana
  </a>`);

const accessDeniedHtml = (name) => emailBase(`
  <p style="font-size:15px;font-weight:600;margin-bottom:8px">Solicitud no aprobada</p>
  <p style="font-size:13px;line-height:1.6;color:#4B5E52">
    Hola${name ? ' ' + name : ''}, tu solicitud de acceso a Solana no ha sido aprobada en este momento.
    Si crees que esto es un error, contacta con el administrador.
  </p>`);

// ── FORGOT-PASSWORD EMAIL TEMPLATES ──────────────────────────────────────────

const passwordResetEmailHtml = (tempPassword) => emailBase(`
  <p style="font-size:15px;font-weight:600;margin-bottom:8px">Restablecimiento de contraseña — Solana</p>
  <p style="font-size:13px;line-height:1.6;color:#4B5E52;margin-bottom:16px">
    Has solicitado un restablecimiento de contraseña. A continuación encontrarás una contraseña temporal
    que puedes usar para acceder y cambiarla desde Ajustes.
  </p>
  <div style="background:#F5F0EA;border-radius:8px;padding:14px 18px;margin-bottom:20px;text-align:center">
    <div style="font-size:10px;color:#9CAA9F;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px">Contraseña temporal</div>
    <code style="font-size:22px;font-weight:700;color:#3C0A37;letter-spacing:0.12em">${tempPassword}</code>
  </div>
  <p style="font-size:12px;color:#4B5E52;margin-bottom:8px">
    Una vez que accedas, ve a <strong>Ajustes → Contraseña</strong> para establecer una nueva contraseña permanente.
  </p>
  <p style="font-size:11px;color:#9CAA9F">Esta contraseña temporal caduca en 24 horas. Si no solicitaste esto, ignora este mensaje.</p>
  <a href="${APP_URL}" style="display:inline-block;margin-top:16px;background:#3C0A37;color:#fff;text-decoration:none;padding:10px 22px;border-radius:7px;font-size:13px;font-weight:600">
    Entrar en Solana →
  </a>`);

const passwordAssistanceNotificationHtml = (requestingEmail) => emailBase(`
  <p style="font-size:15px;font-weight:600;margin-bottom:8px">Solicitud de asistencia de contraseña</p>
  <p style="font-size:13px;line-height:1.6;color:#4B5E52;margin-bottom:16px">
    Un usuario ha solicitado asistencia con su contraseña en Solana.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px">
    <tr><td style="padding:6px 0;color:#9CAA9F;width:120px">Email solicitante</td><td style="padding:6px 0;font-weight:500">${requestingEmail}</td></tr>
    <tr><td style="padding:6px 0;color:#9CAA9F">Hora</td><td style="padding:6px 0">${new Date().toLocaleString('es-ES')}</td></tr>
  </table>
  <p style="font-size:12px;color:#4B5E52;margin-bottom:12px">
    El usuario no ha recibido ningún correo de restablecimiento. Puedes ayudarle cambiando su contraseña
    manualmente desde <strong>Ajustes → Miembros del equipo</strong>, o contactándole directamente.
  </p>`);
const app = express();
const helmet = require('helmet');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", "data:", "blob:", 'https://res.cloudinary.com'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    crossOriginEmbedderPolicy: false,
  }),
);
let httpServer;

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Demasiados intentos de registro. Inténtalo en una hora.' },
  standardHeaders: true, legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Demasiados intentos. Inténtalo en 15 minutos.' },
  standardHeaders: true, legacyHeaders: false,
});


const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Demasiados intentos. Inténtalo en una hora.' },
  standardHeaders: true, legacyHeaders: false,
});

const scanLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  message: { error: 'Demasiadas solicitudes de escaneo. Inténtalo en un minuto.' },
  standardHeaders: true, legacyHeaders: false,
});

const expensesApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Demasiadas solicitudes a /expenses. Inténtalo en un minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const departmentsApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Demasiadas solicitudes a /departments. Inténtalo en un minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const reportsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Demasiadas solicitudes a informes. Inténtalo en un minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminBackupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Límite de copias de seguridad por hora alcanzado.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const expenseReceiptUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Demasiadas subidas de recibo. Inténtalo en un minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── ADMIN AUTH MIDDLEWARE ─────────────────────────────────────────────────────
function requireAdminSession(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const session = verifySessionToken(token);
  if (session && (session.role === 'admin' || session.role === 'superadmin')) {
    req.userId = session.userId;
    req.userRole = session.role;
    return next();
  }
  audit('failed_admin_session', { ip: req.ip, path: req.path });
  return res.status(403).json({ error: 'No autorizado.' });
}

function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(403).json({ error: 'No autorizado.' });
  }
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  req.userId = session.userId;
  req.userRole = session.role;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.userRole !== 'superadmin') {
    audit('failed_superadmin', { ip: req.ip, path: req.path, userId: req.userId });
    return res.status(403).json({ error: 'Solo superadministrador.' });
  }
  next();
}

// Trust proxy for rate-limit IP detection (Render, Railway, etc.)
app.set('trust proxy', 1);

app.use((req, res, next) => {
  if (maintenanceLock.isLocked()) {
    return res.status(503).json({ error: 'Servidor en mantenimiento (restauración de base de datos).' });
  }
  next();
});

app.use(cors({ origin: CORS_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '6mb' }));
app.use(sanitizeRequestBody);
app.use('/expenses', expensesApiLimiter, createExpensesRouter({
  audit,
  requireAuth: requireAuth,
  DATA_DIR,
  userStore: {
    findUserById: userStore.findUserByIdPublic,
    findUserByEmail: userStore.findUserByEmail,
  },
}));
const { createDepartmentsRouter } = require('./departmentsRoutes');
const { createReportsRouter } = require('./reportsRoutes');
const { runExpenseMaintenance } = require('./expenseJobs');

app.use(
  '/departments',
  departmentsApiLimiter,
  createDepartmentsRouter({ audit, requireAuth, requireSuperAdmin }),
);
app.use('/reports', reportsLimiter, createReportsRouter({ requireAdminSession, userStore }));

// ── ROUTES ────────────────────────────────────────────────────────────────────
const { createAuthRouter } = require('./routes/authRoutes');
const { createAdminRouter } = require('./routes/adminRoutes');
const { createSettingsRouter } = require('./routes/settingsRoutes');
const { createAiRouter } = require('./routes/aiRoutes');

app.use('/auth', createAuthRouter({
  userStore,
  audit,
  signupLimiter,
  loginLimiter,
  forgotPasswordLimiter,
  checkPassword,
  BCRYPT_ROUNDS,
  ADMIN_EMAIL,
  sendEmail,
  adminNotificationHtml,
  passwordResetEmailHtml,
  passwordAssistanceNotificationHtml,
  signSessionToken,
  verifySessionToken,
  requireAuth,
}));

app.use('/admin', createAdminRouter({
  userStore,
  audit,
  auditLog,
  requireAdminSession,
  checkPassword,
  BCRYPT_ROUNDS,
  sendEmail,
  accessGrantedHtml,
  accessDeniedHtml,
  db,
  runBackup,
  listBackups,
  resolveSafeBackupPath,
  replaceLiveDatabase,
  adminBackupLimiter,
  verifySessionToken,
  ALLOW_SEED,
  BOOTSTRAP_SECRET,
  SEED_TAG,
  path,
  spawn,
  getHttpServer: () => httpServer,
  serverEntryPath: path.join(__dirname, 'server.js'),
  serverCwd: __dirname,
}));

app.use('/ai', createAiRouter({
  scanLimiter,
  verifySessionToken,
  audit,
  ANTHROPIC_API_KEY,
}));

app.use(createSettingsRouter({
  db,
  requireAdminSession,
  requireAuth,
  audit,
}));

app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    const receiptDir = path.join(DATA_DIR, 'receipts');
    const diskOk = fs.existsSync(DATA_DIR);
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      disk: diskOk,
      receiptsDir: fs.existsSync(receiptDir),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Database unavailable' });
  }
});

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api')
    || req.path.startsWith('/auth')
    || req.path.startsWith('/expenses')
    || req.path.startsWith('/reports')
    || req.path.startsWith('/admin')
    || req.path.startsWith('/ai')
    || req.path.startsWith('/health')
    || req.path.startsWith('/settings')
    || req.path.startsWith('/departments')
  ) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── VERIFY PAGE HTML ──────────────────────────────────────────────────────────

// ── START ─────────────────────────────────────────────────────────────────────
runUsersJsonMigration({ dataDir: DATA_DIR, audit });

// ── SCHEDULED BACKUPS ────────────────────────────────────────────────────────
// Run once on startup, then every 6 hours.
function scheduleBackups() {
  function doBackup() {
    try {
      const result = runBackup({ db });
      audit('backup_created', { filename: result.filename, sizeBytes: result.sizeBytes });
      console.log('[backup] OK', result.filename, result.sizeBytes, 'bytes');
    } catch (e) {
      audit('backup_failed', { error: e.message });
      console.error('[backup] FAILED:', e.message);
    }
  }
  doBackup(); // immediate on startup
  setInterval(doBackup, 6 * 60 * 60 * 1000); // then every 6 hours
}
scheduleBackups();

httpServer = app.listen(PORT, () => {
  console.log(`[SOLANA-AUTH] Server running on port ${PORT}`);
  console.log(`[SOLANA-AUTH] Admin email: ${ADMIN_EMAIL}`);
  console.log(`[SOLANA-AUTH] App URL: ${APP_URL}`);
  console.log(`[SOLANA-AUTH] Email: ${resend ? 'Resend active' : 'STUB (no RESEND_API_KEY)'}`);
  try {
    runExpenseMaintenance(audit);
  } catch (e) {
    console.error('[EXPENSE-JOBS] startup:', e.message);
  }
  setInterval(() => {
    try {
      runExpenseMaintenance(audit);
    } catch (e) {
      console.error('[EXPENSE-JOBS] interval:', e.message);
    }
  }, 24 * 60 * 60 * 1000).unref();

});

function shutdown(signal) {
  console.log(`[SOLANA-AUTH] ${signal} received, closing database…`);
  try {
    db.close();
  } catch (e) {
    console.error('[SOLANA-AUTH] db.close error:', e.message);
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app; // for testing
