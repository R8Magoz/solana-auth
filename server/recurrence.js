'use strict';

/** Supported recurrence rules (backend + UI cadence). */
const RULES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
/** Same cadence list, explicit export name for callers that expect RECURRENCE_RULES. */
const RECURRENCE_RULES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

/**
 * True if rule is a fixed RECURRENCE_RULES token or custom:Nmonths legacy / custom:N{weeks|months|years}.
 */
function isValidRecurrenceRule(rule) {
  const r = String(rule || '').trim();
  if (!r) return false;
  if (RECURRENCE_RULES.includes(r)) return true;
  if (/^custom:\d+$/.test(r)) return true;
  return /^custom:\d+(weeks|months|years)$/.test(r);
}

/**
 * Advance YYYY-MM-DD by recurrence rule (UTC calendar).
 */
function nextDueDate(isoDate, rule) {
  if (!isoDate || !rule) return null;
  const r = String(rule).trim();
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
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

  if (r.startsWith('custom:')) {
    const tail = r.slice(7);
    const match = tail.match(/^(\d+)(weeks|months|years)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2];
      const dt = new Date(Date.UTC(y, m, d));
      if (unit === 'weeks') {
        dt.setUTCDate(dt.getUTCDate() + n * 7);
        return dt.toISOString().slice(0, 10);
      }
      if (unit === 'months') {
        dt.setUTCMonth(dt.getUTCMonth() + n);
        return dt.toISOString().slice(0, 10);
      }
      if (unit === 'years') {
        dt.setUTCFullYear(dt.getUTCFullYear() + n);
        return dt.toISOString().slice(0, 10);
      }
    }
    const legacy = parseInt(tail, 10);
    const n = Number.isFinite(legacy) && legacy >= 1 ? legacy : 1;
    const dt2 = new Date(Date.UTC(y, m, d));
    dt2.setUTCMonth(dt2.getUTCMonth() + n);
    return dt2.toISOString().slice(0, 10);
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

module.exports = { nextDueDate, todayISO, RULES, RECURRENCE_RULES, isValidRecurrenceRule };
