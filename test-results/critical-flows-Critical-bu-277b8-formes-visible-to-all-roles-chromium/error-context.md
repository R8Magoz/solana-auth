# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> D1) Informes visible to all roles
- Location: tests/e2e/critical-flows.spec.ts:957:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Informes')
Expected: visible
Error: strict mode violation: getByText('Informes') resolved to 2 elements:
    1) <span>Informes</span> aka getByText('Informes').first()
    2) <span>Informes</span> aka getByText('Informes').nth(1)

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Informes')

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
    - heading "Panel" [level=1] [ref=e37]
    - paragraph [ref=e38]: Bienvenido, User
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
  945  |     await wrap.locator('label:has-text("Categoría") + select').first().selectOption({ label: /Supplies|Insumos|suministros/i });
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
> 960  |     await expect(page.getByText('Informes')).toBeVisible();
       |                                              ^ Error: expect(locator).toBeVisible() failed
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
  1046 |     await expect(exportSelect.locator('option[value="pdf"]')).toHaveText(/Exportar PDF/);
  1047 |   });
  1048 | 
  1049 |   test('E1) Seguimiento shows submission event', async ({ page }) => {
  1050 |     await setupMockApi(page);
  1051 |     await loginAs(page, 'user@solana.test');
  1052 |     await createExpenseViaUi(page, 'Trail E1', '12');
  1053 |     await page.getByText('Trail E1').click();
  1054 |     await expect(page.getByText('Seguimiento')).toBeVisible();
  1055 |     await expect(page.getByText(/Enviado/).first()).toBeVisible();
  1056 |   });
  1057 | 
  1058 |   test('E2) Seguimiento shows approval event after approval', async ({ page }) => {
  1059 |     await setupMockApi(page);
  1060 |     await loginAs(page, 'admin@solana.test');
```