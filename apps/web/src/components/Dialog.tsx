import { createEffect, onCleanup, type JSX } from 'solid-js';
import { isPhone } from '../lib/viewport';
import { IconButton } from './Icon';
import './Dialog.css';

/** Space kept free at the window edges. */
const MARGIN = 8;
/** How far the rings reach out of the anchor (ring-1) and of the dialog (veiled ring-2). */
const ANCHOR_RING = 1;
const DIALOG_RING = 6;
/** Distance between the outer rings, which the line crosses. */
const LEADER = 24;
/** How far the line runs under each ring, so rounding to device pixels leaves no gap. */
const TUCK = 1;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Puts the dialog beside `anchor`, on the side with more room, with its title level with the
 * anchor and `leader` joining the two. Stays centered if neither side fits.
 */
function placeBeside(dialog: HTMLDialogElement, leader: HTMLElement, anchor: Element) {
  const rect = anchor.getBoundingClientRect();
  const { width, height } = dialog.getBoundingClientRect();
  const offset = ANCHOR_RING + LEADER + DIALOG_RING;
  const roomRight = window.innerWidth - rect.right - offset - MARGIN;
  const roomLeft = rect.left - offset - MARGIN;
  const fits = Math.max(roomRight, roomLeft) >= width;
  dialog.classList.toggle('is-anchored', fits);
  leader.hidden = !fits;
  if (!fits) return dialog.removeAttribute('style');

  const right = roomRight >= roomLeft;
  const middle = rect.top + rect.height / 2;
  const titleMiddle = (dialog.querySelector('.dialog-header')?.clientHeight ?? 0) / 2;
  const top = clamp(middle - titleMiddle, MARGIN, window.innerHeight - height - MARGIN);
  Object.assign(dialog.style, {
    inset: 'auto',
    margin: '0',
    left: `${right ? rect.right + offset : rect.left - offset - width}px`,
    top: `${top}px`,
  });
  Object.assign(leader.style, {
    left: `${right ? rect.right + ANCHOR_RING - TUCK : rect.left - ANCHOR_RING - LEADER - TUCK}px`,
    width: `${LEADER + 2 * TUCK}px`,
    top: `${Math.round(clamp(middle, top + MARGIN, top + height - MARGIN))}px`,
    transformOrigin: right ? 'left' : 'right',
  });
}

/**
 * A modal dialog. With an `anchor` (and not on a phone) it sits beside it instead of centered,
 * ringing the anchor and joined to it by a line.
 */
export function Dialog(props: {
  open: boolean;
  title: string;
  anchor?: () => Element | null;
  onClose: () => void;
  children: JSX.Element;
}) {
  let dialog!: HTMLDialogElement;
  let leader!: HTMLDivElement;
  let closing = false;

  /** Closes after the rings collapse; anchored dialogs close at once. */
  const close = () => {
    if (closing) return;
    if (dialog.classList.contains('is-anchored')) return dialog.close();
    dialog.classList.add('is-closing');
    const collapse = dialog
      .getAnimations()
      .find((a) => a instanceof CSSAnimation && a.animationName === 'ring-out');
    if (!collapse) return dialog.close();
    closing = true;
    collapse.finished.then(
      () => dialog.close(),
      () => {},
    );
  };

  createEffect(() => {
    if (!props.open) {
      if (dialog.open) close();
    } else if (closing) {
      closing = false;
      dialog.classList.remove('is-closing');
    } else if (!dialog.open) dialog.showModal();
  });

  createEffect(() => {
    const anchor = props.open && !isPhone() ? props.anchor?.() : null;
    if (!anchor) return;
    const place = () => placeBeside(dialog, leader, anchor);
    const observer = new ResizeObserver(place);
    observer.observe(dialog);
    anchor.classList.add('is-anchor');
    place();
    onCleanup(() => {
      observer.disconnect();
      anchor.classList.remove('is-anchor');
      leader.hidden = true;
      leader.removeAttribute('style');
      dialog.removeAttribute('style');
      dialog.classList.remove('is-anchored');
    });
  });

  return (
    <>
      <dialog
        ref={dialog}
        class="dialog"
        aria-label={props.title}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          closing = false;
          dialog.classList.remove('is-closing');
          props.onClose();
        }}
        onClick={(event) => {
          if (event.target === dialog) close();
        }}
      >
        <header class="dialog-header">
          <h2 class="dialog-title">{props.title}</h2>
          <IconButton icon="close" label="Close" onClick={close} />
        </header>
        <div class="dialog-body">{props.children}</div>
      </dialog>
      <div ref={leader} class="dialog-leader" hidden />
    </>
  );
}
