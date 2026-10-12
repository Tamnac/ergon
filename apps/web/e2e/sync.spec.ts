import { expect, test, type Browser, type Page } from '@playwright/test';
import { addTodos, day, openApp, todo } from './helpers';

/** A separate browser context, so a separate local database: another device. */
async function newDevice(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await openApp(page);
  return page;
}

const openSync = (page: Page) => page.getByRole('button', { name: /^Sync:/ }).click();

test('syncs todos between devices', async ({ browser }) => {
  const a = await newDevice(browser);
  await addTodos(day(a), 'Written on A');
  await openSync(a);
  await a.getByRole('button', { name: 'Create account' }).click();
  const phrase = (await a.locator('.sync-phrase').innerText()).trim().split(/\s+/);
  expect(phrase).toHaveLength(24);
  await a.getByRole('button', { name: 'I wrote it down' }).click();

  const b = await newDevice(browser);
  await addTodos(day(b), 'Written on B');
  await openSync(b);
  await b.getByText('Existing account').click();
  await b.getByRole('textbox', { name: 'Recovery phrase' }).fill(phrase.join(' '));
  await b.getByRole('button', { name: 'Sign in' }).click();
  await expect(b.getByRole('status')).toHaveText(/Synced/);
  await b.keyboard.press('Escape');

  await expect(todo(day(b), 'Written on A')).toBeVisible();
  await expect(todo(day(a), 'Written on B')).toBeVisible();

  await todo(day(a), 'Written on A').getByRole('button', { name: 'Mark done' }).click();
  await expect(todo(day(b), 'Written on A')).toHaveClass(/is-done/);
});

test('links a device with a one-time link', async ({ browser }) => {
  const a = await newDevice(browser);
  await addTodos(day(a), 'Linked todo');
  await openSync(a);
  await a.getByRole('button', { name: 'Create account' }).click();
  await a.getByRole('button', { name: 'I wrote it down' }).click();
  await openSync(a);
  await a.getByRole('button', { name: 'Show link' }).click();
  const url = await a.locator('.sync-qr + input').inputValue();

  const b = await browser.newPage();
  await b.goto(url);
  await b.getByRole('button', { name: 'Link device' }).click();
  await expect(b.getByRole('status')).toHaveText(/Synced/);
  await b.keyboard.press('Escape');
  await expect(todo(day(b), 'Linked todo')).toBeVisible();
  await openSync(b);
  await expect(b.locator('.sync-device')).toHaveCount(2);

  const c = await browser.newPage();
  await c.goto(url);
  await c.getByRole('button', { name: 'Link device' }).click();
  await expect(c.getByRole('alert')).toHaveText(/expired or was already used/);
});

test('uploads upcoming reminders without their text', async ({ browser }) => {
  const a = await newDevice(browser);
  await openSync(a);
  await a.getByRole('button', { name: 'Create account' }).click();
  await a.getByRole('button', { name: 'I wrote it down' }).click();
  await a.keyboard.press('Escape');

  await addTodos(day(a, 1), 'Secret errand');
  const upload = a.waitForRequest(
    (request) =>
      request.method() === 'PUT' &&
      request.url().endsWith('/api/v1/reminders') &&
      request.postData()?.includes('"at"') === true,
  );
  await todo(day(a, 1), 'Secret errand').getByRole('button', { name: 'Reminder' }).click();
  await a.getByRole('dialog', { name: 'Reminder' }).getByRole('button', { name: 'Save' }).click();

  const { reminders } = (await upload).postDataJSON() as {
    reminders: { id: string; data: string }[];
  };
  expect(reminders).toHaveLength(1);
  expect(JSON.stringify(reminders)).not.toContain('Secret errand');
});
