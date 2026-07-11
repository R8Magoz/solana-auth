'use strict';

/**
 * Canonical expense trace code: YYYYMMDD_HHMM_AMOUNTEUR_suffix
 *
 * - Generated once at expense creation from createdAt + amountEUR + id suffix.
 * - Uses UTC (matches receiptStorage / Cloudinary naming).
 * - NOT recomputed on amount edits — stored value is the trace key.
 */
function buildTraceCode(createdAtMs, amountEur, expenseId) {
  const ts = Number(createdAtMs);
  const d = new Date(Number.isFinite(ts) ? ts : Date.now());
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = d.toISOString().slice(11, 16).replace(':', '');
  const amt = Number(amountEur);
  const amountStr = `${(Number.isFinite(amt) ? amt : 0).toFixed(2)}EUR`;
  const base = `${dateStr}_${timeStr}_${amountStr}`;
  const id = String(expenseId || '').trim();
  if (!id) return base;
  const suffix = id.replace(/^exp_/, '').slice(0, 4).toLowerCase();
  return suffix ? `${base}_${suffix}` : base;
}

function sanitizeTraceCodeForPublicId(traceCode) {
  return String(traceCode || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 160);
}

module.exports = {
  buildTraceCode,
  sanitizeTraceCodeForPublicId,
};
