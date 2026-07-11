import { expect, test, type Page } from '@playwright/test';

type User = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  accountStatus: 'active' | 'denied' | 'pending_admin_approval';
  approvalStatus: 'approved' | 'denied' | 'pending';
  color: string;
};

type ExpenseRow = Record<string, any>;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch (_) {}
    try {
      sessionStorage.clear();
    } catch (_) {}
  });
});

const PASSWORDS: Record<string, string> = {
  'admin@solana.test': 'r8magoz',
  'user@solana.test': 'test',
};

function makeUsers(): User[] {
  return [
    {
      id: 'admin-1',
      email: 'admin@solana.test',
      name: 'Admin QA',
      role: 'admin',
      accountStatus: 'active',
      approvalStatus: 'approved',
      color: '#3C0A37',
    },
    {
      id: 'user-1',
      email: 'user@solana.test',
      name: 'User QA',
      role: 'user',
      accountStatus: 'active',
      approvalStatus: 'approved',
      color: '#6B7280',
    },
  ];
}

function safeJson(body: string | null): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function parseApprovers(row: ExpenseRow): string[] {
  try {
    const aj = JSON.parse(row.approversJson || 'null');
    return Array.isArray(aj) ? aj.map(String) : [];
  } catch {
    return [];
  }
}

function parseVotes(row: ExpenseRow): Record<string, string> {
  try {
    const vj = JSON.parse(row.approvalVotesJson || 'null');
    return vj && typeof vj === 'object' && !Array.isArray(vj) ? vj : {};
  } catch {
    return {};
  }
}

function canSessionActOnApproval(row: ExpenseRow, session: { userId: string; role: string } | null): boolean {
  if (!session) return false;
  return parseApprovers(row).includes(session.userId);
}

