import type { DayCount } from '@ergon/core';
import { undo, updateSettings } from '../state/actions';
import { today } from '../state/today';
import {
  helpOpen,
  jumpTo,
  setAddingKey,
  setHelpOpen,
  setSearchOpen,
  shiftDays,
  targetKey,
  visibleDays,
} from '../state/view';

export const shortcuts: [keys: string, action: string][] = [
  ['← / →', 'Previous / next day'],
  ['Shift + ← / →', 'Previous / next week'],
  ['T', 'Jump to today'],
  ['N', 'Add a todo to today'],
  ['1 / 3 / 5 / 7', 'Number of visible days'],
  ['/ or Ctrl + K', 'Search'],
  ['Ctrl + Z', 'Undo'],
  ['↑ / ↓', 'Focus previous / next todo'],
  ['Enter', 'Edit focused todo'],
  ['Space', 'Complete focused todo'],
  ['> / <', 'Move focused todo to next / previous day'],
  ['Delete', 'Delete focused todo'],
  ['R', 'Repeat focused todo'],
  ['B', 'Set a reminder for focused todo'],
  ['? / Ctrl + /', 'Show shortcuts'],
];

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Starts adding a todo to today. */
export function addToToday() {
  if (!visibleDays().includes(today())) jumpTo(today());
  setAddingKey(targetKey({ date: today() }));
}

/** Global keys. Keys on a focused todo are handled in `TodoItem`. */
export function installShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isTyping(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const dialogOpen = document.querySelector('dialog[open]') !== null;
    if (mod && (event.key === '/' || event.code === 'Slash')) {
      event.preventDefault();
      if (helpOpen()) setHelpOpen(false);
      else if (!dialogOpen) setHelpOpen(true);
      return;
    }
    if (dialogOpen) return;
    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setSearchOpen(true);
      return;
    }
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void undo();
      return;
    }
    if (mod || event.altKey) return;

    switch (event.key) {
      case 'ArrowLeft':
        shiftDays(event.shiftKey ? -7 : -1);
        break;
      case 'ArrowRight':
        shiftDays(event.shiftKey ? 7 : 1);
        break;
      case 't':
        jumpTo(today());
        break;
      case 'n':
        addToToday();
        break;
      case '1':
      case '3':
      case '5':
      case '7':
        void updateSettings({ dayCount: Number(event.key) as DayCount });
        break;
      case '/':
        setSearchOpen(true);
        break;
      case '?':
        setHelpOpen(true);
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
