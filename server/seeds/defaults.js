'use strict';

/**
 * Seeds default app_settings rows when the table is empty.
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function seedAppSettings(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM app_settings').get().c;
  if (count > 0) return;

  const now = Date.now();
  const insert = db.prepare(
    'INSERT INTO app_settings (key, value, description, updatedBy, updatedAt) VALUES (?, ?, ?, ?, ?)',
  );

  insert.run(
    'categories',
    JSON.stringify([
      { id: 'c1', name: 'Equipment', archived: false, approverIds: [] },
      { id: 'c2', name: 'Supplies', archived: false, approverIds: [] },
      { id: 'c3', name: 'Marketing', archived: false, approverIds: [] },
      { id: 'c4', name: 'Legal', archived: false, approverIds: [] },
      { id: 'c5', name: 'Rent', archived: false, approverIds: [] },
      { id: 'c6', name: 'Software', archived: false, approverIds: [] },
      { id: 'c7', name: 'Food & Beverage', archived: false, approverIds: [] },
      { id: 'c8', name: 'Travel', archived: false, approverIds: [] },
      { id: 'c9', name: 'Otro', archived: false, approverIds: [] },
    ]),
    'Expense categories available for selection',
    'system',
    now,
  );

  insert.run(
    'iva_rates',
    JSON.stringify([
      { value: 0, name: 'exento' },
      { value: 4, name: 'superreducido' },
      { value: 10, name: 'reducido' },
      { value: 21, name: 'general' },
    ]),
    'Available IVA/VAT rates',
    'system',
    now,
  );

  insert.run('iva_default', '21', 'Default IVA rate applied to new expenses', 'system', now);
  insert.run('currency', '"EUR"', 'Default currency for the app', 'system', now);

  insert.run(
    'company_name',
    JSON.stringify('Solana'),
    'Company name shown in reports and email footers',
    'system',
    now,
  );
  insert.run(
    'fiscal_year_start',
    JSON.stringify('01-01'),
    'Fiscal year start as MM-DD (e.g. 01-01 for January, 04-01 for April)',
    'system',
    now,
  );
  insert.run('payment_terms_days', '30', 'Default payment terms in days for invoices', 'system', now);
  insert.run('max_receipt_mb', '10', 'Maximum allowed receipt file size in MB', 'system', now);
  insert.run(
    'report_logo_url',
    JSON.stringify(''),
    'URL of logo to embed in PDF reports (leave empty to use text name)',
    'system',
    now,
  );
}

/**
 * Inserts missing app_settings keys for databases created before those keys existed.
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function ensureMissingAppSettings(db) {
  const insert = db.prepare(
    'INSERT INTO app_settings (key, value, description, updatedBy, updatedAt) VALUES (?, ?, ?, ?, ?)',
  );
  const now = Date.now();
  const rows = [
    ['company_name', JSON.stringify('Solana'), 'Company name shown in reports and email footers'],
    [
      'fiscal_year_start',
      JSON.stringify('01-01'),
      'Fiscal year start as MM-DD (e.g. 01-01 for January, 04-01 for April)',
    ],
    ['payment_terms_days', '30', 'Default payment terms in days for invoices'],
    ['max_receipt_mb', '10', 'Maximum allowed receipt file size in MB'],
    [
      'report_logo_url',
      JSON.stringify(''),
      'URL of logo to embed in PDF reports (leave empty to use text name)',
    ],
  ];
  for (const [key, value, description] of rows) {
    const exists = db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(key);
    if (!exists) insert.run(key, value, description, 'system', now);
  }
}

/**
 * Seeds default departments when the table is empty.
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function seedDepartmentsIfEmpty(db) {
  const _deptCount = db.prepare('SELECT COUNT(*) AS c FROM departments').get();
  if (_deptCount.c > 0) return;
  const now = Date.now();
  const ins = db.prepare(
    'INSERT INTO departments (id, name, budget, createdAt) VALUES (?, ?, ?, ?)',
  );
  ins.run('dept_branding', 'Branding', 10000, now);
  ins.run('dept_estrategia', 'Estrategia', 5000, now);
  ins.run('dept_operaciones', 'Operaciones', 3000, now);
}

/**
 * Runs default seed routines after schema and migrations (app_settings + departments).
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function seedDefaults(db) {
  seedAppSettings(db);
  ensureMissingAppSettings(db);
  seedDepartmentsIfEmpty(db);
}

module.exports = { seedDefaults, seedAppSettings, ensureMissingAppSettings, seedDepartmentsIfEmpty };
