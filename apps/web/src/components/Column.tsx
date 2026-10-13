import { encodeInk, isTap, type Todo } from '@ergon/core';
import { For, Show, type JSX } from 'solid-js';
import { registerDropZone } from '../lib/dnd';
import { inkDetail } from '../lib/ink';
import { addInkTodo, addTodo } from '../state/actions';
import { addingKey, setAddingKey, targetKey, type Target } from '../state/view';
import { InkSurface } from './InkSurface';
import { InlineInput } from './InlineInput';
import { TodoItem } from './TodoItem';
import './Column.css';

/**
 * A day or list: header, todos, and two ruled lines below them that open the add input. The
 * first line is also where a pen writes a new todo.
 */
export function Column(props: {
  target: Target;
  items: readonly Todo[];
  header: JSX.Element;
  label: string;
  class?: string;
}) {
  const key = () => targetKey(props.target);
  const adding = () => addingKey() === key();
  const openAdd = () => setAddingKey(key());
  let pressedWith = '';

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
        <li class="todo-filler">
          <div
            class="todo-lines"
            onPointerDown={(event) => (pressedWith = event.pointerType)}
            onClick={() => {
              if (pressedWith !== 'pen') openAdd();
            }}
          >
            <InkSurface
              onCommit={(strokes) => {
                const ink = encodeInk(strokes, inkDetail());
                if (ink && !isTap(strokes)) void addInkTodo(props.target, ink);
              }}
            >
              <Show when={!adding()}>
                <button type="button" class="todo-add-button" aria-label="Add todo" />
              </Show>
            </InkSurface>
          </div>
        </li>
      </ul>
    </section>
  );
}
