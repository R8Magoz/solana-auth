'use strict';

const fs = require('fs');
const path = require('path');
const { insertUsersFromJsonRows } = require('./userStore');
const { DEFAULT_CATEGORY_EN_TO_ES } = require('./lib/defaultCategories');
const {
  parseApproverIdsJson,
  resolvePrimaryAdminUserId,
  normalizeApproverIdsInput,
  getDepartmentApproversMapFromSettings,
  syncDepartmentApproversSettings,
} = require('./lib/departmentApprovers');

/**
 * One-time migration: flat users.json → SQLite when the users table is empty.
 * Renames users.json → users.json.migrated after success (never delete).
 */
function runUsersJsonMigration({ dataDir, audit }) {
  const usersJsonPath = path.join(dataDir, 'users.json');
  const migratedPath = path.join(dataDir, 'users.json.migrated');

  if (!fs.existsSync(usersJsonPath)) return;

  const db = require('./db');
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  let users;
  try {
    users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
  } catch (e) {
    console.error('[MIGRATE] Failed to read users.json:', e.message);
    return;
  }

  if (!Array.isArray(users)) {
    console.error('[MIGRATE] users.json is not an array; skipping.');
    return;
  }

  try {
    insertUsersFromJsonRows(users);
  } catch (e) {
    console.error('[MIGRATE] Insert failed; leaving users.json untouched:', e.message);
    return;
  }

  try {
    fs.renameSync(usersJsonPath, migratedPath);
  } catch (e) {
    console.error('[MIGRATE] Data migrated but rename failed:', e.message);
    audit('migration_rename_failed', { error: e.message });
    return;
  }

  audit('migration_users_json_to_sqlite', {
    count: users.length,
    backup: 'users.json.migrated',
  });
  console.log(`[MIGRATE] Imported ${users.length} user(s) from users.json → SQLite; backup: users.json.migrated`);
}

/**
 * Idempotent: consolidate legacy superadmin → admin (runs every startup; no-op when none remain).
 */
function runRoleConsolidationMigration({ audit }) {
  const db = require('./db');
  const rows = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").all();
  if (!rows.length) return;
  const userIds = rows.map((r) => r.id);
  db.prepare("UPDATE users SET role = 'admin' WHERE role = 'superadmin'").run();
  audit('role_consolidation_superadmin_to_admin', { userIds, count: userIds.length });
  console.log(`[MIGRATE] Consolidated ${userIds.length} superadmin user(s) → admin`);
}

/**
 * One-time: move approval routing from category.approverIds to department_approvers map.
 * Strips legacy approverIds from categories JSON (categories list kept for expense labeling).
 */
function runDepartmentApproversMigration({ audit }) {
  const db = require('./db');
  const settingsCache = require('./lib/settingsCache');
  const now = Date.now();

  const catRow = db.prepare("SELECT value FROM app_settings WHERE key = 'categories'").get();
  if (catRow && catRow.value) {
    try {
      const cats = JSON.parse(catRow.value);
      if (Array.isArray(cats)) {
        const stripped = cats.map((c) => {
          const { approverIds, ...rest } = c && typeof c === 'object' ? c : {};
          return { ...rest, approverIds: [] };
        });
        const before = JSON.stringify(cats);
        const after = JSON.stringify(stripped);
        if (before !== after) {
          db.prepare(
            "UPDATE app_settings SET value = ?, updatedAt = ? WHERE key = 'categories'"
          ).run(after, now);
          settingsCache.invalidate('categories');
          audit('department_approvers_migration_categories_stripped', { count: cats.length });
          console.log('[MIGRATE] Stripped legacy category approverIds from app_settings.categories');
        }
      }
    } catch (e) {
      console.warn('[MIGRATE] category approver strip failed:', e.message);
    }
  }

  const exists = db.prepare("SELECT 1 FROM app_settings WHERE key = 'department_approvers'").get();
  if (!exists) {
    db.prepare(
      'INSERT INTO app_settings (key, value, description, updatedBy, updatedAt) VALUES (?, ?, ?, ?, ?)'
    ).run(
      'department_approvers',
      '{}',
      'Per-department designated approver user ids ({ departmentId: string[] })',
      'system',
      now,
    );
    settingsCache.invalidate('department_approvers');
    audit('department_approvers_key_seeded', {});
    console.log('[MIGRATE] Seeded app_settings.department_approvers');
  }
}

/**
 * Idempotent: populate departments.approverIdsJson from app_settings map or primary admin.
 */
