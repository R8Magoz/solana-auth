# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> B3) Owner marks deferred factura as paid
- Location: tests/e2e/critical-flows.spec.ts:699:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Nueva factura' })

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
    - generic [ref=e45]: 0 pendientes · 0 aprobados
    - button "Mas filtros (1)" [ref=e47] [cursor=pointer]
    - generic [ref=e49]: No se encontraron gastos
```

# Test source

```ts
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
  637 |     await loginAs(page, 'admin@solana.test');
  638 |     await page.getByText('Aprobaciones').first().click();
  639 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  640 |     await page.getByRole('button', { name: 'Aprobar' }).click();
  641 |     await expect(page.getByText('APROBADO')).toBeVisible();
  642 | 
  643 |     await page.goto('/');
  644 |     await loginAs(page, 'user@solana.test');
  645 |     await page.getByText('Gastos', { exact: true }).first().click();
  646 |     await page.getByText('Flow A5 aprobado').click();
  647 |     await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  648 |   });
  649 | 
  650 |   test('B1) Submit factura without A pagar — paymentStatus is paid on creation', async ({ page }) => {
  651 |     await setupMockApi(page);
  652 |     await loginAs(page, 'admin@solana.test');
  653 |     await createBillViaUi(page, 'Factura B1 sin defer', '100');
  654 |     await page.getByText('Facturas').first().click();
  655 |     await page.getByText('Factura B1 sin defer').first().click();
  656 |     await expect(page.getByText('A pagar')).toHaveCount(0);
  657 |     await page.getByText('Aprobaciones').first().click();
  658 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  659 |     await page.getByRole('button', { name: 'Aprobar' }).click();
  660 |     await expect(page.locator('.panel-slide').getByRole('button', { name: 'Marcar como pagada' })).toHaveCount(0);
  661 |   });
  662 | 
  663 |   test('B2) Submit factura with A pagar — payment tracking activates after approval', async ({ page }) => {
  664 |     await setupMockApi(page);
  665 |     await loginAs(page, 'admin@solana.test');
  666 |     await page.getByText('Facturas').first().click();
  667 |     await page.getByRole('button', { name: 'Nueva factura' }).click();
  668 |     const vendor = 'Proveedor defer B2';
  669 |     const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  670 |     await wrap.locator('input[placeholder="Concepto"]').first().fill('Fact B2 defer');
  671 |     await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(vendor);
  672 |     await wrap.getByPlaceholder('0.00').fill('200');
  673 |     await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
  674 |     await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
  675 |     await wrap.getByRole('checkbox', { name: /A pagar/i }).check();
  676 |     await wrap.locator('select.inp').filter({ has: wrap.locator('option[value="15"]') }).selectOption({ value: 'custom' });
  677 |     const today = new Date().toISOString().slice(0, 10);
  678 |     await wrap.locator('input[type="date"]').last().fill(today);
  679 | 
  680 |     await page.getByRole('button', { name: 'Enviar factura' }).click();
  681 |     await page.getByText('Facturas').first().click();
  682 |     await page.getByText(vendor).first().click();
  683 |     await expect(page.getByText('A pagar')).toHaveCount(0);
  684 | 
  685 |     await page.goto('/');
  686 |     await loginAs(page, 'admin@solana.test');
  687 |     await page.getByText('Aprobaciones').first().click();
  688 |     await page.getByRole('button', { name: 'Revisar' }).filter({ visible: true }).first().click();
  689 |     await page.getByRole('button', { name: 'Aprobar' }).click();
  690 |     await expect(page.getByText('A pagar').first()).toBeVisible();
  691 | 
  692 |     await page.goto('/');
  693 |     await loginAs(page, 'admin@solana.test');
  694 |     await page.getByText('Gastos', { exact: true }).first().click();
  695 |     await page.getByText(vendor).first().click();
  696 |     await expect(page.getByRole('button', { name: 'Marcar como pagada' })).toBeVisible();
  697 |   });
  698 | 
  699 |   test('B3) Owner marks deferred factura as paid', async ({ page }) => {
  700 |     await setupMockApi(page);
  701 |     await loginAs(page, 'user@solana.test');
  702 |     await page.getByText('Facturas').first().click();
> 703 |     await page.getByRole('button', { name: 'Nueva factura' }).click();
      |                                                               ^ Error: locator.click: Test timeout of 30000ms exceeded.
  704 |     const v = 'Proveedor B3 pago';
  705 |     const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  706 |     await wrap.locator('input[placeholder="Concepto"]').first().fill('Inv B3');
  707 |     await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(v);
  708 |     await wrap.getByPlaceholder('0.00').fill('150');
  709 |     await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
  710 |     await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
  711 |     await wrap.getByRole('checkbox', { name: /A pagar/i }).check();
  712 |     await wrap.locator('select.inp').filter({ has: wrap.locator('option[value="15"]') }).selectOption({ value: 'custom' });
  713 |     await wrap.locator('input[type="date"]').last().fill(new Date().toISOString().slice(0, 10));
  714 |     await page.getByRole('button', { name: 'Enviar factura' }).click();
  715 | 
  716 |     await page.goto('/');
  717 |     await loginAs(page, 'admin@solana.test');
  718 |     await page.getByText('Aprobaciones').first().click();
  719 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  720 |     await page.getByRole('button', { name: 'Aprobar' }).click();
  721 | 
  722 |     await page.goto('/');
  723 |     await loginAs(page, 'user@solana.test');
  724 |     await page.getByText('Gastos', { exact: true }).first().click();
  725 |     await page.getByText(v).first().click();
  726 |     await page.getByRole('button', { name: 'Marcar como pagada' }).first().click();
  727 |     await page.locator('.panel-slide input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
  728 |     await page.locator('.panel-slide').getByRole('button', { name: 'Confirmar' }).click();
  729 | 
  730 |     await expect(page.locator('.panel-slide').getByRole('button', { name: 'Marcar como pagada' })).toHaveCount(0);
  731 |     await expect(page.getByRole('button', { name: 'Marcar pagada', exact: false })).toHaveCount(0);
  732 |   });
  733 | 
  734 |   test('B4) Invoice does NOT duplicate on mark-paid', async ({ page }) => {
  735 |     await setupMockApi(page);
  736 |     await loginAs(page, 'user@solana.test');
  737 |     await page.getByText('Facturas').first().click();
  738 |     await page.getByRole('button', { name: 'Nueva factura' }).click();
  739 |     const v = 'Dup test vendor';
  740 |     const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  741 |     await wrap.locator('input[placeholder="Concepto"]').first().fill('Dup inv');
  742 |     await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(v);
  743 |     await wrap.getByPlaceholder('0.00').fill('77');
  744 |     await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
  745 |     await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
  746 |     await wrap.getByRole('checkbox', { name: /A pagar/i }).check();
  747 |     await wrap.locator('select.inp').filter({ has: wrap.locator('option[value="15"]') }).selectOption({ value: 'custom' });
  748 |     await wrap.locator('input[type="date"]').last().fill(new Date().toISOString().slice(0, 10));
  749 |     await page.getByRole('button', { name: 'Enviar factura' }).click();
  750 | 
  751 |     await page.goto('/');
  752 |     await loginAs(page, 'admin@solana.test');
  753 |     await page.getByText('Aprobaciones').first().click();
  754 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  755 |     await page.getByRole('button', { name: 'Aprobar' }).click();
  756 | 
  757 |     await page.goto('/');
  758 |     await loginAs(page, 'user@solana.test');
  759 |     await page.getByText('Gastos', { exact: true }).first().click();
  760 |     await page.getByText(v).first().click();
  761 |     await page.getByRole('button', { name: 'Marcar como pagada' }).first().click();
  762 |     await page.locator('.panel-slide').getByRole('button', { name: 'Confirmar' }).click();
  763 | 
  764 |     await expect(page.locator('.row-hover').filter({ hasText: v })).toHaveCount(1);
  765 |   });
  766 | 
  767 |   test('B5) Rejected invoice resets paymentStatus to pending_approval', async ({ page }) => {
  768 |     await setupMockApi(page);
  769 |     await loginAs(page, 'admin@solana.test');
  770 |     await page.getByText('Facturas').first().click();
  771 |     await page.getByRole('button', { name: 'Nueva factura' }).click();
  772 |     const v = 'Inv B5 reject';
  773 |     const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  774 |     await wrap.locator('input[placeholder="Concepto"]').first().fill(v);
  775 |     await wrap.locator('label:has-text("Proveedor")').locator('..').locator('input.inp').first().fill(v);
  776 |     await wrap.getByPlaceholder('0.00').fill('88');
  777 |     await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
  778 |     await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
  779 |     await wrap.getByRole('checkbox', { name: /A pagar/i }).check();
  780 |     await wrap.locator('select.inp').filter({ has: wrap.locator('option[value="15"]') }).selectOption({ value: 'custom' });
  781 |     await wrap.locator('input[type="date"]').last().fill(new Date().toISOString().slice(0, 10));
  782 |     await page.getByRole('button', { name: 'Enviar factura' }).click();
  783 | 
  784 |     await page.getByText('Aprobaciones').first().click();
  785 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  786 |     await page.getByRole('button', { name: 'Aprobar' }).click();
  787 | 
  788 |     await expect(page.getByText('A pagar').first()).toBeVisible();
  789 | 
  790 |     await page.goto('/');
  791 |     await loginAs(page, 'admin@solana.test');
  792 |     await page.getByText('Gastos', { exact: true }).first().click();
  793 |     await page.getByText(v).first().click();
  794 |     await page.locator('.panel-slide textarea').first().fill('rechazo factura después de ok');
  795 |     await page.getByRole('button', { name: 'Rechazar' }).click();
  796 |     await page.getByRole('button', { name: 'Confirmar' }).click();
  797 | 
  798 |     await expect(page.getByText('RECHAZADO')).toBeVisible();
  799 |     await expect(page.getByText('A pagar')).toHaveCount(0);
  800 |   });
  801 | 
  802 |   test('C1) Regular user sees all expenses (transparency model)', async ({ page }) => {
  803 |     const e1: ExpenseRow = {
```