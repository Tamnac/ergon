import { describe, expect, it } from 'vitest';
import { Database, formatHlc, migrate, patch, SETTINGS_ID, type Op } from '../src';
import { rng, shuffle } from './random';
import { memoryDriver } from './sqlite';

const today = '2026-09-26';

async function openDb() {
  return Database.open(memoryDriver());
}

function todo(id: string, date: string, extra: Record<string, unknown> = {}) {
  return patch('todo', id, { text: id, date, order: 'a0', ...extra });
}

describe('Database', () => {
  it('materializes writes', async () => {
    const db = await openDb();
    await db.write(todo('a', today));
    expect(await db.todosBetween(today, today, today)).toEqual([
      {
        id: 'a',
        text: 'a',
        done: false,
        date: today,
        listId: null,
        order: 'a0',
        kind: 'todo',
        deleted: false,
      },
    ]);
  });

  it('returns undone past todos only when today is in range', async () => {
    const db = await openDb();
    await db.write([
      ...todo('old', '2026-09-20'),
      ...todo('done', '2026-09-20', { done: true }),
      ...todo('future', '2026-09-30'),
    ]);
    const ids = async (from: string, to: string) =>
      (await db.todosBetween(from, to, today)).map((t) => t.id);
    expect(await ids(today, '2026-09-28')).toEqual(['old']);
    expect(await ids('2026-09-27', '2026-09-30')).toEqual(['future']);
    expect(await ids('2026-09-20', '2026-09-20')).toEqual(['done', 'old']);
  });

  it('hides tombstoned rows', async () => {
    const db = await openDb();
    await db.write(todo('a', today));
    await db.write(patch('todo', 'a', { deleted: true }));
    expect(await db.todosBetween(today, today, today)).toEqual([]);
  });

  it('returns inverse changes that undo a write', async () => {
    const db = await openDb();
    const undoCreate = await db.write(todo('a', today));
    expect(undoCreate).toEqual([{ entity: 'todo', id: 'a', field: 'deleted', value: true }]);

    const undoEdit = await db.write(patch('todo', 'a', { text: 'changed', done: true }));
    await db.write(undoEdit);
    const [row] = await db.todosBetween(today, today, today);
    expect(row).toMatchObject({ text: 'a', done: false });

    await db.write(undoCreate);
    expect(await db.todosBetween(today, today, today)).toEqual([]);
  });

  it('undoes a create whose changes list deleted first', async () => {
    const db = await openDb();
    const undo = await db.write(patch('list', 'l', { deleted: false, name: 'L', groupId: 'g' }));
    expect(undo).toEqual([{ entity: 'list', id: 'l', field: 'deleted', value: true }]);
  });

  it('hides todos of deleted lists', async () => {
    const db = await openDb();
    await db.write([
      ...patch('list', 'l', { name: 'L', groupId: 'g' }),
      ...patch('todo', 't', { text: 't', listId: 'l', order: 'a0' }),
    ]);
    expect(await db.listTodos()).toHaveLength(1);
    await db.write(patch('list', 'l', { deleted: true }));
    expect(await db.listTodos()).toEqual([]);
  });

  it('keeps the last change when a write sets a field twice', async () => {
    const db = await openDb();
    const undo = await db.write([
      ...patch('list', 'l', { name: 'first', groupId: 'g' }),
      ...patch('list', 'l', { name: 'second' }),
    ]);
    expect((await db.lists())[0]?.name).toBe('second');
    expect(undo).toEqual([{ entity: 'list', id: 'l', field: 'deleted', value: true }]);
  });

  it('undoes edits to several entities in one write', async () => {
    const db = await openDb();
    await db.write([...todo('a', today), ...todo('b', today, { order: 'a1' })]);
    const undo = await db.write([
      ...patch('todo', 'a', { order: 'a2', text: 'A' }),
      ...patch('todo', 'b', { order: 'a3' }),
    ]);
    await db.write(undo);
    expect(
      (await db.todosBetween(today, today, today)).map((t) => [t.id, t.text, t.order]),
    ).toEqual([
      ['a', 'a', 'a0'],
      ['b', 'b', 'a1'],
    ]);
  });

  it('reads settings with defaults', async () => {
    const db = await openDb();
    expect((await db.settings()).dayCount).toBe(5);
    await db.write(patch('settings', SETTINGS_ID, { dayCount: 7, condensedWeekends: true }));
    expect(await db.settings()).toMatchObject({
      dayCount: 7,
      condensedWeekends: true,
      theme: 'system',
    });
  });

  it('ignores ops older than the current value', async () => {
    const db = await openDb();
    const op = (value: string, ms: number): Op => ({
      entity: 'list',
      id: 'l',
      field: 'name',
      value,
      hlc: formatHlc(ms, 0, 'remote'),
    });
    await db.apply([op('new', 2000)]);
    await db.apply([op('old', 1000)]);
    expect((await db.lists())[0]?.name).toBe('new');
  });

  it('keeps unknown fields out of the materialized tables', async () => {
    const db = await openDb();
    const op = {
      entity: 'todo',
      id: 'a',
      field: 'futureField',
      value: 1,
      hlc: formatHlc(1, 0, 'x'),
    } as unknown as Op;
    await expect(db.apply([op])).resolves.toBeUndefined();
  });

  it('converges regardless of op order', async () => {
    const random = rng(7);
    const fields = ['name', 'order', 'deleted'] as const;
    const ops: Op[] = Array.from({ length: 40 }, (_, i) => {
      const field = fields[i % 3]!;
      return {
        entity: 'list',
        id: `l${i % 4}`,
        field,
        value: field === 'deleted' ? i % 5 === 0 : `${field}${i}`,
        hlc: formatHlc(Math.floor(random() * 10), i, 'n'),
      } as Op;
    });
    const snapshot = async (order: Op[]) => {
      const db = await openDb();
      for (const op of order) await db.apply([op]);
      return db.lists();
    };
    const expected = await snapshot(ops);
    for (let i = 0; i < 5; i++) expect(await snapshot(shuffle(ops, random))).toEqual(expected);

    const batched = await openDb();
    await batched.apply(shuffle(ops, random));
    expect(await batched.lists()).toEqual(expected);
  });

  it('notifies subscribers with touched entities', async () => {
    const db = await openDb();
    const seen: string[][] = [];
    db.subscribe((entities) => seen.push([...entities]));
    await db.write([...todo('a', today), ...patch('list', 'l', { name: 'L' })]);
    expect(seen).toEqual([['todo', 'list']]);
  });

  it('resumes the clock after reopening', async () => {
    const driver = memoryDriver();
    const first = await Database.open(driver, () => 5000);
    await first.write(todo('a', today));
    const second = await Database.open(driver, () => 1000);
    await second.write(patch('todo', 'a', { text: 'later' }));
    expect((await second.todosBetween(today, today, today))[0]?.text).toBe('later');
  });

  it('orders writes after those of other connections', async () => {
    const driver = memoryDriver();
    const behind = await Database.open(driver, () => 1000);
    const ahead = await Database.open(driver, () => 5000);
    await ahead.write(todo('a', today));
    await behind.write(patch('todo', 'a', { text: 'later' }));
    expect((await ahead.todosBetween(today, today, today))[0]?.text).toBe('later');
  });

  it('runs migrations once', async () => {
    const driver = memoryDriver();
    await migrate(driver);
    await migrate(driver);
    expect(await driver.query('PRAGMA user_version')).toEqual([{ user_version: 1 }]);
  });
});
