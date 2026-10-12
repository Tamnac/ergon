import { sha256 } from '@noble/hashes/sha2.js';
import type { Database } from '../db/database';
import type { Op } from '../model';
import { ApiError, SyncApi, type Fetch } from './api';
import { fromBase64, seal, toBase64Url, unseal, utf8 } from './crypto';
import { deriveKeys } from './keys';

/** What a device needs to sync; stored locally under `CREDENTIALS_KEY`. */
export interface Credentials {
  server: string;
  /** Base64 master seed. */
  seed: string;
  token: string;
  deviceId: string;
}

export interface SyncStatus {
  state: 'syncing' | 'synced' | 'offline' | 'error';
  lastSynced?: number;
  error?: string;
}

export interface SyncOptions {
  fetch?: Fetch;
  onStatus?: (status: SyncStatus) => void;
  /** The server no longer accepts this device's token; the engine has stopped. */
  onRevoked?: () => void;
  now?: () => number;
  /** Upload a snapshot once the server holds this many batches after the last one. */
  snapshotAfter?: number;
  /** Runs each sync run exclusively, e.g. under a lock shared with other tabs that sign in. */
  exclusive?: (task: () => Promise<void>) => Promise<void>;
}

/** Plaintext of a sealed batch or snapshot. */
interface Payload {
  ops: Op[];
}

export const CURSOR_KEY = 'cursor';
export const CREDENTIALS_KEY = 'credentials';
const PUSH_LIMIT = 1000;
/** Plaintext bytes per batch; gzip keeps the sealed batch under the server's 1 MiB limit. */
const MAX_BATCH_BYTES = 768 * 1024;
const PUSH_DELAY = 300;
const MAX_BACKOFF = 5 * 60_000;

/**
 * Pushes the outbox and pulls batches from the server, one run at a time. Failed runs are
 * retried with backoff; server events and local writes trigger new runs.
 */
export class SyncEngine {
  readonly #db: Database;
  readonly #api: SyncApi;
  readonly #key: Uint8Array;
  readonly #token: string;
  readonly #options: SyncOptions;
  readonly #abort = new AbortController();
  #status: SyncStatus = { state: 'syncing' };
  #cursor: number | undefined;
  #pendingPull = false;
  #pendingPush = false;
  #running: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #failures = 0;

  constructor(db: Database, credentials: Credentials, options: SyncOptions = {}) {
    this.#db = db;
    this.#api = new SyncApi(credentials.server, credentials.token, options.fetch);
    this.#key = deriveKeys(fromBase64(credentials.seed)).encryptionKey;
    this.#token = credentials.token;
    this.#options = options;
  }

  get status(): SyncStatus {
    return this.#status;
  }

  /** Syncs now and keeps listening for server events until `stop`. */
  start(): void {
    void this.sync();
    void this.#listen();
  }

