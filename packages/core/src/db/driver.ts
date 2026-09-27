export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

/** Minimal SQLite connection; implemented per platform (wa-sqlite, Tauri, node:sqlite). */
export interface SqlDriver {
  /** Runs a script of one or more statements without parameters. */
  exec(sql: string): Promise<void>;
  /** Runs a single statement and returns its rows. */
  query(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
}
