import { expect, test, type Page } from '@playwright/test';
import {
  assertPostRefetchStatus,
  attachMockApiRoutes,
  createMockApiState,
  defaultMockDepartments,
  deptApprovedSpend,
  expectRequestFired,
  getExpenseFromState,
  makeUsers,
  setupMockApi,
  waitForExpensesRefetch,
  waitForRequest,
  type ExpenseRow,
} from './helpers/mockApi';

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

function getDetailPanel(page: Page) {
  return page.getByTestId('detail-panel');
}

async function openSettingsViaUserMenu(page: Page) {
  // Settings is reached via the username card at the bottom of the sidebar (desktop E2E viewport).
  const userCard = page.locator('.dt-only button').filter({ hasText: /Admin QA|User QA|Manager/i }).first();
  await userCard.click();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Ajustes/i }).first()).toBeVisible({ timeout: 10_000 });
}

async function toggleGastosMultiFilter(page: Page, prefix: string, optionLabel: string) {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('button', { name: new RegExp(`^${esc}:`) }).first().click();
  await page.locator('label').filter({ hasText: optionLabel }).first().locator('input[type="checkbox"]').check();
  await page.getByRole('heading', { name: 'Gastos' }).click();
  await page.waitForTimeout(300);
}

async function filterExpenseListToInvoices(page: Page) {
  await page.getByText('Gastos', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await toggleGastosMultiFilter(page, 'Tipo', 'Facturas');
}

async function openNewInvoicePanel(page: Page) {
  await clickSidebarGastos(page);
  await page
    .locator('button')
    .filter({ hasText: /^(Nuevo gasto|Nueva factura|[+＋])/i })
    .first()
    .click();
  const panel = getDetailPanel(page);
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
  const panel = getDetailPanel(page);
  await panel.getByRole('button', { name: /Enviar gasto|Enviar factura/i }).first().click({ force: true });
}

async function createExpenseViaUi(page: Page, description: string, amount: string) {
  await clickSidebarGastos(page);
  await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  const wrap = getDetailPanel(page).locator('.expense-form-fields-wrap');
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
  const wrap = getDetailPanel(page).locator('.expense-form-fields-wrap');
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
  await getDetailPanel(page).waitFor({ state: 'visible' });
}

async function editExpenseDescriptionInPanel(page: Page, newDescription: string) {
  const panel = getDetailPanel(page);
  await panel.getByRole('button', { name: /Editar|Edit/i }).first().click({ force: true });
  await page.waitForTimeout(400);
  const wrap = panel.locator('.expense-form-fields-wrap');
  const descField = wrap.getByPlaceholder('Concepto').first();
  await descField.fill(newDescription);
  await panel.getByRole('button', { name: /Guardar|Enviar/i }).first().click({ force: true });
  const confirmBtn = page.getByRole('button', { name: 'Confirmar' });
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click();
  }
  await page.waitForTimeout(800);
}

