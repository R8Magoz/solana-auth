'use strict';

/**
 * Off-disk SQLite backups via Cloudinary (raw upload).
 * Uses better-sqlite3 .backup() — safe while the DB is open.
 * Skips gracefully when CLOUDINARY_* env vars are absent.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { ensureCloudinary } = require('./receiptStorage');

const MAX_OFF_DISK_BACKUPS = 7;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function backupStamp() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}-${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}`;
}

function backupsFolder() {
  return (process.env.CLOUDINARY_BACKUPS_FOLDER || 'solana-db-backups').replace(/^\/+|\/+$/g, '');
}

function listCloudinaryRawResources(prefix) {
  return new Promise((resolve, reject) => {
    cloudinary.api.resources(
      {
        type: 'upload',
        resource_type: 'raw',
        prefix,
        max_results: 500,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result?.resources || []);
      },
    );
  });
}

function destroyCloudinaryRaw(publicId) {
  return new Promise((resolve) => {
    cloudinary.uploader.destroy(publicId, { resource_type: 'raw' }, () => resolve());
  });
}

function uploadRawFile(filePath, folder, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: 'raw',
        folder,
        public_id: publicId,
        overwrite: true,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
}

async function pruneOldOffDiskBackups(folder) {
  const prefix = `${folder}/`;
  const resources = await listCloudinaryRawResources(prefix);
  resources.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  for (let i = MAX_OFF_DISK_BACKUPS; i < resources.length; i++) {
    const pid = resources[i].public_id;
    if (pid) {
      await destroyCloudinaryRaw(pid);
    }
  }
  return Math.max(0, resources.length - MAX_OFF_DISK_BACKUPS);
}

/**
 * Create a SQLite backup with better-sqlite3 and upload to Cloudinary.
 * @param {{ db: import('better-sqlite3').Database }} opts
 * @returns {Promise<{ skipped?: true, reason?: string, filename?: string, sizeBytes?: number, url?: string, pruned?: number }>}
 */
async function runOffDiskBackup(opts = {}) {
  const { db } = opts;
  if (!db) {
    throw new Error('runOffDiskBackup requires an open db handle');
  }
  if (!ensureCloudinary()) {
    console.warn('[off-disk-backup] skipped: CLOUDINARY_* env vars not configured');
    return { skipped: true, reason: 'cloudinary_not_configured' };
  }

  const folder = backupsFolder();
  const stamp = backupStamp();
  const publicId = `solana-${stamp}`;
  const tmpPath = path.join(os.tmpdir(), `${publicId}.db`);

  try {
    await db.backup(tmpPath);
    const sizeBytes = fs.statSync(tmpPath).size;
    const result = await uploadRawFile(tmpPath, folder, publicId);
    const pruned = await pruneOldOffDiskBackups(folder);
    return {
      filename: `${publicId}.db`,
      publicId: result?.public_id || `${folder}/${publicId}`,
      sizeBytes,
      url: result?.secure_url || result?.url || null,
      pruned,
      timestamp: new Date().toISOString(),
    };
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {
      console.warn('[off-disk-backup] temp cleanup:', e.message);
    }
  }
}

module.exports = {
  runOffDiskBackup,
  MAX_OFF_DISK_BACKUPS,
  backupsFolder,
};
