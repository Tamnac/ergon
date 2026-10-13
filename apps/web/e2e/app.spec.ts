import { expect, test, type Page } from '@playwright/test';
import { addTodos, dateStr, day, openApp } from './helpers';

const dayColumns = (page: Page) => page.locator('.column[data-target^="date:"]');

test('shows the day grid and lists', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle('Ergon');
  await expect(day(page).locator('.day-header')).toHaveClass(/is-today/);
  await expect(dayColumns(page)).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'New list' })).toBeVisible();
});

test('navigates days with buttons and keys', async ({ page }) => {
  await openApp(page);
  const firstDay = dayColumns(page).first();

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
});

test('jumps to a date and shows todo marks in the calendar', async ({ page }) => {
  await openApp(page);
  await addTodos(day(page), 'One', 'Two', '# Heading');
  await page.getByRole('button', { name: 'Calendar' }).click();
  const calendar = page.getByRole('dialog', { name: 'Calendar' });
  const todayCell = calendar.locator(`[data-date="${dateStr(0)}"]`);
  await expect(todayCell).toBeFocused();
  await expect(todayCell).toHaveAccessibleName(/, 2 todos$/);
  await expect(todayCell.locator('.calendar-mark')).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();

  await page.getByRole('button', { name: 'Calendar' }).click();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(calendar.locator(`[data-date="${dateStr(30)}"]`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(calendar).toBeHidden();
  await expect(dayColumns(page).first()).toHaveAttribute('data-target', `date:${dateStr(30)}`);
});

test('shows several months in a wide calendar and one in a narrow one', async ({ page }) => {
  await openApp(page);
  const calendar = page.getByRole('dialog', { name: 'Calendar' });
  await page.getByRole('button', { name: 'Calendar' }).click();
  await expect(calendar.locator('.calendar-month')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();

  await page.setViewportSize({ width: 400, height: 800 });
  await page.getByRole('button', { name: 'Calendar' }).click();
  await expect(calendar.locator('.calendar-month')).toHaveCount(1);
});

test('toggles the shortcuts with Ctrl+/', async ({ page }) => {
  await openApp(page);
  const help = page.getByRole('dialog', { name: 'Shortcuts' });
  await page.keyboard.press('Control+/');
  await expect(help).toBeVisible();
  await page.keyboard.press('Control+/');
  await expect(help).toBeHidden();
  await page.keyboard.press('?');
  await expect(help).toBeVisible();
});

test('changes the number of visible days', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('radio', { name: '3' }).check();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dayColumns(page)).toHaveCount(3);
  await page.keyboard.press('1');
  await expect(dayColumns(page)).toHaveCount(1);
  await page.reload();
  await expect(dayColumns(page)).toHaveCount(1);
});

test('caps the day count by width and switches views on phones', async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(dayColumns(page)).toHaveCount(2);

  await page.setViewportSize({ width: 400, height: 800 });
  await expect(dayColumns(page)).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /Personal/ })).toBeHidden();

  await page.getByRole('button', { name: 'Lists' }).click();
  await expect(dayColumns(page)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Personal/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New list' })).toBeVisible();

  await page.getByRole('button', { name: 'Days' }).click();
  await expect(dayColumns(page)).toHaveCount(1);
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
