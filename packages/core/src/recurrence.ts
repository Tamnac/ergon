import {
  addDays,
  addMonths,
  daysBetween,
  isDateStr,
  startOfWeek,
  weekday,
  type DateStr,
} from './date';
import {
  defaults,
  patch,
  type Change,
  type Field,
  type Fields,
  type Recurrence,
  type Todo,
} from './model';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** A BYDAY weekday (0 = Sunday), optionally the `nth` in its month or year; negative counts from the end. */
export interface ByDay {
  day: number;
  nth: number | null;
}

/**
 * The supported subset of an RFC 5545 RRULE: FREQ (daily to yearly), INTERVAL, COUNT, UNTIL,
 * BYDAY, BYMONTHDAY, BYMONTH and WKST. Occurrences are dates, so times and zones don't apply.
 */
export interface Rule {
  freq: Frequency;
  interval: number;
  byDay: ByDay[];
  byMonthDay: number[];
  byMonth: number[];
  count: number | null;
  until: DateStr | null;
  /** 0 = Sunday */
  weekStart: number;
}

export class RuleError extends Error {}

const FREQUENCIES: readonly string[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function newRule(freq: Frequency, parts: Partial<Omit<Rule, 'freq'>> = {}): Rule {
  return {
    freq,
    interval: 1,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
    count: null,
    until: null,
    weekStart: 1,
    ...parts,
  };
}

/** Throws a `RuleError` with a readable message for invalid or unsupported rules. */
export function parseRule(text: string): Rule {
  const parts = new Map<string, string>();
  for (const part of text
    .trim()
    .replace(/^RRULE:/i, '')
    .split(';')) {
    const match = /^([A-Z]+)=(.+)$/i.exec(part.trim());
    if (!match) throw new RuleError(`Invalid part "${part}"`);
    parts.set(match[1]!.toUpperCase(), match[2]!.toUpperCase());
  }
  const freq = parts.get('FREQ');
  if (!freq) throw new RuleError('FREQ is missing');
  if (!FREQUENCIES.includes(freq)) throw new RuleError(`FREQ=${freq} is not supported`);

  const rule = newRule(freq as Frequency);
  for (const [key, value] of parts) {
    const list = value.split(',');
    switch (key) {
      case 'FREQ':
        break;
      case 'INTERVAL':
        rule.interval = integer(key, value, 1, 1000);
        break;
      case 'COUNT':
        rule.count = integer(key, value, 1, 100_000);
        break;
      case 'UNTIL':
        rule.until = untilDate(value);
        break;
      case 'BYDAY':
        rule.byDay = list.map(byDay);
        break;
      case 'BYMONTHDAY':
        rule.byMonthDay = list.map((v) => integer(key, v, -31, 31, true));
        break;
      case 'BYMONTH':
        rule.byMonth = list.map((v) => integer(key, v, 1, 12));
        break;
      case 'WKST':
        rule.weekStart = dayIndex(value);
        break;
      default:
        throw new RuleError(`${key} is not supported`);
    }
  }
  if (rule.count !== null && rule.until !== null) {
    throw new RuleError('COUNT and UNTIL cannot be combined');
  }
  if (rule.freq === 'WEEKLY' && rule.byMonthDay.length > 0) {
    throw new RuleError('BYMONTHDAY does not work with FREQ=WEEKLY');
  }
  if ((rule.freq === 'DAILY' || rule.freq === 'WEEKLY') && rule.byDay.some((d) => d.nth !== null)) {
    throw new RuleError('Numbered weekdays need FREQ=MONTHLY or FREQ=YEARLY');
  }
  return rule;
}

export function tryParseRule(text: string): Rule | null {
  try {
    return parseRule(text);
  } catch {
    return null;
  }
}

function integer(key: string, value: string, min: number, max: number, nonZero = false) {
  const n = /^[+-]?\d+$/.test(value) ? Number(value) : NaN;
  if (!(n >= min && n <= max) || (nonZero && n === 0)) {
    throw new RuleError(`Invalid ${key} "${value}"`);
  }
  return n;
}

function byDay(value: string): ByDay {
  const match = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(value);
  const nth = match?.[1] === undefined ? null : Number(match[1]);
  if (!match || nth === 0 || (nth !== null && Math.abs(nth) > 53)) {
    throw new RuleError(`Invalid BYDAY "${value}"`);
  }
  return { day: dayIndex(match[2]!), nth };
}

function dayIndex(code: string): number {
  const day = DAYS.indexOf(code);
  if (day < 0) throw new RuleError(`Unknown weekday "${code}"`);
  return day;
}

function untilDate(value: string): DateStr {
  const match = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(value);
  const date = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  if (!isDateStr(date)) throw new RuleError(`Invalid UNTIL "${value}"`);
  return date;
}

export function formatRule(rule: Rule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byMonth.length > 0) parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  if (rule.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.byDay.length > 0) {
    parts.push(`BYDAY=${rule.byDay.map((d) => `${d.nth ?? ''}${DAYS[d.day]}`).join(',')}`);
  }
  if (rule.until !== null) parts.push(`UNTIL=${rule.until.replaceAll('-', '')}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  if (rule.weekStart !== 1) parts.push(`WKST=${DAYS[rule.weekStart]}`);
  return parts.join(';');
}

/**
 * Dates in `[from, to]` of the series starting on `start`. `start` is always the first
 * occurrence, like DTSTART in RFC 5545.
 */
export function occurrences(rule: Rule, start: DateStr, from: DateStr, to: DateStr): DateStr[] {
  const end = rule.until !== null && rule.until < to ? rule.until : to;
  const found: DateStr[] = [];
  if (start > end) return found;
  let left = rule.count ?? Infinity;
  const take = (date: DateStr) => {
    left--;
    if (date >= from) found.push(date);
  };
  take(start);
  // Without COUNT, nothing before `from` matters.
  const first =
    rule.count === null && from > start
      ? Math.floor(periodIndex(rule, start, from) / rule.interval)
      : 0;
  for (let k = first; ; k++) {
    const [spanStart, spanEnd] = period(rule, start, k * rule.interval);
    for (let date = spanStart; date <= spanEnd; date = addDays(date, 1)) {
      if (date > end || left <= 0) return found;
      if (date > start && matches(rule, start, date, spanStart, spanEnd)) take(date);
    }
  }
}

/**
 * Splits the series starting on `start` at `at`: the rule for the dates before `at` (null if
 * there are none) and the rule for a series starting on `at`. COUNT is shared between both.
 */
export function splitRule(
  rule: Rule,
  start: DateStr,
  at: DateStr,
): { before: Rule | null; after: Rule } {
  const previous = addDays(at, -1);
  const earlier = at > start ? occurrences(rule, start, start, previous).length : 0;
  if (earlier === 0) return { before: null, after: rule };
  if (rule.count !== null) {
    return {
      before: { ...rule, count: earlier },
      after: { ...rule, count: Math.max(1, rule.count - earlier) },
    };
  }
  const until = rule.until !== null && rule.until < previous ? rule.until : previous;
  return { before: { ...rule, until }, after: rule };
}

const firstOfMonth = (date: DateStr) => `${date.slice(0, 7)}-01`;
const lastOfMonth = (date: DateStr) => addDays(addMonths(firstOfMonth(date), 1), -1);
const yearOf = (date: DateStr) => Number(date.slice(0, 4));
const monthOf = (date: DateStr) => Number(date.slice(5, 7));
const dayOf = (date: DateStr) => Number(date.slice(8, 10));

/** Index of the day/week/month/year containing `date`, counted from the one containing `start`. */
function periodIndex(rule: Rule, start: DateStr, date: DateStr): number {
  switch (rule.freq) {
    case 'DAILY':
      return daysBetween(start, date);
    case 'WEEKLY':
      return Math.floor(daysBetween(startOfWeek(start, rule.weekStart), date) / 7);
    case 'MONTHLY':
      return (yearOf(date) - yearOf(start)) * 12 + monthOf(date) - monthOf(start);
    case 'YEARLY':
      return yearOf(date) - yearOf(start);
  }
}

/** First and last day of the `index`th period after the one containing `start`. */
function period(rule: Rule, start: DateStr, index: number): [DateStr, DateStr] {
  switch (rule.freq) {
    case 'DAILY': {
      const day = addDays(start, index);
      return [day, day];
    }
    case 'WEEKLY': {
      const first = addDays(startOfWeek(start, rule.weekStart), 7 * index);
      return [first, addDays(first, 6)];
    }
    case 'MONTHLY': {
      const first = addMonths(firstOfMonth(start), index);
      return [first, lastOfMonth(first)];
    }
    case 'YEARLY': {
      const first = addMonths(`${start.slice(0, 4)}-01-01`, 12 * index);
      return [first, `${first.slice(0, 4)}-12-31`];
    }
  }
}

function matches(rule: Rule, start: DateStr, date: DateStr, spanStart: DateStr, spanEnd: DateStr) {
  const month = monthOf(date);
  const day = dayOf(date);
  if (rule.byMonth.length > 0 && !rule.byMonth.includes(month)) return false;
  if (rule.byMonthDay.length > 0) {
    const fromEnd = day - dayOf(lastOfMonth(date)) - 1;
    if (!rule.byMonthDay.some((n) => n === day || n === fromEnd)) return false;
  }
  if (rule.byDay.length > 0) {
    // Numbered weekdays count within the year only for YEARLY without BYMONTH.
    const [first, last] =
      rule.freq === 'YEARLY' && rule.byMonth.length === 0
        ? [spanStart, spanEnd]
        : [firstOfMonth(date), lastOfMonth(date)];
    const wd = weekday(date);
    const nth = (n: number) =>
      n > 0
        ? Math.floor(daysBetween(first, date) / 7) + 1 === n
        : Math.floor(daysBetween(date, last) / 7) + 1 === -n;
    if (!rule.byDay.some((d) => d.day === wd && (d.nth === null || nth(d.nth)))) return false;
  }
  const expanded = rule.byDay.length > 0 || rule.byMonthDay.length > 0;
  switch (rule.freq) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return expanded || weekday(date) === weekday(start);
    case 'MONTHLY':
      return expanded || day === dayOf(start);
    case 'YEARLY':
      return (
        expanded || (day === dayOf(start) && (rule.byMonth.length > 0 || month === monthOf(start)))
      );
  }
}

/** Id of a stored occurrence. Fixed, so devices that store it concurrently write the same row. */
export const occurrenceId = (recurrenceId: string, date: DateStr) => `${recurrenceId}:${date}`;

/**
 * Occurrences in `[from, to]` without a stored todo, as virtual todos. `stored` holds the
 * `occurrenceId` of each stored occurrence (by its `recurrenceId` and `occurrence`).
 */
export function virtualOccurrences(
  recurrences: readonly Recurrence[],
  from: DateStr,
  to: DateStr,
  stored: ReadonlySet<string>,
): Todo[] {
  return recurrences.flatMap((recurrence) => {
    const rule = tryParseRule(recurrence.rrule);
    if (!rule || !isDateStr(recurrence.startDate)) return [];
    return occurrences(rule, recurrence.startDate, from, to)
      .filter((date) => !stored.has(occurrenceId(recurrence.id, date)))
      .map((date) => ({
        id: occurrenceId(recurrence.id, date),
        text: recurrence.text,
        done: false,
        date,
        listId: null,
        order: recurrence.order,
        kind: recurrence.kind,
        recurrenceId: recurrence.id,
        occurrence: date,
        skipped: false,
        deleted: false,
        virtual: true,
      }));
  });
}

/** Changes setting `values` on `todo`. A virtual occurrence is written in full, which stores it. */
export function todoChanges(todo: Todo, values: Partial<Fields<'todo'>>): Change[] {
  if (!todo.virtual) return patch('todo', todo.id, values);
  const fields = Object.keys(defaults.todo) as Field<'todo'>[];
  const stored = Object.fromEntries(fields.map((field) => [field, todo[field]]));
  return patch('todo', todo.id, { ...stored, ...values });
}
