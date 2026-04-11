'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO4217 = /^[A-Z]{3}$/;

function isAdminRole(role) {
  return role === 'admin' || role === 'superadmin';
}

function rowToBill(r) {
  return r ? { ...r, recurring: !!r.recurring } : null;
}

function getBillById(id) {
  return rowToBill(db.prepare('SELECT * FROM bills WHERE id = ?').get(id));
}

function canAccessBill(req, bill) {
  if (!bill) return false;
  if (isAdminRole(req.userRole)) return true;
  return bill.userId === req.userId;
}

function departmentIdFromBody(body, required) {
  const raw = body && Object.prototype.hasOwnProperty.call(body, 'departmentId')
    ? body.departmentId
    : undefined;
  if (raw == null || raw === '') {
    if (required) return { error: 'departmentId requerido.' };
    return { id: null };
  }
  const id = String(raw).trim().slice(0, 128);
  const row = db.prepare('SELECT id FROM departments WHERE id = ?').get(id);
  if (!row) return { error: 'Departamento no válido.' };
  return { id };
}

function listBills(req) {
  const admin = isAdminRole(req.userRole);
  const { status, from, to, category, userId: qUser } = req.query;
  const parts = ['1=1'];
  const vals = [];

  if (!admin) {
    parts.push('userId = ?');
    vals.push(req.userId);
  } else if (qUser) {
    parts.push('userId = ?');
    vals.push(String(qUser).trim().slice(0, 128));
  }

  if (status) {
    parts.push('status = ?');
    vals.push(String(status).trim().slice(0, 32));
  }
  if (from) {
    parts.push('dueDate >= ?');
    vals.push(String(from).trim().slice(0, 10));
  }
  if (to) {
    parts.push('dueDate <= ?');
    vals.push(String(to).trim().slice(0, 10));
  }
  if (category) {
    parts.push('category = ?');
    vals.push(String(category).trim().slice(0, 128));
  }

  const sql = `SELECT * FROM bills WHERE ${parts.join(' AND ')} ORDER BY dueDate ASC, createdAt DESC`;
  return db.prepare(sql).all(...vals).map(rowToBill);
}

const insertBill = db.prepare(`
  INSERT INTO bills (
    id, userId, vendor, amount, currency, amountEUR, category, dueDate, status,
    recurring, recurrenceRule, paidAt, paidBy, notes, createdAt, updatedAt, departmentId
  ) VALUES (
    @id, @userId, @vendor, @amount, @currency, @amountEUR, @category, @dueDate, @status,
    @recurring, @recurrenceRule, @paidAt, @paidBy, @notes, @createdAt, @updatedAt, @departmentId
  )
`);

