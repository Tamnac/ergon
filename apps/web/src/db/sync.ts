import {
  createDeviceLink,
  deriveKeys,
  fromBase64,
  generateSeed,
  loadCredentials,
  phraseToSeed,
  reminderKey,
  redeemDeviceLink,
  seedToPhrase,
  signIn,
  signOut,
  uploadReminders,
  SyncApi,
  SyncEngine,
  type Credentials,
  type Database,
  type Device,
  type DeviceLink,
  type Info,
  type PushSubscriptionInfo,
  type Scheduled,
  type SyncStatus,
} from '@ergon/core';

/** Sync as the UI sees it. `revoked`: another device removed this one. */
export type SyncState =
  { state: 'off'; revoked?: boolean } | (SyncStatus & { server: string; account: string });

/** Sync operations the UI calls through the worker. */
export interface SyncControl {
  state(): Promise<SyncState>;
  info(server: string): Promise<Info>;
  /** Registers a new account; resolves with its recovery phrase. */
  create(server: string, invite?: string): Promise<string>;
  join(server: string, phrase: string, invite?: string): Promise<void>;
  redeemLink(link: Pick<DeviceLink, 'server' | 'id' | 'key'>): Promise<void>;
  phrase(): Promise<string>;
  createLink(): Promise<DeviceLink>;
  devices(): Promise<Device[]>;
  revokeDevice(id: string): Promise<void>;
  signOut(): Promise<void>;
  syncNow(): Promise<void>;
  /** The server's Web Push key, and the key (base64) the service worker unseals reminders with. */
  pushSetup(): Promise<{ vapid: string; key: string }>;
  putPush(subscription: PushSubscriptionInfo): Promise<void>;
  deletePush(): Promise<void>;
  /** Replaces the reminders the server pushes. */
  putReminders(reminders: Scheduled[]): Promise<void>;
}

/** Held by an engine run, and while credentials change, so they never overlap across tabs. */
const exclusive = <T>(task: () => Promise<T>): Promise<T> =>
  navigator.locks.request('ergon-sync-run', task);

type Message = { type: 'state'; state: SyncState } | { type: 'hello' | 'restart' | 'sync' };

/**
 * Sync for one tab's database worker. The worker holding the `ergon-sync` lock runs the
 * engine; the others relay its state and forward requests over a BroadcastChannel.
 */
export function createSync(
  db: Database,
  publish: (state: SyncState) => void,
  options: { app?: string } = {},
): SyncControl & { changed(): void } {
  const channel = new BroadcastChannel('ergon-sync');
  let leader = false;
  let engine: SyncEngine | undefined;
  let current: SyncState = { state: 'off' };

  const setState = (state: SyncState) => {
    current = state;
    publish(state);
    if (leader) channel.postMessage({ type: 'state', state } satisfies Message);
  };

  let restarting = Promise.resolve();
  const restart = (revoked = false) => (restarting = restarting.then(() => startEngine(revoked)));

  async function startEngine(revoked: boolean) {
    engine?.stop();
    engine = undefined;
    const credentials = await loadCredentials(db);
    if (!credentials) return setState({ state: 'off', revoked });
    const account = deriveKeys(fromBase64(credentials.seed)).account;
    const server = credentials.server;
    engine = new SyncEngine(db, credentials, {
      exclusive,
      onStatus: (status) => setState({ ...status, server, account }),
      onRevoked: () =>
        void exclusive(async () => {
          const current = (await loadCredentials(db))?.token === credentials.token;
          if (current) await signOut(db);
          return current;
        }).then(restart),
    });
    setState({ state: 'syncing', server, account });
    engine.start();
  }

  const send = (message: Message) => {
    if (leader) void handle(message);
    else channel.postMessage(message);
  };

  async function handle(message: Message) {
    if (message.type === 'state' && !leader) {
      current = message.state;
      publish(current);
    } else if (leader) {
      if (message.type === 'hello') channel.postMessage({ type: 'state', state: current });
      else if (message.type === 'restart') await restart();
      else if (message.type === 'sync') await engine?.sync();
    }
  }

  channel.addEventListener('message', (event: MessageEvent<Message>) => void handle(event.data));
  channel.postMessage({ type: 'hello' } satisfies Message);
  void navigator.locks.request('ergon-sync', () => {
    leader = true;
    void restart();
    return new Promise<never>(() => {});
  });
  addEventListener('online', () => void engine?.sync());

  const credentials = async (): Promise<Credentials> => {
    const stored = await loadCredentials(db);
    if (!stored) throw new Error('Sync is off');
    return stored;
  };
  const api = async () => {
    const { server, token } = await credentials();
    return new SyncApi(server, token);
  };
  const start = async (server: string, seed: Uint8Array, invite?: string) => {
    await exclusive(() => signIn(db, server, seed, { device: deviceName(options.app), invite }));
    send({ type: 'restart' });
  };

  return {
    changed: () => engine?.push(),
    state: async () => current,
    info: (server) => new SyncApi(server).info(),
    async create(server, invite) {
      const seed = generateSeed();
      await start(server, seed, invite);
      return seedToPhrase(seed);
    },
    async join(server, phrase, invite) {
      const seed = phraseToSeed(phrase);
      if (!seed) throw new Error('That is not a valid 24-word recovery phrase.');
      await start(server, seed, invite);
    },
    async redeemLink(link) {
      await start(link.server, await redeemDeviceLink(link));
    },
    phrase: async () => seedToPhrase(fromBase64((await credentials()).seed)),
    createLink: async () => createDeviceLink(await credentials()),
    devices: async () => (await api()).devices(),
    revokeDevice: async (id) => (await api()).revokeDevice(id),
    async signOut() {
      await exclusive(() => signOut(db));
      send({ type: 'restart' });
    },
    async syncNow() {
      send({ type: 'sync' });
    },
    async pushSetup() {
      const stored = await credentials();
      const { vapid } = await new SyncApi(stored.server).info();
      return { vapid, key: reminderKey(stored) };
    },
    putPush: async (subscription) => (await api()).putPush(subscription),
    deletePush: async () => (await api()).deletePush(),
    putReminders: async (reminders) => uploadReminders(await credentials(), reminders),
  };
}

/** A readable name like "Firefox on Linux" for the devices list; `app` replaces the browser. */
function deviceName(app?: string): string {
  const ua = navigator.userAgent;
  const browser =
    app ??
    [
      ['Edg/', 'Edge'],
      ['Firefox/', 'Firefox'],
      ['Chrome/', 'Chrome'],
      ['Safari/', 'Safari'],
    ].find(([token]) => ua.includes(token!))?.[1] ??
    'Browser';
  const os = [
    ['Android', 'Android'],
    ['iPhone', 'iPhone'],
    ['iPad', 'iPad'],
    ['Windows', 'Windows'],
    ['Mac OS', 'macOS'],
    ['CrOS', 'ChromeOS'],
    ['Linux', 'Linux'],
  ].find(([token]) => ua.includes(token!))?.[1];
  return os ? `${browser} on ${os}` : browser;
}
