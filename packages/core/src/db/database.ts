import type { DateStr } from '../date';
import { Clock, randomNode, type Hlc } from '../hlc';
import { wins } from '../merge';
import { INK_LABEL } from '../ink';
import { compareOrder, type Ordered } from '../order';
import { occurrenceId, virtualOccurrences } from '../recurrence';
import { isTime, type Reminder } from '../reminder';
import {
  SETTINGS_ID,
  defaults,
  fieldDefault,
  isField,
  type Change,
  type Entity,
  type List,
  type ListGroup,
  type Op,
  type Recurrence,
  type Rows,
  type Settings,
  type Todo,
  type Value,
} from '../model';
import type { ChangeListener, Storage, TodoMark } from '../storage';
import type { Row, SqlDriver, SqlValue } from './driver';
import { migrate } from './migrations';

/** Keeps secrets outside the database file, e.g. in the OS keychain. */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string | undefined): Promise<void>;
}

/**
 * Op log plus materialized tables on top of a SQL driver. Every write is recorded in
 * `op_log`; `field_state` keeps the winning op per field and the entity tables mirror it.
 */
export class Database implements Storage {
  readonly #driver: SqlDriver;
  readonly #clock: Clock;
  readonly #secrets: SecretStore | undefined;
  readonly #listeners = new Set<ChangeListener>();
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(driver: SqlDriver, clock: Clock, secrets?: SecretStore) {
    this.#driver = driver;
    this.#clock = clock;
    this.#secrets = secrets;
  }

  /** `secrets` defaults to the `sync_state` table, i.e. the database file itself. */
  static async open(
    driver: SqlDriver,
    now: () => number = Date.now,
    secrets?: SecretStore,
  ): Promise<Database> {
    await migrate(driver);
    const db = new Database(driver, new Clock(randomNode(), now), secrets);
    await db.#catchUp();
    return db;
  }

