import {
  addDays,
  effectiveDate,
  matchesWords,
  occurrenceId,
  occurrences,
  parseDate,
  searchWords,
  tryParseRule,
  type DateStr,
  type List,
} from '@ergon/core';
import { lists, groups, recurrences } from './data';
import { storage } from './storage';
import { today } from './today';
import {
  activeGroup,
  jumpTo,
  setActiveGroupId,
  setFocusRequest,
  setMobileView,
  setPanelOpen,
  targetKey,
  visibleDays,
} from './view';

const TODO_LIMIT = 50;
/** How far ahead the next occurrence of a repeating todo is looked for. */
const REPEAT_HORIZON_DAYS = 366;

export interface SearchHit {
  key: string;
  text: string;
  /** Where it is: a date, or the tab and list. */
  place: string;
  done: boolean;
  /** Brings the hit into view. */
  show(): void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const yearFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const formatDay = (date: DateStr) =>
  (date.slice(0, 4) === today().slice(0, 4) ? dateFormat : yearFormat).format(parseDate(date));

function showDay(date: DateStr, id: string) {
  setMobileView('days');
  if (!visibleDays().includes(date)) jumpTo(date);
  setFocusRequest({ id, key: targetKey({ date }) });
}

function showList(list: List, id?: string) {
  setMobileView('lists');
  setPanelOpen(true);
  setActiveGroupId(list.groupId);
  if (id) setFocusRequest({ id, key: targetKey({ listId: list.id }) });
}

const listPlace = (list: List) => {
  const group = groups.find((g) => g.id === list.groupId);
  return group && groups.length > 1 && group.id !== activeGroup()?.id
    ? `${group.name} · ${list.name}`
    : list.name;
};

/** Lists, repeating todos with an upcoming occurrence, and todos matching `query`. */
export async function search(query: string): Promise<SearchHit[]> {
  const words = searchWords(query);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];

  for (const list of lists) {
    if (!matchesWords(list.name, words)) continue;
    hits.push({
      key: `list:${list.id}`,
      text: list.name,
      place: groups.find((g) => g.id === list.groupId)?.name ?? 'List',
      done: false,
      show: () => showList(list),
    });
  }

  for (const recurrence of recurrences) {
    const rule = tryParseRule(recurrence.rrule);
    if (!rule || !matchesWords(recurrence.text, words)) continue;
    const from = today() > recurrence.startDate ? today() : recurrence.startDate;
    const [next] = occurrences(
      rule,
      recurrence.startDate,
      from,
      addDays(from, REPEAT_HORIZON_DAYS),
    );
    if (!next) continue;
    hits.push({
      key: `repeat:${recurrence.id}`,
      text: recurrence.text,
      place: `Repeats, next ${formatDay(next)}`,
      done: false,
      show: () => showDay(next, occurrenceId(recurrence.id, next)),
    });
  }

  for (const todo of await storage.search(query, today(), TODO_LIMIT)) {
    const list = lists.find((l) => l.id === todo.listId);
    const date = effectiveDate(todo, today());
    hits.push({
      key: todo.id,
      text: todo.text,
      place: date ? formatDay(date) : list ? listPlace(list) : '',
      done: todo.done,
      show: () => {
        if (date) showDay(date, todo.id);
        else if (list) showList(list, todo.id);
      },
    });
  }
  return hits;
}
