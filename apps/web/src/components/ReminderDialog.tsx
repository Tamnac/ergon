import { defaultReminderTime, effectiveDate, isTime, type Todo } from '@ergon/core';
import { Show, createSignal } from 'solid-js';
import { setReminder, type Scope } from '../state/actions';
import { todoRow } from '../lib/todo-row';
import { today } from '../state/today';
import { reminding, setReminding } from '../state/view';
import { Dialog } from './Dialog';
import { ScopeField } from './ScopeField';

export function ReminderDialog() {
  return (
    <Dialog
      title="Reminder"
      open={reminding() !== null}
      anchor={() => todoRow(reminding())}
      onClose={() => setReminding(null)}
    >
      <Show when={reminding()} keyed>
        {(todo) => <ReminderEditor todo={todo} onDone={() => setReminding(null)} />}
      </Show>
    </Dialog>
  );
}

function ReminderEditor(props: { todo: Todo; onDone: () => void }) {
  const { todo } = props;
  const [time, setTime] = createSignal(
    todo.reminder ?? defaultReminderTime(effectiveDate(todo, today())),
  );

  const [scope, setScope] = createSignal<Scope>('this');

  const apply = (reminder: string | null) => {
    props.onDone();
    // Saving a rolled-over todo moves it to today, even when the time is unchanged.
    const rolledOver = reminder !== null && effectiveDate(todo, today()) !== todo.date;
    if (reminder !== todo.reminder || rolledOver) void setReminder(todo, reminder, scope());
  };

  const save = (event: SubmitEvent) => {
    event.preventDefault();
    if (isTime(time())) apply(time());
  };

  return (
    <form class="repeat-form" onSubmit={save}>
      <label class="field">
        <span class="field-label">Remind me at</span>
        <input
          class="input"
          type="time"
          required
          autofocus
          value={time()}
          onInput={(e) => setTime(e.currentTarget.value)}
        />
      </label>
      <Show when={todo.recurrenceId !== null}>
        <ScopeField scopes={['this', 'following', 'all']} value={scope()} onChange={setScope} />
      </Show>
      <div class="dialog-actions">
        <Show when={todo.reminder !== null}>
          <button type="button" class="button" onClick={() => apply(null)}>
            Remove
          </button>
        </Show>
        <button type="button" class="button" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" class="button button-primary" disabled={!isTime(time())}>
          Save
        </button>
      </div>
    </form>
  );
}
