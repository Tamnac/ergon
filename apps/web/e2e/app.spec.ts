import { expect, test } from '@playwright/test';
import { dateStr, day, openApp } from './helpers';

test('shows the day grid and lists', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle('Ergon');
  await expect(day(page).locator('.day-header')).toHaveClass(/is-today/);
  await expect(page.locator('.column[data-target^="date:"]')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '+ New list' })).toBeVisible();
});

test('navigates days with buttons and keys', async ({ page }) => {
  await openApp(page);
  const firstDay = page.locator('.column[data-target^="date:"]').first();

  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(firstDay).toHaveAttribute('data-target', `date:${dateStr(1)}`);
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(firstDay).toHaveAttribute('data-target', `date:${dateStr(-6)}`);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(firstDay).toHaveAttribute('data-target', `date:${dateStr(0)}`);

  await page.keyboard.press('ArrowRight');
  await expect(firstDay).toHaveAttribute('data-target', `date:${dateStr(1)}`);
  await page.keyboard.press('t');
  await expect(firstDay).toHaveAttribute('data-target', `date:${dateStr(0)}`);

  await page.getByLabel('Go to date').fill(dateStr(30));
  await expect(firstDay).toHaveAttribute('data-target', `date:${dateStr(30)}`);
});

test('changes the number of visible days', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '3 days' }).click();
  await expect(page.locator('.column[data-target^="date:"]')).toHaveCount(3);
  await page.keyboard.press('1');
  await expect(page.locator('.column[data-target^="date:"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.column[data-target^="date:"]')).toHaveCount(1);
});

test('applies and persists settings', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByRole('button', { name: '#e11d48' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('style', /--accent: #e11d48/);
});
