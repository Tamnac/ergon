import type { DateStr } from '../date';
import { Clock, randomNode, type Hlc } from '../hlc';
import { wins } from '../merge';
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
  type Rows,
  type Settings,
  type Todo,
  type Value,
} from '../model';
import type { ChangeListener, Storage, TodoMark } from '../storage';
import type { Row, SqlDriver, SqlValue } from './driver';
import { migrate } from './migrations';

/**
 * Op log plus materialized tables on top of a SQL driver. Every write is recorded in
 * `op_log`; `field_state` keeps the winning op per field and the entity tables mirror it.
 */
export class Database implements Storage {
  readonly #driver: SqlDriver;
  readonly #clock: Clock;
  readonly #listeners = new Set<ChangeListener>();
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(driver: SqlDriver, clock: Clock) {
    this.#driver = driver;
    this.#clock = clock;
  }

  static async open(driver: SqlDriver, now: () => number = Date.now): Promise<Database> {
    await migrate(driver);
    const db = new Database(driver, new Clock(randomNode(), now));
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
      return [inverse, await this.#merge(ops, inverse)];
    });
  }

  /** Merges ops from elsewhere (sync). Unknown entities/fields are logged but not materialized. */
  apply(ops: readonly Op[]): Promise<void> {
    return this.#mutate(async () => {
      for (const op of ops) this.#clock.receive(op.hlc);
      return [undefined, await this.#merge(ops)];
    });
  }

  todosBetween(from: DateStr, to: DateStr, today: DateStr): Promise<Todo[]> {
    const rollover = from <= today && today <= to;
    return this.#select(
      'todo',
      `SELECT * FROM todo WHERE deleted = 0 AND (date BETWEEN ? AND ?${rollover ? ' OR (done = 0 AND date < ?)' : ''}) ORDER BY "order", id`,
      rollover ? [from, to, today] : [from, to],
    );
  }

  async todoMarks(from: DateStr, to: DateStr, today: DateStr): Promise<TodoMark[]> {
    const rows = await this.#serial(() =>
      this.#driver.query(
        `SELECT id, day, done, length(text) AS length FROM (
           SELECT *, CASE WHEN done = 0 AND date < ? THEN ? ELSE date END AS day FROM todo
           WHERE deleted = 0 AND kind = 'todo' AND (date BETWEEN ? AND ? OR (done = 0 AND date < ?))
         ) WHERE day BETWEEN ? AND ? ORDER BY day, "order", id`,
        [today, today, from, to, today, from, to],
      ),
    );
    return rows.map((row) => ({
      id: row.id as string,
      date: row.day as DateStr,
      done: Number(row.done) === 1,
      length: Number(row.length),
    }));
  }

  listTodos(): Promise<Todo[]> {
    return this.#select(
      'todo',
      `SELECT * FROM todo WHERE deleted = 0
       AND "listId" IN (SELECT id FROM list WHERE deleted = 0) ORDER BY "order", id`,
    );
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
    return this.#serial(async () =>
      (await this.#driver.query(sql, params)).map((row) => fromRow(entity, row)),
    );
  }

  /**
   * Logs `ops` and materializes the winners, one entity at a time. If `inverse` is given,
   * the changes that restore the state before `ops` are appended to it.
   */
  async #merge(ops: readonly Op[], inverse?: Change[]): Promise<Set<Entity>> {
    const touched = new Set<Entity>();
    for (const group of groupByEntity(ops)) {
      const { entity, id } = group[0]!;
      const current = await this.#fieldState(entity, id);
      inverse?.push(...inverseOf(entity, id, group, current));

      await this.#driver.query(
        `INSERT OR IGNORE INTO op_log (hlc, entity, id, field, value) VALUES ${placeholders(group.length, 5)}`,
        group.flatMap((op) => [op.hlc, entity, id, op.field, JSON.stringify(op.value)]),
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
