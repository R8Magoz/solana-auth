# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> 2) Create → approve → report expense flow
- Location: tests/e2e/critical-flows.spec.ts:468:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/Equipment|Supplies|Marketing|Software|Otro/i).first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/Equipment|Supplies|Marketing|Software|Otro/i).first()

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5] [cursor=pointer]:
      - generic "SOLANA" [ref=e6]:
        - generic [ref=e7]: SOLANA
      - generic [ref=e8]: Gestión de Gastos
    - generic [ref=e11] [cursor=pointer]: Panel
    - generic [ref=e14] [cursor=pointer]: Gastos
    - generic [ref=e17] [cursor=pointer]: Aprobaciones
    - generic [ref=e20] [cursor=pointer]: Informes
    - generic [ref=e23] [cursor=pointer]: Mi perfil
    - generic [ref=e24]:
      - generic [ref=e26]:
        - generic [ref=e27]: AQ
        - generic [ref=e28]:
          - generic [ref=e29]: Admin QA
          - generic [ref=e30]: Superadministrador
        - generic [ref=e31]: ···
      - button "Cerrar sesión" [ref=e32] [cursor=pointer]
  - generic [ref=e36]:
    - generic [ref=e37]:
      - heading "Informes" [level=1] [ref=e38]
      - generic [ref=e39]:
        - combobox [ref=e40]:
          - 'option "Mostrar: Todos" [selected]'
          - option "Solo aprobados"
          - option "Solo pendientes"
        - combobox [ref=e41]:
          - option "Con IVA" [selected]
          - option "Con y sin IVA"
          - option "Sin IVA"
        - combobox [ref=e42]:
          - option "Exportar…" [selected]
          - option "Exportar CSV"
          - option "Exportar PDF"
    - generic [ref=e44]:
      - generic [ref=e45]: Desde
      - textbox [ref=e46]: 2026-05-09
      - generic [ref=e47]: Hasta
      - textbox [ref=e48]: 2026-05-09
    - generic [ref=e49]:
      - generic [ref=e50]: Actividad mensual (12 meses)
      - generic [ref=e51]:
        - generic [ref=e54]: Gastos
        - generic [ref=e57]: Facturas
      - img [ref=e59]:
        - generic [ref=e61]: jun 25
        - generic [ref=e63]: jul 25
        - generic [ref=e65]: ago 25
        - generic [ref=e67]: sept 25
        - generic [ref=e69]: oct 25
        - generic [ref=e71]: nov 25
        - generic [ref=e73]: dic 25
        - generic [ref=e75]: ene 26
        - generic [ref=e77]: feb 26
        - generic [ref=e79]: mar 26
        - generic [ref=e81]: abr 26
        - generic [ref=e82]:
          - 'generic "may 26 Gastos: 120,00 €" [ref=e83]'
          - generic [ref=e84]: "120"
          - generic [ref=e85]: may 26
      - generic [ref=e86]:
        - generic [ref=e87]: Total del período
        - generic [ref=e88]: 120,00 €
    - generic [ref=e89]:
      - generic [ref=e90]: Calendario de pagos
      - generic [ref=e91]:
        - generic [ref=e92]:
          - button "‹" [ref=e93] [cursor=pointer]
          - generic [ref=e94]: Mayo 2026
          - button "›" [ref=e95] [cursor=pointer]
        - generic [ref=e96]:
          - generic [ref=e97]: Lun
          - generic [ref=e98]: Mar
          - generic [ref=e99]: Mié
          - generic [ref=e100]: Jue
          - generic [ref=e101]: Vie
          - generic [ref=e102]: Sáb
          - generic [ref=e103]: Dom
        - generic [ref=e104]:
          - generic [ref=e110] [cursor=pointer]: "1"
          - generic [ref=e112] [cursor=pointer]: "2"
          - generic [ref=e114] [cursor=pointer]: "3"
          - generic [ref=e116] [cursor=pointer]: "4"
          - generic [ref=e118] [cursor=pointer]: "5"
          - generic [ref=e120] [cursor=pointer]: "6"
          - generic [ref=e122] [cursor=pointer]: "7"
          - generic [ref=e124] [cursor=pointer]: "8"
          - generic [ref=e125] [cursor=pointer]:
            - generic [ref=e126]: "9"
            - generic "Taxi aeropuerto QA" [ref=e128]
          - generic [ref=e130] [cursor=pointer]: "10"
          - generic [ref=e132] [cursor=pointer]: "11"
          - generic [ref=e134] [cursor=pointer]: "12"
          - generic [ref=e136] [cursor=pointer]: "13"
          - generic [ref=e138] [cursor=pointer]: "14"
          - generic [ref=e140] [cursor=pointer]: "15"
          - generic [ref=e142] [cursor=pointer]: "16"
          - generic [ref=e144] [cursor=pointer]: "17"
          - generic [ref=e146] [cursor=pointer]: "18"
          - generic [ref=e148] [cursor=pointer]: "19"
          - generic [ref=e150] [cursor=pointer]: "20"
          - generic [ref=e152] [cursor=pointer]: "21"
          - generic [ref=e154] [cursor=pointer]: "22"
          - generic [ref=e156] [cursor=pointer]: "23"
          - generic [ref=e158] [cursor=pointer]: "24"
          - generic [ref=e160] [cursor=pointer]: "25"
          - generic [ref=e162] [cursor=pointer]: "26"
          - generic [ref=e164] [cursor=pointer]: "27"
          - generic [ref=e166] [cursor=pointer]: "28"
          - generic [ref=e168] [cursor=pointer]: "29"
          - generic [ref=e170] [cursor=pointer]: "30"
          - generic [ref=e172] [cursor=pointer]: "31"
        - generic [ref=e173]:
          - generic [ref=e174]: Factura
          - generic [ref=e176]: Gastos
    - generic [ref=e179]:
      - generic [ref=e180]: Gasto total por categoría
      - generic [ref=e182] [cursor=pointer]:
        - generic [ref=e183]: Equipamiento
        - generic [ref=e184]: 120,00 €
    - generic [ref=e188]:
      - generic [ref=e189]: Inversión por persona
      - paragraph [ref=e190]: Total de gastos y facturas por titular, aprobados y pendientes.
      - generic [ref=e193] [cursor=pointer]:
        - generic [ref=e194]: AQ
        - generic [ref=e195]:
          - generic [ref=e196]: Admin QA
          - generic [ref=e197]: superadmin · 1 movimiento
        - generic [ref=e199]: 120,00 €
        - generic [ref=e200]: ▼
      - generic [ref=e201]:
        - generic [ref=e202]: Total
        - generic [ref=e203]: 120,00 €
