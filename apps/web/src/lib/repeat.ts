import {
  addDays,
  addMonths,
  formatRule,
  isDateStr,
  newRule,
  parseRule,
  RuleError,
  tryParseRule,
  weekday,
  type DateStr,
  type Rule,
} from '@ergon/core';

export type RepeatMode = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
/** Monthly on the date's day, on its weekday counted from the start or the end, or on the last day. */
export type MonthlyBy = 'day' | 'weekday' | 'last-weekday' | 'last-day';
export type Ends = 'never' | 'until' | 'count';

/** The repeat dialog's fields. Presets are relative to the date of the todo being edited. */
export interface RepeatForm {
  mode: RepeatMode;
  interval: number;
  /** Weekly days, 0 = Sunday. */
  days: number[];
  monthlyBy: MonthlyBy;
  ends: Ends;
  until: DateStr;
  count: number;
  custom: string;
}

const WORKDAYS = [1, 2, 3, 4, 5];

const dayOf = (date: DateStr) => Number(date.slice(8, 10));
const monthOf = (date: DateStr) => Number(date.slice(5, 7));

/** Which of its weekday in the month `date` is: 1 for the first, -1 for the last. */
export function weekdayPosition(date: DateStr): { nth: number; fromEnd: number } {
  const last = dayOf(addDays(addMonths(`${date.slice(0, 7)}-01`, 1), -1));
  return { nth: Math.ceil(dayOf(date) / 7), fromEnd: -Math.ceil((last - dayOf(date) + 1) / 7) };
}

const byDays = (days: readonly number[]) =>
  days.toSorted((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => ({ day, nth: null }));

function monthly(by: MonthlyBy, date: DateStr): Partial<Rule> {
  const { nth, fromEnd } = weekdayPosition(date);
  switch (by) {
    case 'day':
      return { byMonthDay: [dayOf(date)] };
    case 'weekday':
      return { byDay: [{ day: weekday(date), nth }] };
    case 'last-weekday':
      return { byDay: [{ day: weekday(date), nth: fromEnd }] };
    case 'last-day':
      return { byMonthDay: [-1] };
  }
}

/** The RRULE for `form`, null for no repetition. Throws a `RuleError` for invalid input. */
export function ruleOf(form: RepeatForm, date: DateStr): string | null {
  if (form.mode === 'none') return null;
  if (form.mode === 'custom') return formatRule(parseRule(form.custom));
  if (!Number.isInteger(form.interval) || form.interval < 1) {
    throw new RuleError('Repeat every 1 or more');
  }
  if (form.ends === 'count' && (!Number.isInteger(form.count) || form.count < 1)) {
    throw new RuleError('End after 1 or more times');
  }
  if (form.ends === 'until' && !(isDateStr(form.until) && form.until >= date)) {
    throw new RuleError('End on a date after the start');
  }
  const every = {
    interval: form.interval,
    count: form.ends === 'count' ? form.count : null,
    until: form.ends === 'until' ? form.until : null,
  };
  const text = formatRule(presetRule(form, date, every));
  // The parser enforces its limits, e.g. on INTERVAL and COUNT.
  parseRule(text);
  return text;
}

function presetRule(form: RepeatForm, date: DateStr, every: Partial<Rule>): Rule {
  switch (form.mode) {
    case 'weekdays':
      return newRule('WEEKLY', { ...every, interval: 1, byDay: byDays(WORKDAYS) });
    case 'weekly': {
      const days = form.days.length > 0 ? form.days : [weekday(date)];
      return newRule('WEEKLY', { ...every, byDay: byDays(days) });
    }
    case 'monthly':
      return newRule('MONTHLY', { ...every, ...monthly(form.monthlyBy, date) });
    case 'yearly':
      return newRule('YEARLY', { ...every, byMonth: [monthOf(date)], byMonthDay: [dayOf(date)] });
    default:
      return newRule('DAILY', every);
  }
}

/** Form fields for `rrule`; rules that no preset produces open as custom. */
export function formFor(rrule: string | null, date: DateStr): RepeatForm {
  const form: RepeatForm = {
    mode: 'none',
    interval: 1,
    days: [weekday(date)],
    monthlyBy: 'day',
    ends: 'never',
    until: addMonths(date, 1),
    count: 10,
    custom: rrule ?? 'FREQ=DAILY',
  };
  const rule = rrule === null ? null : tryParseRule(rrule);
  if (rrule === null || !rule) return { ...form, mode: rrule === null ? 'none' : 'custom' };

  const text = formatRule(rule);
  const base: RepeatForm = {
    ...form,
    custom: text,
    interval: rule.interval,
    ends: rule.count !== null ? 'count' : rule.until !== null ? 'until' : 'never',
    until: rule.until ?? form.until,
    count: rule.count ?? form.count,
  };
  const candidates: RepeatForm[] = [
    { ...base, mode: 'daily' },
    { ...base, mode: 'weekdays' },
    { ...base, mode: 'weekly', days: rule.byDay.map((d) => d.day) },
    ...(['day', 'weekday', 'last-weekday', 'last-day'] as const).map((monthlyBy): RepeatForm => ({
      ...base,
      mode: 'monthly',
      monthlyBy,
    })),
    { ...base, mode: 'yearly' },
  ];
  return (
    candidates.find((candidate) => {
      try {
        return ruleOf(candidate, date) === text;
      } catch {
        return false;
      }
    }) ?? { ...base, mode: 'custom' }
  );
}
