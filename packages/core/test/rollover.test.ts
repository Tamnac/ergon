import { describe, expect, it } from 'vitest';
import { completionChanges, effectiveDate } from '../src';

const today = '2026-09-26';

describe('rollover', () => {
  it('shows undone past todos on today', () => {
    expect(effectiveDate({ date: '2026-09-20', done: false }, today)).toBe(today);
    expect(effectiveDate({ date: '2026-09-20', done: true }, today)).toBe('2026-09-20');
    expect(effectiveDate({ date: '2026-09-28', done: false }, today)).toBe('2026-09-28');
    expect(effectiveDate({ date: null, done: false }, today)).toBeNull();
  });

  it('moves rolled-over todos to today when completed', () => {
    expect(completionChanges({ id: 't', date: '2026-09-20' }, true, today)).toEqual([
      { entity: 'todo', id: 't', field: 'done', value: true },
      { entity: 'todo', id: 't', field: 'date', value: today },
    ]);
  });

  it('keeps the date otherwise', () => {
    expect(completionChanges({ id: 't', date: '2026-09-28' }, true, today)).toHaveLength(1);
    expect(completionChanges({ id: 't', date: '2026-09-20' }, false, today)).toHaveLength(1);
    expect(completionChanges({ id: 't', date: null }, true, today)).toHaveLength(1);
  });
});
