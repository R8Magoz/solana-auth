import { expect, test, type BrowserContext, type Page } from '@playwright/test';

type Session = { userId: string; role: 'user' | 'admin' | 'superadmin' };
type Expense = {
  id: string;
  userId: string;
  description: string;
  amount: number;
  amountEUR: number;
  category: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected';
  approversJson: string;
  approvalVotesJson: string;
  updatedAt: number;
};

const AUTH_BASE = 'https://solana-auth.onrender.com';

function safeJson(raw: string | null): any {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function attachMockApi(page: Page, state: {
  tokens: Map<string, Session>;
  expenses: Expense[];
}) {
  await page.route(`${AUTH_BASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const auth = req.headerValue('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const session = token ? state.tokens.get(token) : null;
    const body = safeJson(req.postData());

    const json = (status: number, payload: any) =>
      route.fulfill({
        status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

    if (path === '/auth/refresh' && method === 'POST') {
      if (!session) return json(401, { error: 'Sesión expirada.' });
      return json(200, { ok: true, sessionToken: token, userId: session.userId, role: session.role });
    }
    if (path === '/auth/team' && method === 'GET') {
      return json(200, {
        ok: true,
        users: [
          { id: 'u_submitter', name: 'Submitter', email: 'submitter@qa.test', role: 'user', accountStatus: 'active' },
          { id: 'u_editor', name: 'Editor', email: 'editor@qa.test', role: 'user', accountStatus: 'active' },
          { id: 'u_admin', name: 'Admin', email: 'admin@qa.test', role: 'admin', accountStatus: 'active' },
        ],
      });
    }

    if (path === '/expenses' && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = `exp_cc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const exp: Expense = {
        id,
        userId: session.userId,
        description: String(body.description || 'Nueva compra'),
        amount: Number(body.amount || 0),
        amountEUR: Number(body.amount || 0),
        category: String(body.category || 'Software'),
        date: String(body.date || new Date().toISOString().slice(0, 10)),
        status: 'pending',
        approversJson: JSON.stringify(['u_admin']),
        approvalVotesJson: '{}',
        updatedAt: now,
      };
      state.expenses.unshift(exp);
      return json(200, { ok: true, expense: exp });
    }

    if (path === '/expenses' && method === 'GET') {
      if (!session) return json(401, { error: 'No autorizado.' });
      return json(200, { expenses: state.expenses });
    }

    if (/^\/expenses\/[^/]+\/approve$/.test(path) && method === 'POST') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = path.split('/')[2];
      const exp = state.expenses.find((e) => e.id === id);
      if (!exp) return json(404, { error: 'Gasto no encontrado.' });
      const votes = safeJson(exp.approvalVotesJson || '{}');
      votes[session.userId] = 'approved';
      exp.approvalVotesJson = JSON.stringify(votes);
      exp.status = 'approved';
      exp.updatedAt = Date.now();
      return json(200, { ok: true, expense: exp });
    }

    if (/^\/expenses\/[^/]+$/.test(path) && method === 'PUT') {
      if (!session) return json(401, { error: 'No autorizado.' });
      const id = path.split('/')[2];
      const exp = state.expenses.find((e) => e.id === id);
      if (!exp) return json(404, { error: 'Gasto no encontrado.' });

      // Simulate realistic re-approval behavior when a pending/approved item is edited.
      if (typeof body.description === 'string') exp.description = body.description.slice(0, 256);
      if (typeof body.amount === 'number') {
        exp.amount = body.amount;
        exp.amountEUR = body.amount;
      }
      exp.status = 'pending';
      exp.approvalVotesJson = '{}';
      exp.updatedAt = Date.now();
      return json(200, { ok: true, expense: exp });
    }

    return json(200, { ok: true });
  });
}

async function prepareUserPage(context: BrowserContext, token: string) {
  const page = await context.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem('sol-session-token', t);
  }, token);
  return page;
}

test('concurrent submit/approve/edit keeps consistent final state', async ({ browser }) => {
  const state = {
    tokens: new Map<string, Session>([
      ['tok_submitter', { userId: 'u_submitter', role: 'user' }],
      ['tok_admin', { userId: 'u_admin', role: 'admin' }],
      ['tok_editor', { userId: 'u_editor', role: 'user' }],
    ]),
    expenses: [] as Expense[],
  };

  const submitterCtx = await browser.newContext();
  const approverCtx = await browser.newContext();
  const editorCtx = await browser.newContext();

  const submitterPage = await prepareUserPage(submitterCtx, 'tok_submitter');
  const approverPage = await prepareUserPage(approverCtx, 'tok_admin');
  const editorPage = await prepareUserPage(editorCtx, 'tok_editor');

  await Promise.all([
    attachMockApi(submitterPage, state),
    attachMockApi(approverPage, state),
    attachMockApi(editorPage, state),
  ]);

  await Promise.all([
    submitterPage.goto('/'),
    approverPage.goto('/'),
    editorPage.goto('/'),
  ]);

  // 1) Submitter creates expense
  const createRes = await submitterPage.evaluate(async () => {
    const tok = localStorage.getItem('sol-session-token');
    const r = await fetch('https://solana-auth.onrender.com/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify({
        description: 'Concurrent Laptop Purchase',
        amount: 1000,
        category: 'Software',
        date: '2026-04-17',
      }),
    });
    return r.json();
  });
  const expenseId = createRes?.expense?.id as string;
  expect(expenseId).toBeTruthy();

  // 2) Approver approves while 3) Editor edits the same item concurrently
  await Promise.all([
    approverPage.evaluate(async (id) => {
      const tok = localStorage.getItem('sol-session-token');
      await fetch(`https://solana-auth.onrender.com/expenses/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Aprobado por admin en prueba concurrente' }),
      });
    }, expenseId),
    editorPage.evaluate(async (id) => {
      const tok = localStorage.getItem('sol-session-token');
      await fetch(`https://solana-auth.onrender.com/expenses/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Concurrent Laptop Purchase (edited)', amount: 1100 }),
      });
    }, expenseId),
  ]);

  // Final-state consistency assertions from shared state:
  const final = state.expenses.find((e) => e.id === expenseId);
  expect(final).toBeTruthy();
  expect(final?.description).toContain('(edited)');
  expect(final?.amountEUR).toBe(1100);

  // If edited after approval, approval votes should be reset and status pending (re-approval required).
  expect(final?.status).toBe('pending');
  expect(final?.approvalVotesJson).toBe('{}');

  await Promise.all([submitterCtx.close(), approverCtx.close(), editorCtx.close()]);
});