  /** Moves the clock past ops written by other connections (e.g. other tabs), so local writes win. */
  async #catchUp() {
    const [row] = await this.#driver.query('SELECT max(hlc) AS hlc FROM op_log');
    if (typeof row?.hlc === 'string') this.#clock.receive(row.hlc);
  }

  write(changes: readonly Change[]): Promise<Change[]> {
    return this.#mutate(async () => {
      await this.#catchUp();
      const ops = changes.map((change) => ({ ...change, hlc: this.#clock.tick() }) as Op);
      const inverse: Change[] = [];
      return [inverse, await this.#merge(ops, false, inverse)];
    });
  }

  /**
   * Merges ops that came from the sync server. Unknown entities/fields are logged but not
   * materialized, so a later version can pick them up.
   */
  apply(ops: readonly Op[]): Promise<void> {
    return this.#mutate(async () => {
      for (const op of ops) this.#clock.receive(op.hlc);
      return [undefined, await this.#merge(ops, true)];
    });
  }

  /** Local ops not yet on the sync server, oldest first. */
  outbox(limit: number): Promise<Op[]> {
    return this.#serial(async () =>
      (
        await this.#driver.query(
          'SELECT hlc, entity, id, field, value FROM op_log WHERE pushed = 0 ORDER BY hlc LIMIT ?',
          [limit],
        )
      ).map(toOp),
    );
  }

  markPushed(ops: readonly Op[]): Promise<void> {
    return this.#serial(async () => {
      await this.#driver.query(
        `UPDATE op_log SET pushed = 1 WHERE pushed = 0 AND hlc IN ${placeholders(1, ops.length)}`,
        ops.map((op) => op.hlc),
      );
    });
  }

  /** Queues every logged op for pushing again, e.g. when syncing with a different account. */
  resetOutbox(): Promise<void> {
    return this.#serial(() => this.#driver.exec('UPDATE op_log SET pushed = 0'));
  }

  /** The newest op per field, including fields this version doesn't know. */
  compacted(): Promise<Op[]> {
    return this.#serial(async () =>
      (
        await this.#driver.query(
          'SELECT max(hlc) AS hlc, entity, id, field, value FROM op_log GROUP BY entity, id, field',
        )
      ).map(toOp),
    );
  }

  /** Device-local sync state; never synced. */
  local(key: string): Promise<string | undefined> {
    return this.#serial(async () => {
      const [row] = await this.#driver.query('SELECT value FROM sync_state WHERE key = ?', [key]);
      return row?.value as string | undefined;
    });
  }

  setLocal(key: string, value: string | undefined): Promise<void> {
    return this.#serial(async () => {
      if (value === undefined) {
        await this.#driver.query('DELETE FROM sync_state WHERE key = ?', [key]);
      } else {
        await this.#driver.query(
          'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          [key, value],
        );
      }
    });
  }

  /** Like `local`, but kept in the secret store if there is one. */
  secret(key: string): Promise<string | undefined> {
    return this.#secrets ? this.#secrets.get(key) : this.local(key);
  }

  setSecret(key: string, value: string | undefined): Promise<void> {
    return this.#secrets ? this.#secrets.set(key, value) : this.setLocal(key, value);
  }

  todosBetween(from: DateStr, to: DateStr, today: DateStr): Promise<Todo[]> {
    const rollover = from <= today && today <= to;
    return this.#serial(async () => {
      const rows = await this.#rows(
        'todo',
        `SELECT * FROM todo WHERE deleted = 0 AND skipped = 0
         AND (date BETWEEN ? AND ?${rollover ? ` OR (${ROLLS_OVER})` : ''})`,
        rollover ? [from, to, today] : [from, to],
      );
      return [...rows, ...(await this.#virtualTodos(from, to))].toSorted(compareOrder);
    });
  }

  todoMarks(from: DateStr, to: DateStr, today: DateStr): Promise<TodoMark[]> {
    return this.#serial(async () => {
      const rows = await this.#driver.query(
        `SELECT id, day, done, "order",
           CASE WHEN ink IS NULL THEN length(text) ELSE ${INK_MARK_LENGTH} END AS length FROM (
           SELECT *, CASE WHEN ${ROLLS_OVER} THEN ? ELSE date END AS day FROM todo
           WHERE deleted = 0 AND skipped = 0 AND kind = 'todo'
           AND (date BETWEEN ? AND ? OR (${ROLLS_OVER}))
         ) WHERE day BETWEEN ? AND ?`,
        [today, today, from, to, today, from, to],
      );
      const marks: (TodoMark & Ordered)[] = rows.map((row) => ({
        id: row.id as string,
        date: row.day as DateStr,
        done: Number(row.done) === 1,
        length: Number(row.length),
        order: row.order as string,
      }));
      for (const todo of await this.#virtualTodos(from, to)) {
        if (todo.kind !== 'todo') continue;
        const { id, date, order, text, ink } = todo;
        const length = ink === null ? text.length : INK_MARK_LENGTH;
        marks.push({ id, date: date!, done: false, length, order });
      }
      return marks
        .toSorted((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : compareOrder(a, b)))
        .map(({ id, date, done, length }) => ({ id, date, done, length }));
    });
  }

  reminders(from: DateStr, to: DateStr): Promise<Reminder[]> {
    return this.#serial(async () => {
      const stored = await this.#rows(
        'todo',
        `SELECT * FROM todo WHERE deleted = 0 AND skipped = 0 AND done = 0 AND kind = 'todo'
         AND reminder IS NOT NULL AND date BETWEEN ? AND ?`,
        [from, to],
      );
      const todos = [...stored, ...(await this.#virtualTodos(from, to))];
      return todos
        .filter((todo) => todo.kind === 'todo' && isTime(todo.reminder))
        .map((todo) => ({
          id: todo.id,
          date: todo.date!,
          time: todo.reminder!,
          text: todo.ink === null ? todo.text : INK_LABEL,
        }))
        .toSorted((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    });
  }

  listTodos(): Promise<Todo[]> {
    return this.#select(
      'todo',
      `SELECT * FROM todo WHERE deleted = 0 AND skipped = 0
       AND "listId" IN (SELECT id FROM list WHERE deleted = 0) ORDER BY "order", id`,
    );
  }

  recurrences(): Promise<Recurrence[]> {
    return this.#select('recurrence', 'SELECT * FROM recurrence WHERE deleted = 0 ORDER BY id');
  }

  seriesTodos(recurrenceId: string): Promise<Todo[]> {
    return this.#select(
      'todo',
      'SELECT * FROM todo WHERE deleted = 0 AND "recurrenceId" = ? ORDER BY occurrence, id',
      [recurrenceId],
    );
  }

  async #virtualTodos(from: DateStr, to: DateStr): Promise<Todo[]> {
    const recurrences = await this.#rows(
      'recurrence',
      'SELECT * FROM recurrence WHERE deleted = 0 AND "startDate" <= ?',
      [to],
    );
    if (recurrences.length === 0) return [];
    const stored = await this.#driver.query(
      `SELECT "recurrenceId", occurrence FROM todo
       WHERE deleted = 0 AND occurrence BETWEEN ? AND ? AND "recurrenceId" IS NOT NULL`,
      [from, to],
    );
    const ids = stored.map((row) =>
      occurrenceId(row.recurrenceId as string, row.occurrence as string),
    );
    return virtualOccurrences(recurrences, from, to, new Set(ids));
  }

  lists(): Promise<List[]> {
    return this.#select('list', 'SELECT * FROM list WHERE deleted = 0 ORDER BY "order", id');
  }

  listGroups(): Promise<ListGroup[]> {
    return this.#select(
      'listGroup',
      'SELECT * FROM "listGroup" WHERE deleted = 0 ORDER BY "order", id',
    );
  }

  async settings(): Promise<Settings> {
    const [row] = await this.#select('settings', 'SELECT * FROM settings WHERE id = ?', [
      SETTINGS_ID,
    ]);
    return row ?? { id: SETTINGS_ID, ...defaults.settings };
  }

  subscribe(listener: ChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #mutate<T>(task: () => Promise<[T, Set<Entity>]>): Promise<T> {
    const [result, touched] = await this.#serial(async () => {
      await this.#driver.exec('BEGIN IMMEDIATE');
      try {
        const out = await task();
        await this.#driver.exec('COMMIT');
        return out;
      } catch (error) {
        await this.#driver.exec('ROLLBACK');
        throw error;
      }
    });
    if (touched.size > 0) for (const listener of this.#listeners) listener(touched);
    return result;
  }

  #select<E extends Entity>(
    entity: E,
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<Rows[E][]> {
    return this.#serial(() => this.#rows(entity, sql, params));
  }

  async #rows<E extends Entity>(
    entity: E,
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<Rows[E][]> {
    return (await this.#driver.query(sql, params)).map((row) => fromRow(entity, row));
  }

  /**
   * Logs `ops` and materializes the winners, one entity at a time. If `inverse` is given,
   * the changes that restore the state before `ops` are appended to it.
   */
  async #merge(ops: readonly Op[], pushed: boolean, inverse?: Change[]): Promise<Set<Entity>> {
    const touched = new Set<Entity>();
    for (const group of groupByEntity(ops)) {
      const { entity, id } = group[0]!;
      const current = await this.#fieldState(entity, id);
      inverse?.push(...inverseOf(entity, id, group, current));

      await this.#driver.query(
        `INSERT INTO op_log (hlc, entity, id, field, value, pushed) VALUES ${placeholders(group.length, 6)}
         ON CONFLICT (hlc, entity, id, field) DO UPDATE SET pushed = max(pushed, excluded.pushed)`,
        group.flatMap((op) => [
          op.hlc,
          entity,
          id,
          op.field,
          JSON.stringify(op.value),
          Number(pushed),
        ]),
      );

      const winners = new Map<string, Op>();
      for (const op of group) {
        if (!isField(entity, op.field)) continue;
        if (wins(op.hlc, winners.get(op.field)?.hlc ?? current.get(op.field)?.hlc)) {
          winners.set(op.field, op);
        }
      }
      if (winners.size === 0) continue;
      const won = [...winners.values()];

      await this.#driver.query(
        `INSERT INTO field_state (entity, id, field, value, hlc) VALUES ${placeholders(won.length, 5)}
         ON CONFLICT (entity, id, field) DO UPDATE SET value = excluded.value, hlc = excluded.hlc`,
        won.flatMap((op) => [entity, id, op.field, JSON.stringify(op.value), op.hlc]),
      );
      const columns = won.map((op) => `"${op.field}"`);
      await this.#driver.query(
        `INSERT INTO "${entity}" (id, ${columns.join(', ')}) VALUES ${placeholders(1, won.length + 1)}
         ON CONFLICT (id) DO UPDATE SET ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}`,
        [id, ...won.map((op) => toSql(op.value))],
      );
      touched.add(entity);
    }
    return touched;
  }

  async #fieldState(entity: Entity, id: string): Promise<Map<string, FieldState>> {
    const rows = await this.#driver.query(
      'SELECT field, value, hlc FROM field_state WHERE entity = ? AND id = ?',
      [entity, id],
    );
    return new Map(
      rows.map((row) => [row.field as string, { value: row.value as string, hlc: row.hlc as Hlc }]),
    );
  }
}

