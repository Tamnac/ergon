import type { Todo } from '@ergon/core';
import { For, Index, Show, type JSX } from 'solid-js';
import { registerDropZone } from '../lib/dnd';
import { addTodo } from '../state/actions';
import { addingKey, setAddingKey, targetKey, type Target } from '../state/view';
import { InlineInput } from './InlineInput';
import { TodoItem } from './TodoItem';
import './Column.css';

/** A day or list: header, todos, and empty ruled rows that open the add input. */
export function Column(props: {
  target: Target;
  items: readonly Todo[];
  header: JSX.Element;
  label: string;
  rows: number;
  class?: string;
}) {
  const key = () => targetKey(props.target);
  const adding = () => addingKey() === key();
  const fillers = () => Math.max(1, props.rows - props.items.length - (adding() ? 1 : 0));
  const openAdd = () => setAddingKey(key());

  return (
    <section class={`column ${props.class ?? ''}`} data-target={key()} aria-label={props.label}>
      {props.header}
      <ul class="todo-list" ref={(el) => registerDropZone(el, () => props.target)}>
        <For each={props.items}>{(todo) => <TodoItem todo={todo} columnKey={key()} />}</For>
        <Show when={adding()}>
          <li class="todo-row todo-add">
            <InlineInput
              label="New todo"
              onCommit={(text, reason) => {
                if (text.trim()) void addTodo(props.target, text);
                if (reason === 'enter' && text.trim()) return true;
                setAddingKey(null);
              }}
              onCancel={() => setAddingKey(null)}
            />
          </li>
        </Show>
        <Index each={Array.from({ length: fillers() })}>
          {(_, i) => (
            <li class="todo-row todo-filler" onClick={openAdd}>
              <Show when={i === 0 && !adding()}>
                <button type="button" class="todo-add-button" aria-label="Add todo" />
              </Show>
            </li>
          )}
        </Index>
      </ul>
    </section>
  );
}
