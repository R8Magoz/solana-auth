# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> Critical business flows >> C3) Regular user can access Mi perfil and change password
- Location: tests/e2e/critical-flows.spec.ts:901:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.panel-slide').getByPlaceholder(/actual|current/i)
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('.panel-slide').getByPlaceholder(/actual|current/i)

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
    - heading "Mi perfil" [level=1] [ref=e37]
    - generic [ref=e39] [cursor=pointer]:
      - generic [ref=e41]: Mi perfil
      - generic [ref=e42]: ▼
    - generic [ref=e43]:
      - generic [ref=e44] [cursor=pointer]:
        - generic [ref=e46]: Cambiar contraseña
        - generic [ref=e47]: ▼
      - generic [ref=e48]:
        - paragraph [ref=e49]: Protege tu cuenta con una contraseña.
        - generic [ref=e50]:
          - generic [ref=e51]:
            - generic [ref=e52]: Contraseña actual
            - textbox [ref=e53]
          - generic [ref=e54]:
            - generic [ref=e55]: Nueva contraseña
            - textbox [ref=e56]
          - generic [ref=e57]:
            - generic [ref=e58]: Confirmar contraseña
            - textbox [ref=e59]
        - button "Establecer contraseña" [ref=e60] [cursor=pointer]
    - generic [ref=e62]: Data schema v6 · 2026
```

# Test source

```ts
  807  |       description: 'Gasto admin only',
  808  |       amount: 90,
  809  |       amountEUR: 90,
  810  |       expenseType: 'expense',
  811  |       status: 'submitted',
  812  |       approversJson: JSON.stringify(['admin-1']),
  813  |       approvalVotesJson: '{}',
  814  |       ownerId: 'admin-1',
  815  |       paidByJson: JSON.stringify([{ userId: 'admin-1', amount: 90 }]),
  816  |       category: 'Software',
  817  |       notes: '',
  818  |       receiptPath: null,
  819  |       departmentId: 'dept_ops',
  820  |       createdAt: Date.now(),
  821  |       updatedAt: Date.now(),
  822  |       paymentStatus: 'na',
  823  |       deferredPayment: false,
  824  |       paymentTermDays: 0,
  825  |       auditTrailJson: '[]',
  826  |       commentsJson: '[]',
  827  |       rejectionNote: null,
  828  |     };
  829  |     const e2: ExpenseRow = {
  830  |       id: 'c1_user',
  831  |       userId: 'user-1',
  832  |       date: '2026-03-02',
  833  |       description: 'Gasto usuario only',
  834  |       amount: 44,
  835  |       amountEUR: 44,
  836  |       expenseType: 'expense',
  837  |       status: 'approved',
  838  |       approversJson: JSON.stringify(['admin-1']),
  839  |       approvalVotesJson: JSON.stringify({ 'admin-1': 'approved' }),
  840  |       ownerId: 'user-1',
  841  |       paidByJson: JSON.stringify([{ userId: 'user-1', amount: 44 }]),
  842  |       category: 'Supplies',
  843  |       notes: '',
  844  |       receiptPath: null,
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
> 907  |     await expect(page.locator('.panel-slide').getByPlaceholder(/actual|current/i)).toBeVisible();
       |                                                                                    ^ Error: expect(locator).toBeVisible() failed
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
```