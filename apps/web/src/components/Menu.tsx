import { For, createUniqueId, onMount } from 'solid-js';
import { Icon } from './Icon';
import './Menu.css';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** Popover menu anchored below its button. */
export function Menu(props: { label: string; items: MenuItem[]; class?: string }) {
  const id = createUniqueId();
  let button!: HTMLButtonElement;
  let popover!: HTMLDivElement;

  onMount(() => {
    popover.addEventListener('beforetoggle', (event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const rect = button.getBoundingClientRect();
      const alignRight = rect.left > window.innerWidth / 2;
      Object.assign(popover.style, {
        top: `${rect.bottom + 4}px`,
        left: alignRight ? 'auto' : `${rect.left}px`,
        right: alignRight ? `${window.innerWidth - rect.right}px` : 'auto',
      });
    });
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        class={`icon-button ${props.class ?? ''}`}
        aria-label={props.label}
        title={props.label}
        popovertarget={id}
      >
        <Icon name="dots" />
      </button>
      <div ref={popover} id={id} popover="auto" class="menu" role="menu" aria-label={props.label}>
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
      </div>
    </>
  );
}
