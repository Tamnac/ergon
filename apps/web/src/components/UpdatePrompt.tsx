import { Show } from 'solid-js';
import { applyUpdate, updateReady } from '../lib/pwa';
import './UpdatePrompt.css';

/** Offers to reload into a new version of the app that has been downloaded in the background. */
export function UpdatePrompt() {
  return (
    <Show when={updateReady()}>
      <div class="update-prompt" role="status">
        A new version of Ergon is ready.
        <button type="button" class="button button-primary" onClick={applyUpdate}>
          Reload
        </button>
      </div>
    </Show>
  );
}
