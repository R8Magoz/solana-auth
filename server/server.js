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
const bcrypt     = require('bcrypt');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const { Resend } = require('resend');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT         || 3001;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.FROM_EMAIL   || 'noreply@solana.app';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  || '';
const APP_URL      = process.env.APP_URL      || 'http://localhost:3001';
const CORS_ORIGIN  = process.env.CORS_ORIGIN  || '*';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const BCRYPT_ROUNDS = 12;

// ── SESSION TOKEN HELPERS ────────────────────────────────────────────────────
// Lightweight signed session token: base64(payload).HMAC
// Used to authorize admin actions without exposing ADMIN_KEY to the browser.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
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
    if (Date.now() > data.exp) {
      if (allowGrace && Date.now() < data.exp + SESSION_REFRESH_GRACE_MS) {
        return { ...data, expired: true };
      }
      return null;
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

const db = require('./db');
const backupMod = require('./backup');
const auditLog = require('./auditLog');
auditLog.migrateLegacyFile(AUDIT_LEGACY);

function audit(event, data = {}) {
  auditLog.write(event, data);
  console.log('[AUDIT]', event, data);
}

const { runUsersJsonMigration } = require('./migrate');
runUsersJsonMigration({ dataDir: DATA_DIR, audit });
const userStore = require('./userStore');

// Token helpers removed — email verification flow not used in this version.

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

// verificationEmailHtml removed — no email verification in this version.

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
let httpServer;
global.__SOLANA_RESTORE_PENDING = false;

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  next();
});

// Trust proxy for rate-limit IP detection (Render, Railway, etc.)
app.set('trust proxy', 1);

app.use((req, res, next) => {
  if (global.__SOLANA_RESTORE_PENDING) {
    return res.status(503).json({ error: 'Servidor en mantenimiento (restauración de base de datos).' });
  }
  next();
});

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '6mb' }));

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

// verifyLimiter removed — /auth/verify not used in this version.

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

const billsApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Demasiadas solicitudes a /bills. Inténtalo en un minuto.' },
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
// Simple shared admin secret sent in header X-Admin-Key.
// For production, replace with a proper JWT or session.
const ADMIN_KEY = process.env.ADMIN_KEY || (() => {
  const k = crypto.randomBytes(16).toString('hex');
  console.warn('[SOLANA-AUTH] ADMIN_KEY not set. Generated ephemeral key:', k);
  console.warn('[SOLANA-AUTH] Set ADMIN_KEY in .env to make this persistent.');
  return k;
})();

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_KEY) {
    audit('failed_approval_attempt', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'No autorizado.' });
  }
  next();
}

function requireAdminSession(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key && key === ADMIN_KEY) {
    req.authViaAdminKey = true;
    return next();
  }
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    audit('failed_admin_session', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'No autorizado.' });
  }
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    audit('failed_admin_session', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'No autorizado.' });
  }
  req.userId = session.userId;
  req.userRole = session.role;
  return next();
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

const { createExpensesRouter } = require('./expensesRoutes');
const { createBillsRouter } = require('./billsRoutes');
const { createDepartmentsRouter } = require('./departmentsRoutes');
const { createReportsRouter } = require('./reportsRoutes');
const { runBillMaintenance } = require('./billJobs');

app.use('/expenses', expensesApiLimiter, createExpensesRouter({
  audit, requireAuth, requireAdminSession, DATA_DIR, receiptUploadLimiter: expenseReceiptUploadLimiter, userStore,
}));
app.use('/bills', billsApiLimiter, createBillsRouter({
  audit,
  requireAuth,
  DATA_DIR,
  receiptUploadLimiter: expenseReceiptUploadLimiter,
}));
app.use(
  '/departments',
  departmentsApiLimiter,
  createDepartmentsRouter({ audit, requireAuth, requireSuperAdmin }),
);
app.use('/reports', reportsLimiter, createReportsRouter({ requireAdminSession, userStore }));

// ── ROUTES ────────────────────────────────────────────────────────────────────

/**
 * POST /auth/signup
 * Body: { email, password, name? }
 * Creates user in pending_admin_approval state immediately — no email verification.
 * Notifies admin by email. Returns generic success response.
 */