function parseAudit(row: ExpenseRow): any[] {
  try {
    const a = JSON.parse(row.auditTrailJson || 'null');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function writeAudit(row: ExpenseRow, entries: any[]) {
  row.auditTrailJson = JSON.stringify(entries);
}

function pushAudit(row: ExpenseRow, entry: { action: string; by?: string; at?: string; note?: string; meta?: Record<string, unknown> }) {
  const prev = parseAudit(row);
  prev.push({
    ...entry,
    at: entry.at || new Date().toISOString(),
  });
  writeAudit(row, prev);
}

function parsePaidBy(row: ExpenseRow): any[] {
  try {
    const pj = JSON.parse(row.paidByJson || 'null');
    return Array.isArray(pj) ? pj : [];
  } catch {
    return [];
  }
}

function recalculatePaidByForNewTotal(
  paidByJson: string | null | undefined,
  splitMode: string | null | undefined,
  newTotal: number,
  submitterId: string,
): { paidBy: any[]; splitMode: string | null } {
  const total = Number(newTotal);
  if (!Number.isFinite(total) || total <= 0) {
    return { paidBy: [{ userId: submitterId, amount: total, pct: 100 }], splitMode: null };
  }
  let rows: any[];
  try {
    rows = JSON.parse(paidByJson || '[]');
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { paidBy: [{ userId: submitterId, amount: Math.round(total * 100) / 100, pct: 100 }], splitMode: null };
  }
  if (rows.length === 1) {
    return {
      paidBy: [{ userId: String(rows[0].userId), amount: Math.round(total * 100) / 100, pct: 100 }],
      splitMode: null,
    };
  }
  const mode = splitMode === 'percentage' || splitMode === 'amount' || splitMode === 'equal' ? splitMode : 'equal';
  const resolved = rows.map((r) => ({
    userId: String(r.userId),
    amount: Number(r.amount) || 0,
    pct: typeof r.pct === 'number' && Number.isFinite(r.pct) ? r.pct : null,
  }));
  const out: any[] = [];
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

function finalizeFromApprovalVotes(
  e: ExpenseRow,
  approverIds: string[],
  votes: Record<string, string>,
  actorUserId: string,
  rejectionNote?: string | null,
) {
  const hasReject = Object.values(votes).some((v) => v === 'rejected');
  const allDone = !hasReject && approverIds.length > 0 && approverIds.every((aid) => votes[aid] === 'approved');
  e.approvalVotesJson = JSON.stringify(votes);
  if (hasReject) {
    e.status = 'rejected';
    e.rejectionNote = rejectionNote || e.rejectionNote || 'Rechazado por voto de aprobador.';
    return;
  }
  if (allDone) {
    e.status = 'approved';
    e.rejectionNote = null;
    return;
  }
  e.status = 'submitted';
  e.rejectionNote = null;
}

const EXPENSE_EDIT_TRACKED = [
  'amount', 'description', 'category', 'date', 'notes', 'departmentId',
  'ivaRate', 'ivaAmount', 'vendor', 'dueDate', 'expenseType',
];

function buildExpenseFieldDiff(prev: ExpenseRow, next: ExpenseRow): { field: string; from: unknown; to: unknown }[] {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const field of EXPENSE_EDIT_TRACKED) {
    const from = prev[field] ?? null;
    const to = next[field] ?? null;
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

function parseComments(row: ExpenseRow): any[] {
  try {
    const cj = JSON.parse(row.commentsJson || 'null');
    return Array.isArray(cj) ? cj : [];
  } catch {
    return [];
  }
}

const MOCK_AUTH_BASE = 'https://solana-auth.onrender.com';

export type DeptRow = {
  id: string;
  name: string;
  budget: number;
  archived: boolean;
  createdAt: number;
};

export type MockApiState = {
  users: User[];
  expenses: ExpenseRow[];
  departments: DeptRow[];
  tokens: Map<string, { userId: string; role: string }>;
  passwords: Map<string, string>;
  settings: { categories: any[] | null; department_approvers: Record<string, string[]> };
};

const _attached = new WeakMap<Page, boolean>();

export function createMockApiState(
  seed?: { expenses?: ExpenseRow[]; users?: User[]; settingsCategories?: any[]; departmentApprovers?: Record<string, string[]> },
): MockApiState {
  return {
    users: seed?.users ?? makeUsers(),
    expenses: seed?.expenses ?? [],
    departments: [
      { id: 'dept_ops', name: 'Operaciones', budget: 3000, archived: false, createdAt: Date.now() },
      { id: 'dept_fin', name: 'Finanzas', budget: 5000, archived: false, createdAt: Date.now() },
      { id: 'dept_estrategia', name: 'Estrategia', budget: 4000, archived: false, createdAt: Date.now() },
    ],
    tokens: new Map<string, { userId: string; role: string }>(),
    passwords: new Map<string, string>(Object.entries(PASSWORDS)),
    settings: {
      categories: seed?.settingsCategories ?? (null as any[] | null),
      department_approvers: seed?.departmentApprovers ?? {},
    },
  };
}

export async function attachMockApiRoutes(page: Page, state: MockApiState): Promise<void> {
  if (_attached.get(page)) return;
  _attached.set(page, true);

  const ctx = page.context();
  await ctx.unroute(`${MOCK_AUTH_BASE}/**`).catch(() => undefined);

  await ctx.route(`${MOCK_AUTH_BASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let path = url.pathname;
    const method = req.method();
    const auth = (await req.headerValue('authorization')) ?? '';
    const authStr = String(auth).trim();
    const token = authStr.startsWith('Bearer ') ? authStr.slice(7).trim() : '';
    const session = token ? state.tokens.get(token) : null;

    const json = (status: number, data: any) =>
      route.fulfill({
        status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });

    const adminIds = () => state.users.filter((u) => u.role === 'admin').map((u) => u.id);

    const defaultApproversFromBody = (body: any): string[] => {
      const req = Array.isArray(body.approvalRequired) ? body.approvalRequired.filter(Boolean).map(String) : [];
      if (req.length) return req;
      const deptId = String(body.departmentId || '').trim();
      const map = state.settings.department_approvers || {};
      const fromDept = deptId && Array.isArray(map[deptId]) ? map[deptId].filter(Boolean).map(String) : [];
      if (fromDept.length) return fromDept;
      const s = adminIds();
      return s.length ? s : [state.users[0]?.id].filter(Boolean) as string[];
    };

    if (method === 'OPTIONS') return json(204, {});
    if (path === '/health' && method === 'GET') return json(200, { ok: true });

    if (path === '/auth/login' && method === 'POST') {
      let body: any = {};
      try { body = req.postDataJSON() ?? {}; } catch { body = safeJson(req.postData()); }
      const email = String(body.email || '').toLowerCase().trim();
      const user = state.users.find((u) => u.email === email);
      if (!user || user.accountStatus !== 'active') return json(401, { error: 'Correo o contraseña incorrectos.' });
      const newToken = `tok-${user.id}-${Date.now()}`;
      state.tokens.set(newToken, { userId: user.id, role: user.role });
      return json(200, { ok: true, sessionToken: newToken, user });
    }

    if (path === '/auth/refresh' && method === 'POST') {
      if (!session) return json(401, { error: 'Sesión expirada.' });
      const fresh = `tok-${session.userId}-${Date.now()}`;
      state.tokens.set(fresh, session);
      return json(200, { ok: true, sessionToken: fresh, userId: session.userId, role: session.role });
    }

    if (path === '/auth/change-password' && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const body = safeJson(req.postData());
      const uid = String(body.userId || '');
      if (uid !== session.userId) return json(403, { error: 'No autorizado.' });
      const email = state.users.find((u) => u.id === uid)?.email?.toLowerCase();
      const cur = String(body.currentPassword || '');
      const nw = String(body.newPassword || '');
      if (!email) return json(400, { error: 'Usuario no encontrado.' });
      const stored = state.passwords.get(email) ?? '';
      if (cur !== stored) return json(400, { error: 'Contraseña actual incorrecta.' });
      if (nw.length < 8) return json(400, { error: 'La contraseña es demasiado corta.' });
      state.passwords.set(email, nw);
      return json(200, { ok: true });
    }

    if (path === '/auth/password' && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { ok: true });
    }
    if (/^\/users\/[^/]+\/password$/.test(path) && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { ok: true });
    }

    if (path === '/auth/team' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { ok: true, users: state.users.filter((u) => u.accountStatus === 'active') });
    }

    if (path === '/settings' && method === 'GET') {
      const payload: Record<string, unknown> = {};
      if (state.settings.categories && Array.isArray(state.settings.categories)) {
        payload.categories = state.settings.categories;
      }
      payload.department_approvers = state.settings.department_approvers || {};
      return json(200, { ok: true, settings: payload });
    }

    if (path === '/settings/department_approvers' && method === 'PUT') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const body = safeJson(req.postData());
      if (body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        state.settings.department_approvers = body.value as Record<string, string[]>;
      }
      return json(200, { ok: true });
    }

    if (path === '/settings/categories' && method === 'PUT') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const body = safeJson(req.postData());
      if (Array.isArray(body.value)) {
        state.settings.categories = body.value;
      }
      return json(200, { ok: true });
    }

    if (path === '/departments' && method === 'GET') {
      return json(200, { ok: true, departments: state.departments });
    }

    if (path === '/reports/summary' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const r = session.role;
      if (r !== 'admin') return json(403, { error: 'No autorizado.' });
      const totalExpenses = state.expenses.reduce((s, ex) => s + (Number(ex.amountEUR) || 0), 0);
      return json(200, { ok: true, totalExpenses, byCategory: {}, byDepartment: {} });
    }

    if (path === '/reports/summary/trend' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const r = session.role;
      if (r !== 'admin') return json(403, { error: 'No autorizado.' });
      return json(200, []);
    }

    if (path === '/reports/export/xlsx' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const idsParam = url.searchParams.get('ids') || '';
      const idList = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
      const rows = idList.length
        ? state.expenses.filter((ex) => idList.includes(ex.id))
        : state.expenses;
      const tag = (url.searchParams.get('tag') || 'export').replace(/[^a-zA-Z0-9_-]/g, '') || 'export';
      const filename = `solana-${tag}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Gastos');
        const headers = [
          'Código', 'Tipo', 'Fecha', 'Concepto', 'Categoría', 'Estado',
          'Enviado por', 'Pagado por', 'Notas', 'Aprobadores', 'Total con IVA',
        ];
        const headerRow = ws.addRow(headers);
        headerRow.font = { bold: true };
        for (const ex of rows) {
          ws.addRow([
            ex.id,
            ex.expenseType === 'invoice' ? 'Factura' : 'Gasto',
            ex.date,
            ex.description || '',
            ex.category || '',
            ex.status || '',
            ex.userId || '',
            '',
            ex.notes || '',
            '',
            Number(ex.amountEUR || ex.amount || 0),
          ]);
        }
        const buffer = await wb.xlsx.writeBuffer();
        return route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'content-disposition': `attachment; filename="${filename}"`,
          },
          body: Buffer.from(buffer),
        });
      } catch (e) {
        return json(503, { error: 'Excel no disponible en pruebas.' });
      }
    }

    const expenseByIdMatch = path.match(/^\/expenses\/([^/]+)$/);
    if (expenseByIdMatch && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const expId = expenseByIdMatch[1];
      const exp = state.expenses.find((x) => x.id === expId);
      if (!exp) return json(404, { error: 'Gasto no encontrado.' });
      return json(200, { expense: exp });
    }

    if ((path === '/expenses' || path === '/expenses/') && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { expenses: state.expenses });
    }

    if (path === '/expenses' && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const body = safeJson(req.postData());
      const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const approvers = defaultApproversFromBody(body);
      const isInvoice = String(body.expenseType || '').toLowerCase() === 'invoice';
      const due = (body.dueDate || body.fechaVencimiento || body.date || new Date().toISOString().slice(0, 10))
        .toString()
        .slice(0, 10);
      const now = Date.now();
      const submitAudit = {
        action: 'submitted',
        by: session.userId,
        at: new Date(now).toISOString(),
      };
      const row: ExpenseRow = isInvoice
        ? {
            id,
            expenseType: 'invoice',
            userId: session.userId,
            date: (body.date || due).toString().slice(0, 10),
            description: body.description || body.vendor || 'Factura',
            vendor: body.vendor || body.description || 'Factura',
            proveedor: body.proveedor || body.vendor || '',
            amount: Number(body.amount || 0),
            currency: 'EUR',
            amountEUR: Number(body.amount || 0),
            category: body.category || 'Software',
            notes: body.notes || '',
            dueDate: due,
            paymentStatus: 'na',
            paymentTermDays: 0,
            deferredPayment: false,
            recurring: body.recurring ? 1 : 0,
            recurrenceRule: body.recurrenceRule || null,
            status: 'submitted',
            approversJson: JSON.stringify(approvers),
            approvalVotesJson: '{}',
            ownerId: body.ownerId || session.userId,
            paidByJson: JSON.stringify(
              body.paidBy || [{ userId: body.ownerId || session.userId, amount: Number(body.amount || 0), pct: 100 }],
            ),
            splitMode: body.splitMode || null,
            departmentId: body.departmentId || 'dept_ops',
            receiptPath: null,
            createdAt: now,
            updatedAt: now,
            rejectionNote: null,
            auditTrailJson: JSON.stringify([submitAudit]),
            commentsJson: '[]',
          }
        : {
            id,
            userId: session.userId,
            date: body.date || new Date().toISOString().slice(0, 10),
            description: body.description || 'Gasto',
            amount: Number(body.amount || 0),
            currency: 'EUR',
            amountEUR: Number(body.amount || 0),
            category: body.category || 'Equipment',
            notes: body.notes || '',
            status: 'submitted',
            approversJson: JSON.stringify(approvers),
            approvalVotesJson: '{}',
            ownerId: body.ownerId || session.userId,
            paidByJson: JSON.stringify(
              body.paidBy || [{ userId: body.ownerId || session.userId, amount: Number(body.amount || 0), pct: 100 }],
            ),
            splitMode: body.splitMode || null,
            departmentId: body.departmentId || 'dept_ops',
            receiptPath: null,
            createdAt: now,
            updatedAt: now,
            rejectionNote: null,
            expenseType: 'expense',
            paymentStatus: 'na',
            deferredPayment: false,
            paymentTermDays: 0,
            auditTrailJson: JSON.stringify([submitAudit]),
            commentsJson: '[]',
          };
      (row as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = [submitAudit];
      state.expenses.unshift(row);
      return json(200, { ok: true, expense: row });
    }

    const expenseIdMatch = path.match(/^\/expenses\/([^/]+)\/(receipt|approve|reject|reconsider|comments|comment)$/);
    const expensePutMatch = path.match(/^\/expenses\/([^/]+)$/);

    if (expenseIdMatch && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = expenseIdMatch[1];
      const sub = expenseIdMatch[2];
      const e = state.expenses.find((x) => x.id === id);
      if (!e) return json(404, { error: 'Gasto no encontrado.' });
      if (sub === 'receipt') {
        const body = safeJson(req.postData());
        const isPdf = String(body.mediaType || '').includes('pdf');
        e.receiptPath = `https://mock-cloudinary.test/${id}${isPdf ? '.pdf' : '.jpg'}`;
        e.updatedAt = Date.now();
        return json(200, { ok: true, receiptPath: e.receiptPath });
      }
      if (sub === 'approve') {
        if (!canSessionActOnApproval(e, session)) {
          return json(403, { error: 'No eres aprobador designado para este gasto.' });
        }
        if (e.status === 'approved') {
          e.updatedAt = Date.now();
          return json(200, { ok: true, expense: e });
        }
        if (e.status !== 'submitted') {
          return json(400, { error: 'El gasto no está pendiente de aprobación.' });
        }
        const votes = parseVotes(e);
        const oldVote = votes[session.userId] || null;
        votes[session.userId] = 'approved';
        if (oldVote !== 'approved') {
          pushAudit(e, {
            action: 'expense_vote_changed',
            by: session.userId,
            meta: { from: oldVote, to: 'approved' },
          });
        }
        const approverIds = parseApprovers(e);
        finalizeFromApprovalVotes(e, approverIds, votes, session.userId, null);
        const notePayload = safeJson(req.postData()).note;
        if (e.status === 'approved') {
          pushAudit(e, {
            action: 'approved',
            by: session.userId,
            ...(notePayload != null ? { note: notePayload } : {}),
          });
        } else if (e.status === 'rejected') {
          pushAudit(e, { action: 'rejected', by: session.userId, via: 'approval_vote' });
        }
        e.updatedAt = Date.now();
        (e as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = parseAudit(e);
        return json(200, { ok: true, expense: e });
      }
      if (sub === 'reject') {
        if (!canSessionActOnApproval(e, session)) {
          return json(403, { error: 'No eres aprobador designado para este gasto.' });
        }
        if (e.status === 'rejected') {
          e.updatedAt = Date.now();
          return json(200, { ok: true, expense: e });
        }
        if (e.status !== 'submitted') {
          return json(400, { error: 'El gasto no está pendiente de aprobación.' });
        }
        const body = safeJson(req.postData());
        const note = String(body.note || body.rejectionNote || '');
        const votes = parseVotes(e);
        const oldVote = votes[session.userId] || null;
        votes[session.userId] = 'rejected';
        if (oldVote !== 'rejected') {
          pushAudit(e, {
            action: 'expense_vote_changed',
            by: session.userId,
            meta: { from: oldVote, to: 'rejected' },
          });
        }
        const approverIds = parseApprovers(e);
        finalizeFromApprovalVotes(e, approverIds, votes, session.userId, note);
        if (e.status === 'rejected') {
          pushAudit(e, { action: 'rejected', by: session.userId, note });
        } else if (e.status === 'approved') {
          pushAudit(e, { action: 'approved', by: session.userId });
        }
        e.updatedAt = Date.now();
        (e as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = parseAudit(e);
        return json(200, { ok: true, expense: e });
      }
      if (sub === 'reconsider') {
        const canReconsider = session.role === 'admin' || canSessionActOnApproval(e, session);
        if (!canReconsider) {
          return json(403, { error: 'No autorizado.' });
        }
        if (e.status !== 'approved' && e.status !== 'rejected') {
          return json(400, { error: 'Gasto no válido.' });
        }
        const previousStatus = e.status;
        const approverIds = parseApprovers(e);
        const votes: Record<string, string> = {};
        if (approverIds.includes(e.userId)) {
          votes[e.userId] = 'approved';
        }
        finalizeFromApprovalVotes(e, approverIds, votes, session.userId, null);
        pushAudit(e, {
          action: 'expense_reconsider_requested',
          by: session.userId,
          meta: { previousStatus },
        });
        e.updatedAt = Date.now();
        (e as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = parseAudit(e);
        return json(200, { ok: true, expense: e });
      }
      if (sub === 'comments' || sub === 'comment') {
        const body = safeJson(req.postData());
        const text = String(body.text || '').trim();
        const list = parseComments(e);
        const cid = `c_${Date.now()}`;
        list.push({
          id: cid,
          userId: session.userId,
          text,
          createdAt: new Date().toISOString(),
        });
        e.commentsJson = JSON.stringify(list);
        const auditArrComment = parseAudit(e);
        auditArrComment.push({
          action: 'comment_added',
          by: session.userId,
          at: new Date().toISOString(),
          meta: { text },
        });
        writeAudit(e, auditArrComment);
        (e as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = auditArrComment;
        e.updatedAt = Date.now();
        if (sub === 'comment') {
          return json(200, { ok: true });
        }
        return json(200, { ok: true, expense: e });
      }
    }

    if (expensePutMatch && method === 'PUT') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = expensePutMatch[1];
      const e = state.expenses.find((x) => x.id === id);
      if (!e) return json(404, { error: 'Gasto no encontrado.' });
      if (e.status === 'approved' && session.role === 'user') {
        return json(403, { error: 'No autorizado.' });
      }
      const body = safeJson(req.postData());
      const prevSnapshot = { ...e };
      if (typeof body.description === 'string') e.description = body.description;
      if (typeof body.amount === 'number') {
        e.amount = body.amount;
        e.amountEUR = body.amount;
      }
      if (typeof body.amountEUR === 'number') e.amountEUR = body.amountEUR;
      if (typeof body.category === 'string') e.category = body.category;
      if (typeof body.date === 'string') e.date = body.date.slice(0, 10);
      if (typeof body.notes === 'string') e.notes = body.notes;
      if (body.departmentId) e.departmentId = body.departmentId;
      if (typeof body.vendor === 'string') e.vendor = body.vendor;
      if (typeof body.ownerId === 'string') e.ownerId = body.ownerId;
      if (body.paidBy) {
        e.paidByJson = JSON.stringify(body.paidBy);
        if (body.splitMode) e.splitMode = body.splitMode;
      } else if (typeof body.amount === 'number' && Number(body.amount) !== Number(prevSnapshot.amount)) {
        const recalc = recalculatePaidByForNewTotal(
          e.paidByJson,
          e.splitMode,
          Number(body.amount),
          String(e.ownerId || e.userId || session.userId),
        );
        e.paidByJson = JSON.stringify(recalc.paidBy);
        e.splitMode = recalc.splitMode;
      }
      if (body.expenseType) e.expenseType = body.expenseType;
      if (body.dueDate !== undefined) e.dueDate = body.dueDate;
      if (Array.isArray(body.approvalRequired)) {
        e.approversJson = JSON.stringify(body.approvalRequired.filter(Boolean));
        e.approvalVotesJson = '{}';
      }
      const fieldChanges = buildExpenseFieldDiff(prevSnapshot, e);
      const materialEdit = fieldChanges.length > 0
        && ['submitted', 'approved', 'rejected'].includes(String(prevSnapshot.status));
      if (materialEdit) {
        e.approvalVotesJson = '{}';
        e.status = 'submitted';
        e.rejectionNote = null;
      }
      if (body.status !== undefined && body.status !== null) {
        e.status = body.status;
      }
      if (body.status === 'submitted') {
        e.rejectionNote = null;
        pushAudit(e, { action: 'resubmitted', by: session.userId });
      }
      const editedAt = new Date().toISOString();
      const auditArrEdit = parseAudit(e);
      auditArrEdit.push({ action: 'edited', by: session.userId, at: editedAt });
      writeAudit(e, auditArrEdit);
      (e as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = auditArrEdit;
      e.updatedAt = Date.now();
      return json(200, { ok: true, expense: e, reapprovalRequired: materialEdit });
    }

    // GET /expenses — return seeded list
    if (path === '/expenses' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { ok: true, expenses: state.expenses });
    }

    // GET /departments
    if (path === '/departments' && method === 'GET') {
      return json(200, { ok: true, departments: state.departments });
    }

    // GET /auth/team (users list loaded on app init)
    if (path === '/auth/team' && method === 'GET') {
      return json(200, { ok: true, users: state.users });
    }

    // GET /auth/me or /auth/session
    if ((path === '/auth/me' || path === '/auth/session') && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const u = state.users.find((x) => x.id === session.userId);
      return json(200, { ok: true, user: u ?? null });
    }

    // Log any unhandled route so we can add it if needed
    console.warn(`[mock] unhandled: ${method} ${path}`);
    // (existing catch-all stays below)
    return json(404, { error: 'No encontrado.' });
  });
}

async function setupMockApi(
  page: Page,
  seed?: { expenses?: ExpenseRow[]; users?: User[]; settingsCategories?: any[] },
) {
  const state = createMockApiState(seed);
  await attachMockApiRoutes(page, state);
  return state;
}

async function loginAs(page: Page, email: string, password = 'Pass1234!') {
  const consoleErrors: string[] = [];
  const responses401: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`[pageerror] ${err.message}`));
  page.on('response', (res) => {
    if (res.status() === 401) responses401.push(`401 ${res.request().method()} ${res.url()}`);
  });

  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /iniciar sesi|sign in|entrar/i }).click();

  // Wait up to 15s; on timeout, dump errors to help diagnose
  try {
    await expect(page.getByRole('heading', { name: /panel|dashboard/i })).toBeVisible({ timeout: 15_000 });
  } catch (e) {
    console.error('[loginAs] 401 responses:', responses401);
    console.error('[loginAs] JS console errors collected:', consoleErrors);
    console.error('[loginAs] page HTML snapshot:', await page.content().then((h) => h.slice(0, 3000)));
    throw e;
  }
}

