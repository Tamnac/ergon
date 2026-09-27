import * as SQLite from '@journeyapps/wa-sqlite';
import SQLiteModuleFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import wasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite.wasm?url';
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import type { Row, SqlDriver } from '@ergon/core';

/** SQLite in OPFS. Must run in a dedicated worker (synchronous access handles). */
export async function openWaSqlite(filename: string): Promise<SqlDriver> {
  const module = await SQLiteModuleFactory({ locateFile: () => wasmUrl });
  const sqlite3 = SQLite.Factory(module);
  sqlite3.vfs_register(await OPFSCoopSyncVFS.create('ergon', module), true);
  const db = await sqlite3.open_v2(filename);

  return {
    async exec(sql) {
      await sqlite3.exec(db, sql);
    },
    async query(sql, params = []) {
      const rows: Row[] = [];
      for await (const stmt of sqlite3.statements(db, sql)) {
        if (params.length > 0) sqlite3.bind_collection(stmt, [...params]);
        const columns = sqlite3.column_names(stmt);
        while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
          const values = sqlite3.row(stmt);
          rows.push(Object.fromEntries(columns.map((column, i) => [column, values[i]])) as Row);
        }
      }
      return rows;
    },
  };
}
