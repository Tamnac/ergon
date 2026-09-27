import { expect, type Locator, type Page } from '@playwright/test';

export function dateStr(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const day = (page: Page, offset = 0) =>
  page.locator(`.column[data-target="date:${dateStr(offset)}"]`);

export const todo = (scope: Page | Locator, text: string) =>
  scope.locator('.todo', { hasText: text });

/** Loads the app and waits until the database is ready (the default tab is seeded). */
export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: /Personal/ })).toBeVisible();
}

export async function addTodos(column: Locator, ...texts: string[]) {
  await column.getByRole('button', { name: 'Add todo' }).click();
  const input = column.getByRole('textbox', { name: 'New todo' });
  for (const text of texts) {
    await input.fill(text);
    await input.press('Enter');
    await expect(todo(column, text.replace(/^#\s*/, ''))).toBeVisible();
  }
  await input.press('Escape');
}

export async function drag(page: Page, source: Locator, target: Locator, targetY = 0.5) {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 2 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * targetY, { steps: 8 });
  await page.mouse.up();
}
