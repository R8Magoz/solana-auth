'use strict';

const db = require('./db');

function userToParams(u) {
  return {
    id: u.id,
    email: (u.email || '').trim().toLowerCase(),
    name: u.name != null ? u.name : null,
    title: u.title != null ? u.title : '',
    phone: u.phone != null ? u.phone : '',
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
  if (row.tempPasswordExp != null) u.tempPasswordExp = row.tempPasswordExp;
  return u;
}

const INSERT_SQL = `
  INSERT INTO users (
    id, email, name, title, phone, passwordHash, role, color,
    accountStatus, approvalStatus, emailVerifiedAt, approvedBy, approvedAt,
    deniedAt, deniedBy, deniedReason, createdAt, seedTag, mustChangePassword, tempPasswordExp
  ) VALUES (
    @id, @email, @name, @title, @phone, @passwordHash, @role, @color,
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
  insertStmt.run(userToParams(u));
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

function getAllUsers() {
  return db.prepare('SELECT * FROM users').all().map(rowToUser);
}

function findUserByEmail(email) {
  const e = (email || '').trim().toLowerCase();
  return rowToUser(db.prepare('SELECT * FROM users WHERE email = ?').get(e));
}

function findUserById(id) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
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

function updatePasswordAfterChange(userId, passwordHash) {
  db.prepare(`
    UPDATE users SET passwordHash = ?, mustChangePassword = 0, tempPasswordExp = NULL WHERE id = ?
  `).run(passwordHash, userId);
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
  findUserByEmail,
  findUserById,
  findUserByEmailOrId,
  listUsersByAccountStatus,
  updatePasswordAfterChange,
  updateAdminTempPassword,
  updateUserApproved,
  updateUserDenied,
  replaceUserById,
  upsertSeedUser,
  deleteUsersWithSeedTag,
  countUsers,
  userToParams,
  rowToUser,
};