async function clickSidebarSection(page: Page, exactLabel: string) {
  await page.getByText(exactLabel, { exact: true }).first().click();
}

async function clickSidebarGastos(page: Page) {
  await clickSidebarSection(page, 'Gastos');
}

async function openSettingsViaUserMenu(page: Page) {
  // Settings is reached via the username card at the bottom of the sidebar (desktop E2E viewport).
  const userCard = page.locator('.dt-only button').filter({ hasText: /Admin QA|User QA|Manager/i }).first();
  await userCard.click();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Ajustes/i }).first()).toBeVisible({ timeout: 10_000 });
}

async function filterExpenseListToInvoices(page: Page) {
  await page.getByText('Gastos', { exact: true }).first().click();
  await page.waitForTimeout(500);
  // Tipo filter is a native <select>; options are not interactably "visible" — use selectOption
  await page.getByRole('combobox').nth(1).selectOption('invoice');
  await page.waitForTimeout(500);
}

async function openNewInvoicePanel(page: Page) {
  await clickSidebarGastos(page);
  await page
    .locator('button')
    .filter({ hasText: /^(Nuevo gasto|Nueva factura|[+＋])/i })
    .first()
    .click();
  const panel = page.locator('.panel-slide, [data-panel]').last();
  const invoiceCheckbox = panel.locator('input[type="checkbox"]').filter({ hasText: /factura|invoice/i }).first();
  if ((await invoiceCheckbox.count()) === 0) {
    const labeled = panel.getByRole('checkbox', { name: /factura|invoice|proveedor/i });
    if ((await labeled.count()) > 0) {
      await labeled.first().check({ force: true });
    } else {
      await panel.getByText(/factura/i).first().click();
    }
  } else {
    await invoiceCheckbox.check({ force: true });
  }
}

