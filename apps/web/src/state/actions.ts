import {
  SETTINGS_ID,
  addDays,
  compareOrder,
  completionChanges,
  effectiveDate,
  formatRule,
  MAX_TEXT,
  newId,
  occurrences,
  orderAt,
  ordersAfter,
  parseRule,
  patch,
  reminderChanges,
  splitRule,
  todoChanges,
  tryParseRule,
  type Change,
  type DateStr,
  type Fields,
  type Imported,
  type ImportedTodo,
  type List,
  type ListGroup,
  type Ordered,
  type Recurrence,
  type Rule,
  type Todo,
} from '@ergon/core';
import { createSignal } from 'solid-js';
import { cancelCompletion } from '../lib/effects';
import { storage } from './storage';
import { today } from './today';
import { setFocusRequest, targetKey, type Target } from './view';

const UNDO_LIMIT = 50;
const undoStack: Change[][] = [];
const [canUndo, setCanUndo] = createSignal(false);
export { canUndo };

let queue: Promise<unknown> = Promise.resolve();

/** Runs actions one at a time, so each one reads the writes of the previous ones. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function commit(changes: Change[], undoable = true) {
  if (changes.length === 0) return;
  const inverse = await storage.write(changes);
  if (!undoable) return;
  undoStack.push(inverse);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  setCanUndo(true);
}

export function undo() {
  return serial(async () => {
    const inverse = undoStack.pop();
    setCanUndo(undoStack.length > 0);
    if (!inverse) return;
    cancelCompletion();
    await storage.write(inverse);
  });
}

const reorder = (entity: 'list' | 'listGroup', items: Ordered[]) =>
  items.flatMap((item) => patch(entity, item.id, { order: item.order }));

function reorderTodos(siblings: readonly Todo[], rekeyed: Ordered[]) {
  const byId = new Map(siblings.map((todo) => [todo.id, todo]));
  return rekeyed.flatMap(({ id, order }) => todoChanges(byId.get(id)!, { order }));
}

const placeOf = (todo: Todo): Target =>
  todo.listId !== null ? { listId: todo.listId } : { date: effectiveDate(todo, today())! };

const locationOf = (target: Target): Pick<Todo, 'date' | 'listId'> =>
  'date' in target ? { date: target.date, listId: null } : { date: null, listId: target.listId };

/** Todos in a day or list, in display order. */
async function todosIn(target: Target): Promise<Todo[]> {
  if ('listId' in target) {
    return (await storage.listTodos()).filter((t) => t.listId === target.listId);
  }
  const day = await storage.todosBetween(target.date, target.date, today());
  return day.filter((t) => effectiveDate(t, today()) === target.date).toSorted(compareOrder);
}

/** What a todo shows: text or ink, never both. */
export type Content = Pick<Todo, 'text' | 'ink' | 'kind'>;

export const sameContent = (a: Content, b: Content) =>
  a.text === b.text && a.ink === b.ink && a.kind === b.kind;

const isEmpty = (content: Content) => !content.text && content.ink === null;

export function parseEntry(input: string): Content {
  const heading = /^#\s*(.*)$/.exec(input.trim());
  const text = (heading ? heading[1]! : input).trim().slice(0, MAX_TEXT);
  return { text, ink: null, kind: heading ? 'heading' : 'todo' };
}

const inkContent = (ink: string): Content => ({ text: '', ink: ink || null, kind: 'todo' });

export function addTodo(target: Target, input: string) {
  return serial(() => add(target, parseEntry(input)));
}

/** Adds a handwritten todo; `ink` is from `encodeInk`. */
export function addInkTodo(target: Target, ink: string) {
  return serial(() => add(target, inkContent(ink)));
}

async function add(target: Target, content: Content) {
  if (isEmpty(content)) return;
  const siblings = await todosIn(target);
  const { order, rekeyed } = orderAt(siblings, siblings.length);
  await commit([
    ...patch('todo', newId(), {
      ...content,
      ...locationOf(target),
      order,
      done: false,
    }),
    ...reorderTodos(siblings, rekeyed),
  ]);
}

/** Which occurrences of a recurring todo an edit applies to. */
export type Scope = 'this' | 'following' | 'all';

