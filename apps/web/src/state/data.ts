import {
  SETTINGS_ID,
  defaults,
  localeWeekStart,
  type List,
  type ListGroup,
  type Settings,
  type Todo,
} from '@ergon/core';
import { createMemo, createRoot } from 'solid-js';
import { createQuery } from './query';
import { storage } from './storage';

export const { settings, settingsReady, groups, groupsReady, lists, listTodos, todosByList } =
  createRoot(() => {
    const [settings, settingsReady] = createQuery<Settings>(
      ['settings'],
      () => storage.settings(),
      {
        id: SETTINGS_ID,
        ...defaults.settings,
      },
    );
    const [groups, groupsReady] = createQuery<ListGroup[]>(
      ['listGroup'],
      () => storage.listGroups(),
      [],
    );
    const [lists] = createQuery<List[]>(['list'], () => storage.lists(), []);
    const [listTodos] = createQuery<Todo[]>(['todo'], () => storage.listTodos(), []);
    const todosByList = createMemo(() => groupBy(listTodos, (todo) => todo.listId));
    return { settings, settingsReady, groups, groupsReady, lists, listTodos, todosByList };
  });

export const weekStart = () => settings.weekStart ?? localeWeekStart();

export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}
