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

async function setupMockApi(
  page: Page,
  seed?: { expenses?: ExpenseRow[]; users?: User[]; settingsCategories?: any[] },
) {
  const state = {
    users: seed?.users ?? makeUsers(),
    expenses: seed?.expenses ?? [],
    departments: [
      { id: 'dept_ops', name: 'Operaciones', budget: 3000, archived: false, createdAt: Date.now() },
      { id: 'dept_fin', name: 'Finanzas', budget: 5000, archived: false, createdAt: Date.now() },
    ],
    tokens: new Map<string, { userId: string; role: string }>(),
    passwords: new Map<string, string>(Object.entries(PASSWORDS)),
    settings: {
      categories: seed?.settingsCategories ?? null as any[] | null,
    },
  };

  const authBase = 'https://solana-auth.onrender.com';

  await page.route(`${authBase}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let path = url.pathname;
    const method = req.method();
    const allH = await req.allHeaders();
    const auth = allH['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
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

    if (path.startsWith('/expenses') && method === 'GET') {
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
            commentsJson: JSON.stringify([]),
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
            commentsJson: JSON.stringify([]),
          };
      state.expenses.unshift(row);
      return json(200, { ok: true, expense: row });
    }

    const expenseIdMatch = path.match(/^\/expenses\/([^/]+)\/(receipt|approve|reject|mark-paid|comments)$/);
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
          pushAudit(e, { action: 'approved', by: session.userId, note: safeJson(req.postData()).note });
        }
        e.updatedAt = Date.now();
        return json(200, { ok: true, expense: e });
      }
      if (sub === 'reject') {
        const body = safeJson(req.postData());
        e.status = 'rejected';
        e.rejectionNote = String(body.note || '');
        e.approvalVotesJson = '{}';
        if (e.expenseType === 'invoice' && e.deferredPayment) {
          e.paymentStatus = 'pending_approval';
        }
        pushAudit(e, { action: 'rejected', by: session.userId, note: e.rejectionNote });
        e.updatedAt = Date.now();
        return json(200, { ok: true, expense: e });
      }
      if (sub === 'mark-paid') {
        const body = safeJson(req.postData());
        const pay = String(body.paidAt || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const ts = Date.parse(pay + 'T12:00:00');
        e.paymentStatus = 'paid';
        e.paidAt = Number.isFinite(ts) ? ts : Date.now();
        e.paidConfirmedBy = session.userId;
        pushAudit(e, { action: 'mark_paid', by: session.userId, note: pay });
        e.updatedAt = Date.now();
        return json(200, { ok: true, expense: e });
      }
      if (sub === 'comments') {
        const body = safeJson(req.postData());
        const text = String(body.text || '').trim();
        const list = parseComments(e);
        const cid = `c_${Date.now()}`;
        list.push({
          id: cid,
          userId: session.userId,
          text,
          createdAt: Date.now(),
        });
        e.commentsJson = JSON.stringify(list);
        e.updatedAt = Date.now();
        return json(200, { ok: true, expense: e });
      }
    }

    if (expensePutMatch && method === 'PUT') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = expensePutMatch[1];
      const e = state.expenses.find((x) => x.id === id);
      if (!e) return json(404, { error: 'Gasto no encontrado.' });
      const body = safeJson(req.postData());
      if (typeof body.description === 'string') e.description = body.description;
      if (typeof body.amount === 'number') {
        e.amount = body.amount;
        e.amountEUR = body.amount;
      }
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
      if (body.status === 'submitted') {
        e.status = 'submitted';
        e.rejectionNote = null;
        pushAudit(e, { action: 'resubmitted', by: session.userId });
      }
      e.updatedAt = Date.now();
      return json(200, { ok: true, expense: e });
    }

    return json(200, { ok: true });
  });

  return state;
}

async function loginAs(page: Page, email: string) {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(PASSWORDS[email.toLowerCase()] ?? '');
  await page.getByRole('button', { name: /iniciar sesi|sign in|entrar/i }).click();
  await expect(page.getByRole('heading', { name: /panel|dashboard/i })).toBeVisible();
}

async function createExpenseViaUi(page: Page, description: string, amount: string) {
  await page.getByText('Gastos', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  await wrap.getByPlaceholder('Concepto').fill(description);
  await wrap.getByPlaceholder('0.00').fill(amount);

  const categorySelect = wrap.locator('label:has-text("Categoría") + select').first();
  await categorySelect.selectOption({ index: 1 });
  const departmentSelect = wrap.locator('label:has-text("Departamento") + select').first();
  await departmentSelect.selectOption({ index: 1 });

  await page.getByRole('button', { name: 'Enviar gasto' }).click();
  await expect(page.getByText(description).first()).toBeVisible();
}

async function createBillViaUi(page: Page, name: string, amount: string) {
  await page.getByText('Facturas', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  await wrap.locator('input[placeholder="Concepto"]').first().fill(name);
  await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(name);
  await wrap.getByPlaceholder('0.00').fill(amount);

  const billCategory = wrap.locator('label:has-text("Categoría") + select').first();
  await billCategory.selectOption({ index: 1 });
  const billDepartment = wrap.locator('label:has-text("Departamento") + select').first();
  await billDepartment.selectOption({ index: 1 });

  await page.getByRole('button', { name: 'Enviar factura' }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

test.describe('Critical business flows', () => {
  test('1) Login + session handling survives reload', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await page.reload();
    await expect(page.getByRole('heading', { name: /panel|dashboard/i })).toBeVisible();
  });

  test('2) Create → approve → report expense flow', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');

    await createExpenseViaUi(page, 'Taxi aeropuerto QA', '120');

    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).first().click();

    await page.getByText('Informes').first().click();
    await expect(page.getByText(/Gasto total por categoría/i)).toBeVisible();
    await expect(page.getByText(/Taxi aeropuerto QA/i)).toBeHidden();
    await expect(page.getByText(/Equipment|Supplies|Marketing|Software|Otro/i).first()).toBeVisible();
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
    await expect(page.getByText('Offline sync expense')).toBeVisible();
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

    await page.getByText('Aprobaciones').first().click();
    await expect(page.getByText('Server bill import')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar' })).toHaveCount(0);
    await page.getByText('Server bill import').click();
    await expect(page.getByText('Solo lectura')).toBeVisible();
  });

  test('5) Bills lifecycle: create and approve', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');

    await createBillViaUi(page, 'Factura AWS QA', '260');

    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).first().click();

    await page.getByText('Facturas').first().click();
    await expect(page.getByText('Factura AWS QA')).toBeVisible();
    await expect(page.getByText(/Aprobado/i).first()).toBeVisible();
  });

  test('A1) Submit plain gasto — appears in Gastos as Pendiente', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    const desc = 'Gasto QA pendiente único';
    await page.getByPlaceholder('Concepto').first().fill(desc);
    await page.getByPlaceholder('0.00').first().fill('42,50');
    await page.locator('label:has-text("Categoría") + select').first().selectOption({ index: 2 });
    await page.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Enviar gasto' }).click();
    await expect(page.getByText(/Gasto registrado correctamente/ui)).toBeVisible();
    await expect(page.getByText(desc).first()).toBeVisible();
    await expect(page.getByText('PENDIENTE').first()).toBeVisible();
  });

  test('A2) Submit gasto — admin approves — status turns Aprobado', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await createExpenseViaUi(page, 'Flow A2 gasto', '88');

    await page.getByRole('button', { name: '×' }).nth(1).click().catch(() => {});
    await page.goto('/');
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).click();

    await expect(page.getByText('APROBADO')).toBeVisible();
    await expect(page.getByText('Seguimiento')).toBeVisible();
    await expect(page.getByText(/Aprobado/).first()).toBeVisible();
  });

  test('A3) Admin rejects with note — status turns Rechazado', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await createExpenseViaUi(page, 'Flow A3 rechazo', '50');
    await page.goto('/');
    await loginAs(page, 'admin@solana.test');

    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    const noteTa = page.locator('textarea.inp').first();
    await noteTa.fill('corto');
    await page.getByRole('button', { name: 'Rechazar' }).click();
    await expect(page.getByText(/Escribe un motivo de rechazo/i)).toBeVisible();

    const longNote = 'Motivo de prueba rechazo suficiente';
    await noteTa.fill(longNote);
    await page.getByRole('button', { name: 'Rechazar' }).click();
    await expect(page.getByText('RECHAZADO')).toBeVisible();
    await expect(page.getByText(longNote)).toBeVisible();
  });

  test('A4) User edits rejected gasto — all fields changeable — resubmits', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await createExpenseViaUi(page, 'Original A4', '40');
    await page.goto('/');
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.locator('textarea.inp').first().fill('Motivo de prueba rechazo');
    await page.getByRole('button', { name: 'Rechazar' }).click();

    await page.goto('/');
    await loginAs(page, 'user@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText('Original A4').click();
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.locator('input[placeholder="Concepto"]').first().fill('Editado A4');
    await page.locator('input[placeholder="0.00"]').first().fill('55');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();

    await expect(page.getByText('PENDIENTE')).toBeVisible();
  });

  test('A5) Approved gasto cannot be edited by regular user', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await createExpenseViaUi(page, 'Flow A5 aprobado', '33');
    await page.goto('/');
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).click();
    await expect(page.getByText('APROBADO')).toBeVisible();

    await page.goto('/');
    await loginAs(page, 'user@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText('Flow A5 aprobado').click();
    await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  });

  test('B1) Submit factura without A pagar — paymentStatus is paid on creation', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createBillViaUi(page, 'Factura B1 sin defer', '100');
    await page.getByText('Facturas').first().click();
    await page.getByText('Factura B1 sin defer').first().click();
    await expect(page.getByText('A pagar')).toHaveCount(0);
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).click();
    await expect(page.locator('.panel-slide').getByRole('button', { name: 'Marcar como pagada' })).toHaveCount(0);
  });

  test('B2) Submit factura with A pagar — payment tracking activates after approval', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Facturas').first().click();
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const vendor = 'Proveedor defer B2';
    const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
    await wrap.locator('input[placeholder="Concepto"]').first().fill('Fact B2 defer');
    await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(vendor);
    await wrap.getByPlaceholder('0.00').fill('200');
    await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
    await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
    await wrap.getByRole('checkbox', { name: /A pagar/i }).check();
    await wrap.locator('select.inp').filter({ has: wrap.locator('option[value="15"]') }).selectOption({ value: 'custom' });
    const today = new Date().toISOString().slice(0, 10);
    await wrap.locator('input[type="date"]').last().fill(today);

    await page.getByRole('button', { name: 'Enviar factura' }).click();
    await page.getByText('Facturas').first().click();
    await page.getByText(vendor).first().click();
    await expect(page.getByText('A pagar')).toHaveCount(0);

    await page.goto('/');
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).click();
    await expect(page.getByText('A pagar').first()).toBeVisible();

    await page.goto('/');
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText(vendor).first().click();
    await expect(page.getByRole('button', { name: 'Marcar como pagada' })).toBeVisible();
  });

  test('B3) Owner marks deferred factura as paid', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await page.getByText('Facturas').first().click();
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const v = 'Proveedor B3 pago';
    const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
    await wrap.locator('input[placeholder="Concepto"]').first().fill('Inv B3');
    await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(v);
    await wrap.getByPlaceholder('0.00').fill('150');
    await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
    await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
    await wrap.getByRole('checkbox', { name: /A pagar/i }).check();
    await wrap.locator('select.inp').filter({ has: wrap.locator('option[value="15"]') }).selectOption({ value: 'custom' });
    await wrap.locator('input[type="date"]').last().fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Enviar factura' }).click();

    await page.goto('/');
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).click();

    await page.goto('/');
    await loginAs(page, 'user@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText(v).first().click();
    await page.getByRole('button', { name: 'Marcar como pagada' }).first().click();
    await page.locator('.panel-slide input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
    await page.locator('.panel-slide').getByRole('button', { name: 'Confirmar' }).click();

    await expect(page.locator('.panel-slide').getByRole('button', { name: 'Marcar como pagada' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Marcar pagada', exact: false })).toHaveCount(0);
  });

  test('B4) Invoice does NOT duplicate on mark-paid', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await page.getByText('Facturas').first().click();
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const v = 'Dup test vendor';
    const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
    await wrap.locator('input[placeholder="Concepto"]').first().fill('Dup inv');
    await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(v);
    await wrap.getByPlaceholder('0.00').fill('77');
    await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
    await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
    await wrap.getByRole('checkbox', { name: /A pagar/i }).check();
    await wrap.locator('select.inp').filter({ has: wrap.locator('option[value="15"]') }).selectOption({ value: 'custom' });
    await wrap.locator('input[type="date"]').last().fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Enviar factura' }).click();

    await page.goto('/');
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).click();

    await page.goto('/');
    await loginAs(page, 'user@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText(v).first().click();
    await page.getByRole('button', { name: 'Marcar como pagada' }).first().click();
    await page.locator('.panel-slide').getByRole('button', { name: 'Confirmar' }).click();

    await expect(page.locator('.row-hover').filter({ hasText: v })).toHaveCount(1);
  });

  test('B5) Rejected invoice resets paymentStatus to pending_approval', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Facturas').first().click();
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const v = 'Inv B5 reject';
    const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
    await wrap.locator('input[placeholder="Concepto"]').first().fill(v);
    await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(v);
    await wrap.getByPlaceholder('0.00').fill('88');
    await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
    await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
    await wrap.getByRole('checkbox', { name: /A pagar/i }).check();
    await wrap.locator('select.inp').filter({ has: wrap.locator('option[value="15"]') }).selectOption({ value: 'custom' });
    await wrap.locator('input[type="date"]').last().fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Enviar factura' }).click();

    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).click();

    await expect(page.getByText('A pagar').first()).toBeVisible();

    await page.goto('/');
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText(v).first().click();
    await page.locator('.panel-slide textarea').first().fill('rechazo factura después de ok');
    await page.getByRole('button', { name: 'Rechazar' }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();

    await expect(page.getByText('RECHAZADO')).toBeVisible();
    await expect(page.getByText('A pagar')).toHaveCount(0);
  });

  test('C1) Regular user sees all expenses (transparency model)', async ({ page }) => {
    const e1: ExpenseRow = {
      id: 'c1_admin',
      userId: 'admin-1',
      date: '2026-03-01',
      description: 'Gasto admin only',
      amount: 90,
      amountEUR: 90,
      expenseType: 'expense',
      status: 'submitted',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: '{}',
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 90 }]),
      category: 'Software',
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: '[]',
      commentsJson: '[]',
      rejectionNote: null,
    };
    const e2: ExpenseRow = {
      id: 'c1_user',
      userId: 'user-1',
      date: '2026-03-02',
      description: 'Gasto usuario only',
      amount: 44,
      amountEUR: 44,
      expenseType: 'expense',
      status: 'approved',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      ownerId: 'user-1',
      paidByJson: JSON.stringify([{ userId: 'user-1', amount: 44 }]),
      category: 'Supplies',
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: '[]',
      commentsJson: '[]',
      rejectionNote: null,
    };
    await setupMockApi(page, { expenses: [e1, e2] });
    await loginAs(page, 'user@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await expect(page.getByText('Gasto admin only')).toBeVisible();
    await expect(page.getByText('Gasto usuario only')).toBeVisible();
  });

  test('C2) Regular user cannot see Aprobar/Rechazar buttons', async ({ page }) => {
    const pendingExpense: ExpenseRow = {
      id: 'c2_pen',
      userId: 'admin-1',
      date: '2026-04-03',
      description: 'C2 pendiente otros',
      amount: 111,
      amountEUR: 111,
      expenseType: 'expense',
      category: 'Software',
      status: 'submitted',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: '{}',
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 111 }]),
      splitMode: null,
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: '[]',
      commentsJson: '[]',
      rejectionNote: null,
    };

    await setupMockApi(page, { expenses: [pendingExpense] });
    await loginAs(page, 'user@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText('C2 pendiente otros').click();
    await expect(page.locator('.panel-slide').getByRole('button', { name: 'Aprobar' })).toHaveCount(0);
    await expect(page.locator('.panel-slide').getByRole('button', { name: 'Rechazar' })).toHaveCount(0);
    await page.getByText('Aprobaciones').first().click();
    await expect(page.getByText(/Solo los aprobadores asignados/i)).toBeVisible();
  });

  test('C3) Regular user can access Mi perfil and change password', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await page.getByText('Mi perfil').first().click();
    await expect(page.getByText('Mi perfil').nth(1)).toBeVisible();
    await page.getByText('Cambiar contraseña').first().click();
    await expect(page.locator('.panel-slide').getByPlaceholder(/actual|current/i)).toBeVisible();
    await expect(page.getByText('Miembros del equipo')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Guardar categorías' })).toHaveCount(0);
  });

  test('C4) Superadmin can assign approvers to categories in Settings', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Mi perfil').first().click();
    await page.locator('div.card', { hasText: 'Ajustes de aplicación' }).locator(':scope > div').first().click();
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')] as HTMLElement[];
      const guardar = btns.find((b) => b.textContent?.trim() === 'Guardar categorías');
      const column = guardar?.parentElement?.previousElementSibling as HTMLElement | undefined;
      const suppliesRow = column?.children[1];
      const userBtn = [...(suppliesRow?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'User QA');
      userBtn?.click();
    });
    await page.getByRole('button', { name: 'Guardar categorías' }).click();

    await expect(page.getByText('Categorías guardadas.')).toBeVisible();
  });

  test('C5) Assigned approver sees Aprobar/Rechazar buttons', async ({ page }) => {
    const seededCats = [
      { id: 'c2', name: 'Supplies', archived: false, approverIds: ['user-1'] },
      { id: 'c1', name: 'Equipment', archived: false, approverIds: [] },
      { id: 'c3', name: 'Marketing', archived: false, approverIds: [] },
      { id: 'c9', name: 'Otro', archived: false, approverIds: [] },
    ];
    await setupMockApi(page, { settingsCategories: seededCats });

    await loginAs(page, 'admin@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
    await wrap.getByPlaceholder('Concepto').fill('Gasto Supplies aprobador');
    await wrap.getByPlaceholder('0.00').fill('60');
    await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ label: /Supplies|Insumos|suministros/i });
    await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Enviar gasto' }).click();

    await page.goto('/');
    await loginAs(page, 'user@solana.test');
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).filter({ visible: true }).click();
    await expect(page.locator('.panel-slide').getByRole('button', { name: 'Aprobar' })).toBeVisible();
    await expect(page.locator('.panel-slide').getByRole('button', { name: 'Rechazar' })).toBeVisible();
  });

  test('D1) Informes visible to all roles', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await expect(page.getByText('Informes')).toBeVisible();
    await page.getByText('Informes').first().click();
    await expect(page.getByRole('heading', { name: 'Informes' })).toBeVisible();
    await expect(page.getByText('Total del período')).toBeVisible();
  });

  test('D2) Date range filter affects Total del período', async ({ page }) => {
    const jan: ExpenseRow = {
      id: 'dj',
      userId: 'admin-1',
      date: '2026-01-10',
      description: 'Enero row',
      amount: 400,
      amountEUR: 400,
      expenseType: 'expense',
      category: 'Software',
      status: 'approved',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 400 }]),
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: '[]',
      commentsJson: '[]',
      rejectionNote: null,
    };
    const mar: ExpenseRow = {
      id: 'dm',
      userId: 'admin-1',
      date: '2026-03-15',
      description: 'Marzo row',
      amount: 100,
      amountEUR: 100,
      expenseType: 'expense',
      category: 'Software',
      status: 'approved',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 100 }]),
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: '[]',
      commentsJson: '[]',
      rejectionNote: null,
    };
    await setupMockApi(page, { expenses: [jan, mar] });
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Informes').first().click();
    await page.getByRole('heading', { name: 'Informes' }).scrollIntoViewIfNeeded();
    const rangos = page.locator('.card').filter({ hasText: 'Desde' }).filter({ hasText: 'Hasta' }).first();
    await rangos.locator('input[type="date"]').nth(0).fill('2026-03-01');
    await rangos.locator('input[type="date"]').nth(1).fill('2026-03-31');

    const totalPeriodAmt = page.getByText('Total del período').locator('..').locator('span').last();
    await expect(totalPeriodAmt).toContainText('100');
    await rangos.locator('input[type="date"]').nth(0).fill('2026-01-01');
    await rangos.locator('input[type="date"]').nth(1).fill('2026-12-31');
    await expect(totalPeriodAmt).toContainText('500');
    await rangos.locator('input[type="date"]').nth(0).fill('2026-01-01');
    await rangos.locator('input[type="date"]').nth(1).fill('2026-01-31');
    await expect(totalPeriodAmt).toContainText('400');
    await rangos.locator('input[type="date"]').nth(0).fill('2026-03-01');
    await rangos.locator('input[type="date"]').nth(1).fill('2026-03-31');
    await expect(totalPeriodAmt).toContainText('100');
  });

  test('D3) Export dropdown shows CSV and PDF options', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Informes').first().click();
    const exportSelect = page.locator('select.inp').filter({ has: page.locator('option[value="csv"]') }).first();
    await expect(exportSelect.locator('option[value="csv"]')).toHaveText(/Exportar CSV/);
    await expect(exportSelect.locator('option[value="pdf"]')).toHaveText(/Exportar PDF/);
  });

  test('E1) Seguimiento shows submission event', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'user@solana.test');
    await createExpenseViaUi(page, 'Trail E1', '12');
    await page.getByText('Trail E1').click();
    await expect(page.getByText('Seguimiento')).toBeVisible();
    await expect(page.getByText(/Enviado/).first()).toBeVisible();
  });

  test('E2) Seguimiento shows approval event after approval', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Trail E2', '44');
    await page.getByText('Aprobaciones').first().click();
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByRole('button', { name: 'Aprobar' }).click();
    await expect(page.getByText(/Aprobado · Admin QA/).first()).toBeVisible();
  });

  test('E3) Note added via Añadir nota appears in Seguimiento', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Trail E3', '33');
    await page.getByText('Trail E3').click();
    const note = 'Nota selenium única XYZ';
    await page.locator('.panel-slide').getByPlaceholder(/nota/i).fill(note);
    await page.locator('.panel-slide').getByRole('button', { name: 'Añadir nota' }).click();
    await expect(page.getByText(note)).toBeVisible();
  });

  test('F1) Draft persists when navigating away mid-form', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await page.getByPlaceholder('Concepto').first().fill('PERSIST DRAFT X');
    await page.getByPlaceholder('0.00').first().fill('19,90');
    await page.waitForTimeout(700);

    await page.getByText('Panel', { exact: true }).first().click();
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await expect(page.getByPlaceholder('Concepto').first()).toHaveValue('PERSIST DRAFT X');
  });

  test('F2) Draft clears on successful submit', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await page.getByPlaceholder('Concepto').first().fill('SUBMIT CLEAR');
    await page.getByPlaceholder('0.00').first().fill('21');
    await page.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
    await page.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Enviar gasto' }).click();
    await expect(page.getByText('SUBMIT CLEAR').first()).toBeVisible();
    await page.getByRole('button', { name: '×' }).click().catch(() => {});

    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await expect(page.getByPlaceholder('Concepto').first()).toHaveValue('');
  });

  test('G1) Receipt with Cloudinary URL displays in AttachmentViewer', async ({ page }) => {
    const receiptUrl = 'https://mock-cloudinary.test/receipt_g1_test.jpg';
    const seededExpense: ExpenseRow = {
      id: 'exp_receipt_g1',
      userId: 'admin-1',
      date: '2026-05-01',
      description: 'Receipt display test',
      amount: 99,
      amountEUR: 99,
      currency: 'EUR',
      category: 'Software',
      status: 'submitted',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: '{}',
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 99, pct: 100 }]),
      splitMode: null,
      notes: '',
      receiptPath: receiptUrl,
      departmentId: 'dept_ops',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      auditTrailJson: JSON.stringify([{ action: 'submitted', by: 'admin-1', at: new Date().toISOString() }]),
      commentsJson: JSON.stringify([]),
      rejectionNote: null,
    };

    await page.route('https://mock-cloudinary.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
          'base64',
        ),
      }),
    );

    await setupMockApi(page, { expenses: [seededExpense] });
    await loginAs(page, 'admin@solana.test');

    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText('Receipt display test').first().click();

    const detail = page.locator('.panel-slide');
    await expect(detail).toBeVisible();

    const viewer = detail.locator('img[alt]').first();
    await expect(viewer).toBeVisible({ timeout: 5000 });
    const imgSrc = await viewer.getAttribute('src');
    expect(imgSrc).toBe(receiptUrl);
  });

  test('G2) Receipt upload via POST stores Cloudinary URL and displays', async ({ page }) => {
    const state = await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');

    await createExpenseViaUi(page, 'Upload receipt QA', '75');

    const exp = state.expenses.find((e) => e.description === 'Upload receipt QA');
    expect(exp).toBeTruthy();
    expect(exp!.receiptPath).toBeNull();

    const uploadB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const expId = exp!.id;

    const receiptResp = await page.evaluate(
      async ({ id, b64 }) => {
        const w = window as any;
        const api = w.API;
        if (!api) return { error: 'API object not found on window' };
        try {
          const res = await api.post(
            '/expenses/' + encodeURIComponent(id) + '/receipt',
            { b64, mediaType: 'image/png' },
          );
          return { receiptPath: res?.receiptPath };
        } catch (e: any) {
          return { error: e?.message || 'upload failed' };
        }
      },
      { id: expId, b64: uploadB64 },
    );

    expect(receiptResp.error).toBeUndefined();
    expect(receiptResp.receiptPath).toBeTruthy();
    expect(receiptResp.receiptPath).toMatch(/^https:\/\/mock-cloudinary\.test\//);

    expect(exp!.receiptPath).toBe(receiptResp.receiptPath);

    await page.waitForTimeout(300);

    await page.getByText('Gastos', { exact: true }).first().click();
    await page.getByText('Upload receipt QA').first().click();

    const detail = page.locator('.panel-slide');
    await expect(detail).toBeVisible();

    const imgBadge = detail.locator('span[title="Tiene adjunto"]');
    await expect(imgBadge).toBeVisible({ timeout: 5000 });

    const viewer = detail.locator('img[alt]').first();
    await expect(viewer).toBeVisible({ timeout: 5000 });
    const imgSrc = await viewer.getAttribute('src');
    expect(imgSrc).toMatch(/^https:\/\/mock-cloudinary\.test\//);
  });
});
