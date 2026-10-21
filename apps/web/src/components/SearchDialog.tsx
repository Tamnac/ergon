import { For, Show, createEffect, createResource, createSignal, createUniqueId } from 'solid-js';
import { search, type SearchHit } from '../state/search';
import { searchOpen, setSearchOpen } from '../state/view';
import { Dialog } from './Dialog';
import './SearchDialog.css';

export function SearchDialog() {
  const id = createUniqueId();
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  const [found] = createResource(() => searchOpen() && query().trim(), search);
  const hits = () => (query().trim() ? (found() ?? []) : []);
  /** Shown once the dialog has closed, so the page isn't inert when it takes focus. */
  let chosen: SearchHit | undefined;

  createEffect(() => {
    hits();
    setActive(0);
  });

  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return;
    chosen = hit;
    setSearchOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const last = hits().length - 1;
    if (event.key === 'ArrowDown') setActive((i) => Math.min(i + 1, last));
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (event.key === 'Enter') {
      // Not while results are stale or an input method is composing.
      if (!found.loading && !event.isComposing) choose(hits()[active()]);
    } else return;
    event.preventDefault();
    document.getElementById(`${id}-${active()}`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <Dialog
      title="Search"
      open={searchOpen()}
      onClose={() => {
        setSearchOpen(false);
        setQuery('');
        chosen?.show();
        chosen = undefined;
      }}
    >
      <input
        class="input"
        type="text"
        role="combobox"
        aria-label="Search todos and lists"
        aria-expanded={hits().length > 0}
        aria-controls={`${id}-results`}
        aria-activedescendant={hits().length > 0 ? `${id}-${active()}` : undefined}
        placeholder="Search todos and lists"
        autofocus
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <ul id={`${id}-results`} class="search-results" role="listbox" aria-label="Results">
        <For each={hits()}>
          {(hit, index) => (
            <li
              id={`${id}-${index()}`}
              role="option"
              class="search-hit"
              classList={{ 'is-active': index() === active(), 'is-done': hit.done }}
              aria-selected={index() === active()}
              onPointerMove={() => setActive(index())}
              onClick={() => choose(hit)}
            >
              <span class="search-text">{hit.text}</span>
              <span class="search-place">{hit.place}</span>
            </li>
          )}
        </For>
      </ul>
      <Show when={query().trim() && !found.loading && hits().length === 0}>
        <p class="hint" role="status">
          Nothing found. Handwritten todos can't be searched.
        </p>
      </Show>
    </Dialog>
  );
}
