import { expect, test } from '@playwright/test';
import { addTodos, day, drag, openApp, todo } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('reorders within a day', async ({ page }) => {
  await addTodos(day(page), 'A', 'B', 'C');
  await drag(page, todo(day(page), 'C'), todo(day(page), 'A'), 0.2);
  await expect(day(page).locator('.todo')).toHaveText(['C', 'A', 'B']);
  await page.reload();
  await expect(day(page).locator('.todo')).toHaveText(['C', 'A', 'B']);
});

test('moves between days', async ({ page }) => {
  await addTodos(day(page), 'Move me', 'Stay');
  await drag(page, todo(day(page), 'Move me'), day(page, 2).locator('.todo-filler').first());
  await expect(todo(day(page, 2), 'Move me')).toBeVisible();
  await expect(day(page).locator('.todo')).toHaveText(['Stay']);
});

test('moves between days and lists', async ({ page }) => {
  await page.getByRole('button', { name: '+ New list' }).click();
  await page.getByRole('textbox', { name: 'New list name' }).fill('Someday');
  await page.getByRole('textbox', { name: 'New list name' }).press('Enter');
  const list = page.locator('.list-column', { hasText: 'Someday' });
  await expect(list).toBeVisible();

  await addTodos(day(page), 'Learn piano');
  await drag(page, todo(day(page), 'Learn piano'), list.locator('.todo-filler').first());
  await expect(todo(list, 'Learn piano')).toBeVisible();
  await expect(day(page).locator('.todo')).toHaveCount(0);

  await drag(page, todo(list, 'Learn piano'), day(page, 1).locator('.todo-filler').first());
  await expect(todo(day(page, 1), 'Learn piano')).toBeVisible();
  await expect(list.locator('.todo')).toHaveCount(0);
});