  stop(): void {
    this.#abort.abort();
    clearTimeout(this.#timer);
  }

  /** Pushes and pulls; resolves once the run (and any requested meanwhile) is over. */
  sync(): Promise<void> {
    this.#pendingPull = true;
    return this.#run();
  }

  /** Pushes local changes shortly, batching writes that come in quick succession. */
  push(): void {
    this.#pendingPush = true;
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.#run();
      }, PUSH_DELAY);
    }
  }

  #run(): Promise<void> {
    const exclusive = this.#options.exclusive ?? ((task) => task());
    this.#running ??= exclusive(() => this.#loop()).finally(() => (this.#running = undefined));
    return this.#running;
  }

  async #loop() {
    if (!(await this.#signedIn())) return this.stop();
    while ((this.#pendingPull || this.#pendingPush) && !this.#abort.signal.aborted) {
      const pull = this.#pendingPull;
      this.#pendingPull = this.#pendingPush = false;
      try {
        if (pull || this.#status.state !== 'synced') this.#setStatus({ state: 'syncing' });
        const pushed = await this.#push();
        if (pull) await this.#pull();
        this.#failures = 0;
        if (pull || pushed) this.#setStatus({ state: 'synced', lastSynced: this.#now() });
      } catch (error) {
        if (this.#abort.signal.aborted) return;
        if (error instanceof ApiError && error.code === 'unauthorized') return this.#revoke();
        this.#failures++;
        this.#setStatus({
          state: error instanceof TypeError ? 'offline' : 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => {
          this.#timer = undefined;
          void this.sync();
        }, backoff(this.#failures));
        return;
      }
    }
  }

  /** Whether these credentials are still the stored ones; another tab may have switched them. */
  async #signedIn(): Promise<boolean> {
    const stored = await this.#db.secret(CREDENTIALS_KEY);
    return stored !== undefined && (JSON.parse(stored) as Credentials).token === this.#token;
  }

  #revoke() {
    if (this.#abort.signal.aborted) return;
    this.stop();
    this.#options.onRevoked?.();
  }

  /** Sends the outbox in batches; returns whether anything was sent. */
  async #push(): Promise<boolean> {
    let pushed = false;
    for (;;) {
      const ops = takeBatch(await this.#db.outbox(PUSH_LIMIT));
      if (ops.length === 0) return pushed;
      const payload: Payload = { ops };
      // Derived from the content so a retried push after a lost response isn't stored twice.
      const id = toBase64Url(sha256(utf8(JSON.stringify(ops)))).slice(0, 32);
      await this.#api.push(id, await seal(this.#key, 'batch', payload));
      await this.#db.markPushed(ops);
      pushed = true;
    }
  }

  async #pull() {
    let cursor = await this.#loadCursor();
    for (;;) {
      let page;
      try {
        page = await this.#api.pull(cursor);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'cursor_pruned')) throw error;
        cursor = await this.#restore();
        continue;
      }
      const ops: Op[] = [];
      for (const batch of page.batches) {
        ops.push(...(await unseal<Payload>(this.#key, 'batch', batch.data)).ops);
      }
      if (ops.length > 0) await this.#db.apply(ops);
      const last = page.batches.at(-1);
      if (last) cursor = await this.#saveCursor(last.seq);
      if (!page.more) {
        if (page.sinceSnapshot >= (this.#options.snapshotAfter ?? 200))
          await this.#snapshot(cursor);
        return;
      }
    }
  }

  /** Loads the server snapshot after the batches before it were pruned. */
  async #restore(): Promise<number> {
    const snapshot = await this.#api.snapshot();
    if (!snapshot) throw new Error('Server pruned batches but has no snapshot');
    await this.#db.apply((await unseal<Payload>(this.#key, 'snapshot', snapshot.data)).ops);
    return this.#saveCursor(snapshot.seq);
  }

  /** Uploads the compacted op log so the server can drop the batches up to `cursor`. */
  async #snapshot(cursor: number) {
    const payload: Payload = { ops: await this.#db.compacted() };
    try {
      await this.#api.putSnapshot({
        seq: cursor,
        data: await seal(this.#key, 'snapshot', payload),
      });
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'stale_snapshot')) throw error;
    }
  }

  async #loadCursor(): Promise<number> {
    this.#cursor ??= Number((await this.#db.local(CURSOR_KEY)) ?? 0);
    return this.#cursor;
  }

  async #saveCursor(seq: number): Promise<number> {
    await this.#db.setLocal(CURSOR_KEY, String(seq));
    this.#cursor = seq;
    return seq;
  }

  async #listen() {
    const signal = this.#abort.signal;
    let failures = 0;
    while (!signal.aborted) {
      try {
        await this.#api.events(signal, {
          onOpen: () => {
            failures = 0;
            void this.sync();
          },
          onBatch: (seq) => {
            if (seq > (this.#cursor ?? 0)) void this.sync();
          },
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'unauthorized') return this.#revoke();
        failures++;
      }
      await sleep(backoff(failures), signal);
    }
  }

  #setStatus(status: SyncStatus) {
    const lastSynced = status.lastSynced ?? this.#status.lastSynced;
    this.#status = lastSynced === undefined ? status : { ...status, lastSynced };
    this.#options.onStatus?.(this.#status);
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }
}

/** The oldest ops that fit in one batch; at least one. */
function takeBatch(ops: Op[]): Op[] {
  let size = 0;
  const end = ops.findIndex(
    (op, i) => (size += utf8(JSON.stringify(op)).length + 1) > MAX_BATCH_BYTES && i > 0,
  );
  return end < 0 ? ops : ops.slice(0, end);
}

/** Exponential with jitter: about 1s, 2s, 4s … up to 5 minutes. */
function backoff(failures: number): number {
  const base = Math.min(1000 * 2 ** Math.max(0, failures - 1), MAX_BACKOFF);
  return base / 2 + Math.random() * (base / 2);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
