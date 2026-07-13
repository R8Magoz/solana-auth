'use strict';

const crypto = require('crypto');
const db = require('./db');
const { nextDueDate, todayISO } = require('./recurrence');

/**
 * Spawn next recurring bill by due date only.
 * Legacy payment fields remain in SQLite but recurrence no longer depends on payment state.
 */
function runBillMaintenance(audit) {
  const today = todayISO();
  const now = Date.now();

  const datedRecurring = db.prepare(`
    SELECT * FROM bills
    WHERE recurring = 1
      AND recurrenceRule IS NOT NULL
      AND dueDate IS NOT NULL
  `).all();

  const insertBill = db.prepare(`
    INSERT INTO bills (
      id, userId, vendor, amount, currency, amountEUR, category, dueDate, status,
      recurring, recurrenceRule, notes, createdAt, updatedAt
    ) VALUES (
      @id, @userId, @vendor, @amount, @currency, @amountEUR, @category, @dueDate, @status,
      @recurring, @recurrenceRule, @notes, @createdAt, @updatedAt
    )
  `);

  const clearRecurring = db.prepare(`UPDATE bills SET recurring = 0, updatedAt = ? WHERE id = ?`);

  for (const bill of datedRecurring) {
    const next = nextDueDate(bill.dueDate, bill.recurrenceRule);
    if (!next || next > today) continue;

    const newId = 'bill_' + crypto.randomBytes(8).toString('hex');
    insertBill.run({
      id: newId,
      userId: bill.userId,
      vendor: bill.vendor,
      amount: bill.amount,
      currency: bill.currency || 'EUR',
      amountEUR: bill.amountEUR,
      category: bill.category,
      dueDate: next,
      status: 'pending',
      recurring: 1,
      recurrenceRule: bill.recurrenceRule,
      notes: bill.notes || null,
      createdAt: now,
      updatedAt: now,
    });
    clearRecurring.run(now, bill.id);
    audit('bill_recurring_spawned', {
      userId: bill.userId,
      targetId: newId,
      sourceBillId: bill.id,
      dueDate: next,
    });
  }
}

module.exports = { runBillMaintenance };
