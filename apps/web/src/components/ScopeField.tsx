import { For, createUniqueId } from 'solid-js';
import type { Scope } from '../state/actions';

export const scopeLabels: Record<Scope, string> = {
  this: 'Only this one',
  following: 'This and following',
  all: 'All',
};

/** Segmented choice of which occurrences of a recurring todo a change applies to. */
export function ScopeField<S extends Scope>(props: {
  scopes: readonly S[];
  value: S;
  onChange: (scope: S) => void;
}) {
  const name = createUniqueId();
  return (
    <fieldset class="field">
      <legend class="field-label">Change</legend>
      <div class="segmented">
        <For each={props.scopes}>
          {(scope) => (
            <label>
              <input
                type="radio"
                name={name}
                checked={props.value === scope}
                onChange={() => props.onChange(scope)}
              />
              {scopeLabels[scope]}
            </label>
          )}
        </For>
      </div>
    </fieldset>
  );
}
