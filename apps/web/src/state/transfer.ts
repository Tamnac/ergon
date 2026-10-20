import {
  exportJson,
  exportMarkdown,
  parseTeuxDeux,
  type ExportData,
  type Imported,
} from '@ergon/core';
import { download } from '../lib/download';
import { importTodos } from './actions';
import { storage } from './storage';
import { today } from './today';

export type ExportFormat = 'json' | 'markdown';

async function exportData(): Promise<ExportData> {
  const [groups, lists, todos, recurrences] = await Promise.all([
    storage.listGroups(),
    storage.lists(),
    storage.allTodos(),
    storage.recurrences(),
  ]);
  return { groups, lists, todos, recurrences };
}

/** Downloads everything as JSON (all fields) or Markdown (readable, for other tools). */
export async function exportAs(format: ExportFormat) {
  const data = await exportData();
  const name = `ergon-${today()}`;
  if (format === 'json') download(`${name}.json`, exportJson(data), 'application/json');
  else download(`${name}.md`, exportMarkdown(data), 'text/markdown');
}

/** Counts of what an import added. */
export function summarize({ days, groups }: Imported) {
  const lists = groups.flatMap((group) => group.lists);
  return {
    todos: days.length + lists.reduce((sum, list) => sum + list.todos.length, 0),
    lists: lists.length,
  };
}

/** Adds the todos of a TeuxDeux backup file (`data.json` or `data.csv`). */
export async function importTeuxDeux(file: File) {
  const imported = parseTeuxDeux(await file.text());
  await importTodos(imported);
  return summarize(imported);
}
