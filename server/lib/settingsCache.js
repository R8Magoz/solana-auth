'use strict';

/** Cache TTL in milliseconds — after this, the next read re-fetches from SQLite synchronously. */
const CACHE_TTL_MS = 60_000;

/** @type {import('better-sqlite3').Database | null} */
let _db = null;

/** @type {Map<string, { value: unknown, missing: boolean, at: number }>} */
const keyMeta = new Map();

/** @type {{ map: Record<string, unknown> | null, at: number }} */
let fullSnapshot = { map: null, at: 0 };

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function setDb(db) {
  _db = db;
}

function parseValue(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function fetchOne(key) {
  if (!_db) throw new Error('settingsCache: setDb() not called');
  const row = _db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  if (!row || row.value == null) return undefined;
  return parseValue(row.value);
}

function fetchAllRows() {
  if (!_db) throw new Error('settingsCache: setDb() not called');
  const rows = _db.prepare('SELECT key, value FROM app_settings').all();
  const out = {};
  for (const r of rows) {
    out[r.key] = parseValue(r.value);
  }
  return out;
}

function stale(at) {
  return Date.now() - at >= CACHE_TTL_MS;
}

/**
 * Loads all app_settings rows into the cache (used at process startup).
 * @returns {void}
 */
function warmUp() {
  const all = fetchAllRows();
  const t = Date.now();
  keyMeta.clear();
  for (const k of Object.keys(all)) {
    keyMeta.set(k, { value: all[k], missing: false, at: t });
  }
  fullSnapshot = { map: { ...all }, at: t };
}

/**
 * Returns a parsed setting value, refreshing from SQLite when the entry is missing or past TTL.
 * @param {string} key
 * @param {unknown} defaultValue Returned when the key is absent from the database.
 * @returns {unknown}
 */
function get(key, defaultValue) {
  const k = String(key);
  const e = keyMeta.get(k);
  if (e && !stale(e.at)) {
    if (e.missing) return defaultValue;
    return e.value;
  }
  const v = fetchOne(k);
  if (v === undefined) {
    keyMeta.set(k, { value: undefined, missing: true, at: Date.now() });
    return defaultValue;
  }
  keyMeta.set(k, { value: v, missing: false, at: Date.now() });
  return v;
}

/**
 * Returns all settings as a plain object of parsed values, refreshing when the snapshot is stale.
 * @returns {Record<string, unknown>}
 */
function getAll() {
  if (fullSnapshot.map && !stale(fullSnapshot.at)) {
    return { ...fullSnapshot.map };
  }
  const all = fetchAllRows();
  const t = Date.now();
  fullSnapshot = { map: { ...all }, at: t };
  keyMeta.clear();
  for (const kk of Object.keys(all)) {
    keyMeta.set(kk, { value: all[kk], missing: false, at: t });
  }
  return { ...all };
}

/**
 * Drops cached entries so the next read reloads from SQLite. Omit `key` to clear everything.
 * @param {string} [key]
 * @returns {void}
 */
function invalidate(key) {
  if (key === undefined || key === null || key === '') {
    keyMeta.clear();
    fullSnapshot = { map: null, at: 0 };
    return;
  }
  keyMeta.delete(String(key));
  fullSnapshot = { map: null, at: 0 };
}

module.exports = {
  setDb,
  get,
  getAll,
  invalidate,
  warmUp,
  CACHE_TTL_MS,
};
