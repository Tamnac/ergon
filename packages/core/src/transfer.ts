import { isDateStr, parseDate, type DateStr } from './date';
import { INK_LABEL } from './ink';
import type { List, ListGroup, Recurrence, Todo } from './model';
import { compareOrder } from './order';

/** Everything the user has, as stored: no virtual occurrences, no tombstones. */
export interface ExportData {
  groups: ListGroup[];
  lists: List[];
  /** Todos on days and in lists, including stored occurrences of repeating todos. */
  todos: Todo[];
  recurrences: Recurrence[];
}

export function exportJson(data: ExportData, exportedAt: Date = new Date()): string {
  const backup = { format: 'ergon', version: 1, exportedAt: exportedAt.toISOString(), ...data };
  return JSON.stringify(backup, null, 2);
}

const weekdayFormat = new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' });

const inOrder = <T extends { order: string; id: string }>(items: readonly T[]) =>
  items.toSorted(compareOrder);

const label = (item: Todo | Recurrence) => (item.ink === null ? item.text : INK_LABEL);

/** Headings of a day or list are bold lines set off by blank lines. */
const lines = (todos: readonly Todo[]) =>
  inOrder(todos).flatMap((todo) =>
    todo.kind === 'heading'
      ? ['', `**${label(todo)}**`, '']
      : [`- [${todo.done ? 'x' : ' '}] ${label(todo)}`],
  );

/** Days, lists and repeating todos as Markdown with task list checkboxes. */
export function exportMarkdown({ groups, lists, todos, recurrences }: ExportData): string {
  const out = ['# Ergon export'];
  const add = (heading: string, items: readonly Todo[] = []) => {
    out.push('', heading);
    if (items.length > 0) out.push('', ...lines(items));
  };

  const days = Map.groupBy(
    todos.filter((todo) => todo.date !== null),
    (todo) => todo.date!,
  );
  if (days.size > 0) out.push('', '## Days');
  for (const date of [...days.keys()].toSorted()) {
    add(`### ${date} ${weekdayFormat.format(parseDate(date))}`, days.get(date));
  }

  const listed = Map.groupBy(
    todos.filter((todo) => todo.listId !== null),
    (todo) => todo.listId!,
  );
  if (lists.length > 0) out.push('', '## Lists');
  for (const group of inOrder(groups)) {
    const own = inOrder(lists.filter((list) => list.groupId === group.id));
    if (own.length === 0) continue;
    out.push('', `### ${group.name}`);
    for (const list of own) add(`#### ${list.name}`, listed.get(list.id));
  }

  if (recurrences.length > 0) out.push('', '## Repeating', '');
  for (const recurrence of inOrder(recurrences)) {
    out.push(`- ${label(recurrence)} (${recurrence.rrule}, from ${recurrence.startDate})`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export interface ImportedTodo {
  /** A leading `# ` makes it a heading, as when typed. */
  text: string;
  done: boolean;
}

export interface Imported {
  days: (ImportedTodo & { date: DateStr })[];
  /** Tabs of lists, each with its lists. */
  groups: { name: string; lists: { name: string; todos: ImportedTodo[] }[] }[];
}

export class ImportError extends Error {}

const NOT_TEUXDEUX = 'This is not a TeuxDeux export.';
const GROUP_FALLBACK = 'TeuxDeux';

interface Entry extends ImportedTodo {
  position: number;
}

const byPosition = (entries: readonly Entry[]): ImportedTodo[] =>
  entries.toSorted((a, b) => a.position - b.position).map(({ text, done }) => ({ text, done }));

/** Days in date order, each day's todos by position. */
function groupDays(todos: readonly (Entry & { date: DateStr })[]): Imported['days'] {
  return [...Map.groupBy(todos, (todo) => todo.date)]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([date, entries]) => byPosition(entries).map((todo) => ({ ...todo, date })));
}

type Json = Record<string, unknown>;
const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'object' && item !== null) : [];
const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown) => (typeof value === 'number' ? value : 0);

const entry = (item: Json): Entry => ({
  text: str(item.text),
  done: item.done === true,
  position: num(item.position),
});

function fromJson(source: string): Imported {
  let root: Json;
  try {
    root = JSON.parse(source) as Json;
  } catch {
    throw new ImportError('This file is not valid JSON.');
  }
  const workspaces = records(root.workspaces);
  if (workspaces.length === 0) throw new ImportError(NOT_TEUXDEUX);

  const days: (Entry & { date: DateStr })[] = [];
  const groups: Imported['groups'] = [];
  for (const workspace of workspaces) {
    for (const item of records(workspace.calendar_todos)) {
      const date = str(item.current_date);
      const todo = entry(item);
      if (isDateStr(date) && todo.text) days.push({ ...todo, date });
    }
    for (const set of records(workspace.list_sets)) {
      const lists = records(set.lists)
        .toSorted((a, b) => num(a.position) - num(b.position))
        .map((list) => ({
          name: str(list.name) || 'List',
          todos: byPosition(
            records(list.todos)
              .map(entry)
              .filter((todo) => todo.text),
          ),
        }));
      groups.push({ name: str(set.title) || GROUP_FALLBACK, lists });
    }
  }
  return { days: groupDays(days), groups };
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes (doubled) and line breaks. */
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i + 1] === '"') field += input[++i];
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

const CSV_COLUMNS = ['Date', 'List Set Title', 'List Title', 'Position', 'Text', 'Complete'];

function fromCsv(source: string): Imported {
  const [header, ...rows] = parseCsv(source);
  const at = Object.fromEntries(CSV_COLUMNS.map((name) => [name, header?.indexOf(name) ?? -1]));
  if (Object.values(at).includes(-1)) throw new ImportError(NOT_TEUXDEUX);

  const days: (Entry & { date: DateStr })[] = [];
  const sets = new Map<string, Map<string, Entry[]>>();
  for (const row of rows) {
    const item = {
      text: (row[at.Text!] ?? '').trim(),
      done: row[at.Complete!] === 'Yes',
      position: Number(row[at.Position!]) || 0,
    };
    if (item.text === '') continue;
    const date = row[at.Date!]!;
    if (date) {
      if (isDateStr(date)) days.push({ ...item, date });
      continue;
    }
    const setName = row[at['List Set Title']!] || GROUP_FALLBACK;
    const listName = row[at['List Title']!] || 'List';
    const lists = sets.get(setName) ?? new Map<string, Entry[]>();
    sets.set(setName, lists);
    lists.set(listName, [...(lists.get(listName) ?? []), item]);
  }
  const groups = [...sets].map(([name, lists]) => ({
    name,
    lists: [...lists].map(([name, entries]) => ({ name, todos: byPosition(entries) })),
  }));
  return { days: groupDays(days), groups };
}

/** Reads a TeuxDeux export: the `data.json` or `data.csv` of its backup. */
export function parseTeuxDeux(source: string): Imported {
  const text = source.replace(/^\uFEFF/, '').trimStart();
  return text.startsWith('{') ? fromJson(text) : fromCsv(text);
}
