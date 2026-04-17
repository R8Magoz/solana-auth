'use strict';

/** Supported recurrence rules (backend + UI cadence). */
const RULES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
/** Same cadence list, explicit export name for callers that expect RECURRENCE_RULES. */
const RECURRENCE_RULES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

/**
 * Advance YYYY-MM-DD by recurrence rule (UTC calendar).
 */
function nextDueDate(isoDate, rule) {
  if (!isoDate || !rule) return null;
  const r = String(rule).trim();
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  let y = parts[0];
  let m = parts[1] - 1;
  const d = parts[2];

  if (r === 'weekly') {
    const dt = new Date(Date.UTC(y, m, d));
    dt.setUTCDate(dt.getUTCDate() + 7);
    return dt.toISOString().slice(0, 10);
  }
  if (r === 'biweekly') {
    const dt = new Date(Date.UTC(y, m, d));
    dt.setUTCDate(dt.getUTCDate() + 14);
    return dt.toISOString().slice(0, 10);
  }
  if (r === 'monthly') m += 1;
  else if (r === 'quarterly') m += 3;
  else if (r === 'yearly') y += 1;
  else return null;

  const dt = new Date(Date.UTC(y, m, d));
  return dt.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { nextDueDate, todayISO, RULES, RECURRENCE_RULES };
