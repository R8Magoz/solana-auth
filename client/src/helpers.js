/* ── HELPERS (currency, dates, amounts) — shared across AppBody.jsx ───────── */

const _settings = { currency: 'EUR', locale: 'es-ES' };

(function hydrateCurrencyFromLocalStorage() {
  try {
    const raw = localStorage.getItem('sol-currency');
    if (!raw) return;
    const code = JSON.parse(raw);
    if (typeof code === 'string' && /^[A-Za-z]{3}$/.test(code.trim())) {
      _settings.currency = code.trim().toUpperCase().slice(0, 3);
    }
  } catch {
    /* keep default */
  }
})();

/**
 * Apply server `app_settings` values used for Intl formatting (call after login or from /settings).
 * @param {{ currency?: unknown, locale?: unknown }} settingsObj
 */
export function applyServerSettings(settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object') return;
  if (settingsObj.currency != null) {
    const c = String(settingsObj.currency).trim().toUpperCase().slice(0, 3);
    if (/^[A-Z]{3}$/.test(c)) _settings.currency = c;
  }
  if (settingsObj.locale != null) {
    const L = String(settingsObj.locale).trim();
    if (L) _settings.locale = L;
  }
}

export function getCurrency() {
  return _settings.currency;
}

export const fmt = (n) =>
  new Intl.NumberFormat(_settings.locale, {
    style: 'currency',
    currency: _settings.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));

export const fmtKpi = (n) => {
  const full = fmt(n);
  const idx = full.lastIndexOf(',');
  if (idx === -1) return { whole: full, cents: '' };
  return { whole: full.slice(0, idx), cents: full.slice(idx) };
};

/** Presupuestos / informes: 2 decimales si |importe| < 100; sin céntimos si ≥ 100 o > 999. */
export function formatBudgetCurrency(amount) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  if (abs < 100) {
    return new Intl.NumberFormat(_settings.locale, {
      style: 'currency',
      currency: _settings.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }
  return new Intl.NumberFormat(_settings.locale, {
    style: 'currency',
    currency: _settings.currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export const BUDGET_VS_BAR_MAX_PX = 360;

export const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
};

// parseMoney: accepts "12,50" or "12.50" → 12.5 (shared utility used by all amount inputs)
export const parseMoney = (s) => {
  if (s === null || s === undefined || s === '') return 0;
  const n = String(s).trim().replace(/\./g, '').replace(',', '.');
  const v = parseFloat(n);
  return isNaN(v) ? 0 : v;
};

export const inits = (n) =>
  n
    .split(' ')
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
