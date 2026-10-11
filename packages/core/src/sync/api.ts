import { signChallenge, type Keys } from './keys';
import { toBase64 } from './crypto';

/** Message types of protocol/v1.schema.json. */
export type Registration = 'open' | 'invite' | 'closed';
export interface Info {
  version: 1;
  registration: Registration;
}
export interface Session {
  token: string;
  deviceId: string;
  account: string;
  created: boolean;
}
export interface Device {
  id: string;
  name: string;
  created: number;
  lastSeen: number;
  current: boolean;
}
export interface Batch {
  seq: number;
  data: string;
}
export interface Batches {
  batches: Batch[];
  more: boolean;
  sinceSnapshot: number;
}
export interface Snapshot {
  seq: number;
  data: string;
}

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'invite_required'
  | 'invalid_invite'
  | 'registration_closed'
  | 'not_found'
  | 'stale_snapshot'
  | 'cursor_pruned'
  | 'too_large'
  | 'internal';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** HTTP client for the sync protocol (protocol/README.md). */
export class SyncApi {
  readonly server: string;
  readonly #token: string | undefined;
  readonly #fetch: Fetch;

  constructor(
    server: string,
    token?: string,
    fetch: Fetch = (url, init) => globalThis.fetch(url, init),
  ) {
    this.server = server.replace(/\/+$/, '');
    this.#token = token;
    this.#fetch = fetch;
  }

  withToken(token: string): SyncApi {
    return new SyncApi(this.server, token, this.#fetch);
  }

  info(): Promise<Info> {
    return this.#json('GET', '/info');
  }

  /** Signs in with the account key, registering the account if the server doesn't know it. */
  async signIn(keys: Keys, device: string, invite?: string): Promise<Session> {
    const { nonce } = await this.#json<{ nonce: string }>('POST', '/challenge');
    return this.#json('POST', '/session', {
      publicKey: keys.account,
      nonce,
      signature: toBase64(signChallenge(keys, nonce)),
      device: { name: device },
      ...(invite ? { invite } : {}),
    });
  }

  async signOut(): Promise<void> {
    await this.#request('DELETE', '/session');
  }

  async devices(): Promise<Device[]> {
    return (await this.#json<{ devices: Device[] }>('GET', '/devices')).devices;
  }

  async revokeDevice(id: string): Promise<void> {
    await this.#request('DELETE', `/devices/${encodeURIComponent(id)}`);
  }

  async push(id: string, data: string): Promise<number> {
    return (await this.#json<{ seq: number }>('POST', '/batches', { id, data })).seq;
  }

  pull(after: number, limit?: number): Promise<Batches> {
    const query = new URLSearchParams({ after: String(after) });
    if (limit !== undefined) query.set('limit', String(limit));
    return this.#json('GET', `/batches?${query}`);
  }

  async snapshot(): Promise<Snapshot | undefined> {
    try {
      return await this.#json<Snapshot>('GET', '/snapshot');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') return undefined;
      throw error;
    }
  }

  async putSnapshot(snapshot: Snapshot): Promise<void> {
    await this.#request('PUT', '/snapshot', snapshot);
  }

  createLink(data: string): Promise<{ id: string; expires: number }> {
    return this.#json('POST', '/links', { data });
  }

  async link(id: string): Promise<string> {
    return (await this.#json<{ data: string }>('GET', `/links/${encodeURIComponent(id)}`)).data;
  }

  /**
   * Streams server-sent events, calling `onOpen` once connected and `onBatch` per pushed
   * batch. Resolves when the server ends the stream.
   */
  async events(
    signal: AbortSignal,
    handlers: { onOpen: () => void; onBatch: (seq: number) => void },
  ): Promise<void> {
    const response = await this.#request('GET', '/events', undefined, signal);
    handlers.onOpen();
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value.replaceAll('\r\n', '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = parseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event.type === 'batch')
          handlers.onBatch((JSON.parse(event.data) as { seq: number }).seq);
      }
    }
  }

  async #json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await (await this.#request(method, path, body)).json()) as T;
  }

  async #request(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.#fetch(`${this.server}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (response.ok) return response;
    const error = (await response.json().catch(() => undefined)) as
      { error: ErrorCode; message: string } | undefined;
    throw new ApiError(
      response.status,
      error?.error ?? 'internal',
      error?.message ?? `${response.status} ${response.statusText}`,
    );
  }
}

function parseEvent(block: string): { type: string; data: string } {
  let type = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return { type, data: data.join('\n') };
}
