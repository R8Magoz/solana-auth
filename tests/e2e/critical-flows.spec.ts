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
type BillRow = Record<string, any>;

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

async function setupMockApi(
  page: Page,
  seed?: { expenses?: ExpenseRow[]; bills?: BillRow[]; users?: User[] },
) {
  const state = {
    users: seed?.users ?? makeUsers(),
    expenses: seed?.expenses ?? [],
    bills: seed?.bills ?? [],
    departments: [
      { id: 'dept_ops', name: 'Operaciones', budget: 3000, archived: false, createdAt: Date.now() },
      { id: 'dept_fin', name: 'Finanzas', budget: 5000, archived: false, createdAt: Date.now() },
    ],
    tokens: new Map<string, { userId: string; role: string }>(),
  };

  const authBase = 'https://solana-auth.onrender.com';

  await page.route(`${authBase}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const auth = req.headerValue('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const session = token ? state.tokens.get(token) : null;

    const json = (status: number, data: any) =>
      route.fulfill({
        status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });

    if (method === 'OPTIONS') return json(204, {});
    if (path === '/health' && method === 'GET') return json(200, { ok: true });

    if (path === '/auth/login' && method === 'POST') {
      const body = safeJson(req.postData());
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

    if (path === '/auth/team' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { ok: true, users: state.users.filter((u) => u.accountStatus === 'active') });
    }

    if (path === '/settings' && method === 'GET') return json(200, { ok: true, settings: {} });
    if (path === '/departments' && method === 'GET') return json(200, { ok: true, departments: state.departments });

    if (path === '/expenses' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { expenses: state.expenses });
    }

    if (path === '/expenses' && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const body = safeJson(req.postData());
      const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const approvers = [state.users.find((u) => u.role === 'admin')?.id || 'admin-1'];
      const row: ExpenseRow = {
        id,
        userId: session.userId,
        date: body.date || new Date().toISOString().slice(0, 10),
        description: body.description || 'Gasto',
        amount: Number(body.amount || 0),
        currency: 'EUR',
        amountEUR: Number(body.amount || 0),
        category: body.category || 'Equipment',
        notes: body.notes || '',
        status: 'pending',
        approversJson: JSON.stringify(approvers),
        approvalVotesJson: '{}',
        ownerId: body.ownerId || session.userId,
        paidByJson: JSON.stringify(body.paidBy || [{ userId: body.ownerId || session.userId, amount: Number(body.amount || 0), pct: 100 }]),
        splitMode: body.splitMode || null,
        departmentId: body.departmentId || 'dept_ops',
        receiptPath: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.expenses.unshift(row);
      return json(200, { ok: true, expense: row });
    }

    if (/^\/expenses\/[^/]+\/approve$/.test(path) && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = path.split('/')[2];
      const e = state.expenses.find((x) => x.id === id);
      if (!e) return json(404, { error: 'Gasto no encontrado.' });
      const votes = safeJson(e.approvalVotesJson || '{}');
      votes[session.userId] = 'approved';
      e.approvalVotesJson = JSON.stringify(votes);
      e.status = 'approved';
      e.updatedAt = Date.now();
      return json(200, { ok: true, expense: e });
    }

    if (path === '/bills' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { bills: state.bills });
    }

    if (path === '/bills' && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const body = safeJson(req.postData());
      const id = `bill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const approvers = [state.users.find((u) => u.role === 'admin')?.id || 'admin-1'];
      const row: BillRow = {
        id,
        userId: session.userId,
        vendor: body.vendor || 'Factura',
        amount: Number(body.amount || 0),
        amountEUR: Number(body.amount || 0),
        currency: 'EUR',
        category: body.category || 'Software',
        dueDate: body.dueDate || new Date().toISOString().slice(0, 10),
        status: 'pending',
        recurring: !!body.recurring,
        recurrenceRule: body.recurrenceRule || null,
        ownerId: body.ownerId || session.userId,
        paidByJson: JSON.stringify(body.paidBy || [{ userId: body.ownerId || session.userId, amount: Number(body.amount || 0), pct: 100 }]),
        splitMode: body.splitMode || null,
        notes: body.notes || '',
        approversJson: JSON.stringify(approvers),
        approvalVotesJson: '{}',
        receiptPath: null,
        departmentId: body.departmentId || 'dept_ops',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.bills.unshift(row);
      return json(200, { ok: true, bill: row });
    }

    if (/^\/bills\/[^/]+\/receipt$/.test(path) && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = path.split('/')[2];
      const b = state.bills.find((x) => x.id === id);
      if (!b) return json(404, { error: 'Factura no encontrada.' });
      const body = safeJson(req.postData());
      const isPdf = String(body.mediaType || '').includes('pdf');
      b.receiptPath = `https://mock-cloudinary.test/${id}${isPdf ? '.pdf' : '.jpg'}`;
      b.updatedAt = Date.now();
      return json(200, { ok: true, receiptPath: b.receiptPath });
    }

    if (/^\/bills\/[^/]+\/approve$/.test(path) && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = path.split('/')[2];
      const b = state.bills.find((x) => x.id === id);
      if (!b) return json(404, { error: 'Factura no encontrada.' });
      const votes = safeJson(b.approvalVotesJson || '{}');
      votes[session.userId] = 'approved';
      b.approvalVotesJson = JSON.stringify(votes);
      b.status = 'paid';
      b.updatedAt = Date.now();
      return json(200, { ok: true, bill: b });
    }

    return json(200, { ok: true });
  });

  return state;
}

async function loginAs(page: Page, email: string, password = 'Pass1234!') {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /iniciar sesi|sign in|entrar/i }).click();
  await expect(page.getByRole('heading', { name: /panel|dashboard/i })).toBeVisible();
}

async function createExpenseViaUi(page: Page, description: string, amount: string) {
  await page.getByText('Gastos').first().click();
  await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  await page.getByPlaceholder('Concepto').fill(description);
  await page.getByPlaceholder('0.00').fill(amount);

  const categorySelect = page.locator('label:has-text("Categoría") + select');
  await categorySelect.selectOption({ index: 1 });
  const departmentSelect = page.locator('label:has-text("Departamento") + select').first();
  await departmentSelect.selectOption({ index: 1 });

  await page.getByRole('button', { name: 'Enviar gasto' }).click();
  await expect(page.getByText(description)).toBeVisible();
}

async function createBillViaUi(page: Page, name: string, amount: string) {
  await page.getByText('Facturas').first().click();
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  await page.locator('input[placeholder="Concepto"]').first().fill(name);
  await page.locator('input[placeholder="0,00"]').fill(amount);

  const billCategory = page.locator('label:has-text("Categoría") + select').first();
  await billCategory.selectOption({ index: 1 });
  const billDepartment = page.locator('label:has-text("Departamento") + select').first();
  await billDepartment.selectOption({ index: 1 });

  await page.getByRole('button', { name: 'Enviar factura' }).click();
  await expect(page.getByText(name)).toBeVisible();
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
      status: 'pending',
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
});
