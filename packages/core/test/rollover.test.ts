import { describe, expect, it } from 'vitest';
import { completionChanges, effectiveDate, type Todo } from '../src';

const today = '2026-09-26';

function todo(date: string | null, extra: Partial<Todo> = {}): Todo {
  return {
    id: 't',
    text: 't',
    done: false,
    date,
    listId: null,
    order: 'a0',
    kind: 'todo',
    recurrenceId: null,
    occurrence: null,
    skipped: false,
    deleted: false,
    ...extra,
  };
}

describe('rollover', () => {
  it('shows undone past todos on today', () => {
    expect(effectiveDate(todo('2026-09-20'), today)).toBe(today);
    expect(effectiveDate(todo('2026-09-20', { done: true }), today)).toBe('2026-09-20');
    expect(effectiveDate(todo('2026-09-28'), today)).toBe('2026-09-28');
    expect(effectiveDate(todo(null), today)).toBeNull();
  });

  it('keeps recurring todos on their date', () => {
    const occurrence = todo('2026-09-20', { recurrenceId: 'r', occurrence: '2026-09-20' });
    expect(effectiveDate(occurrence, today)).toBe('2026-09-20');
    expect(completionChanges(occurrence, true, today)).toHaveLength(1);
  });

  it('moves rolled-over todos to today when completed', () => {
    expect(completionChanges(todo('2026-09-20'), true, today)).toEqual([
      { entity: 'todo', id: 't', field: 'done', value: true },
      { entity: 'todo', id: 't', field: 'date', value: today },
    ]);
  });

  it('keeps the date otherwise', () => {
    expect(completionChanges(todo('2026-09-28'), true, today)).toHaveLength(1);
    expect(completionChanges(todo('2026-09-20'), false, today)).toHaveLength(1);
    expect(completionChanges(todo(null), true, today)).toHaveLength(1);
  });

  it('stores a virtual occurrence when completing it', () => {
    const virtual = todo(today, { recurrenceId: 'r', occurrence: today, virtual: true });
    const changes = completionChanges(virtual, true, today);
    expect(changes).toContainEqual({ entity: 'todo', id: 't', field: 'done', value: true });
    expect(changes).toContainEqual({ entity: 'todo', id: 't', field: 'recurrenceId', value: 'r' });
    expect(changes.filter((c) => c.field === 'done')).toHaveLength(1);
  });
});
