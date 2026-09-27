import {
  SETTINGS_ID,
  addDays,
  compareOrder,
  completionChanges,
  effectiveDate,
  newId,
  orderAt,
  patch,
  type Change,
  type Fields,
  type List,
  type ListGroup,
  type Ordered,
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

const reorder = (entity: 'todo' | 'list' | 'listGroup', items: Ordered[]) =>
  items.flatMap((item) => patch(entity, item.id, { order: item.order }));

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

function parseEntry(input: string): Pick<Todo, 'text' | 'kind'> {
  const heading = /^#\s*(.*)$/.exec(input.trim());
  return heading
    ? { text: heading[1]!.trim(), kind: 'heading' }
    : { text: input.trim(), kind: 'todo' };
}

export function addTodo(target: Target, input: string) {
  return serial(async () => {
    const siblings = await todosIn(target);
    const { order, rekeyed } = orderAt(siblings, siblings.length);
    await commit([
      ...patch('todo', newId(), {
        ...parseEntry(input),
        ...locationOf(target),
        order,
        done: false,
      }),
      ...reorder('todo', rekeyed),
    ]);
  });
}

export function editTodo(todo: Todo, input: string) {
  return serial(async () => {
    const entry = parseEntry(input);
    if (!entry.text) return commit(patch('todo', todo.id, { deleted: true }));
    if (entry.text === todo.text && entry.kind === todo.kind) return;
    await commit(patch('todo', todo.id, entry));
  });
}

export function setDone(todo: Todo, done: boolean) {
  return serial(() => commit(completionChanges(todo, done, today())));
}

export function deleteTodo(todo: Todo) {
  return serial(() => commit(patch('todo', todo.id, { deleted: true })));
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
    ...patch('todo', todo.id, moving ? { ...locationOf(target), order } : { order }),
    ...reorder('todo', rekeyed),
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
    let date = addDays(current, days);
    if (!todo.done && date < today()) date = today();
    if (date === current) return;
    const target = { date };
    await place(todo, target, (await todosIn(target)).length);
    setFocusRequest({ id: todo.id, key: targetKey(target) });
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
