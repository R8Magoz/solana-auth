# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> F1) Draft persists when navigating away mid-form
- Location: tests/e2e/critical-flows.spec.ts:1079:7

# Error details

```
Error: locator.fill: Error: strict mode violation: getByPlaceholder('Concepto') resolved to 2 elements:
    1) <input value="" class="inp" placeholder="Concepto"/> aka getByRole('textbox', { name: 'Concepto' })
    2) <input value="" class="inp" placeholder="Concepto"/> aka getByPlaceholder('Concepto').nth(1)

Call log:
  - waiting for getByPlaceholder('Concepto')

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
        - button "Nuevo gasto" [active] [ref=e44] [cursor=pointer]
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
            - textbox "Concepto" [ref=e59]
          - generic [ref=e61] [cursor=pointer]:
            - checkbox "Factura de proveedor" [ref=e62]
            - generic [ref=e63]: Factura de proveedor
          - generic [ref=e64]:
            - generic [ref=e65]: Importe *
            - textbox "0.00" [ref=e66]
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
            - generic [ref=e91]: 0,00 €
          - generic [ref=e92]:
            - generic [ref=e93]: Cuota IVA
            - generic [ref=e94]: 0,00 €
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
> 1084 |     await page.getByPlaceholder('Concepto').fill('PERSIST DRAFT X');
       |                                             ^ Error: locator.fill: Error: strict mode violation: getByPlaceholder('Concepto') resolved to 2 elements:
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