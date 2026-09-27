import { DatabaseSync } from 'node:sqlite';
import type { Row, SqlDriver } from '../src';

export function memoryDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    query: async (sql, params = []) => db.prepare(sql).all(...params) as Row[],
  };
}
