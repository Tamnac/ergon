import type { DeviceLink } from '@ergon/core';
import { createSignal } from 'solid-js';
import type { SyncState } from '../db/sync';
import { isDesktop } from '../lib/desktop';
import { worker } from './storage';

export const sync = worker.sync;
export const [syncState, setSyncState] = createSignal<SyncState>({ state: 'off' });
export const [syncOpen, setSyncOpen] = createSignal(false);

worker.onSyncState(setSyncState);
void sync.state().then(setSyncState);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && syncState().state !== 'off') void sync.syncNow();
});

type LinkParams = Pick<DeviceLink, 'server' | 'id' | 'key'>;

/** A device link opened from another device (`#link=…`), waiting for confirmation. */
export const [pendingLink, setPendingLink] = createSignal(takeLink());

export function linkUrl(link: LinkParams): string {
  const params = new URLSearchParams({ link: `${link.id}.${link.key}`, server: link.server });
  const app = isDesktop ? `${link.server}/` : `${location.origin}${location.pathname}`;
  return `${app}#${params}`;
}

function takeLink(): LinkParams | undefined {
  const params = new URLSearchParams(location.hash.slice(1));
  const [id, key] = params.get('link')?.split('.') ?? [];
  const server = params.get('server');
  if (!id || !key || !server) return undefined;
  history.replaceState(null, '', location.pathname + location.search);
  return { server, id, key };
}