app.post('/auth/signup', signupLimiter, async (req, res) => {
  const { email, password, name } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Email inválido.' });
  }
  const normalEmail = email.trim().toLowerCase().slice(0, 254);
  const pwError = checkPassword(password);
  if (pwError) return res.status(400).json({ error: pwError });

  audit('signup_requested', { email: normalEmail, ip: req.ip });

  const existing = userStore.findUserByEmail(normalEmail);

  if (existing) {
    // Already registered — return generic message
    return res.json({ ok: true, message: 'Solicitud recibida. Un administrador aprobará tu acceso en breve.' });
  }

  // New user — skip email verification, go straight to pending_admin_approval
  // (small trusted team, admin approves manually via Settings panel)
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  /** Primary key in `users`, JWT/session `userId`, expense `userId`, bills `userId`, GET /auth/team `id` — same value everywhere. */
  const userId = 'u_' + crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  const newUser = {
    id: userId,
    email: normalEmail,
    name: (name || '').trim().slice(0, 64) || null,
    passwordHash: hash,
    role: 'user',
    color: '#6B7280',
    accountStatus: 'pending_admin_approval', // skip email verification
    approvalStatus: 'pending',
    emailVerifiedAt: now,                    // mark as verified immediately
    approvedBy: null,
    approvedAt: null,
    deniedAt: null,
    deniedBy: null,
    createdAt: now,
  };

  userStore.insertUser(newUser);
  audit('signup_requested', { userId, email: normalEmail });

  // Notify admin by email (best effort — does not block signup)
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `[Solana] Nueva cuenta pendiente de aprobación: ${normalEmail}`,
    html: adminNotificationHtml(newUser),
    logEvent: 'admin_notification_sent', logData: { userId, userEmail: normalEmail },
  });

  res.json({ ok: true, message: 'Solicitud recibida. Un administrador aprobará tu acceso en breve.' });
});

// /auth/verify route removed — email verification not used in this version.
// If a stale link is clicked, return 410 Gone.
app.get('/auth/verify', (req, res) => {
  res.status(410).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Enlace no válido</h2><p>Este enlace ya no está activo. El acceso se gestiona directamente por el administrador.</p></body></html>');
});

/**
 * POST /auth/login
 * Body: { email, password }
 * Returns user object (without passwordHash) only if status === active.
 * All other statuses return 403 with a clear, non-leaky message.
 */
app.post('/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Datos incompletos.' });

  const normalEmail = email.trim().toLowerCase().slice(0, 254);
  const user  = userStore.findUserByEmail(normalEmail);

  // Always do a bcrypt compare to prevent timing attacks
  const dummyHash = '$2b$12$invalidhashfortimingprotectiononly000000000000000000000';
  const hash = user?.passwordHash || dummyHash;
  const match = await bcrypt.compare(password, hash);

  if (!user || !match) {
    audit('login_failed', { email: normalEmail, ip: req.ip, reason: 'invalid_credentials' });
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }

  // Status-specific gates — enforced server-side
  if (user.accountStatus === 'pending_admin_approval') {
    audit('login_blocked', { userId: user.id, reason: 'pending_admin_approval' });
    return res.status(403).json({
      error: 'Tu cuenta está pendiente de aprobación por el administrador. Te avisaremos por correo.',
      code: 'PENDING_APPROVAL',
    });
  }
  if (user.accountStatus === 'denied') {
    audit('login_blocked', { userId: user.id, reason: 'account_denied' });
    return res.status(403).json({
      error: 'Tu solicitud de acceso no fue aprobada. Contacta con el administrador.',
      code: 'ACCESS_DENIED',
    });
  }
  if (user.accountStatus !== 'active') {
    audit('login_blocked', { userId: user.id, reason: 'unknown_status', status: user.accountStatus });
    return res.status(403).json({ error: 'Cuenta no activa.' });
  }

  audit('login_success', { userId: user.id, email: normalEmail });

  // Return safe user object + short-lived session token for admin actions
  const { passwordHash: _, ...safeUser } = user;
  const sessionToken = signSessionToken(user.id, user.role);
  res.json({ ok: true, user: safeUser, sessionToken });
});

/**
 * POST /auth/refresh
 * Bearer: valid token, or token expired within SESSION_REFRESH_GRACE_MS → new sessionToken (8h).
 */
app.post('/auth/refresh', (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const data = verifySessionToken(token, true);
  if (!data || !data.userId) {
    return res.status(401).json({ error: 'Sesión no válida.' });
  }
  const sessionToken = signSessionToken(data.userId, data.role);
  audit('session_refreshed', { userId: data.userId });
  res.json({ ok: true, sessionToken });
});

/**
 * POST /auth/logout
 * Bearer: stateless tokens — no server-side session to destroy; audit for traceability.
 */
app.post('/auth/logout', (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const data = verifySessionToken(token, true);
  if (data && data.userId) {
    audit('session_logout', { userId: data.userId });
  }
  res.json({ ok: true });
});

/**
 * GET /auth/team
 * Any logged-in user: full team list with display fields only (no password hash).
 * Lets the SPA resolve expense/bill userId → name when IDs come from SQLite (e.g. u_…).
 */
app.get('/auth/team', requireAuth, (req, res) => {
  try {
    const users = userStore.getAllUsers().map((u) => {
      const { passwordHash: _ph, tempPasswordExp: _tp, ...safe } = u;
      return safe;
    });
    res.json({ users });
  } catch (e) {
    console.error('[auth/team]', e);
    res.status(500).json({ error: 'No se pudo cargar el equipo.' });
  }
});

/**
 * POST /auth/change-password
 * Body: { userId, newPassword }
 * Auth: Bearer session token — user can only change their own password.
 * Hashes the new password, persists in SQLite, clears mustChangePassword.
 * This is the authoritative fix for the force-change loop: clearing the flag
 * in the backend means next login won't re-hydrate mustChangePassword: true.
 */