interface Series {
  recurrence: Recurrence;
  rule: Rule;
  /** Stored occurrences. */
  todos: Todo[];
  /** The occurrence being edited. */
  at: DateStr;
}

async function seriesOf(todo: Todo): Promise<Series | undefined> {
  if (todo.recurrenceId === null || todo.occurrence === null) return undefined;
  const recurrence = (await storage.recurrences()).find((r) => r.id === todo.recurrenceId);
  const rule = recurrence && tryParseRule(recurrence.rrule);
  if (!recurrence || !rule) return undefined;
  const todos = await storage.seriesTodos(recurrence.id);
  return { recurrence, rule, todos, at: todo.occurrence };
}

const storedFrom = (series: Series, date: DateStr) =>
  series.todos.filter((todo) => todo.occurrence! >= date);

/** Ends the series before `at`, deleting the stored occurrences from then on. */
function endSeries(series: Series, at: DateStr): Change[] {
  const { recurrence, rule } = series;
  const { before } = splitRule(rule, recurrence.startDate, at);
  return [
    ...patch(
      'recurrence',
      recurrence.id,
      before ? { rrule: formatRule(before) } : { deleted: true },
    ),
    ...storedFrom(series, at).flatMap((todo) => patch('todo', todo.id, { deleted: true })),
  ];
}

/**
 * Applies `values` to the series from `at` on: to the recurrence itself if `at` is its start,
 * otherwise to a new recurrence split off at `at`. Stored occurrences from `at` on move to it
 * and get `update(todo)`.
 */
function reshape(
  series: Series,
  at: DateStr,
  values: Partial<Fields<'recurrence'>>,
  update: (todo: Todo) => Partial<Fields<'todo'>>,
): Change[] {
  const { recurrence, rule } = series;
  const { before, after } = splitRule(rule, recurrence.startDate, at);
  if (!before) {
    return [
      ...patch('recurrence', recurrence.id, values),
      ...storedFrom(series, at).flatMap((todo) => patch('todo', todo.id, update(todo))),
    ];
  }
  const id = newId();
  return [
    ...patch('recurrence', recurrence.id, { rrule: formatRule(before) }),
    ...patch('recurrence', id, {
      text: recurrence.text,
      ink: recurrence.ink,
      kind: recurrence.kind,
      order: recurrence.order,
      reminder: recurrence.reminder,
      rrule: formatRule(after),
      startDate: at,
      deleted: false,
      ...values,
    }),
    ...storedFrom(series, at).flatMap((todo) =>
      patch('todo', todo.id, { recurrenceId: id, ...update(todo) }),
    ),
  ];
}

export function editTodo(todo: Todo, input: string, scope: Scope = 'this') {
  return serial(() => setContent(todo, parseEntry(input), scope));
}

/** Replaces a todo's content with handwriting; empty ink deletes it. */
export function editInk(todo: Todo, ink: string, scope: Scope = 'this') {
  return serial(() => setContent(todo, inkContent(ink), scope));
}

async function setContent(todo: Todo, content: Content, scope: Scope) {
  if (isEmpty(content)) return commit(await deletion(todo, 'this'));
  if (sameContent(content, todo)) return;
  const series = scope === 'this' ? undefined : await seriesOf(todo);
  if (!series) return commit(todoChanges(todo, content));
  const { recurrence, at } = series;
  // Occurrences edited on their own keep their content.
  const unchanged = (t: Todo) => sameContent(t, recurrence);
  await commit(
    reshape(series, scope === 'all' ? recurrence.startDate : at, content, (t) =>
      t.id === todo.id || unchanged(t) ? content : {},
    ),
  );
}

/** Sets the time (`HH:MM`) a day todo reminds at, or with null removes the reminder. */
export function setReminder(todo: Todo, reminder: string | null, scope: Scope = 'this') {
  return serial(async () => {
    const series = scope === 'this' ? undefined : await seriesOf(todo);
    if (!series) return commit(reminderChanges(todo, reminder, today()));
    const { recurrence, at } = series;
    // Occurrences with a reminder of their own keep it.
    const unchanged = (t: Todo) => t.reminder === recurrence.reminder;
    await commit(
      reshape(series, scope === 'all' ? recurrence.startDate : at, { reminder }, (t) =>
        t.id === todo.id || unchanged(t) ? { reminder } : {},
      ),
    );
  });
}

