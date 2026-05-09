# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> C5) Assigned approver sees Aprobar/Rechazar buttons
- Location: tests/e2e/critical-flows.spec.ts:930:7

# Error details

```
Error: locator.selectOption: options[0].label: expected string, got object
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
      - generic [ref=e45]: 0 pendientes · 0 aprobados
      - button "Mas filtros" [ref=e47] [cursor=pointer]
      - generic [ref=e49]: No se encontraron gastos
    - generic [ref=e51]:
      - generic [ref=e52]:
        - generic [ref=e53]: Nuevo gasto
        - button "×" [ref=e54] [cursor=pointer]
      - generic [ref=e55]:
        - generic [ref=e56]:
          - generic [ref=e57]:
            - generic [ref=e58]: Concepto *
            - textbox "Concepto" [ref=e59]: Gasto Supplies aprobador
          - generic [ref=e61] [cursor=pointer]:
            - checkbox "Factura de proveedor" [ref=e62]
            - generic [ref=e63]: Factura de proveedor
          - generic [ref=e64]:
            - generic [ref=e65]: Importe *
            - textbox "0.00" [active] [ref=e66]: "60"
          - generic [ref=e67]:
            - generic [ref=e68]: Fecha *
            - textbox [ref=e69]: 2026-05-09
          - generic [ref=e70]:
            - generic [ref=e71]: Categoría *
            - combobox [ref=e72]:
              - option "Categoría" [selected]
              - option "Equipamiento"
              - option "Suministros"
              - option "Marketing"
              - option "Legal"
              - option "Alquiler"
              - option "Software"
              - option "Alimentación"
              - option "Viajes"
              - option "Otro"
          - generic [ref=e73]:
            - generic [ref=e74]: Departamento *
            - combobox [ref=e75]:
              - option "Departamento" [selected]
              - option "Operaciones"
              - option "Finanzas"
          - generic [ref=e76]:
            - generic [ref=e77]: Titular del gasto *
            - combobox [ref=e78]:
              - option "Admin QA" [selected]
              - option "User QA"
          - generic [ref=e79]:
            - generic [ref=e80]: Tipo de IVA
            - combobox [ref=e81]:
              - option "Sin IVA"
              - option "4% superreducido"
              - option "10% reducido"
              - option "21% general" [selected]
          - generic [ref=e84] [cursor=pointer]:
            - checkbox "Gasto recurrente" [ref=e85]
            - generic [ref=e86]: Gasto recurrente
        - generic [ref=e88]:
          - generic [ref=e89]:
            - generic [ref=e90]: Base imponible
            - generic [ref=e91]: 49,59 €
          - generic [ref=e92]:
            - generic [ref=e93]: Cuota IVA
            - generic [ref=e94]: 10,41 €
        - generic [ref=e95]:
          - generic [ref=e96]: Notas
          - textbox [ref=e97]
        - generic [ref=e98]:
          - generic [ref=e99]: Recibo
          - generic [ref=e100]:
            - button "Hacer foto" [ref=e101] [cursor=pointer]
            - button "Subir archivo" [ref=e102] [cursor=pointer]
        - generic [ref=e105]:
          - generic [ref=e106]: Dividir gasto
          - generic [ref=e107]: Dividir entre el equipo
      - generic [ref=e110]:
        - button "Enviar gasto" [ref=e111]
        - button "Completar campos obligatorios" [ref=e112] [cursor=pointer]
```

# Test source

