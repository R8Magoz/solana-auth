'use strict';

const express = require('express');
let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (e) {
  ExcelJS = null;
}
const db = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const EXPORT_HEADERS = [
  'Código',
  'Tipo',
  'Fecha',
  'Concepto',
  'Categoría',
  'Estado',
  'Enviado por',
  'Pagado por',
  'Notas',
  'Aprobadores',
  'Base imponible',
  'Tipo IVA',
  'Cuota IVA',
  'Total con IVA',
];

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

function buildUserMap(userStore) {
  const map = {};
  for (const u of userStore.getAllUsersPublic()) {
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

function getCompanyName() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'company_name'").get();
    if (row && row.value != null) {
      const parsed = JSON.parse(row.value);
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    }
  } catch (e) {
    /* ignore */
  }
  return 'Solana';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(raw || 'null');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parsePaidByJson(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function statusLabel(status) {
  const map = {
    submitted: 'Pendiente',
    approved: 'Aprobado',
    rejected: 'Rechazado',
    draft: 'Borrador',
    deleted: 'Eliminado',
  };
  return map[String(status || '').toLowerCase()] || String(status || '');
}

function excelDateFromIso(dateStr) {
  if (!dateStr || !DATE_RE.test(String(dateStr).slice(0, 10))) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function formatPaidBy(row, userMap) {
  const paidBy = parsePaidByJson(row.paidByJson);
  if (paidBy.length === 0) {
    const uid = row.ownerId || row.userId;
    if (!uid) return '';
    const amt = roundMoney(eurAmount(row));
    return `${userMap[uid] || uid}: ${amt.toFixed(2)}`;
  }
  return paidBy
    .map((p) => {
      const name = userMap[p.userId] || p.userId || '—';
      const amt = roundMoney(Number(p.amount) || 0);
      return `${name}: ${amt.toFixed(2)}`;
    })
    .join('; ');
}

function formatApprovers(row, userMap) {
  return parseJsonArray(row.approversJson)
    .map((id) => userMap[id] || id)
    .join('; ');
}

function safeFilenameTag(raw) {
  const tag = String(raw || 'export').trim().slice(0, 32);
  return tag.replace(/[^a-zA-Z0-9_-]/g, '') || 'export';
}

function fetchExportRows(req) {
  const idsRaw = String(req.query.ids ?? '').trim();
  if (idsRaw) {
    const idList = idsRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5000);
    if (idList.length === 0) return [];
    const placeholders = idList.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT * FROM expenses WHERE id IN (${placeholders}) AND status != 'deleted' ORDER BY date ASC, id ASC`,
      )
      .all(...idList);
  }
  const from = String(req.query.from ?? '').trim().slice(0, 10);
  const to = String(req.query.to ?? '').trim().slice(0, 10);
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to) {
    return db
      .prepare(
        `SELECT * FROM expenses WHERE date >= ? AND date <= ? AND status != 'deleted' ORDER BY date ASC, id ASC`,
      )
      .all(from, to);
  }
  return null;
}

function ivaBreakdownForRow(row) {
  const total = roundMoney(eurAmount(row));
  const rate = row.ivaRate != null && row.ivaRate !== '' ? Number(row.ivaRate) : null;
  const cuota =
    row.ivaAmount != null && row.ivaAmount !== '' && Number.isFinite(Number(row.ivaAmount))
      ? roundMoney(Number(row.ivaAmount))
      : 0;
  if (rate == null || !Number.isFinite(rate)) {
    return { base: total, tipo: '', cuota: 0, total };
  }
  const base = roundMoney(total - cuota);
  const tipo = rate === 0 ? '0%' : `${rate}%`;
  return { base, tipo, cuota, total };
}

async function writeExpensesWorkbook(res, rows, userMap, filename) {
  const wb = new ExcelJS.Workbook();
  wb.creator = getCompanyName();
  wb.created = new Date();
  const ws = wb.addWorksheet('Gastos');

  const headerRow = ws.addRow(EXPORT_HEADERS);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };

  const DATE_COL = 3;
  const BASE_COL = 11;
  const CUOTA_COL = 13;
  const TOTAL_COL = 14;

  let sumBase = 0;
  let sumCuota = 0;
  let sumTotal = 0;

  for (const e of rows) {
    const { base, tipo, cuota, total } = ivaBreakdownForRow(e);
    sumBase += base;
    sumCuota += cuota;
    sumTotal += total;
    const tipoLabel = e.expenseType === 'invoice' ? 'Factura' : 'Gasto';
    const row = ws.addRow([
      e.traceCode || e.itemCode || e.id,
      tipoLabel,
      excelDateFromIso(e.date),
      e.description || '',
      e.category || '',
      statusLabel(e.status),
      userMap[e.ownerId || e.userId] || e.userId || '',
      formatPaidBy(e, userMap),
      e.notes || '',
      formatApprovers(e, userMap),
      base,
      tipo,
      cuota,
      total,
    ]);
    const dateCell = row.getCell(DATE_COL);
    if (dateCell.value instanceof Date) {
      dateCell.numFmt = 'dd/mm/yyyy';
    }
    row.getCell(BASE_COL).numFmt = '#,##0.00 "€"';
    row.getCell(CUOTA_COL).numFmt = '#,##0.00 "€"';
    row.getCell(TOTAL_COL).numFmt = '#,##0.00 "€"';
  }

  if (rows.length > 0) {
    const totalsRow = ws.addRow([
      'TOTALES',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      roundMoney(sumBase),
      '',
      roundMoney(sumCuota),
      roundMoney(sumTotal),
    ]);
    totalsRow.font = { bold: true };
    totalsRow.getCell(BASE_COL).numFmt = '#,##0.00 "€"';
    totalsRow.getCell(CUOTA_COL).numFmt = '#,##0.00 "€"';
    totalsRow.getCell(TOTAL_COL).numFmt = '#,##0.00 "€"';
  }

  ws.columns.forEach((col, i) => {
    let max = String(EXPORT_HEADERS[i] || '').length;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value instanceof Date
        ? 10
        : String(cell.value ?? '').length;
      if (len > max) max = len;
    });
    col.width = Math.min(48, max + 2);
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

/**
 * Express router for admin reports (summary, Excel export, trends).
 * @param {{ requireAdminSession: import('express').RequestHandler, requireAuth: import('express').RequestHandler, userStore: { getAllUsersPublic: function(): Array<{ id: string, name?: string, email?: string }> } }} deps
 * @returns {import('express').Router}
 */
function createReportsRouter({ requireAdminSession, requireAuth, userStore }) {
  const router = express.Router();

  router.get('/summary/trend', requireAdminSession, (req, res) => {
    let months = parseInt(String(req.query.months ?? '12'), 10);
    if (!Number.isFinite(months)) months = 12;
    if (months < 1) months = 1;
    if (months > 24) months = 24;

    const now = new Date();
    const out = [];
    for (let i = months - 1; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const ym = `${y}-${pad2(m)}`;
      const from = `${ym}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const to = `${ym}-${pad2(lastDay)}`;

      const rows = db
        .prepare(
          `SELECT expenseType, amount, currency, amountEUR, status
           FROM expenses
           WHERE date >= ? AND date <= ? AND status != 'deleted'`,
        )
        .all(from, to);

      let expenses = 0;
      let bills = 0;
      let count = 0;
      for (const e of rows) {
        count += 1;
        const amt = eurAmount(e);
        if (e.expenseType === 'invoice') bills += amt;
        else expenses += amt;
      }
      out.push({
        month: ym,
        expenses: roundMoney(expenses),
        bills: roundMoney(bills),
        count,
      });
    }

    res.json(out);
  });

  router.get('/summary', requireAdminSession, (req, res) => {
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

    let totalExpenses = 0;
    let totalBills = 0;
    const byCategory = {};
    const byUser = {};
    const byMonth = {};
    const byDepartment = {};

    let approvedN = 0;
    let rejectedN = 0;

    for (const e of expenses) {
      const amt = eurAmount(e);
      const isInvoice = e.expenseType === 'invoice';
      if (isInvoice) {
        totalBills += amt;
      } else {
        totalExpenses += amt;
        const cat = e.category || '—';
        byCategory[cat] = (byCategory[cat] || 0) + amt;

        const uname = userMap[e.userId] || e.userId || '—';
        byUser[uname] = (byUser[uname] || 0) + amt;

        const monthKey = e.date && e.date.length >= 7 ? e.date.slice(0, 7) : '—';
        byMonth[monthKey] = (byMonth[monthKey] || 0) + amt;
      }

      if (
        e.status === 'approved' &&
        !isInvoice &&
        e.departmentId != null &&
        String(e.departmentId).trim() !== ''
      ) {
        const depId = String(e.departmentId);
        byDepartment[depId] = (byDepartment[depId] || 0) + amt;
      }

      if (e.status === 'approved') approvedN += 1;
      else if (e.status === 'rejected') rejectedN += 1;
    }

    for (const k of Object.keys(byCategory)) byCategory[k] = roundMoney(byCategory[k]);
    for (const k of Object.keys(byUser)) byUser[k] = roundMoney(byUser[k]);
    for (const k of Object.keys(byMonth)) byMonth[k] = roundMoney(byMonth[k]);
    for (const k of Object.keys(byDepartment)) byDepartment[k] = roundMoney(byDepartment[k]);

    const byDepartmentName = {};
    try {
      const deptRows = db.prepare('SELECT id, name FROM departments').all();
      const nameById = {};
      for (const r of deptRows) {
        const id = String(r.id);
        nameById[id] =
          r.name != null && String(r.name).trim() !== '' ? String(r.name).trim() : id;
      }
      for (const id of Object.keys(byDepartment)) {
        byDepartmentName[id] = nameById[id] != null ? nameById[id] : id;
      }
    } catch (e) {
      for (const id of Object.keys(byDepartment)) {
        byDepartmentName[id] = id;
      }
    }

    let fiscalYearStart = '01-01';
    try {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'fiscal_year_start'").get();
      if (row && row.value != null) {
        const parsed = JSON.parse(row.value);
        if (typeof parsed === 'string' && /^\d{2}-\d{2}$/.test(parsed)) {
          fiscalYearStart = parsed;
        }
      }
    } catch (e) {
      /* keep default */
    }

    const gastosOnly = expenses.filter((e) => e.expenseType !== 'invoice');
    const expenseCount = gastosOnly.length;
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
      byDepartment,
      byDepartmentName,
      fiscalYearStart,
      expenseCount,
      approvalRate,
      avgExpenseAmount,
    });
  });

  router.get('/export/xlsx', requireAuth, async (req, res) => {
    if (!ExcelJS) {
      return res.status(503).json({
        error: 'Excel no disponible. Ejecuta npm install en el servidor (paquete exceljs).',
      });
    }

    const rows = fetchExportRows(req);
    if (rows === null) {
      return res.status(400).json({
        error: 'Indica ids (lista separada por comas) o un rango from/to (YYYY-MM-DD).',
      });
    }

    const userMap = buildUserMap(userStore);
    const tag = safeFilenameTag(req.query.tag);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `solana-${tag}-${dateStr}.xlsx`;

    try {
      await writeExpensesWorkbook(res, rows, userMap, filename);
    } catch (err) {
      console.error('[reports/xlsx]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'No se pudo generar el Excel.' });
      }
    }
  });

  return router;
}

module.exports = { createReportsRouter };
