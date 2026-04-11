'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO4217 = /^[A-Z]{3}$/;

function isAdminRole(role) {
  return role === 'admin' || role === 'superadmin';
}

function rowToExpense(r) {
  return r ? { ...r } : null;
}

function getExpenseById(id) {
  return rowToExpense(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
}

function canAccessExpense(req, exp) {
  if (!exp) return false;
  if (isAdminRole(req.userRole)) return true;
  return exp.userId === req.userId;
}

function listExpenses(req) {
  const admin = isAdminRole(req.userRole);
  const { status, from, to, category, userId: qUser, includeDeleted } = req.query;
  const parts = ['1=1'];
  const vals = [];

  if (!admin) {
    parts.push('userId = ?');
    vals.push(req.userId);
  } else if (qUser) {
    parts.push('userId = ?');
    vals.push(String(qUser).trim().slice(0, 128));
  }

  const incDel = admin && (includeDeleted === '1' || includeDeleted === 'true');
  if (!incDel) {
    parts.push("status != 'deleted'");
  }

  if (status) {
    parts.push('status = ?');
    vals.push(String(status).trim().slice(0, 32));
  }
  if (from) {
    parts.push('date >= ?');
    vals.push(String(from).trim().slice(0, 10));
  }
  if (to) {
    parts.push('date <= ?');
    vals.push(String(to).trim().slice(0, 10));
  }
  if (category) {
    parts.push('category = ?');
    vals.push(String(category).trim().slice(0, 128));
  }

  const sql = `SELECT * FROM expenses WHERE ${parts.join(' AND ')} ORDER BY date DESC, createdAt DESC`;
  return db.prepare(sql).all(...vals).map(rowToExpense);
}

const insertExp = db.prepare(`
  INSERT INTO expenses (
    id, userId, amount, currency, amountEUR, description, category, date, status,
    approvedBy, approvedAt, rejectedBy, rejectedAt, rejectionNote, receiptPath, notes, createdAt, updatedAt
  ) VALUES (
    @id, @userId, @amount, @currency, @amountEUR, @description, @category, @date, @status,
    @approvedBy, @approvedAt, @rejectedBy, @rejectedAt, @rejectionNote, @receiptPath, @notes, @createdAt, @updatedAt
  )
`);

function mimeToExt(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  return null;
}

function createExpensesRouter({ audit, requireAuth, requireAdminSession, DATA_DIR, receiptUploadLimiter }) {
  const router = express.Router();
  const RECEIPTS_DIR = path.join(DATA_DIR, 'receipts');
  const receiptLimit = receiptUploadLimiter || ((req, res, next) => next());

  router.use(requireAuth);

  router.get('/', (req, res) => {
    try {
      const expenses = listExpenses(req);
      res.json({ expenses });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al listar gastos.' });
    }
  });

  router.post('/', (req, res) => {
    const { amount, currency, amountEUR, description, category, date, notes, status } = req.body || {};
    if (amount == null || typeof amount !== 'number' || !Number.isFinite(amount)) {
      return res.status(400).json({ error: 'amount numérico requerido.' });
    }
    const desc = typeof description === 'string' ? description.trim().slice(0, 2000) : '';
    const cat = typeof category === 'string' ? category.trim().slice(0, 128) : '';
    const dateStr = typeof date === 'string' ? date.trim().slice(0, 10) : '';
    if (!desc) {
      return res.status(400).json({ error: 'description requerida.' });
    }
    if (!cat) {
      return res.status(400).json({ error: 'category requerida.' });
    }
    if (!DATE_RE.test(dateStr)) {
      return res.status(400).json({ error: 'date debe ser YYYY-MM-DD.' });
    }
    const cur = String(currency || 'EUR').trim().toUpperCase().slice(0, 3);
    if (!ISO4217.test(cur)) {
      return res.status(400).json({ error: 'currency inválida (ISO 4217).' });
    }
    let st = typeof status === 'string' ? status.trim().slice(0, 32) : 'submitted';
    if (!['draft', 'submitted'].includes(st)) {
      return res.status(400).json({ error: 'status inicial solo draft o submitted.' });
    }
    const now = Date.now();
    const id = 'exp_' + crypto.randomBytes(8).toString('hex');
    let eur = amountEUR != null && typeof amountEUR === 'number' ? amountEUR : null;
    if (cur === 'EUR') eur = amount;

    insertExp.run({
      id,
      userId: req.userId,
      amount,
      currency: cur,
      amountEUR: eur,
      description: desc,
      category: cat,
      date: dateStr,
      status: st,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionNote: null,
      receiptPath: null,
      notes: notes != null ? String(notes).trim().slice(0, 4000) : null,
      createdAt: now,
      updatedAt: now,
    });

    const expense = getExpenseById(id);
    audit('expense_created', { userId: req.userId, targetId: id, amount, currency: cur, status: st });
    res.json({ ok: true, expense });
  });

  router.put('/:id', (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (!canAccessExpense(req, exp)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }

    const admin = isAdminRole(req.userRole);
    if (!admin && !['draft', 'submitted', 'rejected'].includes(exp.status)) {
      return res.status(403).json({ error: 'No se puede editar en este estado.' });
    }
    if (exp.status === 'deleted') {
      return res.status(400).json({ error: 'Gasto eliminado.' });
    }

    const { amount, description, category, date, notes, status } = req.body || {};
    if (amount != null && (typeof amount !== 'number' || !Number.isFinite(amount))) {
      return res.status(400).json({ error: 'amount inválido.' });
    }
    if (status != null) {
      const stIn = String(status).trim().slice(0, 32);
      if (!admin && !['draft', 'submitted'].includes(stIn)) {
        return res.status(403).json({ error: 'Estado no permitido.' });
      }
      if (!['draft', 'submitted', 'approved', 'rejected', 'deleted'].includes(stIn)) {
        return res.status(400).json({ error: 'status inválido.' });
      }
    }

    const prev = { ...exp };
    const now = Date.now();
    const nextAmount = amount !== undefined ? amount : exp.amount;
    const nextDesc = description !== undefined ? String(description).trim().slice(0, 2000) : exp.description;
    const nextCat = category !== undefined ? String(category).trim().slice(0, 128) : exp.category;
    const nextDate = date !== undefined ? String(date).trim().slice(0, 10) : exp.date;
    if (date !== undefined && !DATE_RE.test(nextDate)) {
      return res.status(400).json({ error: 'date debe ser YYYY-MM-DD.' });
    }
    const nextNotes = Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')
      ? (notes == null ? null : String(notes).trim().slice(0, 4000))
      : exp.notes;
    const nextStatus = status !== undefined ? String(status).trim().slice(0, 32) : exp.status;

    db.prepare(`
      UPDATE expenses SET
        amount = ?, description = ?, category = ?, date = ?, notes = ?, status = ?, updatedAt = ?
      WHERE id = ?
    `).run(nextAmount, nextDesc, nextCat, nextDate, nextNotes, nextStatus, now, exp.id);

    const updated = getExpenseById(exp.id);
    audit('expense_updated', {
      userId: req.userId,
      targetId: exp.id,
      previous: prev,
      changes: updated,
    });
    res.json({ ok: true, expense: updated });
  });

  router.delete('/:id', (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (!canAccessExpense(req, exp)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    const admin = isAdminRole(req.userRole);
    if (!admin && !['draft', 'submitted', 'rejected'].includes(exp.status)) {
      return res.status(403).json({ error: 'No se puede eliminar en este estado.' });
    }
    if (exp.status === 'deleted') {
      return res.status(400).json({ error: 'Ya eliminado.' });
    }

    const prev = { ...exp };
    const now = Date.now();
    db.prepare(`UPDATE expenses SET status = 'deleted', updatedAt = ? WHERE id = ?`).run(now, exp.id);
    if (exp.receiptPath) {
      const abs = path.join(DATA_DIR, exp.receiptPath);
      try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch (_) { /* ignore */ }
    }
    audit('expense_deleted', { userId: req.userId, targetId: exp.id, previous: prev });
    res.json({ ok: true });
  });

  router.post('/:id/approve', requireAdminSession, (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (exp.status === 'deleted') return res.status(400).json({ error: 'Gasto no válido.' });
    const now = Date.now();
    const adminId = req.userId || null;
    db.prepare(`
      UPDATE expenses SET
        status = 'approved',
        approvedBy = ?, approvedAt = ?,
        rejectedBy = NULL, rejectedAt = NULL, rejectionNote = NULL,
        updatedAt = ?
      WHERE id = ?
    `).run(adminId, now, now, exp.id);
    const updated = getExpenseById(exp.id);
    const approveNote = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : undefined;
    audit('expense_approved', { userId: adminId, targetId: exp.id, note: approveNote });
    res.json({ ok: true, expense: updated });
  });

  router.post('/:id/reject', requireAdminSession, (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (exp.status === 'deleted') return res.status(400).json({ error: 'Gasto no válido.' });
    const now = Date.now();
    const adminId = req.userId || null;
    const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : null;
    db.prepare(`
      UPDATE expenses SET
        status = 'rejected',
        rejectedBy = ?, rejectedAt = ?, rejectionNote = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(adminId, now, note, now, exp.id);
    const updated = getExpenseById(exp.id);
    audit('expense_rejected', { userId: adminId, targetId: exp.id, note });
    res.json({ ok: true, expense: updated });
  });

  const receiptJson = express.json({ limit: '6mb' });

  router.post('/:id/receipt', receiptLimit, receiptJson, (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (!canAccessExpense(req, exp)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    if (exp.status === 'deleted') {
      return res.status(400).json({ error: 'Gasto eliminado.' });
    }

    const { b64, mediaType } = req.body || {};
    if (!b64 || typeof b64 !== 'string') {
      return res.status(400).json({ error: 'Falta b64.' });
    }
    if (b64.length > 5_600_000) {
      return res.status(413).json({ error: 'Archivo demasiado grande (max ~4 MB).' });
    }
    const mime = String(mediaType || 'image/jpeg').trim().toLowerCase().slice(0, 128);
    const ext = mimeToExt(mime);
    if (!ext) return res.status(400).json({ error: `Tipo no soportado: ${mime}` });

    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Base64 inválido.' });
    }
    if (buf.length > 4 * 1024 * 1024) {
      return res.status(413).json({ error: 'Archivo demasiado grande (max 4 MB).' });
    }

    if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

    const rel = path.join('receipts', `${exp.id}.${ext}`).replace(/\\/g, '/');
    const abs = path.join(DATA_DIR, 'receipts', `${exp.id}.${ext}`);

    if (exp.receiptPath && exp.receiptPath !== rel) {
      const oldAbs = path.join(DATA_DIR, exp.receiptPath);
      try { if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs); } catch (_) { /* ignore */ }
    }

    fs.writeFileSync(abs, buf);
    const now = Date.now();
    db.prepare(`UPDATE expenses SET receiptPath = ?, updatedAt = ? WHERE id = ?`).run(rel, now, exp.id);
    audit('expense_receipt_uploaded', { userId: req.userId, targetId: exp.id, receiptPath: rel });
    res.json({ ok: true, receiptPath: rel });
  });

  router.get('/:id/receipt', (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (!canAccessExpense(req, exp)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    if (!exp.receiptPath) {
      return res.status(404).json({ error: 'Sin recibo.' });
    }
    const abs = path.join(DATA_DIR, exp.receiptPath);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: 'Archivo no encontrado.' });
    }
    const ext = path.extname(abs).toLowerCase();
    const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.sendFile(path.resolve(abs));
  });

  return router;
}

module.exports = { createExpensesRouter };
