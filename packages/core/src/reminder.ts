import type { DateStr } from './date';

/** A todo (or occurrence) that reminds at `time` (`HH:MM`, local) on `date`. */
export interface Reminder {
  id: string;
  date: DateStr;
  time: string;
  text: string;
}

/** A reminder resolved to a moment, in Unix milliseconds. */
export interface Scheduled {
  id: string;
  at: number;
  text: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isTime = (value: unknown): value is string =>
  typeof value === 'string' && TIME.test(value);

/** When a reminder fires in the local time zone; a time skipped by DST shifts forward. */
export function fireAt(date: DateStr, time: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

/** The first `limit` reminders firing at or after `from`, soonest first. */
export function schedule(reminders: readonly Reminder[], from: number, limit = Infinity) {
  return reminders
    .map(({ id, date, time, text }): Scheduled => ({ id, at: fireAt(date, time), text }))
    .filter((reminder) => reminder.at >= from)
    .toSorted((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}
