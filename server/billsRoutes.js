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

function normalizeBillPaidByFromBody(body, ownerId, totalAmount) {
  const total = Number(totalAmount);
  if (!Number.isFinite(total) || total <= 0) return { error: 'Importe total inválido para el reparto.' };
  const raw = body && body.paidBy;
  const owner = String(ownerId || '').trim();
  if (raw == null) {
    return { paidBy: [{ userId: owner, amount: Math.round(total * 100) / 100, pct: 100 }], splitMode: null };
  }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) return { error: 'paidBy inválido.' };
  const seen = new Set();
  let sum = 0;
  const rows = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return { error: 'paidBy inválido.' };
    const uid = String(r.userId || '').trim().slice(0, 128);
    if (!uid) return { error: 'paidBy: falta userId.' };
    const hit = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (!hit) return { error: 'Usuario del reparto no encontrado.' };
    if (seen.has(uid)) return { error: 'paidBy duplicado.' };
    seen.add(uid);
    const amt = Math.round((Number(r.amount) || 0) * 100) / 100;
    if (!Number.isFinite(amt) || amt < 0) return { error: 'paidBy: importe inválido.' };
    const out = { userId: uid, amount: amt };
    if (typeof r.pct === 'number' && Number.isFinite(r.pct)) out.pct = Math.round(r.pct * 100) / 100;
    rows.push(out);
    sum += amt;
  }
  if (Math.abs(sum - total) > 0.02) return { error: 'Los importes del reparto deben sumar el total.' };
  const sm = body && body.splitMode;
  const splitMode = rows.length > 1 ? ((sm === 'equal' || sm === 'percentage' || sm === 'amount') ? sm : 'equal') : null;
  return { paidBy: rows, splitMode };
}

