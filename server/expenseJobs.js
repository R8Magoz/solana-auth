'use strict';

const crypto = require('crypto');
const db = require('./db');
const { nextDueDate, todayISO } = require('./recurrence');

const insertSpawn = db.prepare(`
  INSERT INTO expenses (
    id, userId, amount, currency, amountEUR, description, category, date, status,
    approvedBy, approvedAt, rejectedBy, rejectedAt, rejectionNote, receiptPath, notes,
    createdAt, updatedAt, departmentId,
    approversJson, approvalVotesJson, paidByJson, splitMode,
    ivaRate, ivaAmount, commentsJson, ownerId,
    expenseType, vendor, dueDate,
    recurring, recurrenceRule, originBillId
  ) VALUES (
    @id, @userId, @amount, @currency, @amountEUR, @description, @category, @date, @status,
    @approvedBy, @approvedAt, @rejectedBy, @rejectedAt, @rejectionNote, @receiptPath, @notes,
    @createdAt, @updatedAt, @departmentId,
    @approversJson, @approvalVotesJson, @paidByJson, @splitMode,
    @ivaRate, @ivaAmount, @commentsJson, @ownerId,
    @expenseType, @vendor, @dueDate,
    @recurring, @recurrenceRule, @originBillId
  )
`);

/**
 * Spawn recurring expense rows (expenseType=expense, approved) by date only.
 * Legacy payment columns still exist in SQLite but are intentionally unused.
 */
function runExpenseMaintenance(audit) {
  const today = todayISO();
  const now = Date.now();

  const recurringApproved = db.prepare(`
    SELECT * FROM expenses
    WHERE recurring = 1
      AND expenseType = 'expense'
      AND status = 'approved'
  `).all();

  const clearRecurring = db.prepare(`UPDATE expenses SET recurring = 0, updatedAt = ? WHERE id = ?`);

  for (const exp of recurringApproved) {
    if (exp.expenseType === 'invoice') continue; // never spawn from invoice
    if (!exp.recurrenceRule) continue;
    const baseDate = exp.date;
    const next = nextDueDate(baseDate, exp.recurrenceRule);
    if (!next || next > today) continue;

    const newId = 'exp_' + crypto.randomBytes(8).toString('hex');
    insertSpawn.run({
      id: newId,
      userId: exp.userId,
      amount: exp.amount,
      currency: exp.currency || 'EUR',
      amountEUR: exp.amountEUR != null ? exp.amountEUR : null,
      description: exp.description,
      category: exp.category,
      date: next,
      status: 'submitted',
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionNote: null,
      receiptPath: null,
      notes: exp.notes || null,
      createdAt: now,
      updatedAt: now,
      departmentId: exp.departmentId || null,
      approversJson: exp.approversJson || '[]',
      approvalVotesJson: '{}',
      paidByJson: exp.paidByJson || null,
      splitMode: exp.splitMode || null,
      ivaRate: exp.ivaRate != null ? exp.ivaRate : null,
      ivaAmount: exp.ivaAmount != null ? exp.ivaAmount : null,
      commentsJson: '[]',
      ownerId: exp.ownerId || exp.userId,
      expenseType: 'expense',
      vendor: null,
      dueDate: null,
      recurring: 1,
      recurrenceRule: exp.recurrenceRule,
      originBillId: null,
    });
    clearRecurring.run(now, exp.id);
    audit('expense_recurring_spawned', {
      userId: exp.userId,
      targetId: newId,
      sourceExpenseId: exp.id,
      date: next,
    });
  }
}

module.exports = { runExpenseMaintenance };
