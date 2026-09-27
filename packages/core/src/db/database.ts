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
import type { ChangeListener, Storage } from '../storage';
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
      const inverse = await this.#inverse(changes);
      const ops = changes.map((change) => ({ ...change, hlc: this.#clock.tick() }) as Op);
      return [inverse, await this.#merge(ops)];
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

  async #merge(ops: readonly Op[]): Promise<Set<Entity>> {
    const touched = new Set<Entity>();
    for (const op of ops) {
      const value = JSON.stringify(op.value);
      await this.#driver.query(
        'INSERT OR IGNORE INTO op_log (hlc, entity, id, field, value) VALUES (?, ?, ?, ?, ?)',
        [op.hlc, op.entity, op.id, op.field, value],
      );
      if (!isField(op.entity, op.field)) continue;

      const [current] = await this.#driver.query(
        'SELECT hlc FROM field_state WHERE entity = ? AND id = ? AND field = ?',
        [op.entity, op.id, op.field],
      );
      if (!wins(op.hlc, current?.hlc as Hlc | undefined)) continue;

      await this.#driver.query(
        `INSERT INTO field_state (entity, id, field, value, hlc) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (entity, id, field) DO UPDATE SET value = excluded.value, hlc = excluded.hlc`,
        [op.entity, op.id, op.field, value, op.hlc],
      );
      await this.#driver.query(
        `INSERT INTO "${op.entity}" (id, "${op.field}") VALUES (?, ?)
         ON CONFLICT (id) DO UPDATE SET "${op.field}" = excluded."${op.field}"`,
        [op.id, toSql(op.value)],
      );
      touched.add(op.entity);
    }
    return touched;
  }

  /** Changes restoring the current values; entities that don't exist yet get deleted. */
  async #inverse(changes: readonly Change[]): Promise<Change[]> {
    const inverse: Change[] = [];
    const seen = new Set<string>();
    const created = new Set<string>();
    for (const change of changes) {
      const { entity, id, field } = change;
      const key = `${entity}\u0000${id}\u0000${field}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const [previous] = await this.#driver.query(
        'SELECT value FROM field_state WHERE entity = ? AND id = ? AND field = ?',
        [entity, id, field],
      );
      if (previous) {
        inverse.push({ ...change, value: JSON.parse(previous.value as string) as Value });
        continue;
      }

      const [exists] = await this.#driver.query(
        'SELECT 1 FROM field_state WHERE entity = ? AND id = ? LIMIT 1',
        [entity, id],
      );
      if (!exists && isField(entity, 'deleted')) {
        const entityKey = `${entity}\u0000${id}`;
        if (!created.has(entityKey)) {
          created.add(entityKey);
          inverse.push({ entity, id, field: 'deleted', value: true } as Change);
        }
        continue;
      }
      inverse.push({ ...change, value: fieldDefault(entity, field) });
    }
    return inverse;
  }
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
