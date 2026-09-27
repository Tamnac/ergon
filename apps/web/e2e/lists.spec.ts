import { expect, test, type Page } from '@playwright/test';
import { addTodos, openApp, todo } from './helpers';

async function addList(page: Page, name: string) {
  await page.getByRole('button', { name: 'New list' }).click();
  const input = page.getByRole('textbox', { name: 'New list name' });
  await input.fill(name);
  await input.press('Enter');
  await expect(page.locator('.list-name', { hasText: name })).toBeVisible();
}

const listColumn = (page: Page, name: string) => page.locator('.list-column', { hasText: name });

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('creates, fills, renames, reorders and deletes lists', async ({ page }) => {
  await addList(page, 'Groceries');
  await addList(page, 'Books');
  await addTodos(listColumn(page, 'Groceries'), 'Limes', 'Avocados');

  await page.locator('.list-name', { hasText: 'Books' }).click();
  const rename = page.getByRole('textbox', { name: 'List name' });
  await rename.fill('Reading');
  await rename.press('Enter');
  await expect(page.locator('.list-name')).toHaveText(['Groceries', 'Reading']);

  await listColumn(page, 'Reading').getByRole('button', { name: 'List actions' }).click();
  await page.getByRole('menuitem', { name: 'Move left' }).click();
  await expect(page.locator('.list-name')).toHaveText(['Reading', 'Groceries']);

  await page.reload();
  await expect(page.locator('.list-name')).toHaveText(['Reading', 'Groceries']);
  await expect(listColumn(page, 'Groceries').locator('.todo')).toHaveText(['Limes', 'Avocados']);

  await listColumn(page, 'Groceries').getByRole('button', { name: 'List actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete list' }).click();
  await expect(page.locator('.list-name')).toHaveText(['Reading']);
});

test('adds tabs and moves lists between them', async ({ page }) => {
  await addList(page, 'Recipes');
  await page.getByRole('button', { name: 'Add tab' }).click();
  await page.getByRole('textbox', { name: 'New tab name' }).fill('Someday');
  await page.getByRole('textbox', { name: 'New tab name' }).press('Enter');

  const someday = page.getByRole('tab', { name: /Someday/ });
  await expect(someday).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.list-name')).toHaveCount(0);

  await page.getByRole('tab', { name: /Personal/ }).click();
  await listColumn(page, 'Recipes').getByRole('button', { name: 'List actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Someday' }).click();
  await expect(page.locator('.list-name')).toHaveCount(0);
  await someday.click();
  await expect(page.locator('.list-name')).toHaveText(['Recipes']);
  await expect(todo(page, 'anything')).toHaveCount(0);
});

test('collapses the lists panel', async ({ page }) => {
  await page.getByRole('button', { name: 'Hide lists' }).click();
  await expect(page.getByRole('button', { name: 'New list' })).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Show lists' }).click();
  await expect(page.getByRole('button', { name: 'New list' })).toBeVisible();
});
