import type { JSX } from 'solid-js';

const paths = {
  'chevron-left': 'M10 3 5 8l5 5',
  'chevron-right': 'M6 3l5 5-5 5',
  'chevrons-left': 'M8 3 3 8l5 5M13 3 8 8l5 5',
  'chevrons-right': 'M3 3l5 5-5 5M8 3l5 5-5 5',
  'chevron-down': 'M3 6l5 5 5-5',
  'chevron-up': 'M3 10l5-5 5 5',
  calendar: 'M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 1.5v3M10.5 1.5v3',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3.5 8h9',
  dots: 'M8 3.5v.01M8 8v.01M8 12.5v.01',
  sliders: 'M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7M10.5 3v3M5.5 10v3',
  moon: 'M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z',
  sun: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  undo: 'M5 3 2 6l3 3M2 6h7.5a3.5 3.5 0 0 1 0 7H6',
  help: 'M6 6a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.5V10M8 12.5v.01',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.5l3 3 7-7',
} as const;

export type IconName = keyof typeof paths;

export function Icon(props: { name: IconName }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={paths[props.name]} />
    </svg>
  );
}

export function IconButton(props: {
  icon: IconName;
  label: string;
  onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  disabled?: boolean;
  class?: string;
}) {
  return (
    <button
      type="button"
      class={`icon-button ${props.class ?? ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={(e) => props.onClick(e)}
    >
      <Icon name={props.icon} />
    </button>
  );
}
