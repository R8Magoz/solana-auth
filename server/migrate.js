'use strict';

const fs = require('fs');
const path = require('path');
const { insertUsersFromJsonRows } = require('./userStore');

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

module.exports = { runUsersJsonMigration, migrateBillsToExpenses };

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
