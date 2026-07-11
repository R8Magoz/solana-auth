'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { warnIfNoChanges } = require('./userStore');
const receiptStorage = require('./receiptStorage');
const settingsCache = require('./lib/settingsCache');
const {
  getApproverIdsForDepartmentId,
  resolvePrimaryAdminUserId,
  parseApproverIdsJson,
  syncDepartmentApproversSettings,
} = require('./lib/departmentApprovers');
const { buildTraceCode } = require('./lib/traceCode');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO4217 = /^[A-Z]{3}$/;
const { nextDueDate, RECURRENCE_RULES, isValidRecurrenceRule } = require('./recurrence');

const RECURRENCE_RULES_ACCEPTED = [...RECURRENCE_RULES, 'daily'];

/** daily is valid for create/update but lives outside recurrence.js RECURRENCE_RULES. */
function isAllowedRecurrenceRule(rule) {
  const r = String(rule || '').trim();
  if (!r) return false;
  if (r === 'daily') return true;
  return isValidRecurrenceRule(r);
}

function reportRefDateISO(row) {
  if (!row) return '';
  if (row.expenseType === 'invoice') {
    return String(row.dueDate || row.date || '').slice(0, 10);
  }
  return String(row.date || '').slice(0, 10);
}

function validateReportRange(req, res) {
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

function eurAmountRow(row) {
  if (row.amountEUR != null && !Number.isNaN(Number(row.amountEUR))) {
    return Number(row.amountEUR);
  }
  return Number(row.amount) || 0;
}

function rowMatchesReportStatus(row, statusFilter) {
  const st = String(row.status || '').trim();
  if (statusFilter === 'approved') return st === 'approved';
  if (statusFilter === 'pending') {
    return st !== 'approved' && st !== 'rejected' && st !== 'deleted';
  }
  return st !== 'deleted';
}

function rowMatchesReportType(row, typeFilter) {
  const inv = row.expenseType === 'invoice';
  if (typeFilter === 'expenses') return !inv;
  if (typeFilter === 'bills' || typeFilter === 'invoices') return inv;
  return true;
}

function buildUserNameMap(userStore) {
  const map = {};
  try {
    const users = userStore.getAllUsersPublic ? userStore.getAllUsersPublic() : [];
    for (const u of users) {
      if (u && u.id) map[u.id] = u.name || u.email || u.id;
    }
  } catch (e) {
    /* ignore */
  }
  return map;
}

/** Reads numeric app_settings keys (e.g. approval_threshold) via settingsCache. */
function parseAppSettingFloat(key, defaultVal) {
  try {
    const raw = settingsCache.get(key, undefined);
    if (raw === undefined || raw === null || raw === '') return defaultVal;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(n)) return defaultVal;
    return n;
  } catch {
    return defaultVal;
  }
}

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

function getApproverIdsForDepartment(departmentId) {
  return getApproverIdsForDepartmentId(departmentId, db);
}

function resolveApproverIdsForCreate(body) {
  const fromBody = normalizeApprovalRequiredFromBody(body);
  if (fromBody.length > 0) return fromBody;
  return getApproverIdsForDepartment(body && body.departmentId);
}

