'use strict';

/**
 * SQLite backups: solana.db → data/backups/solana-YYYY-MM-DD-HHmm.db
 * Keeps the 14 most recent backups (by mtime).
 *
 * From server: runBackup({ db }) — pass live better-sqlite3 handle for WAL checkpoint.
 * Standalone: node backup.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const LIVE_DB = path.join(DATA_DIR, 'solana.db');
const MAX_BACKUPS = 14;

const BACKUP_NAME_RE = /^solana-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * @param {{ db?: import('better-sqlite3').Database }} [opts]
 * @returns {{ ok: true, filename: string, sizeBytes: number }}
 */
function runBackup(opts = {}) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  if (!fs.existsSync(LIVE_DB)) {
    throw new Error(`Base de datos no encontrada: ${LIVE_DB}`);
  }

  if (opts.db) {
    try {
      opts.db.pragma('wal_checkpoint(FULL)');
    } catch (e) {
      console.warn('[backup] wal_checkpoint:', e.message);
    }
  }

  const now = new Date();
  const fname = `solana-${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}-${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}.db`;
  const dest = path.join(BACKUPS_DIR, fname);

  fs.copyFileSync(LIVE_DB, dest);
  const sizeBytes = fs.statSync(dest).size;

  pruneOldBackups();

  return { ok: true, filename: fname, sizeBytes };
}

function pruneOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => BACKUP_NAME_RE.test(f))
    .map((f) => {
      const full = path.join(BACKUPS_DIR, f);
      return { name: f, mtime: fs.statSync(full).mtimeMs, full };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (let i = MAX_BACKUPS; i < files.length; i++) {
    try {
      fs.unlinkSync(files[i].full);
    } catch (e) {
      console.warn('[backup] prune failed:', files[i].name, e.message);
    }
  }
}

/**
 * @returns {Array<{ filename: string, sizeBytes: number, modifiedAt: string }>}
 */
function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => BACKUP_NAME_RE.test(f))
    .map((f) => {
      const full = path.join(BACKUPS_DIR, f);
      const st = fs.statSync(full);
      return {
        filename: f,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/**
 * Resolve a backup filename to an absolute path under BACKUPS_DIR (no path traversal).
 * @param {string} filename
 * @returns {string}
 */
function resolveSafeBackupPath(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('filename es obligatorio.');
  }
  const base = path.basename(filename.trim());
  if (!BACKUP_NAME_RE.test(base)) {
    throw new Error('Nombre de copia no válido.');
  }
  const full = path.resolve(BACKUPS_DIR, base);
  const root = path.resolve(BACKUPS_DIR);
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new Error('Ruta no permitida.');
  }
  if (!fs.existsSync(full)) {
    throw new Error('Copia de seguridad no encontrada.');
  }
  return full;
}

/**
 * Replace live DB with a backup file. DB connections must be closed first.
 * Removes WAL/SHM siblings so SQLite starts clean.
 * @param {string} backupFullPath
 * @param {string} [livePath]
 */
function replaceLiveDatabase(backupFullPath, livePath = LIVE_DB) {
  const wal = `${livePath}-wal`;
  const shm = `${livePath}-shm`;
  try {
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
  } catch (e) {
    console.warn('[backup] unlink wal:', e.message);
  }
  try {
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  } catch (e) {
    console.warn('[backup] unlink shm:', e.message);
  }
  fs.copyFileSync(backupFullPath, livePath);
}

if (require.main === module) {
  const Database = require('better-sqlite3');
  if (!fs.existsSync(LIVE_DB)) {
    console.error('[backup] No database at', LIVE_DB);
    process.exit(1);
  }
  const db = new Database(LIVE_DB);
  try {
    const r = runBackup({ db });
    console.log('[backup] OK', r.filename, r.sizeBytes, 'bytes');
  } catch (e) {
    console.error('[backup]', e.message);
    process.exit(1);
  } finally {
    try {
      db.close();
    } catch (_) { /* ignore */ }
  }
  process.exit(0);
}

module.exports = {
  runBackup,
  listBackups,
  resolveSafeBackupPath,
  replaceLiveDatabase,
  DATA_DIR,
  BACKUPS_DIR,
  LIVE_DB,
  MAX_BACKUPS,
};
