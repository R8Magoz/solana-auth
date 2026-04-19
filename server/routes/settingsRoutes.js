'use strict';

const express = require('express');
const settingsCache = require('../lib/settingsCache');

const NUMERIC_SUFFIXES = ['_threshold', '_days', '_mb', '_above'];
const MAX_SERIALIZED_LEN = 4000;

function keyNeedsNonNegativeNumber(key) {
  return NUMERIC_SUFFIXES.some((s) => key.endsWith(s));
}

function isValidFiscalYearStart(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(t)) return false;
  const [mm, dd] = t.split('-').map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  return true;
}

function validateAllowedCurrencies(value) {
  if (!Array.isArray(value)) return { ok: false, error: 'allowed_currencies debe ser un array.' };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (typeof c !== 'string' || !/^[A-Za-z]{3}$/.test(c.trim())) {
      return { ok: false, error: `Moneda inválida en posición ${i}: se requieren códigos ISO 4217 de 3 letras.` };
    }
  }
  const normalized = value.map((c) => c.trim().toUpperCase());
  return { ok: true, normalized };
}

/**
 * Validates body `value` for PUT /settings/:key and returns serialized TEXT for SQLite.
 * @returns {{ ok: true, serialized: string } | { ok: false, error: string }}
 */
function validateSettingValue(key, value) {
  if (value === undefined) {
    return { ok: false, error: 'value es obligatorio.' };
  }

  if (keyNeedsNonNegativeNumber(key)) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'El valor debe ser un número finito ≥ 0.' };
    }
    return { ok: true, serialized: JSON.stringify(n) };
  }

  if (key === 'fiscal_year_start') {
    let s = value;
    if (typeof s !== 'string') {
      return { ok: false, error: 'fiscal_year_start debe ser texto en formato MM-DD.' };
    }
    s = s.trim();
    if (!isValidFiscalYearStart(s)) {
      return { ok: false, error: 'fiscal_year_start debe ser MM-DD (ej. 01-01 o 04-01).' };
    }
    return { ok: true, serialized: JSON.stringify(s) };
  }

  if (key === 'allowed_currencies') {
    const v = validateAllowedCurrencies(value);
    if (!v.ok) return v;
    return { ok: true, serialized: JSON.stringify(v.normalized) };
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (e) {
    return { ok: false, error: 'Valor no serializable a JSON.' };
  }
  if (serialized.length > MAX_SERIALIZED_LEN) {
    return { ok: false, error: `Valor demasiado largo (máx. ${MAX_SERIALIZED_LEN} caracteres serializados).` };
  }
  return { ok: true, serialized };
}

function parseStoredValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * @param {object} deps
 * @returns {import('express').Router}
 */
function readNumericSetting(db, key, defaultVal) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    if (!row || row.value == null || row.value === '') return defaultVal;
    let raw = row.value;
    try {
      raw = JSON.parse(raw);
    } catch {
      /* plain string number */
    }
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(n)) return defaultVal;
    return n;
  } catch {
    return defaultVal;
  }
}

function readCurrencyCodeFromCache() {
  const v = settingsCache.get('currency', 'EUR');
  const s = typeof v === 'string' ? v.trim().toUpperCase().slice(0, 3) : 'EUR';
  return /^[A-Z]{3}$/.test(s) ? s : 'EUR';
}

function createSettingsRouter(deps) {
  const { db, requireAdminSession, requireAuth, audit } = deps;
  const router = express.Router();

  const stmtSelectKeys = db.prepare('SELECT key FROM app_settings WHERE key = ?');
  const stmtSchema = db.prepare(
    'SELECT key, value, description, updatedBy, updatedAt FROM app_settings ORDER BY key',
  );
  const stmtUpdate = db.prepare(`
    UPDATE app_settings
    SET value = @value, updatedBy = @updatedBy, updatedAt = @updatedAt
    WHERE key = @key
  `);

  // GET /settings/public — numeric thresholds for expense forms (no auth; safe to expose)
  router.get('/settings/public', (req, res) => {
    res.json({
      approval_threshold: readNumericSetting('approval_threshold', 0),
      require_receipt_above: readNumericSetting('require_receipt_above', 50),
      currency: readCurrencyCodeFromCache(),
    });
  });

  // GET /settings/schema — full rows for superadmin UI (register before /settings/:key patterns)
  router.get('/settings/schema', requireAdminSession, (req, res) => {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Solo el superadmin puede ver el esquema de ajustes.' });
    }
    const rows = stmtSchema.all();
    const out = rows.map((row) => ({
      key: row.key,
      value: parseStoredValue(row.value),
      description: row.description ?? null,
      updatedBy: row.updatedBy ?? null,
      updatedAt: row.updatedAt ?? null,
    }));
    res.json({ ok: true, schema: out });
  });

  // GET /settings — returns all app_settings as { key: parsedValue } (any authenticated user; needed for client formatting)
  router.get('/settings', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM app_settings').all();
    const out = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        out[row.key] = row.value;
      }
    }
    res.json({ ok: true, settings: out });
  });

  // PUT /settings/:key — update a single setting (key must already exist in app_settings)
  router.put('/settings/:key', requireAdminSession, (req, res) => {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Solo el superadmin puede modificar ajustes.' });
    }

    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ error: 'Clave no válida.' });
    }

    if (!stmtSelectKeys.get(key)) {
      return res.status(400).json({ error: 'Clave de ajuste no registrada en la base de datos.' });
    }

    const { value } = req.body || {};
    const validated = validateSettingValue(key, value);
    if (!validated.ok) {
      return res.status(400).json({ error: validated.error });
    }

    const now = Date.now();
    const info = stmtUpdate.run({
      value: validated.serialized,
      updatedBy: req.userId,
      updatedAt: now,
      key,
    });
    if (info.changes === 0) {
      return res.status(400).json({ error: 'No se pudo actualizar el ajuste.' });
    }

    audit('setting_updated', { key, userId: req.userId });
    settingsCache.invalidate(key);
    let parsed;
    try {
      parsed = JSON.parse(validated.serialized);
    } catch {
      parsed = validated.serialized;
    }
    res.json({ ok: true, key, value: parsed });
  });

  return router;
}

module.exports = { createSettingsRouter };
