import { decodeInk, INK_LABEL, inkWidth } from '@ergon/core';
import { For, createMemo } from 'solid-js';
import { strokePath } from '../lib/ink';
import './Ink.css';

/** Stored ink, a row high; scales down when wider than the space it has. */
export function Ink(props: { ink: string; ref?: (element: HTMLSpanElement) => void }) {
  const ink = createMemo(() => decodeInk(props.ink) ?? { strokes: [], rtl: false });
  const width = () => inkWidth(ink().strokes);

  return (
    <span
      ref={props.ref}
      class="ink"
      classList={{ 'is-rtl': ink().rtl }}
      style={{ '--ink-width': width() / 100 }}
      role="img"
      aria-label={INK_LABEL}
    >
      <svg
        viewBox={`0 -50 ${width()} 200`}
        style={{ 'aspect-ratio': `${width()} / 200` }}
        fill="currentColor"
        aria-hidden="true"
      >
        <For each={ink().strokes}>{(stroke) => <path d={strokePath(stroke)} />}</For>
      </svg>
    </span>
  );
}
