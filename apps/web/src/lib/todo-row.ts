import type { Todo } from '@ergon/core';

/** The element showing `todo`, if it is on screen. */
export const todoRow = (todo: Todo | null): Element | null =>
  todo && document.querySelector(`.todo[data-id="${CSS.escape(todo.id)}"]`);
