'use strict';

/**
 * Advance YYYY-MM-DD by recurrence rule (UTC calendar).
 */
function nextDueDate(isoDate, rule) {
  if (!isoDate || !rule) return null;
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  let y = parts[0];
  let m = parts[1] - 1;
  const d = parts[2];

  if (rule === 'monthly') m += 1;
  else if (rule === 'quarterly') m += 3;
  else if (rule === 'yearly') y += 1;
  else return null;

  const dt = new Date(Date.UTC(y, m, d));
  return dt.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { nextDueDate, todayISO };
