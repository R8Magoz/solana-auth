import { expect, type Locator, type Page } from '@playwright/test';

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  accountStatus: 'active' | 'denied' | 'pending_admin_approval';
  approvalStatus: 'approved' | 'denied' | 'pending';
  color: string;
};

export type ExpenseRow = Record<string, unknown>;

export type DeptRow = {
  id: string;
  name: string;
  budget: number;
  archived: boolean;
  createdAt: number;
  approverIds?: string[];
};

export type RecordedRequest = {
  method: string;
  path: string;
  body: unknown;
  timestamp: number;
};

export type MockApiState = {
  users: User[];
  expenses: ExpenseRow[];
  departments: DeptRow[];
  tokens: Map<string, { userId: string; role: string }>;
  passwords: Map<string, string>;
  settings: { categories: unknown[] | null; department_approvers: Record<string, string[]> };
  requests: RecordedRequest[];
};

export const PASSWORDS: Record<string, string> = {
  'admin@solana.test': 'r8magoz',
  'user@solana.test': 'test',
};

export const MOCK_AUTH_BASE = 'https://solana-auth.onrender.com';

const _attached = new WeakMap<Page, boolean>();

function buildTraceCode(createdAtMs: number, amountEur: number, expenseId: string): string {
  const ts = Number(createdAtMs);
  const d = new Date(Number.isFinite(ts) ? ts : Date.now());
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = d.toISOString().slice(11, 16).replace(':', '');
  const amt = Number(amountEur);
  const amountStr = `${(Number.isFinite(amt) ? amt : 0).toFixed(2)}EUR`;
  const base = `${dateStr}_${timeStr}_${amountStr}`;
  const id = String(expenseId || '').trim();
  if (!id) return base;
  const suffix = id.replace(/^exp_/, '').slice(0, 4).toLowerCase();
  return suffix ? `${base}_${suffix}` : base;
}