async function clickPanelSubmit(page: Page) {
  const panel = page.locator('.panel-slide, [data-panel]').last();
  await panel.getByRole('button', { name: /Enviar gasto|Enviar factura/i }).first().click({ force: true });
}

async function createExpenseViaUi(page: Page, description: string, amount: string) {
  await clickSidebarGastos(page);
  await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  await wrap.getByPlaceholder('Concepto').fill(description);
  await wrap.getByPlaceholder('0.00').fill(amount);

  const categorySelect = wrap.locator('label:has-text("Categoría") + select').first();
  await categorySelect.selectOption({ index: 1 });
  const departmentSelect = wrap.locator('label:has-text("Departamento") + select').first();
  await departmentSelect.selectOption({ index: 1 });

  await clickPanelSubmit(page);
  await expect(page.getByText(description).first()).toBeVisible();
}

async function createBillViaUi(page: Page, name: string, amount: string) {
  await openNewInvoicePanel(page);
  const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  await wrap.locator('input[placeholder="Concepto"]').first().fill(name);
  await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(name);
  await wrap.getByPlaceholder('0.00').fill(amount);

  const billCategory = wrap.locator('label:has-text("Categoría") + select').first();
  await billCategory.selectOption({ index: 1 });
  const billDepartment = wrap.locator('label:has-text("Departamento") + select').first();
  await billDepartment.selectOption({ index: 1 });

  await clickPanelSubmit(page);
  await expect(page.getByText(name).first()).toBeVisible();
}

