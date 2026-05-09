# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> 1) Login + session handling survives reload
- Location: tests/e2e/critical-flows.spec.ts:461:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: /panel|dashboard/i })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('heading', { name: /panel|dashboard/i })

```

# Test source

```ts
  365 |         const cid = `c_${Date.now()}`;
  366 |         list.push({
  367 |           id: cid,
  368 |           userId: session.userId,
  369 |           text,
  370 |           createdAt: Date.now(),
  371 |         });
  372 |         e.commentsJson = JSON.stringify(list);
  373 |         e.updatedAt = Date.now();
  374 |         return json(200, { ok: true, expense: e });
  375 |       }
  376 |     }
  377 | 
  378 |     if (expensePutMatch && method === 'PUT') {
  379 |       if (!session) return json(401, { error: 'No autorizado.' });
  380 |       const id = expensePutMatch[1];
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
> 465 |     await expect(page.getByRole('heading', { name: /panel|dashboard/i })).toBeVisible();
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
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
  481 |     await expect(page.getByText(/Equipment|Supplies|Marketing|Software|Otro/i).first()).toBeVisible();
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
```