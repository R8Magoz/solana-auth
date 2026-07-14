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
  if (r === 'daily') {
    const dt = new Date(Date.UTC(y, m, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  }

  if (r.startsWith('custom:')) {
    const tail = r.slice(7);
    const match = tail.match(/^(\d+)(days|weeks|months|years)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2];
      const dt = new Date(Date.UTC(y, m, d));
      if (unit === 'days') {
        dt.setUTCDate(dt.getUTCDate() + n);
        return dt.toISOString().slice(0, 10);
      }
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

function addMonthsISO(isoDate, months) {
  if (!isoDate) return null;
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3) return null;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

/**
 * Effective calendar date for an expense row (invoice → dueDate).
 * @param {{ expenseType?: string, dueDate?: string|null, date?: string|null }} row
 */
function recurrenceEffectiveDate(row) {
  if (!row) return null;
  const isInv = String(row.expenseType || 'expense') === 'invoice';
  const raw = isInv ? (row.dueDate || row.date) : row.date;
  return raw ? String(raw).slice(0, 10) : null;
}

/**
 * List occurrence dates from anchor forward within [rangeStart, rangeEnd] (inclusive).
 * @param {string} anchorDate YYYY-MM-DD
 * @param {string} rule recurrence rule
 * @param {{ rangeStart?: string, rangeEnd?: string, endDate?: string|null, maxCount?: number }} [opts]
 */
function enumerateOccurrenceDates(anchorDate, rule, opts = {}) {
  const dates = [];
  if (!anchorDate || !rule) return dates;
  const rangeStart = opts.rangeStart || anchorDate;
  const rangeEnd = opts.rangeEnd;
  const endDate = opts.endDate ? String(opts.endDate).slice(0, 10) : null;
  const maxCount = opts.maxCount != null ? opts.maxCount : 400;
  let cur = anchorDate;
  const seen = new Set();
  while (dates.length < maxCount) {
    if (!cur || seen.has(cur)) break;
    seen.add(cur);
    if (endDate && cur > endDate) break;
    if (rangeEnd && cur > rangeEnd) break;
    if (cur >= rangeStart) dates.push(cur);
    const next = nextDueDate(cur, rule);
    if (!next || next === cur) break;
    cur = next;
  }
  return dates;
}

/**
 * Project virtual occurrences for an active recurring anchor.
 * @param {object} anchor expense row
 * @param {Set<string>} materializedKeys keys `${seriesId}|${YYYY-MM-DD}`
 * @param {{ rangeStart: string, rangeEnd: string }} range
 */
function projectOccurrences(anchor, materializedKeys, range) {
  if (!anchor || Number(anchor.recurring) !== 1 || !anchor.recurrenceRule) return [];
  const seriesId = anchor.recurrenceSeriesId || anchor.id;
  const anchorDate = anchor.recurrenceAnchorDate
    ? String(anchor.recurrenceAnchorDate).slice(0, 10)
    : recurrenceEffectiveDate(anchor);
  if (!anchorDate) return [];
  const endDate = anchor.recurrenceEndDate ? String(anchor.recurrenceEndDate).slice(0, 10) : null;
  const dates = enumerateOccurrenceDates(anchorDate, anchor.recurrenceRule, {
    rangeStart: range.rangeStart,
    rangeEnd: range.rangeEnd,
    endDate,
  });
  const out = [];
  for (const dt of dates) {
    const key = `${seriesId}|${dt}`;
    if (materializedKeys.has(key)) continue;
    out.push({
      seriesId,
      date: dt,
      virtual: true,
      anchorId: anchor.id,
      expenseType: anchor.expenseType || 'expense',
      amountEUR: anchor.amountEUR != null ? anchor.amountEUR : anchor.amount,
      label: String(anchor.expenseType || '') === 'invoice'
        ? (anchor.vendor || anchor.description || '')
        : (anchor.description || ''),
    });
  }
  return out;
}

module.exports = {
  nextDueDate,
  todayISO,
  addMonthsISO,
  RULES,
  RECURRENCE_RULES,
  isValidRecurrenceRule,
  recurrenceEffectiveDate,
  enumerateOccurrenceDates,
  projectOccurrences,
};
