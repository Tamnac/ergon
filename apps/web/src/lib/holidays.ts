import type { DateStr } from '@ergon/core';

// A glob so the app still builds without the data file, which isn't committed.
const data = import.meta.glob<Record<string, string[]>>('./holidays.json', { import: 'default' });

/** A random fun holiday on the month and day of `date`. */
export async function randomHoliday(date: DateStr): Promise<string | undefined> {
  const load = data['./holidays.json'];
  const names = load && (await load())[date.slice(5)];
  return names?.[Math.floor(Math.random() * names.length)];
}