/** Text length an ink todo counts as in calendar marks. */
const INK_MARK_LENGTH = 20;
/** SQL condition for todos that show on today instead of their date; binds `today`. */
const ROLLS_OVER = 'done = 0 AND date < ? AND "recurrenceId" IS NULL';

interface FieldState {
  /** JSON-encoded. */
  value: string;
  hlc: Hlc;
}

function groupByEntity(ops: readonly Op[]): Op[][] {
  const groups = new Map<string, Op[]>();
  for (const op of ops) {
    const key = `${op.entity}\u0000${op.id}`;
    const group = groups.get(key);
    if (group) group.push(op);
    else groups.set(key, [op]);
  }
  return [...groups.values()];
}

function placeholders(rows: number, columns: number): string {
  const row = `(${Array.from({ length: columns }, () => '?').join(', ')})`;
  return Array.from({ length: rows }, () => row).join(', ');
}

/** Changes restoring `current`; entities that don't exist yet get deleted. */
function inverseOf(
  entity: Entity,
  id: string,
  ops: readonly Op[],
  current: ReadonlyMap<string, FieldState>,
): Change[] {
  if (current.size === 0 && isField(entity, 'deleted')) {
    return [{ entity, id, field: 'deleted', value: true } as Change];
  }
  const fields = new Set(ops.map((op) => op.field).filter((field) => isField(entity, field)));
  return [...fields].map((field) => {
    const previous = current.get(field);
    const value = previous ? (JSON.parse(previous.value) as Value) : fieldDefault(entity, field);
    return { entity, id, field, value } as Change;
  });
}

function toOp(row: Row): Op {
  const { hlc, entity, id, field, value } = row as Record<string, string>;
  return { hlc, entity, id, field, value: JSON.parse(value!) as Value } as Op;
}

function toSql(value: Value): SqlValue {
  return typeof value === 'boolean' ? Number(value) : value;
}

function fromRow<E extends Entity>(entity: E, row: Row): Rows[E] {
  const out: Record<string, Value> = { id: row.id as string };
  for (const [field, fallback] of Object.entries(defaults[entity]) as [string, Value][]) {
    const value = row[field];
    if (value === null || value === undefined) out[field] = fallback;
    else out[field] = typeof fallback === 'boolean' ? Number(value) === 1 : value;
  }
  return out as unknown as Rows[E];
}
