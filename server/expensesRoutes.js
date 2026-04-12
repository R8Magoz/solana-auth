'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const cloudinary = require('cloudinary').v2;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO4217 = /^[A-Z]{3}$/;

function parseJsonArray(str) {
  try {
    const x = JSON.parse(str || 'null');
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

function parseJsonObject(str) {
  try {
    const x = JSON.parse(str || 'null');
    return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  } catch {
    return {};
  }
}

/** @param {any} body */
function normalizeApprovalRequiredFromBody(body) {
  const raw = body && body.approvalRequired;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    const id = String(x).trim().slice(0, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 40) break;
  }
  return out;
}

function defaultApproverIdsFromDb() {
  return db.prepare("SELECT id FROM users WHERE role IN ('admin', 'superadmin')").all().map((r) => r.id);
}

function resolveApproverIdsForCreate(body) {
  const fromBody = normalizeApprovalRequiredFromBody(body);
  if (fromBody.length > 0) return fromBody;
  return defaultApproverIdsFromDb();
}

function computeSubmittedVotes(submitterId, approverIds) {
  const votes = {};
  if (approverIds.includes(submitterId)) votes[submitterId] = 'approved';
  const allDone = approverIds.length > 0 && approverIds.every((id) => votes[id] === 'approved');
  return { votes, allDone };
}

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
    approvedBy, approvedAt, rejectedBy, rejectedAt, rejectionNote, receiptPath, notes, createdAt, updatedAt, departmentId,
    approversJson, approvalVotesJson
  ) VALUES (
    @id, @userId, @amount, @currency, @amountEUR, @description, @category, @date, @status,
    @approvedBy, @approvedAt, @rejectedBy, @rejectedAt, @rejectionNote, @receiptPath, @notes, @createdAt, @updatedAt, @departmentId,
    @approversJson, @approvalVotesJson
  )
