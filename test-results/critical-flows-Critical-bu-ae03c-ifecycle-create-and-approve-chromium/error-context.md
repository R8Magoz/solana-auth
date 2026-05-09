# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> 5) Bills lifecycle: create and approve
- Location: tests/e2e/critical-flows.spec.ts:539:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByText('Facturas', { exact: true }).first()

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
    - heading "Panel" [level=1] [ref=e37]
    - paragraph [ref=e38]: Bienvenido, Admin
    - generic [ref=e39]:
      - generic [ref=e40] [cursor=pointer]:
        - generic [ref=e41]: +
        - generic [ref=e42]: Añadir Gasto
        - generic [ref=e43]: Registrar un nuevo coste
      - generic [ref=e44] [cursor=pointer]:
        - generic [ref=e45]: +
        - generic [ref=e46]: Nueva factura
        - generic [ref=e47]: Formulario con vencimiento y proveedor
    - generic [ref=e48]:
      - generic [ref=e49]:
        - generic [ref=e50]: Total gastado
        - generic [ref=e51]: 0,00 €
        - generic [ref=e53]: 0.0% usado
        - generic [ref=e54]: Gastos aprobados
      - generic [ref=e55]:
        - generic [ref=e56]: Presupuesto disponible
        - generic [ref=e57]: 8000,00 €
        - generic [ref=e59]: 0.0% disponible
        - generic [ref=e60]: Suma de departamentos
      - generic [ref=e61]:
        - generic [ref=e62]: Gasto en Mayo
        - generic [ref=e63]: 0,00 €
        - generic [ref=e64]: Sin gastos este mes aún
      - generic [ref=e66] [cursor=pointer]:
        - generic [ref=e68]:
          - generic [ref=e69]: Coste fijo mensual
          - generic [ref=e71]: ⓘ
        - generic [ref=e72]: 0,00 €
        - generic [ref=e73]: Sin facturas recurrentes
    - generic [ref=e74]:
      - generic [ref=e75]: Mi actividad
      - generic [ref=e76]:
        - generic [ref=e77]:
          - generic [ref=e78]: Aprobados
          - generic [ref=e79]: "0"
          - generic [ref=e80]: 0,00 €
        - generic [ref=e81]:
          - generic [ref=e82]: Pendientes
          - generic [ref=e83]: "0"
          - generic [ref=e84]: 0,00 €
        - generic [ref=e85]:
          - generic [ref=e86]: Rechazados
          - generic [ref=e87]: "0"
          - generic [ref=e88]: 0,00 €
    - generic [ref=e89]:
      - generic [ref=e90]: Presupuestos por departamento
      - generic [ref=e91]:
        - generic [ref=e92]:
          - generic [ref=e94]: Operaciones
          - generic [ref=e95]:
            - text: 0,00 €
            - generic [ref=e96]: de 3000,00 €
        - generic [ref=e98]:
          - generic [ref=e99]: Sin gastos
          - generic [ref=e100]: 3000,00 € disponible
      - generic [ref=e101]:
        - generic [ref=e102]:
          - generic [ref=e104]: Finanzas
          - generic [ref=e105]:
            - text: 0,00 €
            - generic [ref=e106]: de 5000,00 €
        - generic [ref=e108]:
          - generic [ref=e109]: Sin gastos
          - generic [ref=e110]: 5000,00 € disponible
    - generic [ref=e111]:
      - generic [ref=e112]: Inversión por persona
      - paragraph [ref=e113]: Total de gastos y facturas por titular, aprobados y pendientes.
    - generic [ref=e114]:
      - generic [ref=e115]: Próximas facturas · 15 días
      - generic [ref=e116]: No hay facturas en los próximos 15 días.
    - generic [ref=e117]:
      - generic [ref=e118]:
        - generic [ref=e119]: Gastos recientes
        - button "Ver todo" [ref=e120] [cursor=pointer]
      - generic [ref=e121]: No se encontraron gastos
```

# Test source

```ts
  344 |           e.paymentStatus = 'pending_approval';
  345 |         }
  346 |         pushAudit(e, { action: 'rejected', by: session.userId, note: e.rejectionNote });
  347 |         e.updatedAt = Date.now();
  348 |         return json(200, { ok: true, expense: e });
  349 |       }
  350 |       if (sub === 'mark-paid') {
  351 |         const body = safeJson(req.postData());
  352 |         const pay = String(body.paidAt || new Date().toISOString().slice(0, 10)).slice(0, 10);
  353 |         const ts = Date.parse(pay + 'T12:00:00');
  354 |         e.paymentStatus = 'paid';
  355 |         e.paidAt = Number.isFinite(ts) ? ts : Date.now();
  356 |         e.paidConfirmedBy = session.userId;
  357 |         pushAudit(e, { action: 'mark_paid', by: session.userId, note: pay });
  358 |         e.updatedAt = Date.now();
  359 |         return json(200, { ok: true, expense: e });
  360 |       }
  361 |       if (sub === 'comments') {
  362 |         const body = safeJson(req.postData());
  363 |         const text = String(body.text || '').trim();
  364 |         const list = parseComments(e);
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
> 444 |   await page.getByText('Facturas', { exact: true }).first().click();
      |                                                             ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
```