async function openExpenseDetail(page: Page, descriptionText: string) {
  await page.getByText(descriptionText).first().click();
  await page.locator('.panel-slide, [data-panel], [role="dialog"]').last().waitFor({ state: 'visible' });
}

async function rejectExpenseViaUi(page: Page, note = 'No procede QA') {
  await clickSidebarSection(page, 'Aprobaciones');
  await page.getByRole('button', { name: 'Revisar' }).first().click();
  const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
  await panel.getByRole('button', { name: /Rechazar/i }).first().click({ force: true });
  const noteField = panel.locator('textarea, input[type="text"]').last();
  if (await noteField.isVisible().catch(() => false)) {
    await noteField.fill(note);
  }
  await panel.getByRole('button', { name: /Confirmar|Rechazar|Enviar/i }).first().click({ force: true });
  await page.waitForTimeout(600);
}

test.describe('Critical business flows', () => {
  test('1) Login + session handling survives reload', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');

    // Confirm token was stored after login
    const tokenBefore = await page.evaluate(() => sessionStorage.getItem('sol-session-token'));
    expect(tokenBefore).toMatch(/^tok-/);

    await page.reload();
    await page.waitForTimeout(1500);

    // Token must still be present after reload (session restore path)
    const tokenAfter = await page.evaluate(() => sessionStorage.getItem('sol-session-token'));
    expect(tokenAfter).toMatch(/^tok-/);
  });

  test('2) Create → approve → report expense flow', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');

    await createExpenseViaUi(page, 'Taxi aeropuerto QA', '120');

    await clickSidebarSection(page, 'Aprobaciones');
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).first().click();

    await clickSidebarSection(page, 'Informes');
    await expect(page.getByText(/Gasto total por categoría/i)).toBeVisible();
    await expect(page.getByText(/Taxi aeropuerto QA/i)).toBeHidden();
    await expect(
      page.getByText(/Equipment|Equipamiento|Supplies|Insumos|Marketing|Software|Otro/i).first(),
    ).toBeVisible();
  });

  test('3) Offline → sync keeps consistency (single expense, no duplicates)', async ({ page, context }) => {
    const state = await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');

    await context.setOffline(true);
    await createExpenseViaUi(page, 'Offline sync expense', '75');
    await expect(page.getByText(/Sin conexión, los cambios se guardarán localmente/i)).toBeVisible();

    await context.setOffline(false);
    await page.waitForTimeout(1500);
    await page.reload();
    await attachMockApiRoutes(page, state);
    await page.evaluate(() => sessionStorage.removeItem('sol-session-token'));
    await loginAs(page, 'admin@solana.test');
    await clickSidebarGastos(page);
    await expect(page.getByText('Offline sync expense').first()).toBeVisible({ timeout: 30_000 });
    expect(state.expenses.filter((e) => e.description === 'Offline sync expense')).toHaveLength(1);
  });

  test('4) Role-based permissions: regular user has read-only approvals', async ({ page }) => {
    const pendingExpense: ExpenseRow = {
      id: 'exp_role_1',
      userId: 'admin-1',
      date: '2026-04-01',
      description: 'Server bill import',
      amount: 200,
      amountEUR: 200,
      currency: 'EUR',
      category: 'Software',
      status: 'submitted',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: '{}',
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 200, pct: 100 }]),
      splitMode: null,
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: JSON.stringify([]),
      commentsJson: JSON.stringify([]),
      rejectionNote: null,
    };

    await setupMockApi(page, { expenses: [pendingExpense] });
    await loginAs(page, 'user@solana.test');

    await clickSidebarSection(page, 'Aprobaciones');
    await expect(page.getByRole('combobox').first()).toHaveValue('all');
    await expect(page.getByText('Server bill import').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar' })).toHaveCount(0);
    await page.getByText('Server bill import').click();
    const panel = page.locator('.panel-slide, [data-panel]').last();
    await expect(panel.getByRole('button', { name: /Aprobar/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Rechazar/i })).toHaveCount(0);
  });

  test('5) Bills lifecycle: create and approve', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');

    await createBillViaUi(page, 'Factura AWS QA', '260');

    await clickSidebarSection(page, 'Aprobaciones');
    await expect(page.getByRole('combobox').first()).toHaveValue('mine');
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).first().click();

    await clickSidebarGastos(page);
    await filterExpenseListToInvoices(page);
    await expect(page.getByText('Factura AWS QA').first()).toBeVisible();
    await expect(page.locator('.row-hover').filter({ hasText: 'Factura AWS QA' }).getByText(/Aprobado/i)).toBeVisible();
  });

});

