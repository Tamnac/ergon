import type { DateStr } from './date';
import type { Hlc } from './hlc';

export type Value = string | number | boolean | null;
export type Theme = 'light' | 'dark' | 'system';
export type DayCount = 1 | 3 | 5 | 7;
export type TodoKind = 'todo' | 'heading';

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  date: DateStr | null;
  listId: string | null;
  order: string;
  kind: TodoKind;
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
}

export interface Rows {
  todo: Todo;
  list: List;
  listGroup: ListGroup;
  settings: Settings;
}

export type Entity = keyof Rows;
export type Fields<E extends Entity> = Omit<Rows[E], 'id'>;
export type Field<E extends Entity> = keyof Fields<E> & string;

export type Change = {
  [E in Entity]: { entity: E; id: string; field: Field<E>; value: Value };
}[Entity];

export type Op = Change & { hlc: Hlc };

export const SETTINGS_ID = 'settings';

/** Field defaults; also the list of known fields per entity. */
export const defaults: { [E in Entity]: Fields<E> } = {
  todo: {
    text: '',
    done: false,
    date: null,
    listId: null,
    order: '',
    kind: 'todo',
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
