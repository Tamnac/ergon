import { For, createSignal } from 'solid-js';
import type { Scope } from '../state/actions';
import { Dialog } from './Dialog';

const labels: Record<Scope, string> = {
  this: 'Only this one',
  following: 'This and following',
  all: 'All',
};

interface Prompt {
  title: string;
  scopes: readonly Scope[];
  resolve: (scope: Scope | null) => void;
}

const [prompt, setPrompt] = createSignal<Prompt | null>(null);

/** Asks which occurrences of a recurring todo a change applies to; null if cancelled. */
export function askScope<S extends Scope>(title: string, scopes: readonly S[]): Promise<S | null> {
  prompt()?.resolve(null);
  return new Promise((resolve) =>
    setPrompt({ title, scopes, resolve: resolve as Prompt['resolve'] }),
  );
}

export function ScopeDialog() {
  const close = (scope: Scope | null) => {
    const current = prompt();
    setPrompt(null);
    current?.resolve(scope);
  };

  return (
    <Dialog title={prompt()?.title ?? ''} open={prompt() !== null} onClose={() => close(null)}>
      <div class="scope-choices">
        <For each={prompt()?.scopes}>
          {(scope, index) => (
            <button
              type="button"
              class="button"
              autofocus={index() === 0}
              onClick={() => close(scope)}
            >
              {labels[scope]}
            </button>
          )}
        </For>
      </div>
    </Dialog>
  );
}
