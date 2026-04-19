'use strict';

const db = require('./db');

const AVATAR_MAX_LEN = 500000;

function userToParams(u) {
  const av =
    u.avatar != null && String(u.avatar).trim() !== ''
      ? String(u.avatar).slice(0, AVATAR_MAX_LEN)
      : null;
  return {
    id: u.id,
    email: (u.email || '').trim().toLowerCase(),
    name: u.name != null ? u.name : null,
    title: u.title != null ? u.title : '',
    phone: u.phone != null ? u.phone : '',
    avatar: av,
    passwordHash: u.passwordHash,
    role: u.role != null ? u.role : 'user',
    color: u.color != null ? u.color : '#6B7280',
    accountStatus: u.accountStatus != null ? u.accountStatus : 'pending_admin_approval',
    approvalStatus: u.approvalStatus != null ? u.approvalStatus : 'pending',
    emailVerifiedAt: u.emailVerifiedAt != null ? Number(u.emailVerifiedAt) : null,
    approvedBy: u.approvedBy != null ? u.approvedBy : null,
    approvedAt: u.approvedAt != null ? Number(u.approvedAt) : null,
    deniedAt: u.deniedAt != null ? Number(u.deniedAt) : null,
    deniedBy: u.deniedBy != null ? u.deniedBy : null,
    deniedReason: u.deniedReason != null ? u.deniedReason : null,
    createdAt: Number(u.createdAt),
    seedTag: u.seedTag != null ? u.seedTag : null,
    mustChangePassword: u.mustChangePassword ? 1 : 0,
    tempPasswordExp: u.tempPasswordExp != null ? Number(u.tempPasswordExp) : null,
  };
}

function rowToUser(row) {
  if (!row) return null;
  const u = {
    id: row.id,
    email: row.email,
    name: row.name,
    title: row.title || '',
    phone: row.phone || '',
    passwordHash: row.passwordHash,
    role: row.role,
    color: row.color,
    accountStatus: row.accountStatus,
    approvalStatus: row.approvalStatus,
    emailVerifiedAt: row.emailVerifiedAt,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    deniedAt: row.deniedAt,
    deniedBy: row.deniedBy,
    deniedReason: row.deniedReason,
    createdAt: row.createdAt,
    seedTag: row.seedTag,
    mustChangePassword: !!row.mustChangePassword,
  };
  if (row.avatar != null && row.avatar !== '') u.avatar = row.avatar;
  if (row.tempPasswordExp != null) u.tempPasswordExp = row.tempPasswordExp;
  return u;
}

const INSERT_SQL = `
  INSERT INTO users (
    id, email, name, title, phone, avatar, passwordHash, role, color,
    accountStatus, approvalStatus, emailVerifiedAt, approvedBy, approvedAt,
    deniedAt, deniedBy, deniedReason, createdAt, seedTag, mustChangePassword, tempPasswordExp
  ) VALUES (
    @id, @email, @name, @title, @phone, @avatar, @passwordHash, @role, @color,
    @accountStatus, @approvalStatus, @emailVerifiedAt, @approvedBy, @approvedAt,
    @deniedAt, @deniedBy, @deniedReason, @createdAt, @seedTag, @mustChangePassword, @tempPasswordExp
  )
`;

const insertStmt = db.prepare(INSERT_SQL);

const updateFullStmt = db.prepare(`
  UPDATE users SET
    email = @email,
    name = @name,
    title = @title,
    phone = @phone,
    avatar = @avatar,
    passwordHash = @passwordHash,
    role = @role,
    color = @color,
    accountStatus = @accountStatus,
    approvalStatus = @approvalStatus,
    emailVerifiedAt = @emailVerifiedAt,
    approvedBy = @approvedBy,
    approvedAt = @approvedAt,
    deniedAt = @deniedAt,
    deniedBy = @deniedBy,
    deniedReason = @deniedReason,
    createdAt = @createdAt,
    seedTag = @seedTag,
    mustChangePassword = @mustChangePassword,
    tempPasswordExp = @tempPasswordExp
  WHERE id = @id
`);

function insertUser(u) {
  try {
    insertStmt.run(userToParams(u));
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const err = new Error('Ya existe un usuario con ese correo.');
      err.code = 'SQLITE_CONSTRAINT_UNIQUE';
      throw err;
    }
    throw e;
  }
}

/**
 * Bulk insert for migration (transaction). Expects legacy JSON user objects.
 */
function insertUsersFromJsonRows(users) {
  const run = db.transaction((list) => {
    for (const u of list) insertStmt.run(userToParams(u));
  });
  run(users);
}

function stripUserPublic(u) {
  if (!u) return null;
  const { passwordHash: _p, tempPasswordExp: _t, seedTag: _s, ...rest } = u;
  return rest;
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users').all().map(rowToUser);
}

function getAllUsersPublic() {
  return getAllUsers().map(stripUserPublic);
}

function findUserByEmail(email) {
  const e = (email || '').trim().toLowerCase();
  return rowToUser(db.prepare('SELECT * FROM users WHERE email = ?').get(e));
}

function findUserById(id) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function findUserByIdPublic(id) {
  return stripUserPublic(findUserById(id));
}

function findUserByEmailOrId(email, id) {
  const byId = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (byId) return rowToUser(byId);
  const e = (email || '').trim().toLowerCase();
  return rowToUser(db.prepare('SELECT * FROM users WHERE email = ?').get(e));
}

function listUsersByAccountStatus(status) {
  return db.prepare('SELECT * FROM users WHERE accountStatus = ?').all(status).map(rowToUser);
}

function listUsersByAccountStatusPublic(status) {
  return listUsersByAccountStatus(status).map(stripUserPublic);
}

