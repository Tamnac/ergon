import { For } from 'solid-js';
import { shortcuts } from '../lib/shortcuts';
import { helpOpen, setHelpOpen } from '../state/view';
import { Dialog } from './Dialog';

export function HelpDialog() {
  return (
    <Dialog title="Shortcuts" open={helpOpen()} onClose={() => setHelpOpen(false)}>
      <dl class="shortcuts">
        <For each={shortcuts}>
          {([keys, action]) => (
            <>
              <dt>{keys}</dt>
              <dd>{action}</dd>
            </>
          )}
        </For>
      </dl>
      <p class="hint">
        Start a todo with <code># </code> to make it a heading.
      </p>
    </Dialog>
  );
}
