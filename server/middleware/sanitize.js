'use strict';

const MAX_STRING_LEN = 4000;

/**
 * Recursively trims strings in a value, strips null bytes, and caps string length.
 * Skips the length cap for known base64 payload fields and long base64-looking strings.
 * @param {unknown} value
 * @param {string|undefined} [key]
 * @returns {unknown}
 */
function sanitizeValue(value, key) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let s = value.replace(/\0/g, '').trim();
    // Skip length cap for base64 fields (receipts) — they can be 200KB+
    const isBase64Field = key === 'b64' || key === 'receipt' || key === 'base64';
    const looksLikeBase64 = s.length > 4000 && /^[A-Za-z0-9+/]+=*$/.test(s.slice(0, 100));
    if (!isBase64Field && !looksLikeBase64 && s.length > MAX_STRING_LEN) {
      s = s.slice(0, MAX_STRING_LEN);
    }
    return s;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = sanitizeValue(value[k], k);
    }
    return out;
  }
  return value;
}

/**
 * Express middleware: sanitizes `req.body` after JSON parsing (strings only, nested).
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function sanitizeRequestBody(req, _res, next) {
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body = sanitizeValue(req.body);
  }
  next();
}

module.exports = { sanitizeRequestBody, sanitizeValue, MAX_STRING_LEN };