/** Seed admin UI: rows with seedTag, no password fields (preserves seedTag in JSON). */
function listUsersBySeedTagForStatus(seedTag) {
  return db
    .prepare('SELECT * FROM users WHERE seedTag = ?')
    .all(seedTag)
    .map((row) => {
      const u = rowToUser(row);
      const { passwordHash: _p, tempPasswordExp: _t, ...rest } = u;
      return rest;
    });
}

function updatePasswordAfterChange(userId, passwordHash) {
  db.prepare(`
    UPDATE users SET passwordHash = ?, mustChangePassword = 0, tempPasswordExp = NULL WHERE id = ?
  `).run(passwordHash, userId);
}

/**
 * Self-service profile (name, email, phone, avatar). Caller must enforce email uniqueness.
 */
function updateOwnProfile(userId, { name, email, phone, avatar }) {
  const av =
    avatar != null && String(avatar).trim() !== ''
      ? String(avatar).slice(0, AVATAR_MAX_LEN)
      : null;
  db.prepare(
    `UPDATE users SET name = ?, email = ?, phone = ?, avatar = ? WHERE id = ?`,
  ).run(name, email, phone, av, userId);
}

/** Superadmin: set a new temp password and force change on next login. */
function setPasswordForceChange(userId, passwordHash) {
  db.prepare(
    `UPDATE users SET passwordHash = ?, mustChangePassword = 1, tempPasswordExp = NULL WHERE id = ?`,
  ).run(passwordHash, userId);
}

function updateAdminTempPassword(userId, passwordHash, tempExpiry) {
  db.prepare(`
    UPDATE users SET passwordHash = ?, tempPasswordExp = ? WHERE id = ?
  `).run(passwordHash, tempExpiry, userId);
}

function updateUserApproved(userId, approvedBy) {
  const now = Date.now();
  db.prepare(`
    UPDATE users SET
      accountStatus = 'active',
      approvalStatus = 'approved',
      approvedAt = ?,
      approvedBy = ?
    WHERE id = ?
  `).run(now, approvedBy || 'admin', userId);
}

function updateUserDenied(userId, deniedBy, reason) {
  const now = Date.now();
  db.prepare(`
    UPDATE users SET
      accountStatus = 'denied',
      approvalStatus = 'denied',
      deniedAt = ?,
      deniedBy = ?,
      deniedReason = ?
    WHERE id = ?
  `).run(now, deniedBy || 'admin', reason || null, userId);
}

function replaceUserById(u) {
  const p = userToParams(u);
  updateFullStmt.run(p);
}

const ALLOWED_ROLES = new Set(['user', 'admin', 'superadmin']);

/**
 * Superadmin patch of another user (preserves passwordHash and other auth fields).
 * @returns {{ ok: true, user: object } | { ok: false, error: string }}
 */
function adminPatchUser(targetId, body) {
  const u = findUserById(targetId);
  if (!u) return { ok: false, error: 'not_found' };
  const next = { ...u };
  if (body.name != null) {
    const n = String(body.name).trim().slice(0, 128);
    if (!n) return { ok: false, error: 'name_required' };
    next.name = n;
  }
  if (body.email != null) {
    next.email = String(body.email).trim().toLowerCase().slice(0, 254);
  }
  if (body.phone != null) next.phone = String(body.phone).trim().slice(0, 64);
  if (body.title != null) next.title = String(body.title).trim().slice(0, 128);
  if (body.color != null) next.color = String(body.color).trim().slice(0, 32);
  if (body.role != null) {
    const r = String(body.role).trim();
    if (!ALLOWED_ROLES.has(r)) return { ok: false, error: 'role_invalid' };
    next.role = r;
  }
  replaceUserById(next);
  return { ok: true, user: findUserByIdPublic(targetId) };
}

/**
 * Hard delete user row. Fails with FK if expenses reference this user.
 */
function deleteUserByIdHard(id) {
  try {
    const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { ok: r.changes > 0 };
  } catch (e) {
    if (e && (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || String(e.message || '').includes('FOREIGN KEY'))) {
      return { ok: false, reason: 'references' };
    }
    throw e;
  }
}

function upsertSeedUser(record, SEED_TAG) {
  const email = record.email.trim().toLowerCase();
  const existingById = db.prepare('SELECT * FROM users WHERE id = ?').get(record.id);
  const existingByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const existing = existingById || existingByEmail;

  if (existing && existing.seedTag !== SEED_TAG) {
    return { skipped: true, reason: 'real_user_exists' };
  }

  const p = userToParams(record);
  if (existing) {
    p.createdAt = existing.createdAt || p.createdAt;
    updateFullStmt.run(p);
    return { ok: true, action: 'updated' };
  }
  insertStmt.run(p);
  return { ok: true, action: 'created' };
}

function deleteUsersWithSeedTag(seedTag) {
  const info = db.prepare('DELETE FROM users WHERE seedTag = ?').run(seedTag);
  return info.changes;
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

module.exports = {
  insertUser,
  insertUsersFromJsonRows,
  getAllUsers,
  getAllUsersPublic,
  findUserByEmail,
  findUserById,
  findUserByIdPublic,
  findUserByEmailOrId,
  listUsersByAccountStatus,
  listUsersByAccountStatusPublic,
  listUsersBySeedTagForStatus,
  updatePasswordAfterChange,
  updateOwnProfile,
  setPasswordForceChange,
  updateAdminTempPassword,
  updateUserApproved,
  updateUserDenied,
  replaceUserById,
  adminPatchUser,
  deleteUserByIdHard,
  upsertSeedUser,
  deleteUsersWithSeedTag,
  countUsers,
  userToParams,
  rowToUser,
};
