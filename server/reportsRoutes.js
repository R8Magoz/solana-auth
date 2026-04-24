'use strict';

const express = require('express');
let PDFDocument;
try {
  PDFDocument = require('pdfkit');
} catch (e) {
  PDFDocument = null;
}
let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (e) {
  ExcelJS = null;
}
const db = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function eurAmount(row) {
  if (row.amountEUR != null && !Number.isNaN(Number(row.amountEUR))) {
    return Number(row.amountEUR);
  }
  const cur = String(row.currency || 'EUR').toUpperCase();
  if (cur === 'EUR') return Number(row.amount) || 0;
  // TODO: implement live FX rates or require amountEUR always; the fallback below treats raw amount as EUR for non-EUR rows.
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

function csvFilename(type, from, to, ivaMode = 'both') {
  const base =
    type === 'expenses' ? 'solana-expenses' : type === 'bills' ? 'solana-bills' : 'solana-all';
  const q1 = quarterLabelFromDate(from);
  const q2 = quarterLabelFromDate(to);
  const im = String(ivaMode || 'both').trim() || 'both';
  if (q1 === q2) return `${base}-${q1}-${im}.csv`;
  return `${base}-${from}_to_${to}-${im}.csv`;
}

function parseIvaMode(raw) {
  const v = String(raw ?? 'both').trim().toLowerCase();
  if (v === 'with_iva' || v === 'without_iva' || v === 'both') return v;
  return 'both';
}

/** Base (imponible), IVA cuota, total EUR — aligned with client reporting. */
function ivaPartsForRow(row) {
  const total = eurAmount(row);
  const ivaAmt =
    row.ivaAmount != null && Number.isFinite(Number(row.ivaAmount)) ? Number(row.ivaAmount) : 0;
  const base =
    row.ivaRate != null && Number.isFinite(Number(row.ivaRate)) ? roundMoney(total - ivaAmt) : total;
  return { total, base, ivaAmt };
}

function expenseAmountColumnLabels(mode) {
  if (mode === 'with_iva') return ['Total con IVA'];
  if (mode === 'without_iva') return ['Base imponible'];
  return ['Base imponible', 'Cuota IVA', 'Total con IVA'];
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

/**
 * Express router for admin reports (summary, CSV/PDF export, trends).
 * @param {{ requireAdminSession: import('express').RequestHandler, userStore: { getAllUsersPublic: function(): Array<{ id: string, name?: string, email?: string }> } }} deps
 * @returns {import('express').Router}
 */
function createReportsRouter({ requireAdminSession, userStore }) {
  const router = express.Router();
  router.use(requireAdminSession);

  router.get('/summary/trend', (req, res) => {
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

    let totalExpenses = 0;
    let totalBills = 0;
    const byCategory = {};
    const byUser = {};
    const byMonth = {};
    /** Approved non-invoice expenses only: sum EUR per departmentId */
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

  router.get('/export/csv', (req, res) => {
    const range = validateRange(req, res);
    if (!range) return;

    const type = String(req.query.type || 'expenses').trim().toLowerCase().slice(0, 16);
    if (!['expenses', 'bills', 'all'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser expenses, bills o all.' });
    }

    const { from, to } = range;
    const userMap = buildUserMap(userStore);
    const ivaMode = parseIvaMode(req.query.iva_mode);
    const filename = csvFilename(type, from, to, ivaMode);

    const expenseRows = db
      .prepare(
        `SELECT * FROM expenses
         WHERE date >= ? AND date <= ?
         ORDER BY date ASC, id ASC`,
      )
      .all(from, to);

    const billRows = db
      .prepare(
        `SELECT * FROM expenses
         WHERE expenseType = 'invoice'
           AND date >= ? AND date <= ?
           AND status != 'deleted'
         ORDER BY date ASC, id ASC`,
      )
      .all(from, to);

    const expenseColsTail = [
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

    const billColsTail = [
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
      const hdr = ['id', 'userId', 'userName', ...expenseAmountColumnLabels(ivaMode), ...expenseColsTail];
      lines.push(line(hdr));
      for (const e of expenseRows) {
        const { total, base, ivaAmt } = ivaPartsForRow(e);
        let amountPart;
        if (ivaMode === 'with_iva') amountPart = [total];
        else if (ivaMode === 'without_iva') amountPart = [base];
        else amountPart = [base, ivaAmt, total];
        const row = {
          id: e.id,
          userId: e.userId,
          userName: userMap[e.userId] || '',
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
        lines.push(line([e.id, e.userId, row.userName, ...amountPart, ...expenseColsTail.map((c) => row[c])]));
      }
    }

    function pushBills() {
      const hdr = ['id', 'userId', 'userName', 'vendor', ...expenseAmountColumnLabels(ivaMode), ...billColsTail];
      lines.push(line(hdr));
      for (const b of billRows) {
        const { total, base, ivaAmt } = ivaPartsForRow(b);
        let amountPart;
        if (ivaMode === 'with_iva') amountPart = [total];
        else if (ivaMode === 'without_iva') amountPart = [base];
        else amountPart = [base, ivaAmt, total];
        const row = {
          category: b.category,
          dueDate: b.dueDate || b.date,
          status: b.paymentStatus || b.status,
          recurring: b.recurring ? 1 : 0,
          recurrenceRule: b.recurrenceRule,
          paidAt: b.paidAt,
          paidBy: b.paidConfirmedBy || '',
          notes: b.notes,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        };
        lines.push(
          line([
            b.id,
            b.userId,
            userMap[b.userId] || '',
            b.vendor || b.description || '',
            ...amountPart,
            ...billColsTail.map((c) => row[c]),
          ]),
        );
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

  router.get('/export/xlsx', requireAdminSession, async (req, res) => {
    if (!ExcelJS) {
      return res.status(503).json({
        error: 'Excel no disponible. Ejecuta npm install en el servidor (paquete exceljs).',
      });
    }
    const range = validateRange(req, res);
    if (!range) return;
    const { from, to } = range;
    const type = String(req.query.type || 'all').trim().toLowerCase().slice(0, 16);
    if (!['expenses', 'bills', 'all'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser expenses, bills o all.' });
    }

    // Reuse the same DB queries and user map as the CSV route
    const userMap = buildUserMap(userStore);

    // ── Expense rows ──
    const expRows = db
      .prepare(
        `SELECT * FROM expenses
         WHERE date >= ? AND date <= ? AND status != 'deleted'
           AND (expenseType IS NULL OR expenseType != 'invoice')
         ORDER BY date ASC`,
      )
      .all(from, to);

    // ── Invoice rows ──
    const invRows = db
      .prepare(
        `SELECT * FROM expenses
         WHERE date >= ? AND date <= ? AND status != 'deleted'
           AND expenseType = 'invoice'
         ORDER BY date ASC`,
      )
      .all(from, to);

    const wb = new ExcelJS.Workbook();
    wb.creator = getCompanyName();
    wb.created = new Date();

    const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3C0A37' } };
    const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const BORDER_THIN = { style: 'thin', color: { argb: 'FFE0D8D0' } };
    const cellBorder = {
      top: BORDER_THIN,
      left: BORDER_THIN,
      bottom: BORDER_THIN,
      right: BORDER_THIN,
    };

    function styleHeader(row) {
      row.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.border = cellBorder;
        cell.alignment = { vertical: 'middle' };
      });
      row.height = 18;
    }

    function addSheet(workbook, sheetName, headers, dataRows) {
      const ws = workbook.addWorksheet(sheetName);
      const headerRow = ws.addRow(headers);
      styleHeader(headerRow);
      for (const row of dataRows) {
        const r = ws.addRow(row);
        r.eachCell((cell) => {
          cell.border = cellBorder;
        });
      }
      // Auto column widths
      ws.columns.forEach((col, i) => {
        let max = String(headers[i] || '').length;
        col.eachCell({ includeEmpty: false }, (cell) => {
          const len = String(cell.value ?? '').length;
          if (len > max) max = len;
        });
        col.width = Math.min(45, max + 2);
      });
      // Freeze header row
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      return ws;
    }

    // ── Spanish column headers ──
    const EXP_HEADERS = [
      'Código',
      'Fecha',
      'Concepto',
      'Categoría',
      'Departamento',
      'Importe EUR',
      'Base imponible',
      '% IVA',
      'Cuota IVA',
      'Estado',
      'Remitente',
      'Notas',
    ];
    const INV_HEADERS = [
      'Código',
      'Fecha',
      'Concepto',
      'Proveedor',
      'Categoría',
      'Importe EUR',
      'Base imponible',
      '% IVA',
      'Cuota IVA',
      'Estado pago',
      'Vencimiento',
      'Remitente',
      'Notas',
    ];

    function mapExpRow(e) {
      const amt = eurAmount(e);
      const iva = e.ivaAmount != null ? roundMoney(e.ivaAmount) : '';
      const base = e.ivaRate != null ? roundMoney(amt - (e.ivaAmount || 0)) : amt;
      return [
        e.itemCode || e.id,
        e.date,
        e.description || '',
        e.category || '',
        e.departmentId || '',
        amt,
        base,
        e.ivaRate != null ? e.ivaRate : '',
        iva,
        e.status || '',
        userMap[e.userId] || e.userId || '',
        e.notes || '',
      ];
    }

    function mapInvRow(e) {
      const amt = eurAmount(e);
      const iva = e.ivaAmount != null ? roundMoney(e.ivaAmount) : '';
      const base = e.ivaRate != null ? roundMoney(amt - (e.ivaAmount || 0)) : amt;
      const payStatus =
        e.paymentStatus === 'paid'
          ? 'Pagada'
          : e.paymentStatus === 'unpaid'
            ? 'Pendiente'
            : e.paymentStatus || '';
      return [
        e.itemCode || e.id,
        e.date,
        e.description || '',
        e.vendor || e.proveedor || '',
        e.category || '',
        amt,
        base,
        e.ivaRate != null ? e.ivaRate : '',
        iva,
        payStatus,
        e.dueDate || '',
        userMap[e.userId] || e.userId || '',
        e.notes || '',
      ];
    }

    if (type === 'expenses' || type === 'all') {
      addSheet(wb, 'Gastos', EXP_HEADERS, expRows.map(mapExpRow));
    }
    if (type === 'bills' || type === 'all') {
      addSheet(wb, 'Facturas', INV_HEADERS, invRows.map(mapInvRow));
    }

    // Summary sheet
    const totalExp = expRows.reduce((s, e) => s + eurAmount(e), 0);
    const totalInv = invRows.reduce((s, e) => s + eurAmount(e), 0);
    const summaryWs = wb.addWorksheet('Resumen');
    const sumHeader = summaryWs.addRow(['Concepto', 'Importe EUR']);
    styleHeader(sumHeader);
    summaryWs.addRow(['Total gastos', roundMoney(totalExp)]);
    summaryWs.addRow(['Total facturas', roundMoney(totalInv)]);
    summaryWs.addRow(['TOTAL', roundMoney(totalExp + totalInv)]);
    summaryWs.getColumn(1).width = 22;
    summaryWs.getColumn(2).width = 16;
    summaryWs.views = [{ state: 'frozen', ySplit: 1 }];

    const filename = `informe-${from}_${to}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  });

  router.get('/export/pdf', (req, res) => {
    if (!PDFDocument) {
      return res.status(503).json({
        error: 'PDF no disponible. Ejecuta npm install en el servidor (paquete pdfkit).',
      });
    }
    const range = validateRange(req, res);
    if (!range) return;

    const type = String(req.query.type || 'expenses').trim().toLowerCase().slice(0, 16);
    if (!['expenses', 'bills', 'all'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser expenses, bills o all.' });
    }

    const { from, to } = range;
    const userMap = buildUserMap(userStore);

    const allRows = db
      .prepare(
        `SELECT * FROM expenses
         WHERE date >= ? AND date <= ? AND status != 'deleted'
         ORDER BY date ASC, id ASC`,
      )
      .all(from, to);

    function rowMatchesType(e) {
      const inv = e.expenseType === 'invoice';
      if (type === 'expenses') return !inv;
      if (type === 'bills') return inv;
      return true;
    }

    const rows = allRows.filter(rowMatchesType);

    let totalExpenses = 0;
    let totalBills = 0;
    const byCat = {};
    const byUserId = {};
    let approvedN = 0;
    let rejectedN = 0;

    for (const e of rows) {
      const amt = eurAmount(e);
      const inv = e.expenseType === 'invoice';
      if (inv) totalBills += amt;
      else totalExpenses += amt;

      const cat = e.category || '—';
      if (!byCat[cat]) byCat[cat] = { count: 0, sum: 0 };
      byCat[cat].count += 1;
      byCat[cat].sum += amt;

      const uid = e.userId || '—';
      if (!byUserId[uid]) byUserId[uid] = { count: 0, sum: 0 };
      byUserId[uid].count += 1;
      byUserId[uid].sum += amt;

      if (e.status === 'approved') approvedN += 1;
      else if (e.status === 'rejected') rejectedN += 1;
    }

    const totalEur = totalExpenses + totalBills;
    const count = rows.length;
    const avgAmount = count > 0 ? roundMoney(totalEur / count) : 0;
    const decided = approvedN + rejectedN;
    const approvalRate = decided > 0 ? Math.round((approvedN / decided) * 10000) / 10000 : null;

    const byDepartmentSpent = {};
    for (const e of allRows) {
      if (
        e.status === 'approved' &&
        e.expenseType !== 'invoice' &&
        e.departmentId != null &&
        String(e.departmentId).trim() !== ''
      ) {
        const depId = String(e.departmentId);
        byDepartmentSpent[depId] = (byDepartmentSpent[depId] || 0) + eurAmount(e);
      }
    }
    for (const k of Object.keys(byDepartmentSpent)) {
      byDepartmentSpent[k] = roundMoney(byDepartmentSpent[k]);
    }

    let deptMeta = [];
    try {
      deptMeta = db.prepare('SELECT id, name, budget FROM departments ORDER BY name COLLATE NOCASE').all();
    } catch (e) {
      deptMeta = [];
    }

    const catEntries = Object.entries(byCat)
      .map(([name, v]) => ({
        name,
        count: v.count,
        sum: roundMoney(v.sum),
      }))
      .filter((x) => x.sum > 0 || x.count > 0)
      .sort((a, b) => b.sum - a.sum);
    const catDenom = catEntries.reduce((s, x) => s + x.sum, 0) || 1;

    const userEntries = Object.entries(byUserId)
      .map(([uid, v]) => ({
        name: userMap[uid] || uid,
        count: v.count,
        sum: roundMoney(v.sum),
      }))
      .sort((a, b) => b.sum - a.sum);

    const company = getCompanyName();
    const generated = new Date().toISOString();

    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="report-${from}-to-${to}.pdf"`,
    );
    doc.pipe(res);
    doc.on('error', (err) => {
      try {
        console.error('[reports/pdf]', err);
      } catch (e) {
        /* ignore */
      }
      if (!res.headersSent) {
        res.status(500).json({ error: 'No se pudo generar el PDF.' });
      } else {
        res.end();
      }
    });

    function footer() {
      doc
        .fontSize(8)
        .fillColor('#666666')
        .text('Confidencial — solo para uso interno', 48, doc.page.height - 56, {
          align: 'center',
          width: doc.page.width - 96,
        });
    }

    doc.fontSize(18).fillColor('#1a1a1a').text(company, { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#333333').text(`Período: ${from} — ${to}`, { align: 'center' });
    doc.fontSize(9).fillColor('#666666').text(`Generado: ${generated}`, { align: 'center' });
    doc.moveDown(1.2);

    doc.fontSize(12).fillColor('#1a1a1a').text('Resumen', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#000000');
    doc.text(`Total gastos (EUR): ${roundMoney(totalExpenses).toFixed(2)}`);
    doc.text(`Total facturas (EUR): ${roundMoney(totalBills).toFixed(2)}`);
    doc.text(`Líneas: ${count}`);
    doc.text(`Importe medio (EUR): ${avgAmount.toFixed(2)}`);
    doc.text(
      `Tasa de aprobación: ${approvalRate != null ? `${(approvalRate * 100).toFixed(2)}%` : '—'}`,
    );
    doc.moveDown(0.8);

    function tableHeader(labels, colWidths, yStart) {
      let x = 48;
      let y = yStart;
      doc.fontSize(8).fillColor('#333333').font('Helvetica-Bold');
      labels.forEach((lab, i) => {
        doc.text(lab, x, y, { width: colWidths[i] });
        x += colWidths[i];
      });
      doc.font('Helvetica');
      return y + 14;
    }

    function tableRow(cells, colWidths, y) {
      let x = 48;
      doc.fontSize(8).fillColor('#000000');
      cells.forEach((cell, i) => {
        doc.text(String(cell), x, y, { width: colWidths[i], ellipsis: true });
        x += colWidths[i];
      });
      return y + 13;
    }

    function pageBottom() {
      return doc.page.height - 64;
    }

    doc.fontSize(12).fillColor('#1a1a1a').text('Desglose por categoría', { underline: true });
    doc.moveDown(0.4);
    let y = doc.y;
    const cwCat = [150, 52, 72, 52];
    y = tableHeader(['Categoría', 'Unidades', 'Total EUR', '% del total'], cwCat, y);
    for (const c of catEntries) {
      if (y + 16 > pageBottom()) {
        footer();
        doc.addPage();
        y = 48;
        y = tableHeader(['Categoría', 'Unidades', 'Total EUR', '% del total'], cwCat, y);
      }
      const pct = ((c.sum / catDenom) * 100).toFixed(1);
      y = tableRow([c.name, c.count, c.sum.toFixed(2), `${pct}%`], cwCat, y);
    }
    doc.y = y + 6;

    doc.fontSize(12).fillColor('#1a1a1a').text('Desglose por departamento', { underline: true });
    doc.moveDown(0.4);
    y = doc.y;
    const cwDep = [120, 64, 64, 56, 72];
    y = tableHeader(['Departamento', 'Presupuesto EUR', 'Gastado EUR', '% usado', 'Restante EUR'], cwDep, y);
    for (const d of deptMeta) {
      const id = String(d.id);
      const budget = Number(d.budget) || 0;
      const spent = byDepartmentSpent[id] || 0;
      const pctUsed = budget > 0 ? ((spent / budget) * 100).toFixed(1) : spent > 0 ? '100.0' : '0.0';
      const rem = roundMoney(budget - spent);
      const name = d.name != null && String(d.name).trim() !== '' ? String(d.name).trim() : id;
      if (y + 16 > pageBottom()) {
        footer();
        doc.addPage();
        y = 48;
        y = tableHeader(['Departamento', 'Presupuesto EUR', 'Gastado EUR', '% usado', 'Restante EUR'], cwDep, y);
      }
      y = tableRow(
        [name, budget.toFixed(2), spent.toFixed(2), `${pctUsed}%`, rem.toFixed(2)],
        cwDep,
        y,
      );
    }
    doc.y = y + 6;

    doc.fontSize(12).fillColor('#1a1a1a').text('Desglose por usuario', { underline: true });
    doc.moveDown(0.4);
    y = doc.y;
    const cwUsr = [200, 48, 88];
    y = tableHeader(['Usuario', 'Unidades', 'Total EUR'], cwUsr, y);
    for (const u of userEntries) {
      if (y + 16 > pageBottom()) {
        footer();
        doc.addPage();
        y = 48;
        y = tableHeader(['Usuario', 'Unidades', 'Total EUR'], cwUsr, y);
      }
      y = tableRow([u.name, u.count, u.sum.toFixed(2)], cwUsr, y);
    }
    doc.y = y + 8;

    footer();
    doc.end();
  });

  return router;
}

module.exports = { createReportsRouter };
