import { For, Show, createSignal, createUniqueId, onMount } from 'solid-js';
import { Icon } from './Icon';
import './Menu.css';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** Popover menu anchored below its button, or above it in the lower half of the window. */
export function Menu(props: {
  label: string;
  items: MenuItem[];
  class?: string;
  tabIndex?: number;
}) {
  const id = createUniqueId();
  let button!: HTMLButtonElement;
  let popover!: HTMLDivElement;
  // Rendered only while open: a list has a menu on every todo.
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    // Items go once the popover has closed, or focus would not return to where it was.
    popover.addEventListener('toggle', (event) => {
      if ((event as ToggleEvent).newState === 'closed') return setOpen(false);
      popover.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
    popover.addEventListener('beforetoggle', (event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      setOpen(true);
      const rect = button.getBoundingClientRect();
      const alignRight = rect.left > window.innerWidth / 2;
      const openUp = rect.top > window.innerHeight / 2;
      Object.assign(popover.style, {
        top: openUp ? 'auto' : `${rect.bottom + 4}px`,
        bottom: openUp ? `${window.innerHeight - rect.top + 4}px` : 'auto',
        left: alignRight ? 'auto' : `${rect.left}px`,
        right: alignRight ? `${window.innerWidth - rect.right}px` : 'auto',
      });
    });
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const items = [...popover.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const target = {
      ArrowDown: items[(at + 1) % items.length],
      ArrowUp: items[(at - 1 + items.length) % items.length],
      Home: items[0],
      End: items.at(-1),
    }[event.key];
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        class={`icon-button ${props.class ?? ''}`}
        aria-label={props.label}
        title={props.label}
        tabIndex={props.tabIndex}
        popovertarget={id}
      >
        <Icon name="dots" />
      </button>
      <div
        ref={popover}
        id={id}
        popover="auto"
        class="menu"
        role="menu"
        aria-label={props.label}
        onKeyDown={onKeyDown}
      >
        <Show when={open()}>
          <For each={props.items}>
            {(item) => (
              <button
                type="button"
                role="menuitem"
                class="menu-item"
                disabled={item.disabled}
                onClick={() => {
                  popover.hidePopover();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}