```

# Test source

```ts
  381 |       const e = state.expenses.find((x) => x.id === id);
  382 |       if (!e) return json(404, { error: 'Gasto no encontrado.' });
  383 |       const body = safeJson(req.postData());
  384 |       if (typeof body.description === 'string') e.description = body.description;
  385 |       if (typeof body.amount === 'number') {
  386 |         e.amount = body.amount;
  387 |         e.amountEUR = body.amount;
  388 |       }
  389 |       if (typeof body.category === 'string') e.category = body.category;
  390 |       if (typeof body.date === 'string') e.date = body.date.slice(0, 10);
  391 |       if (typeof body.notes === 'string') e.notes = body.notes;
  392 |       if (body.departmentId) e.departmentId = body.departmentId;
  393 |       if (typeof body.vendor === 'string') e.vendor = body.vendor;
  394 |       if (typeof body.ownerId === 'string') e.ownerId = body.ownerId;
  395 |       if (body.paidBy) e.paidByJson = JSON.stringify(body.paidBy);
  396 |       if (body.expenseType) e.expenseType = body.expenseType;
  397 |       if (body.deferredPayment != null) e.deferredPayment = !!body.deferredPayment;
  398 |       if (body.paymentTermDays != null) e.paymentTermDays = Number(body.paymentTermDays);
  399 |       if (body.dueDate !== undefined) e.dueDate = body.dueDate;
  400 |       if (Array.isArray(body.approvalRequired)) {
  401 |         e.approversJson = JSON.stringify(body.approvalRequired.filter(Boolean));
  402 |         e.approvalVotesJson = '{}';
  403 |       }
  404 |       if (body.status === 'submitted') {
  405 |         e.status = 'submitted';
  406 |         e.rejectionNote = null;
  407 |         pushAudit(e, { action: 'resubmitted', by: session.userId });
  408 |       }
  409 |       e.updatedAt = Date.now();
  410 |       return json(200, { ok: true, expense: e });
  411 |     }
  412 | 
  413 |     return json(200, { ok: true });
  414 |   });
  415 | 
  416 |   return state;
  417 | }
  418 | 
  419 | async function loginAs(page: Page, email: string) {
  420 |   await page.goto('/');
  421 |   await page.locator('input[type="email"]').fill(email);
  422 |   await page.locator('input[type="password"]').first().fill(PASSWORDS[email.toLowerCase()] ?? '');
  423 |   await page.getByRole('button', { name: /iniciar sesi|sign in|entrar/i }).click();
  424 |   await expect(page.getByRole('heading', { name: /panel|dashboard/i })).toBeVisible();
  425 | }
  426 | 
  427 | async function createExpenseViaUi(page: Page, description: string, amount: string) {
  428 |   await page.getByText('Gastos', { exact: true }).first().click();
  429 |   await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  430 |   const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  431 |   await wrap.getByPlaceholder('Concepto').fill(description);
  432 |   await wrap.getByPlaceholder('0.00').fill(amount);
  433 | 
  434 |   const categorySelect = wrap.locator('label:has-text("Categoría") + select').first();
  435 |   await categorySelect.selectOption({ index: 1 });
  436 |   const departmentSelect = wrap.locator('label:has-text("Departamento") + select').first();
  437 |   await departmentSelect.selectOption({ index: 1 });
  438 | 
  439 |   await page.getByRole('button', { name: 'Enviar gasto' }).click();
  440 |   await expect(page.getByText(description).first()).toBeVisible();
  441 | }
  442 | 
  443 | async function createBillViaUi(page: Page, name: string, amount: string) {
  444 |   await page.getByText('Facturas', { exact: true }).first().click();
  445 |   await page.getByRole('button', { name: 'Nueva factura' }).click();
  446 |   const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  447 |   await wrap.locator('input[placeholder="Concepto"]').first().fill(name);
  448 |   await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(name);
  449 |   await wrap.getByPlaceholder('0.00').fill(amount);
  450 | 
  451 |   const billCategory = wrap.locator('label:has-text("Categoría") + select').first();
  452 |   await billCategory.selectOption({ index: 1 });
  453 |   const billDepartment = wrap.locator('label:has-text("Departamento") + select').first();
  454 |   await billDepartment.selectOption({ index: 1 });
  455 | 
  456 |   await page.getByRole('button', { name: 'Enviar factura' }).click();
  457 |   await expect(page.getByText(name).first()).toBeVisible();
  458 | }
  459 | 
  460 | test.describe('Critical business flows', () => {
  461 |   test('1) Login + session handling survives reload', async ({ page }) => {
  462 |     await setupMockApi(page);
  463 |     await loginAs(page, 'admin@solana.test');
  464 |     await page.reload();
  465 |     await expect(page.getByRole('heading', { name: /panel|dashboard/i })).toBeVisible();
  466 |   });
  467 | 
  468 |   test('2) Create → approve → report expense flow', async ({ page }) => {
  469 |     await setupMockApi(page);
  470 |     await loginAs(page, 'admin@solana.test');
  471 | 
  472 |     await createExpenseViaUi(page, 'Taxi aeropuerto QA', '120');
  473 | 
  474 |     await page.getByText('Aprobaciones').first().click();
  475 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  476 |     await page.getByRole('button', { name: 'Aprobar' }).first().click();
  477 | 
  478 |     await page.getByText('Informes').first().click();
  479 |     await expect(page.getByText(/Gasto total por categoría/i)).toBeVisible();
  480 |     await expect(page.getByText(/Taxi aeropuerto QA/i)).toBeHidden();
> 481 |     await expect(page.getByText(/Equipment|Supplies|Marketing|Software|Otro/i).first()).toBeVisible();
      |                                                                                         ^ Error: expect(locator).toBeVisible() failed
  482 |   });
  483 | 
  484 |   test('3) Offline → sync keeps consistency (single expense, no duplicates)', async ({ page, context }) => {
  485 |     const state = await setupMockApi(page);
  486 |     await loginAs(page, 'admin@solana.test');
  487 | 
  488 |     await context.setOffline(true);
  489 |     await createExpenseViaUi(page, 'Offline sync expense', '75');
  490 |     await expect(page.getByText(/Sin conexión, los cambios se guardarán localmente/i)).toBeVisible();
  491 | 
  492 |     await context.setOffline(false);
  493 |     await page.waitForTimeout(1500);
  494 |     await page.reload();
  495 |     await expect(page.getByText('Offline sync expense')).toBeVisible();
  496 |     expect(state.expenses.filter((e) => e.description === 'Offline sync expense')).toHaveLength(1);
  497 |   });
  498 | 
  499 |   test('4) Role-based permissions: regular user has read-only approvals', async ({ page }) => {
  500 |     const pendingExpense: ExpenseRow = {
  501 |       id: 'exp_role_1',
  502 |       userId: 'admin-1',
  503 |       date: '2026-04-01',
  504 |       description: 'Server bill import',
  505 |       amount: 200,
  506 |       amountEUR: 200,
  507 |       currency: 'EUR',
  508 |       category: 'Software',
  509 |       status: 'submitted',
  510 |       expenseType: 'expense',
  511 |       approversJson: JSON.stringify(['admin-1']),
  512 |       approvalVotesJson: '{}',
  513 |       ownerId: 'admin-1',
  514 |       paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 200, pct: 100 }]),
  515 |       splitMode: null,
  516 |       notes: '',
  517 |       receiptPath: null,
  518 |       departmentId: 'dept_ops',
  519 |       createdAt: Date.now(),
  520 |       updatedAt: Date.now(),
  521 |       paymentStatus: 'na',
  522 |       deferredPayment: false,
  523 |       paymentTermDays: 0,
  524 |       auditTrailJson: JSON.stringify([]),
  525 |       commentsJson: JSON.stringify([]),
  526 |       rejectionNote: null,
  527 |     };
  528 | 
  529 |     await setupMockApi(page, { expenses: [pendingExpense] });
  530 |     await loginAs(page, 'user@solana.test');
  531 | 
  532 |     await page.getByText('Aprobaciones').first().click();
  533 |     await expect(page.getByText('Server bill import')).toBeVisible();
  534 |     await expect(page.getByRole('button', { name: 'Revisar' })).toHaveCount(0);
  535 |     await page.getByText('Server bill import').click();
  536 |     await expect(page.getByText('Solo lectura')).toBeVisible();
  537 |   });
  538 | 
  539 |   test('5) Bills lifecycle: create and approve', async ({ page }) => {
  540 |     await setupMockApi(page);
  541 |     await loginAs(page, 'admin@solana.test');
  542 | 
  543 |     await createBillViaUi(page, 'Factura AWS QA', '260');
  544 | 
  545 |     await page.getByText('Aprobaciones').first().click();
  546 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  547 |     await page.getByRole('button', { name: 'Aprobar' }).first().click();
  548 | 
  549 |     await page.getByText('Facturas').first().click();
  550 |     await expect(page.getByText('Factura AWS QA')).toBeVisible();
  551 |     await expect(page.getByText(/Aprobado/i).first()).toBeVisible();
  552 |   });
  553 | 
  554 |   test('A1) Submit plain gasto — appears in Gastos as Pendiente', async ({ page }) => {
  555 |     await setupMockApi(page);
  556 |     await loginAs(page, 'user@solana.test');
  557 |     await page.getByText('Gastos', { exact: true }).first().click();
  558 |     await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  559 |     const desc = 'Gasto QA pendiente único';
  560 |     await page.getByPlaceholder('Concepto').fill(desc);
  561 |     await page.getByPlaceholder('0.00').fill('42,50');
  562 |     await page.locator('label:has-text("Categoría") + select').first().selectOption({ index: 2 });
  563 |     await page.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
  564 |     await page.getByRole('button', { name: 'Enviar gasto' }).click();
  565 |     await expect(page.getByText(/Gasto registrado correctamente/ui)).toBeVisible();
  566 |     await expect(page.getByText(desc).first()).toBeVisible();
  567 |     await expect(page.getByText('PENDIENTE').first()).toBeVisible();
  568 |   });
  569 | 
  570 |   test('A2) Submit gasto — admin approves — status turns Aprobado', async ({ page }) => {
  571 |     await setupMockApi(page);
  572 |     await loginAs(page, 'user@solana.test');
  573 |     await createExpenseViaUi(page, 'Flow A2 gasto', '88');
  574 | 
  575 |     await page.getByRole('button', { name: '×' }).nth(1).click().catch(() => {});
  576 |     await page.goto('/');
  577 |     await loginAs(page, 'admin@solana.test');
  578 |     await page.getByText('Aprobaciones').first().click();
  579 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  580 |     await page.getByRole('button', { name: 'Aprobar' }).click();
  581 | 
```