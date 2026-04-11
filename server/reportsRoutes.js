'use strict';

const express = require('express');
const db = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function eurAmount(row) {
  if (row.amountEUR != null && !Number.isNaN(Number(row.amountEUR))) {
    return Number(row.amountEUR);
  }
  const cur = String(row.currency || 'EUR').toUpperCase();
  if (cur === 'EUR') return Number(row.amount) || 0;
  return Number(row.amount) || 0;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function quarterLabelFromDate(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return 'export';
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const q = Math.floor((mo - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

function csvFilename(type, from, to) {
  const base =
    type === 'expenses' ? 'solana-expenses' : type === 'bills' ? 'solana-bills' : 'solana-all';
  const q1 = quarterLabelFromDate(from);
  const q2 = quarterLabelFromDate(to);
  if (q1 === q2) return `${base}-${q1}.csv`;
  return `${base}-${from}_to_${to}.csv`;
}

function csvEscape(val) {
  if (val == null || val === '') return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function line(vals) {
  return vals.map(csvEscape).join(',');
}

function buildUserMap(userStore) {
  const map = {};
  for (const u of userStore.getAllUsers()) {
    map[u.id] = (u.name && String(u.name).trim()) || u.email || u.id;
  }
  return map;
}

function validateRange(req, res) {
  const from = String(req.query.from ?? '').trim().slice(0, 10);
  const to = String(req.query.to ?? '').trim().slice(0, 10);
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    res.status(400).json({ error: 'Parámetros from y to obligatorios (YYYY-MM-DD).' });
    return null;
  }
  if (from > to) {
    res.status(400).json({ error: 'from no puede ser posterior a to.' });
    return null;
  }
  return { from, to };
}

function createReportsRouter({ requireAdminSession, userStore }) {
  const router = express.Router();
  router.use(requireAdminSession);

  router.get('/summary', (req, res) => {
    const range = validateRange(req, res);
    if (!range) return;

    const { from, to } = range;
    const userMap = buildUserMap(userStore);

    const expenses = db
      .prepare(
        `SELECT * FROM expenses
         WHERE date >= ? AND date <= ? AND status != 'deleted'
         ORDER BY date ASC`,
      )
      .all(from, to);

    const bills = db
      .prepare(
        `SELECT * FROM bills
         WHERE dueDate >= ? AND dueDate <= ? AND status != 'cancelled'
         ORDER BY dueDate ASC`,
      )
      .all(from, to);

    let totalExpenses = 0;
    const byCategory = {};
    const byUser = {};
    const byMonth = {};

    let approvedN = 0;
    let rejectedN = 0;

    for (const e of expenses) {
      const amt = eurAmount(e);
      totalExpenses += amt;
      const cat = e.category || '—';
      byCategory[cat] = (byCategory[cat] || 0) + amt;

      const uname = userMap[e.userId] || e.userId || '—';
      byUser[uname] = (byUser[uname] || 0) + amt;

      const monthKey = e.date && e.date.length >= 7 ? e.date.slice(0, 7) : '—';
      byMonth[monthKey] = (byMonth[monthKey] || 0) + amt;

      if (e.status === 'approved') approvedN += 1;
      else if (e.status === 'rejected') rejectedN += 1;
    }

    for (const k of Object.keys(byCategory)) byCategory[k] = roundMoney(byCategory[k]);
    for (const k of Object.keys(byUser)) byUser[k] = roundMoney(byUser[k]);
    for (const k of Object.keys(byMonth)) byMonth[k] = roundMoney(byMonth[k]);

    let totalBills = 0;
    for (const b of bills) {
      totalBills += eurAmount(b);
    }

    const expenseCount = expenses.length;
    const decided = approvedN + rejectedN;
    const approvalRate = decided > 0 ? Math.round((approvedN / decided) * 10000) / 10000 : null;
    const avgExpenseAmount =
      expenseCount > 0 ? Math.round((totalExpenses / expenseCount) * 100) / 100 : 0;

    res.json({
      totalExpenses: roundMoney(totalExpenses),
      totalBills: roundMoney(totalBills),
      currency: 'EUR',
      byCategory,
      byUser,
      byMonth,
      expenseCount,
      approvalRate,
      avgExpenseAmount,
    });
  });

  router.get('/export/csv', (req, res) => {
    const range = validateRange(req, res);
    if (!range) return;

    const type = String(req.query.type || 'expenses').trim().toLowerCase().slice(0, 16);
    if (!['expenses', 'bills', 'all'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser expenses, bills o all.' });
    }

    const { from, to } = range;
    const userMap = buildUserMap(userStore);
    const filename = csvFilename(type, from, to);

    const expenseRows = db
      .prepare(
        `SELECT * FROM expenses
         WHERE date >= ? AND date <= ?
         ORDER BY date ASC, id ASC`,
      )
      .all(from, to);

    const billRows = db
      .prepare(
        `SELECT * FROM bills
         WHERE dueDate >= ? AND dueDate <= ?
         ORDER BY dueDate ASC, id ASC`,
      )
      .all(from, to);

    const expCols = [
      'id',
      'userId',
      'userName',
      'amount',
      'currency',
      'amountEUR',
      'description',
      'category',
      'date',
      'status',
      'approvedBy',
      'approvedAt',
      'rejectedBy',
      'rejectedAt',
      'rejectionNote',
      'receiptPath',
      'notes',
      'createdAt',
      'updatedAt',
    ];

    const billCols = [
      'id',
      'userId',
      'userName',
      'vendor',
      'amount',
      'currency',
      'amountEUR',
      'category',
      'dueDate',
      'status',
      'recurring',
      'recurrenceRule',
      'paidAt',
      'paidBy',
      'notes',
      'createdAt',
      'updatedAt',
    ];

    const lines = [];

    function pushExpenses() {
      lines.push(line(expCols));
      for (const e of expenseRows) {
        const row = {
          id: e.id,
          userId: e.userId,
          userName: userMap[e.userId] || '',
          amount: e.amount,
          currency: e.currency,
          amountEUR: e.amountEUR,
          description: e.description,
          category: e.category,
          date: e.date,
          status: e.status,
          approvedBy: e.approvedBy,
          approvedAt: e.approvedAt,
          rejectedBy: e.rejectedBy,
          rejectedAt: e.rejectedAt,
          rejectionNote: e.rejectionNote,
          receiptPath: e.receiptPath,
          notes: e.notes,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        };
        lines.push(line(expCols.map((c) => row[c])));
      }
    }

    function pushBills() {
      lines.push(line(billCols));
      for (const b of billRows) {
        const row = {
          id: b.id,
          userId: b.userId,
          userName: userMap[b.userId] || '',
          vendor: b.vendor,
          amount: b.amount,
          currency: b.currency,
          amountEUR: b.amountEUR,
          category: b.category,
          dueDate: b.dueDate,
          status: b.status,
          recurring: b.recurring ? 1 : 0,
          recurrenceRule: b.recurrenceRule,
          paidAt: b.paidAt,
          paidBy: b.paidBy,
          notes: b.notes,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        };
        lines.push(line(billCols.map((c) => row[c])));
      }
    }

    if (type === 'expenses') {
      pushExpenses();
    } else if (type === 'bills') {
      pushBills();
    } else {
      pushExpenses();
      lines.push('');
      pushBills();
    }

    const body = `\uFEFF${lines.join('\r\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  });

  return router;
}

module.exports = { createReportsRouter };
