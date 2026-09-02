'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { warnIfNoChanges } = require('./userStore');
const {
  parseApproverIdsJson,
  resolvePrimaryAdminUserId,
  normalizeApproverIdsInput,
  syncDepartmentApproversSettings,
} = require('./lib/departmentApprovers');

const EUR_SUM = `COALESCE(amountEUR, CASE WHEN UPPER(COALESCE(currency, 'EUR')) = 'EUR' THEN amount ELSE 0 END)`;

/** Approved spend in `expenses` (gastos + facturas as expenseType=invoice). Legacy `bills` table is unused for spend. */
function spentForDepartment(deptId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(${EUR_SUM}), 0) AS s FROM expenses
       WHERE departmentId = ? AND status = 'approved'`,
    )
    .get(deptId);
  return Number(row && row.s) || 0;
}

function rowWithStats(row) {
  const spent = spentForDepartment(row.id);
  const budget = Number(row.budget) || 0;
  const remaining = budget - spent;
  const pctUsed =
    budget > 0
      ? Math.min(100, Math.round((spent / budget) * 1000) / 10)
      : spent > 0
        ? 100
        : 0;
  return {
    id: row.id,
    name: row.name,
    budget,
    archived: !!row.archived,
    createdAt: row.createdAt,
    approverIds: parseApproverIdsJson(row.approverIdsJson),
    spent,
    remaining,
    pctUsed,
  };
}

/**
 * Express router for department CRUD and listing (budget tracker).
 * @param {{ audit: function(string, object): void, requireAuth: import('express').RequestHandler, requireSuperAdmin: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
function createDepartmentsRouter({ audit, requireAuth, requireSuperAdmin }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    try {
      const rows = db
        .prepare('SELECT id, name, budget, archived, createdAt, approverIdsJson FROM departments ORDER BY archived ASC, name COLLATE NOCASE')
        .all();
      res.json({ departments: rows.map(rowWithStats) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al listar departamentos.' });
    }
  });

  router.post('/', requireSuperAdmin, (req, res) => {
    const { name, budget, approverIds } = req.body || {};
    const n = typeof name === 'string' ? name.trim().slice(0, 128) : '';
    if (!n) return res.status(400).json({ error: 'Nombre requerido.' });
    const bn = budget != null ? Number(budget) : 0;
    const b = Number.isFinite(bn) ? Math.max(0, bn) : 0;
    let ids = normalizeApproverIdsInput(approverIds);
    if (ids.length === 0) {
      const primary = resolvePrimaryAdminUserId(db);
      if (!primary) {
        return res.status(400).json({ error: 'No hay administrador para asignar como aprobador.' });
      }
      ids = [primary];
    }
    const id = 'dept_' + crypto.randomBytes(6).toString('hex');
    const now = Date.now();
    db.prepare(
      'INSERT INTO departments (id, name, budget, archived, createdAt, approverIdsJson) VALUES (?, ?, ?, 0, ?, ?)',
    ).run(id, n, b, now, JSON.stringify(ids));
    syncDepartmentApproversSettings(db);
    const row = db.prepare('SELECT id, name, budget, archived, createdAt, approverIdsJson FROM departments WHERE id = ?').get(id);
    audit('department_created', { userId: req.userId, targetId: id, name: n });
    res.json({ ok: true, department: rowWithStats(row) });
  });

  router.put('/:id', requireSuperAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Departamento no encontrado.' });
    const { name, budget, archived, approverIds } = req.body || {};
    const nextName =
      name !== undefined ? String(name).trim().slice(0, 128) : row.name;
    if (!nextName) return res.status(400).json({ error: 'Nombre inválido.' });
    let nextBud = row.budget;
    if (budget !== undefined) {
      const bn = Number(budget);
      if (!Number.isFinite(bn)) {
        return res.status(400).json({ error: 'Presupuesto inválido.' });
      }
      nextBud = Math.max(0, bn);
    }
    let nextArchived = !!row.archived;
    if (archived !== undefined) nextArchived = !!archived;
    let nextApproverIdsJson = row.approverIdsJson;
    if (approverIds !== undefined) {
      const normalized = normalizeApproverIdsInput(approverIds);
      if (normalized.length === 0) {
        return res.status(400).json({
          error: 'Debe haber al menos un aprobador por departamento.',
        });
      }
      nextApproverIdsJson = JSON.stringify(normalized);
    }
    const updateInfo = db.prepare(
      'UPDATE departments SET name = ?, budget = ?, archived = ?, approverIdsJson = ? WHERE id = ?',
    ).run(nextName, nextBud, nextArchived ? 1 : 0, nextApproverIdsJson, row.id);
    if (warnIfNoChanges(updateInfo, 'department_update', { departmentId: row.id, userId: req.userId })) {
      return res.status(404).json({ error: 'Departamento no encontrado.' });
    }
    syncDepartmentApproversSettings(db);
    const updated = db.prepare('SELECT id, name, budget, archived, createdAt, approverIdsJson FROM departments WHERE id = ?').get(row.id);
    audit('department_updated', { userId: req.userId, targetId: row.id });
    res.json({ ok: true, department: rowWithStats(updated) });
  });

  router.delete('/:id', requireSuperAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Departamento no encontrado.' });
    if (!row.archived) {
      return res.status(400).json({
        error: 'Solo se pueden eliminar departamentos archivados.',
      });
    }
    db.prepare('UPDATE expenses SET departmentId = NULL WHERE departmentId = ?').run(row.id);
    db.prepare('UPDATE bills SET departmentId = NULL WHERE departmentId = ?').run(row.id);
    db.prepare('DELETE FROM departments WHERE id = ?').run(row.id);
    syncDepartmentApproversSettings(db);
    audit('department_deleted', { userId: req.userId, targetId: row.id });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createDepartmentsRouter };