async function rejectExpenseViaUi(page: Page, note = 'No procede QA') {
  await clickSidebarSection(page, 'Aprobaciones');
  await page.getByRole('button', { name: 'Revisar' }).first().click();
  const panel = getDetailPanel(page);
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
    await expect(page.getByRole('heading', { name: 'Aprobaciones' })).toBeVisible();
    await expect(page.getByText('Server bill import').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar' })).toHaveCount(0);
    await page.getByText('Server bill import').click();
    const panel = getDetailPanel(page);
    await expect(panel.getByRole('button', { name: /Aprobar/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Rechazar/i })).toHaveCount(0);
  });

  test('5) Bills lifecycle: create and approve', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');

    await createBillViaUi(page, 'Factura AWS QA', '260');

    await clickSidebarSection(page, 'Aprobaciones');
    await expect(page.getByRole('button', { name: 'Revisar' }).first()).toBeVisible();
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

  test('A1c) Gastos status filters match pending, approved, and rejected', async ({ page }) => {
    const seedExpenses: ExpenseRow[] = [
      {
        id: 'exp_flt_pend',
        userId: 'admin-1',
        ownerId: 'admin-1',
        date: '2026-04-01',
        description: 'Pendiente filter QA',
        amount: 100,
        amountEUR: 100,
        currency: 'EUR',
        category: 'Equipment',
        status: 'submitted',
        expenseType: 'expense',
        approversJson: JSON.stringify(['user-1']),
        approvalVotesJson: '{}',
        paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 100, pct: 100 }]),
        departmentId: 'dept_ops',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        auditTrailJson: '[]',
        commentsJson: '[]',
        traceCode: 'trace_flt_pend',
      },
      {
        id: 'exp_flt_appr',
        userId: 'admin-1',
        ownerId: 'admin-1',
        date: '2026-04-02',
        description: 'Aprobado filter QA',
        amount: 200,
        amountEUR: 200,
        currency: 'EUR',
        category: 'Equipment',
        status: 'approved',
        expenseType: 'expense',
        approversJson: JSON.stringify(['admin-1']),
        approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
        paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 200, pct: 100 }]),
        departmentId: 'dept_ops',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        auditTrailJson: '[]',
        commentsJson: '[]',
        traceCode: 'trace_flt_appr',
      },
      {
        id: 'exp_flt_rej',
        userId: 'admin-1',
        ownerId: 'admin-1',
        date: '2026-04-03',
        description: 'Rechazado filter QA',
        amount: 300,
        amountEUR: 300,
        currency: 'EUR',
        category: 'Equipment',
        status: 'rejected',
        expenseType: 'expense',
        approversJson: JSON.stringify(['admin-1']),
        approvalVotesJson: JSON.stringify({ 'admin-1': 'rejected' }),
        paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 300, pct: 100 }]),
        departmentId: 'dept_ops',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rejectionNote: 'No',
        auditTrailJson: '[]',
        commentsJson: '[]',
        traceCode: 'trace_flt_rej',
      },
      {
        id: 'exp_flt_vote_rej',
        userId: 'admin-1',
        ownerId: 'admin-1',
        date: '2026-04-04',
        description: 'Vote rejected filter QA',
        amount: 150,
        amountEUR: 150,
        currency: 'EUR',
        category: 'Equipment',
        status: 'submitted',
        expenseType: 'expense',
        approversJson: JSON.stringify(['admin-1']),
        approvalVotesJson: JSON.stringify({ 'admin-1': 'rejected' }),
        paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 150, pct: 100 }]),
        departmentId: 'dept_ops',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rejectionNote: 'Bad',
        auditTrailJson: '[]',
        commentsJson: '[]',
        traceCode: 'trace_flt_vote_rej',
      },
    ];
    await setupMockApi(page, { expenses: seedExpenses });
    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.setItem('sol-flt-status', JSON.stringify('submitted'));
    });
    await loginAs(page, 'admin@solana.test');
    await clickSidebarGastos(page);
    await expect(page.getByText('Pendiente filter QA').first()).toBeVisible();

    await toggleGastosMultiFilter(page, 'Estado', 'Pendiente');
    await expect(page.getByText('Pendiente filter QA').first()).toBeVisible();
    await expect(page.getByText('Aprobado filter QA')).toHaveCount(0);
    await expect(page.getByText('Rechazado filter QA')).toHaveCount(0);

    await page.getByRole('button', { name: /^Estado:/ }).first().click();
    await page.locator('label').filter({ hasText: /^Todos$/ }).first().locator('input[type="checkbox"]').check();
    await page.getByRole('heading', { name: 'Gastos' }).click();
    await page.waitForTimeout(300);

    await toggleGastosMultiFilter(page, 'Estado', 'Rechazado');
    await expect(page.getByText('Rechazado filter QA').first()).toBeVisible();
    await expect(page.getByText('Vote rejected filter QA').first()).toBeVisible();
    await expect(page.getByText('Pendiente filter QA')).toHaveCount(0);

    await page.getByRole('button', { name: /^Estado:/ }).first().click();
    await page.locator('label').filter({ hasText: /^Todos$/ }).first().locator('input[type="checkbox"]').check();
    await page.getByRole('heading', { name: 'Gastos' }).click();
    await page.waitForTimeout(300);

    await toggleGastosMultiFilter(page, 'Estado', 'Aprobado');
    await expect(page.getByText('Aprobado filter QA').first()).toBeVisible();
    await expect(page.getByText('Pendiente filter QA')).toHaveCount(0);

    await page.getByRole('button', { name: /^Estado:/ }).first().click();
    await page.locator('label').filter({ hasText: /^Todos$/ }).first().locator('input[type="checkbox"]').check();
    await page.getByRole('heading', { name: 'Gastos' }).click();
    await page.waitForTimeout(300);

    await toggleGastosMultiFilter(page, 'Estado', 'Pendiente');
    await toggleGastosMultiFilter(page, 'Estado', 'Rechazado');
    await expect(page.getByText('Pendiente filter QA').first()).toBeVisible();
    await expect(page.getByText('Rechazado filter QA').first()).toBeVisible();
    await expect(page.getByText('Vote rejected filter QA').first()).toBeVisible();
    await expect(page.getByText('Aprobado filter QA')).toHaveCount(0);
  });

  test('A1b) New expense stores traceCode and shows it in detail', async ({ page }) => {
    const state = await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Trace code QA', '250');
    const expense = state.expenses.find((e) => e.description === 'Trace code QA');
    expect(expense?.traceCode).toBeTruthy();
    expect(String(expense!.traceCode)).toMatch(/^\d{8}_\d{4}_250\.00EUR_[a-z0-9]{4}$/);
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Trace code QA');
    const panel = getDetailPanel(page);
    await expect(panel.getByText(String(expense!.traceCode)).first()).toBeVisible();
  });

  test('A2) Submit gasto — admin approves — status turns Aprobado', async ({ page }) => {
    const state = await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Silla ergonómica QA', '480');
    const expense = state.expenses.find((e) => e.description === 'Silla ergonómica QA');
    expect(expense?.id).toBeTruthy();
    await clickSidebarSection(page, 'Aprobaciones');
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    const panel = getDetailPanel(page);
    const tsBefore = Date.now();
    await panel.getByRole('button', { name: /Aprobar/i }).first().click({ force: true });
    await waitForRequest(state, 'POST', /\/expenses\/[^/]+\/approve$/);
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/approve$/);
    await assertPostRefetchStatus(state, String(expense!.id), 'approved', panel, /Aprobado|approved/i, { after: tsBefore });
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
    const panel = getDetailPanel(page);
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
    const state = await setupMockApi(page, { expenses: [autoApproved] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Auto approved reconsider net QA');
    const panel = getDetailPanel(page);
    const tsBefore = Date.now();
    await panel.getByRole('button', { name: /Reconsiderar/i }).click();
    await waitForRequest(state, 'POST', /\/expenses\/exp_auto_appr_recon_net\/reconsider$/);
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/reconsider$/);
    await assertPostRefetchStatus(
      state,
      'exp_auto_appr_recon_net',
      'submitted',
      panel,
      /Pendiente|Enviado|pending/i,
      { after: tsBefore },
    );
    await expect(panel.getByTestId('detail-status-badge')).toHaveAttribute('data-status', 'pending');
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Rechazar$/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Reconsiderar/i })).toHaveCount(0);
  });

  test('A2f) Reconsider then reject on auto-approved own-expense stays rejected', async ({ page }) => {
    const autoApproved: ExpenseRow = {
      id: 'exp_auto_appr_rej_ui',
      userId: 'admin-1',
      date: '2026-04-01',
      description: 'Auto approved reject after reconsider QA',
      amount: 155,
      amountEUR: 155,
      currency: 'EUR',
      category: 'Equipment',
      status: 'approved',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 155, pct: 100 }]),
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
    const state = await setupMockApi(page, { expenses: [autoApproved] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Auto approved reject after reconsider QA');
    const panel = getDetailPanel(page);
    await panel.getByRole('button', { name: /Reconsiderar/i }).click();
    await waitForRequest(state, 'POST', /\/expenses\/exp_auto_appr_rej_ui\/reconsider$/);
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/reconsider$/);
    await expect(panel.getByRole('button', { name: /^Rechazar$/i })).toBeVisible({ timeout: 5000 });
    const tsReject = Date.now();
    await panel.locator('textarea').fill('Motivo de rechazo QA suficientemente largo');
    await panel.getByRole('button', { name: /^Rechazar$/i }).click();
    await waitForRequest(state, 'POST', /\/expenses\/exp_auto_appr_rej_ui\/reject$/, { after: tsReject });
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/reject$/);
    await assertPostRefetchStatus(state, 'exp_auto_appr_rej_ui', 'rejected', panel, /Rechazado|rejected/i, { after: tsReject });
    await expect(panel.getByRole('button', { name: /Reconsiderar/i })).toHaveCount(0);
    await expect(panel.getByText(/Motivo de rechazo QA suficientemente largo/i)).toBeVisible();
  });

  test('A2g) Reconsider then approve on auto-approved own-expense stays approved', async ({ page }) => {
    const autoApproved: ExpenseRow = {
      id: 'exp_auto_appr_appr_ui',
      userId: 'admin-1',
      date: '2026-04-01',
      description: 'Reconsider then approve QA',
      amount: 165,
      amountEUR: 165,
      currency: 'EUR',
      category: 'Equipment',
      status: 'approved',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      ownerId: 'admin-1',
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 165, pct: 100 }]),
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
    const state = await setupMockApi(page, { expenses: [autoApproved] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Reconsider then approve QA');
    const panel = getDetailPanel(page);
    await panel.getByRole('button', { name: /Reconsiderar/i }).click();
    await waitForRequest(state, 'POST', /\/expenses\/exp_auto_appr_appr_ui\/reconsider$/);
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/reconsider$/);
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toBeVisible({ timeout: 5000 });
    const tsApprove = Date.now();
    await panel.getByRole('button', { name: /^Aprobar$/i }).click();
    await waitForRequest(state, 'POST', /\/expenses\/exp_auto_appr_appr_ui\/approve$/, { after: tsApprove });
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/approve$/);
    await assertPostRefetchStatus(state, 'exp_auto_appr_appr_ui', 'approved', panel, /Aprobado|approved/i, { after: tsApprove });
    await expect(panel.getByRole('button', { name: /Reconsiderar/i })).toBeVisible({ timeout: 5000 });
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toHaveCount(0);
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
    const state = await setupMockApi(page, { expenses: [approved] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Reconsider from approved QA');
    const panel = getDetailPanel(page);
    const tsBefore = Date.now();
    await panel.getByRole('button', { name: /Reconsiderar/i }).click();
    await waitForRequest(state, 'POST', /\/expenses\/exp_recon_appr_1\/reconsider$/);
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/reconsider$/);
    await assertPostRefetchStatus(state, 'exp_recon_appr_1', 'submitted', panel, /Pendiente|Enviado|pending/i, { after: tsBefore });
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Rechazar$/i })).toBeVisible();
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
    const state = await setupMockApi(page, { expenses: [rejected] });
    await loginAs(page, 'admin@solana.test');
    await openExpenseDetail(page, 'Reconsider from rejected QA');
    const panel = getDetailPanel(page);
    const tsBefore = Date.now();
    await panel.getByRole('button', { name: /Reabrir/i }).click();
    await waitForRequest(state, 'POST', /\/expenses\/exp_recon_rej_1\/reconsider$/);
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/reconsider$/);
    await assertPostRefetchStatus(state, 'exp_recon_rej_1', 'submitted', panel, /Pendiente|Enviado|pending/i, { after: tsBefore });
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Rechazar$/i })).toBeVisible();
  });

  test('A3) Admin rejects with note — status turns Rechazado', async ({ page }) => {
    const state = await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Gasto rechazable QA', '99');
    const expense = state.expenses.find((e) => e.description === 'Gasto rechazable QA');
    expect(expense?.id).toBeTruthy();
    const tsReject = Date.now();
    await rejectExpenseViaUi(page, 'No procede QA rechazo');
    await waitForRequest(state, 'POST', /\/expenses\/[^/]+\/reject$/, { after: tsReject });
    expectRequestFired(state, 'POST', /\/expenses\/[^/]+\/reject$/);
    await waitForExpensesRefetch(state, { after: tsReject });
    expect(getExpenseFromState(state, String(expense!.id))?.status).toBe('rejected');
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
    const panel = getDetailPanel(page);
    await panel.getByRole('button', { name: /Editar|Edit/i }).first().click({ force: true });
    await page.waitForTimeout(400);
    const descField = panel.locator('input[name*="desc"], input[placeholder*="escripci"], textarea').first();
    await expect(descField).toBeEnabled();
    await descField.fill('Gasto editado QA');
    await panel.getByRole('button', { name: /Enviar|Guardar|Reenviar/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    await expect(page.getByText('Gasto editado QA').first()).toBeVisible();
  });

  test('A6a) Multi-approver edit: editor approver auto-votes, stays pending for others', async ({ page }) => {
    const mgrId = 'mgr-1';
    const state = await setupMockApi(page, {
      users: [
        ...makeUsers(),
        {
          id: mgrId,
          email: 'mgr@solana.test',
          name: 'Manager QA',
          role: 'user',
          accountStatus: 'active',
          approvalStatus: 'approved',
          color: '#888888',
        },
      ],
      departmentApprovers: { dept_ops: ['admin-1', mgrId] },
      departments: [
        { id: 'dept_ops', name: 'Operaciones', budget: 3000, archived: false, createdAt: Date.now(), approverIds: ['admin-1', mgrId] },
        { id: 'dept_fin', name: 'Finanzas', budget: 5000, archived: false, createdAt: Date.now(), approverIds: ['admin-1'] },
        { id: 'dept_estrategia', name: 'Estrategia', budget: 4000, archived: false, createdAt: Date.now(), approverIds: ['admin-1'] },
      ],
      expenses: [
        {
          id: 'exp_multi_edit',
          userId: 'user-1',
          ownerId: 'user-1',
          date: '2026-04-10',
          description: 'Multi approver edit QA',
          amount: 400,
          amountEUR: 400,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1', mgrId]),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved', [mgrId]: 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'user-1', amount: 400, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
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
    await loginAs(page, 'admin@solana.test');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Multi approver edit QA');
    await editExpenseDescriptionInPanel(page, 'Multi approver edited QA');
    const exp = getExpenseFromState(state, 'exp_multi_edit');
    expect(exp?.status).toBe('submitted');
    const votes = JSON.parse(String(exp?.approvalVotesJson || '{}')) as Record<string, string>;
    expect(votes['admin-1']).toBe('approved');
    expect(votes[mgrId]).toBeUndefined();
    await expect(getDetailPanel(page).getByTestId('detail-status-badge')).toHaveAttribute('data-status', 'pending');
  });

  test('A6b) Sole approver edit re-approves immediately', async ({ page }) => {
    const state = await setupMockApi(page, {
      expenses: [
        {
          id: 'exp_sole_edit',
          userId: 'admin-1',
          ownerId: 'admin-1',
          date: '2026-04-11',
          description: 'Sole approver edit QA',
          amount: 220,
          amountEUR: 220,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 220, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
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
    await loginAs(page, 'admin@solana.test');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Sole approver edit QA');
    await editExpenseDescriptionInPanel(page, 'Sole approver edited QA');
    const exp = getExpenseFromState(state, 'exp_sole_edit');
    expect(exp?.status).toBe('approved');
    await expect(getDetailPanel(page).getByTestId('detail-status-badge')).toHaveAttribute('data-status', 'approved');
  });

  test('A6c) Owner non-approver edits approved item → back to pending', async ({ page }) => {
    const state = await setupMockApi(page, {
      expenses: [
        {
          id: 'exp_owner_edit',
          userId: 'user-1',
          ownerId: 'user-1',
          date: '2026-04-10',
          description: 'Owner edit approved QA',
          amount: 100,
          amountEUR: 100,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'user-1', amount: 100, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
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
    await loginAs(page, 'user@solana.test');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Owner edit approved QA');
    await editExpenseDescriptionInPanel(page, 'Owner edited approved QA');
    const exp = getExpenseFromState(state, 'exp_owner_edit');
    expect(exp?.status).toBe('submitted');
    expect(JSON.parse(String(exp?.approvalVotesJson || '{}'))).toEqual({});
    await expect(getDetailPanel(page).getByTestId('detail-status-badge')).toHaveAttribute('data-status', 'pending');
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
    const panel = getDetailPanel(page);
    await expect(panel.getByText(/Vencimiento/i).first()).toBeVisible();
    await expect(panel.getByText(/Estado de pago/i)).toHaveCount(0);
    await expect(panel.getByText(/Condiciones de pago/i)).toHaveCount(0);
  });

  test('B3b) Effective date filter uses dueDate for invoices', async ({ page }) => {
    const state = createMockApiState({
      expenses: [
        {
          id: 'exp_inv_sep',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-07-10',
          description: 'Factura septiembre QA',
          vendor: 'Proveedor Sept QA',
          amount: 220,
          amountEUR: 220,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'invoice',
          dueDate: '2026-09-05',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 220, pct: 100 }]),
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
        {
          id: 'exp_july_base',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-07-12',
          description: 'Gasto julio QA',
          amount: 80,
          amountEUR: 80,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 80, pct: 100 }]),
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

    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2026-09-01');
    await dateInputs.nth(1).fill('2026-09-30');
    await page.waitForTimeout(300);
    await expect(page.getByText('Proveedor Sept QA').first()).toBeVisible();
    await expect(page.getByText('Gasto julio QA')).toHaveCount(0);

    await dateInputs.nth(0).fill('2026-07-01');
    await dateInputs.nth(1).fill('2026-07-31');
    await page.waitForTimeout(300);
    await expect(page.getByText('Gasto julio QA').first()).toBeVisible();
    await expect(page.getByText('Proveedor Sept QA')).toHaveCount(0);
  });

  test('B2) Submit factura — approve — shows as approved invoice', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createBillViaUi(page, 'Factura NET-30 QA', '500');
    await clickSidebarSection(page, 'Aprobaciones');
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    const panel = getDetailPanel(page);
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
    const detailPanel = getDetailPanel(page);
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
    const panel = getDetailPanel(page);
    await expect(panel.getByRole('button', { name: /Aprobar/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Rechazar/i })).toHaveCount(0);
  });

  test('C6) Admin who is not a department approver cannot act on that expense', async ({ page }) => {
    await setupMockApi(page, {
      departmentApprovers: { dept_branding: ['user-1'] },
      departments: [
        { id: 'dept_branding', name: 'Branding', budget: 10000, archived: false, createdAt: Date.now(), approverIds: ['user-1'] },
        ...defaultMockDepartments(),
      ],
      expenses: [
        {
          id: 'exp_branding_gate',
          userId: 'user-1',
          ownerId: 'user-1',
          submittedBy: 'user-1',
          date: '2026-04-16',
          description: 'Gasto Branding solo Anna QA',
          amount: 90,
          amountEUR: 90,
          currency: 'EUR',
          category: 'Marketing',
          status: 'submitted',
          approversJson: JSON.stringify(['user-1']),
          approvalVotesJson: '{}',
          paidByJson: JSON.stringify([{ userId: 'user-1', amount: 90, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_branding',
          expenseType: 'expense',
          auditTrailJson: JSON.stringify([]),
          commentsJson: JSON.stringify([]),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paymentStatus: 'na',
          deferredPayment: false,
          paymentTermDays: 0,
          rejectionNote: null,
        },
      ],
    });
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Aprobaciones');
    await expect(page.getByText('Gasto Branding solo Anna QA').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar' })).toHaveCount(0);
    await openExpenseDetail(page, 'Gasto Branding solo Anna QA');
    const panel = getDetailPanel(page);
    await expect(panel.getByRole('button', { name: /^Aprobar$/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Rechazar$/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Reconsiderar/i })).toHaveCount(0);
  });

  test('C4) Admin can assign approvers to departments in Settings', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await openSettingsViaUserMenu(page);
    await page.getByText('Ajustes de aplicación').first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Departamentos').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Asigna quién puede aprobar gastos de cada departamento/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Estrategia').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Guardar aprobadores' })).toBeVisible({ timeout: 10000 });
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
    const panel = getDetailPanel(page);
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

  test('D4) Chart empty state shows disclaimer and no year dropdown', async ({ page }) => {
    await setupMockApi(page, { expenses: [] });
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Informes');
    await expect(page.getByTestId('chart-empty-disclaimer')).toBeVisible();
    await expect(page.getByTestId('chart-empty-disclaimer')).toContainText(/Aún no hay gastos registrados/i);
    await expect(page.getByTestId('chart-year-select')).toHaveCount(0);
    await expect(page.getByTestId('chart-year-label')).toHaveCount(0);
    await expect(page.locator('.monthly-chart-wrap svg')).toHaveCount(0);
  });

  test('D5) Single year of data shows year label without dropdown', async ({ page }) => {
    await setupMockApi(page, {
      expenses: [
        {
          id: 'exp_y2026_a',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-03-10',
          description: 'Gasto 2026 QA',
          amount: 100,
          amountEUR: 100,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 100, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Informes');
    await expect(page.getByTestId('chart-empty-disclaimer')).toHaveCount(0);
    await expect(page.getByTestId('chart-year-select')).toHaveCount(0);
    await expect(page.getByTestId('chart-year-label')).toHaveText('2026');
    await expect(page.locator('.monthly-chart-wrap svg text').filter({ hasText: /^ene$/i })).toBeVisible();
    await expect(page.locator('.monthly-chart-wrap svg text').filter({ hasText: /^dic$/i })).toBeVisible();
    await expect(page.locator('.monthly-chart-wrap svg text').filter({ hasText: /No hay datos/i })).toHaveCount(0);
    // Desktop keeps the value label on months with data
    await expect(page.locator('.monthly-chart-wrap svg text').filter({ hasText: /100/ })).toBeVisible();
    const svgBox = await page.locator('.monthly-chart-wrap svg').boundingBox();
    const wrapBox = await page.locator('.monthly-chart-wrap').boundingBox();
    expect(svgBox && wrapBox).toBeTruthy();
    expect(Math.abs((svgBox?.width || 0) - (wrapBox?.width || 0))).toBeLessThan(4);
  });

  test('D5b) Mobile chart: abbreviated months, no value labels, no No hay datos', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setupMockApi(page, {
      expenses: [
        {
          id: 'exp_y2026_m',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-03-10',
          description: 'Gasto mobile QA',
          amount: 100,
          amountEUR: 100,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 100, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'inv_y2026_m',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-03-12',
          description: 'Factura mobile QA',
          amount: 50,
          amountEUR: 50,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'invoice',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 50, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    await loginAs(page, 'admin@solana.test');
    // Mobile uses bottom nav (sidebar is .dt-only)
    await page.locator('.mob-nav-item').filter({ hasText: 'Informes' }).click();
    await expect(page.getByRole('heading', { name: /Informes/i })).toBeVisible();
    const chart = page.locator('.monthly-chart-wrap');
    await expect(chart.locator('svg')).toBeVisible();
    await expect(chart.locator('svg text').filter({ hasText: /^ene$/i })).toBeVisible();
    await expect(chart.locator('svg text').filter({ hasText: /^dic$/i })).toBeVisible();
    await expect(chart.locator('svg text').filter({ hasText: /No hay datos/i })).toHaveCount(0);
    // Value labels hidden on mobile — amounts only via tooltip
    await expect(chart.locator('svg text').filter({ hasText: /€/ })).toHaveCount(0);
    const svgBox = await chart.locator('svg').boundingBox();
    const wrapBox = await chart.boundingBox();
    expect(svgBox && wrapBox).toBeTruthy();
    expect(Math.abs((svgBox?.width || 0) - (wrapBox?.width || 0))).toBeLessThan(4);
    // Tap a bar to show tooltip with Gastos + Facturas
    const barHit = chart.locator('svg rect[fill="transparent"]').first();
    await barHit.click({ force: true });
    await expect(page.locator('.chart-tooltip')).toBeVisible();
    await expect(page.locator('.chart-tooltip')).toContainText(/Gastos/i);
    await expect(page.locator('.chart-tooltip')).toContainText(/Facturas/i);
  });

  test('D5c) Mobile hardware Back closes expense detail overlay without leaving app', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setupMockApi(page, {
      expenses: [
        {
          id: 'exp_back_1',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-03-10',
          description: 'Back nav QA',
          amount: 90,
          amountEUR: 90,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 90, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    await loginAs(page, 'admin@solana.test');
    await page.locator('.mob-nav-item').filter({ hasText: 'Gastos' }).click();
    await expect(page.getByRole('heading', { name: /Gastos/i })).toBeVisible();
    await page.getByText('Back nav QA').first().click();
    const mobOverlay = page.locator('.mob-only.panel-slide').filter({ has: page.getByRole('button', { name: 'Volver' }) });
    await expect(mobOverlay).toBeVisible();
    await expect(mobOverlay.getByText(/Back nav QA|Detalle/i).first()).toBeVisible();
    // Hardware/gesture Back → popstate
    await page.goBack();
    await expect(mobOverlay).toHaveCount(0);
    // Still in the app on Gastos
    await expect(page.getByRole('heading', { name: /Gastos/i })).toBeVisible();
    await expect(page.getByText('Back nav QA').first()).toBeVisible();
    // Re-open and close via on-screen ← — history stays in sync (no stale reopen on next Back)
    await page.getByText('Back nav QA').first().click();
    await expect(mobOverlay).toBeVisible();
    await mobOverlay.getByRole('button', { name: 'Volver' }).click();
    await expect(mobOverlay).toHaveCount(0);
    await page.goBack();
    await expect(mobOverlay).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Panel|Dashboard|Gastos/i }).first()).toBeVisible();
  });

  test('D7) Department gastado counts only approved expenses and invoices', async ({ page }) => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dateInMonth = `${ym}-15`;
    const base = {
      userId: 'admin-1',
      ownerId: 'admin-1',
      submittedBy: 'admin-1',
      currency: 'EUR',
      category: 'Software',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 100, pct: 100 }]),
      splitMode: null,
      notes: '',
      receiptPath: null,
      departmentId: 'dept_ops',
      auditTrailJson: '[]',
      commentsJson: '[]',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setupMockApi(page, {
      expenses: [
        {
          ...base,
          id: 'exp_pending_dept',
          status: 'submitted',
          expenseType: 'expense',
          description: 'Pending dept QA',
          amount: 500,
          amountEUR: 500,
          date: dateInMonth,
          approvalVotesJson: '{}',
        },
        {
          ...base,
          id: 'exp_approved_dept',
          status: 'approved',
          expenseType: 'expense',
          description: 'Approved dept QA',
          amount: 100,
          amountEUR: 100,
          date: dateInMonth,
        },
        {
          ...base,
          id: 'inv_approved_dept',
          status: 'approved',
          expenseType: 'invoice',
          description: 'Approved invoice dept QA',
          amount: 50,
          amountEUR: 50,
          date: dateInMonth,
          dueDate: dateInMonth,
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 50, pct: 100 }]),
        },
        {
          ...base,
          id: 'exp_rejected_dept',
          status: 'rejected',
          expenseType: 'expense',
          description: 'Rejected dept QA',
          amount: 200,
          amountEUR: 200,
          date: dateInMonth,
          rejectionNote: 'No',
        },
      ],
    });
    await loginAs(page, 'admin@solana.test');
    await expect(page.getByText('Presupuestos por departamento', { exact: true })).toBeVisible();
    const opsRow = page.locator('.card').filter({ hasText: 'Operaciones' }).first();
    await expect(opsRow).toBeVisible();
    await expect(opsRow.getByText(/150,00\s*€/)).toBeVisible();
    await expect(opsRow.getByText(/750,00\s*€/)).toHaveCount(0);
    await expect(opsRow.getByText(/650,00\s*€/)).toHaveCount(0);
  });

  test('D6) Multi-year data shows dropdown defaulting to latest year', async ({ page }) => {
    await setupMockApi(page, {
      expenses: [
        {
          id: 'exp_y2025',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2025-06-01',
          description: 'Gasto 2025 QA',
          amount: 80,
          amountEUR: 80,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 80, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'exp_y2026',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2026-02-15',
          description: 'Gasto 2026 multi QA',
          amount: 150,
          amountEUR: 150,
          currency: 'EUR',
          category: 'Marketing',
          status: 'approved',
          expenseType: 'expense',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 150, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'inv_y2025',
          userId: 'admin-1',
          ownerId: 'admin-1',
          submittedBy: 'admin-1',
          date: '2025-01-10',
          dueDate: '2025-11-20',
          description: 'Factura 2025 QA',
          vendor: 'Vendor 2025',
          amount: 200,
          amountEUR: 200,
          currency: 'EUR',
          category: 'Software',
          status: 'approved',
          expenseType: 'invoice',
          approversJson: JSON.stringify(['admin-1']),
          approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
          paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 200, pct: 100 }]),
          splitMode: null,
          notes: '',
          receiptPath: null,
          departmentId: 'dept_ops',
          auditTrailJson: '[]',
          commentsJson: '[]',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    await loginAs(page, 'admin@solana.test');
    await clickSidebarSection(page, 'Informes');
    const yearSelect = page.getByTestId('chart-year-select');
    await expect(yearSelect).toBeVisible();
    await expect(yearSelect).toHaveValue('2026');
    await expect(yearSelect.locator('option')).toHaveCount(2);
    await yearSelect.selectOption('2025');
    await expect(yearSelect).toHaveValue('2025');
    await expect(page.locator('.monthly-chart-wrap svg')).toBeVisible();
  });
});

test.describe('E — Seguimiento (Audit trail)', () => {
  test('E1) Seguimiento shows submission event', async ({ page }) => {
    await setupMockApi(page);
    await loginAs(page, 'admin@solana.test');
    await createExpenseViaUi(page, 'Gasto seguimiento QA', '80');
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Gasto seguimiento QA');
    const panel = getDetailPanel(page);
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
    const approvePanel = getDetailPanel(page);
    await approvePanel.getByRole('button', { name: /Aprobar/i }).first().click({ force: true });
    await page.waitForTimeout(600);
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Gasto aprobado trail QA');
    const detailPanel = getDetailPanel(page);
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
    const panel = getDetailPanel(page);
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

test.describe('G — Recurrence materialize & próximas facturas', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const recurrence = require('../../server/recurrence.js');

  function addDaysISO(iso: string, days: number): string {
    const p = iso.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function baseExpense(overrides: Partial<ExpenseRow>): ExpenseRow {
    const now = Date.now();
    return {
      id: 'exp_base',
      userId: 'admin-1',
      ownerId: 'admin-1',
      date: recurrence.todayISO(),
      description: 'Base',
      amount: 50,
      amountEUR: 50,
      currency: 'EUR',
      category: 'Software',
      status: 'approved',
      expenseType: 'expense',
      approversJson: JSON.stringify(['admin-1']),
      approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
      paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 50, pct: 100 }]),
      departmentId: 'dept_ops',
      recurring: 0,
      receiptPath: null,
      createdAt: now,
      updatedAt: now,
      paymentStatus: 'na',
      deferredPayment: false,
      paymentTermDays: 0,
      rejectionNote: null,
      auditTrailJson: '[]',
      commentsJson: '[]',
      traceCode: 'trace',
      ...overrides,
    };
  }

  test('G1) Due occurrence auto-materializes as approved and counts toward budget', async ({ page }) => {
    const today = recurrence.todayISO();
    const anchorDate = addDaysISO(today, -7);
    const anchor = baseExpense({
      id: 'exp_rec_anchor_g1',
      description: 'Recurring weekly materialize QA',
      date: anchorDate,
      amount: 80,
      amountEUR: 80,
      recurring: 1,
      recurrenceRule: 'weekly',
      recurrenceSeriesId: 'exp_rec_anchor_g1',
      recurrenceAnchorDate: anchorDate,
    });
    const state = await setupMockApi(page, { expenses: [anchor] });
    await loginAs(page, 'admin@solana.test');
    await waitForExpensesRefetch(state);
    const children = state.expenses.filter(
      (e) => e.recurrenceSeriesId === 'exp_rec_anchor_g1' && e.id !== 'exp_rec_anchor_g1',
    );
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((e) => e.status === 'approved')).toBe(true);
    expect(deptApprovedSpend(state, 'dept_ops')).toBe(160);
  });

  test('G2) Projected recurring invoice appears in Próximas facturas', async ({ page }) => {
    const today = recurrence.todayISO();
    const windowEnd = addDaysISO(today, 15);
    let anchorDue = addDaysISO(today, -20);
    let futureDates = recurrence.enumerateOccurrenceDates(anchorDue, 'weekly', {
      rangeStart: today,
      rangeEnd: windowEnd,
    });
    if (futureDates.length === 0) {
      anchorDue = addDaysISO(today, -13);
      futureDates = recurrence.enumerateOccurrenceDates(anchorDue, 'weekly', {
        rangeStart: today,
        rangeEnd: windowEnd,
      });
    }
    expect(futureDates.length).toBeGreaterThan(0);
    const anchor = baseExpense({
      id: 'exp_inv_proj_g2',
      expenseType: 'invoice',
      description: 'Proveedor recurrente QA',
      vendor: 'Proveedor recurrente QA',
      date: anchorDue,
      dueDate: anchorDue,
      recurring: 1,
      recurrenceRule: 'weekly',
      recurrenceSeriesId: 'exp_inv_proj_g2',
      recurrenceAnchorDate: anchorDue,
    });
    await setupMockApi(page, { expenses: [anchor] });
    await loginAs(page, 'admin@solana.test');
    await expect(page.getByText('Proveedor recurrente QA').first()).toBeVisible();
    await expect(page.getByText(/previsto/i).first()).toBeVisible();
  });

  test('G3) Stop recurrence from materialized child keeps past and removes future projections', async ({ page }) => {
    const today = recurrence.todayISO();
    const anchorDue = addDaysISO(today, -60);
    const childDue = addDaysISO(today, -30);
    const anchor = baseExpense({
      id: 'exp_stop_anchor_g3',
      expenseType: 'invoice',
      description: 'Serie stop child QA',
      vendor: 'Serie stop child QA',
      date: anchorDue,
      dueDate: anchorDue,
      recurring: 1,
      recurrenceRule: 'monthly',
      recurrenceSeriesId: 'exp_stop_anchor_g3',
      recurrenceAnchorDate: anchorDue,
    });
    const child = baseExpense({
      id: 'exp_stop_child_g3',
      expenseType: 'invoice',
      description: 'Serie stop child QA',
      vendor: 'Serie stop child QA',
      date: childDue,
      dueDate: childDue,
      recurring: 0,
      recurrenceRule: null,
      recurrenceSeriesId: 'exp_stop_anchor_g3',
      originRecurrenceId: 'exp_stop_anchor_g3',
      amount: 120,
      amountEUR: 120,
    });
    const state = await setupMockApi(page, { expenses: [anchor, child] });
    await loginAs(page, 'admin@solana.test');
    await waitForExpensesRefetch(state);
    await clickSidebarGastos(page);
    await openExpenseDetail(page, 'Serie stop child QA');
    const panel = getDetailPanel(page);
    await panel.getByRole('button', { name: /Detener recurrencia/i }).click();
    const confirmBtn = page.getByRole('button', { name: 'Confirmar' });
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await page.waitForTimeout(600);
    expect(getExpenseFromState(state, 'exp_stop_anchor_g3')?.recurring).toBe(0);
    expect(getExpenseFromState(state, 'exp_stop_child_g3')?.status).toBe('approved');
    await page.getByText('Panel', { exact: true }).first().click();
    await page.waitForTimeout(500);
    const futureInWindow = recurrence.enumerateOccurrenceDates(anchorDue, 'monthly', {
      rangeStart: today,
      rangeEnd: addDaysISO(today, 15),
      endDate: today,
    });
    if (futureInWindow.some((d: string) => d > today)) {
      await expect(page.getByText(/previsto/i)).toHaveCount(0);
    }
  });
});

test.describe('H — Toast positioning', () => {
  test('H1) Desktop toasts are top-center and non-blocking', async ({ page }) => {
    await setupMockApi(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page, 'admin@solana.test');
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('solana-toast', {
          detail: { message: 'Toast position desktop QA', kind: 'success' },
        }),
      );
    });
    const slot = page.locator('.toast-slot');
    await expect(slot).toBeVisible();
    await expect(slot.locator('.toast')).toHaveText('Toast position desktop QA');
    const metrics = await slot.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        pointerEvents: style.pointerEvents,
        centerX: rect.left + rect.width / 2,
        viewportW: window.innerWidth,
      };
    });
    expect(metrics.pointerEvents).toBe('none');
    expect(Math.abs(metrics.centerX - metrics.viewportW / 2)).toBeLessThan(8);
  });

  test('H2) Mobile toasts remain top-right', async ({ page }) => {
    await setupMockApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'admin@solana.test');
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('solana-toast', {
          detail: { message: 'Toast position mobile QA', kind: 'info' },
        }),
      );
    });
    const slot = page.locator('.toast-slot');
    await expect(slot).toBeVisible();
    const metrics = await slot.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        centerX: rect.left + rect.width / 2,
        distFromRight: window.innerWidth - rect.right,
        viewportW: window.innerWidth,
      };
    });
    expect(metrics.distFromRight).toBeLessThan(20);
    expect(metrics.centerX).toBeGreaterThan(metrics.viewportW * 0.55);
  });
});
