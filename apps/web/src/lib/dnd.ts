import type { Target } from '../state/view';

const THRESHOLD = 5;
const zones = new WeakMap<Element, () => Target>();

/** Marks a list element as a drop target; its `[data-drag-item]` children define the slots. */
export function registerDropZone(element: HTMLElement, target: () => Target) {
  zones.set(element, target);
  element.dataset.dropZone = '';
}

export interface DraggableOptions {
  disabled: () => boolean;
  onDrop: (target: Target, index: number) => void;
}

/** Pointer-based dragging; `index` is the slot among the zone's other items. */
export function makeDraggable(element: HTMLElement, options: DraggableOptions) {
  element.dataset.dragItem = '';
  element.addEventListener('pointerdown', (down) => {
    if (down.button !== 0 || options.disabled()) return;
    if ((down.target as Element).closest('input, button, a')) return;

    let session: DragSession | undefined;
    const onMove = (event: PointerEvent) => {
      if (!session) {
        const distance = Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY);
        if (distance < THRESHOLD) return;
        session = new DragSession(element, down);
      }
      event.preventDefault();
      session.move(event.clientX, event.clientY);
    };
    const stop = (drop: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (!session) return;
      const result = session.end();
      suppressClick();
      if (drop && result) options.onDrop(result.target, result.index);
    };
    const onUp = () => stop(true);
    const onCancel = () => stop(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      stop(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  });
}

/** The click that ends a drag must not also open the editor. */
function suppressClick() {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
}

class DragSession {
  readonly #source: HTMLElement;
  readonly #ghost: HTMLElement;
  readonly #indicator = document.createElement('div');
  readonly #offsetX: number;
  readonly #offsetY: number;
  #drop: { target: Target; index: number } | undefined;

  constructor(source: HTMLElement, down: PointerEvent) {
    const rect = source.getBoundingClientRect();
    this.#source = source;
    this.#offsetX = down.clientX - rect.left;
    this.#offsetY = down.clientY - rect.top;

    this.#ghost = source.cloneNode(true) as HTMLElement;
    this.#ghost.className = `${source.className} drag-ghost`;
    this.#ghost.removeAttribute('data-drag-item');
    this.#ghost.style.width = `${rect.width}px`;
    this.#indicator.className = 'drop-indicator';
    this.#indicator.hidden = true;
    document.body.append(this.#ghost, this.#indicator);

    source.classList.add('is-dragging');
    document.documentElement.classList.add('is-dragging');
  }

  move(x: number, y: number) {
    this.#ghost.style.transform = `translate(${x - this.#offsetX}px, ${y - this.#offsetY}px)`;

    const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-zone]');
    const target = zone && zones.get(zone);
    if (!zone || !target) {
      this.#drop = undefined;
      this.#indicator.hidden = true;
      return;
    }

    const items = [...zone.children].filter(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && 'dragItem' in item.dataset && item !== this.#source,
    );
    const rects = items.map((item) => item.getBoundingClientRect());
    let index = rects.findIndex((r) => y < r.top + r.height / 2);
    if (index === -1) index = items.length;

    const zoneRect = zone.getBoundingClientRect();
    const lineY = rects[index]?.top ?? rects.at(-1)?.bottom ?? zoneRect.top;
    Object.assign(this.#indicator.style, {
      left: `${zoneRect.left}px`,
      top: `${lineY - 1}px`,
      width: `${zoneRect.width}px`,
    });
    this.#indicator.hidden = false;
    this.#drop = { target: target(), index };
  }

  end() {
    this.#ghost.remove();
    this.#indicator.remove();
    this.#source.classList.remove('is-dragging');
    document.documentElement.classList.remove('is-dragging');
    return this.#drop;
  }
}
