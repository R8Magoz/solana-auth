# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> 4) Role-based permissions: regular user has read-only approvals
- Location: tests/e2e/critical-flows.spec.ts:499:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Solo lectura')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Solo lectura')

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
        - generic [ref=e27]: UQ
        - generic [ref=e28]:
          - generic [ref=e29]: User QA
          - generic [ref=e30]: Usuario
        - generic [ref=e31]: ···
      - button "Cerrar sesión" [ref=e32] [cursor=pointer]
  - generic [ref=e34]:
    - generic [ref=e36]:
      - heading "Gastos" [level=1] [ref=e38]
      - generic [ref=e39]: Pagos únicos, compras y desembolsos del equipo.
      - generic [ref=e40]:
        - textbox "Buscar por código o descripción" [ref=e41]
        - combobox [ref=e42] [cursor=pointer]:
          - 'option "Estado: Todos" [selected]'
          - option "Pendiente"
          - option "Aprobado"
          - option "Rechazado"
        - combobox [ref=e43] [cursor=pointer]:
          - 'option "Tipo: Todos" [selected]'
          - option "Gastos"
          - option "Facturas"
        - button "Nuevo gasto" [ref=e44] [cursor=pointer]
      - generic [ref=e45]: 1 pendiente · 0 aprobados
      - button "Mas filtros" [ref=e47] [cursor=pointer]
      - generic [ref=e50] [cursor=pointer]:
        - generic [ref=e51]:
          - generic [ref=e52]:
            - generic [ref=e53]: Server bill import
            - generic [ref=e54]: GASTO
            - generic [ref=e55]: Pendiente
          - generic [ref=e56]:
            - generic [ref=e57]: 01 abr 2026
            - generic [ref=e58]: "Enviado por: Admin QA · Software"
          - generic [ref=e62]: Admin QA
        - generic [ref=e65]: 200,00 €
    - generic [ref=e67]:
      - generic [ref=e68]:
        - generic [ref=e69]: Detalle de gasto
        - button "×" [ref=e71] [cursor=pointer]
      - generic [ref=e72]:
        - generic [ref=e73]: PENDIENTE
        - generic [ref=e74]: Server bill import
        - generic [ref=e75]: 200,00 €
        - generic [ref=e76]:
          - generic [ref=e77]: exp_role_1
          - button "⌘ Copiar" [ref=e78] [cursor=pointer]
        - generic [ref=e79]:
          - generic [ref=e80]: Fecha
          - generic [ref=e81]: 01 abr 2026
        - generic [ref=e82]:
          - generic [ref=e83]: Categoría
          - generic [ref=e84]: Software
        - generic [ref=e85]:
          - generic [ref=e86]: Departamento
          - generic [ref=e87]: Operaciones
        - generic [ref=e88]:
          - generic [ref=e89]: Titular
          - generic [ref=e90]: Admin QA
        - generic [ref=e91]:
          - generic [ref=e92]: Enviado por
          - generic [ref=e93]: Admin QA
        - generic [ref=e94]:
          - generic [ref=e95]: IVA · Sin IVA
          - generic [ref=e96]: N/A
        - generic [ref=e97]:
          - generic [ref=e98]: Aprobación
          - generic [ref=e99]:
            - generic [ref=e101]: Admin QA
            - generic [ref=e102]: N/A
        - generic [ref=e104]:
          - generic [ref=e105]: Recibo
          - generic [ref=e106]:
            - generic [ref=e107]: Adjunto (sin vista previa) · application/json
            - generic [ref=e108]:
              - button "Abrir archivo" [ref=e109] [cursor=pointer]
              - button "Descargar" [ref=e110] [cursor=pointer]
        - generic [ref=e111]:
          - generic [ref=e112]: Seguimiento
          - generic [ref=e113]:
            - textbox "Añadir una nota…" [ref=e114]
            - button "Añadir nota" [ref=e115] [cursor=pointer]
```

# Test source

```ts
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
> 536 |     await expect(page.getByText('Solo lectura')).toBeVisible();
      |                                                  ^ Error: expect(locator).toBeVisible() failed
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
  582 |     await expect(page.getByText('APROBADO')).toBeVisible();
  583 |     await expect(page.getByText('Seguimiento')).toBeVisible();
  584 |     await expect(page.getByText(/Aprobado/).first()).toBeVisible();
  585 |   });
  586 | 
  587 |   test('A3) Admin rejects with note — status turns Rechazado', async ({ page }) => {
  588 |     await setupMockApi(page);
  589 |     await loginAs(page, 'user@solana.test');
  590 |     await createExpenseViaUi(page, 'Flow A3 rechazo', '50');
  591 |     await page.goto('/');
  592 |     await loginAs(page, 'admin@solana.test');
  593 | 
  594 |     await page.getByText('Aprobaciones').first().click();
  595 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  596 |     const noteTa = page.locator('textarea.inp').first();
  597 |     await noteTa.fill('corto');
  598 |     await page.getByRole('button', { name: 'Rechazar' }).click();
  599 |     await expect(page.getByText(/Escribe un motivo de rechazo/i)).toBeVisible();
  600 | 
  601 |     const longNote = 'Motivo de prueba rechazo suficiente';
  602 |     await noteTa.fill(longNote);
  603 |     await page.getByRole('button', { name: 'Rechazar' }).click();
  604 |     await expect(page.getByText('RECHAZADO')).toBeVisible();
  605 |     await expect(page.getByText(longNote)).toBeVisible();
  606 |   });
  607 | 
  608 |   test('A4) User edits rejected gasto — all fields changeable — resubmits', async ({ page }) => {
  609 |     await setupMockApi(page);
  610 |     await loginAs(page, 'user@solana.test');
  611 |     await createExpenseViaUi(page, 'Original A4', '40');
  612 |     await page.goto('/');
  613 |     await loginAs(page, 'admin@solana.test');
  614 |     await page.getByText('Aprobaciones').first().click();
  615 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  616 |     await page.locator('textarea.inp').first().fill('Motivo de prueba rechazo');
  617 |     await page.getByRole('button', { name: 'Rechazar' }).click();
  618 | 
  619 |     await page.goto('/');
  620 |     await loginAs(page, 'user@solana.test');
  621 |     await page.getByText('Gastos', { exact: true }).first().click();
  622 |     await page.getByText('Original A4').click();
  623 |     await page.getByRole('button', { name: 'Editar' }).click();
  624 |     await page.locator('input[placeholder="Concepto"]').first().fill('Editado A4');
  625 |     await page.locator('input[placeholder="0.00"]').first().fill('55');
  626 |     await page.getByRole('button', { name: 'Guardar cambios' }).click();
  627 |     await page.getByRole('button', { name: 'Confirmar' }).click();
  628 | 
  629 |     await expect(page.getByText('PENDIENTE')).toBeVisible();
  630 |   });
  631 | 
  632 |   test('A5) Approved gasto cannot be edited by regular user', async ({ page }) => {
  633 |     await setupMockApi(page);
  634 |     await loginAs(page, 'user@solana.test');
  635 |     await createExpenseViaUi(page, 'Flow A5 aprobado', '33');
  636 |     await page.goto('/');
```