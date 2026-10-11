import type { Database } from '../db/database';
import { SyncApi, type Fetch } from './api';
import {
  fromBase64,
  fromBase64Url,
  randomBytes,
  seal,
  toBase64,
  toBase64Url,
  unseal,
} from './crypto';
import { CREDENTIALS_KEY, CURSOR_KEY, type Credentials } from './engine';
import { deriveKeys } from './keys';

/** Server and account the local op log was last synced with. */
const REMOTE_KEY = 'remote';

export async function loadCredentials(db: Database): Promise<Credentials | undefined> {
  const stored = await db.local(CREDENTIALS_KEY);
  return stored ? (JSON.parse(stored) as Credentials) : undefined;
}

/**
 * Signs this device in (registering the account if needed) and stores the credentials.
 * Switching to another server or account queues all local data for upload there.
 */
export async function signIn(
  db: Database,
  server: string,
  seed: Uint8Array,
  options: { device: string; invite?: string; fetch?: Fetch },
): Promise<Credentials> {
  const api = new SyncApi(server, undefined, options.fetch);
  const keys = deriveKeys(seed);
  const session = await api.signIn(keys, options.device, options.invite);
  const remote = `${api.server} ${keys.account}`;
  if ((await db.local(REMOTE_KEY)) !== remote) {
    await db.resetOutbox();
    await db.setLocal(CURSOR_KEY, undefined);
    await db.setLocal(REMOTE_KEY, remote);
  }
  const credentials: Credentials = {
    server: api.server,
    seed: toBase64(seed),
    token: session.token,
    deviceId: session.deviceId,
  };
  await db.setLocal(CREDENTIALS_KEY, JSON.stringify(credentials));
  return credentials;
}

/** Forgets the credentials; local data stays. Revokes the session if the server is reachable. */
export async function signOut(db: Database, fetch?: Fetch): Promise<void> {
  const credentials = await loadCredentials(db);
  await db.setLocal(CREDENTIALS_KEY, undefined);
  if (credentials) {
    await new SyncApi(credentials.server, credentials.token, fetch).signOut().catch(() => {});
  }
}

/** A one-time link to the account seed; `key` never reaches the server. */
export interface DeviceLink {
  server: string;
  id: string;
  key: string;
  expires: number;
}

export async function createDeviceLink(
  credentials: Credentials,
  fetch?: Fetch,
): Promise<DeviceLink> {
  const key = randomBytes(32);
  const api = new SyncApi(credentials.server, credentials.token, fetch);
  const { id, expires } = await api.createLink(await seal(key, 'link', { seed: credentials.seed }));
  return { server: api.server, id, key: toBase64Url(key), expires };
}

/** Fetches (and thereby uses up) a device link; resolves with the account seed. */
export async function redeemDeviceLink(
  link: Pick<DeviceLink, 'server' | 'id' | 'key'>,
  fetch?: Fetch,
): Promise<Uint8Array> {
  const data = await new SyncApi(link.server, undefined, fetch).link(link.id);
  const { seed } = await unseal<{ seed: string }>(fromBase64Url(link.key), 'link', data);
  return fromBase64(seed);
}
