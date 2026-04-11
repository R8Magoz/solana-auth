'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (ts, event, userId, targetId, detail, ip)
  VALUES (@ts, @event, @userId, @targetId, @detail, @ip)
`);

function write(event, data = {}) {
  const ts = typeof data.ts === 'string' ? data.ts : new Date().toISOString();
  const userId = data.userId != null ? String(data.userId) : null;
  const targetId = data.targetId != null ? String(data.targetId) : null;
  const ip = data.ip != null ? String(data.ip) : null;
  const copy = { ...data };
  delete copy.ts;
  delete copy.userId;
  delete copy.targetId;
  delete copy.ip;
  const detail = Object.keys(copy).length ? JSON.stringify(copy) : null;
  insertStmt.run({ ts, event, userId, targetId, detail, ip });
}

/**
 * One-time: import legacy audit.log lines into audit_log, then rename file.
 */
function migrateLegacyFile(auditFilePath) {
  const migratedPath = auditFilePath + '.migrated';
  if (!fs.existsSync(auditFilePath)) return;

  const existing = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
  if (existing > 0) return;

  let content;
  try {
    content = fs.readFileSync(auditFilePath, 'utf8');
  } catch (e) {
    console.error('[AUDIT-MIGRATE] read failed:', e.message);
    return;
  }

  const lines = content.split('\n').filter(Boolean);
  const run = db.transaction((items) => {
    for (const line of items) {
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = o.ts || new Date().toISOString();
      const event = o.event || 'legacy_unknown';
      const userId = o.userId != null ? String(o.userId) : null;
      const targetId = o.targetId != null ? String(o.targetId) : null;
      const ip = o.ip != null ? String(o.ip) : null;
      const rest = { ...o };
      delete rest.ts;
      delete rest.event;
      delete rest.userId;
      delete rest.targetId;
      delete rest.ip;
      const detail = Object.keys(rest).length ? JSON.stringify(rest) : null;
      insertStmt.run({ ts, event, userId, targetId, detail, ip });
    }
  });
  try {
    run(lines);
    fs.renameSync(auditFilePath, migratedPath);
    console.log('[AUDIT-MIGRATE] Imported legacy audit.log → audit_log; backup:', path.basename(migratedPath));
  } catch (e) {
    console.error('[AUDIT-MIGRATE] Failed:', e.message);
  }
}

function query({ limit = 50, offset = 0, event, userId } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const parts = [];
  const vals = [];
  if (event) {
    parts.push('event = ?');
    vals.push(String(event).trim().slice(0, 128));
  }
  if (userId) {
    parts.push('userId = ?');
    vals.push(String(userId).trim().slice(0, 128));
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${where}`).get(...vals).c;

  const rows = db.prepare(`
    SELECT id, ts, event, userId, targetId, detail, ip
    FROM audit_log ${where}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...vals, lim, off);

  const entries = rows.map((r) => {
    const entry = {
      id: r.id,
      ts: r.ts,
      event: r.event,
      userId: r.userId,
      targetId: r.targetId,
      ip: r.ip,
    };
    if (r.detail) {
      try {
        Object.assign(entry, JSON.parse(r.detail));
      } catch {
        entry.detailRaw = r.detail;
      }
    }
    return entry;
  });

  return { entries, total, limit: lim, offset: off };
}

module.exports = { write, migrateLegacyFile, query };