```ts
  845  |       departmentId: 'dept_ops',
  846  |       createdAt: Date.now(),
  847  |       updatedAt: Date.now(),
  848  |       paymentStatus: 'na',
  849  |       deferredPayment: false,
  850  |       paymentTermDays: 0,
  851  |       auditTrailJson: '[]',
  852  |       commentsJson: '[]',
  853  |       rejectionNote: null,
  854  |     };
  855  |     await setupMockApi(page, { expenses: [e1, e2] });
  856  |     await loginAs(page, 'user@solana.test');
  857  |     await page.getByText('Gastos', { exact: true }).first().click();
  858  |     await expect(page.getByText('Gasto admin only')).toBeVisible();
  859  |     await expect(page.getByText('Gasto usuario only')).toBeVisible();
  860  |   });
  861  | 
  862  |   test('C2) Regular user cannot see Aprobar/Rechazar buttons', async ({ page }) => {
  863  |     const pendingExpense: ExpenseRow = {
  864  |       id: 'c2_pen',
  865  |       userId: 'admin-1',
  866  |       date: '2026-04-03',
  867  |       description: 'C2 pendiente otros',
  868  |       amount: 111,
  869  |       amountEUR: 111,
  870  |       expenseType: 'expense',
  871  |       category: 'Software',
  872  |       status: 'submitted',
  873  |       approversJson: JSON.stringify(['admin-1']),
  874  |       approvalVotesJson: '{}',
  875  |       ownerId: 'admin-1',
  876  |       paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 111 }]),
  877  |       splitMode: null,
  878  |       notes: '',
  879  |       receiptPath: null,
  880  |       departmentId: 'dept_ops',
  881  |       createdAt: Date.now(),
  882  |       updatedAt: Date.now(),
  883  |       paymentStatus: 'na',
  884  |       deferredPayment: false,
  885  |       paymentTermDays: 0,
  886  |       auditTrailJson: '[]',
  887  |       commentsJson: '[]',
  888  |       rejectionNote: null,
  889  |     };
  890  | 
  891  |     await setupMockApi(page, { expenses: [pendingExpense] });
  892  |     await loginAs(page, 'user@solana.test');
  893  |     await page.getByText('Gastos', { exact: true }).first().click();
  894  |     await page.getByText('C2 pendiente otros').click();
  895  |     await expect(page.locator('.panel-slide').getByRole('button', { name: 'Aprobar' })).toHaveCount(0);
  896  |     await expect(page.locator('.panel-slide').getByRole('button', { name: 'Rechazar' })).toHaveCount(0);
  897  |     await page.getByText('Aprobaciones').first().click();
  898  |     await expect(page.getByText(/Solo los aprobadores asignados/i)).toBeVisible();
  899  |   });
  900  | 
  901  |   test('C3) Regular user can access Mi perfil and change password', async ({ page }) => {
  902  |     await setupMockApi(page);
  903  |     await loginAs(page, 'user@solana.test');
  904  |     await page.getByText('Mi perfil').first().click();
  905  |     await expect(page.getByText('Mi perfil').nth(1)).toBeVisible();
  906  |     await page.getByText('Cambiar contraseña').first().click();
  907  |     await expect(page.locator('.panel-slide').getByPlaceholder(/actual|current/i)).toBeVisible();
  908  |     await expect(page.getByText('Miembros del equipo')).toHaveCount(0);
  909  |     await expect(page.getByRole('button', { name: 'Guardar categorías' })).toHaveCount(0);
  910  |   });
  911  | 
  912  |   test('C4) Superadmin can assign approvers to categories in Settings', async ({ page }) => {
  913  |     await setupMockApi(page);
  914  |     await loginAs(page, 'admin@solana.test');
  915  |     await page.getByText('Mi perfil').first().click();
  916  |     await page.locator('div.card', { hasText: 'Ajustes de aplicación' }).locator(':scope > div').first().click();
  917  |     await page.evaluate(() => {
  918  |       const btns = [...document.querySelectorAll('button')] as HTMLElement[];
  919  |       const guardar = btns.find((b) => b.textContent?.trim() === 'Guardar categorías');
  920  |       const column = guardar?.parentElement?.previousElementSibling as HTMLElement | undefined;
  921  |       const suppliesRow = column?.children[1];
  922  |       const userBtn = [...(suppliesRow?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'User QA');
  923  |       userBtn?.click();
  924  |     });
  925  |     await page.getByRole('button', { name: 'Guardar categorías' }).click();
  926  | 
  927  |     await expect(page.getByText('Categorías guardadas.')).toBeVisible();
  928  |   });
  929  | 
  930  |   test('C5) Assigned approver sees Aprobar/Rechazar buttons', async ({ page }) => {
  931  |     const seededCats = [
  932  |       { id: 'c2', name: 'Supplies', archived: false, approverIds: ['user-1'] },
  933  |       { id: 'c1', name: 'Equipment', archived: false, approverIds: [] },
  934  |       { id: 'c3', name: 'Marketing', archived: false, approverIds: [] },
  935  |       { id: 'c9', name: 'Otro', archived: false, approverIds: [] },
  936  |     ];
  937  |     await setupMockApi(page, { settingsCategories: seededCats });
  938  | 
  939  |     await loginAs(page, 'admin@solana.test');
  940  |     await page.getByText('Gastos', { exact: true }).first().click();
  941  |     await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  942  |     const wrap = page.locator('.panel-slide .expense-form-fields-wrap').last();
  943  |     await wrap.getByPlaceholder('Concepto').fill('Gasto Supplies aprobador');
  944  |     await wrap.getByPlaceholder('0.00').fill('60');
> 945  |     await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ label: /Supplies|Insumos|suministros/i });
       |                                                                        ^ Error: locator.selectOption: options[0].label: expected string, got object
  946  |     await wrap.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
  947  |     await page.getByRole('button', { name: 'Enviar gasto' }).click();
  948  | 
  949  |     await page.goto('/');
  950  |     await loginAs(page, 'user@solana.test');
  951  |     await page.getByText('Aprobaciones').first().click();
  952  |     await page.getByRole('button', { name: 'Revisar' }).filter({ visible: true }).click();
  953  |     await expect(page.locator('.panel-slide').getByRole('button', { name: 'Aprobar' })).toBeVisible();
  954  |     await expect(page.locator('.panel-slide').getByRole('button', { name: 'Rechazar' })).toBeVisible();
  955  |   });
  956  | 
  957  |   test('D1) Informes visible to all roles', async ({ page }) => {
  958  |     await setupMockApi(page);
  959  |     await loginAs(page, 'user@solana.test');
  960  |     await expect(page.getByText('Informes')).toBeVisible();
  961  |     await page.getByText('Informes').first().click();
  962  |     await expect(page.getByRole('heading', { name: 'Informes' })).toBeVisible();
  963  |     await expect(page.getByText('Total del período')).toBeVisible();
  964  |   });
  965  | 
  966  |   test('D2) Date range filter affects Total del período', async ({ page }) => {
  967  |     const jan: ExpenseRow = {
  968  |       id: 'dj',
  969  |       userId: 'admin-1',
  970  |       date: '2026-01-10',
  971  |       description: 'Enero row',
  972  |       amount: 400,
  973  |       amountEUR: 400,
  974  |       expenseType: 'expense',
  975  |       category: 'Software',
  976  |       status: 'approved',
  977  |       approversJson: JSON.stringify(['admin-1']),
  978  |       approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
  979  |       ownerId: 'admin-1',
  980  |       paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 400 }]),
  981  |       notes: '',
  982  |       receiptPath: null,
  983  |       departmentId: 'dept_ops',
  984  |       createdAt: Date.now(),
  985  |       updatedAt: Date.now(),
  986  |       paymentStatus: 'na',
  987  |       deferredPayment: false,
  988  |       paymentTermDays: 0,
  989  |       auditTrailJson: '[]',
  990  |       commentsJson: '[]',
  991  |       rejectionNote: null,
  992  |     };
  993  |     const mar: ExpenseRow = {
  994  |       id: 'dm',
  995  |       userId: 'admin-1',
  996  |       date: '2026-03-15',
  997  |       description: 'Marzo row',
  998  |       amount: 100,
  999  |       amountEUR: 100,
  1000 |       expenseType: 'expense',
  1001 |       category: 'Software',
  1002 |       status: 'approved',
  1003 |       approversJson: JSON.stringify(['admin-1']),
  1004 |       approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
  1005 |       ownerId: 'admin-1',
  1006 |       paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 100 }]),
  1007 |       notes: '',
  1008 |       receiptPath: null,
  1009 |       departmentId: 'dept_ops',
  1010 |       createdAt: Date.now(),
  1011 |       updatedAt: Date.now(),
  1012 |       paymentStatus: 'na',
  1013 |       deferredPayment: false,
  1014 |       paymentTermDays: 0,
  1015 |       auditTrailJson: '[]',
  1016 |       commentsJson: '[]',
  1017 |       rejectionNote: null,
  1018 |     };
  1019 |     await setupMockApi(page, { expenses: [jan, mar] });
  1020 |     await loginAs(page, 'admin@solana.test');
  1021 |     await page.getByText('Informes').first().click();
  1022 |     await page.getByRole('heading', { name: 'Informes' }).scrollIntoViewIfNeeded();
  1023 |     const rangos = page.locator('.card').filter({ hasText: 'Desde' }).filter({ hasText: 'Hasta' }).first();
  1024 |     await rangos.locator('input[type="date"]').nth(0).fill('2026-03-01');
  1025 |     await rangos.locator('input[type="date"]').nth(1).fill('2026-03-31');
  1026 | 
  1027 |     const totalPeriodAmt = page.getByText('Total del período').locator('..').locator('span').last();
  1028 |     await expect(totalPeriodAmt).toContainText('100');
  1029 |     await rangos.locator('input[type="date"]').nth(0).fill('2026-01-01');
  1030 |     await rangos.locator('input[type="date"]').nth(1).fill('2026-12-31');
  1031 |     await expect(totalPeriodAmt).toContainText('500');
  1032 |     await rangos.locator('input[type="date"]').nth(0).fill('2026-01-01');
  1033 |     await rangos.locator('input[type="date"]').nth(1).fill('2026-01-31');
  1034 |     await expect(totalPeriodAmt).toContainText('400');
  1035 |     await rangos.locator('input[type="date"]').nth(0).fill('2026-03-01');
  1036 |     await rangos.locator('input[type="date"]').nth(1).fill('2026-03-31');
  1037 |     await expect(totalPeriodAmt).toContainText('100');
  1038 |   });
  1039 | 
  1040 |   test('D3) Export dropdown shows CSV and PDF options', async ({ page }) => {
  1041 |     await setupMockApi(page);
  1042 |     await loginAs(page, 'admin@solana.test');
  1043 |     await page.getByText('Informes').first().click();
  1044 |     const exportSelect = page.locator('select.inp').filter({ has: page.locator('option[value="csv"]') }).first();
  1045 |     await expect(exportSelect.locator('option[value="csv"]')).toHaveText(/Exportar CSV/);
```