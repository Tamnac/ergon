import { expect, it } from 'vitest';
import { formFor, ruleOf, weekdayPosition, type RepeatForm } from './repeat';

/** Saturday, the fourth and last Saturday of September. */
const date = '2026-09-26';

const form = (values: Partial<RepeatForm>) => ({ ...formFor(null, date), ...values });

it('builds rules from presets', () => {
  expect(ruleOf(form({}), date)).toBeNull();
  expect(ruleOf(form({ mode: 'daily', interval: 2 }), date)).toBe('FREQ=DAILY;INTERVAL=2');
  expect(ruleOf(form({ mode: 'weekdays', interval: 3 }), date)).toBe(
    'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  );
  expect(ruleOf(form({ mode: 'weekly', days: [0, 3, 1] }), date)).toBe(
    'FREQ=WEEKLY;BYDAY=MO,WE,SU',
  );
  expect(ruleOf(form({ mode: 'weekly', days: [] }), date)).toBe('FREQ=WEEKLY;BYDAY=SA');
  expect(ruleOf(form({ mode: 'monthly' }), date)).toBe('FREQ=MONTHLY;BYMONTHDAY=26');
  expect(ruleOf(form({ mode: 'monthly', monthlyBy: 'weekday' }), date)).toBe(
    'FREQ=MONTHLY;BYDAY=4SA',
  );
  expect(ruleOf(form({ mode: 'monthly', monthlyBy: 'last-weekday' }), date)).toBe(
    'FREQ=MONTHLY;BYDAY=-1SA',
  );
  expect(ruleOf(form({ mode: 'monthly', monthlyBy: 'last-day' }), date)).toBe(
    'FREQ=MONTHLY;BYMONTHDAY=-1',
  );
  expect(ruleOf(form({ mode: 'yearly', ends: 'count', count: 3 }), date)).toBe(
    'FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=26;COUNT=3',
  );
  expect(ruleOf(form({ mode: 'daily', ends: 'until', until: '2026-12-31' }), date)).toBe(
    'FREQ=DAILY;UNTIL=20261231',
  );
  expect(ruleOf(form({ mode: 'custom', custom: 'rrule:freq=weekly' }), date)).toBe('FREQ=WEEKLY');
});

it('rejects invalid input', () => {
  for (const values of [
    { mode: 'daily', interval: 0 },
    { mode: 'daily', interval: Number.NaN },
    { mode: 'daily', interval: 5000 },
    { mode: 'daily', ends: 'count', count: 0 },
    { mode: 'daily', ends: 'until', until: '2026-09-01' },
    { mode: 'custom', custom: 'FREQ=HOURLY' },
  ] as const) {
    expect(() => ruleOf(form(values), date)).toThrow();
  }
});

it('opens rules in the preset that produces them', () => {
  const presets: Partial<RepeatForm>[] = [
    { mode: 'daily', interval: 2 },
    { mode: 'weekdays' },
    { mode: 'weekly', days: [1, 6] },
    { mode: 'monthly', monthlyBy: 'weekday', ends: 'count', count: 4 },
    { mode: 'monthly', monthlyBy: 'last-weekday' },
    { mode: 'monthly', monthlyBy: 'last-day' },
    { mode: 'yearly', ends: 'until', until: '2030-01-01' },
  ];
  for (const values of presets) {
    const rule = ruleOf(form(values), date)!;
    expect(formFor(rule, date), rule).toMatchObject(values);
  }
  expect(formFor('FREQ=MONTHLY;BYMONTHDAY=1,15', date)).toMatchObject({
    mode: 'custom',
    custom: 'FREQ=MONTHLY;BYMONTHDAY=1,15',
  });
  expect(formFor('garbage', date)).toMatchObject({ mode: 'custom', custom: 'garbage' });
});

it('finds the position of a weekday in its month', () => {
  expect(weekdayPosition('2026-09-26')).toEqual({ nth: 4, fromEnd: -1 });
  expect(weekdayPosition('2026-09-01')).toEqual({ nth: 1, fromEnd: -5 });
});