export function setDone(todo: Todo, done: boolean) {
  return serial(() => commit(completionChanges(todo, done, today())));
}

async function deletion(todo: Todo, scope: 'this' | 'following'): Promise<Change[]> {
  if (todo.recurrenceId === null) return patch('todo', todo.id, { deleted: true });
  const series = scope === 'following' ? await seriesOf(todo) : undefined;
  return series ? endSeries(series, series.at) : todoChanges(todo, { skipped: true });
}

export function deleteTodo(todo: Todo, scope: 'this' | 'following' = 'this') {
  return serial(async () => commit(await deletion(todo, scope)));
}

/**
 * Makes a day todo repeat by `rrule` (starting on its day), changes the rule of a recurring
 * one, or with `rrule` null stops it repeating from its occurrence on.
 */
export function setRepeat(todo: Todo, rrule: string | null, scope: 'following' | 'all') {
  return serial(async () => {
    const series = await seriesOf(todo);
    if (!series) {
      const date = effectiveDate(todo, today());
      if (rrule === null || date === null) return;
      const id = newId();
      const { text, ink, kind, order, reminder } = todo;
      return commit([
        ...patch('recurrence', id, {
          rrule,
          startDate: date,
          text,
          ink,
          kind,
          order,
          reminder,
          deleted: false,
        }),
        ...todoChanges(todo, { date, recurrenceId: id, occurrence: date }),
      ]);
    }
    if (rrule === null) {
      return commit([
        ...endSeries(series, series.at),
        ...todoChanges(todo, { recurrenceId: null, occurrence: null, deleted: false }),
      ]);
    }
    const at = scope === 'all' ? series.recurrence.startDate : series.at;
    const rule = parseRule(rrule);
    // Undone occurrences the new rule no longer generates go away.
    const fits = (t: Todo) =>
      t.done || occurrences(rule, at, t.occurrence!, t.occurrence!).length > 0;
    await commit(reshape(series, at, { rrule }, (t) => (fits(t) ? {} : { deleted: true })));
  });
}

async function place(todo: Todo, target: Target, index: number) {
  const all = await todosIn(target);
  const moving = targetKey(target) !== targetKey(placeOf(todo));
  if (!moving && all.findIndex((t) => t.id === todo.id) === index) return;
  const { order, rekeyed } = orderAt(
    all.filter((t) => t.id !== todo.id),
    index,
  );
  await commit([
    ...todoChanges(todo, moving ? { ...locationOf(target), order } : { order }),
    ...reorderTodos(all, rekeyed),
  ]);
}

/** Moves a todo to `index` among the other todos of `target`. */
export function moveTodo(todo: Todo, target: Target, index: number) {
  return serial(() => place(todo, target, index));
}

export function moveByDays(todo: Todo, days: number) {
  return serial(async () => {
    const current = effectiveDate(todo, today());
    if (current === null) return;
    const date = effectiveDate({ ...todo, date: addDays(current, days) }, today())!;
    if (date === current) return;
    const target = { date };
    await place(todo, target, (await todosIn(target)).length);
    setFocusRequest({ id: todo.id, key: targetKey(target) });
  });
}

/**
 * Moves a todo up (negative) or down within its day or list, the keyboard way to reorder.
 * Resolves with whether it moved.
 */
export function moveBy(todo: Todo, offset: number) {
  return serial(async () => {
    const target = placeOf(todo);
    const siblings = await todosIn(target);
    const index = siblings.findIndex((t) => t.id === todo.id);
    const next = index + offset;
    if (index < 0 || next < 0 || next >= siblings.length) return false;
    await place(todo, target, next);
    return true;
  });
}

function appendOrder(siblings: readonly Ordered[]) {
  return orderAt(siblings, siblings.length);
}

const listsIn = async (groupId: string) =>
  (await storage.lists()).filter((l) => l.groupId === groupId);

