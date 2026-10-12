import { afterEach, describe, expect, it } from 'vitest';
import {
  addDays,
  formatRule,
  occurrenceId,
  occurrences,
  parseRule,
  RuleError,
  splitRule,
  todoChanges,
  virtualOccurrences,
  type Recurrence,
} from '../src';

const expand = (rrule: string, start: string, to: string, from = start) =>
  occurrences(parseRule(rrule), start, from, to);

describe('parseRule', () => {
  it('round-trips supported rules', () => {
    for (const rule of [
      'FREQ=DAILY',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR',
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=MONTHLY;BYDAY=-1FR',
      'FREQ=MONTHLY;BYMONTHDAY=-1',
      'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
      'FREQ=DAILY;UNTIL=20261231',
      'FREQ=WEEKLY;COUNT=3;WKST=SU',
    ]) {
      expect(formatRule(parseRule(rule))).toBe(rule);
    }
  });

  it('accepts a prefix, lowercase and a date-time UNTIL', () => {
    expect(parseRule('RRULE:freq=daily;until=20261231T235959Z').until).toBe('2026-12-31');
  });

  it('rejects invalid and unsupported rules', () => {
    for (const rule of [
      '',
      'INTERVAL=2',
      'FREQ=HOURLY',
      'FREQ=DAILY;BYSETPOS=1',
      'FREQ=DAILY;COUNT=0',
      'FREQ=DAILY;INTERVAL=x',
      'FREQ=DAILY;COUNT=2;UNTIL=20260101',
      'FREQ=DAILY;UNTIL=20260230',
      'FREQ=WEEKLY;BYDAY=2MO',
      'FREQ=WEEKLY;BYMONTHDAY=1',
      'FREQ=MONTHLY;BYMONTHDAY=0',
      'FREQ=MONTHLY;BYDAY=XX',
    ]) {
      expect(() => parseRule(rule), rule).toThrow(RuleError);
    }
  });
});

