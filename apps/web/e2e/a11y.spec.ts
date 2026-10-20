import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addTodos, day, openApp, todo, todoAction } from './helpers';

/** Violations of WCAG 2.1 A and AA, and axe's best practices, as `rule: selectors`. */
async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

async function fill(page: Page) {
  await addTodos(day(page), '# Morning', 'Water plants', 'Call mom');
  await todoAction(todo(day(page), 'Call mom'), 'Mark done');
  await todoAction(todo(day(page), 'Water plants'), 'Repeat');
  await page.getByRole('dialog', { name: 'Repeat' }).getByRole('button', { name: 'Save' }).click();
  await todoAction(todo(day(page), 'Call mom'), 'Reminder');
  const reminder = page.getByRole('dialog', { name: 'Reminder' });
  await reminder.getByLabel('Remind me at').fill('09:30');
  await reminder.getByRole('button', { name: 'Save' }).click();
  await expect(day(page).locator('.todo-reminder-time')).toBeVisible();
}

async function setAccent(page: Page, color: string) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: color }).click();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('the day grid, lists and todo rows', async ({ page }) => {
      await openApp(page);
      await fill(page);
      expect(await violations(page)).toEqual([]);
    });

    test('the phone layout', async ({ page }) => {
      await openApp(page);
      await fill(page);
      await page.setViewportSize({ width: 390, height: 780 });
      await expect(page.locator('.app.is-phone')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    for (const [name, open] of [
      ['Settings', (page: Page) => page.getByRole('button', { name: 'Settings' }).click()],
      ['Shortcuts', (page: Page) => page.keyboard.press('?')],
      ['Search', (page: Page) => page.keyboard.press('/')],
      ['Calendar', (page: Page) => page.getByRole('button', { name: 'Calendar' }).click()],
      ['Sync', (page: Page) => page.getByRole('button', { name: /^Sync/ }).click()],
    ] as const) {
      test(`the ${name} dialog`, async ({ page }) => {
        await openApp(page);
        await open(page);
        const dialog = page.getByRole('dialog', { name });
        await expect(dialog).toBeVisible();
        // Wait for the rings to finish expanding.
        await expect(dialog).toHaveCSS('animation-name', /none|ring-in/);
        await page.waitForTimeout(1000);
        expect(await violations(page)).toEqual([]);
      });
    }

    // Accent colors that are hard to read as text, or that text is hard to read on.
    for (const accent of ['#ca8a04', '#111111', '#e11d48']) {
      test(`accent ${accent}`, async ({ page }) => {
        await openApp(page);
        await fill(page);
        await setAccent(page, accent);
        expect(await violations(page)).toEqual([]);
      });
    }
  });
}