function listBills(req) {
  const admin = isAdminRole(req.userRole);
  const { status, from, to, category, userId: qUser } = req.query;
  const parts = ['1=1'];
  const vals = [];

  if (!admin && qUser) {
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

function defaultApproverIdsFromDb() {
  return db.prepare(
    "SELECT id FROM users WHERE role IN ('admin','superadmin')"
  ).all().map(r => r.id);
}

function ensureBillsApprovalColumns() {
  try { db.prepare("ALTER TABLE bills ADD COLUMN approversJson TEXT").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE bills ADD COLUMN approvalVotesJson TEXT").run(); } catch (e) {}
}

const insertBill = db.prepare(`
  INSERT INTO bills (
    id, userId, vendor, amount, currency, amountEUR, category, dueDate, status,
    recurring, recurrenceRule, paidAt, paidBy, notes, ownerId, paidByJson, splitMode, approversJson, approvalVotesJson, createdAt, updatedAt, departmentId, receiptPath
  ) VALUES (
    @id, @userId, @vendor, @amount, @currency, @amountEUR, @category, @dueDate, @status,
    @recurring, @recurrenceRule, @paidAt, @paidBy, @notes, @ownerId, @paidByJson, @splitMode, @approversJson, @approvalVotesJson, @createdAt, @updatedAt, @departmentId, @receiptPath
  )
`);

function createBillsRouter({ audit, requireAuth, DATA_DIR, receiptUploadLimiter }) {
  ensureBillsApprovalColumns();
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
    let ownerId = req.userId;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'ownerId')) {
      const oid = String(req.body.ownerId || '').trim().slice(0, 128);
      if (!oid) return res.status(400).json({ error: 'ownerId inválido.' });
      const own = db.prepare('SELECT id FROM users WHERE id = ?').get(oid);
      if (!own) return res.status(400).json({ error: 'Titular no encontrado.' });
      ownerId = own.id;
    }
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
    const totalForSplit = eur != null && Number.isFinite(eur) ? eur : amount;
    const paidNorm = normalizeBillPaidByFromBody(req.body, ownerId, totalForSplit);
    if (paidNorm.error) return res.status(400).json({ error: paidNorm.error });

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
    const requestedApprovers = Array.isArray(req.body?.approvalRequired)
      ? req.body.approvalRequired.map(id => String(id || '').trim().slice(0, 128)).filter(Boolean)
      : [];
    const approverIds = requestedApprovers.length ? requestedApprovers : defaultApproverIdsFromDb();
    const votes = {};
    if (approverIds.includes(req.userId)) {
      votes[req.userId] = 'approved';
    }
    const allApproved = approverIds.length > 0 && approverIds.every(id => votes[id] === 'approved');
    if (allApproved) {
      billStatus = 'paid';
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
      ownerId,
      paidByJson: JSON.stringify(paidNorm.paidBy),
      splitMode: paidNorm.splitMode,
      approversJson: JSON.stringify(approverIds),
      approvalVotesJson: JSON.stringify(votes),
      createdAt: now,
      updatedAt: now,
      departmentId: dept.id,
      receiptPath: null,
    });
    if (allApproved) {
      audit('bill_auto_approved', { userId: req.userId, targetId: id });
    }

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
      recurring, recurrenceRule, splitMode,
    } = req.body || {};
    let nextOwnerId = bill.ownerId || bill.userId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ownerId')) {
      const ownerRaw = String(req.body.ownerId || '').trim().slice(0, 128);
      if (!ownerRaw) return res.status(400).json({ error: 'ownerId inválido.' });
      const own = db.prepare('SELECT id FROM users WHERE id = ?').get(ownerRaw);
      if (!own) return res.status(400).json({ error: 'Titular no encontrado.' });
      nextOwnerId = own.id;
    }

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

    let nextPaidByJson = bill.paidByJson;
    let nextSplitMode = bill.splitMode || null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'paidBy') || splitMode !== undefined || req.body?.ownerId !== undefined || amount !== undefined) {
      const totalForSplit = bill.amountEUR != null && Number.isFinite(Number(bill.amountEUR)) ? Number(bill.amountEUR) : nextAmount;
      const paidNorm = normalizeBillPaidByFromBody({ ...req.body, splitMode }, nextOwnerId, totalForSplit);
      if (paidNorm.error) return res.status(400).json({ error: paidNorm.error });
      nextPaidByJson = JSON.stringify(paidNorm.paidBy);
      nextSplitMode = paidNorm.splitMode;
    }
    db.prepare(`
      UPDATE bills SET
        vendor = ?, amount = ?, category = ?, dueDate = ?, notes = ?, status = ?,
        recurring = ?, recurrenceRule = ?, ownerId = ?, paidByJson = ?, splitMode = ?, departmentId = ?, updatedAt = ?
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
      nextOwnerId,
      nextPaidByJson,
      nextSplitMode,
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
    if (!req.userId) return res.status(403).json({ error: 'No autorizado.' });
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
    if (!req.userId) return res.status(403).json({ error: 'No autorizado.' });
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
    const MIME_MAP = {
      '.pdf':  'application/pdf',
      '.png':  'image/png',
      '.webp': 'image/webp',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif':  'image/gif',
      '.tiff': 'image/tiff',
      '.tif':  'image/tiff',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
    };
    const type = MIME_MAP[ext] || 'image/jpeg';
    res.setHeader('Content-Type', type);
    const fname = path.basename(abs);
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
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

  router.post('/:id/approve', (req, res) => {
    const bill = getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (!canAccessBill(req, bill)) return res.status(403).json({ error: 'No autorizado.' });
    const now = Date.now();
    let approverIds;
    let votes;
    try {
      approverIds = JSON.parse(bill.approversJson || 'null') || defaultApproverIdsFromDb();
    } catch (e) {
      approverIds = defaultApproverIdsFromDb();
    }
    try {
      votes = JSON.parse(bill.approvalVotesJson || '{}') || {};
    } catch (e) {
      votes = {};
    }
    if (!Array.isArray(approverIds) || approverIds.length === 0) approverIds = defaultApproverIdsFromDb();
    if (!approverIds.includes(req.userId)) {
      return res.status(403).json({ error: 'No eres aprobador designado para esta factura.' });
    }
    votes[req.userId] = 'approved';
    const allApproved = approverIds.every(id => votes[id] === 'approved');
    if (allApproved) {
      db.prepare("UPDATE bills SET approversJson=?, approvalVotesJson=?, status='paid', updatedAt=? WHERE id=?")
        .run(JSON.stringify(approverIds), JSON.stringify(votes), now, bill.id);
    } else {
      db.prepare("UPDATE bills SET approversJson=?, approvalVotesJson=?, updatedAt=? WHERE id=?")
        .run(JSON.stringify(approverIds), JSON.stringify(votes), now, bill.id);
    }
    const updated = getBillById(bill.id);
    audit('bill_approved', { userId: req.userId, targetId: bill.id });
    res.json({ ok: true, bill: updated });
  });

  router.post('/:id/reject', (req, res) => {
    const bill = getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (!canAccessBill(req, bill)) return res.status(403).json({ error: 'No autorizado.' });
    const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : null;
    const now = Date.now();
    let approverIds;
    let votes;
    try {
      approverIds = JSON.parse(bill.approversJson || 'null') || defaultApproverIdsFromDb();
    } catch (e) {
      approverIds = defaultApproverIdsFromDb();
    }
    try {
      votes = JSON.parse(bill.approvalVotesJson || '{}') || {};
    } catch (e) {
      votes = {};
    }
    if (!Array.isArray(approverIds) || approverIds.length === 0) approverIds = defaultApproverIdsFromDb();
    if (!approverIds.includes(req.userId)) {
      return res.status(403).json({ error: 'No eres aprobador designado para esta factura.' });
    }
    votes[req.userId] = 'rejected';
    db.prepare("UPDATE bills SET approversJson=?, approvalVotesJson=?, status='cancelled', updatedAt=? WHERE id=?")
      .run(JSON.stringify(approverIds), JSON.stringify(votes), now, bill.id);
    const updated = getBillById(bill.id);
    audit('bill_rejected', { userId: req.userId, targetId: bill.id, note });
    res.json({ ok: true, bill: updated });
  });

  return router;
}

module.exports = { createBillsRouter };
