'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

/**
 * @param {object} deps
 * @returns {import('express').Router}
 */
function createAuthRouter(deps) {
  const {
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
  } = deps;

  const router = express.Router();

  /**
   * POST /auth/signup
   * Body: { email, password, name? }
   * Creates user in pending_admin_approval state immediately — no email verification.
   * Notifies admin by email. Returns generic success response.
   */
  router.post('/signup', signupLimiter, async (req, res) => {
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

    try {
      userStore.insertUser(newUser);
    } catch (e) {
      if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.json({ ok: true, message: 'Solicitud recibida. Un administrador aprobará tu acceso en breve.' });
      }
      throw e;
    }
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

  // If a stale link is clicked, return 410 Gone.
  router.get('/verify', (req, res) => {
    res.status(410).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Enlace no válido</h2><p>Este enlace ya no está activo. El acceso se gestiona directamente por el administrador.</p></body></html>');
  });

  /**
   * POST /auth/login
   * Body: { email, password }
   * Returns user object (without passwordHash) only if status === active.
   * All other statuses return 403 with a clear, non-leaky message.
   */
  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Datos incompletos.' });

    const normalEmail = email.trim().toLowerCase().slice(0, 254);
    const user  = userStore.findUserByEmail(normalEmail);

    // Always do a bcrypt compare to prevent timing attacks
    const dummyHash = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8I6e9vDOMkMt2rt7NmBGG99nmHn7uG';
    const hash = user?.passwordHash || dummyHash;
    let match = false;
    try {
      match = await bcrypt.compare(password, hash);
    } catch (err) {
      audit('login_failed', { email: normalEmail, ip: req.ip, reason: 'hash_compare_error' });
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

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

  router.post('/refresh', async (req, res) => {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No autorizado.' });
    const session = verifySessionToken(token, true); // true = allow grace period
    if (!session) return res.status(401).json({ error: 'Sesión expirada.' });
    const user = userStore.findUserByIdPublic(session.userId);
    if (!user || user.accountStatus !== 'active') {
      return res.status(403).json({ error: 'Cuenta no activa.' });
    }
    const newToken = signSessionToken(user.id, user.role);
    try { globalThis.sessionStorage?.setItem?.('sol-session-token', newToken); } catch (e) {}
    audit('session_refreshed', { userId: user.id });
    res.json({ ok: true, sessionToken: newToken, userId: user.id, role: user.role });
  });

  router.post('/logout', (req, res) => {
    // Stateless tokens — nothing to invalidate server-side.
    // Client removes the stored token.
    res.json({ ok: true });
  });

  router.get('/team', requireAuth, (req, res) => {
    const users = userStore
      .getAllUsersPublic()
      .filter(u => u.accountStatus === 'active');
    res.json({ ok: true, users });
  });

  /**
   * POST /auth/refresh
   * Bearer: valid token, or token expired within SESSION_REFRESH_GRACE_MS → new sessionToken (8h).
   */
  router.post('/refresh', (req, res) => {
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
  router.post('/logout', (req, res) => {
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
  router.get('/team', requireAuth, (req, res) => {
    try {
      const users = userStore.getAllUsersPublic();
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
  router.post('/change-password', async (req, res) => {
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

    const user = userStore.findUserById(uid);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    if (!user.mustChangePassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'La contraseña actual es obligatoria.' });
      }
      const currentMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!currentMatch) {
        audit('password_change_wrong_current', { userId: uid, ip: req.ip });
        return res.status(403).json({ error: 'La contraseña actual no es correcta.' });
      }
    }

    const pwError = checkPassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    userStore.updatePasswordAfterChange(uid, newHash);
    audit('password_changed', { userId: uid, ip: req.ip });
    res.json({ ok: true, message: 'Contraseña actualizada.' });
  });

  /**
   * PUT /auth/update-profile
   * Body: { name?, email?, phone?, avatar? } — authenticated user updates their own record only.
   */
  router.put('/update-profile', async (req, res) => {
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

    const me = userStore.findUserByIdPublic(session.userId);
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

    const fresh = userStore.findUserByIdPublic(session.userId);
    audit('profile_updated', { userId: session.userId, ip: req.ip });
    res.json({ ok: true, user: fresh });
  });

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
  router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
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
        const now = Date.now();
        const newAdmin = {
          id:               newAdminId,
          email:            adminEmail,
          name:             adminEmail.split('@')[0] || 'Administrator',
          passwordHash:     tempHash,
          tempPasswordExp:  tempExpiry,
          role:             'superadmin',
          color:            '#3C0A37',
          accountStatus:    'active',
          approvalStatus:   'approved',
          emailVerifiedAt:  now,
          approvedBy:       'system',
          approvedAt:       now,
          deniedAt:         null,
          deniedBy:         null,
          createdAt:        now,
        };
        try {
          userStore.insertUser(newAdmin);
        } catch (e) {
          if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
          }
          throw e;
        }
        audit('admin_user_created_on_reset', { userId: newAdminId, email: adminEmail });
      }

      const emailResult = await sendEmail({
        to: ADMIN_EMAIL,
        subject: 'Tu contraseña temporal — Solana',
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

  return router;
}

module.exports = { createAuthRouter };
