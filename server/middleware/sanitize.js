'use strict';

const MAX_STRING_LEN = 4000;

/**
 * Recursively trims strings in a value, strips null bytes, and caps string length.
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let s = value.replace(/\0/g, '').trim();
    if (s.length > MAX_STRING_LEN) s = s.slice(0, MAX_STRING_LEN);
    return s;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = sanitizeValue(value[k]);
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