`);

function mimeToExt(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/tiff' || m === 'image/tif' || m === 'image/x-tiff') return 'tiff';
  if (m === 'image/heic' || m === 'image/heif') return 'heic';
  if (m === 'application/pdf') return 'pdf';
  return null;
}

function cloudinaryEnvOk() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET
  );
}

let cloudinaryConfigured = false;
function ensureCloudinary() {
  if (cloudinaryConfigured) return true;
  if (!cloudinaryEnvOk()) return false;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  cloudinaryConfigured = true;
  return true;
}

/** Extract Cloudinary public_id (with folder) from a delivery URL for destroy(). */
function cloudinaryPublicIdFromUrl(url) {
  try {
    const u = new URL(url);
    const marker = '/upload/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    let tail = u.pathname.slice(idx + marker.length);
    tail = tail.replace(/^v\d+\//, '');
    return tail.replace(/\.[^/.]+$/, '') || null;
  } catch {
    return null;
  }
}

function isRemoteReceiptPath(p) {
  return typeof p === 'string' && /^https?:\/\//i.test(p);
}

function uploadReceiptToCloudinary(buf, mime, expenseId) {
  const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
  const folder = (process.env.CLOUDINARY_RECEIPTS_FOLDER || 'solana-receipts').replace(/^\/+|\/+$/g, '');
  const publicId = String(expenseId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      dataUri,
      {
        folder,
        public_id: publicId,
        overwrite: true,
        resource_type: 'image',
        unique_filename: false,
        use_filename: false,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
}

function destroyCloudinaryPublicId(publicId) {
  return new Promise((resolve) => {
    cloudinary.uploader.destroy(publicId, (err, result) => {
      if (err) console.warn('[receipt] cloudinary destroy:', err.message || err);
      resolve(result);
    });
  });
}

async function removeReceiptAsset(receiptPath, DATA_DIR) {
  if (!receiptPath) return;
  if (isRemoteReceiptPath(receiptPath)) {
    if (!ensureCloudinary()) return;
    const pid = cloudinaryPublicIdFromUrl(receiptPath);
    if (pid) await destroyCloudinaryPublicId(pid);
    return;
  }
  const abs = path.join(DATA_DIR, receiptPath);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (_) { /* ignore */ }
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
    const dept = departmentIdFromBody(req.body, true);
    if (dept.error) return res.status(400).json({ error: dept.error });
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

    const approverIds = resolveApproverIdsForCreate(req.body);
    let finalStatus = st;
    let approvedByVal = null;
    let approvedAtVal = null;
    let votesObj = {};
    if (st === 'submitted') {
      const { votes, allDone } = computeSubmittedVotes(req.userId, approverIds);
      votesObj = votes;
      if (allDone) {
        finalStatus = 'approved';
        approvedByVal = req.userId;
        approvedAtVal = now;
      }
    }

    insertExp.run({
      id,
      userId: req.userId,
      amount,
      currency: cur,
      amountEUR: eur,
      description: desc,
      category: cat,
      date: dateStr,
      status: finalStatus,
      approvedBy: approvedByVal,
      approvedAt: approvedAtVal,
      rejectedBy: null,
      rejectedAt: null,
      rejectionNote: null,
      receiptPath: null,
      notes: notes != null ? String(notes).trim().slice(0, 4000) : null,
      createdAt: now,
      updatedAt: now,
      departmentId: dept.id,
      approversJson: JSON.stringify(approverIds),
      approvalVotesJson: JSON.stringify(votesObj),
    });

    const expense = getExpenseById(id);
    audit('expense_created', { userId: req.userId, targetId: id, amount, currency: cur, status: finalStatus });
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
    let nextDeptId = exp.departmentId;
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

    let finalStatus = nextStatus;
    let nextApproversJson = exp.approversJson ?? null;
    let nextVotesJson = exp.approvalVotesJson ?? null;
    let nextApprovedBy = exp.approvedBy ?? null;
    let nextApprovedAt = exp.approvedAt ?? null;
    let nextRejectedBy = exp.rejectedBy ?? null;
    let nextRejectedAt = exp.rejectedAt ?? null;
    let nextRejectionNote = exp.rejectionNote ?? null;

    const becomingSubmitted = finalStatus === 'submitted'
      && (exp.status === 'rejected' || exp.status === 'draft');

    if (becomingSubmitted) {
      const bodyList = normalizeApprovalRequiredFromBody(req.body);
      let approverIds = bodyList.length > 0 ? bodyList : parseJsonArray(exp.approversJson);
      if (approverIds.length === 0) approverIds = defaultApproverIdsFromDb();
      const { votes, allDone } = computeSubmittedVotes(exp.userId, approverIds);
      nextApproversJson = JSON.stringify(approverIds);
      nextVotesJson = JSON.stringify(votes);
      nextRejectedBy = null;
      nextRejectedAt = null;
      nextRejectionNote = null;
      if (allDone) {
        finalStatus = 'approved';
        nextApprovedBy = exp.userId;
        nextApprovedAt = now;
      } else {
        nextApprovedBy = null;
        nextApprovedAt = null;
      }
    }

    db.prepare(`
      UPDATE expenses SET
        amount = ?, description = ?, category = ?, date = ?, notes = ?, status = ?, departmentId = ?,
        approversJson = ?, approvalVotesJson = ?,
        approvedBy = ?, approvedAt = ?,
        rejectedBy = ?, rejectedAt = ?, rejectionNote = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      nextAmount, nextDesc, nextCat, nextDate, nextNotes, finalStatus, nextDeptId,
      nextApproversJson, nextVotesJson,
      nextApprovedBy, nextApprovedAt,
      nextRejectedBy, nextRejectedAt, nextRejectionNote,
      now, exp.id,
    );

    const updated = getExpenseById(exp.id);
    audit('expense_updated', {
      userId: req.userId,
      targetId: exp.id,
      previous: prev,
      changes: updated,
    });
    res.json({ ok: true, expense: updated });
  });

  router.delete('/:id', async (req, res) => {
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
    try {
      await removeReceiptAsset(exp.receiptPath, DATA_DIR);
    } catch (e) {
      console.warn('[receipt] remove on expense delete:', e.message);
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
    const approvers = parseJsonArray(exp.approversJson);

    if (approvers.length === 0) {
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
      return res.json({ ok: true, expense: updated });
    }

    if (exp.status !== 'submitted') {
      return res.status(400).json({ error: 'El gasto no está pendiente de aprobación.' });
    }
    if (!approvers.includes(adminId)) {
      return res.status(403).json({ error: 'No eres aprobador designado para este gasto.' });
    }

    const votes = parseJsonObject(exp.approvalVotesJson);
    votes[adminId] = 'approved';
    const allDone = approvers.every((id) => votes[id] === 'approved');

    if (allDone) {
      db.prepare(`
        UPDATE expenses SET
          status = 'approved',
          approvalVotesJson = ?,
          approvedBy = ?, approvedAt = ?,
          rejectedBy = NULL, rejectedAt = NULL, rejectionNote = NULL,
          updatedAt = ?
        WHERE id = ?
      `).run(JSON.stringify(votes), adminId, now, now, exp.id);
    } else {
      db.prepare(`
        UPDATE expenses SET approvalVotesJson = ?, updatedAt = ?
        WHERE id = ?
      `).run(JSON.stringify(votes), now, exp.id);
    }
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
    const approvers = parseJsonArray(exp.approversJson);

    if (approvers.length > 0) {
      if (exp.status !== 'submitted') {
        return res.status(400).json({ error: 'El gasto no está pendiente de aprobación.' });
      }
      if (!approvers.includes(adminId)) {
        return res.status(403).json({ error: 'No eres aprobador designado para este gasto.' });
      }
    }

    db.prepare(`
      UPDATE expenses SET
        status = 'rejected',
        rejectedBy = ?, rejectedAt = ?, rejectionNote = ?,
        approvalVotesJson = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(adminId, now, note, JSON.stringify({}), now, exp.id);
    const updated = getExpenseById(exp.id);
    audit('expense_rejected', { userId: adminId, targetId: exp.id, note });
    res.json({ ok: true, expense: updated });
  });

  const receiptJson = express.json({ limit: '8mb' });

  router.post('/:id/receipt', receiptLimit, receiptJson, async (req, res) => {
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
    if (b64.length > 8_400_000) {
      return res.status(413).json({ error: 'Archivo demasiado grande (máx. 6 MB).' });
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
    if (buf.length > 6 * 1024 * 1024) {
      return res.status(413).json({ error: 'Archivo demasiado grande (máx. 6 MB).' });
    }

    if (ensureCloudinary()) {
      try {
        await removeReceiptAsset(exp.receiptPath, DATA_DIR);
        const result = await uploadReceiptToCloudinary(buf, mime, exp.id);
        const secureUrl = result.secure_url;
        const now = Date.now();
        db.prepare(`UPDATE expenses SET receiptPath = ?, updatedAt = ? WHERE id = ?`).run(secureUrl, now, exp.id);
        audit('expense_receipt_uploaded', { userId: req.userId, targetId: exp.id, receiptPath: secureUrl });
        return res.json({ ok: true, receiptPath: secureUrl });
      } catch (e) {
        console.error('[receipt] cloudinary upload', e.message || e);
        return res.status(500).json({ error: 'No se pudo guardar el recibo en el almacenamiento.' });
      }
    }

    if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

    const rel = path.join('receipts', `${exp.id}.${ext}`).replace(/\\/g, '/');
    const abs = path.join(DATA_DIR, 'receipts', `${exp.id}.${ext}`);

    if (exp.receiptPath && exp.receiptPath !== rel) {
      await removeReceiptAsset(exp.receiptPath, DATA_DIR);
    }

    fs.writeFileSync(abs, buf);
    const now = Date.now();
    db.prepare(`UPDATE expenses SET receiptPath = ?, updatedAt = ? WHERE id = ?`).run(rel, now, exp.id);
    audit('expense_receipt_uploaded', { userId: req.userId, targetId: exp.id, receiptPath: rel });
    res.json({ ok: true, receiptPath: rel });
  });

  router.get('/:id/receipt', async (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (!canAccessExpense(req, exp)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    if (!exp.receiptPath) {
      return res.status(404).json({ error: 'Sin recibo.' });
    }

    if (isRemoteReceiptPath(exp.receiptPath)) {
      try {
        const r = await fetch(exp.receiptPath);
        if (!r.ok) return res.status(502).json({ error: 'No se pudo cargar el recibo.' });
        const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
        res.setHeader('Content-Type', ct);
        res.send(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        console.error('[receipt] proxy', e.message || e);
        return res.status(502).json({ error: 'No se pudo cargar el recibo.' });
      }
      return;
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
