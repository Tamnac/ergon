import { expect, test, type Page } from '@playwright/test';
import { addTodos, day, openApp, todo, todoAction } from './helpers';

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog', { name: 'Settings' });
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('exports JSON and Markdown', async ({ page }) => {
  await addTodos(day(page), 'Write report', '# Evening');
  await todoAction(todo(day(page), 'Write report'), 'Mark done');
  const settings = await openSettings(page);

  const markdown = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Export Markdown' }).click();
  const file = await markdown;
  expect(file.suggestedFilename()).toMatch(/^ergon-\d{4}-\d{2}-\d{2}\.md$/);
  const text = (await (await file.createReadStream()).toArray()).join('');
  expect(text).toContain('- [x] Write report');
  expect(text).toContain('**Evening**');

  const json = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Export JSON' }).click();
  const backup = JSON.parse((await (await (await json).createReadStream()).toArray()).join(''));
  expect(backup.format).toBe('ergon');
  expect(backup.todos.map((t: { text: string }) => t.text)).toContain('Write report');
});

test('imports a TeuxDeux backup and undoes it', async ({ page }) => {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const csv = [
    'Date,List Set Title,List Title,Position,Text,Complete',
    `${date},,,0,"Call mom, then dad",Yes`,
    ',Someday,Movies,0,# Sci-fi,',
    ',Someday,Movies,1,Akira,',
  ].join('\n');

  await addTodos(day(page), 'Already here');
  const settings = await openSettings(page);
  await settings.getByLabel('TeuxDeux backup file').setInputFiles({
    name: 'data.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(settings.getByRole('status')).toHaveText('Imported 3 todos and 1 list.');
  await settings.getByRole('button', { name: 'Close' }).click();

  await expect(day(page).locator('.todo')).toHaveText(['Already here', 'Call mom, then dad']);
  await expect(todo(day(page), 'Call mom, then dad')).toHaveClass(/is-done/);
  await page.getByRole('tab', { name: /Someday/ }).click();
  await expect(page.locator('.list-name')).toHaveText(['Movies']);
  await expect(page.locator('.list-column .todo')).toHaveText(['Sci-fi', 'Akira']);
  await expect(page.locator('.list-column .todo').first()).toHaveClass(/is-heading/);

  await page.keyboard.press('Control+z');
  await expect(page.getByRole('tab', { name: /Someday/ })).toHaveCount(0);
  await expect(day(page).locator('.todo')).toHaveText(['Already here']);
});

test('rejects files that are not TeuxDeux backups', async ({ page }) => {
  const settings = await openSettings(page);
  await settings.getByLabel('TeuxDeux backup file').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": 1}'),
  });
  await expect(settings.getByRole('alert')).toHaveText('This is not a TeuxDeux export.');
});
