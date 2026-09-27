import type { DateStr } from './date';
import type { Change, Entity, List, ListGroup, Settings, Todo } from './model';

export type ChangeListener = (entities: ReadonlySet<Entity>) => void;

/** What the UI needs from local storage, independent of the SQLite backend. */
export interface Storage {
  /** Stamps and applies changes; resolves with the changes that undo them. */
  write(changes: readonly Change[]): Promise<Change[]>;
  /** Todos dated in `[from, to]`, plus undone past todos if `today` is in range. */
  todosBetween(from: DateStr, to: DateStr, today: DateStr): Promise<Todo[]>;
  listTodos(): Promise<Todo[]>;
  lists(): Promise<List[]>;
  listGroups(): Promise<ListGroup[]>;
  settings(): Promise<Settings>;
  subscribe(listener: ChangeListener): () => void;
}
