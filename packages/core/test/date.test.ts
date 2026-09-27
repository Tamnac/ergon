import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayColumns,
  isDateStr,
  localeWeekStart,
  startOfWeek,
  toDateStr,
  weekday,
} from '../src';

describe('date utils', () => {
  it('formats local dates', () => {
    expect(toDateStr(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-26', -2)).toBe('2026-10-24');
  });

  it('adds months, clamping to the end of the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('finds the start of the week', () => {
    expect(weekday('2026-09-26')).toBe(6);
    expect(startOfWeek('2026-09-26', 1)).toBe('2026-09-21');
    expect(startOfWeek('2026-09-26', 0)).toBe('2026-09-20');
    expect(startOfWeek('2026-09-21', 1)).toBe('2026-09-21');
  });

  it('validates date strings', () => {
    expect(isDateStr('2026-02-28')).toBe(true);
    expect(isDateStr('2026-02-30')).toBe(false);
    expect(isDateStr('26-2-3')).toBe(false);
  });

  it('groups a weekend into one column when condensed', () => {
    expect(dayColumns('2026-09-24', 5, false)).toHaveLength(5);
    expect(dayColumns('2026-09-24', 5, true)).toEqual([
      ['2026-09-24'],
      ['2026-09-25'],
      ['2026-09-26', '2026-09-27'],
      ['2026-09-28'],
    ]);
    expect(dayColumns('2026-09-27', 2, true)).toEqual([['2026-09-27'], ['2026-09-28']]);
    expect(dayColumns('2026-09-26', 1, true)).toEqual([['2026-09-26']]);
  });

  it('reads the locale week start', () => {
    expect(localeWeekStart('de-DE')).toBe(1);
    expect([0, 1]).toContain(localeWeekStart('en-US'));
  });
});