export function addList(groupId: string, name: string) {
  return serial(async () => {
    const { order, rekeyed } = appendOrder(await listsIn(groupId));
    await commit([
      ...patch('list', newId(), { name, groupId, order, deleted: false }),
      ...reorder('list', rekeyed),
    ]);
  });
}

export function renameList(list: List, name: string) {
  return serial(() => commit(patch('list', list.id, { name })));
}

export function deleteList(list: List) {
  return serial(() => commit(patch('list', list.id, { deleted: true })));
}

export function moveList(list: List, delta: number) {
  return serial(async () => {
    const siblings = await listsIn(list.groupId);
    const index = siblings.findIndex((l) => l.id === list.id) + delta;
    if (index < 0 || index >= siblings.length) return;
    const { order, rekeyed } = orderAt(
      siblings.filter((l) => l.id !== list.id),
      index,
    );
    await commit([...patch('list', list.id, { order }), ...reorder('list', rekeyed)]);
  });
}

export function moveListToGroup(list: List, groupId: string) {
  return serial(async () => {
    const { order, rekeyed } = appendOrder(await listsIn(groupId));
    await commit([...patch('list', list.id, { groupId, order }), ...reorder('list', rekeyed)]);
  });
}

/**
 * Adds imported todos after the ones already on their days, and each imported tab as a new
 * tab after the existing ones. One undo step.
 */
export function importTodos(imported: Imported) {
  return serial(async () => {
    const changes: Change[] = [];
    const addTodos = (todos: readonly ImportedTodo[], orders: string[], where: Target) => {
      todos.forEach(({ text, done }, i) => {
        const content = parseEntry(text);
        changes.push(
          ...patch('todo', newId(), {
            ...content,
            ...locationOf(where),
            order: orders[i],
            done: done && content.kind === 'todo',
          }),
        );
      });
    };

    const existing = Map.groupBy(await storage.allTodos(), (todo) => todo.date);
    for (const [date, todos] of Map.groupBy(imported.days, (todo) => todo.date)) {
      addTodos(todos, ordersAfter(existing.get(date) ?? [], todos.length), { date });
    }

    const groups = imported.groups.filter((group) => group.lists.length > 0);
    const groupOrders = ordersAfter(await storage.listGroups(), groups.length);
    groups.forEach((group, g) => {
      const groupId = newId();
      changes.push(
        ...patch('listGroup', groupId, {
          name: group.name.slice(0, MAX_TEXT),
          order: groupOrders[g],
          deleted: false,
        }),
      );
      const listOrders = ordersAfter([], group.lists.length);
      group.lists.forEach((list, l) => {
        const listId = newId();
        const name = list.name.slice(0, MAX_TEXT);
        changes.push(
          ...patch('list', listId, { name, groupId, order: listOrders[l], deleted: false }),
        );
        addTodos(list.todos, ordersAfter([], list.todos.length), { listId });
      });
    });
    await commit(changes);
  });
}

export function addGroup(name: string, id = newId()): Promise<string> {
  return serial(async () => {
    const { order, rekeyed } = appendOrder(await storage.listGroups());
    await commit([
      ...patch('listGroup', id, { name, order, deleted: false }),
      ...reorder('listGroup', rekeyed),
    ]);
    return id;
  });
}

export function renameGroup(group: ListGroup, name: string) {
  return serial(() => commit(patch('listGroup', group.id, { name })));
}

export function deleteGroup(group: ListGroup) {
  return serial(() => commit(patch('listGroup', group.id, { deleted: true })));
}

export function moveGroup(group: ListGroup, delta: number) {
  return serial(async () => {
    const groups = await storage.listGroups();
    const index = groups.findIndex((g) => g.id === group.id) + delta;
    if (index < 0 || index >= groups.length) return;
    const { order, rekeyed } = orderAt(
      groups.filter((g) => g.id !== group.id),
      index,
    );
    await commit([...patch('listGroup', group.id, { order }), ...reorder('listGroup', rekeyed)]);
  });
}

export function updateSettings(values: Partial<Fields<'settings'>>) {
  return serial(() => commit(patch('settings', SETTINGS_ID, values), false));
}
