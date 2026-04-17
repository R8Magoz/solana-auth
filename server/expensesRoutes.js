'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const receiptStorage = require('./receiptStorage');

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

/** Total TTC (EUR) and optional client IVA fields → stored ivaRate / ivaAmount */
function ivaFromBody(body, totalEur) {
  if (!body || body.ivaRate == null) return { ivaRate: null, ivaAmount: null };
  const rate = Number(body.ivaRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { error: 'ivaRate inválido.' };
  if (rate === 0) return { ivaRate: 0, ivaAmount: 0 };
  let ivaAmt = body.ivaAmount != null ? Number(body.ivaAmount) : null;
  if (ivaAmt != null && (!Number.isFinite(ivaAmt) || ivaAmt < 0)) return { error: 'ivaAmount inválido.' };
  const tot = Number(totalEur);
  if (ivaAmt == null) {
    if (!Number.isFinite(tot) || tot <= 0) return { ivaRate: rate, ivaAmount: 0 };
    const r = rate / 100;
    ivaAmt = Math.round((tot / (1 + r)) * r * 100) / 100;
  }
  return { ivaRate: rate, ivaAmount: Math.round(ivaAmt * 100) / 100 };
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

/**
 * Resolve client tokens to DB user ids — no hardcoded roster.
 * Accepts real user ids (e.g. u_…) or full email when the client sends an email string.
 */
function resolveApproverTokenToUserId(token, userStore) {
  const t = String(token || '').trim();
  if (!t) return t;
  const byId = userStore.findUserById(t);
  if (byId) return byId.id;
  if (t.includes('@')) {
    const u = userStore.findUserByEmail(t.toLowerCase().slice(0, 254));
    if (u) return u.id;
  }
  return t;
}

function canonicalizeApproverIds(approverIds, userStore) {
  const seen = new Set();
  const out = [];
  for (const x of approverIds || []) {
    const c = resolveApproverTokenToUserId(x, userStore);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

function remapVotesWithCanonicalKeys(votesRaw, userStore) {
  const out = {};
  if (!votesRaw || typeof votesRaw !== 'object') return out;
  for (const [k, v] of Object.entries(votesRaw)) {
    if (v !== 'approved' && v !== 'rejected') continue;
    const cid = resolveApproverTokenToUserId(k, userStore);
    out[cid] = v;
  }
  return out;
}

function userIdInRawApproverList(approverTokens, userId, userStore) {
  const uid = String(userId || '');
  for (const tok of approverTokens || []) {
    if (resolveApproverTokenToUserId(tok, userStore) === uid) return true;
  }
  return false;
}

/**
 * Validate client paidBy[] against total EUR; resolve legacy user tokens.
 * @returns {{ paidBy: Array<{userId:string,amount:number,pct?:number}>, splitMode: string|null }|{ error: string }}
 */
function normalizePaidByFromBody(body, submitterId, totalEur, userStore) {
  const total = Number(totalEur);
  if (!Number.isFinite(total) || total <= 0) return { error: 'Importe total inválido para el reparto.' };
  const raw = body && body.paidBy;
  const submit = String(submitterId || '').trim();

  if (raw == null) {
    return {
      paidBy: [{ userId: submit, amount: Math.round(total * 100) / 100, pct: 100 }],
      splitMode: null,
    };
  }
  if (!Array.isArray(raw)) return { error: 'paidBy debe ser un array.' };
  if (raw.length < 1 || raw.length > 30) return { error: 'paidBy: entre 1 y 30 participantes.' };

  const rows = [];
  const seen = new Set();
  let sum = 0;
  for (const row of raw) {
    if (!row || typeof row !== 'object') return { error: 'paidBy: entrada inválida.' };
    let uid = String(row.userId || '').trim().slice(0, 128);
    if (!uid) return { error: 'paidBy: falta userId.' };
    uid = resolveApproverTokenToUserId(uid, userStore);
    const u = userStore.findUserById(uid);
    if (!u) return { error: 'Usuario del reparto no encontrado.' };
    if (seen.has(u.id)) return { error: 'paidBy: participante duplicado.' };
    seen.add(u.id);
    const rowAmt = Number(row.amount);
    if (!Number.isFinite(rowAmt) || rowAmt < 0) return { error: 'paidBy: importe inválido.' };
    const amtRounded = Math.round(rowAmt * 100) / 100;
    const out = { userId: u.id, amount: amtRounded };
    if (typeof row.pct === 'number' && Number.isFinite(row.pct)) {
      out.pct = Math.round(row.pct * 10000) / 10000;
    }
    rows.push(out);
    sum += amtRounded;
  }

  if (Math.abs(sum - total) > 0.02) {
    return { error: 'Los importes del reparto deben sumar el total del gasto.' };
  }
  let splitMode = null;
  if (rows.length > 1) {
    const sm = body && body.splitMode;
    if (sm === 'equal' || sm === 'percentage' || sm === 'amount') splitMode = sm;
    else splitMode = 'equal';
  }

  return { paidBy: rows, splitMode };
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

  if (!admin && qUser) {
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
    approversJson, approvalVotesJson, paidByJson, splitMode,
    ivaRate, ivaAmount, commentsJson, ownerId
  ) VALUES (
    @id, @userId, @amount, @currency, @amountEUR, @description, @category, @date, @status,
    @approvedBy, @approvedAt, @rejectedBy, @rejectedAt, @rejectionNote, @receiptPath, @notes, @createdAt, @updatedAt, @departmentId,
    @approversJson, @approvalVotesJson, @paidByJson, @splitMode,
    @ivaRate, @ivaAmount, @commentsJson, @ownerId
  )
`);

function createExpensesRouter({ audit, requireAuth, requireAdminSession, DATA_DIR, receiptUploadLimiter, userStore }) {
  if (!userStore) throw new Error('createExpensesRouter: userStore is required');
  const router = express.Router();
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
    let ownerId = req.userId;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'ownerId')) {
      const ownerRaw = String(req.body.ownerId || '').trim().slice(0, 128);
      if (!ownerRaw) return res.status(400).json({ error: 'ownerId inválido.' });
      const own = userStore.findUserById(resolveApproverTokenToUserId(ownerRaw, userStore));
      if (!own) return res.status(400).json({ error: 'Titular no encontrado.' });
      ownerId = own.id;
    }
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

    let approverIds = resolveApproverIdsForCreate(req.body);
    approverIds = canonicalizeApproverIds(approverIds, userStore);
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

    const totalForSplit = eur != null && Number.isFinite(eur) ? eur : amount;
    const paidNorm = normalizePaidByFromBody(req.body, req.userId, totalForSplit, userStore);
    if (paidNorm.error) return res.status(400).json({ error: paidNorm.error });

    const ivaParsed = ivaFromBody(req.body, totalForSplit);
    if (ivaParsed.error) return res.status(400).json({ error: ivaParsed.error });

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
      paidByJson: JSON.stringify(paidNorm.paidBy),
      splitMode: paidNorm.splitMode != null ? paidNorm.splitMode : null,
      ivaRate: ivaParsed.ivaRate,
      ivaAmount: ivaParsed.ivaAmount,
      commentsJson: '[]',
      ownerId,
    });

    const expense = getExpenseById(id);
    audit('expense_created', { userId: req.userId, targetId: id, amount, currency: cur, status: finalStatus });
    res.json({ ok: true, expense });
  });

  router.post('/:id/comments', (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (!canAccessExpense(req, exp)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    if (exp.status === 'deleted') {
      return res.status(400).json({ error: 'Gasto eliminado.' });
    }
    const textRaw = req.body && req.body.text;
    const text = typeof textRaw === 'string' ? textRaw.trim().slice(0, 4000) : '';
    if (!text) {
      return res.status(400).json({ error: 'text requerido.' });
    }
    const list = parseJsonArray(exp.commentsJson);
    const entry = {
      id: `cmt_${crypto.randomBytes(8).toString('hex')}`,
      userId: req.userId,
      text,
      createdAt: Date.now(),
    };
    list.push(entry);
    const now = Date.now();
    db.prepare('UPDATE expenses SET commentsJson = ?, updatedAt = ? WHERE id = ?').run(
      JSON.stringify(list),
      now,
      exp.id,
    );
    const updated = getExpenseById(exp.id);
    audit('expense_comment_added', { userId: req.userId, targetId: exp.id });
    res.json({ ok: true, expense: updated });
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

    const curExpCur = String(exp.currency || 'EUR').toUpperCase();
    const totalForIva = curExpCur === 'EUR'
      ? nextAmount
      : (exp.amountEUR != null && Number.isFinite(Number(exp.amountEUR)) ? Number(exp.amountEUR) : nextAmount);

    let nextIvaRate = exp.ivaRate != null && exp.ivaRate !== '' ? Number(exp.ivaRate) : null;
    let nextIvaAmount = exp.ivaAmount != null && exp.ivaAmount !== '' ? Number(exp.ivaAmount) : null;
    if (Number.isNaN(nextIvaRate)) nextIvaRate = null;
    if (Number.isNaN(nextIvaAmount)) nextIvaAmount = null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ivaRate')) {
      const iv = ivaFromBody(req.body, totalForIva);
      if (iv.error) return res.status(400).json({ error: iv.error });
      nextIvaRate = iv.ivaRate;
      nextIvaAmount = iv.ivaAmount;
    }

    let nextPaidByJson = exp.paidByJson ?? null;
    let nextSplitMode = exp.splitMode ?? null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'paidBy')) {
      const curExp = String(exp.currency || 'EUR').toUpperCase();
      const totalForSplit = curExp === 'EUR'
        ? nextAmount
        : (exp.amountEUR != null && Number.isFinite(Number(exp.amountEUR)) ? Number(exp.amountEUR) : nextAmount);
      const pn = normalizePaidByFromBody(req.body, exp.userId, totalForSplit, userStore);
      if (pn.error) return res.status(400).json({ error: pn.error });
      nextPaidByJson = JSON.stringify(pn.paidBy);
      nextSplitMode = pn.splitMode;
    }

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
      approverIds = canonicalizeApproverIds(approverIds, userStore);
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
        paidByJson = ?, splitMode = ?,
        ivaRate = ?, ivaAmount = ?,
        approvedBy = ?, approvedAt = ?,
        rejectedBy = ?, rejectedAt = ?, rejectionNote = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      nextAmount, nextDesc, nextCat, nextDate, nextNotes, finalStatus, nextDeptId,
      nextApproversJson, nextVotesJson,
      nextPaidByJson, nextSplitMode,
      nextIvaRate, nextIvaAmount,
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
      await receiptStorage.removeReceiptAsset(exp.receiptPath, DATA_DIR);
    } catch (e) {
      console.warn('[receipt] remove on expense delete:', e.message);
    }
    audit('expense_deleted', { userId: req.userId, targetId: exp.id, previous: prev });
    res.json({ ok: true });
  });

  router.post('/:id/approve', requireAuth, (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (exp.status === 'deleted') return res.status(400).json({ error: 'Gasto no válido.' });
    const now = Date.now();
    const adminId = req.userId || null;
    const approversRaw = parseJsonArray(exp.approversJson);

    if (approversRaw.length === 0) {
      if (!isAdminRole(req.userRole)) {
        return res.status(403).json({ error: 'Solo administradores pueden aprobar este gasto.' });
      }
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
    if (!userIdInRawApproverList(approversRaw, adminId, userStore)) {
      return res.status(403).json({ error: 'No eres aprobador designado para este gasto.' });
    }

    const approversCanon = canonicalizeApproverIds(approversRaw, userStore);
    const votes = remapVotesWithCanonicalKeys(parseJsonObject(exp.approvalVotesJson), userStore);
    votes[adminId] = 'approved';
    const allDone = approversCanon.length > 0 && approversCanon.every((id) => votes[id] === 'approved');

    if (allDone) {
      db.prepare(`
        UPDATE expenses SET
          status = 'approved',
          approversJson = ?,
          approvalVotesJson = ?,
          approvedBy = ?, approvedAt = ?,
          rejectedBy = NULL, rejectedAt = NULL, rejectionNote = NULL,
          updatedAt = ?
        WHERE id = ?
      `).run(JSON.stringify(approversCanon), JSON.stringify(votes), adminId, now, now, exp.id);
    } else {
      db.prepare(`
        UPDATE expenses SET approversJson = ?, approvalVotesJson = ?, updatedAt = ?
        WHERE id = ?
      `).run(JSON.stringify(approversCanon), JSON.stringify(votes), now, exp.id);
    }
    const updated = getExpenseById(exp.id);
    const approveNote = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : undefined;
    audit('expense_approved', { userId: adminId, targetId: exp.id, note: approveNote });
    res.json({ ok: true, expense: updated });
  });

  router.post('/:id/reject', requireAuth, (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (exp.status === 'deleted') return res.status(400).json({ error: 'Gasto no válido.' });
    const now = Date.now();
    const adminId = req.userId || null;
    const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : null;
    const approversRaw = parseJsonArray(exp.approversJson);

    if (approversRaw.length > 0) {
      if (exp.status !== 'submitted') {
        return res.status(400).json({ error: 'El gasto no está pendiente de aprobación.' });
      }
      if (!userIdInRawApproverList(approversRaw, adminId, userStore)) {
        return res.status(403).json({ error: 'No eres aprobador designado para este gasto.' });
      }
    } else if (!isAdminRole(req.userRole)) {
      return res.status(403).json({ error: 'No autorizado.' });
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
    try {
      await receiptStorage.removeReceiptAsset(exp.receiptPath, DATA_DIR);
      const { receiptPath } = await receiptStorage.saveReceiptB64ToStorage({
        b64,
        mediaType,
        entityId: exp.id,
        DATA_DIR,
      });
      const now = Date.now();
      db.prepare(`UPDATE expenses SET receiptPath = ?, updatedAt = ? WHERE id = ?`).run(receiptPath, now, exp.id);
      audit('expense_receipt_uploaded', { userId: req.userId, targetId: exp.id, receiptPath });
      return res.json({ ok: true, receiptPath });
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 400 && code < 500) {
        return res.status(code).json({ error: e.message || 'Solicitud inválida.' });
      }
      console.error('[receipt] upload', e.message || e);
      return res.status(500).json({ error: 'No se pudo guardar el recibo.' });
    }
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

    if (receiptStorage.isRemoteReceiptPath(exp.receiptPath)) {
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
    const MIME_MAP = {
      '.pdf':  'application/pdf',
      '.png':  'image/png',
      '.webp': 'image/webp',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
    };
    const type = MIME_MAP[ext] || 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.sendFile(path.resolve(abs));
  });

  return router;
}

module.exports = { createExpensesRouter };
