import { expect, test } from '@playwright/test';
import { setupMockApi } from './helpers/mockApi';

test('favicon links resolve and return brand mark assets', async ({ page }) => {
  await setupMockApi(page);
  await page.goto('/');

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]'))
      .map((el) => (el as HTMLLinkElement).href),
  );
  expect(hrefs.some((h) => h.includes('favicon.ico'))).toBe(true);
  expect(hrefs.some((h) => h.includes('favicon-32.png'))).toBe(true);
  expect(hrefs.some((h) => h.includes('apple-touch-icon.png'))).toBe(true);

  const base = new URL(page.url()).origin;
  for (const path of ['/favicon-32.png', '/favicon.ico', '/apple-touch-icon.png']) {
    const res = await page.request.get(base + path);
    expect(res.ok(), path).toBeTruthy();
    const ct = res.headers()['content-type'] || '';
    expect(ct.includes('image') || ct.includes('icon')).toBeTruthy();
  }

  const themeColor = await page.evaluate(() =>
    document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  );
  expect(themeColor?.toUpperCase()).toBe('#BC575D');
});
