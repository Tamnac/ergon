import { expect, test, type Page } from '@playwright/test';
import { addTodos, day, openApp, todo, todoAction } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

async function repeatDaily(page: Page, text: string) {
  await todoAction(todo(day(page), text), 'Repeat');
  const dialog = page.getByRole('dialog', { name: 'Repeat' });
  await dialog.getByRole('combobox', { name: 'Repeat' }).selectOption('daily');
  await expect(dialog.getByLabel('Next dates')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
}

const choose = (page: Page, title: string, scope: string) =>
  page.getByRole('dialog', { name: title }).getByRole('button', { name: scope }).click();

async function edit(page: Page, offset: number, from: string, to: string) {
  await todo(day(page, offset), from).locator('.todo-text').click();
  const input = day(page, offset).getByRole('textbox', { name: 'Edit todo' });
  await input.fill(to);
  await input.press('Enter');
}

test('repeats a todo and changes single occurrences', async ({ page }) => {
  await addTodos(day(page), 'Water plants');
  await repeatDaily(page, 'Water plants');
  for (const offset of [0, 1, 2, 3, 4]) {
    await expect(todo(day(page, offset), 'Water plants')).toBeVisible();
  }

  await todoAction(todo(day(page, 1), 'Water plants'), 'Mark done');
  await expect(todo(day(page, 1), 'Water plants')).toHaveClass(/is-done/);
  await expect(todo(day(page, 2), 'Water plants')).not.toHaveClass(/is-done/);

  await edit(page, 2, 'Water plants', 'Water the cactus');
  await choose(page, 'Edit repeating todo', 'Only this one');
  await expect(todo(day(page, 2), 'Water the cactus')).toBeVisible();
  await expect(todo(day(page, 3), 'Water plants')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(todo(day(page, 2), 'Water plants')).toBeVisible();

  await todoAction(todo(day(page, 3), 'Water plants'), 'Delete');
  await choose(page, 'Delete repeating todo', 'Only this one');
  await expect(todo(day(page, 3), 'Water plants')).toHaveCount(0);
  await expect(todo(day(page, 4), 'Water plants')).toBeVisible();

  await page.reload();
  await expect(todo(day(page, 1), 'Water plants')).toHaveClass(/is-done/);
  await expect(todo(day(page, 3), 'Water plants')).toHaveCount(0);
  await expect(todo(day(page, 4), 'Water plants')).toBeVisible();
});

test('edits and deletes following occurrences', async ({ page }) => {
  await addTodos(day(page), '# Gym');
  await repeatDaily(page, 'Gym');
  await expect(todo(day(page, 4), 'Gym')).toHaveClass(/is-heading/);

  await edit(page, 2, 'Gym', '# Pool');
  await choose(page, 'Edit repeating todo', 'This and following');
  await expect(todo(day(page, 1), 'Gym')).toBeVisible();
  await expect(todo(day(page, 2), 'Pool')).toBeVisible();
  await expect(todo(day(page, 4), 'Pool')).toBeVisible();

  await edit(page, 3, 'Pool', 'Swim');
  await choose(page, 'Edit repeating todo', 'All');
  await expect(todo(day(page, 2), 'Swim')).toBeVisible();
  await expect(todo(day(page, 1), 'Gym')).toBeVisible();

  await todo(day(page, 3), 'Swim').focus();
  await page.keyboard.press('Delete');
  await choose(page, 'Delete repeating todo', 'This and following');
  await expect(todo(day(page, 3), 'Swim')).toHaveCount(0);
  await expect(todo(day(page, 4), 'Swim')).toHaveCount(0);
  await expect(todo(day(page, 2), 'Swim')).toBeVisible();
});

test('stops repeating', async ({ page }) => {
  await addTodos(day(page), 'Stretch');
  await repeatDaily(page, 'Stretch');
  await todo(day(page, 2), 'Stretch').focus();
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: 'Repeat' });
  await expect(dialog.getByRole('combobox', { name: 'Repeat' })).toHaveValue('daily');
  await dialog.getByRole('combobox', { name: 'Repeat' }).selectOption('none');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(todo(day(page, 2), 'Stretch')).toBeVisible();
  await expect(todo(day(page, 2), 'Stretch').getByRole('button', { name: 'Repeat' })).toHaveCount(
    0,
  );
  await expect(todo(day(page, 3), 'Stretch')).toHaveCount(0);
  await expect(todo(day(page, 1), 'Stretch')).toBeVisible();
});