test.describe('A — Expense lifecycle', () => {
  test('A1) Submit plain gasto — appears in Gastos as Pendiente', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Compra monitor QA', '350');
    await clickSidebarGastos(page);
    await expect(page.getByText('Compra monitor QA').first()).toBeVisible();
    const row = page.locator('[class*="row"], [class*="card"], li').filter({ hasText: 'Compra monitor QA' }).first();
    await expect(row.getByText(/Pendiente|Enviado|pending/i).first()).toBeVisible();
  });

  test('A2) Submit gasto — admin approves — status turns Aprobado', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Silla ergonómica QA', '480');
    await clickSidebarSection(page, 'Aprobaciones');
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await panel.getByRole('button', { name: /Aprobar/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    await clickSidebarGastos(page);
    const row = page.locator('[class*="row"], [class*="card"], li').filter({ hasText: 'Silla ergonómica QA' }).first();
    await expect(row.getByText(/Aprobado|approved/i).first()).toBeVisible();
  });

  test('A2b) Auto-approved expense shows Reconsiderar, not dead Approve/Reject', async ({ page }) => {
    const autoApproved: ExpenseRow = {
      id: 'exp_auto_appr_1',
      userId: 'admin-1',
      date: '2026-04-01',
      description: 'Auto approved QA',
      amount: 120,
      amountEUR: 120,
      currency: 'EUR',
      category: 'Equipment',
      status: 'approved',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 120, pct: 100 }]),
      splitMode: null,
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: JSON.stringify([]),
      commentsJson: JSON.stringify([]),
      rejectionNote: null,
    };
    await setupMockApi(page, { expenses: [autoApproved] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Auto approved QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Rechazar$/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Reconsiderar/i })).toBeVisible();
  });

  test('A2e) Reconsider fires POST /reconsider on auto-approved own-expense', async ({ page }) => {
    const autoApproved: ExpenseRow = {
      id: 'exp_auto_appr_recon_net',
      userId: 'admin-1',
      date: '2026-04-01',
      description: 'Auto approved reconsider net QA',
      amount: 130,
      amountEUR: 130,
      currency: 'EUR',
      category: 'Equipment',
      status: 'approved',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 130, pct: 100 }]),
      splitMode: null,
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: JSON.stringify([]),
      commentsJson: JSON.stringify([]),
      rejectionNote: null,
    };
    const reconsiderPosts: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST') return;
      try {
        const path = new URL(req.url()).pathname;
        if (/^\/expenses\/[^/]+\/reconsider$/.test(path)) reconsiderPosts.push(req.url());
      } catch (_) {}
    });
    await setupMockApi(page, { expenses: [autoApproved] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Auto approved reconsider net QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await panel.getByRole('button', { name: /Reconsiderar/i }).click();
    await expect.poll(() => reconsiderPosts.length, { timeout: 5000 }).toBeGreaterThan(0);
  });

  test('A2c) Reconsider sends approved expense back to pending review', async ({ page }) => {
    const approved: ExpenseRow = {
      id: 'exp_recon_appr_1',
      userId: 'user-1',
      date: '2026-04-02',
      description: 'Reconsider from approved QA',
      amount: 200,
      amountEUR: 200,
      currency: 'EUR',
      category: 'Software',
      status: 'approved',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      ownerId: 'user-1',
      paidByJson: JSON.stringify([{ userId: 'user-1', amount: 200, pct: 100 }]),
      splitMode: null,
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: JSON.stringify([]),
      commentsJson: JSON.stringify([]),
      rejectionNote: null,
    };
    await setupMockApi(page, { expenses: [approved] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Reconsider from approved QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await panel.getByRole('button', { name: /Reconsiderar/i }).click();
    await page.waitForTimeout(800);
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Rechazar$/i })).toBeVisible();
    await expect(panel.getByText(/Pendiente|Enviado|pending/i).first()).toBeVisible();
  });

  test('A2d) Reconsider sends rejected expense back to pending review', async ({ page }) => {
    const rejected: ExpenseRow = {
      id: 'exp_recon_rej_1',
      userId: 'user-1',
      date: '2026-04-03',
      description: 'Reconsider from rejected QA',
      amount: 150,
      amountEUR: 150,
      currency: 'EUR',
      category: 'Marketing',
      status: 'rejected',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'rejected' }),
      ownerId: 'user-1',
      paidByJson: JSON.stringify([{ userId: 'user-1', amount: 150, pct: 100 }]),
      splitMode: null,
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: JSON.stringify([]),
      commentsJson: JSON.stringify([]),
      rejectionNote: 'No procede QA reconsider',
    };
    await setupMockApi(page, { expenses: [rejected] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Reconsider from rejected QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await panel.getByRole('button', { name: /Reabrir/i }).click();
    await page.waitForTimeout(800);
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Rechazar$/i })).toBeVisible();
  });

  test('A3) Admin rejects with note — status turns Rechazado', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Gasto rechazable QA', '99');
    await rejectExpenseViaUi(page, 'No procede QA');
    await clickSidebarGastos(page);
    const row = page.locator('[class*="row"], [class*="card"], li').filter({ hasText: 'Gasto rechazable QA' }).first();
    await expect(row.getByText(/Rechazado|rejected/i).first()).toBeVisible();
  });

  test('A4) User edits rejected gasto — all fields changeable — resubmits', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_rej_1',
          userId: 'user-1',
          ownerId: 'user-1',
          submittedBy: 'user-1',
          date: '2026-04-10',
          description: 'Gasto para editar QA',
          amount: 50,
          amountEUR: 50,
          currency: 'EUR',
          category: 'Software',
          status: 'rejected',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: '{}',
          paidByJson: JSON.stringify([{ userId: 'user-1', amount: 50, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          expenseType: 'expense',
          auditTrail: [],
          auditTrailJson: JSON.stringify([]),
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paymentStatus: 'na',
          deferredPayment: false,
          paymentTermDays: 0,
          rejectionNote: 'QA',
        },
      ],
    });
    await attachMockApiRoutes(page, state);
    await loginAs(page, 'user@solana.test');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Gasto para editar QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await panel.getByRole('button', { name: /Editar|Edit/i }).first().click({ force: true });
    await page.waitForTimeout(400);
    const descField = panel.locator('input[name*="desc"], input[placeholder*="escripci"], textarea').first();
    await expect(descField).toBeEnabled();
    await descField.fill('Gasto editado QA');
    await panel.getByRole('button', { name: /Enviar|Guardar|Reenviar/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    await expect(page.getByText('Gasto editado QA').first()).toBeVisible();
  });

  test('A5) Approved gasto cannot be edited by regular user', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_appr_1',
          userId: 'user-1',
          ownerId: 'user-1',
          submittedBy: 'user-1',
          date: '2026-04-10',
          description: 'Gasto aprobado bloqueado QA',
          amount: 100,
          amountEUR: 100,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'user-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'user-1', amount: 100, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          expenseType: 'expense',
          auditTrail: [],
          auditTrailJson: JSON.stringify([]),
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paymentStatus: 'na',
          deferredPayment: false,
          paymentTermDays: 0,
          rejectionNote: null,
        },
      ],
    });
    await attachMockApiRoutes(page, state);
    await loginAs(page, 'user@solana.test');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Gasto aprobado bloqueado QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    const editBtn = panel.getByRole('button', { name: /Editar|Edit/i });
    const count = await editBtn.count();
    if (count > 0) {
      await expect(editBtn.first()).toBeDisabled();
    } else {
      expect(count).toBe(0);
    }
  });
});