app.post('/auth/change-password', async (req, res) => {
  const { userId, newPassword, currentPassword } = req.body || {};
  const uid = userId != null ? String(userId).trim().slice(0, 128) : '';
  if (!uid || !newPassword) return res.status(400).json({ error: 'userId y newPassword son obligatorios.' });

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(403).json({ error: 'No autorizado.' });
  }
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  if (session.userId !== uid) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const pwError = checkPassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  const user = userStore.findUserById(uid);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  if (!user.mustChangePassword) {
    const cur = currentPassword != null ? String(currentPassword) : '';
    if (!cur) {
      return res.status(400).json({ error: 'Contraseña actual requerida.' });
    }
    const okCur = await bcrypt.compare(cur, user.passwordHash);
    if (!okCur) {
      audit('password_change_wrong_current', { userId: uid, ip: req.ip });
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  userStore.updatePasswordAfterChange(uid, newHash);
  audit('password_changed', { userId: uid, ip: req.ip });
  res.json({ ok: true, message: 'Contraseña actualizada.' });
});

/**
 * PUT /auth/update-profile
 * Body: { name?, email?, phone?, avatar? } — authenticated user updates their own record only.
 */
app.put('/auth/update-profile', async (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(403).json({ error: 'No autorizado.' });
  const session = verifySessionToken(token);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });

  const body = req.body || {};
  const name = body.name != null ? String(body.name).trim().slice(0, 128) : '';
  const emailRaw = body.email != null ? String(body.email).trim().toLowerCase().slice(0, 254) : '';
  const phone = body.phone != null ? String(body.phone).trim().slice(0, 64) : '';
  let avatar = body.avatar;
  if (avatar != null && typeof avatar === 'string') {
    avatar = avatar.slice(0, 500000);
  } else {
    avatar = null;
  }

  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  if (!emailRaw || !emailRaw.includes('@')) {
    return res.status(400).json({ error: 'Email inválido.' });
  }

  const me = userStore.findUserById(session.userId);
  if (!me) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const other = userStore.findUserByEmail(emailRaw);
  if (other && other.id !== session.userId) {
    return res.status(409).json({ error: 'Ya existe otro usuario con ese correo.' });
  }

  userStore.updateOwnProfile(session.userId, {
    name,
    email: emailRaw,
    phone,
    avatar: avatar === '' ? null : avatar,
  });

  const fresh = userStore.findUserById(session.userId);
  const { passwordHash: _ph, tempPasswordExp: _tp, ...safeUser } = fresh;
  audit('profile_updated', { userId: session.userId, ip: req.ip });
  res.json({ ok: true, user: safeUser });
});

// ── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────

/**
 * POST /auth/forgot-password
 * Body: { email }
 *
 * - If email === ADMIN_EMAIL: generate a temporary password, set it on the user record,
 *   and send it via Resend to ADMIN_EMAIL.
 * - If email !== ADMIN_EMAIL: send a notification to ADMIN_EMAIL only.
 *   The requesting user receives no direct email (Resend is restricted to ADMIN_EMAIL).
 *
 * Always returns 200 with a { ok, message } payload so the frontend can display
 * the correct feedback. Never leaks whether the email exists in the system.
 */
app.post('/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email requerido.' });
  }

  const normalEmail = email.trim().toLowerCase().slice(0, 254);
  const adminEmail  = (ADMIN_EMAIL || '').trim().toLowerCase();

  audit('forgot_password_requested', { email: normalEmail, ip: req.ip });

  if (normalEmail === adminEmail) {
    // ── Admin path: generate temp password, update record, email it ──────────
    const tempPassword = crypto.randomBytes(6).toString('hex'); // 12-char hex, readable
    const tempHash     = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const tempExpiry   = Date.now() + 24 * 60 * 60 * 1000; // 24 h

    const adminUser = userStore.findUserByEmail(adminEmail);

    if (adminUser) {
      userStore.updateAdminTempPassword(adminUser.id, tempHash, tempExpiry);
      audit('admin_temp_password_set', { userId: adminUser.id });
    } else {
      // Admin user not in DB — create a minimal active record so login works.
      // This happens when bootstrap used a different SEED_ADMIN_EMAIL than ADMIN_EMAIL.
      const newAdminId = 'admin-' + crypto.randomBytes(4).toString('hex');
      const newAdmin = {
        id:               newAdminId,
        email:            adminEmail,
        name:             'Administrator',
        passwordHash:     tempHash,
        tempPasswordExp:  tempExpiry,
        role:             'superadmin',
        color:            '#3C0A37',
        accountStatus:    'active',
        approvalStatus:   'approved',
        emailVerifiedAt:  Date.now(),
        approvedBy:       'system',
        approvedAt:       Date.now(),
        deniedAt:         null,
        deniedBy:         null,
        createdAt:        Date.now(),
      };
      userStore.insertUser(newAdmin);
      audit('admin_user_created_on_reset', { userId: newAdminId, email: adminEmail });
    }

    const emailResult = await sendEmail({
      to: ADMIN_EMAIL,
      subject: '[Solana] Contraseña temporal — restablecimiento solicitado',
      html: passwordResetEmailHtml(tempPassword),
      logEvent: 'password_reset_email_sent',
      logData: { to: ADMIN_EMAIL },
    });

    if (!emailResult.ok && !emailResult.stub) {
      audit('password_reset_email_failed', { error: emailResult.error });
      return res.status(500).json({ error: 'No se pudo enviar el correo de restablecimiento. Inténtalo de nuevo.' });
    }

    return res.json({
      ok: true,
      message: 'Se ha enviado una contraseña temporal al correo del administrador.',
    });

  } else {
    // ── Non-admin path: notify admin, no email to the requesting user ─────────
    const emailResult = await sendEmail({
      to: ADMIN_EMAIL,
      subject: `[Solana] Solicitud de asistencia de contraseña — ${normalEmail}`,
      html: passwordAssistanceNotificationHtml(normalEmail),
      logEvent: 'password_assistance_notification_sent',
      logData: { requestingEmail: normalEmail },
    });

    if (!emailResult.ok && !emailResult.stub) {
      audit('password_assistance_notification_failed', { error: emailResult.error });
      // Don't expose the failure to the requesting user — return success-like response
    }

    return res.json({
      ok: true,
      message: 'Tu solicitud ha sido enviada al administrador.',
    });
  }
});

