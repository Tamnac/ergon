import type { Device, Registration } from '@ergon/core';
import { For, Match, Show, Switch, createResource, createSignal, type JSX } from 'solid-js';
import { renderSVG } from 'uqr';
import type { WorkerError } from '../db/client';
import type { SyncState } from '../db/sync';
import {
  linkUrl,
  pendingLink,
  setPendingLink,
  setSyncOpen,
  sync,
  syncOpen,
  syncState,
} from '../state/sync';
import { Dialog } from './Dialog';
import './SyncDialog.css';

const errorMessages: Record<string, string> = {
  invite_required: 'This server needs an invite code for new accounts.',
  invalid_invite: 'That invite code is unknown or already used.',
  registration_closed: 'This server does not accept new accounts.',
  not_found: 'This link has expired or was already used.',
};

const registrationLabels: Record<Registration, string> = {
  open: 'Open for new accounts',
  invite: 'New accounts need an invite code',
  closed: 'Closed to new accounts',
};

export function describeError(error: unknown): string {
  const { name, message, code } = error as Partial<WorkerError>;
  if (code && code in errorMessages) return errorMessages[code]!;
  if (name === 'TypeError') return "Can't reach the server.";
  return message ?? String(error);
}

export function SyncDialog() {
  const [newPhrase, setNewPhrase] = createSignal<string>();
  const close = () => {
    setSyncOpen(false);
    setNewPhrase(undefined);
  };

  return (
    <Dialog title="Sync" open={syncOpen()} onClose={close}>
      <Switch>
        <Match when={newPhrase()}>
          {(phrase) => (
            <>
              <p class="sync-note">
                This is your recovery phrase. Write it down and keep it safe: it is the only way to
                restore your account, and nobody can reset it for you.
              </p>
              <Phrase phrase={phrase()} />
              <div class="dialog-actions">
                <button type="button" class="button button-primary" onClick={close}>
                  I wrote it down
                </button>
              </div>
            </>
          )}
        </Match>
        <Match when={pendingLink()}>
          {(link) => <RedeemLink server={link().server} onDone={() => setPendingLink()} />}
        </Match>
        <Match when={syncState().state === 'off'}>
          <SignIn onCreated={setNewPhrase} />
        </Match>
        <Match when={syncState().state !== 'off' && syncState()}>
          {(state) => <Account state={state() as Exclude<SyncState, { state: 'off' }>} />}
        </Match>
      </Switch>
    </Dialog>
  );
}

function RedeemLink(props: { server: string; onDone: () => void }) {
  const action = useAction();
  const redeem = () =>
    action.run(async () => {
      if (syncState().state !== 'off') await sync.signOut();
      await sync.redeemLink(pendingLink()!);
      props.onDone();
    });

  return (
    <>
      <p class="sync-note">
        Link this device to your account on <strong>{props.server}</strong>? Todos on this device
        are merged into the account.
      </p>
      <Show when={syncState().state !== 'off'}>
        <p class="sync-note">This signs this device out of the account it syncs with now.</p>
      </Show>
      <action.Error />
      <div class="dialog-actions">
        <button type="button" class="button" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button
          type="button"
          class="button button-primary"
          disabled={action.busy()}
          onClick={redeem}
        >
          Link device
        </button>
      </div>
    </>
  );
}

