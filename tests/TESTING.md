# Automated Testing (Critical Flows)

This repository now includes Playwright end-to-end tests for critical business flows.

## What is covered

- Login + session restore handling
- Expense lifecycle: create -> approve -> report visibility
- Offline write queue -> online sync consistency
- Role-based permissions (read-only approvals for regular users)
- Bill lifecycle: create -> approve

## Files added

- `playwright.config.ts`
- `tests/e2e/critical-flows.spec.ts`
- `package.json` (test tooling scripts/deps at repo root)

## Setup

From `solana/`:

```bash
npm install
npx playwright install
```

## Run tests

```bash
npm run test:e2e
```

Optional:

```bash
npm run test:e2e:ui
npm run test:e2e:headed
npm run test:e2e:debug
```

## Notes

- Tests run against `frontend/index.html` served locally by Playwright web server (`http-server`).
- API calls are mocked in-memory by intercepting `https://solana-auth.onrender.com/**`.
- No real backend is required for these tests.

## Manual test gaps (recommended)

- Real Cloudinary upload/download behavior with large files and slow networks
- Cross-browser mobile camera/capture flow
- Real Render downtime/retry behavior under production latency
- Data migration compatibility with legacy localStorage payloads
- Accessibility pass (keyboard-only + screen reader announcements)
