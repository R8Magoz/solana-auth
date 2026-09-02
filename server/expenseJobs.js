'use strict';

const crypto = require('crypto');
const db = require('./db');
const { buildTraceCode } = require('./lib/traceCode');
const {
  todayISO,
  recurrenceEffectiveDate,
  buildMaterializedDateKeys,
  isRecurrenceSeriesActiveRow,
  dueOccurrenceDatesForMaterialization,
  occurrenceMaterializedKey,
} = require('./recurrence');

const insertMaterialized = db.prepare(`
  INSERT INTO expenses (
    id, userId, amount, currency, amountEUR, description, category, date, status,
    approvedBy, approvedAt, rejectedBy, rejectedAt, rejectionNote, receiptPath, notes, createdAt, updatedAt, departmentId,
    approversJson, approvalVotesJson, paidByJson, splitMode,
    ivaRate, ivaAmount, commentsJson, ownerId,
    expenseType, vendor, dueDate, deferredPayment, recurring, recurrenceRule, originBillId,
    cadenceKey, cadenceCustomMonths, clientRef, traceCode,
    recurrenceSeriesId, recurrenceAnchorDate, recurrenceEndDate, originRecurrenceId
  ) VALUES (
    @id, @userId, @amount, @currency, @amountEUR, @description, @category, @date, @status,
    @approvedBy, @approvedAt, @rejectedBy, @rejectedAt, @rejectionNote, @receiptPath, @notes, @createdAt, @updatedAt, @departmentId,
    @approversJson, @approvalVotesJson, @paidByJson, @splitMode,
    @ivaRate, @ivaAmount, @commentsJson, @ownerId,
    @expenseType, @vendor, @dueDate, @deferredPayment, @recurring, @recurrenceRule, @originBillId,
    @cadenceKey, @cadenceCustomMonths, @clientRef, @traceCode,
    @recurrenceSeriesId, @recurrenceAnchorDate, @recurrenceEndDate, @originRecurrenceId
  )
`);

/**
 * Auto-materialize due recurring occurrences as approved expenses (budget-eligible).
 * Idempotent per seriesId|occurrenceDate. Handles expenses (date) and invoices (dueDate).
 * @param {function(string, object): void} [audit]
 * @returns {{ created: number }}
 */
function runExpenseMaintenance(audit) {
  const today = todayISO();
  const allRows = db.prepare(
    'SELECT * FROM expenses WHERE status != \'deleted\'',
  ).all();
  const materializedKeys = buildMaterializedDateKeys(allRows);
  const anchors = allRows.filter((r) => isRecurrenceSeriesActiveRow(r, today));

  let created = 0;
  const now = Date.now();

  for (const anchor of anchors) {
    const seriesId = anchor.recurrenceSeriesId || anchor.id;
    const dueDates = dueOccurrenceDatesForMaterialization(anchor, materializedKeys, today);
    const isInv = String(anchor.expenseType || 'expense') === 'invoice';

    for (const dt of dueDates) {
      const id = `exp_${crypto.randomBytes(8).toString('hex')}`;
      const traceCodeVal = buildTraceCode(now, Number(anchor.amountEUR || anchor.amount || 0), id);
      const dateStr = isInv ? String(anchor.date || dt).slice(0, 10) : dt;
      const dueStr = isInv ? dt : null;

      try {
        insertMaterialized.run({
          id,
          userId: anchor.userId,
          amount: anchor.amount,
          currency: anchor.currency,
          amountEUR: anchor.amountEUR != null ? anchor.amountEUR : anchor.amount,
          description: anchor.description,
          category: anchor.category,
          date: dateStr,
          status: 'approved',
          approvedBy: 'auto',
          approvedAt: now,
          rejectedBy: null,
          rejectedAt: null,
          rejectionNote: null,
          receiptPath: null,
          notes: anchor.notes,
          createdAt: now,
          updatedAt: now,
          departmentId: anchor.departmentId,
          approversJson: anchor.approversJson || '[]',
          approvalVotesJson: anchor.approvalVotesJson || '{}',
          paidByJson: anchor.paidByJson || '[]',
          splitMode: anchor.splitMode,
          ivaRate: anchor.ivaRate,
          ivaAmount: anchor.ivaAmount,
          commentsJson: '[]',
          ownerId: anchor.ownerId || anchor.userId,
          expenseType: anchor.expenseType || 'expense',
          vendor: isInv ? anchor.vendor : null,
          dueDate: dueStr,
          deferredPayment: 0,
          recurring: 0,
          recurrenceRule: null,
          originBillId: null,
          cadenceKey: anchor.cadenceKey || 'once',
          cadenceCustomMonths: anchor.cadenceCustomMonths || '1',
          clientRef: null,
          traceCode: traceCodeVal,
          recurrenceSeriesId: seriesId,
          recurrenceAnchorDate: null,
          recurrenceEndDate: null,
          originRecurrenceId: anchor.id,
        });
      } catch (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
        console.error('[runExpenseMaintenance] insert failed', err);
        continue;
      }

      const key = occurrenceMaterializedKey(seriesId, dt);
      if (key) materializedKeys.add(key);
      created += 1;
      if (audit) {
        audit('recurrence_materialized', {
          targetId: id,
          seriesId,
          anchorId: anchor.id,
          occurrenceDate: dt,
          expenseType: anchor.expenseType || 'expense',
        });
      }
    }
  }

  return { created };
}

module.exports = { runExpenseMaintenance };
