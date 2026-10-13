import { describe, expect, it } from 'vitest';
import { Database, fireAt, INK_LABEL, isTime, patch, schedule, todoChanges } from '../src';
import { memoryDriver } from './sqlite';

describe('reminder times', () => {
  it('validates HH:MM', () => {
    expect(['00:00', '09:30', '23:59'].every(isTime)).toBe(true);
    expect(['24:00', '9:30', '09:60', '', null].some(isTime)).toBe(false);
  });

  it('resolves to local time', () => {
    expect(fireAt('2026-09-26', '09:30')).toBe(new Date(2026, 8, 26, 9, 30).getTime());
  });

  it('keeps the soonest reminders from now on', () => {
    const at = (date: string, time: string) => fireAt(date, time);
    const reminders = [
      { id: 'c', date: '2026-09-27', time: '08:00', text: 'c' },
      { id: 'a', date: '2026-09-26', time: '08:00', text: 'a' },
      { id: 'b', date: '2026-09-26', time: '18:00', text: 'b' },
    ];
    const now = at('2026-09-26', '09:00');
    expect(schedule(reminders, now).map((r) => r.id)).toEqual(['b', 'c']);
    expect(schedule(reminders, now, 1)).toEqual([
      { id: 'b', at: at('2026-09-26', '18:00'), text: 'b' },
    ]);
    expect(schedule(reminders, at('2026-09-26', '08:00')).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('Database reminders', () => {
  const today = '2026-09-26';
  const todo = (id: string, extra: Record<string, unknown> = {}) =>
    patch('todo', id, { text: id, date: today, order: 'a0', reminder: '09:00', ...extra });
  const open = () => Database.open(memoryDriver());
  const ids = async (db: Database, from = today, to = '2026-09-28') =>
    (await db.reminders(from, to)).map((r) => r.id);

  it('lists undone todos with a reminder', async () => {
    const db = await open();
    await db.write([
      ...todo('a'),
      ...todo('done', { done: true }),
      ...todo('deleted', { deleted: true }),
      ...todo('none', { reminder: null }),
      ...todo('later', { date: '2026-09-27', reminder: '07:15' }),
      ...todo('outside', { date: '2026-10-01' }),
      ...todo('heading', { kind: 'heading' }),
      ...todo('list', { date: null, listId: 'l' }),
    ]);
    expect(await db.reminders(today, '2026-09-28')).toEqual([
      { id: 'a', date: today, time: '09:00', text: 'a' },
      { id: 'later', date: '2026-09-27', time: '07:15', text: 'later' },
    ]);
  });

  it('labels handwritten todos', async () => {
    const db = await open();
    await db.write(todo('ink', { text: '', ink: 'AQAB' }));
    expect((await db.reminders(today, today))[0]?.text).toBe(INK_LABEL);
  });

  it('does not roll reminders over', async () => {
    const db = await open();
    await db.write(todo('old', { date: '2026-09-20' }));
    expect(await ids(db, today, today)).toEqual([]);
  });

  describe('of recurrences', () => {
    const series = (extra: Record<string, unknown> = {}) =>
      patch('recurrence', 'r', {
        rrule: 'FREQ=DAILY',
        startDate: today,
        text: 'Water plants',
        reminder: '08:00',
        ...extra,
      });

    it('expands occurrences with the recurrence time', async () => {
      const db = await open();
      await db.write(series());
      expect(await db.reminders(today, '2026-09-27')).toEqual([
        { id: 'r:2026-09-26', date: today, time: '08:00', text: 'Water plants' },
        { id: 'r:2026-09-27', date: '2026-09-27', time: '08:00', text: 'Water plants' },
      ]);
    });

    it('lets a stored occurrence override or drop it', async () => {
      const db = await open();
      await db.write(series());
      const [first, second, third] = await db.todosBetween(today, '2026-09-28', today);
      await db.write([
        ...todoChanges(first!, { reminder: '18:30' }),
        ...todoChanges(second!, { reminder: null }),
        ...todoChanges(third!, { done: true }),
      ]);
      expect(await db.reminders(today, '2026-09-28')).toEqual([
        { id: 'r:2026-09-26', date: today, time: '18:30', text: 'Water plants' },
      ]);
    });

    it('skips series without a reminder', async () => {
      const db = await open();
      await db.write(series({ reminder: null }));
      expect(await ids(db)).toEqual([]);
    });
  });
});
