import { completionOccasion, decodeInk, encodeInk, type Stroke, type Todo } from '@ergon/core';
import { For, Show, createEffect, onMount } from 'solid-js';
import { makeDraggable } from '../lib/dnd';
import { cancelCompletion, isCompleting, playCompletion } from '../lib/effects';
import { inkDetail } from '../lib/ink';
import { linkify } from '../lib/links';
import { formatTime } from '../lib/time';
import {
  deleteTodo,
  editInk,
  editTodo,
  moveByDays,
  moveTodo,
  parseEntry,
  sameContent,
  setDone,
} from '../state/actions';
import {
  editingId,
  focusRequest,
  setEditingId,
  setFocusRequest,
  setReminding,
  setRepeating,
} from '../state/view';
import { Icon } from './Icon';
import { Ink } from './Ink';
import { InkSurface } from './InkSurface';
import { InlineInput } from './InlineInput';
import { askScope } from './ScopeDialog';

/** `siblings` are the todos of its day or list in display order. */
export function TodoItem(props: { todo: Todo; siblings: readonly Todo[]; columnKey: string }) {
  let item!: HTMLLIElement;
  let label: HTMLSpanElement | undefined;
  let inkRect: DOMRect | undefined;

  const editing = () => editingId() === props.todo.id;
  const heading = () => props.todo.kind === 'heading';
  const recurring = () => props.todo.recurrenceId !== null;
  const onDay = () => props.todo.date !== null;
  const inked = () => !!props.todo.ink;
  /** Another todo may have started editing meanwhile. */
  const stopEditing = () => {
    if (editing()) setEditingId(null);
  };

  onMount(() =>
    makeDraggable(item, {
      disabled: (down) => editing() || (down.pointerType === 'pen' && inked()),
      onDrop: (target, index) => void moveTodo(props.todo, target, index),
    }),
  );

  createEffect(() => {
    const request = focusRequest();
    if (request?.id !== props.todo.id || request.key !== props.columnKey) return;
    setFocusRequest(null);
    item.focus();
  });

  const focusSelf = () => setFocusRequest({ id: props.todo.id, key: props.columnKey });

  const toggle = () => {
    const done = !props.todo.done;
    void setDone(props.todo, done);
    if (done && label) {
      void playCompletion(props.todo.id, label, completionOccasion(props.siblings, props.todo.id));
    } else cancelCompletion(props.todo.id);
  };

  /** Deletes the todo, asking which occurrences if it repeats; `before` runs once confirmed. */
  const remove = async (before?: () => void) => {
    const todo = props.todo;
    const scope =
      todo.recurrenceId === null
        ? 'this'
        : await askScope('Delete repeating todo', ['this', 'following'] as const);
    if (!scope) return;
    before?.();
    await deleteTodo(todo, scope);
  };

  const save = async (value: string) => {
    const todo = props.todo;
    const entry = parseEntry(value);
    if (!entry.text) return remove();
    if (sameContent(entry, todo)) return;
    const scope = await editScope(todo);
    if (scope) await editTodo(todo, value, scope);
  };

  const saveInk = async (strokes: Stroke[]) => {
    const todo = props.todo;
    const ink = encodeInk(strokes, inkDetail());
    if (!ink) return remove();
    const scope = await editScope(todo);
    if (scope) await editInk(todo, ink, scope);
  };

  const editScope = (todo: Todo) =>
    todo.recurrenceId === null
      ? 'this'
      : askScope('Edit repeating todo', ['this', 'following', 'all'] as const);

  const focusSibling = (forward: boolean) => {
    let next = forward ? item.nextElementSibling : item.previousElementSibling;
    while (next && !(next instanceof HTMLElement && 'dragItem' in next.dataset)) {
      next = forward ? next.nextElementSibling : next.previousElementSibling;
    }
    (next as HTMLElement | null)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== item || event.ctrlKey || event.metaKey || event.altKey) return;
    const navigating = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (event.repeat && !navigating) return;
    switch (event.key) {
      case 'ArrowUp':
        focusSibling(false);
        break;
      case 'ArrowDown':
        focusSibling(true);
        break;
      case 'Enter':
        if (inked()) return;
        setEditingId(props.todo.id);
        break;
      case ' ':
        if (!heading()) toggle();
        break;
      case 'Delete':
      case 'Backspace':
        void remove(() => focusSibling(true));
        break;
      case 'r':
        if (!onDay()) return;
        setRepeating(props.todo);
        break;
      case 'b':
        if (!onDay() || heading()) return;
        setReminding(props.todo);
        break;
      case '>':
        void moveByDays(props.todo, 1);
        break;
      case '<':
        void moveByDays(props.todo, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <li
      ref={item}
      class="todo todo-row"
      classList={{
        'is-done': props.todo.done,
        'is-heading': heading(),
        'is-completing': isCompleting(props.todo.id),
        'is-editing': editing(),
      }}
      tabIndex={0}
      data-id={props.todo.id}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (inked() || (event.target as Element).closest('a, button')) return;
        setEditingId(props.todo.id);
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== 'pen' || !inked() || editing()) return;
        if ((event.target as Element).closest('button')) return;
        inkRect = label?.getBoundingClientRect();
        setEditingId(props.todo.id);
      }}
    >
      <Show
        when={editing()}
        fallback={
          <>
            <Show when={!heading()}>
              <button
                type="button"
                class="todo-check"
                tabIndex={-1}
                aria-label={props.todo.done ? 'Mark not done' : 'Mark done'}
                aria-pressed={props.todo.done}
                onClick={toggle}
              >
                <Icon name="check" />
              </button>
            </Show>
            <Show
              when={props.todo.ink}
              fallback={
                <span class="todo-text">
                  <span ref={label} class="todo-label">
                    <For each={linkify(props.todo.text)}>
                      {(segment) =>
                        segment.href ? (
                          <a href={segment.href} target="_blank" rel="noopener noreferrer">
                            {segment.text}
                          </a>
                        ) : (
                          segment.text
                        )
                      }
                    </For>
                  </span>
                </span>
              }
            >
              {(ink) => <Ink ref={(element) => (label = element)} ink={ink()} />}
            </Show>
            <Show when={onDay() && !heading()}>
              <button
                type="button"
                class="todo-reminder icon-button"
                classList={{ 'is-on': props.todo.reminder !== null }}
                tabIndex={-1}
                aria-label="Reminder"
                title={
                  props.todo.reminder ? `Reminds at ${formatTime(props.todo.reminder)}` : 'Remind'
                }
                onClick={() => setReminding(props.todo)}
              >
                <Icon name="bell" />
                <Show when={props.todo.reminder}>
                  {(time) => <span class="todo-reminder-time">{formatTime(time())}</span>}
                </Show>
              </button>
            </Show>
            <Show when={onDay()}>
              <button
                type="button"
                class="todo-repeat icon-button"
                classList={{ 'is-on': recurring() }}
                tabIndex={-1}
                aria-label="Repeat"
                title={recurring() ? 'Repeats' : 'Repeat'}
                onClick={() => setRepeating(props.todo)}
              >
                <Icon name="repeat" />
              </button>
            </Show>
            <button
              type="button"
              class="todo-delete icon-button"
              tabIndex={-1}
              aria-label="Delete"
              onClick={() => void remove()}
            >
              <Icon name="minus" />
            </button>
          </>
        }
      >
        <Show
          when={props.todo.ink}
          fallback={
            <InlineInput
              label="Edit todo"
              value={heading() ? `# ${props.todo.text}` : props.todo.text}
              onCommit={(value, reason) => {
                stopEditing();
                void save(value).then(() => {
                  if (reason === 'enter') focusSelf();
                });
              }}
              onCancel={() => {
                stopEditing();
                focusSelf();
              }}
            />
          }
        >
          {(ink) => (
            <InkSurface
              initial={decodeInk(ink())?.strokes ?? []}
              shownIn={inkRect}
              onCommit={(strokes) => {
                stopEditing();
                void saveInk(strokes);
              }}
              onCancel={stopEditing}
            />
          )}
        </Show>
      </Show>
    </li>
  );
}