function createBillsRouter({ audit, requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    try {
      const bills = listBills(req);
      res.json({ bills });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al listar facturas.' });
    }
  });

  router.post('/', (req, res) => {
    const {
      vendor, amount, currency, amountEUR, category, dueDate, notes,
      recurring, recurrenceRule,
    } = req.body || {};
    const dept = departmentIdFromBody(req.body, true);
    if (dept.error) return res.status(400).json({ error: dept.error });

    const vendorStr = typeof vendor === 'string' ? vendor.trim().slice(0, 256) : '';
    const categoryStr = typeof category === 'string' ? category.trim().slice(0, 128) : '';
    const dueStr = typeof dueDate === 'string' ? dueDate.trim().slice(0, 10) : '';
    if (!vendorStr) {
      return res.status(400).json({ error: 'vendor requerido.' });
    }
    if (amount == null || typeof amount !== 'number' || !Number.isFinite(amount)) {
      return res.status(400).json({ error: 'amount numérico requerido.' });
    }
    if (!categoryStr) {
      return res.status(400).json({ error: 'category requerida.' });
    }
    if (!DATE_RE.test(dueStr)) {
      return res.status(400).json({ error: 'dueDate debe ser YYYY-MM-DD.' });
    }
    const cur = String(currency || 'EUR').trim().toUpperCase().slice(0, 3);
    if (!ISO4217.test(cur)) {
      return res.status(400).json({ error: 'currency inválida (ISO 4217).' });
    }
    const rec = recurring === true || recurring === 1 || recurring === '1';
    let rule = recurrenceRule != null ? String(recurrenceRule).trim().slice(0, 32) : null;
    if (rec) {
      if (!rule || !['monthly', 'quarterly', 'yearly'].includes(rule)) {
        return res.status(400).json({ error: 'recurrenceRule: monthly | quarterly | yearly' });
      }
    } else {
      rule = null;
    }

    let eur = amountEUR != null && typeof amountEUR === 'number' ? amountEUR : null;
    if (cur === 'EUR') eur = amount;

    const now = Date.now();
    const id = 'bill_' + crypto.randomBytes(8).toString('hex');

    insertBill.run({
      id,
      userId: req.userId,
      vendor: vendorStr,
      amount,
      currency: cur,
      amountEUR: eur,
      category: categoryStr,
      dueDate: dueStr,
      status: 'pending',
      recurring: rec ? 1 : 0,
      recurrenceRule: rule,
      paidAt: null,
      paidBy: null,
      notes: notes != null ? String(notes).trim().slice(0, 4000) : null,
      createdAt: now,
      updatedAt: now,
      departmentId: dept.id,
    });

    const bill = getBillById(id);
    audit('bill_created', { userId: req.userId, targetId: id, vendor: bill.vendor });
    res.json({ ok: true, bill });
  });

  router.put('/:id', (req, res) => {
    const bill = getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (!canAccessBill(req, bill)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }

    const {
      vendor, amount, category, dueDate, notes, status,
      recurring, recurrenceRule,
    } = req.body || {};

    let nextDeptId = bill.departmentId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'departmentId')) {
      const dept = departmentIdFromBody(req.body, true);
      if (dept.error) return res.status(400).json({ error: dept.error });
      nextDeptId = dept.id;
    }

    if (amount != null && (typeof amount !== 'number' || !Number.isFinite(amount))) {
      return res.status(400).json({ error: 'amount inválido.' });
    }
    if (status != null) {
      const stIn = String(status).trim().slice(0, 32);
      if (!['pending', 'paid', 'overdue', 'cancelled'].includes(stIn)) {
        return res.status(400).json({ error: 'status inválido.' });
      }
    }

    const prev = { ...bill };
    const now = Date.now();

    let rec = bill.recurring ? 1 : 0;
    let rule = bill.recurrenceRule;
    if (recurring !== undefined) {
      rec = recurring === true || recurring === 1 || recurring === '1' ? 1 : 0;
    }
    if (recurrenceRule !== undefined) {
      rule = recurrenceRule == null ? null : String(recurrenceRule).trim().slice(0, 32);
    }
    if (rec && (!rule || !['monthly', 'quarterly', 'yearly'].includes(rule))) {
      return res.status(400).json({ error: 'recurrenceRule inválida o faltante si recurring está activo.' });
    }
    if (!rec) rule = null;

    const nextVendor = vendor !== undefined ? String(vendor).trim().slice(0, 256) : bill.vendor;
    const nextAmount = amount !== undefined ? amount : bill.amount;
    const nextCat = category !== undefined ? String(category).trim().slice(0, 128) : bill.category;
    const nextDue = dueDate !== undefined ? String(dueDate).trim().slice(0, 10) : bill.dueDate;
    if (dueDate !== undefined && !DATE_RE.test(nextDue)) {
      return res.status(400).json({ error: 'dueDate debe ser YYYY-MM-DD.' });
    }
    const nextNotes = Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')
      ? (notes == null ? null : String(notes).trim().slice(0, 4000))
      : bill.notes;
    const nextStatus = status !== undefined ? String(status).trim().slice(0, 32) : bill.status;

    db.prepare(`
      UPDATE bills SET
        vendor = ?, amount = ?, category = ?, dueDate = ?, notes = ?, status = ?,
        recurring = ?, recurrenceRule = ?, departmentId = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      nextVendor,
      nextAmount,
      nextCat,
      nextDue,
      nextNotes,
      nextStatus,
      rec,
      rule,
      nextDeptId,
      now,
      bill.id,
    );

    const updated = getBillById(bill.id);
    audit('bill_updated', { userId: req.userId, targetId: bill.id, previous: prev, changes: updated });
    res.json({ ok: true, bill: updated });
  });

  router.delete('/:id', (req, res) => {
    const bill = getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (!canAccessBill(req, bill)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    const prev = { ...bill };
    db.prepare('DELETE FROM bills WHERE id = ?').run(bill.id);
    audit('bill_deleted', { userId: req.userId, targetId: bill.id, previous: prev });
    res.json({ ok: true });
  });

  router.post('/:id/mark-paid', (req, res) => {
    const bill = getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (!canAccessBill(req, bill)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    if (bill.status === 'cancelled') {
      return res.status(400).json({ error: 'Factura cancelada.' });
    }
    const now = Date.now();
    db.prepare(`
      UPDATE bills SET status = 'paid', paidAt = ?, paidBy = ?, updatedAt = ?
      WHERE id = ?
    `).run(now, req.userId, now, bill.id);
    const updated = getBillById(bill.id);
    audit('bill_marked_paid', { userId: req.userId, targetId: bill.id });
    res.json({ ok: true, bill: updated });
  });

  return router;
}

module.exports = { createBillsRouter };
