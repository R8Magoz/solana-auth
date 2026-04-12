'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const receiptStorage = require('./receiptStorage');

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

/** Body.paidAt: YYYY-MM-DD, ISO string, or epoch ms — default fallbackMs */
function parsePaidAtFromBody(body, fallbackMs) {
  const raw = body && body.paidAt;
  if (raw == null || raw === '') return fallbackMs;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  return fallbackMs;
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
    recurring, recurrenceRule, paidAt, paidBy, notes, createdAt, updatedAt, departmentId, receiptPath
  ) VALUES (
    @id, @userId, @vendor, @amount, @currency, @amountEUR, @category, @dueDate, @status,
    @recurring, @recurrenceRule, @paidAt, @paidBy, @notes, @createdAt, @updatedAt, @departmentId, @receiptPath
  )
`);

function createBillsRouter({ audit, requireAuth, DATA_DIR, receiptUploadLimiter }) {
  const router = express.Router();
  const receiptLimit = receiptUploadLimiter || ((req, res, next) => next());
  const receiptJson = express.json({ limit: '8mb' });
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

    const wantPaid = req.body && (req.body.alreadyPaid === true || req.body.paymentState === 'paid');
    let billStatus = 'pending';
    let paidAtVal = null;
    let paidByVal = null;
    if (wantPaid && !rec) {
      billStatus = 'paid';
      paidAtVal = parsePaidAtFromBody(req.body, now);
      paidByVal = req.userId;
    }

    insertBill.run({
      id,
      userId: req.userId,
      vendor: vendorStr,
      amount,
      currency: cur,
      amountEUR: eur,
      category: categoryStr,
      dueDate: dueStr,
      status: billStatus,
      recurring: rec ? 1 : 0,
      recurrenceRule: rule,
      paidAt: paidAtVal,
      paidBy: paidByVal,
      notes: notes != null ? String(notes).trim().slice(0, 4000) : null,
      createdAt: now,
      updatedAt: now,
      departmentId: dept.id,
      receiptPath: null,
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

  router.post('/:id/receipt', receiptLimit, receiptJson, async (req, res) => {
    if (!DATA_DIR) {
      return res.status(500).json({ error: 'Servidor sin directorio de datos.' });
    }
    const bill = getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (!canAccessBill(req, bill)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    const { b64, mediaType } = req.body || {};
    try {
      await receiptStorage.removeReceiptAsset(bill.receiptPath, DATA_DIR);
      const { receiptPath } = await receiptStorage.saveReceiptB64ToStorage({
        b64,
        mediaType,
        entityId: bill.id,
        DATA_DIR,
      });
      const now = Date.now();
      db.prepare('UPDATE bills SET receiptPath = ?, updatedAt = ? WHERE id = ?').run(receiptPath, now, bill.id);
      audit('bill_receipt_uploaded', { userId: req.userId, targetId: bill.id, receiptPath });
      return res.json({ ok: true, receiptPath });
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 400 && code < 500) {
        return res.status(code).json({ error: e.message || 'Solicitud inválida.' });
      }
      console.error('[bill receipt] upload', e.message || e);
      return res.status(500).json({ error: 'No se pudo guardar el recibo.' });
    }
  });

  router.get('/:id/receipt', async (req, res) => {
    if (!DATA_DIR) {
      return res.status(500).json({ error: 'Servidor sin directorio de datos.' });
    }
    const bill = getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (!canAccessBill(req, bill)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    if (!bill.receiptPath) {
      return res.status(404).json({ error: 'Sin recibo.' });
    }
    if (receiptStorage.isRemoteReceiptPath(bill.receiptPath)) {
      try {
        const r = await fetch(bill.receiptPath);
        if (!r.ok) return res.status(502).json({ error: 'No se pudo cargar el recibo.' });
        const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
        res.setHeader('Content-Type', ct);
        res.send(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        console.error('[bill receipt] proxy', e.message || e);
        return res.status(502).json({ error: 'No se pudo cargar el recibo.' });
      }
      return;
    }
    const abs = path.join(DATA_DIR, bill.receiptPath);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: 'Archivo no encontrado.' });
    }
    const ext = path.extname(abs).toLowerCase();
    const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.pdf' ? 'application/pdf' : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.sendFile(path.resolve(abs));
  });

  router.delete('/:id', async (req, res) => {
    const bill = getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (!canAccessBill(req, bill)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    const prev = { ...bill };
    if (DATA_DIR) {
      try {
        await receiptStorage.removeReceiptAsset(bill.receiptPath, DATA_DIR);
      } catch (e) {
        console.warn('[bill receipt] remove on delete:', e.message);
      }
    }
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
    const paidMs = parsePaidAtFromBody(req.body, now);
    db.prepare(`
      UPDATE bills SET status = 'paid', paidAt = ?, paidBy = ?, updatedAt = ?
      WHERE id = ?
    `).run(paidMs, req.userId, now, bill.id);
    const updated = getBillById(bill.id);
    audit('bill_marked_paid', { userId: req.userId, targetId: bill.id });
    res.json({ ok: true, bill: updated });
  });

  return router;
}

module.exports = { createBillsRouter };