test.describe('B — Invoice (factura) lifecycle', () => {
  test('B1) Submit factura appears in Gastos with due date', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createBillViaUi(page, 'Factura contado QA', '180');
    await clickSidebarGastos(page);
    await filterExpenseListToInvoices(page);
    await page.waitForTimeout(1000);
    await expect(page.getByText('Factura contado QA').first()).toBeVisible({ timeout: 15000 });
    await openExpenseDetail(page, 'Factura contado QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await expect(panel.getByText(/Vencimiento/i).first()).toBeVisible();
    await expect(panel.getByText(/Estado de pago/i)).toHaveCount(0);
    await expect(panel.getByText(/Condiciones de pago/i)).toHaveCount(0);
  });

  test('B2) Submit factura — approve — shows as approved invoice', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createBillViaUi(page, 'Factura NET-30 QA', '500');
    await clickSidebarSection(page, 'Aprobaciones');
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await panel.getByRole('button', { name: /Aprobar/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    await clickSidebarGastos(page);
    await filterExpenseListToInvoices(page);
    const row = page.locator('[class*="row"], [class*="card"], li').filter({ hasText: 'Factura NET-30 QA' }).first();
    await expect(row.getByText(/Aprobado/i).first()).toBeVisible();
    await expect(row.getByText(/A pagar|Pagada|Pendiente de pago/i)).toHaveCount(0);
  });

  test('B3) Invoice detail shows due date and no payment-status UI', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_inv_defer',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-04-01',
          description: 'Factura con vencimiento QA',
          vendor: 'Proveedor QA',
          amount: 300,
          amountEUR: 300,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'invoice',
          dueDate: '2026-05-01',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'user-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 300, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          recurring: 0,
          recurrenceRule: null,
          auditTrail: [],
          auditTrailJson: JSON.stringify([]),
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          rejectionNote: null,
        },
      ],
    });
    await attachMockApiRoutes(page, state);
    await loginAs(page, 'admin@solana.test');
    await clickSidebarGastos(page);
    await filterExpenseListToInvoices(page);
    await page.waitForTimeout(1000);
    await expect(page.getByText('Proveedor QA').first()).toBeVisible({ timeout: 15000 });
    await openExpenseDetail(page, 'Proveedor QA');
    const detailPanel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await expect(detailPanel.getByText(/Vencimiento/i).first()).toBeVisible();
    await expect(detailPanel.getByText(/01 may 2026/i).first()).toBeVisible();
    await expect(detailPanel.getByRole('button', { name: /Marcar como pagada|Marcar pagada|Mark paid/i })).toHaveCount(0);
    await expect(detailPanel.getByText(/Estado de pago/i)).toHaveCount(0);
  });

  test('B4) Approved invoice appears once in Gastos list', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_inv_nodup',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-04-01',
          description: 'Factura sin duplicar QA',
          vendor: 'NoDup QA',
          amount: 150,
          amountEUR: 150,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'invoice',
          dueDate: '2026-05-01',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'user-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 150, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          recurring: 0,
          recurrenceRule: null,
          auditTrail: [],
          auditTrailJson: JSON.stringify([]),
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          rejectionNote: null,
        },
      ],
    });
    await attachMockApiRoutes(page, state);
    await loginAs(page, 'admin@solana.test');
    await clickSidebarGastos(page);
    await filterExpenseListToInvoices(page);
    await page.waitForTimeout(1000);
    await expect(page.getByText('NoDup QA').first()).toBeVisible({ timeout: 15000 });
    const listRows = page.locator('div.row-hover').filter({ hasText: 'NoDup QA' }).filter({ hasText: '150,00' });
    await expect(listRows).toHaveCount(1);
    expect(state.expenses.filter((e) => e.description === 'Factura sin duplicar QA')).toHaveLength(1);
  });

  test('B5) Rejected invoice shows rejected status', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_inv_rej',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-04-01',
          description: 'Factura a rechazar QA',
          vendor: 'Reject QA',
          amount: 200,
          amountEUR: 200,
          currency: 'EUR',
          category: 'Software',
          status: 'submitted',
          expenseType: 'invoice',
          dueDate: '2026-05-01',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: '{}',
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 200, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          recurring: 0,
          recurrenceRule: null,
          auditTrail: [],
          auditTrailJson: JSON.stringify([]),
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          rejectionNote: null,
        },
      ],
    });
    await attachMockApiRoutes(page, state);
    await loginAs(page, 'admin@solana.test');
    await rejectExpenseViaUi(page, 'Rechazada QA');
    const inv = state.expenses.find((e) => e.id === 'exp_inv_rej');
    expect(inv?.status).toBe('rejected');
    await clickSidebarGastos(page);
    await filterExpenseListToInvoices(page);
    await expect(page.locator('div.row-hover').filter({ hasText: 'Reject QA' }).getByText(/Rechazado/i).first()).toBeVisible();
  });
});