/**
 * POST /admin/users/create
 * Body: { name, email, tempPassword, role?, title?, phone?, color? }
 * Creates a new active user with a bcrypt-hashed temporary password.
 * Sets mustChangePassword: true so the user is forced to change on first login.
 */
app.post('/admin/users/create', requireAdminSession, async (req, res) => {
  const { name, email, tempPassword, role, title, phone, color } = req.body || {};

  if (!name || !email || !tempPassword) {
    return res.status(400).json({ error: 'name, email y tempPassword son obligatorios.' });
  }

  const normalEmail = email.trim().toLowerCase().slice(0, 254);
  const pwError = checkPassword(tempPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  if (userStore.findUserByEmail(normalEmail)) {
    return res.status(409).json({ error: `Ya existe un usuario con el email ${normalEmail}.` });
  }

  const userId = 'u_' + crypto.randomBytes(8).toString('hex');
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  const now = Date.now();

  const newUser = {
    id:               userId,
    email:            normalEmail,
    name:             String(name).trim().slice(0, 128),
    title:            title != null ? String(title).trim().slice(0, 128) : '',
    phone:            phone != null ? String(phone).trim().slice(0, 64) : '',
    role:             role != null ? String(role).trim().slice(0, 32) : 'user',
    color:            color != null ? String(color).trim().slice(0, 32) : '#6B7280',
    passwordHash,
    mustChangePassword: true,
    accountStatus:    'active',
    approvalStatus:   'approved',
    emailVerifiedAt:  now,
    approvedBy:       'superadmin',
    approvedAt:       now,
    deniedAt:         null,
    deniedBy:         null,
    createdAt:        now,
  };

  userStore.insertUser(newUser);
  audit('admin_created_user', { userId, email: normalEmail, role: newUser.role });

  // Return safe user (no passwordHash)
  const { passwordHash: _, ...safeUser } = newUser;
  res.json({ ok: true, user: safeUser });
});

/**
 * POST /admin/users/:id/reset-password
 * Superadmin only. Sets a new temporary password and mustChangePassword: true.
 */
app.post('/admin/users/:id/reset-password', requireAdminSession, async (req, res) => {
  if (req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Solo superadministrador.' });
  }
  const { id } = req.params;
  const { tempPassword } = req.body || {};
  if (!tempPassword || typeof tempPassword !== 'string') {
    return res.status(400).json({ error: 'tempPassword es obligatorio.' });
  }
  const pwError = checkPassword(tempPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  const target = userStore.findUserById(id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.id === req.userId) {
    return res.status(400).json({ error: 'Usa «Contraseña» en Ajustes para cambiar tu propia clave.' });
  }

  const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  userStore.setPasswordForceChange(id, hash);
  audit('admin_reset_user_password', { targetId: id, by: req.userId, ip: req.ip });
  const fresh = userStore.findUserById(id);
  const { passwordHash: _, ...safeUser } = fresh;
  res.json({ ok: true, user: safeUser });
});

/**
 * PUT /admin/users/:id
 * Superadmin only. Updates name, email, phone, title, role, color (not password).
 */
app.put('/admin/users/:id', requireAdminSession, async (req, res) => {
  if (req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Solo superadministrador.' });
  }
  const { id } = req.params;
  const body = req.body || {};
  const target = userStore.findUserById(id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const emailNext = body.email != null ? String(body.email).trim().toLowerCase().slice(0, 254) : target.email;
  if (body.email != null && (!emailNext || !emailNext.includes('@'))) {
    return res.status(400).json({ error: 'Email inválido.' });
  }
  const other = userStore.findUserByEmail(emailNext);
  if (other && other.id !== id) {
    return res.status(409).json({ error: 'Ya existe otro usuario con ese correo.' });
  }

  const result = userStore.adminPatchUser(id, body);
  if (!result.ok) {
    const map = {
      not_found: [404, 'Usuario no encontrado.'],
      name_required: [400, 'El nombre es obligatorio.'],
      role_invalid: [400, 'Rol no válido.'],
    };
    const [code, msg] = map[result.error] || [400, 'No se pudo actualizar.'];
    return res.status(code).json({ error: msg });
  }
  const { passwordHash: _ph, tempPasswordExp: _tp, ...safeUser } = result.user;
  audit('admin_user_updated', { targetId: id, by: req.userId, ip: req.ip });
  res.json({ ok: true, user: safeUser });
});

/**
 * DELETE /admin/users/:id
 * Superadmin only. Fails if expenses or bills still reference the user (SQLite FK).
 */
app.delete('/admin/users/:id', requireAdminSession, (req, res) => {
  if (req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Solo superadministrador.' });
  }
  const { id } = req.params;
  if (id === req.userId) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta desde aquí.' });
  }
  const target = userStore.findUserById(id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const del = userStore.deleteUserByIdHard(id);
  if (!del.ok) {
    if (del.reason === 'references') {
      return res.status(409).json({
        error: 'No se puede eliminar: el usuario tiene gastos o facturas asociados.',
      });
    }
    return res.status(500).json({ error: 'No se pudo eliminar.' });
  }
  audit('admin_user_deleted', { targetId: id, by: req.userId, ip: req.ip });
  res.json({ ok: true });
});

app.get('/admin/users/pending', requireAdminSession, (req, res) => {
  const users = userStore
    .listUsersByAccountStatus('pending_admin_approval')
    .map(({ passwordHash: _, ...u }) => u);
  res.json({ users });
});

/**
 * GET /admin/users/all
 * Lists all registered users (no passwords).
 */
app.get('/admin/users/all', requireAdmin, (req, res) => {
  const users = userStore.getAllUsers().map(({ passwordHash: _, ...u }) => u);
  res.json({ users });
});

/**
 * POST /admin/users/:id/approve
 * Body: { adminId? }
 * Approves a user. Sets accountStatus = active. Sends access-granted email.
 */
app.post('/admin/users/:id/approve', requireAdminSession, async (req, res) => {
  const { id } = req.params;
  const { adminId } = req.body || {};

  const user  = userStore.findUserById(id);

  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (user.accountStatus === 'active') return res.status(400).json({ error: 'Ya activo.' });
  if (user.accountStatus !== 'pending_admin_approval') {
    return res.status(400).json({ error: `Estado inválido para aprobar: ${user.accountStatus}` });
  }

  const adminActor = adminId != null ? String(adminId).trim().slice(0, 128) : 'admin';
  userStore.updateUserApproved(user.id, adminActor);

  audit('admin_approved', { userId: user.id, email: user.email, approvedBy: adminActor });

  // Notify user
  await sendEmail({
    to: user.email,
    subject: '¡Acceso aprobado! – Solana',
    html: accessGrantedHtml(user.name),
    logEvent: 'access_granted_email_sent', logData: { userId: user.id },
  });

  res.json({ ok: true, message: `Usuario ${user.email} aprobado.` });
});

/**
 * POST /admin/users/:id/deny
 * Body: { adminId?, reason? }
 * Denies a user.
 */
app.post('/admin/users/:id/deny', requireAdminSession, async (req, res) => {
  const { id } = req.params;
  const { adminId, reason } = req.body || {};
  const adminActor = adminId != null ? String(adminId).trim().slice(0, 128) : 'admin';
  const reasonClean = reason != null && String(reason).trim() !== ''
    ? String(reason).trim().slice(0, 2000)
    : null;

  const user  = userStore.findUserById(id);

  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (user.accountStatus === 'denied') return res.status(400).json({ error: 'Ya denegado.' });

  userStore.updateUserDenied(user.id, adminActor, reasonClean);

  audit('admin_denied', { userId: user.id, email: user.email, deniedBy: adminActor, reason: reasonClean });

  // Optionally notify user
  await sendEmail({
    to: user.email,
    subject: 'Solicitud de acceso – Solana',
    html: accessDeniedHtml(user.name),
    logEvent: 'access_denied_email_sent', logData: { userId: user.id },
  });

  res.json({ ok: true, message: `Usuario ${user.email} denegado.` });
});

/**
 * GET /admin/audit
 * Paginated audit log from SQLite: ?limit=50&offset=0&event=&userId=
 */
app.get('/admin/audit', requireAdmin, (req, res) => {
  try {
    const { entries, total, limit, offset } = auditLog.query({
      limit: req.query.limit,
      offset: req.query.offset,
      event: req.query.event,
      userId: req.query.userId,
    });
    res.json({ entries, total, limit, offset });
  } catch (e) {
    console.error('[admin/audit]', e);
    res.status(500).json({ error: 'Error al leer auditoría.' });
  }
});

/**
 * POST /admin/backup
 * Trigger immediate SQLite backup (solana.db → data/backups/).
 */
app.post('/admin/backup', adminBackupLimiter, requireAdmin, (req, res) => {
  try {
    const r = backupMod.runBackup({ db });
    audit('admin_backup_created', { filename: r.filename, sizeBytes: r.sizeBytes, ip: req.ip });
    res.json({ ok: true, filename: r.filename, sizeBytes: r.sizeBytes });
  } catch (e) {
    console.error('[admin/backup]', e);
    res.status(500).json({ error: e.message || 'Error al crear la copia de seguridad.' });
  }
});

/**
 * GET /admin/backups
 * List backup files with sizes and modified times.
 */
app.get('/admin/backups', requireAdmin, (req, res) => {
  try {
    const backups = backupMod.listBackups();
    res.json({ ok: true, backups });
  } catch (e) {
    console.error('[admin/backups]', e);
    res.status(500).json({ error: 'Error al listar copias.' });
  }
});

/**
 * POST /admin/restore
 * Destructive: replaces live solana.db with a named backup. Requires X-Confirm: RESTORE.
 * Stops the HTTP server, closes DB, copies file, spawns a new process, exits.
 */
app.post('/admin/restore', requireAdmin, (req, res) => {
  const confirm = req.headers['x-confirm'];
  if (confirm !== 'RESTORE') {
    return res.status(400).json({
      error: 'Cabecera obligatoria: X-Confirm: RESTORE',
    });
  }
  const filename = typeof (req.body || {}).filename === 'string'
    ? (req.body.filename).trim().slice(0, 256)
    : '';
  let backupFull;
  try {
    backupFull = backupMod.resolveSafeBackupPath(filename);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'filename inválido.' });
  }

  const baseName = path.basename(backupFull);
  audit('admin_restore_initiated', { filename: baseName, ip: req.ip });
  global.__SOLANA_RESTORE_PENDING = true;

  res.json({ ok: true, filename: baseName });

  res.on('finish', () => {
    httpServer.close(() => {
      try {
        db.close();
      } catch (e) {
        console.error('[RESTORE] db.close:', e.message);
      }
      try {
        backupMod.replaceLiveDatabase(backupFull);
      } catch (e) {
        console.error('[RESTORE] copy failed:', e);
        global.__SOLANA_RESTORE_PENDING = false;
        process.exit(1);
        return;
      }
      console.log('[RESTORE] Database replaced with', baseName, '— restarting');
      try {
        const { spawn } = require('child_process');
        const scriptPath = path.join(__dirname, 'server.js');
        const child = spawn(process.argv[0], [scriptPath], {
          cwd: __dirname,
          detached: true,
          stdio: 'ignore',
          env: process.env,
        });
        child.unref();
      } catch (e) {
        console.error('[RESTORE] spawn failed:', e.message);
        process.exit(1);
        return;
      }
      setTimeout(() => process.exit(0), 150).unref();
    });
  });
});

// ── SEED / BOOTSTRAP ENDPOINTS ──────────────────────────────────────────────
// All guarded by ALLOW_SEED=true + BOOTSTRAP_SECRET header.
// Disabled in production — do not set ALLOW_SEED in production .env.

/**
 * POST /admin/seed/bootstrap
 * Idempotently creates or updates the three seed accounts:
 *   - bootstrap superadmin (your email)
 *   - approved test user
 *   - pending test user
 *
 * Headers:
 *   X-Bootstrap-Secret: <BOOTSTRAP_SECRET env var>
 *   X-Admin-Key:        <ADMIN_KEY env var>  (also required)
 *
 * Body: {
 *   adminEmail:    string (required — bootstrap admin email)
 *   adminPassword: string (required — min 8 chars)
 *   adminName?:    string
 *   userEmail?:    string (optional second test user)
 *   userPassword?: string
 *   pendingEmail?:    string (optional pending test user)
 *   pendingPassword?: string
 * }
 */
app.post('/admin/seed/bootstrap', requireAdmin, async (req, res) => {
  if (!ALLOW_SEED) {
    return res.status(403).json({
      error: 'Seed endpoints are disabled. Set ALLOW_SEED=true in env (dev/staging only).',
    });
  }
  if (!BOOTSTRAP_SECRET) {
    return res.status(403).json({ error: 'BOOTSTRAP_SECRET is not configured.' });
  }
  const clientSecret = req.headers['x-bootstrap-secret'];
  if (!clientSecret || clientSecret !== BOOTSTRAP_SECRET) {
    audit('bootstrap_auth_failed', { ip: req.ip });
    return res.status(403).json({ error: 'Invalid bootstrap secret.' });
  }

  const {
    adminEmail, adminPassword, adminName,
    userEmail, userPassword,
    pendingEmail, pendingPassword,
  } = req.body || {};

  if (!adminEmail || typeof adminEmail !== 'string' || !adminEmail.includes('@')) {
    return res.status(400).json({ error: 'adminEmail is required.' });
  }
  const pwErr = checkPassword(adminPassword);
  if (pwErr) return res.status(400).json({ error: `adminPassword: ${pwErr}` });

  const now   = Date.now();
  const results = [];

  async function upsertSeedUser(def) {
    const email = def.email.trim().toLowerCase();
    const existing = userStore.findUserByEmailOrId(email, def.id);

    // Safety: never overwrite a real (non-seeded) user's role or status
    if (existing && existing.seedTag !== SEED_TAG) {
      audit('bootstrap_skipped', { email, reason: 'real_user_exists', id: def.id });
      results.push({ email, action: 'skipped', reason: 'real_user_exists' });
      return;
    }

    const hash = await bcrypt.hash(def.password, BCRYPT_ROUNDS);
    const record = {
      id:             def.id,
      email:          email,
      name:           (def.name || '').trim() || null,
      passwordHash:   hash,
      role:           def.role,
      color:          def.color || '#6B7280',
      accountStatus:  def.accountStatus,
      approvalStatus: def.approvalStatus,
      emailVerifiedAt: now,
      approvedBy:     def.approvalStatus === 'approved' ? 'bootstrap' : null,
      approvedAt:     def.approvalStatus === 'approved' ? now : null,
      deniedAt:       null, deniedBy: null,
      createdAt:      existing?.createdAt || now,
      seedTag:        SEED_TAG,
    };

    const r = userStore.upsertSeedUser(record, SEED_TAG);
    if (r.skipped) {
      audit('bootstrap_skipped', { email, reason: r.reason, id: def.id });
      results.push({ email, action: 'skipped', reason: r.reason });
      return;
    }
    if (r.action === 'updated') {
      audit('bootstrap_updated', { userId: def.id, email, role: def.role, accountStatus: def.accountStatus });
      results.push({ email, action: 'updated' });
    } else {
      audit('bootstrap_created', { userId: def.id, email, role: def.role, accountStatus: def.accountStatus });
      results.push({ email, action: 'created' });
    }
  }

  // Bootstrap admin (superadmin, active)
  await upsertSeedUser({
    id: 'bootstrap-admin', email: adminEmail,
    name: adminName || 'Bootstrap Admin',
    password: adminPassword, role: 'superadmin', color: '#3C0A37',
    accountStatus: 'active', approvalStatus: 'approved',
  });

  // Optional approved test user
  if (userEmail && userPassword) {
    const upwErr = checkPassword(userPassword);
    if (!upwErr) {
      await upsertSeedUser({
        id: 'seed-approved-user', email: userEmail,
        name: 'Test User (Approved)',
        password: userPassword, role: 'user', color: '#4A7C59',
        accountStatus: 'active', approvalStatus: 'approved',
      });
    } else {
      results.push({ email: userEmail, action: 'skipped', reason: `password: ${upwErr}` });
    }
  }

  // Optional pending test user
  if (pendingEmail && pendingPassword) {
    const ppwErr = checkPassword(pendingPassword);
    if (!ppwErr) {
      await upsertSeedUser({
        id: 'seed-pending-user', email: pendingEmail,
        name: 'Test User (Pending)',
        password: pendingPassword, role: 'user', color: '#7A5C74',
        accountStatus: 'pending_admin_approval', approvalStatus: 'pending',
      });
    } else {
      results.push({ email: pendingEmail, action: 'skipped', reason: `password: ${ppwErr}` });
    }
  }

  audit('bootstrap_complete', { results });
  res.json({ ok: true, results });
});

/**
 * POST /admin/seed/reset
 * Resets ALL seed-tagged accounts back to their seed state.
 * Real users (no seedTag) are never touched.
 *
 * Same authentication as /admin/seed/bootstrap.
 * Body: same as bootstrap.
 */
app.post('/admin/seed/reset', requireAdmin, async (req, res) => {
  if (!ALLOW_SEED) {
    return res.status(403).json({ error: 'Seed endpoints are disabled.' });
  }
  if (!BOOTSTRAP_SECRET) {
    return res.status(403).json({ error: 'BOOTSTRAP_SECRET is not configured.' });
  }
  const clientSecret = req.headers['x-bootstrap-secret'];
  if (!clientSecret || clientSecret !== BOOTSTRAP_SECRET) {
    audit('seed_reset_auth_failed', { ip: req.ip });
    return res.status(403).json({ error: 'Invalid bootstrap secret.' });
  }

  const seedCount = userStore.deleteUsersWithSeedTag(SEED_TAG);
  const realUserCount = userStore.countUsers();
  audit('seed_reset_purged', { removedCount: seedCount, realUserCount });

  // Forward to bootstrap handler by calling req handler directly isn't clean;
  // instead, inline the same logic via the same route body
  res.json({
    ok: true,
    message: `Removed ${seedCount} seed accounts. Now call /admin/seed/bootstrap to recreate them.`,
    realUsersPreserved: realUserCount,
  });
});

/**
 * GET /admin/seed/status
 * Returns current state of all seed accounts (without passwords).
 * Useful for verifying seed state in CI/test pipelines.
 */
app.get('/admin/seed/status', requireAdmin, (req, res) => {
  if (!ALLOW_SEED) {
    return res.status(403).json({ error: 'Seed endpoints are disabled.' });
  }
  const clientSecret = req.headers['x-bootstrap-secret'];
  if (!BOOTSTRAP_SECRET || !clientSecret || clientSecret !== BOOTSTRAP_SECRET) {
    return res.status(403).json({ error: 'Invalid bootstrap secret.' });
  }

  const users = userStore
    .getAllUsers()
    .filter(u => u.seedTag === SEED_TAG)
    .map(({ passwordHash: _, ...u }) => u);

  res.json({
    ok: true,
    seedEnabled: ALLOW_SEED,
    accounts: users,
    count: users.length,
  });
});

// ── HEALTH ────────────────────────────────────────────────────────────────────
// ── AI ENDPOINTS ─────────────────────────────────────────────────────────────

/**
 * POST /ai/scan-receipt
 * Body: { b64, mediaType }
 * Auth: Bearer session token (any authenticated user)
 * Proxies to Anthropic Claude. ANTHROPIC_API_KEY never leaves the server.
 */
app.post('/ai/scan-receipt', scanLimiter, async (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(403).json({ error: 'No autorizado.' });
  const session = verifySessionToken(token);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Escaneo no disponible — configura ANTHROPIC_API_KEY en Render.' });
  }

  const { b64, mediaType } = req.body || {};
  if (!b64 || typeof b64 !== 'string') return res.status(400).json({ error: 'Falta b64.' });

  const ALLOWED = ['image/jpeg','image/png','image/webp','application/pdf'];
  const mime = (mediaType || 'image/jpeg').toLowerCase();
  if (!ALLOWED.includes(mime)) return res.status(400).json({ error: `Tipo no soportado: ${mime}` });
  if (b64.length > 5_600_000) return res.status(413).json({ error: 'Archivo demasiado grande (max ~4 MB).' });

  const isPdf = mime === 'application/pdf';
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mime,               data: b64 } };

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: [
          block,
          { type: 'text', text: 'Extract receipt data. Return ONLY valid JSON no markdown: {"amount":number,"description":"string","date":"YYYY-MM-DD","category":"Equipment|Supplies|Marketing|Legal|Rent|Software|Food & Beverage|Travel|Other"}' }
        ]}]
      })
    });

    if (!apiRes.ok) {
      const errMsg = apiRes.status === 401 ? 'Clave API inválida en servidor.' :
                     apiRes.status === 429 ? 'Límite de API alcanzado.' :
                     `Error API (${apiRes.status})`;
      audit('scan_api_error', { status: apiRes.status, userId: session.userId });
      return res.status(502).json({ error: errMsg });
    }

    const data = await apiRes.json();
    const txt = (data.content?.find(b => b.type === 'text')?.text || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(txt);
    audit('scan_success', { userId: session.userId });
    res.json({ ok: true, result: parsed });
  } catch (err) {
    audit('scan_error', { userId: session.userId, error: err.message });
    res.status(500).json({ error: 'Error al procesar el escaneo.' });
  }
});

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

