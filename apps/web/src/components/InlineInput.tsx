import { onMount } from 'solid-js';

export type CommitReason = 'enter' | 'blur';

/**
 * Autofocused text input. `onCommit` runs on Enter or blur; returning true keeps the
 * input open and clears it (for adding several items in a row).
 */
export function InlineInput(props: {
  label: string;
  value?: string;
  placeholder?: string;
  class?: string;
  onCommit: (value: string, reason: CommitReason) => boolean | void;
  onCancel: () => void;
}) {
  let input!: HTMLInputElement;
  let closed = false;

  onMount(() => input.focus());

  const commit = (reason: CommitReason) => {
    if (closed) return;
    closed = true;
    if (props.onCommit(input.value, reason) === true) {
      closed = false;
      input.value = '';
    }
  };

  return (
    <input
      ref={input}
      class={`inline-input ${props.class ?? ''}`}
      value={props.value ?? ''}
      aria-label={props.label}
      placeholder={props.placeholder}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commit('enter');
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closed = true;
          props.onCancel();
        }
      }}
      onBlur={() => commit('blur')}
    />
  );
}
