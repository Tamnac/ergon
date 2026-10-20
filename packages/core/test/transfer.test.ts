import { describe, expect, it } from 'vitest';
import {
  defaults,
  exportJson,
  exportMarkdown,
  ImportError,
  parseCsv,
  parseTeuxDeux,
  type ExportData,
  type Todo,
} from '../src';

const todo = (id: string, extra: Partial<Todo>): Todo => ({ id, ...defaults.todo, ...extra });

const data: ExportData = {
  groups: [{ id: 'g', name: 'Personal', order: 'a0', deleted: false }],
  lists: [{ id: 'l', name: 'Groceries', groupId: 'g', order: 'a0', deleted: false }],
  todos: [
    todo('b', { text: 'Done thing', date: '2026-10-20', order: 'a1', done: true }),
    todo('a', { text: 'Morning', date: '2026-10-20', order: 'a0', kind: 'heading' }),
    todo('c', { text: '', ink: 'AQ', date: '2026-10-19', order: 'a0' }),
    todo('d', { text: 'Limes', listId: 'l', order: 'a0' }),
  ],
  recurrences: [
    {
      id: 'r',
      ...defaults.recurrence,
      text: 'Water plants',
      rrule: 'FREQ=WEEKLY',
      startDate: '2026-10-01',
    },
  ],
};

describe('export', () => {
  it('writes Markdown with checkboxes', () => {
    expect(exportMarkdown(data)).toBe(`# Ergon export

## Days

### 2026-10-19 Monday

- [ ] Handwritten todo

### 2026-10-20 Tuesday

**Morning**

- [x] Done thing

## Lists

### Personal

#### Groceries

- [ ] Limes

## Repeating

- Water plants (FREQ=WEEKLY, from 2026-10-01)
`);
  });

  it('writes JSON that holds the entities', () => {
    const json = JSON.parse(exportJson(data, new Date('2026-10-20T10:00:00Z')));
    expect(json).toMatchObject({
      format: 'ergon',
      version: 1,
      exportedAt: '2026-10-20T10:00:00.000Z',
    });
    expect(json.todos).toHaveLength(4);
    expect(json.recurrences[0].rrule).toBe('FREQ=WEEKLY');
  });
});

describe('parseCsv', () => {
  it('reads quotes, commas, doubled quotes and line breaks', () => {
    expect(parseCsv('\uFEFFa,"b,c","say ""hi""","x\ny"\r\n1,,2,3\n')).toEqual([
      ['a', 'b,c', 'say "hi"', 'x\ny'],
      ['1', '', '2', '3'],
    ]);
  });
});

const json = JSON.stringify({
  workspaces: [
    {
      calendar_todos: [
        { current_date: '2022-01-10', text: 'Second', done: false, position: 1 },
        { current_date: '2022-01-09', text: 'Later day', done: true, position: 0 },
        { current_date: '2022-01-10', text: 'First', done: true, position: 0 },
        { current_date: '2022-01-10', text: '  ', done: false, position: 2 },
      ],
      list_sets: [
        {
          lists: [
            {
              name: 'Books',
              position: 1,
              todos: [{ text: 'Snow Crash', done: true, position: 0 }],
            },
            {
              name: 'Movies',
              position: 0,
              todos: [
                { text: 'Akira', done: false, position: 1 },
                { text: '# Cyberpunk', done: false, position: 0 },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const csv = `Date,List Set Title,List Title,Position,Text,Complete
2022-01-10,,,1,Second,
2022-01-09,,,0,Later day,Yes
2022-01-10,,,0,First,Yes
,Someday,Movies,1,"Akira, 1988",
,Someday,Movies,0,# Cyberpunk,
,Someday,Books,0,Snow Crash,Yes
`;

describe('parseTeuxDeux', () => {
  it('reads the JSON backup', () => {
    expect(parseTeuxDeux(json)).toEqual({
      days: [
        { date: '2022-01-09', text: 'Later day', done: true },
        { date: '2022-01-10', text: 'First', done: true },
        { date: '2022-01-10', text: 'Second', done: false },
      ],
      groups: [
        {
          name: 'TeuxDeux',
          lists: [
            {
              name: 'Movies',
              todos: [
                { text: '# Cyberpunk', done: false },
                { text: 'Akira', done: false },
              ],
            },
            { name: 'Books', todos: [{ text: 'Snow Crash', done: true }] },
          ],
        },
      ],
    });
  });

  it('reads the CSV backup with the tab title', () => {
    expect(parseTeuxDeux(csv)).toEqual({
      days: [
        { date: '2022-01-09', text: 'Later day', done: true },
        { date: '2022-01-10', text: 'First', done: true },
        { date: '2022-01-10', text: 'Second', done: false },
      ],
      groups: [
        {
          name: 'Someday',
          lists: [
            {
              name: 'Movies',
              todos: [
                { text: '# Cyberpunk', done: false },
                { text: 'Akira, 1988', done: false },
              ],
            },
            { name: 'Books', todos: [{ text: 'Snow Crash', done: true }] },
          ],
        },
      ],
    });
  });

  it('rejects other files', () => {
    expect(() => parseTeuxDeux('{')).toThrow(ImportError);
    expect(() => parseTeuxDeux('{"a":1}')).toThrow(ImportError);
    expect(() => parseTeuxDeux('Name,Value\nx,1')).toThrow(ImportError);
    expect(() => parseTeuxDeux('')).toThrow(ImportError);
  });
});
