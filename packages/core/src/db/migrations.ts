import type { SqlDriver } from './driver';

/** Append-only. Never edit a migration that has shipped. */
export const migrations: readonly string[] = [
  `
  CREATE TABLE op_log (
    hlc TEXT NOT NULL,
    entity TEXT NOT NULL,
    id TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (hlc, entity, id, field)
  ) WITHOUT ROWID;

  CREATE TABLE field_state (
    entity TEXT NOT NULL,
    id TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    hlc TEXT NOT NULL,
    PRIMARY KEY (entity, id, field)
  ) WITHOUT ROWID;

  CREATE TABLE todo (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    date TEXT,
    "listId" TEXT,
    "order" TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'todo',
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX todo_date ON todo (date) WHERE deleted = 0;
  CREATE INDEX todo_list ON todo ("listId") WHERE deleted = 0;

  CREATE TABLE list (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    "groupId" TEXT NOT NULL DEFAULT '',
    "order" TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE "listGroup" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    "order" TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE settings (
    id TEXT PRIMARY KEY,
    accent TEXT,
    theme TEXT,
    "dayCount" INTEGER,
    "weekStart" INTEGER,
    "condensedWeekends" INTEGER
  );
  `,
  `
  ALTER TABLE todo ADD COLUMN "recurrenceId" TEXT;
  ALTER TABLE todo ADD COLUMN occurrence TEXT;
  ALTER TABLE todo ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX todo_occurrence ON todo (occurrence, "recurrenceId") WHERE deleted = 0;

  CREATE TABLE recurrence (
    id TEXT PRIMARY KEY,
    rrule TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'todo',
    "order" TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0
  );
  `,
  `
  ALTER TABLE op_log ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX op_log_outbox ON op_log (hlc) WHERE pushed = 0;

  CREATE TABLE sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
];

export async function migrate(driver: SqlDriver): Promise<void> {
  const [row] = await driver.query('PRAGMA user_version');
  const version = Number(row?.user_version ?? 0);
  for (let v = version; v < migrations.length; v++) {
    await driver.exec('BEGIN');
    try {
      await driver.exec(migrations[v]!);
      await driver.exec(`PRAGMA user_version = ${v + 1}`);
      await driver.exec('COMMIT');
    } catch (error) {
      await driver.exec('ROLLBACK');
      throw error;
    }
  }
}