function computeSubmittedVotes(submitterId, approverIds) {
  const votes = {};
  if (approverIds.includes(submitterId)) votes[submitterId] = 'approved';
  const allDone = allApproversVotedApproved(approverIds, votes);
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

function anyRejectionVote(votes) {
  if (!votes || typeof votes !== 'object') return false;
  return Object.values(votes).some((v) => v === 'rejected');
}

/** True only when every listed approver has an explicit approve vote. */
function allApproversVotedApproved(approverIds, votes) {
  if (!Array.isArray(approverIds) || approverIds.length === 0) return false;
  return approverIds.every((id) => votes[id] === 'approved');
}

function userIdInRawApproverList(approverTokens, userId, userStore) {
  const uid = String(userId || '');
  for (const tok of approverTokens || []) {
    if (resolveApproverTokenToUserId(tok, userStore) === uid) return true;
  }
  return false;
}

const EXPENSE_EDIT_TRACKED = [
  'amount', 'description', 'category', 'date', 'notes', 'departmentId',
  'ivaRate', 'ivaAmount', 'vendor', 'dueDate', 'expenseType',
];

function normEditVal(field, val) {
  if (field === 'amount' || field === 'ivaRate' || field === 'ivaAmount') {
    if (val == null || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  if (field === 'expenseType') return String(val || 'expense').toLowerCase();
  if (val == null) return null;
  return String(val);
}

/** Field-level diff for audit_log edit backlog. */
function buildExpenseFieldDiff(prev, next) {
  const changes = [];
  for (const field of EXPENSE_EDIT_TRACKED) {
    const from = normEditVal(field, prev[field]);
    const to = normEditVal(field, next[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  const prevPaid = prev.paidByJson != null ? String(prev.paidByJson) : null;
  const nextPaid = next.paidByJson != null ? String(next.paidByJson) : null;
  if (prevPaid !== nextPaid) changes.push({ field: 'paidBy', from: prevPaid, to: nextPaid });
  const prevSplit = prev.splitMode != null ? String(prev.splitMode) : null;
  const nextSplit = next.splitMode != null ? String(next.splitMode) : null;
  if (prevSplit !== nextSplit) changes.push({ field: 'splitMode', from: prevSplit, to: nextSplit });
  return changes;
}

function collectReferencedUserIds(expenseRows) {
  const ids = new Set();
  for (const e of expenseRows || []) {
    if (e.userId) ids.add(e.userId);
    if (e.ownerId) ids.add(e.ownerId);
    if (e.approvedBy) ids.add(e.approvedBy);
    if (e.rejectedBy) ids.add(e.rejectedBy);
    if (e.paidConfirmedBy) ids.add(e.paidConfirmedBy);
    for (const id of parseJsonArray(e.approversJson)) ids.add(id);
    try {
      const paidBy = JSON.parse(e.paidByJson || '[]');
      if (Array.isArray(paidBy)) {
        for (const p of paidBy) {
          if (p && p.userId) ids.add(p.userId);
        }
      }
    } catch {
      /* ignore */
    }
  }
  ids.delete('system');
  return [...ids];
}

function resolveExpenseApproverIdsForAuth(exp, userStore) {
  const raw = parseJsonArray(exp && exp.approversJson);
  if (raw.length > 0) return canonicalizeApproverIds(raw, userStore);
  return canonicalizeApproverIds(getApproverIdsForDepartment(exp && exp.departmentId), userStore);
}

function canUserActOnExpenseApproval(exp, userId, userRole, userStore) {
  const approverIds = resolveExpenseApproverIdsForAuth(exp, userStore);
  return approverIds.includes(String(userId || ''));
}

/** When amount changes on edit without a new paidBy[], scale existing split to the new total. */
function recalculatePaidByForNewTotal(paidByJson, splitMode, newTotalEur, submitterId, userStore) {
  const total = Number(newTotalEur);
  if (!Number.isFinite(total) || total <= 0) return { error: 'Importe total inválido para el reparto.' };
  let rows;
  try {
    rows = JSON.parse(paidByJson || '[]');
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    const submit = String(submitterId || '').trim();
    return {
      paidBy: [{ userId: submit, amount: Math.round(total * 100) / 100, pct: 100 }],
      splitMode: null,
    };
  }
  if (rows.length === 1) {
    const uid = resolveApproverTokenToUserId(rows[0].userId, userStore);
    return {
      paidBy: [{ userId: uid, amount: Math.round(total * 100) / 100, pct: 100 }],
      splitMode: null,
    };
  }
  const mode = splitMode === 'percentage' || splitMode === 'amount' || splitMode === 'equal'
    ? splitMode
    : 'equal';
  const resolved = rows.map((r) => ({
    userId: resolveApproverTokenToUserId(r.userId, userStore),
    amount: Number(r.amount) || 0,
    pct: typeof r.pct === 'number' && Number.isFinite(r.pct) ? r.pct : null,
  }));
  const out = [];
  if (mode === 'percentage') {
    const pcts = resolved.map((r) => (r.pct != null ? r.pct : 100 / resolved.length));
    const pctSum = pcts.reduce((s, p) => s + p, 0) || 100;
    let sum = 0;
    for (let i = 0; i < resolved.length; i++) {
      const amt = i === resolved.length - 1
        ? Math.round((total - sum) * 100) / 100
        : Math.round(total * (pcts[i] / pctSum) * 100) / 100;
      out.push({ userId: resolved[i].userId, amount: amt, pct: pcts[i] });
      sum += amt;
    }
    return { paidBy: out, splitMode: 'percentage' };
  }
  if (mode === 'amount') {
    const oldSum = resolved.reduce((s, r) => s + r.amount, 0);
    if (oldSum > 0) {
      let sum = 0;
      for (let i = 0; i < resolved.length; i++) {
        const amt = i === resolved.length - 1
          ? Math.round((total - sum) * 100) / 100
          : Math.round(total * (resolved[i].amount / oldSum) * 100) / 100;
        out.push({ userId: resolved[i].userId, amount: amt });
        sum += amt;
      }
      return { paidBy: out, splitMode: 'amount' };
    }
  }
  const n = resolved.length;
  const share = Math.floor((total / n) * 100) / 100;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const amt = i === n - 1 ? Math.round((total - sum) * 100) / 100 : share;
    out.push({ userId: resolved[i].userId, amount: amt });
    sum += amt;
  }
  return { paidBy: out, splitMode: 'equal' };
}

function finalizeFromApprovalVotes(exp, approversCanon, votes, actorUserId, now, rejectionNote) {
  const hasReject = anyRejectionVote(votes);
  const allDone = !hasReject && allApproversVotedApproved(approversCanon, votes);
  const base = {
    approversJson: JSON.stringify(approversCanon),
    approvalVotesJson: JSON.stringify(votes),
    updatedAt: now,
  };
  if (hasReject) {
    const rejectorEntry = Object.entries(votes).find(([, v]) => v === 'rejected');
    const rejectedBy = rejectorEntry ? rejectorEntry[0] : actorUserId;
    return {
      ...base,
      status: 'rejected',
      approvedBy: null,
      approvedAt: null,
      rejectedBy,
      rejectedAt: now,
      rejectionNote: rejectionNote != null
        ? rejectionNote
        : (exp.rejectionNote || 'Rechazado por voto de aprobador.'),
    };
  }
  if (allDone) {
    return {
      ...base,
      status: 'approved',
      approvedBy: actorUserId,
      approvedAt: now,
      rejectedBy: null,
      rejectedAt: null,
      rejectionNote: null,
    };
  }
  return {
    ...base,
    status: 'submitted',
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionNote: null,
  };
}

function persistApprovalFinalize(exp, fin, auditFn, req, actorUserId) {
  const info = db.prepare(`
    UPDATE expenses SET
      status = ?, approversJson = ?, approvalVotesJson = ?,
      approvedBy = ?, approvedAt = ?,
      rejectedBy = ?, rejectedAt = ?, rejectionNote = ?,
      updatedAt = ?
    WHERE id = ?
  `).run(
    fin.status, fin.approversJson, fin.approvalVotesJson,
    fin.approvedBy, fin.approvedAt,
    fin.rejectedBy, fin.rejectedAt, fin.rejectionNote,
    fin.updatedAt, exp.id,
  );
  if (warnIfNoChanges(info, 'expense_approval_finalize', { expenseId: exp.id, userId: actorUserId })) {
    return { error: 'Gasto no encontrado.', status: 404 };
  }
  const updated = getExpenseById(exp.id);
  let budgetExceeded;
  if (fin.status === 'approved' && updated.departmentId) {
    budgetExceeded = maybeNotifyBudgetExceeded({
      audit: auditFn,
      departmentId: updated.departmentId,
      expenseId: updated.id,
      actorUserId,
      submitterUserId: updated.userId,
      ip: req && req.ip,
    });
  }
  return { updated, budgetExceeded };
}

/** After soft-delete: auto-approve pending slots for removed approvers and re-evaluate status. */
function autoApprovePendingForRemovedUser(removedUserId, { audit, userStore }) {
  const uid = String(removedUserId || '').trim();
  if (!uid) return { updated: 0 };
  const rows = db.prepare(
    "SELECT * FROM expenses WHERE status IN ('submitted', 'approved', 'rejected')",
  ).all();
  let updated = 0;
  const now = Date.now();
  for (const row of rows) {
    const exp = rowToExpense(row);
    const approversCanon = resolveExpenseApproverIdsForAuth(exp, userStore);
    if (!approversCanon.includes(uid)) continue;
    const votes = remapVotesWithCanonicalKeys(parseJsonObject(exp.approvalVotesJson), userStore);
    if (votes[uid]) continue;
    votes[uid] = 'approved';
    audit('expense_approver_removed_autoapprove', { userId: uid, targetId: exp.id });
    const fin = finalizeFromApprovalVotes(exp, approversCanon, votes, uid, now, null);
    const result = persistApprovalFinalize(exp, fin, audit, null, uid);
    if (!result.error) updated++;
  }
  return { updated };
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
  return role === 'admin';
}

/** Approved expenses + invoices (any payment status); rejected/deleted excluded. */
function deptApprovedSpendEur(departmentId, excludeExpenseId = null) {
  if (!departmentId) return 0;
  if (excludeExpenseId) {
    const row = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(amountEUR, amount)), 0) AS spent
      FROM expenses
      WHERE departmentId = ? AND status = 'approved' AND id != ?
    `).get(departmentId, excludeExpenseId);
    return Number(row?.spent) || 0;
  }
  const row = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(amountEUR, amount)), 0) AS spent
    FROM expenses
    WHERE departmentId = ? AND status = 'approved'
  `).get(departmentId);
  return Number(row?.spent) || 0;
}

function getDepartmentBudgetRow(departmentId) {
  return db.prepare('SELECT id, name, budget FROM departments WHERE id = ?').get(departmentId) || null;
}

function adminUserIds() {
  return db.prepare(
    "SELECT id FROM users WHERE role = 'admin' AND id != 'system'"
  ).all().map((r) => r.id);
}

/**
 * When an approval pushes department spend over budget, audit one row per recipient.
 * @returns {{ exceeded: boolean, notified?: boolean, budget?: number, spent?: number, departmentName?: string }}
 */
function maybeNotifyBudgetExceeded({ audit, departmentId, expenseId, actorUserId, submitterUserId, ip }) {
  const dept = getDepartmentBudgetRow(departmentId);
  if (!dept) return { exceeded: false };
  const budget = Number(dept.budget) || 0;
  if (budget <= 0) return { exceeded: false };

  const afterSpent = deptApprovedSpendEur(departmentId);
  const beforeSpent = expenseId ? deptApprovedSpendEur(departmentId, expenseId) : afterSpent;

  if (beforeSpent > budget || afterSpent <= budget) {
    return { exceeded: afterSpent > budget, budget, spent: afterSpent, departmentName: dept.name };
  }

  const recipients = new Set(adminUserIds());
  if (submitterUserId) recipients.add(submitterUserId);

  for (const uid of recipients) {
    audit('department_budget_exceeded', {
      userId: uid,
      targetId: dept.id,
      expenseId,
      departmentName: dept.name,
      budget,
      spent: afterSpent,
      actorUserId,
      submitterUserId,
      ip,
    });
  }

  return { exceeded: true, notified: true, budget, spent: afterSpent, departmentName: dept.name };
}

function rowToExpense(r) {
  if (!r) return null;
  return {
    ...r,
    cadenceKey: r.cadenceKey != null && r.cadenceKey !== '' ? String(r.cadenceKey) : 'once',
    cadenceCustomMonths: r.cadenceCustomMonths != null && r.cadenceCustomMonths !== '' ? String(r.cadenceCustomMonths) : '1',
  };
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
  const { status, from, to, category, userId: qUser, includeDeleted, expenseType } = req.query;
  void includeDeleted;
  const parts = ["status != 'deleted'"];
  const vals = [];

  if (qUser) {
    const u = String(qUser).trim().slice(0, 128);
    parts.push('(userId = ? OR ownerId = ?)');
    vals.push(u, u);
  }

  if (status) {
    parts.push('status = ?');
    vals.push(String(status).trim().slice(0, 32));
  }
  if (expenseType) {
    parts.push('expenseType = ?');
    vals.push(String(expenseType).trim().slice(0, 32));
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
    ivaRate, ivaAmount, commentsJson, ownerId,
    expenseType, vendor, dueDate, paymentStatus, paidAt, paidConfirmedBy, paymentTermDays, deferredPayment, recurring, recurrenceRule, originBillId,
    cadenceKey, cadenceCustomMonths, clientRef, traceCode
  ) VALUES (
    @id, @userId, @amount, @currency, @amountEUR, @description, @category, @date, @status,
    @approvedBy, @approvedAt, @rejectedBy, @rejectedAt, @rejectionNote, @receiptPath, @notes, @createdAt, @updatedAt, @departmentId,
    @approversJson, @approvalVotesJson, @paidByJson, @splitMode,
    @ivaRate, @ivaAmount, @commentsJson, @ownerId,
    @expenseType, @vendor, @dueDate, @paymentStatus, @paidAt, @paidConfirmedBy, @paymentTermDays, @deferredPayment, @recurring, @recurrenceRule, @originBillId,
    @cadenceKey, @cadenceCustomMonths, @clientRef, @traceCode
  )
`);

/**
 * Express router for expenses and invoices (CRUD, receipts, approvals, comments).
 * @param {{ audit: function(string, object): void, requireAuth: import('express').RequestHandler, requireAdminSession: import('express').RequestHandler, DATA_DIR: string, receiptUploadLimiter?: import('express').RequestHandler, userStore: { findUserById: function(string): object|undefined, findUserByEmail: function(string): object|undefined } }} deps
 * @returns {import('express').Router}
 */
function createExpensesRouter({ audit, requireAuth, requireAdminSession, DATA_DIR, receiptUploadLimiter, userStore }) {
  if (!userStore) throw new Error('createExpensesRouter: userStore is required');
  const router = express.Router();
  const receiptLimit = receiptUploadLimiter || express.json({ limit: '100mb' });

  router.use(requireAuth);

  router.get('/', (req, res) => {
    try {
      const expenses = listExpenses(req);
      const refIds = collectReferencedUserIds(expenses);
      const users = userStore.getPublicUsersByIds
        ? userStore.getPublicUsersByIds(refIds)
        : [];
      res.json({ expenses, users });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al listar gastos.' });
    }
  });

  router.get('/budget-alerts', (req, res) => {
    try {
      const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const rows = db.prepare(`
        SELECT id, ts, event, userId, targetId, detail
        FROM audit_log
        WHERE event = 'department_budget_exceeded' AND userId = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(req.userId, lim);

      const alerts = rows.map((r) => {
        let detail = {};
        if (r.detail) {
          try { detail = JSON.parse(r.detail); } catch { /* ignore */ }
        }
        return {
          id: r.id,
          ts: r.ts,
          departmentId: r.targetId || detail.departmentId,
          departmentName: detail.departmentName,
          expenseId: detail.expenseId,
          budget: detail.budget,
          spent: detail.spent,
        };
      });
      res.json({ alerts });
    } catch (e) {
      console.error('[expenses/budget-alerts]', e);
      res.status(500).json({ error: 'Error al leer alertas de presupuesto.' });
    }
  });

  router.post('/', async (req, res) => {
    try {
    const clientRefRaw = req.body && (req.body.clientRef ?? req.body.idempotencyKey);
    const clientRef = typeof clientRefRaw === 'string' && clientRefRaw.trim()
      ? clientRefRaw.trim().slice(0, 128)
      : null;
    if (clientRef) {
      const existingByRef = db.prepare(`
        SELECT id FROM expenses
        WHERE userId = ? AND clientRef = ? AND status != 'deleted'
        LIMIT 1
      `).get(req.userId, clientRef);
      if (existingByRef) {
        const existing = getExpenseById(existingByRef.id);
        return res.json({ ok: true, expense: existing });
      }
    }

    const ownerRaw = String(req.body.ownerId || req.body.owner || '').trim();
    let resolvedOwner = null;

    if (ownerRaw) {
      const allUsers = db.prepare(
        "SELECT * FROM users WHERE id != 'system'"
      ).all();
      resolvedOwner =
        allUsers.find(u => u.id === ownerRaw) ||
        allUsers.find(u => u.id === resolveApproverTokenToUserId(ownerRaw, userStore)) ||
        allUsers.find(u => u.name && u.name.toLowerCase() === ownerRaw.toLowerCase()) ||
        allUsers.find(u => u.username && u.username.toLowerCase() === ownerRaw.toLowerCase()) ||
        allUsers.find(u => u.email && u.email.toLowerCase() === ownerRaw.toLowerCase());
    }

    // Final fallback: use the submitting user
    if (!resolvedOwner) {
      resolvedOwner = userStore.findUserById(req.userId);
    }

    if (!resolvedOwner) {
      return res.status(400).json({
        error: `Titular no encontrado. Recibido: "${ownerRaw}"`
      });
    }

    let ownerId = resolvedOwner.id;
    const {
      amount, currency, amountEUR, description, category, date, notes, status,
      expenseType: bodyExpenseType, vendor, dueDate, recurring, recurrenceRule,
      b64: bodyB64, receiptB64,
    } = req.body || {};
    const dept = departmentIdFromBody(req.body, true);
    if (dept.error) return res.status(400).json({ error: dept.error });
    if (amount == null || typeof amount !== 'number' || !Number.isFinite(amount)) {
      return res.status(400).json({ error: 'amount numérico requerido.' });
    }
    const expenseTypeRaw = bodyExpenseType != null ? String(bodyExpenseType).trim().toLowerCase() : 'expense';
    const expenseType = expenseTypeRaw === 'invoice' ? 'invoice' : 'expense';
    const vendorStr = typeof vendor === 'string' ? vendor.trim().slice(0, 256) : '';
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
    // Idempotency: reject duplicate submissions within 10 seconds
    const recentDuplicate = db.prepare(`
      SELECT id FROM expenses
      WHERE userId = ?
        AND description = ?
        AND amount = ?
        AND date = ?
        AND createdAt > ?
        AND status != 'deleted'
      LIMIT 1
    `).get(
      req.userId,
      desc,
      amount,
      dateStr,
      Date.now() - 10000
    );

    if (recentDuplicate) {
      console.warn('[POST /expenses] duplicate submission blocked:', recentDuplicate.id);
      const existing = getExpenseById(recentDuplicate.id);
      return res.json({ expense: existing });
    }
    let resolvedDueDate = typeof dueDate === 'string' ? dueDate.trim().slice(0, 10) : '';
    if (expenseType === 'invoice') {
      if (!vendorStr) {
        return res.status(400).json({ error: 'vendor requerido para factura (máx. 256 caracteres).' });
      }
      if (resolvedDueDate && !DATE_RE.test(resolvedDueDate)) {
        return res.status(400).json({ error: 'dueDate inválida.' });
      }
      if (!resolvedDueDate) resolvedDueDate = dateStr;
    }
    const rec = recurring === true || recurring === 1 || recurring === '1';
    let rule = recurrenceRule != null ? String(recurrenceRule).trim().slice(0, 48) : null;
    if (rec) {
      if (!rule || !isAllowedRecurrenceRule(rule)) {
        return res.status(400).json({ error: `recurrenceRule: ${RECURRENCE_RULES_ACCEPTED.join(' | ')} | custom:N[weeks|months|years] | custom:N` });
      }
    } else {
      rule = null;
    }
    const cur = 'EUR';
    let st = typeof status === 'string' ? status.trim().slice(0, 32) : 'submitted';
    if (!['draft', 'submitted'].includes(st)) {
      return res.status(400).json({ error: 'status inicial solo draft o submitted.' });
    }
    const eur = amount;

    const b64Inline =
      typeof bodyB64 === 'string' && bodyB64.trim().length > 0
        ? bodyB64.trim()
        : typeof receiptB64 === 'string' && receiptB64.trim().length > 0
          ? receiptB64.trim()
          : null;

    const eurNum = eur != null && Number.isFinite(Number(eur)) ? Number(eur) : null;

    const now = Date.now();
    const id = 'exp_' + crypto.randomBytes(8).toString('hex');
    const amountForTrace = eur != null && Number.isFinite(Number(eur)) ? Number(eur) : amount;
    const traceCodeVal = buildTraceCode(now, amountForTrace, id);

    let receiptPathVal = null;
    if (b64Inline) {
      const mediaTypeRaw =
        req.body && typeof req.body.mediaType === 'string' ? req.body.mediaType.trim() : '';
      const mediaType = mediaTypeRaw || 'application/octet-stream';
      try {
        const saved = await receiptStorage.saveReceiptB64ToStorage({
          b64: b64Inline,
          mediaType,
          entityId: id,
          DATA_DIR,
          traceCode: traceCodeVal,
        });
        receiptPathVal = saved.receiptPath;
      } catch (e) {
        const code = e.statusCode || 500;
        if (code >= 400 && code < 500) {
          return res.status(code).json({ error: e.message || 'Recibo inválido.' });
        }
        console.error('[expenses/create] receipt', e.message || e);
        return res.status(500).json({ error: 'No se pudo guardar el recibo.' });
      }
    }

    let approverIds = [];
    let finalStatus = st;
    let approvedByVal = null;
    let approvedAtVal = null;
    let votesObj = {};

    approverIds = resolveApproverIdsForCreate(req.body);
    approverIds = canonicalizeApproverIds(approverIds, userStore);
    if (st === 'submitted' && approverIds.length === 0) {
      return res.status(400).json({
        error: 'El departamento seleccionado no tiene aprobadores asignados.',
      });
    }
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

    // Validate all FK references exist in users table before INSERT
    const fkChecks = [
      { field: 'userId', value: req.userId },
      { field: 'ownerId', value: ownerId },
    ];
    for (const { field, value } of fkChecks) {
      if (value) {
        const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(value);
        if (!exists) {
          if (field === 'ownerId') {
            // fallback: use submitter
            ownerId = req.userId;
          } else {
            return res.status(400).json({ error: `Usuario no encontrado: ${field}` });
          }
        }
      }
    }

    try {
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
      receiptPath: receiptPathVal,
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
      expenseType,
      vendor: expenseType === 'invoice' ? vendorStr : null,
      dueDate: expenseType === 'invoice' ? resolvedDueDate : null,
      paymentStatus: 'na',
      paidAt: null,
      paidConfirmedBy: null,
      paymentTermDays: 0,
      deferredPayment: 0,
      recurring: rec ? 1 : 0,
      recurrenceRule: rule,
      originBillId: null,
      cadenceKey: String(req.body.cadenceKey || 'once').trim().slice(0, 32),
      cadenceCustomMonths: String(req.body.cadenceCustomMonths || '1').trim().slice(0, 8),
      clientRef,
      traceCode: traceCodeVal,
    });
    } catch (insertErr) {
      if (clientRef && insertErr && insertErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const raced = db.prepare(`
          SELECT id FROM expenses
          WHERE userId = ? AND clientRef = ? AND status != 'deleted'
          LIMIT 1
        `).get(req.userId, clientRef);
        if (raced) {
          const existing = getExpenseById(raced.id);
          return res.json({ ok: true, expense: existing });
        }
      }
      throw insertErr;
    }

    const expense = getExpenseById(id);
    audit('expense_created', { userId: req.userId, targetId: id, amount, currency: cur, status: finalStatus });
    let budgetExceeded;
    if (finalStatus === 'approved' && dept.id) {
      budgetExceeded = maybeNotifyBudgetExceeded({
        audit,
        departmentId: dept.id,
        expenseId: id,
        actorUserId: req.userId,
        submitterUserId: req.userId,
        ip: req.ip,
      });
    }
    res.json({
      ok: true,
      expense,
      ...(budgetExceeded && budgetExceeded.exceeded ? { budgetExceeded } : {}),
    });
    } catch (e) {
      console.error('[POST /expenses] UNHANDLED ERROR:', e && (e.stack || e.message || e));
      console.error('[expenses/create]', e);
      if (!res.headersSent) res.status(500).json({ error: 'Error al crear gasto: ' + (e && e.message ? e.message : String(e)) });
    }
  });

  router.post('/:id/comments', (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
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
    const info = db.prepare('UPDATE expenses SET commentsJson = ?, updatedAt = ? WHERE id = ?').run(
      JSON.stringify(list),
      now,
      exp.id,
    );
    if (warnIfNoChanges(info, 'expense_comment', { expenseId: exp.id, userId: req.userId })) {
      return res.status(404).json({ error: 'Gasto no encontrado.' });
    }
    const updated = getExpenseById(exp.id);
    audit('expense_comment_added', { userId: req.userId, targetId: exp.id });
    res.json({ ok: true, expense: updated });
  });

  function putOrPatchExpense(req, res) {
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

    const {
      amount, description, category, date, notes, status,
      expenseType: bodyExpenseType, vendor, dueDate, recurring, recurrenceRule,
    } = req.body || {};
    let nextDeptId = exp.departmentId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'departmentId')) {
      const dept = departmentIdFromBody(req.body, true);
      if (dept.error) return res.status(400).json({ error: dept.error });
      nextDeptId = dept.id;
    }
    let nextOwnerId = exp.ownerId ?? exp.userId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ownerId')) {
      const ownerRaw = String(req.body.ownerId || '').trim();
      if (ownerRaw) {
        const allUsers = db.prepare("SELECT * FROM users WHERE id != 'system'").all();
        const resolvedOwner =
          allUsers.find(u => u.id === ownerRaw) ||
          allUsers.find(u => u.id === resolveApproverTokenToUserId(ownerRaw, userStore)) ||
          allUsers.find(u => u.name && u.name.toLowerCase() === ownerRaw.toLowerCase()) ||
          allUsers.find(u => u.username && u.username.toLowerCase() === ownerRaw.toLowerCase()) ||
          allUsers.find(u => u.email && u.email.toLowerCase() === ownerRaw.toLowerCase());
        if (resolvedOwner) nextOwnerId = resolvedOwner.id;
      }
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

    const prevType = String(exp.expenseType || 'expense');
    let nextExpenseType = prevType;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'expenseType')) {
      const rawEt = bodyExpenseType != null ? String(bodyExpenseType).trim().toLowerCase() : 'expense';
      nextExpenseType = rawEt === 'invoice' ? 'invoice' : 'expense';
    }

    let nextVendor = exp.vendor ?? null;
    let nextDue = exp.dueDate ?? null;
    let nextRec = Number(exp.recurring) === 1;
    let nextRule = exp.recurrenceRule != null ? String(exp.recurrenceRule).trim().slice(0, 48) : null;

    if (nextExpenseType === 'expense') {
      nextVendor = null;
      nextDue = null;
      nextRec = false;
      nextRule = null;
    } else {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'vendor')) {
        nextVendor = String(vendor || '').trim().slice(0, 256);
      } else {
        nextVendor = String(exp.vendor || '').trim().slice(0, 256);
      }
      if (!nextVendor) {
        return res.status(400).json({ error: 'vendor requerido para factura (máx. 256 caracteres).' });
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'dueDate')) {
        const dueRaw = dueDate != null ? String(dueDate).trim().slice(0, 10) : '';
        nextDue = dueRaw || exp.dueDate || nextDate;
      } else {
        nextDue = exp.dueDate || nextDate;
      }
      if (nextDue && !DATE_RE.test(nextDue)) {
        return res.status(400).json({ error: 'dueDate inválida.' });
      }
      if (!nextDue) {
        return res.status(400).json({ error: 'dueDate requerida para factura.' });
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'recurring')) {
        nextRec = recurring === true || recurring === 1 || recurring === '1';
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'recurrenceRule')) {
        nextRule = recurrenceRule != null ? String(recurrenceRule).trim().slice(0, 48) : null;
      }
      if (nextRec) {
        if (!nextRule || !isAllowedRecurrenceRule(nextRule)) {
          return res.status(400).json({ error: `recurrenceRule: ${RECURRENCE_RULES_ACCEPTED.join(' | ')} | custom:N[weeks|months|years] | custom:N` });
        }
      } else {
        nextRule = null;
      }
    }

    const curExpCur = String(exp.currency || 'EUR').toUpperCase();
    const nextAmountEUR = curExpCur === 'EUR'
      ? nextAmount
      : (exp.amountEUR != null && Number.isFinite(Number(exp.amountEUR)) ? Number(exp.amountEUR) : nextAmount);

    let nextIvaRate = exp.ivaRate != null && exp.ivaRate !== '' ? Number(exp.ivaRate) : null;
    let nextIvaAmount = exp.ivaAmount != null && exp.ivaAmount !== '' ? Number(exp.ivaAmount) : null;
    if (Number.isNaN(nextIvaRate)) nextIvaRate = null;
    if (Number.isNaN(nextIvaAmount)) nextIvaAmount = null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ivaRate')) {
      const iv = ivaFromBody(req.body, curExpCur === 'EUR' ? nextAmount : nextAmountEUR);
      if (iv.error) return res.status(400).json({ error: iv.error });
      nextIvaRate = iv.ivaRate;
      nextIvaAmount = iv.ivaAmount;
    }

    let nextPaidByJson = exp.paidByJson ?? null;
    let nextSplitMode = exp.splitMode ?? null;
    const curExpCurSplit = String(exp.currency || 'EUR').toUpperCase();
    const totalForSplit = curExpCurSplit === 'EUR'
      ? nextAmount
      : (exp.amountEUR != null && Number.isFinite(Number(exp.amountEUR)) ? Number(exp.amountEUR) : nextAmount);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'paidBy')) {
      const pn = normalizePaidByFromBody(req.body, exp.userId, totalForSplit, userStore);
      if (pn.error) return res.status(400).json({ error: pn.error });
      nextPaidByJson = JSON.stringify(pn.paidBy);
      nextSplitMode = pn.splitMode;
    } else if (amount !== undefined && Number(amount) !== Number(exp.amount)) {
      const recalc = recalculatePaidByForNewTotal(
        exp.paidByJson, exp.splitMode, totalForSplit, exp.userId, userStore,
      );
      if (recalc.error) return res.status(400).json({ error: recalc.error });
      nextPaidByJson = JSON.stringify(recalc.paidBy);
      nextSplitMode = recalc.splitMode;
    }

    let finalStatus = nextStatus;
    let nextApproversJson = exp.approversJson ?? null;
    let nextVotesJson = exp.approvalVotesJson ?? null;
    let nextApprovedBy = exp.approvedBy ?? null;
    let nextApprovedAt = exp.approvedAt ?? null;
    let nextRejectedBy = exp.rejectedBy ?? null;
    let nextRejectedAt = exp.rejectedAt ?? null;
    let nextRejectionNote = exp.rejectionNote ?? null;

    const nextSnapshot = {
      amount: nextAmount,
      description: nextDesc,
      category: nextCat,
      date: nextDate,
      notes: nextNotes,
      departmentId: nextDeptId,
      ivaRate: nextIvaRate,
      ivaAmount: nextIvaAmount,
      vendor: nextVendor,
      dueDate: nextDue,
      expenseType: nextExpenseType,
      paidByJson: nextPaidByJson,
      splitMode: nextSplitMode,
    };
    const fieldChanges = buildExpenseFieldDiff(prev, nextSnapshot);
    const wasApproved = exp.status === 'approved';
    const materialEdit = fieldChanges.length > 0
      && ['submitted', 'approved', 'rejected'].includes(exp.status);

    if (materialEdit) {
      nextVotesJson = JSON.stringify({});
      nextApprovedBy = null;
      nextApprovedAt = null;
      nextRejectedBy = null;
      nextRejectedAt = null;
      nextRejectionNote = null;
      finalStatus = 'submitted';
    }

    const becomingSubmitted = finalStatus === 'submitted'
      && (exp.status === 'rejected' || exp.status === 'draft' || materialEdit);

    if (becomingSubmitted) {
      const bodyList = normalizeApprovalRequiredFromBody(req.body);
      let approverIds = bodyList.length > 0 ? bodyList : parseJsonArray(exp.approversJson);
      if (materialEdit && String(nextDeptId || '') !== String(exp.departmentId || '')) {
        approverIds = getApproverIdsForDepartment(nextDeptId);
      } else if (approverIds.length === 0) {
        approverIds = getApproverIdsForDepartment(nextDeptId);
      }
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

    const updateInfo = db.prepare(`
      UPDATE expenses SET
        amount = ?, amountEUR = ?, description = ?, category = ?, date = ?, notes = ?, status = ?, departmentId = ?,
        approversJson = ?, approvalVotesJson = ?,
        paidByJson = ?, splitMode = ?,
        ivaRate = ?, ivaAmount = ?,
        approvedBy = ?, approvedAt = ?,
        rejectedBy = ?, rejectedAt = ?, rejectionNote = ?,
        expenseType = ?, vendor = ?, dueDate = ?,
        recurring = ?, recurrenceRule = ?,
        cadenceKey = ?, cadenceCustomMonths = ?,
        ownerId = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      nextAmount, nextAmountEUR, nextDesc, nextCat, nextDate, nextNotes, finalStatus, nextDeptId,
      nextApproversJson, nextVotesJson,
      nextPaidByJson, nextSplitMode,
      nextIvaRate, nextIvaAmount,
      nextApprovedBy, nextApprovedAt,
      nextRejectedBy, nextRejectedAt, nextRejectionNote,
      nextExpenseType, nextVendor, nextDue,
      nextRec ? 1 : 0, nextRule,
      String(req.body.cadenceKey || 'once').trim().slice(0, 32),
      String(req.body.cadenceCustomMonths || '1').trim().slice(0, 8),
      nextOwnerId,
      now, exp.id,
    );
    if (warnIfNoChanges(updateInfo, 'expense_update', { expenseId: exp.id, userId: req.userId })) {
      return res.status(404).json({ error: 'Gasto no encontrado.' });
    }
    const updated = getExpenseById(exp.id);
    if (fieldChanges.length > 0) {
      audit('expense_edited', {
        userId: req.userId,
        targetId: exp.id,
        changes: fieldChanges,
      });
      if (materialEdit || wasApproved) {
        audit('expense_reapproval_required', {
          userId: req.userId,
          targetId: exp.id,
          approverIds: parseJsonArray(nextApproversJson),
        });
      }
    } else {
      audit('expense_updated', { userId: req.userId, targetId: exp.id });
    }
    res.json({ ok: true, expense: updated, reapprovalRequired: materialEdit });
  }

  router.get('/:id/audit', (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (!canAccessExpense(req, exp)) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    const rows = db.prepare(`
      SELECT id, ts, event, userId, targetId, detail
      FROM audit_log
      WHERE targetId = ?
      ORDER BY ts ASC, id ASC
    `).all(exp.id);
    const entries = rows.map((r) => {
      const entry = {
        id: r.id,
        ts: r.ts,
        event: r.event,
        userId: r.userId,
        targetId: r.targetId,
      };
      if (r.detail) {
        try {
          const parsed = JSON.parse(r.detail);
          if (parsed && typeof parsed === 'object') Object.assign(entry, parsed);
        } catch {
          entry.detailRaw = r.detail;
        }
      }
      return entry;
    });
    res.json({ ok: true, entries });
  });

  router.put('/:id', putOrPatchExpense);
  router.patch('/:id', putOrPatchExpense);

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
    const deleteInfo = db.prepare(`UPDATE expenses SET status = 'deleted', updatedAt = ? WHERE id = ?`).run(now, exp.id);
    if (warnIfNoChanges(deleteInfo, 'expense_soft_delete', { expenseId: exp.id, userId: req.userId })) {
      return res.status(404).json({ error: 'Gasto no encontrado.' });
    }
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
    if (exp.status === 'approved') {
      return res.json({ ok: true, expense: exp });
    }
    if (exp.status !== 'submitted') {
      return res.status(400).json({ error: 'El gasto no está pendiente de aprobación.' });
    }
    const now = Date.now();
    const actorId = req.userId || null;
    const approversCanon = parseJsonArray(exp.approversJson).length > 0
      ? resolveExpenseApproverIdsForAuth(exp, userStore)
      : canonicalizeApproverIds(getApproverIdsForDepartment(exp.departmentId), userStore);
    if (!canUserActOnExpenseApproval(
      { ...exp, approversJson: JSON.stringify(approversCanon) },
      actorId,
      req.userRole,
      userStore,
    )) {
      return res.status(403).json({ error: 'No eres aprobador designado para este gasto.' });
    }
    const votes = remapVotesWithCanonicalKeys(parseJsonObject(exp.approvalVotesJson), userStore);
    const oldVote = votes[actorId] || null;
    votes[actorId] = 'approved';
    if (oldVote !== 'approved') {
      audit('expense_vote_changed', {
        userId: actorId,
        targetId: exp.id,
        from: oldVote,
        to: 'approved',
      });
    }
    const fin = finalizeFromApprovalVotes(exp, approversCanon, votes, actorId, now, null);
    const result = persistApprovalFinalize(exp, fin, audit, req, actorId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    const approveNote = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : undefined;
    if (fin.status === 'approved' && (exp.status !== 'approved' || exp.approvedAt !== fin.approvedAt)) {
      audit('expense_approved', { userId: actorId, targetId: exp.id, note: approveNote });
    } else if (fin.status === 'rejected' && exp.status !== 'rejected') {
      audit('expense_rejected', { userId: actorId, targetId: exp.id, via: 'approval_vote' });
    }
    return res.json({
      ok: true,
      expense: result.updated,
      ...(result.budgetExceeded && result.budgetExceeded.exceeded ? { budgetExceeded: result.budgetExceeded } : {}),
    });
  });

  router.post('/:id/reject', requireAuth, (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (exp.status === 'deleted') return res.status(400).json({ error: 'Gasto no válido.' });
    if (exp.status === 'rejected') {
      return res.json({ ok: true, expense: exp });
    }
    if (exp.status !== 'submitted' && exp.status !== 'approved') {
      return res.status(400).json({ error: 'El gasto no está pendiente de aprobación.' });
    }
    const now = Date.now();
    const actorId = req.userId || null;
    const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : null;
    if (!note || note.length < 10) {
      return res.status(400).json({ error: 'El motivo del rechazo es obligatorio (mínimo 10 caracteres).' });
    }
    const approversCanon = parseJsonArray(exp.approversJson).length > 0
      ? resolveExpenseApproverIdsForAuth(exp, userStore)
      : canonicalizeApproverIds(getApproverIdsForDepartment(exp.departmentId), userStore);
    if (!canUserActOnExpenseApproval(
      { ...exp, approversJson: JSON.stringify(approversCanon) },
      actorId,
      req.userRole,
      userStore,
    )) {
      return res.status(403).json({ error: 'No eres aprobador designado para este gasto.' });
    }
    const votes = remapVotesWithCanonicalKeys(parseJsonObject(exp.approvalVotesJson), userStore);
    const oldVote = votes[actorId] || null;
    votes[actorId] = 'rejected';
    if (oldVote !== 'rejected') {
      audit('expense_vote_changed', {
        userId: actorId,
        targetId: exp.id,
        from: oldVote,
        to: 'rejected',
      });
    }
    const fin = finalizeFromApprovalVotes(exp, approversCanon, votes, actorId, now, note);
    const result = persistApprovalFinalize(exp, fin, audit, req, actorId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    if (fin.status === 'rejected' && exp.status !== 'rejected') {
      audit('expense_rejected', { userId: actorId, targetId: exp.id, note });
    } else if (fin.status === 'approved' && exp.status !== 'approved') {
      audit('expense_approved', { userId: actorId, targetId: exp.id });
    }
    return res.json({
      ok: true,
      expense: result.updated,
      ...(result.budgetExceeded && result.budgetExceeded.exceeded ? { budgetExceeded: result.budgetExceeded } : {}),
    });
  });

  router.post('/:id/reconsider', requireAuth, (req, res) => {
    const exp = getExpenseById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Gasto no encontrado.' });
    if (exp.status === 'deleted') return res.status(400).json({ error: 'Gasto no válido.' });
    if (exp.status !== 'approved' && exp.status !== 'rejected') {
      return res.status(400).json({ error: 'Gasto no válido.' });
    }
    const actorId = req.userId || null;
    const approversCanon = resolveExpenseApproverIdsForAuth(exp, userStore);
    const isApprover = approversCanon.includes(String(actorId || ''));
    if (!isApprover) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    const previousStatus = exp.status;
    const now = Date.now();
    let approverIds = parseJsonArray(exp.approversJson);
    if (approverIds.length === 0) {
      approverIds = getApproverIdsForDepartment(exp.departmentId);
    }
    approverIds = canonicalizeApproverIds(approverIds, userStore);
    // Reconsider reopens to submitted — sole-approver auto-approve (computeSubmittedVotes) applies only on new submit.
    const finalStatus = 'submitted';
    const votes = {};
    const updateInfo = db.prepare(`
      UPDATE expenses SET
        status = ?, approvalVotesJson = ?, approversJson = ?,
        approvedBy = ?, approvedAt = ?,
        rejectedBy = ?, rejectedAt = ?, rejectionNote = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      finalStatus,
      JSON.stringify(votes),
      JSON.stringify(approverIds),
      null,
      null,
      null,
      null,
      null,
      now,
      exp.id,
    );
    if (warnIfNoChanges(updateInfo, 'expense_reconsider', { expenseId: exp.id, userId: actorId })) {
      return res.status(404).json({ error: 'Gasto no encontrado.' });
    }
    audit('expense_reconsider_requested', {
      userId: actorId,
      targetId: exp.id,
      previousStatus,
    });
    const updated = getExpenseById(exp.id);
    return res.json({ ok: true, expense: updated });
  });

  const receiptJson = express.json({ limit: '100mb' });

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
      const traceForReceipt = exp.traceCode || buildTraceCode(exp.createdAt, exp.amountEUR ?? exp.amount, exp.id);
      const { receiptPath } = await receiptStorage.saveReceiptB64ToStorage({
        b64,
        mediaType,
        entityId: exp.id,
        DATA_DIR,
        traceCode: traceForReceipt,
      });
      const now = Date.now();
      const receiptInfo = db.prepare(`UPDATE expenses SET receiptPath = ?, updatedAt = ? WHERE id = ?`).run(receiptPath, now, exp.id);
      if (warnIfNoChanges(receiptInfo, 'expense_receipt_path', { expenseId: exp.id, userId: req.userId })) {
        return res.status(404).json({ error: 'Gasto no encontrado.' });
      }
      audit('expense_receipt_uploaded', { userId: req.userId, targetId: exp.id, receiptPath });
      return res.json({ ok: true, receiptPath });
    } catch (e) {
      const code = e.statusCode || 500;
      console.error('[receipt] upload error:', e.message || e);
      if (code >= 400 && code < 500) {
        return res.status(code).json({ error: e.message || 'Solicitud inválida.' });
      }
      return res.status(500).json({ error: 'No se pudo guardar el recibo: ' + (e.message || 'error desconocido') });
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
      return res.redirect(302, exp.receiptPath);
    }

    const abs = path.join(DATA_DIR, exp.receiptPath);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: 'Archivo no encontrado.' });
    }
    const ext = path.extname(abs).toLowerCase();
    const MIME_MAP = {
      '.pdf':  'application/pdf',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif':  'image/gif',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
      '.tiff': 'image/tiff',
      '.tif':  'image/tiff',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls':  'application/vnd.ms-excel',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc':  'application/msword',
      '.csv':  'text/csv',
      '.zip':  'application/zip',
      '.bin':  'application/octet-stream',
    };
    const type = MIME_MAP[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    const expCode = exp.traceCode || exp.itemCode || exp.id;
    const dateStr = new Date().toISOString().slice(0, 10);
    const fname = path.basename(abs);
    const safeFilename = `${expCode}_${dateStr}_${fname}`;
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    res.sendFile(path.resolve(abs));
  });

  return router;
}

function pruneDepartmentApproversForUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  const primary = resolvePrimaryAdminUserId(db);
  let changed = false;
  const rows = db.prepare('SELECT id, approverIdsJson FROM departments').all();
  for (const row of rows) {
    let ids = parseApproverIdsJson(row.approverIdsJson);
    if (!ids.includes(uid)) continue;
    const filtered = ids.filter((id) => id !== uid);
    if (filtered.length === 0) {
      if (primary && primary !== uid) ids = [primary];
      else ids = [uid];
    } else {
      ids = filtered;
    }
    db.prepare('UPDATE departments SET approverIdsJson = ? WHERE id = ?').run(JSON.stringify(ids), row.id);
    changed = true;
  }
  if (changed) syncDepartmentApproversSettings(db);
  try {
    const row = db.prepare(
      "SELECT value FROM app_settings WHERE key = 'department_approvers'"
    ).get();
    if (!row || !row.value) return;
    const map = JSON.parse(row.value);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    let legacyChanged = false;
    const next = {};
    for (const [deptId, ids] of Object.entries(map)) {
      if (!Array.isArray(ids)) {
        next[deptId] = ids;
        continue;
      }
      const filtered = ids.filter((id) => String(id) !== uid);
      if (filtered.length !== ids.length) legacyChanged = true;
      next[deptId] = filtered.length > 0 ? filtered : (primary ? [primary] : filtered);
    }
    if (!legacyChanged) return;
    db.prepare(
      "UPDATE app_settings SET value = ?, updatedAt = ? WHERE key = 'department_approvers'"
    ).run(JSON.stringify(next), Date.now());
    settingsCache.invalidate('department_approvers');
  } catch (e) {
    console.warn('[department_approvers] prune failed:', e.message);
  }
}

module.exports = {
  createExpensesRouter,
  autoApprovePendingForRemovedUser,
  pruneDepartmentApproversForUser,
};
