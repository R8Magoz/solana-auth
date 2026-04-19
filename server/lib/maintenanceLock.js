'use strict';

const fs = require('fs');
const path = require('path');

function dataDir() {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'data');
}

function lockPath() {
  return path.join(dataDir(), 'maintenance.lock');
}

function isLocked() {
  try {
    return fs.existsSync(lockPath());
  } catch {
    return false;
  }
}

/**
 * @param {string} [reason]
 */
function lock(reason) {
  const p = lockPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, String(reason != null ? reason : ''), 'utf8');
}

function unlock() {
  try {
    fs.unlinkSync(lockPath());
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }
}

module.exports = { isLocked, lock, unlock };