test.describe('C — Permissions and profile', () => {
  test('C1) Regular user sees all expenses (transparency model)', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_other_1',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-04-10',
          description: 'Gasto de otro usuario QA',
          amount: 75,
          amountEUR: 75,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          approversJson: JSON.stringify(['user-1']),
          approvalVotesJson: JSON.stringify({ 'user-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 75, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          expenseType: 'expense',
          auditTrailJson: '[]',
          auditTrail: [],
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    await attachMockApiRoutes(page, state);
    await loginAs(page, 'user@solana.test');
    await clickSidebarGastos(page);
    await expect(page.getByText('Gasto de otro usuario QA').first()).toBeVisible();
  });

  test('C2) Regular user cannot see Aprobar/Rechazar buttons', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_no_btn_1',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-04-10',
          description: 'Gasto sin botones QA',
          amount: 50,
          amountEUR: 50,
          currency: 'EUR',
          category: 'Software',
          status: 'submitted',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: '{}',
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 50, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          expenseType: 'expense',
          auditTrailJson: '[]',
          auditTrail: [],
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    await attachMockApiRoutes(page, state);
    await loginAs(page, 'user@solana.test');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Gasto sin botones QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await expect(panel.getByRole('button', { name: /Aprobar/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Rechazar/i })).toHaveCount(0);
  });

  test('C4) Admin can assign approvers to departments in Settings', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await openSettingsViaUserMenu(page);
    await page.getByText('Ajustes de aplicación').first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Departamentos').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Estrategia').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/de este departamento/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('C3) Regular user can access settings and change password', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await openSettingsViaUserMenu(page);
    // Expand "Cambiar contraseña" accordion
    await page.getByText('Cambiar contraseña').first().click();
    await page.waitForTimeout(500);
    const pwInputs = page.locator('input[type="password"]');
    await pwInputs.nth(0).fill('OldPass1!');
    await pwInputs.nth(1).fill('NewPass1!');
    await pwInputs.nth(2).fill('NewPass1!');
    await page.getByRole('button', { name: /Establecer|Guardar|Cambiar|Save/i }).first().click();
    await expect(page.getByText(/Guardado|Contraseña|actualizada|cambiada|ok/i).first()).toBeVisible({ timeout: 8000 });
  });

  test('C5) Assigned approver sees Aprobar/Rechazar buttons regardless of role', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_appr_check',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-04-15',
          description: 'Gasto para aprobar por user QA',
          amount: 120,
          amountEUR: 120,
          currency: 'EUR',
          category: 'Software',
          status: 'submitted',
          approversJson: JSON.stringify(['user-1']),
          approvalVotesJson: '{}',
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 120, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          expenseType: 'expense',
          auditTrail: [],
          auditTrailJson: JSON.stringify([]),
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paymentStatus: 'na',
          deferredPayment: false,
          paymentTermDays: 0,
          rejectionNote: null,
        },
      ],
    });
    await attachMockApiRoutes(page, state);
    await loginAs(page, 'user@solana.test');
    await clickSidebarSection(page, 'Aprobaciones');
    await expect(page.getByText('Gasto para aprobar por user QA').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar' }).first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await expect(panel.getByRole('button', { name: /Aprobar/i }).first()).toBeVisible();
    await expect(panel.getByRole('button', { name: /Rechazar/i }).first()).toBeVisible();
  });
});

test.describe('D — Informes (Reports)', () => {
  test('D1) Informes visible to all roles', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await clickSidebarSection(page, 'Informes');
    await expect(page.getByText(/Informes|Resumen|Reports|Gasto total/i).first()).toBeVisible();
  });

  test('D2) Informes has no date range filter', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Informes');
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    await expect(page.getByText(/Total del período|Total período|Total/i).first()).toBeVisible();
  });

  test('D3) Export button shows Exportar Excel', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Informes');
    await expect(page.getByRole('button', { name: /Exportar Excel/i })).toBeVisible();
    await expect(page.getByText('Exportar CSV')).toHaveCount(0);
    await expect(page.getByText('Exportar PDF')).toHaveCount(0);
  });
});

test.describe('E — Seguimiento (Audit trail)', () => {
  test('E1) Seguimiento shows submission event', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Gasto seguimiento QA', '80');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Gasto seguimiento QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    const segTab = panel.getByRole('tab', { name: /Seguimiento|Historial|Activity/i });
    if (await segTab.isVisible().catch(() => false)) await segTab.click();
    await expect(panel.getByText(/Enviado|Submitted|Creado/i).first()).toBeVisible();
  });

  test('E2) Seguimiento shows approval event after approval', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Gasto aprobado trail QA', '90');
    await clickSidebarSection(page, 'Aprobaciones');
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    const approvePanel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await approvePanel.getByRole('button', { name: /Aprobar/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Gasto aprobado trail QA');
    const detailPanel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    const segTab = detailPanel.getByRole('tab', { name: /Seguimiento|Historial|Activity/i });
    if (await segTab.isVisible().catch(() => false)) await segTab.click();
    await expect(detailPanel.getByText(/Aprobado|Approved/i).first()).toBeVisible();
  });

  test('E3) Note added via Añadir nota appears in Seguimiento', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Gasto con nota QA', '60');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Gasto con nota QA');
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    const segTab = panel.getByRole('tab', { name: /Seguimiento|Historial|Activity/i });
    if (await segTab.isVisible().catch(() => false)) await segTab.click();
    await panel.getByRole('button', { name: /Añadir nota|Add note|Comentar/i }).first().click({ force: true });
    await page.waitForTimeout(300);
    const noteArea = panel.locator('textarea, input[type="text"]').last();
    await noteArea.fill('Nota de prueba QA');
    await panel.getByRole('button', { name: /Guardar|Enviar|Añadir|Save/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    await expect(panel.getByText('Nota de prueba QA').first()).toBeVisible();
  });
});

test.describe('F — Draft persistence', () => {
  test('F1) Draft persists when navigating away mid-form', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await page.waitForTimeout(400);
    await page.getByPlaceholder(/oncepto/i).first().fill('Borrador persistente QA');
    await page.getByText('Panel', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await page.waitForTimeout(400);
    // Draft is restored into the form (Concepto) without always showing a "Recuperar borrador" prompt
    await expect(page.getByRole('textbox', { name: /Concepto/i })).toHaveValue('Borrador persistente QA', {
      timeout: 10000,
    });
  });

  test('F2) Draft clears on successful submit', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Gasto limpia borrador QA', '55');
    await clickSidebarSection(page, 'Aprobaciones');
    await page.waitForTimeout(300);
    await clickSidebarGastos(page);
    await page.waitForTimeout(400);
    const draftPrompt = page.getByText(/Recuperar borrador/i);
    await expect(draftPrompt).toHaveCount(0);
  });
});
