import { expect, test } from '@playwright/test';
import { addTodos, day, openApp, todo } from './helpers';

test('opens offline after the first visit', async ({ page, context }) => {
  await openApp(page);
  await addTodos(day(page), 'Still here');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(async () => (await caches.keys()).some((key) => key.startsWith('ergon-'))),
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(todo(day(page), 'Still here')).toBeVisible();
});

test('is installable', async ({ page, request }) => {
  await openApp(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await request.get(new URL(href!, page.url()).href);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: 'Ergon', display: 'standalone' });
  for (const icon of manifest.icons) {
    expect((await request.get(new URL(icon.src, page.url()).href)).ok()).toBe(true);
  }
});