function SignIn(props: { onCreated: (phrase: string) => void }) {
  const [mode, setMode] = createSignal<'create' | 'join'>('create');
  const [server, setServer] = createSignal(location.origin);
  const [phrase, setPhrase] = createSignal('');
  const [invite, setInvite] = createSignal('');
  const [inviteNeeded, setInviteNeeded] = createSignal(false);
  const [info] = createResource(server, (url) => sync.info(url).catch(() => null));
  const action = useAction((error) => {
    if ((error as WorkerError).code === 'invite_required') setInviteNeeded(true);
  });

  const showInvite = () =>
    inviteNeeded() || (mode() === 'create' && info()?.registration === 'invite');

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const code = invite().trim() || undefined;
    void action.run(async () => {
      if (mode() === 'create') props.onCreated(await sync.create(server(), code));
      else await sync.join(server(), phrase(), code);
    });
  };

  return (
    <form class="sync-form" onSubmit={submit}>
      <p class="sync-note">
        Keep your todos in sync across devices. They are encrypted on this device before they are
        sent; the server only stores data it can't read.
      </p>
      <Show when={(syncState() as { revoked?: boolean }).revoked}>
        <p class="sync-note" role="status">
          This device was removed from your account on another device.
        </p>
      </Show>
      <div class="field">
        <label class="field-label" for="sync-server">
          Server
        </label>
        <input
          id="sync-server"
          class="input"
          type="url"
          required
          aria-describedby="sync-server-hint"
          value={server()}
          onChange={(e) => setServer(e.currentTarget.value.trim())}
        />
        <span id="sync-server-hint" class="sync-hint">
          {info.loading
            ? '\u00a0'
            : info()
              ? registrationLabels[info()!.registration]
              : 'No Ergon server found at this address.'}
        </span>
      </div>
      <div class="segmented" role="radiogroup" aria-label="Account">
        <label>
          <input
            type="radio"
            name="sync-mode"
            checked={mode() === 'create'}
            onChange={() => setMode('create')}
          />
          New account
        </label>
        <label>
          <input
            type="radio"
            name="sync-mode"
            checked={mode() === 'join'}
            onChange={() => setMode('join')}
          />
          Existing account
        </label>
      </div>
      <Show when={mode() === 'join'}>
        <div class="field">
          <label class="field-label" for="sync-phrase">
            Recovery phrase
          </label>
          <textarea
            id="sync-phrase"
            class="input sync-phrase-input"
            required
            aria-describedby="sync-phrase-hint"
            rows={4}
            autocomplete="off"
            spellcheck={false}
            value={phrase()}
            onInput={(e) => setPhrase(e.currentTarget.value)}
          />
          <span id="sync-phrase-hint" class="sync-hint">
            The 24 words shown when the account was created. To skip typing them, use “Link a
            device” on a device that already syncs.
          </span>
        </div>
      </Show>
      <Show when={showInvite()}>
        <label class="field">
          <span class="field-label">Invite code</span>
          <input
            class="input"
            autocomplete="off"
            value={invite()}
            onInput={(e) => setInvite(e.currentTarget.value)}
          />
        </label>
      </Show>
      <action.Error />
      <div class="dialog-actions">
        <button type="submit" class="button button-primary" disabled={action.busy()}>
          {mode() === 'create' ? 'Create account' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}

function Account(props: { state: Exclude<SyncState, { state: 'off' }> }) {
  const [devices, { refetch }] = createResource(() => sync.devices());
  const [phrase, setPhrase] = createSignal<string>();
  const [link, setLink] = createSignal<string>();
  const action = useAction();

  return (
    <>
      <div class="sync-status">
        <span class={`sync-dot is-${props.state.state}`} />
        <span role="status">{statusText(props.state)}</span>
        <button type="button" class="button" onClick={() => void sync.syncNow()}>
          Sync now
        </button>
      </div>
      <p class="sync-hint">{props.state.server}</p>

      <section class="field">
        <h3 class="field-label">Link a device</h3>
        <Show
          when={link()}
          fallback={
            <button
              type="button"
              class="button sync-inline"
              disabled={action.busy()}
              onClick={() => action.run(async () => setLink(linkUrl(await sync.createLink())))}
            >
              Show link
            </button>
          }
        >
          {(url) => (
            <>
              <div class="sync-qr" innerHTML={renderSVG(url(), { border: 2 })} />
              <input
                class="input"
                readonly
                value={url()}
                onFocus={(e) => e.currentTarget.select()}
              />
              <p class="sync-hint">
                Scan the code or open the link on the new device. It works once, for 10 minutes, and
                gives full access to your todos.
              </p>
            </>
          )}
        </Show>
      </section>

      <section class="field">
        <h3 class="field-label">Recovery phrase</h3>
        <Show
          when={phrase()}
          fallback={
            <button
              type="button"
              class="button sync-inline"
              onClick={() => action.run(async () => setPhrase(await sync.phrase()))}
            >
              Show phrase
            </button>
          }
        >
          {(words) => <Phrase phrase={words()} />}
        </Show>
      </section>

      <section class="field">
        <h3 class="field-label">Devices</h3>
        <ul class="sync-devices">
          <For each={devices()}>
            {(device) => (
              <DeviceRow
                device={device}
                onRemove={() =>
                  action.run(async () => {
                    await sync.revokeDevice(device.id);
                    await refetch();
                  })
                }
              />
            )}
          </For>
        </ul>
      </section>

      <action.Error />
      <div class="dialog-actions">
        <button type="button" class="button" onClick={() => action.run(() => sync.signOut())}>
          Sign out
        </button>
      </div>
    </>
  );
}

function DeviceRow(props: { device: Device; onRemove: () => void }) {
  return (
    <li class="sync-device">
      <span>
        {props.device.name}
        <span class="sync-hint">
          {props.device.current
            ? ' \u00b7 this device'
            : ` \u00b7 seen ${ago(props.device.lastSeen)}`}
        </span>
      </span>
      <Show when={!props.device.current}>
        <button type="button" class="button" onClick={() => props.onRemove()}>
          Remove
        </button>
      </Show>
    </li>
  );
}

function Phrase(props: { phrase: string }) {
  return (
    <ol class="sync-phrase">
      <For each={props.phrase.split(' ')}>{(word) => <li>{word}</li>}</For>
    </ol>
  );
}

/** Busy flag and error message for an async button action. */
function useAction(onError?: (error: unknown) => void) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  return {
    busy,
    async run(task: () => Promise<unknown>) {
      setBusy(true);
      setError(undefined);
      try {
        await task();
      } catch (caught) {
        setError(describeError(caught));
        onError?.(caught);
      } finally {
        setBusy(false);
      }
    },
    Error: (): JSX.Element => (
      <Show when={error()}>
        <p class="sync-error" role="alert">
          {error()}
        </p>
      </Show>
    ),
  };
}

export function statusText(state: SyncState): string {
  switch (state.state) {
    case 'off':
      return 'Sync is off';
    case 'syncing':
      return 'Syncing…';
    case 'synced':
      return state.lastSynced ? `Synced ${ago(state.lastSynced)}` : 'Synced';
    case 'offline':
      return 'Offline, changes are kept on this device';
    case 'error':
      return `Sync failed: ${state.error ?? 'unknown error'}`;
  }
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(time: number): string {
  const minutes = Math.round((time - Date.now()) / 60_000);
  if (minutes > -1) return 'just now';
  if (minutes > -60) return relative.format(minutes, 'minute');
  if (minutes > -60 * 24) return relative.format(Math.round(minutes / 60), 'hour');
  return relative.format(Math.round(minutes / 60 / 24), 'day');
}
