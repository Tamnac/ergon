import { isTime, type Todo } from '@ergon/core';
import { Show, createSignal } from 'solid-js';
import { setReminder } from '../state/actions';
import { settings } from '../state/data';
import { reminding, setReminding } from '../state/view';
import { Dialog } from './Dialog';
import { askScope } from './ScopeDialog';

export function ReminderDialog() {
  return (
    <Dialog title="Reminder" open={reminding() !== null} onClose={() => setReminding(null)}>
      <Show when={reminding()} keyed>
        {(todo) => <ReminderEditor todo={todo} onDone={() => setReminding(null)} />}
      </Show>
    </Dialog>
  );
}

function ReminderEditor(props: { todo: Todo; onDone: () => void }) {
  const { todo } = props;
  const [time, setTime] = createSignal(todo.reminder ?? settings.reminderTime);

  const apply = async (reminder: string | null) => {
    props.onDone();
    if (reminder === todo.reminder) return;
    const scope =
      todo.recurrenceId === null
        ? 'this'
        : await askScope('Change reminder of repeating todo', [
            'this',
            'following',
            'all',
          ] as const);
    if (scope) await setReminder(todo, reminder, scope);
  };

  const save = (event: SubmitEvent) => {
    event.preventDefault();
    if (isTime(time())) void apply(time());
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
      <div class="dialog-actions">
        <Show when={todo.reminder !== null}>
          <button type="button" class="button" onClick={() => void apply(null)}>
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