function runDepartmentApproverIdsColumnMigration({ audit }) {
  const db = require('./db');
  const primaryAdminId = resolvePrimaryAdminUserId(db);
  if (!primaryAdminId) {
    console.warn('[MIGRATE] department approverIds: no active admin user — skipping defaults');
  }

  const legacyMap = getDepartmentApproversMapFromSettings(db);
  const depts = db.prepare('SELECT id, approverIdsJson FROM departments').all();
  let updated = 0;

  for (const dept of depts) {
    let ids = parseApproverIdsJson(dept.approverIdsJson);
    if (ids.length > 0) continue;

    const fromMap = legacyMap[dept.id];
    if (Array.isArray(fromMap) && fromMap.length > 0) {
      ids = normalizeApproverIdsInput(fromMap);
    } else if (primaryAdminId) {
      ids = [primaryAdminId];
    }

    if (ids.length === 0) continue;

    db.prepare('UPDATE departments SET approverIdsJson = ? WHERE id = ?').run(JSON.stringify(ids), dept.id);
    updated += 1;
  }

  if (updated > 0) {
    syncDepartmentApproversSettings(db);
    audit('department_approver_ids_column_migration', { departmentsUpdated: updated });
    console.log(`[MIGRATE] Set approverIdsJson on ${updated} department(s)`);
  }

  const orphan = db
    .prepare("SELECT COUNT(*) AS c FROM expenses WHERE departmentId IS NULL OR TRIM(departmentId) = ''")
    .get();
  if (orphan && orphan.c > 0) {
    audit('expenses_missing_department', { count: orphan.c });
    console.warn(`[MIGRATE] ${orphan.c} expense(s) without departmentId (approver fallback: primary admin only)`);
  }
}

/**
 * Idempotent: backfill expenses.traceCode from createdAt + amountEUR + id suffix.
 * Does not rename existing Cloudinary assets — stored code only for app/Excel lookup.
 */
function runTraceCodeMigration({ audit }) {
  const db = require('./db');
  const { buildTraceCode } = require('./lib/traceCode');
  const rows = db
    .prepare(
      "SELECT id, createdAt, amountEUR, amount, currency, traceCode FROM expenses WHERE traceCode IS NULL OR TRIM(traceCode) = ''",
    )
    .all();
  if (!rows.length) return;

  const update = db.prepare('UPDATE expenses SET traceCode = ? WHERE id = ?');
  let updated = 0;
  for (const row of rows) {
    let eur = row.amountEUR != null ? Number(row.amountEUR) : null;
    if (eur == null || !Number.isFinite(eur)) {
      const cur = String(row.currency || 'EUR').toUpperCase();
      eur = cur === 'EUR' ? Number(row.amount) || 0 : Number(row.amount) || 0;
    }
    const code = buildTraceCode(row.createdAt, eur, row.id);
    update.run(code, row.id);
    updated += 1;
  }

  if (updated > 0) {
    audit('trace_code_backfill', { count: updated });
    console.log(`[MIGRATE] Backfilled traceCode on ${updated} expense(s)`);
  }
}

/**
 * One-time: rename default English category names to Spanish in app_settings and expenses.
 * Only exact known English default names are remapped; custom categories are untouched.
 */
function runCategorySpanishMigration({ audit }) {
  const db = require('./db');
  const settingsCache = require('./lib/settingsCache');
  const now = Date.now();
  let expensesUpdated = 0;
  let categoriesRenamed = 0;

  const updateExpense = db.prepare('UPDATE expenses SET category = ? WHERE category = ?');
  for (const [en, es] of Object.entries(DEFAULT_CATEGORY_EN_TO_ES)) {
    if (en === es) continue;
    expensesUpdated += updateExpense.run(es, en).changes;
  }

  const catRow = db.prepare("SELECT value FROM app_settings WHERE key = 'categories'").get();
  if (catRow && catRow.value) {
    try {
      const cats = JSON.parse(catRow.value);
      if (Array.isArray(cats)) {
        let changed = false;
        const next = cats.map((c) => {
          if (!c || typeof c !== 'object') return c;
          const es = DEFAULT_CATEGORY_EN_TO_ES[c.name];
          if (es && es !== c.name) {
            changed = true;
            categoriesRenamed += 1;
            return { ...c, name: es };
          }
          return c;
        });
        if (changed) {
          db.prepare(
            "UPDATE app_settings SET value = ?, updatedAt = ? WHERE key = 'categories'",
          ).run(JSON.stringify(next), now);
          settingsCache.invalidate('categories');
        }
      }
    } catch (e) {
      console.warn('[MIGRATE] category Spanish rename failed:', e.message);
    }
  }

  if (expensesUpdated > 0 || categoriesRenamed > 0) {
    audit('category_spanish_migration', { expensesUpdated, categoriesRenamed });
    console.log(
      `[MIGRATE] Category Spanish: ${categoriesRenamed} setting(s), ${expensesUpdated} expense(s)`,
    );
  }
}

