import { expect, test } from '@playwright/test';
import { addTodos, day, openApp, todo, todoAction } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('adds todos that survive a reload', async ({ page }) => {
  await addTodos(day(page), 'Buy milk', 'Call mom');
  await page.reload();
  await expect(day(page).locator('.todo')).toHaveText(['Buy milk', 'Call mom']);
});

test('edits, completes, undoes and deletes', async ({ page }) => {
  const today = day(page);
  await addTodos(today, 'Write report');

  await todo(today, 'Write report').locator('.todo-text').click();
  const input = today.getByRole('textbox', { name: 'Edit todo' });
  await input.fill('Write the report');
  await input.press('Enter');
  await expect(todo(today, 'Write the report')).toBeVisible();

  await todoAction(todo(today, 'Write the report'), 'Mark done');
  await expect(todo(today, 'Write the report')).toHaveClass(/is-done/);

  await page.locator('body').press('Control+z');
  await expect(todo(today, 'Write the report')).not.toHaveClass(/is-done/);

  await todoAction(todo(today, 'Write the report'), 'Delete');
  await expect(today.locator('.todo')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(todo(today, 'Write the report')).toBeVisible();
});

test('completes with a right click and not with a checkbox', async ({ page }) => {
  await addTodos(day(page), 'Water plants', '# Evening');
  await expect(
    todo(day(page), 'Water plants').getByRole('button', { name: 'Mark done' }),
  ).toBeHidden();

  await todo(day(page), 'Water plants').locator('.todo-text').click({ button: 'right' });
  await expect(todo(day(page), 'Water plants')).toHaveClass(/is-done/);
  await todo(day(page), 'Water plants').locator('.todo-text').click({ button: 'right' });
  await expect(todo(day(page), 'Water plants')).not.toHaveClass(/is-done/);

  await todo(day(page), 'Evening').click({ button: 'right' });
  await expect(todo(day(page), 'Evening')).not.toHaveClass(/is-done/);
});

test('opens the todo menu with the context menu key', async ({ page }) => {
  await addTodos(day(page), 'Water plants');
  await todo(day(page), 'Water plants').focus();
  await page.keyboard.press('ContextMenu');
  await page.getByRole('menuitem', { name: 'Mark done' }).click();
  await expect(todo(day(page), 'Water plants')).toHaveClass(/is-done/);
});

test('creates headings and renders links', async ({ page }) => {
  await addTodos(day(page), '# Afternoon', 'Read https://example.com/post');
  await expect(todo(day(page), 'Afternoon')).toHaveClass(/is-heading/);
  await expect(day(page).getByRole('link', { name: 'https://example.com/post' })).toHaveAttribute(
    'href',
    'https://example.com/post',
  );
});

test('works from the keyboard', async ({ page }) => {
  await page.keyboard.press('n');
  const input = day(page).getByRole('textbox', { name: 'New todo' });
  await input.fill('First');
  await input.press('Enter');
  await input.fill('Second');
  await input.press('Enter');
  await expect(todo(day(page), 'Second')).toBeVisible();
  await input.press('Escape');

  await todo(day(page), 'First').focus();
  await page.keyboard.press('ArrowDown');
  await expect(todo(day(page), 'Second')).toBeFocused();
  await page.keyboard.press(' ');
  await expect(todo(day(page), 'Second')).toHaveClass(/is-done/);

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('>');
  await expect(todo(day(page, 1), 'First')).toBeVisible();
  await expect(todo(day(page, 1), 'First')).toBeFocused();

  await page.keyboard.press('Enter');
  const edit = day(page, 1).getByRole('textbox', { name: 'Edit todo' });
  await edit.fill('First, edited');
  await edit.press('Enter');
  await expect(todo(day(page, 1), 'First, edited')).toBeFocused();

  await page.keyboard.press('Delete');
  await expect(day(page, 1).locator('.todo')).toHaveCount(0);
});