export function makeUsers(): User[] {
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

function safeJson(body: string | null): Record<string, unknown> {
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseApprovers(row: ExpenseRow): string[] {
  try {
    const aj = JSON.parse(String(row.approversJson || 'null'));
    return Array.isArray(aj) ? aj.map(String) : [];
  } catch {
    return [];
  }
}

function parseVotes(row: ExpenseRow): Record<string, string> {
  try {
    const vj = JSON.parse(String(row.approvalVotesJson || 'null'));
    return vj && typeof vj === 'object' && !Array.isArray(vj) ? (vj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function canSessionActOnApproval(row: ExpenseRow, session: { userId: string; role: string } | null): boolean {
  if (!session) return false;
  return parseApprovers(row).includes(session.userId);
}

function parseAudit(row: ExpenseRow): Record<string, unknown>[] {
  try {
    const a = JSON.parse(String(row.auditTrailJson || 'null'));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function writeAudit(row: ExpenseRow, entries: Record<string, unknown>[]) {
  row.auditTrailJson = JSON.stringify(entries);
}

function pushAudit(
  row: ExpenseRow,
  entry: { action: string; by?: string; at?: string; note?: string; meta?: Record<string, unknown>; via?: string },
) {
  const prev = parseAudit(row);
  prev.push({
    ...entry,
    at: entry.at || new Date().toISOString(),
  });
  writeAudit(row, prev);
}

function parseComments(row: ExpenseRow): Record<string, unknown>[] {
  try {
    const cj = JSON.parse(String(row.commentsJson || 'null'));
    return Array.isArray(cj) ? cj : [];
  } catch {
    return [];
  }
}


function finalizeFromApprovalVotes(
  e: ExpenseRow,
  approverIds: string[],
  votes: Record<string, string>,
  _actorUserId: string,
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

function recalculatePaidByForNewTotal(
  paidByJson: string | null | undefined,
  splitMode: string | null | undefined,
  newTotal: number,
  submitterId: string,
): { paidBy: { userId: string; amount: number; pct?: number }[]; splitMode: string | null } {
  const total = Number(newTotal);
  if (!Number.isFinite(total) || total <= 0) {
    return { paidBy: [{ userId: submitterId, amount: total, pct: 100 }], splitMode: null };
  }
  let rows: { userId?: string; amount?: number; pct?: number | null }[];
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
  const out: { userId: string; amount: number; pct?: number }[] = [];
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

function recordRequest(state: MockApiState, method: string, path: string, body: unknown) {
  state.requests.push({ method: method.toUpperCase(), path, body, timestamp: Date.now() });
}

function toPathPattern(pathPattern: string | RegExp): RegExp {
  return typeof pathPattern === 'string' ? new RegExp(pathPattern) : pathPattern;
}

export function matchingRequests(
  state: MockApiState,
  method: string,
  pathPattern: string | RegExp,
  opts?: { after?: number },
): RecordedRequest[] {
  const re = toPathPattern(pathPattern);
  return state.requests.filter((r) => {
    if (r.method.toUpperCase() !== method.toUpperCase()) return false;
    if (!re.test(r.path)) return false;
    if (opts?.after != null && r.timestamp < opts.after) return false;
    return true;
  });
}

export function expectRequestFired(state: MockApiState, method: string, pathPattern: string | RegExp): void {
  expect(matchingRequests(state, method, pathPattern).length).toBeGreaterThan(0);
}

export function expectNoRequest(state: MockApiState, method: string, pathPattern: string | RegExp): void {
  expect(matchingRequests(state, method, pathPattern).length).toBe(0);
}

export async function waitForRequest(
  state: MockApiState,
  method: string,
  pathPattern: string | RegExp,
  opts?: { timeout?: number; count?: number; after?: number },
): Promise<RecordedRequest[]> {
  const min = opts?.count ?? 1;
  await expect.poll(() => matchingRequests(state, method, pathPattern, { after: opts?.after }).length, {
    timeout: opts?.timeout ?? 10_000,
  }).toBeGreaterThanOrEqual(min);
  return matchingRequests(state, method, pathPattern, { after: opts?.after });
}

export async function waitForExpensesRefetch(
  state: MockApiState,
  opts?: { timeout?: number; after?: number },
): Promise<RecordedRequest[]> {
  return waitForRequest(state, 'GET', /^\/expenses\/?$/, { timeout: opts?.timeout ?? 10_000, after: opts?.after });
}

export function getExpenseFromState(state: MockApiState, id: string): ExpenseRow | undefined {
  return state.expenses.find((e) => e.id === id);
}

export async function assertPostRefetchStatus(
  state: MockApiState,
  expenseId: string,
  expectedStatus: string,
  panel: Locator,
  statusPattern: RegExp,
  opts?: { after?: number },
): Promise<void> {
  await waitForExpensesRefetch(state, { after: opts?.after });
  expect(getExpenseFromState(state, expenseId)?.status).toBe(expectedStatus);
  await expect(panel.getByText(statusPattern).first()).toBeVisible();
}

export function defaultMockDepartments(): DeptRow[] {
  return [
    { id: 'dept_ops', name: 'Operaciones', budget: 3000, archived: false, createdAt: Date.now(), approverIds: ['admin-1'] },
    { id: 'dept_fin', name: 'Finanzas', budget: 5000, archived: false, createdAt: Date.now(), approverIds: ['admin-1'] },
    { id: 'dept_estrategia', name: 'Estrategia', budget: 4000, archived: false, createdAt: Date.now(), approverIds: ['admin-1'] },
  ];
}

export function createMockApiState(
  seed?: {
    expenses?: ExpenseRow[];
    users?: User[];
    settingsCategories?: unknown[];
    departmentApprovers?: Record<string, string[]>;
    departments?: DeptRow[];
  },
): MockApiState {
  const departments = seed?.departments ?? defaultMockDepartments();
  const departmentApprovers = { ...(seed?.departmentApprovers ?? {}) };
  for (const d of departments) {
    if (Array.isArray(d.approverIds) && d.approverIds.length > 0) {
      departmentApprovers[d.id] = d.approverIds;
    }
  }
  return {
    users: seed?.users ?? makeUsers(),
    expenses: seed?.expenses ?? [],
    departments,
    tokens: new Map<string, { userId: string; role: string }>(),
    passwords: new Map<string, string>(Object.entries(PASSWORDS)),
    settings: {
      categories: seed?.settingsCategories ?? null,
      department_approvers: departmentApprovers,
    },
    requests: [],
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
    const rawBody = ['POST', 'PUT', 'PATCH'].includes(method) ? req.postData() : null;
    recordRequest(state, method, path, safeJson(rawBody));

    const auth = (await req.headerValue('authorization')) ?? '';
    const authStr = String(auth).trim();
    const token = authStr.startsWith('Bearer ') ? authStr.slice(7).trim() : '';
    const session = token ? state.tokens.get(token) : null;

    const json = (status: number, data: unknown) =>
      route.fulfill({
        status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });

    const adminIds = () => state.users.filter((u) => u.role === 'admin').map((u) => u.id);

    const defaultApproversFromBody = (body: Record<string, unknown>): string[] => {
      const reqApprovers = Array.isArray(body.approvalRequired)
        ? body.approvalRequired.filter(Boolean).map(String)
        : [];
      if (reqApprovers.length) return reqApprovers;
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
      let body: Record<string, unknown> = {};
      try { body = (req.postDataJSON() ?? {}) as Record<string, unknown>; } catch { body = safeJson(req.postData()); }
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
        ? state.expenses.filter((ex) => idList.includes(String(ex.id)))
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
      } catch {
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
      const traceCode = buildTraceCode(now, Number(body.amount || 0), id);
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
            traceCode,
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
            traceCode,
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
        if (e.status === 'deleted') return json(400, { error: 'Gasto no válido.' });
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
        if (e.status === 'deleted') return json(400, { error: 'Gasto no válido.' });
        if (!canSessionActOnApproval(e, session)) {
          return json(403, { error: 'No eres aprobador designado para este gasto.' });
        }
        if (e.status === 'rejected') {
          e.updatedAt = Date.now();
          return json(200, { ok: true, expense: e });
        }
        if (e.status !== 'submitted' && e.status !== 'approved') {
          return json(400, { error: 'El gasto no está pendiente de aprobación.' });
        }
        const body = safeJson(req.postData());
        const note = body.note != null ? String(body.note).trim().slice(0, 2000) : null;
        if (!note || note.length < 10) {
          return json(400, { error: 'El motivo del rechazo es obligatorio (mínimo 10 caracteres).' });
        }
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
        if (e.status === 'deleted') return json(400, { error: 'Gasto no válido.' });
        const canReconsider = session.role === 'admin' || canSessionActOnApproval(e, session);
        if (!canReconsider) {
          return json(403, { error: 'No autorizado.' });
        }
        if (e.status !== 'approved' && e.status !== 'rejected') {
          return json(400, { error: 'Gasto no válido.' });
        }
        const previousStatus = e.status;
        const now = Date.now();
        // Reconsider reopens to submitted — no sole-approver auto-approve (that applies only on new submit).
        e.status = 'submitted';
        e.approvalVotesJson = '{}';
        e.approvedBy = null;
        e.approvedAt = null;
        e.rejectedBy = null;
        e.rejectedAt = null;
        e.rejectionNote = null;
        pushAudit(e, {
          action: 'expense_reconsider_requested',
          by: session.userId,
          meta: { previousStatus },
        });
        e.updatedAt = now;
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
          String(e.paidByJson || ''),
          e.splitMode != null ? String(e.splitMode) : null,
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

    if (path === '/expenses' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { ok: true, expenses: state.expenses });
    }

    if (path === '/departments' && method === 'GET') {
      return json(200, { ok: true, departments: state.departments });
    }

    if (path === '/auth/team' && method === 'GET') {
      return json(200, { ok: true, users: state.users });
    }

    if ((path === '/auth/me' || path === '/auth/session') && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const u = state.users.find((x) => x.id === session.userId);
      return json(200, { ok: true, user: u ?? null });
    }

    const expenseAuditMatch = path.match(/^\/expenses\/([^/]+)\/audit$/);
    if (expenseAuditMatch && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const exp = state.expenses.find((x) => x.id === expenseAuditMatch[1]);
      if (!exp) return json(404, { error: 'Gasto no encontrado.' });
      return json(200, { entries: parseAudit(exp) });
    }

    const expenseReceiptGetMatch = path.match(/^\/expenses\/([^/]+)\/receipt$/);
    if (expenseReceiptGetMatch && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(404, { error: 'No encontrado.' });
    }

    console.warn(`[mock] unhandled: ${method} ${path}`);
    return json(404, { error: 'No encontrado.' });
  });
}

export async function setupMockApi(
  page: Page,
  seed?: {
    expenses?: ExpenseRow[];
    users?: User[];
    settingsCategories?: unknown[];
    departmentApprovers?: Record<string, string[]>;
    departments?: DeptRow[];
  },
): Promise<MockApiState> {
  const state = createMockApiState(seed);
  await attachMockApiRoutes(page, state);
  return state;
}
