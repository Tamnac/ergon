import { expect, test, type Page } from '@playwright/test';
import { addTodos, dateStr, day, openApp, todo } from './helpers';

const searchDialog = (page: Page) => page.getByRole('dialog', { name: 'Search' });

async function search(page: Page, text: string) {
  await page.keyboard.press('/');
  await expect(searchDialog(page)).toBeVisible();
  const input = searchDialog(page).getByRole('combobox', { name: 'Search todos and lists' });
  await expect(input).toBeFocused();
  await input.fill(text);
  return input;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('finds a todo on another day and focuses it', async ({ page }) => {
  await page.getByRole('button', { name: 'Next week' }).click();
  await addTodos(page.locator(`.column[data-target="date:${dateStr(7)}"]`), 'Renew passport');
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(day(page, 7)).toHaveCount(0);

  const input = await search(page, 'passport');
  await expect(searchDialog(page).getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  await expect(todo(day(page, 7), 'Renew passport')).toBeFocused();
});

test('finds list todos and lists with Ctrl+K', async ({ page }) => {
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByRole('textbox', { name: 'New list name' }).fill('Groceries');
  await page.getByRole('textbox', { name: 'New list name' }).press('Enter');
  const list = page.locator('.list-column', { hasText: 'Groceries' });
  await addTodos(list, 'Limes');
  await addTodos(day(page), 'Water limes');

  await page.keyboard.press('Control+k');
  const dialog = searchDialog(page);
  await dialog.getByRole('combobox').fill('lime');
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await dialog.getByRole('combobox').press('ArrowDown');
  await expect(dialog.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('option').filter({ hasText: 'Groceries' }).click();
  await expect(todo(list, 'Limes')).toBeFocused();

  await search(page, 'Grocer');
  await expect(searchDialog(page).getByRole('option')).toHaveText([/^GroceriesPersonal$/]);
});

test('says when nothing matches', async ({ page }) => {
  await search(page, 'zzz');
  await expect(searchDialog(page).getByRole('status')).toContainText('Nothing found');
});