/**
 * One-time: copy bills → expenses as expenseType=invoice (idempotent via originBillId).
 * Does not DELETE or UPDATE the bills table.
 * Run: node migrate.js bills
 */
function migrateBillsToExpenses() {
  const db = require('./db');
  const now = Date.now();

  const pending = db.prepare(`
    SELECT b.* FROM bills b
    WHERE b.id NOT IN (SELECT e.originBillId FROM expenses e WHERE e.originBillId IS NOT NULL)
  `).all();

  const insert = db.prepare(`
    INSERT INTO expenses (
      id, userId, amount, currency, amountEUR, description, category, date, status,
      approvedBy, approvedAt, rejectedBy, rejectedAt, rejectionNote, receiptPath, notes,
      createdAt, updatedAt, departmentId,
      approversJson, approvalVotesJson, paidByJson, splitMode,
      ivaRate, ivaAmount, commentsJson, ownerId,
      expenseType, vendor, dueDate, paymentStatus, paidAt, paidConfirmedBy, paymentTermDays,
      recurring, recurrenceRule, originBillId
    ) VALUES (
      @id, @userId, @amount, @currency, @amountEUR, @description, @category, @date, @status,
      @approvedBy, @approvedAt, @rejectedBy, @rejectedAt, @rejectionNote, @receiptPath, @notes,
      @createdAt, @updatedAt, @departmentId,
      @approversJson, @approvalVotesJson, @paidByJson, @splitMode,
      @ivaRate, @ivaAmount, @commentsJson, @ownerId,
      @expenseType, @vendor, @dueDate, @paymentStatus, @paidAt, @paidConfirmedBy, @paymentTermDays,
      @recurring, @recurrenceRule, @originBillId
    )
  `);

  let count = 0;
  for (const b of pending) {
    const vendorStr = String(b.vendor || '').trim() || '—';
    const paymentStatus = b.status === 'paid' ? 'paid' : 'unpaid';
    const newId = `exp_migrated_${b.id}`;

    insert.run({
      id: newId,
      userId: b.userId,
      amount: b.amount,
      currency: b.currency || 'EUR',
      amountEUR: b.amountEUR != null ? b.amountEUR : null,
      description: vendorStr,
      vendor: vendorStr,
      category: b.category,
      date: b.dueDate,
      status: 'submitted',
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionNote: null,
      receiptPath: b.receiptPath || null,
      notes: b.notes != null ? String(b.notes) : null,
      createdAt: b.createdAt != null ? b.createdAt : now,
      updatedAt: b.updatedAt != null ? b.updatedAt : now,
      departmentId: b.departmentId || null,
      approversJson: b.approversJson || '[]',
      approvalVotesJson: b.approvalVotesJson || '{}',
      paidByJson: b.paidByJson || null,
      splitMode: b.splitMode || null,
      ivaRate: null,
      ivaAmount: null,
      commentsJson: '[]',
      ownerId: b.ownerId || b.userId,
      expenseType: 'invoice',
      dueDate: b.dueDate,
      paymentStatus,
      paidAt: b.paidAt != null ? b.paidAt : null,
      paidConfirmedBy: b.paidBy || null,
      paymentTermDays: 0,
      recurring: b.recurring != null ? b.recurring : 0,
      recurrenceRule: b.recurrenceRule || null,
      originBillId: b.id,
    });

    count += 1;
  }

  return count;
}

module.exports = {
  runUsersJsonMigration,
  runRoleConsolidationMigration,
  runDepartmentApproversMigration,
  runDepartmentApproverIdsColumnMigration,
  runTraceCodeMigration,
  runCategorySpanishMigration,
  migrateBillsToExpenses,
};

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'bills') {
    try {
      const n = migrateBillsToExpenses();
      console.log(`[MIGRATE] bills→expenses: ${n} row(s) inserted.`);
      process.exit(0);
    } catch (e) {
      console.error('[MIGRATE]', e.message || e);
      process.exit(1);
    }
  } else {
    console.log('Usage: node migrate.js bills');
    process.exit(cmd ? 1 : 0);
  }
}
