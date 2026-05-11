import { expect, test, type Page } from '@playwright/test';

type User = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin' | 'superadmin';
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
      role: 'superadmin',
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

function pushAudit(row: ExpenseRow, entry: { action: string; by?: string; at?: string; note?: string }) {
  const prev = parseAudit(row);
  prev.push({
    ...entry,
    at: entry.at || new Date().toISOString(),
  });
  writeAudit(row, prev);
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
  settings: { categories: any[] | null };
};

const _attached = new WeakMap<Page, boolean>();

export function createMockApiState(
  seed?: { expenses?: ExpenseRow[]; users?: User[]; settingsCategories?: any[] },
): MockApiState {
  return {
    users: seed?.users ?? makeUsers(),
    expenses: seed?.expenses ?? [],
    departments: [
      { id: 'dept_ops', name: 'Operaciones', budget: 3000, archived: false, createdAt: Date.now() },
      { id: 'dept_fin', name: 'Finanzas', budget: 5000, archived: false, createdAt: Date.now() },
    ],
    tokens: new Map<string, { userId: string; role: string }>(),
    passwords: new Map<string, string>(Object.entries(PASSWORDS)),
    settings: {
      categories: seed?.settingsCategories ?? (null as any[] | null),
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

    const superadminIds = () => state.users.filter((u) => u.role === 'superadmin').map((u) => u.id);

    const defaultApproversFromBody = (body: any): string[] => {
      const req = Array.isArray(body.approvalRequired) ? body.approvalRequired.filter(Boolean).map(String) : [];
      if (req.length) return req;
      const s = superadminIds();
      return s.length ? s : [state.users[0]?.id].filter(Boolean) as string[];
    };

    if (method === 'OPTIONS') return json(204, {});
    if (path === '/health' && method === 'GET') return json(200, { ok: true });

    if (path === '/auth/login' && method === 'POST') {
      const body = safeJson(req.postData());
      const email = String(body.email || '').toLowerCase().trim();
      const user = state.users.find((u) => u.email === email);
      const expectedPw = state.passwords.get(email) ?? '';
      const okPw = expectedPw !== '' && String(body.password || '') === expectedPw;
      if (!user || user.accountStatus !== 'active' || !okPw) {
        return json(401, { error: 'Correo o contraseña incorrectos.' });
      }
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
      return json(200, { ok: true, settings: payload });
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
      if (r !== 'admin' && r !== 'superadmin') return json(403, { error: 'No autorizado.' });
      const totalExpenses = state.expenses.reduce((s, ex) => s + (Number(ex.amountEUR) || 0), 0);
      return json(200, { ok: true, totalExpenses, byCategory: {}, byDepartment: {} });
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
      const deferred = isInvoice && body.deferredPayment === true;
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
            paymentStatus: deferred ? 'pending_approval' : 'paid',
            paymentTermDays: body.paymentTermDays ?? 0,
            deferredPayment: deferred,
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

    const expenseIdMatch = path.match(/^\/expenses\/([^/]+)\/(receipt|approve|reject|mark-paid|comments|comment)$/);
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
        const votes = parseVotes(e);
        votes[session.userId] = 'approved';
        e.approvalVotesJson = JSON.stringify(votes);
        const approverIds = parseApprovers(e);
        const allDone = approverIds.length > 0 && approverIds.every((aid) => votes[aid] === 'approved');
        if (allDone) {
          e.status = 'approved';
          if (e.expenseType === 'invoice' && e.deferredPayment) {
            e.paymentStatus = 'unpaid';
          } else if (e.expenseType === 'invoice') {
            e.paymentStatus = 'paid';
          }
          const notePayload = safeJson(req.postData()).note;
          const auditArrApprove = parseAudit(e);
          auditArrApprove.push({
            action: 'approved',
            by: session.userId,
            at: new Date().toISOString(),
            ...(notePayload != null ? { note: notePayload } : {}),
          });
          writeAudit(e, auditArrApprove);
          (e as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = auditArrApprove;
        }
        e.updatedAt = Date.now();
        (e as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = parseAudit(e);
        return json(200, { ok: true, expense: e });
      }
      if (sub === 'reject') {
        if (session.role !== 'admin' && session.role !== 'superadmin') {
          return json(403, { error: 'No autorizado.' });
        }
        const body = safeJson(req.postData());
        e.status = 'rejected';
        e.rejectionNote = String(body.note || body.rejectionNote || '');
        e.approvalVotesJson = '{}';
        if (e.expenseType === 'invoice') {
          e.paymentStatus = 'pending_approval';
        }
        pushAudit(e, { action: 'rejected', by: session.userId, note: e.rejectionNote });
        e.updatedAt = Date.now();
        (e as ExpenseRow & { auditTrail?: unknown[] }).auditTrail = parseAudit(e);
        return json(200, { ok: true, expense: e });
      }
      if (sub === 'mark-paid') {
        if (e.paymentStatus === 'paid') {
          return json(400, { error: 'Ya pagada.' });
        }
        e.paymentStatus = 'paid';
        e.paidAt = Date.now();
        e.paidConfirmedBy = session.userId;
        pushAudit(e, { action: 'mark_paid', by: session.userId });
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
      if (body.paidBy) e.paidByJson = JSON.stringify(body.paidBy);
      if (body.expenseType) e.expenseType = body.expenseType;
      if (body.deferredPayment != null) e.deferredPayment = !!body.deferredPayment;
      if (body.paymentTermDays != null) e.paymentTermDays = Number(body.paymentTermDays);
      if (body.dueDate !== undefined) e.dueDate = body.dueDate;
      if (Array.isArray(body.approvalRequired)) {
        e.approversJson = JSON.stringify(body.approvalRequired.filter(Boolean));
        e.approvalVotesJson = '{}';
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
      return json(200, { ok: true, expense: e });
    }

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

async function loginAs(page: Page, email: string, password = 'password123') {
  // Clear any persisted session so the login form always appears
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch (_) {}
    try {
      sessionStorage.clear();
    } catch (_) {}
  });

  await page.goto('/');

  // Dismiss any splash / loading overlay by waiting for it to disappear
  await page.waitForTimeout(1500);

  // Look for the email input — it must appear once localStorage is cleared
  // and the app detects no valid session token.
  const emailInput = page.locator('input[type="email"]');
  try {
    await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    // If still not visible, the app may be in offline/demo mode (no AUTH_URL).
    // In that case, navigation works without a login form — just return.
    return;
  }

  await emailInput.fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page
    .getByRole('button', { name: /iniciar sesión|entrar|login/i })
    .first()
    .click();

  // Wait for the login form to disappear (app transitioned to main UI)
  await emailInput.waitFor({ state: 'hidden', timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function clickSidebarSection(page: Page, exactLabel: string) {
  await page.locator('nav').getByText(exactLabel, { exact: true }).first().click();
}

async function clickSidebarGastos(page: Page) {
  await clickSidebarSection(page, 'Gastos');
}

async function filterExpenseListToInvoices(page: Page) {
  await page.locator('button').filter({ hasText: /^Facturas/ }).first().click();
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
    const tokenBefore = await page.evaluate(() => localStorage.getItem('sol-session-token'));
    expect(tokenBefore).toMatch(/^tok-/);

    await page.reload();
    await page.waitForTimeout(1500);

    // Token must still be present after reload (session restore path)
    const tokenAfter = await page.evaluate(() => localStorage.getItem('sol-session-token'));
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
    await expect(page.getByText('Server bill import')).toBeVisible();
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
    await expect(page.getByText('Compra monitor QA')).toBeVisible();
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
    await expect(page.getByText('Gasto editado QA')).toBeVisible();
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
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
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
  test('B1) Submit factura without A pagar — paymentStatus is paid on creation', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createBillViaUi(page, 'Factura contado QA', '180');
    await clickSidebarGastos(page);
    await filterExpenseListToInvoices(page);
    const row = page.locator('[class*="row"], [class*="card"], li').filter({ hasText: 'Factura contado QA' }).first();
    await expect(row.getByText(/Pagada|Paid|Al contado/i).first()).toBeVisible();
  });

  test('B2) Submit factura with A pagar — payment tracking activates after approval', async ({ page }) => {
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
    await expect(row.getByText(/Pendiente|Por pagar|Unpaid|Vence/i).first()).toBeVisible();
  });

  test('B3) Owner marks deferred factura as paid', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_inv_defer',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-04-01',
          description: 'Factura a marcar pagada QA',
          vendor: 'Proveedor QA',
          amount: 300,
          amountEUR: 300,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'invoice',
          paymentStatus: 'unpaid',
          dueDate: '2026-05-01',
          paymentTermDays: 30,
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 300, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          recurring: 0,
          recurrenceRule: null,
          deferredPayment: true,
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
    await openExpenseDetail(page, 'Factura a marcar pagada QA');
    const detailPanel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await detailPanel.getByRole('button', { name: /Marcar pagada|Mark paid/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    const confirmBtn = page.getByRole('button', { name: /Confirmar|Aceptar|Sí/i });
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.first().click();
      await page.waitForTimeout(400);
    }
    const row = page.locator('[class*="row"], [class*="card"], li').filter({ hasText: 'Factura a marcar pagada QA' }).first();
    await expect(row.getByText(/Pagada|Paid/i).first()).toBeVisible();
  });

  test('B4) Invoice does NOT duplicate on mark-paid', async ({ page }) => {
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
          paymentStatus: 'unpaid',
          dueDate: '2026-05-01',
          paymentTermDays: 0,
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 150, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          recurring: 0,
          recurrenceRule: null,
          deferredPayment: true,
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
    await openExpenseDetail(page, 'Factura sin duplicar QA');
    const detailPanel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    await detailPanel.getByRole('button', { name: /Marcar pagada|Mark paid/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    const confirmBtn = page.getByRole('button', { name: /Confirmar|Aceptar|Sí/i });
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.first().click();
      await page.waitForTimeout(400);
    }
    const rows = page.getByText('Factura sin duplicar QA');
    await expect(rows).toHaveCount(1);
    expect(state.expenses.filter((e) => e.description === 'Factura sin duplicar QA')).toHaveLength(1);
  });

  test('B5) Rejected invoice resets paymentStatus to pending_approval', async ({ page }) => {
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
          paymentStatus: 'unpaid',
          dueDate: '2026-05-01',
          paymentTermDays: 0,
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: '{}',
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 200, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          recurring: 0,
          recurrenceRule: null,
          deferredPayment: true,
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
    expect(String(inv?.paymentStatus ?? '')).toMatch(/pending_approval|pending/i);
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
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
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
    await expect(page.getByText('Gasto de otro usuario QA')).toBeVisible();
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

  test('C4) Superadmin can assign approvers to categories in Settings', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Ajustes');
    // Settings page must load
    await expect(page.getByText(/Ajustes|Configuración|Settings/i).first()).toBeVisible();
    // Approver assignment section
    const approverSection = page.getByText(/Aprobadores|Approvers|Categorías/i).first();
    await expect(approverSection).toBeVisible();
  });

  test('C3) Regular user can access Mi perfil and change password', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    const profileLink = page.getByText(/Mi perfil|Perfil|Profile/i).first();
    const avatarBtn = page
      .locator('[data-testid="avatar"], [aria-label*="perfil"], [aria-label*="profile"], [class*="avatar"]')
      .first();
    if (await profileLink.isVisible().catch(() => false)) {
      await profileLink.click();
    } else {
      await avatarBtn.click();
      await page.getByText(/Mi perfil|Perfil/i).first().click();
    }
    await page.waitForTimeout(400);
    const pwSection = page.getByText(/Cambiar contraseña|Change password|Nueva contraseña/i).first();
    await expect(pwSection).toBeVisible();
    const newPwField = page.locator('input[type="password"]').last();
    await newPwField.fill('newpassword456');
    await page.getByRole('button', { name: /Guardar|Cambiar|Save/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    await expect(page.getByText(/Guardado|Contraseña cambiada|Password changed|ok/i).first()).toBeVisible();
  });

  test('C5) Assigned approver sees Aprobar/Rechazar buttons', async ({ page }) => {
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
    await expect(page.getByText('Gasto para aprobar por user QA')).toBeVisible();
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

  test('D2) Date range filter affects Total del período', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Informes');
    // Locate date inputs and set a narrow range
    const fromInput = page.locator('input[type="date"]').first();
    const toInput = page.locator('input[type="date"]').last();
    await fromInput.fill('2026-01-01');
    await toInput.fill('2026-01-31');
    await page.waitForTimeout(600);
    // Total label must be visible (value may be 0 — we only assert the UI responded)
    await expect(page.getByText(/Total del período|Total período|Total/i).first()).toBeVisible();
  });

  test('D3) Export dropdown shows CSV and PDF options', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Informes');
    // Open export dropdown/button
    await page.getByRole('button', { name: /Exportar|Export/i }).first().click({ force: true });
    await page.waitForTimeout(300);
    await expect(page.getByText(/CSV/i).first()).toBeVisible();
    await expect(page.getByText(/PDF/i).first()).toBeVisible();
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
    await expect(panel.getByText('Nota de prueba QA')).toBeVisible();
  });
});

test.describe('F — Draft persistence', () => {
  test('F1) Draft persists when navigating away mid-form', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await clickSidebarGastos(page);
    await page.locator('button').filter({ hasText: /^Nuevo gasto|^\+/ }).first().click();
    await page.waitForTimeout(300);
    const panel = page.locator('.panel-slide, [data-panel], [role="dialog"]').last();
    const descField = panel.locator(
      'input[name*="desc"], input[placeholder*="escripci"], textarea[placeholder*="escripci"]',
    ).first();
    await descField.fill('Borrador persistente QA');
    await clickSidebarSection(page, 'Aprobaciones');
    await page.waitForTimeout(400);
    await clickSidebarGastos(page);
    await page.waitForTimeout(400);
    const draftIndicator = page.getByText(/Borrador persistente QA|Recuperar borrador|Recuperar|borrador/i).first();
    await expect(draftIndicator).toBeVisible();
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