// ── VERIFY PAGE HTML ──────────────────────────────────────────────────────────
// verifyPageHtml removed — email verification not used in this version.

// ── START ─────────────────────────────────────────────────────────────────────
const BACKUP_HOUR = 3;
let lastScheduledBackupUtcDate = null;

httpServer = app.listen(PORT, () => {
  console.log(`[SOLANA-AUTH] Server running on port ${PORT}`);
  console.log(`[SOLANA-AUTH] Admin email: ${ADMIN_EMAIL}`);
  console.log(`[SOLANA-AUTH] App URL: ${APP_URL}`);
  console.log(`[SOLANA-AUTH] Email: ${resend ? 'Resend active' : 'STUB (no RESEND_API_KEY)'}`);
  try {
    runBillMaintenance(audit);
  } catch (e) {
    console.error('[BILL-JOBS] startup:', e.message);
  }
  setInterval(() => {
    try {
      runBillMaintenance(audit);
    } catch (e) {
      console.error('[BILL-JOBS] interval:', e.message);
    }
  }, 24 * 60 * 60 * 1000).unref();

  setInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === BACKUP_HOUR && now.getUTCMinutes() < 1) {
      const d = now.toISOString().slice(0, 10);
      if (lastScheduledBackupUtcDate !== d) {
        lastScheduledBackupUtcDate = d;
        try {
          const r = backupMod.runBackup({ db });
          console.log('[backup] scheduled daily', r.filename, r.sizeBytes, 'bytes');
        } catch (e) {
          console.error('[backup] scheduled:', e.message);
        }
      }
    }
  }, 60_000).unref();
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
