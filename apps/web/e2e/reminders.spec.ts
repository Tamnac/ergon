import { expect, test, type Page } from '@playwright/test';
import { addTodos, day, openApp, todo } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

async function remindAt(
  page: Page,
  offset: number,
  text: string,
  time: string,
  scope?: 'This and following',
) {
  await todo(day(page, offset), text).getByRole('button', { name: 'Reminder' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reminder' });
  await dialog.getByLabel('Remind me at').fill(time);
  if (scope) await dialog.getByLabel(scope).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
}

const reminder = (page: Page, offset: number, text: string) =>
  todo(day(page, offset), text).locator('.todo-reminder-time');

test('sets and removes a reminder', async ({ page }) => {
  await addTodos(day(page), 'Call dentist');
  await expect(reminder(page, 0, 'Call dentist')).toHaveCount(0);

  await remindAt(page, 0, 'Call dentist', '09:30');
  await expect(reminder(page, 0, 'Call dentist')).toContainText('9:30');

  await page.reload();
  await expect(reminder(page, 0, 'Call dentist')).toContainText('9:30');

  await todo(day(page), 'Call dentist').getByRole('button', { name: 'Reminder' }).click();
  await page
    .getByRole('dialog', { name: 'Reminder' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(reminder(page, 0, 'Call dentist')).toHaveCount(0);
});

test('opens the reminder dialog with B', async ({ page }) => {
  await addTodos(day(page), 'Pay rent');
  await todo(day(page), 'Pay rent').focus();
  await page.keyboard.press('b');
  await expect(page.getByRole('dialog', { name: 'Reminder' })).toBeVisible();
});

test('opens the reminder dialog beside the todo', async ({ page }) => {
  await addTodos(day(page), 'Pay rent');
  const row = (await todo(day(page), 'Pay rent').boundingBox())!;
  await todo(day(page), 'Pay rent').getByRole('button', { name: 'Reminder' }).click();
  const dialog = (await page.getByRole('dialog', { name: 'Reminder' }).boundingBox())!;
  expect(dialog.x).toBeGreaterThanOrEqual(row.x + row.width);
  expect(dialog.y).toBeLessThanOrEqual(row.y + row.height);
  expect(dialog.y + dialog.height).toBeGreaterThanOrEqual(row.y);
});

test('sets a reminder on following occurrences of a repeating todo', async ({ page }) => {
  await addTodos(day(page), 'Stretch');
  await todo(day(page), 'Stretch').getByRole('button', { name: 'Repeat' }).click();
  const repeat = page.getByRole('dialog', { name: 'Repeat' });
  await repeat.getByRole('combobox', { name: 'Repeat' }).selectOption('daily');
  await repeat.getByRole('button', { name: 'Save' }).click();
  await expect(todo(day(page, 2), 'Stretch')).toBeVisible();

  await remindAt(page, 1, 'Stretch', '07:15', 'This and following');

  await expect(reminder(page, 0, 'Stretch')).toHaveCount(0);
  for (const offset of [1, 2, 3]) {
    await expect(reminder(page, offset, 'Stretch')).toContainText('7:15');
  }
});
