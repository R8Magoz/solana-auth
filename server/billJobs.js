'use strict';

const crypto = require('crypto');
const db = require('./db');
const { nextDueDate, todayISO } = require('./recurrence');

/**
 * Mark pending bills past dueDate as overdue; spawn next recurring bill from paid rows.
 */
function runBillMaintenance(audit) {
  const today = todayISO();
  const now = Date.now();

  const od = db.prepare(`
    UPDATE bills SET status = 'overdue', updatedAt = ?
    WHERE status = 'pending' AND dueDate < ?
  `).run(now, today);
  if (od.changes > 0) {
    audit('bills_marked_overdue', { count: od.changes, asOf: today });
  }

  const paidRecurring = db.prepare(`
    SELECT * FROM bills WHERE recurring = 1 AND status = 'paid'
  `).all();

  const insertBill = db.prepare(`
    INSERT INTO bills (
      id, userId, vendor, amount, currency, amountEUR, category, dueDate, status,
      recurring, recurrenceRule, paidAt, paidBy, notes, createdAt, updatedAt
    ) VALUES (
      @id, @userId, @vendor, @amount, @currency, @amountEUR, @category, @dueDate, @status,
      @recurring, @recurrenceRule, @paidAt, @paidBy, @notes, @createdAt, @updatedAt
    )
  `);

  const clearRecurring = db.prepare(`UPDATE bills SET recurring = 0, updatedAt = ? WHERE id = ?`);

  for (const bill of paidRecurring) {
    if (!bill.recurrenceRule) continue;
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
      paidAt: null,
      paidBy: null,
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
