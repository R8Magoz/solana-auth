# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> E1) Seguimiento shows submission event
- Location: tests/e2e/critical-flows.spec.ts:1049:7

# Error details

```
Error: locator.click: Error: strict mode violation: getByText('Trail E1') resolved to 4 elements:
    1) <div>Gasto registrado correctamente · 12,00 € · Trail …</div> aka getByText('Gasto registrado')
    2) <span>Trail E1</span> aka locator('span').filter({ hasText: 'Trail E1' })
    3) <div>Trail E1</div> aka getByText('Trail E1').nth(2)
    4) <div>Trail E1</div> aka getByText('Trail E1').nth(3)

Call log:
  - waiting for getByText('Trail E1')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]: Gasto registrado correctamente · 12,00 € · Trail E1
  - generic [ref=e5]:
    - generic [ref=e6] [cursor=pointer]:
      - generic "SOLANA" [ref=e7]:
        - generic [ref=e8]: SOLANA
      - generic [ref=e9]: Gestión de Gastos
    - generic [ref=e12] [cursor=pointer]: Panel
    - generic [ref=e15] [cursor=pointer]: Gastos
    - generic [ref=e18] [cursor=pointer]: Aprobaciones
    - generic [ref=e21] [cursor=pointer]: Informes
    - generic [ref=e24] [cursor=pointer]: Mi perfil
    - generic [ref=e25]:
      - generic [ref=e27]:
        - generic [ref=e28]: UQ
        - generic [ref=e29]:
          - generic [ref=e30]: User QA
          - generic [ref=e31]: Usuario
        - generic [ref=e32]: ···
      - button "Cerrar sesión" [ref=e33] [cursor=pointer]
  - generic [ref=e35]:
    - generic [ref=e37]:
      - heading "Gastos" [level=1] [ref=e39]
      - generic [ref=e40]: Pagos únicos, compras y desembolsos del equipo.
      - generic [ref=e41]:
        - textbox "Buscar por código o descripción" [ref=e42]
        - combobox [ref=e43] [cursor=pointer]:
          - 'option "Estado: Todos" [selected]'
          - option "Pendiente"
          - option "Aprobado"
          - option "Rechazado"
        - combobox [ref=e44] [cursor=pointer]:
          - 'option "Tipo: Todos" [selected]'
          - option "Gastos"
          - option "Facturas"
        - button "Nuevo gasto" [ref=e45] [cursor=pointer]
      - generic [ref=e46]: 1 pendiente · 0 aprobados
      - button "Mas filtros" [ref=e48] [cursor=pointer]
      - generic [ref=e51] [cursor=pointer]:
        - generic [ref=e52]:
          - generic [ref=e53]:
            - generic [ref=e54]: Trail E1
            - generic [ref=e55]: GASTO
            - generic [ref=e56]: Pendiente
          - generic [ref=e57]:
            - generic [ref=e58]: 09 may 2026
            - generic [ref=e59]: "Enviado por: User QA · Equipment"
          - generic [ref=e63]: Admin QA
        - generic [ref=e66]: 12,00 €
    - generic [ref=e68]:
      - generic [ref=e69]:
        - generic [ref=e70]: Detalle de gasto
        - generic [ref=e71]:
          - button "Editar" [ref=e72] [cursor=pointer]
          - button "Eliminar gasto" [ref=e73] [cursor=pointer]
          - button "×" [ref=e74] [cursor=pointer]
      - generic [ref=e75]:
        - generic [ref=e76]: PENDIENTE
        - generic [ref=e77]: Trail E1
        - generic [ref=e78]: 12,00 €
        - generic [ref=e79]:
          - generic [ref=e80]: exp_1778368925532_0ghie
          - button "⌘ Copiar" [ref=e81] [cursor=pointer]
        - generic [ref=e82]:
          - generic [ref=e83]: Fecha
          - generic [ref=e84]: 09 may 2026
        - generic [ref=e85]:
          - generic [ref=e86]: Categoría
          - generic [ref=e87]: Equipment
        - generic [ref=e88]:
          - generic [ref=e89]: Departamento
          - generic [ref=e90]: Operaciones
        - generic [ref=e91]:
          - generic [ref=e92]: Titular
          - generic [ref=e93]: User QA
        - generic [ref=e94]:
          - generic [ref=e95]: Enviado por
          - generic [ref=e96]: User QA
        - generic [ref=e97]:
          - generic [ref=e98]: IVA · Sin IVA
          - generic [ref=e99]: N/A
        - generic [ref=e100]:
          - generic [ref=e101]: Aprobación
          - generic [ref=e102]:
            - generic [ref=e104]: Admin QA
            - generic [ref=e105]: N/A
        - generic [ref=e107]:
          - generic [ref=e108]: Recibo
          - generic [ref=e109]:
            - generic [ref=e110]: Adjunto (sin vista previa) · application/json
            - generic [ref=e111]:
              - button "Abrir archivo" [ref=e112] [cursor=pointer]
              - button "Descargar" [ref=e113] [cursor=pointer]
        - generic [ref=e114]:
          - generic [ref=e115]: Seguimiento
          - generic [ref=e119]:
            - generic [ref=e120]:
              - text: Enviado
              - generic [ref=e121]: · User QA
            - generic [ref=e122]: 09 may 2026
          - generic [ref=e123]:
            - textbox "Añadir una nota…" [ref=e124]
            - button "Añadir nota" [ref=e125] [cursor=pointer]
```

