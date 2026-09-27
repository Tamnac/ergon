import type { Todo } from '@ergon/core';
import { For, Show, createEffect, onMount } from 'solid-js';
import { makeDraggable } from '../lib/dnd';
import { cancelCompletion, isCompleting, playCompletion } from '../lib/effects';
import { linkify } from '../lib/links';
import { deleteTodo, editTodo, moveByDays, moveTodo, setDone } from '../state/actions';
import { editingId, focusRequest, setEditingId, setFocusRequest } from '../state/view';
import { Icon } from './Icon';
import { InlineInput } from './InlineInput';

export function TodoItem(props: { todo: Todo; columnKey: string }) {
  let item!: HTMLLIElement;
  let label: HTMLSpanElement | undefined;

  const editing = () => editingId() === props.todo.id;
  const heading = () => props.todo.kind === 'heading';

  onMount(() =>
    makeDraggable(item, {
      disabled: editing,
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
    if (done && label) void playCompletion(props.todo.id, label);
    else cancelCompletion(props.todo.id);
  };

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
        setEditingId(props.todo.id);
        break;
      case ' ':
        if (!heading()) toggle();
        break;
      case 'Delete':
      case 'Backspace':
        focusSibling(true);
        void deleteTodo(props.todo);
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
        if (!(event.target as Element).closest('a, button')) setEditingId(props.todo.id);
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
            <button
              type="button"
              class="todo-delete icon-button"
              tabIndex={-1}
              aria-label="Delete"
              onClick={() => void deleteTodo(props.todo)}
            >
              <Icon name="minus" />
            </button>
          </>
        }
      >
        <InlineInput
          label="Edit todo"
          value={heading() ? `# ${props.todo.text}` : props.todo.text}
          onCommit={(value, reason) => {
            void editTodo(props.todo, value);
            setEditingId(null);
            if (reason === 'enter') focusSelf();
          }}
          onCancel={() => {
            setEditingId(null);
            focusSelf();
          }}
        />
      </Show>
    </li>
  );
}
