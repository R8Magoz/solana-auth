'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const maintenanceLock = require('../lib/maintenanceLock');

/**
 * @param {object} deps
 * @returns {import('express').Router}
 */
function createAdminRouter(deps) {
  const {
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
    getHttpServer,
    serverEntryPath,
    serverCwd,
  } = deps;

  const router = express.Router();

  router.put('/users/:id', requireAdminSession, async (req, res) => {
    const id = String(req.params.id || '').trim();
    const { name, email, phone, title, role, color } = req.body || {};
    const user = userStore.findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (role) {
      // Only superadmin can change roles at all
      if (req.userRole !== 'superadmin') {
        return res.status(403).json({ error: 'Solo superadmin puede cambiar roles.' });
      }
      if (['user', 'admin', 'superadmin'].includes(role)) {
        user.role = role;
      }
    }
    if (name) user.name = String(name).trim().slice(0, 100);
    if (email) user.email = String(email).trim().toLowerCase().slice(0, 254);
    if (phone !== undefined) user.phone = String(phone || '').trim().slice(0, 30);
    if (title !== undefined) user.title = String(title || '').trim().slice(0, 100);
    if (color) user.color = String(color).trim().slice(0, 20);
    userStore.replaceUserById(user);
    audit('admin_user_updated', { targetId: id, by: req.userId });
    const { passwordHash: _, ...safeUser } = user;
    res.json({ ok: true, user: safeUser });
  });

  router.delete('/users/:id', requireAdminSession, (req, res) => {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Solo superadmin puede eliminar usuarios.' });
    }
    const id = String(req.params.id || '').trim();
    const removed = userStore.findUserByIdPublic(id);
    if (!removed) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (removed.id === req.userId) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo.' });
    }
    const del = userStore.deleteUserByIdHard(removed.id);
    if (!del.ok) {
      if (del.reason === 'references') {
        return res.status(409).json({ error: 'No se puede eliminar: el usuario tiene gastos o facturas asociados.' });
      }
      return res.status(500).json({ error: 'No se pudo eliminar.' });
    }
    audit('admin_user_deleted', { targetId: id, by: req.userId });
    res.json({ ok: true });
  });

  router.post('/users/:id/reset-password', requireAdminSession, async (req, res) => {
    const id = String(req.params.id || '').trim();
    const { tempPassword } = req.body || {};
    if (!tempPassword || tempPassword.length < 8) {
      return res.status(400).json({ error: 'Contraseña temporal: mínimo 8 caracteres.' });
    }
    const user = userStore.findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.id === req.userId) {
      return res.status(400).json({ error: 'Usa el formulario de cambio de contraseña.' });
    }
    user.passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS || 12);
    user.mustChangePassword = true;
    userStore.replaceUserById(user);
    audit('admin_reset_user_password', { targetId: id, by: req.userId });
    const { passwordHash: _, ...safeUser } = user;
    res.json({ ok: true, user: safeUser });
  });

  /**
   * POST /admin/users/create
   * Body: { name, email, tempPassword, role?, title?, phone?, color? }
   * Creates a new active user with a bcrypt-hashed temporary password.
   * Sets mustChangePassword: true so the user is forced to change on first login.
   */
  router.post('/users/create', requireAdminSession, async (req, res) => {
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

    try {
      userStore.insertUser(newUser);
    } catch (e) {
      if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
      }
      throw e;
    }
    audit('admin_created_user', { userId, email: normalEmail, role: newUser.role });

    // Return safe user (no passwordHash)
    const { passwordHash: _, ...safeUser } = newUser;
    res.json({ ok: true, user: safeUser });
  });

  /**
   * POST /admin/users/:id/reset-password
   * Superadmin only. Sets a new temporary password and mustChangePassword: true.
   */
  router.post('/users/:id/reset-password', requireAdminSession, async (req, res) => {
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

    const target = userStore.findUserByIdPublic(id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (target.id === req.userId) {
      return res.status(400).json({ error: 'Usa «Contraseña» en Ajustes para cambiar tu propia clave.' });
    }

    const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    userStore.setPasswordForceChange(id, hash);
    audit('admin_reset_user_password', { targetId: id, by: req.userId, ip: req.ip });
    const fresh = userStore.findUserByIdPublic(id);
    const { passwordHash: _, ...safeUser } = fresh;
    res.json({ ok: true, user: safeUser });
  });

  /**
   * PUT /admin/users/:id
   * Superadmin only. Updates name, email, phone, title, role, color (not password).
   */
  router.put('/users/:id', requireAdminSession, async (req, res) => {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Solo superadministrador.' });
    }
    const { id } = req.params;
    const body = req.body || {};
    const target = userStore.findUserByIdPublic(id);
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
    audit('admin_user_updated', { targetId: id, by: req.userId, ip: req.ip });
    res.json({ ok: true, user: result.user });
  });

  /**
   * DELETE /admin/users/:id
   * Superadmin only. Fails if expenses or bills still reference the user (SQLite FK).
   */
  router.delete('/users/:id', requireAdminSession, (req, res) => {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Solo superadministrador.' });
    }
    const { id } = req.params;
    if (id === req.userId) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta desde aquí.' });
    }
    const target = userStore.findUserByIdPublic(id);
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

  router.get('/users/pending', requireAdminSession, (req, res) => {
    const users = userStore.listUsersByAccountStatusPublic('pending_admin_approval');
    res.json({ users });
  });

  /**
   * GET /admin/users/all
   * Lists all registered users (no passwords).
   */
  router.get('/users/all', requireAdminSession, (req, res) => {
    const users = userStore.getAllUsersPublic();
    res.json({ users });
  });

  /**
   * POST /admin/users/:id/approve
   * Body: { adminId? }
   * Approves a user. Sets accountStatus = active. Sends access-granted email.
   */
  router.post('/users/:id/approve', requireAdminSession, async (req, res) => {
    const { id } = req.params;
    const { adminId } = req.body || {};

    const user  = userStore.findUserByIdPublic(id);

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
  router.post('/users/:id/deny', requireAdminSession, async (req, res) => {
    const { id } = req.params;
    const { adminId, reason } = req.body || {};
    const adminActor = adminId != null ? String(adminId).trim().slice(0, 128) : 'admin';
    const reasonClean = reason != null && String(reason).trim() !== ''
      ? String(reason).trim().slice(0, 2000)
      : null;

    const user  = userStore.findUserByIdPublic(id);

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

  router.post('/users/:id/suspend', requireAdminSession, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const user = userStore.findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.id === req.userId) {
      return res.status(400).json({ error: 'No puedes suspenderte a ti mismo.' });
    }
    user.accountStatus = 'denied';
    user.suspendedAt = Date.now();
    user.suspendedBy = req.userId;
    userStore.replaceUserById(user);
    audit('admin_suspended', { userId: user.id, email: user.email, by: req.userId });
    res.json({ ok: true, message: `Acceso de ${user.email} revocado.` });
  });

  router.post('/users/:id/restore', requireAdminSession, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const user = userStore.findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    user.accountStatus = 'active';
    user.approvalStatus = 'approved';
    delete user.suspendedAt;
    delete user.suspendedBy;
    userStore.replaceUserById(user);
    audit('admin_restored', { userId: user.id, email: user.email, by: req.userId });
    res.json({ ok: true });
  });

  /**
   * GET /admin/audit
   * Paginated audit log from SQLite: ?limit=50&offset=0&event=&userId=
   */
  router.get('/audit', requireAdminSession, (req, res) => {
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
  router.post('/backup', adminBackupLimiter, requireAdminSession, (req, res) => {
    try {
      const r = runBackup({ db });
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
  router.get('/backups', requireAdminSession, (req, res) => {
    const session = (() => {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      return verifySessionToken(token);
    })();
    if (!session || session.role !== 'superadmin') {
      return res.status(403).json({ error: 'Solo el superadmin puede ver copias de seguridad.' });
    }
    try {
      const backups = listBackups();
      res.json({ ok: true, backups });
    } catch (e) {
      console.error('[admin/backups]', e);
      res.status(500).json({ error: 'Error al listar copias.' });
    }
  });

  router.post('/backups/run', requireAdminSession, (req, res) => {
    const session = (() => {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      return verifySessionToken(token);
    })();
    if (!session || session.role !== 'superadmin') {
      return res.status(403).json({ error: 'Solo el superadmin puede ejecutar copias de seguridad.' });
    }
    try {
      const result = runBackup({ db });
      audit('backup_manual', { filename: result.filename, userId: session.userId });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/backups/download/:filename', requireAdminSession, (req, res) => {
    const session = (() => {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      return verifySessionToken(token);
    })();
    if (!session || session.role !== 'superadmin') {
      return res.status(403).json({ error: 'Solo el superadmin puede descargar copias de seguridad.' });
    }
    try {
      const fullPath = resolveSafeBackupPath(req.params.filename);
      res.download(fullPath, req.params.filename);
      audit('backup_downloaded', { filename: req.params.filename, userId: session.userId });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  /**
   * POST /admin/restore
   * Destructive: replaces live solana.db with a named backup. Requires X-Confirm: RESTORE.
   * Stops the HTTP server, closes DB, copies file, spawns a new process, exits.
   */
  router.post('/restore', requireAdminSession, (req, res) => {
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
      backupFull = resolveSafeBackupPath(filename);
    } catch (e) {
      return res.status(400).json({ error: e.message || 'filename inválido.' });
    }

    const baseName = path.basename(backupFull);
    audit('admin_restore_initiated', { filename: baseName, ip: req.ip });
    maintenanceLock.lock('restore');

    res.json({ ok: true, filename: baseName });

    res.on('finish', () => {
      getHttpServer().close(() => {
        let dbReplaced = false;
        try {
          try {
            db.close();
          } catch (e) {
            console.error('[RESTORE] db.close:', e.message);
          }
          replaceLiveDatabase(backupFull);
          dbReplaced = true;
          console.log('[RESTORE] Database replaced with', baseName, '— restarting');
          try {
            const child = spawn(process.argv[0], [serverEntryPath], {
              cwd: serverCwd,
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
        } catch (e) {
          console.error('[RESTORE] copy failed:', e);
          process.exit(1);
        } finally {
          if (!dbReplaced) {
            maintenanceLock.unlock();
          }
        }
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
  router.post('/seed/bootstrap', requireAdminSession, async (req, res) => {
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
  router.post('/seed/reset', requireAdminSession, async (req, res) => {
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
  router.get('/seed/status', requireAdminSession, (req, res) => {
    if (!ALLOW_SEED) {
      return res.status(403).json({ error: 'Seed endpoints are disabled.' });
    }
    const clientSecret = req.headers['x-bootstrap-secret'];
    if (!BOOTSTRAP_SECRET || !clientSecret || clientSecret !== BOOTSTRAP_SECRET) {
      return res.status(403).json({ error: 'Invalid bootstrap secret.' });
    }

    const users = userStore.listUsersBySeedTagForStatus(SEED_TAG);

    res.json({
      ok: true,
      seedEnabled: ALLOW_SEED,
      accounts: users,
      count: users.length,
    });
  });

  return router;
}

module.exports = { createAdminRouter };
