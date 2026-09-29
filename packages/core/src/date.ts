/** Calendar date as `YYYY-MM-DD`, without time zone. */
export type DateStr = string;

const DAY_MS = 86_400_000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function toDateStr(date: Date): DateStr {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayStr(now = new Date()): DateStr {
  return toDateStr(now);
}

/** UTC midnight of the date; all arithmetic happens in UTC so DST never shifts days. */
export function parseDate(date: DateStr): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function fromUtc(date: Date): DateStr {
  return date.toISOString().slice(0, 10);
}

export function isDateStr(value: unknown): value is DateStr {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDate(value);
  return !Number.isNaN(date.getTime()) && fromUtc(date) === value;
}

export function addDays(date: DateStr, days: number): DateStr {
  return fromUtc(new Date(parseDate(date).getTime() + days * DAY_MS));
}

/** Same day `months` later, clamped to the last day of that month. */
export function addMonths(date: DateStr, months: number): DateStr {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtc(new Date(Date.UTC(year, month, Math.min(d!, last))));
}

export function daysBetween(from: DateStr, to: DateStr): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: DateStr): number {
  return parseDate(date).getUTCDay();
}

export function startOfWeek(date: DateStr, weekStart: number): DateStr {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/**
 * Visible days grouped into columns. With condensed weekends, a Saturday followed by
 * a Sunday share one column.
 */
export function dayColumns(start: DateStr, days: number, condensedWeekends: boolean): DateStr[][] {
  const columns: DateStr[][] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const previous = columns.at(-1);
    if (
      condensedWeekends &&
      weekday(day) === 0 &&
      previous?.length === 1 &&
      weekday(previous[0]!) === 6
    ) {
      previous.push(day);
    } else {
      columns.push([day]);
    }
  }
  return columns;
}

interface WeekInfoLocale extends Intl.Locale {
  getWeekInfo?(): { firstDay: number };
  weekInfo?: { firstDay: number };
}

/** First day of the week for a locale (0 = Sunday), Monday if the runtime can't tell. */
export function localeWeekStart(locale?: string): number {
  try {
    const loc = new Intl.Locale(
      locale ?? Intl.DateTimeFormat().resolvedOptions().locale,
    ) as WeekInfoLocale;
    const firstDay = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
    return firstDay === undefined ? 1 : firstDay % 7;
  } catch {
    return 1;
  }
}
