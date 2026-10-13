import { expect, test, type Locator, type Page } from '@playwright/test';
import { addTodos, day, openApp } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const writingLine = (column: Locator) => column.locator('.todo-filler .ink-area');
const inkRows = (column: Locator) => column.locator('.todo:has(.ink)');

/** Draws through `points`, given as fractions of `area`, with a real (CDP) pen. */
async function stroke(
  page: Page,
  area: Locator,
  points: [number, number][],
  button: 'left' | 'right' = 'left',
) {
  const cdp = await page.context().newCDPSession(page);
  const box = (await area.boundingBox())!;
  const at = ([x, y]: [number, number]) => ({
    x: box.x + box.width * x,
    y: box.y + box.height * y,
  });
  const send = (type: string, point: [number, number], buttons: number) =>
    cdp.send('Input.dispatchMouseEvent', {
      type: type as 'mouseMoved',
      ...at(point),
      button,
      buttons,
      clickCount: 1,
      force: 0.5,
      pointerType: 'pen',
    });
  const pressed = button === 'left' ? 1 : 2;
  await send('mousePressed', points[0]!, pressed);
  for (const point of points.slice(1)) await send('mouseMoved', point, pressed);
  await send('mouseReleased', points.at(-1)!, 0);
  await cdp.detach();
}

const scribble: [number, number][] = [
  [0.02, 0.3],
  [0.1, 0.8],
  [0.18, 0.2],
  [0.26, 0.8],
];

async function write(page: Page, column: Locator) {
  await stroke(page, writingLine(column), scribble);
  await stroke(page, writingLine(column), [
    [0.3, 0.5],
    [0.4, 0.5],
  ]);
}

test('writes a todo with a pen', async ({ page }) => {
  const today = day(page);
  await write(page, today);
  await expect(today.locator('.ink-draft path')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(inkRows(today)).toHaveCount(1);
  await expect(today.getByRole('img', { name: 'Handwritten todo' })).toBeVisible();
  await expect(today.getByRole('textbox')).toHaveCount(0);

  await page.reload();
  await expect(inkRows(day(page))).toHaveCount(1);
  await expect(day(page).locator('.ink path')).toHaveCount(2);
});

test('commits on a pen tap elsewhere and cancels with Escape', async ({ page }) => {
  await write(page, day(page));
  await stroke(page, day(page, 1).locator('.todo-filler'), [[0.5, 0.9]]);
  await expect(inkRows(day(page))).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'New todo' })).toHaveCount(0);

  await write(page, day(page, 1));
  await page.keyboard.press('Escape');
  await expect(day(page, 1).locator('.ink-draft path[d^="M"]')).toHaveCount(0);
  await expect(inkRows(day(page, 1))).toHaveCount(0);
});

test('commits on a finger tap or focus elsewhere', async ({ page }) => {
  await write(page, day(page));
  await page.locator('h1, header').first().dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(inkRows(day(page))).toHaveCount(1);

  await write(page, day(page, 1));
  await inkRows(day(page)).focus();
  await expect(inkRows(day(page, 1))).toHaveCount(1);
});

test('writing closes an open add input', async ({ page }) => {
  await day(page, 1).getByRole('button', { name: 'Add todo' }).click();
  const input = day(page, 1).getByRole('textbox', { name: 'New todo' });
  await input.fill('Typed first');
  await write(page, day(page));
  await expect(input).toHaveCount(0);
  await expect(day(page, 1).locator('.todo', { hasText: 'Typed first' })).toBeVisible();
});

test('cuts ink off outside the row', async ({ page }) => {
  const line = writingLine(day(page));
  await stroke(page, line, [
    [0.5, 0.5],
    [1.5, 0.5],
    [2.5, 3],
  ]);
  await page.keyboard.press('Enter');
  const ink = (await day(page).locator('.ink').boundingBox())!;
  const area = (await line.boundingBox())!;
  expect(ink.width).toBeLessThanOrEqual(area.width / 2 + 10);
  const svg = (await day(page).locator('.ink svg').boundingBox())!;
  expect(svg.height).toBeCloseTo(2 * area.height, 0);
});

test('erases strokes of a written todo and deletes it when empty', async ({ page }) => {
  const today = day(page);
  await addTodos(today, 'Typed');
  await write(page, today);
  await page.keyboard.press('Enter');
  await expect(inkRows(today)).toHaveCount(1);
  const row = today.locator(`[data-id="${await inkRows(today).getAttribute('data-id')}"]`);

  await stroke(page, row.locator('.ink'), [[0.5, 0.5]]);
  await expect(row).toHaveClass(/is-editing/);
  const area = row.locator('.ink-area');
  await stroke(
    page,
    area,
    Array.from({ length: 30 }, (_, i): [number, number] => [i / 60, 0.5 + (i % 2) * 0.3]),
    'right',
  );
  await page.keyboard.press('Enter');
  await expect(inkRows(today)).toHaveCount(0);
  await expect(today.locator('.todo')).toHaveText(['Typed']);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inkRows(today)).toHaveCount(1);
});

test('a mouse click on the writing line still opens the add input', async ({ page }) => {
  await writingLine(day(page)).click();
  await expect(day(page).getByRole('textbox', { name: 'New todo' })).toBeVisible();
});

test('repeats handwritten todos', async ({ page }) => {
  await write(page, day(page));
  await page.keyboard.press('Enter');
  await inkRows(day(page)).getByRole('button', { name: 'Repeat' }).click();
  const dialog = page.getByRole('dialog', { name: 'Repeat' });
  await dialog.getByRole('combobox', { name: 'Repeat' }).selectOption('daily');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(inkRows(day(page, 2))).toHaveCount(1);
});