# Test source

```ts
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
  1046 |     await expect(exportSelect.locator('option[value="pdf"]')).toHaveText(/Exportar PDF/);
  1047 |   });
  1048 | 
  1049 |   test('E1) Seguimiento shows submission event', async ({ page }) => {
  1050 |     await setupMockApi(page);
  1051 |     await loginAs(page, 'user@solana.test');
  1052 |     await createExpenseViaUi(page, 'Trail E1', '12');
> 1053 |     await page.getByText('Trail E1').click();
       |                                      ^ Error: locator.click: Error: strict mode violation: getByText('Trail E1') resolved to 4 elements:
  1054 |     await expect(page.getByText('Seguimiento')).toBeVisible();
  1055 |     await expect(page.getByText(/Enviado/).first()).toBeVisible();
  1056 |   });
  1057 | 
  1058 |   test('E2) Seguimiento shows approval event after approval', async ({ page }) => {
  1059 |     await setupMockApi(page);
  1060 |     await loginAs(page, 'admin@solana.test');
  1061 |     await createExpenseViaUi(page, 'Trail E2', '44');
  1062 |     await page.getByText('Aprobaciones').first().click();
  1063 |     await page.getByRole('button', { name: 'Revisar' }).first().click();
  1064 |     await page.getByRole('button', { name: 'Aprobar' }).click();
  1065 |     await expect(page.getByText(/Aprobado · Admin QA/).first()).toBeVisible();
  1066 |   });
  1067 | 
  1068 |   test('E3) Note added via Añadir nota appears in Seguimiento', async ({ page }) => {
  1069 |     await setupMockApi(page);
  1070 |     await loginAs(page, 'admin@solana.test');
  1071 |     await createExpenseViaUi(page, 'Trail E3', '33');
  1072 |     await page.getByText('Trail E3').click();
  1073 |     const note = 'Nota selenium única XYZ';
  1074 |     await page.locator('.panel-slide').getByPlaceholder(/nota/i).fill(note);
  1075 |     await page.locator('.panel-slide').getByRole('button', { name: 'Añadir nota' }).click();
  1076 |     await expect(page.getByText(note)).toBeVisible();
  1077 |   });
  1078 | 
  1079 |   test('F1) Draft persists when navigating away mid-form', async ({ page }) => {
  1080 |     await setupMockApi(page);
  1081 |     await loginAs(page, 'admin@solana.test');
  1082 |     await page.getByText('Gastos', { exact: true }).first().click();
  1083 |     await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  1084 |     await page.getByPlaceholder('Concepto').fill('PERSIST DRAFT X');
  1085 |     await page.getByPlaceholder('0.00').fill('19,90');
  1086 |     await page.waitForTimeout(700);
  1087 | 
  1088 |     await page.getByText('Panel').first().click();
  1089 |     await page.getByText('Gastos', { exact: true }).first().click();
  1090 |     await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  1091 |     await expect(page.getByPlaceholder('Concepto')).toHaveValue('PERSIST DRAFT X');
  1092 |   });
  1093 | 
  1094 |   test('F2) Draft clears on successful submit', async ({ page }) => {
  1095 |     await setupMockApi(page);
  1096 |     await loginAs(page, 'admin@solana.test');
  1097 |     await page.getByText('Gastos', { exact: true }).first().click();
  1098 |     await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  1099 |     await page.getByPlaceholder('Concepto').fill('SUBMIT CLEAR');
  1100 |     await page.getByPlaceholder('0.00').fill('21');
  1101 |     await page.locator('label:has-text("Categoría") + select').first().selectOption({ index: 1 });
  1102 |     await page.locator('label:has-text("Departamento") + select').first().selectOption({ index: 1 });
  1103 |     await page.waitForTimeout(400);
  1104 |     await page.getByRole('button', { name: 'Enviar gasto' }).click();
  1105 |     await expect(page.getByText('SUBMIT CLEAR')).toBeVisible();
  1106 |     await page.getByRole('button', { name: '×' }).click().catch(() => {});
  1107 | 
  1108 |     await page.getByText('Gastos', { exact: true }).first().click();
  1109 |     await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  1110 |     await expect(page.getByPlaceholder('Concepto')).toHaveValue('');
  1111 |   });
  1112 | });
  1113 | 
```