describe('occurrences', () => {
  it('repeats daily with an interval', () => {
    expect(expand('FREQ=DAILY;INTERVAL=3', '2026-09-26', '2026-10-05')).toEqual([
      '2026-09-26',
      '2026-09-29',
      '2026-10-02',
      '2026-10-05',
    ]);
  });

  it('repeats on weekdays', () => {
    expect(expand('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-09-25', '2026-10-01')).toEqual([
      '2026-09-25',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
  });

  it('repeats every other week on several days', () => {
    expect(expand('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', '2026-09-07', '2026-10-04')).toEqual([
      '2026-09-07',
      '2026-09-10',
      '2026-09-21',
      '2026-09-24',
    ]);
  });

  it('counts weeks from the week start', () => {
    const rule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA,SU';
    expect(expand(rule, '2026-09-26', '2026-10-11')).toEqual([
      '2026-09-26',
      '2026-09-27',
      '2026-10-10',
      '2026-10-11',
    ]);
    expect(expand(`${rule};WKST=SU`, '2026-09-26', '2026-10-11')).toEqual([
      '2026-09-26',
      '2026-10-04',
      '2026-10-10',
    ]);
  });

  it('always includes the start date', () => {
    expect(expand('FREQ=WEEKLY;BYDAY=MO', '2026-09-26', '2026-10-06')).toEqual([
      '2026-09-26',
      '2026-09-28',
      '2026-10-05',
    ]);
  });

  it('skips months without the day', () => {
    const expected = ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31'];
    expect(expand('FREQ=MONTHLY', '2026-01-31', '2026-08-31')).toEqual(expected);
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31', '2026-08-31')).toEqual(expected);
  });

  it('repeats on the last day of the month', () => {
    const rule = 'FREQ=MONTHLY;BYMONTHDAY=-1';
    expect(expand(rule, '2026-01-31', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(expand(rule, '2028-01-31', '2028-02-29')).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('repeats on numbered weekdays', () => {
    expect(expand('FREQ=MONTHLY;BYDAY=2TU', '2026-09-08', '2026-12-31')).toEqual([
      '2026-09-08',
      '2026-10-13',
      '2026-11-10',
      '2026-12-08',
    ]);
    expect(expand('FREQ=MONTHLY;BYDAY=-1FR', '2026-09-25', '2026-11-30')).toEqual([
      '2026-09-25',
      '2026-10-30',
      '2026-11-27',
    ]);
    expect(expand('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', '2026-11-26', '2028-12-31')).toEqual([
      '2026-11-26',
      '2027-11-25',
      '2028-11-23',
    ]);
    expect(expand('FREQ=YEARLY;BYDAY=1MO', '2026-01-05', '2027-12-31')).toEqual([
      '2026-01-05',
      '2027-01-04',
    ]);
  });

  it('repeats February 29 in leap years only', () => {
    const expected = ['2028-02-29', '2032-02-29', '2036-02-29'];
    expect(expand('FREQ=YEARLY', '2028-02-29', '2036-12-31')).toEqual(expected);
    expect(expand('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', '2028-02-29', '2036-12-31')).toEqual(
      expected,
    );
  });

  it('stops after COUNT occurrences, counted from the start', () => {
    expect(expand('FREQ=WEEKLY;COUNT=3', '2026-09-26', '2027-12-31', '2026-10-01')).toEqual([
      '2026-10-03',
      '2026-10-10',
    ]);
  });

  it('stops after UNTIL', () => {
    expect(expand('FREQ=DAILY;UNTIL=20260928', '2026-09-26', '2026-10-10')).toEqual([
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
    ]);
  });

  it('ends on rules without dates', () => {
    expect(expand('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', '2026-01-01', '2030-01-01')).toEqual([
      '2026-01-01',
    ]);
  });

  it('gives the same dates for a window as for the whole series', () => {
    const start = '2026-01-31';
    const rules = [
      'FREQ=DAILY;INTERVAL=3',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH',
      'FREQ=WEEKLY;INTERVAL=3;BYDAY=SA,SU;WKST=SU',
      'FREQ=MONTHLY;INTERVAL=5;BYDAY=-1FR',
      'FREQ=MONTHLY;BYMONTHDAY=1,-1;BYDAY=MO,TU,WE,TH,FR',
      'FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29',
    ];
    for (const rule of rules) {
      const all = expand(rule, start, '2034-12-31');
      for (const offset of [1, 40, 400, 1500]) {
        const from = addDays(start, offset);
        const to = addDays(from, 70);
        expect(expand(rule, start, to, from), `${rule} from ${from}`).toEqual(
          all.filter((date) => date >= from && date <= to),
        );
      }
    }
  });

  describe('across DST changes', () => {
    const zone = process.env.TZ;
    afterEach(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });

    for (const tz of ['Europe/Berlin', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Tehran']) {
      it(`keeps days intact in ${tz}`, () => {
        process.env.TZ = tz;
        const daily = expand('FREQ=DAILY', '2026-03-01', '2026-04-15');
        expect(daily).toHaveLength(46);
        daily.forEach((date, i) => expect(date).toBe(addDays('2026-03-01', i)));
        expect(expand('FREQ=WEEKLY', '2026-10-18', '2026-11-15')).toEqual([
          '2026-10-18',
          '2026-10-25',
          '2026-11-01',
          '2026-11-08',
          '2026-11-15',
        ]);
        expect(expand('FREQ=MONTHLY;BYDAY=-1SU', '2026-03-29', '2026-10-31')).toContain(
          '2026-10-25',
        );
      });
    }
  });
});

describe('splitRule', () => {
  it('ends the first part the day before', () => {
    const { before, after } = splitRule(parseRule('FREQ=DAILY'), '2026-09-26', '2026-09-30');
    expect(before && formatRule(before)).toBe('FREQ=DAILY;UNTIL=20260929');
    expect(formatRule(after)).toBe('FREQ=DAILY');
  });

  it('keeps an earlier UNTIL', () => {
    const rule = parseRule('FREQ=WEEKLY;UNTIL=20261001');
    const { before } = splitRule(rule, '2026-09-01', '2026-10-06');
    expect(before?.until).toBe('2026-10-01');
  });

  it('shares COUNT', () => {
    const { before, after } = splitRule(
      parseRule('FREQ=DAILY;COUNT=10'),
      '2026-09-26',
      '2026-09-30',
    );
    expect(before?.count).toBe(4);
    expect(after.count).toBe(6);
  });

  it('has no first part when splitting at the start', () => {
    expect(splitRule(parseRule('FREQ=DAILY'), '2026-09-26', '2026-09-26').before).toBeNull();
  });
});

describe('virtualOccurrences', () => {
  const recurrence: Recurrence = {
    id: 'r',
    rrule: 'FREQ=DAILY',
    startDate: '2026-09-26',
    text: 'Water plants',
    kind: 'todo',
    order: 'a5',
    reminder: null,
    deleted: false,
  };

  it('leaves out stored occurrences', () => {
    const stored = new Set([occurrenceId('r', '2026-09-27')]);
    const todos = virtualOccurrences([recurrence], '2026-09-26', '2026-09-28', stored);
    expect(todos.map((t) => t.id)).toEqual(['r:2026-09-26', 'r:2026-09-28']);
    expect(todos[0]).toEqual({
      id: 'r:2026-09-26',
      text: 'Water plants',
      done: false,
      date: '2026-09-26',
      listId: null,
      order: 'a5',
      kind: 'todo',
      recurrenceId: 'r',
      occurrence: '2026-09-26',
      skipped: false,
      reminder: null,
      deleted: false,
      virtual: true,
    });
  });

  it('ignores invalid recurrences', () => {
    const broken = [
      { ...recurrence, rrule: 'FREQ=SECONDLY' },
      { ...recurrence, startDate: '' },
    ];
    expect(virtualOccurrences(broken, '2026-09-26', '2026-09-28', new Set())).toEqual([]);
  });

  it('stores virtual occurrences in full when changed', () => {
    const [todo] = virtualOccurrences([recurrence], '2026-09-26', '2026-09-26', new Set());
    const changes = todoChanges(todo!, { order: 'a1' });
    expect(changes.map((c) => c.field).toSorted()).toEqual([
      'date',
      'deleted',
      'done',
      'kind',
      'listId',
      'occurrence',
      'order',
      'recurrenceId',
      'reminder',
      'skipped',
      'text',
    ]);
    expect(changes).toContainEqual({
      entity: 'todo',
      id: 'r:2026-09-26',
      field: 'order',
      value: 'a1',
    });
    expect(todoChanges({ ...todo!, virtual: undefined }, { order: 'a1' })).toHaveLength(1);
  });
});
