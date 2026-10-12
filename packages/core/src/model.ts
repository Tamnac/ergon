import type { DateStr } from './date';
import type { Hlc } from './hlc';

export type Value = string | number | boolean | null;
export type Theme = 'light' | 'dark' | 'system';
export type DayCount = 1 | 3 | 5 | 7;
export type TodoKind = 'todo' | 'heading';

/**
 * An occurrence of a recurrence is virtual until something about it changes; then it is
 * stored with `recurrenceId` and `occurrence` set. Deleting such a row brings the virtual
 * occurrence back, `skipped` removes the occurrence.
 */
export interface Todo {
  id: string;
  text: string;
  done: boolean;
  date: DateStr | null;
  listId: string | null;
  order: string;
  kind: TodoKind;
  recurrenceId: string | null;
  /** Date the recurrence generated this occurrence for; kept when it moves. */
  occurrence: DateStr | null;
  skipped: boolean;
  /** Local time of day (`HH:MM`) to remind at on `date`; a virtual occurrence takes its recurrence's. */
  reminder: string | null;
  deleted: boolean;
  /** Computed from its recurrence, not stored. */
  virtual?: true;
}

/** A repeating todo. Its occurrences are computed per range, see `virtualOccurrences`. */
export interface Recurrence {
  id: string;
  /** RRULE without DTSTART; `parseRule` lists the supported parts. */
  rrule: string;
  startDate: DateStr;
  text: string;
  kind: TodoKind;
  order: string;
  /** Local time of day (`HH:MM`) every occurrence reminds at. */
  reminder: string | null;
  deleted: boolean;
}

export interface List {
  id: string;
  name: string;
  groupId: string;
  order: string;
  deleted: boolean;
}

export interface ListGroup {
  id: string;
  name: string;
  order: string;
  deleted: boolean;
}

export interface Settings {
  id: string;
  accent: string;
  theme: Theme;
  dayCount: DayCount;
  /** 0 = Sunday … 6 = Saturday, null = locale default */
  weekStart: number | null;
  condensedWeekends: boolean;
  /** Time of day (`HH:MM`) for reminders set without choosing one. */
  reminderTime: string;
}

export interface Rows {
  todo: Todo;
  recurrence: Recurrence;
  list: List;
  listGroup: ListGroup;
  settings: Settings;
}

export type Entity = keyof Rows;
export type Fields<E extends Entity> = Omit<Rows[E], 'id' | 'virtual'>;
export type Field<E extends Entity> = keyof Fields<E> & string;

export type Change = {
  [E in Entity]: { entity: E; id: string; field: Field<E>; value: Value };
}[Entity];

export type Op = Change & { hlc: Hlc };

export const SETTINGS_ID = 'settings';
/** Longest todo text or list name, in characters. */
export const MAX_TEXT = 500;

/** Field defaults; also the list of known fields per entity. */
export const defaults: { [E in Entity]: Fields<E> } = {
  todo: {
    text: '',
    done: false,
    date: null,
    listId: null,
    order: '',
    kind: 'todo',
    recurrenceId: null,
    occurrence: null,
    skipped: false,
    reminder: null,
    deleted: false,
  },
  recurrence: {
    rrule: '',
    startDate: '',
    text: '',
    kind: 'todo',
    order: '',
    reminder: null,
    deleted: false,
  },
  list: { name: '', groupId: '', order: '', deleted: false },
  listGroup: { name: '', order: '', deleted: false },
  settings: {
    accent: '#6d28d9',
    theme: 'system',
    dayCount: 5,
    weekStart: null,
    condensedWeekends: false,
    reminderTime: '09:00',
  },
};

export function isField(entity: string, field: string): boolean {
  return Object.hasOwn(defaults, entity) && Object.hasOwn(defaults[entity as Entity], field);
}

export function fieldDefault(entity: Entity, field: string): Value {
  return (defaults[entity] as Record<string, Value>)[field] ?? null;
}

export function patch<E extends Entity>(
  entity: E,
  id: string,
  values: Partial<Fields<E>>,
): Change[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => ({ entity, id, field, value }) as Change);
}

export function newId(): string {
  return crypto.randomUUID();
}
