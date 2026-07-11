'use strict';

const db = require('../db');

function parseApproverIdsJson(raw) {
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const out = [];
    for (const x of parsed) {
      const id = String(x || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

/** Primary admin (bootstrap / oldest active admin) — not all admins. */
function resolvePrimaryAdminUserId(database = db) {
  const bootstrap = database
    .prepare("SELECT id FROM users WHERE id = 'bootstrap-admin' AND accountStatus = 'active' LIMIT 1")
    .get();
  if (bootstrap) return bootstrap.id;
  const oldest = database
    .prepare(
      `SELECT id FROM users
       WHERE role IN ('admin', 'superadmin') AND accountStatus = 'active'
       ORDER BY COALESCE(createdAt, 0) ASC, id ASC
       LIMIT 1`,
    )
    .get();
  if (oldest) return oldest.id;
  const any = database
    .prepare(
      "SELECT id FROM users WHERE role IN ('admin', 'superadmin') AND accountStatus = 'active' LIMIT 1",
    )
    .get();
  return any ? any.id : null;
}

function normalizeApproverIdsInput(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    const id = String(x || '').trim().slice(0, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 40) break;
  }
  return out;
}

function getDepartmentApproversMapFromSettings(database = db) {
  try {
    const row = database
      .prepare("SELECT value FROM app_settings WHERE key = 'department_approvers'")
      .get();
    if (!row || !row.value) return {};
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getApproverIdsForDepartmentId(departmentId, database = db) {
  const id = String(departmentId || '').trim();
  if (!id) {
    const primary = resolvePrimaryAdminUserId(database);
    return primary ? [primary] : [];
  }
  const row = database.prepare('SELECT approverIdsJson FROM departments WHERE id = ?').get(id);
  if (row) {
    const fromCol = parseApproverIdsJson(row.approverIdsJson);
    if (fromCol.length > 0) return fromCol;
  }
  const map = getDepartmentApproversMapFromSettings(database);
  const fromMap = map[id];
  if (Array.isArray(fromMap) && fromMap.length > 0) {
    return normalizeApproverIdsInput(fromMap);
  }
  const primary = resolvePrimaryAdminUserId(database);
  return primary ? [primary] : [];
}

function syncDepartmentApproversSettings(database = db) {
  const rows = database.prepare('SELECT id, approverIdsJson FROM departments').all();
  const map = {};
  for (const row of rows) {
    const ids = parseApproverIdsJson(row.approverIdsJson);
    if (ids.length > 0) map[row.id] = ids;
  }
  const settingsCache = require('./settingsCache');
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO app_settings (key, value, description, updatedBy, updatedAt)
       VALUES ('department_approvers', ?, 'Per-department designated approver user ids', 'system', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    )
    .run(JSON.stringify(map), now);
  settingsCache.invalidate('department_approvers');
  return map;
}

module.exports = {
  parseApproverIdsJson,
  resolvePrimaryAdminUserId,
  normalizeApproverIdsInput,
  getDepartmentApproversMapFromSettings,
  getApproverIdsForDepartmentId,
  syncDepartmentApproversSettings,
};
