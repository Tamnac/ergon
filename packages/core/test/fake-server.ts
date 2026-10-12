import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  challengeMessage,
  fromBase64,
  randomBytes,
  toBase64,
  toBase64Url,
  type Registration,
} from '../src';

const protocol = new URL('../../../protocol/', import.meta.url);
export const schema = JSON.parse(readFileSync(new URL('v1.schema.json', protocol), 'utf8'));
export const fixtures = JSON.parse(
  readFileSync(new URL('fixtures/v1.json', protocol), 'utf8'),
) as Record<string, { valid: unknown[]; invalid: unknown[] }>;

const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
ajv.addSchema(schema);

/** Validates `value` against a message definition of protocol/v1.schema.json. */
export function check(name: string, value: unknown): string | undefined {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`No schema ${name}`);
  return validate(value) ? undefined : ajv.errorsText(validate.errors);
}

interface Device {
  id: string;
  account: string;
  name: string;
  created: number;
}

/**
 * In-memory stand-in for the Go server (apps/server), reached through `fetch`. It checks
 * every request and response against the protocol schema.
 */
export class FakeServer {
  readonly url = 'https://sync.test';
  registration: Registration = 'open';
  invites = new Set<string>();
  offline = false;
  readonly accounts = new Set<string>();
  readonly batches: { seq: number; account: string; id: string; data: string }[] = [];
  readonly snapshots = new Map<string, { seq: number; data: string }>();
  readonly links = new Map<string, string>();
  /** Push subscriptions by device id. */
  readonly pushes = new Map<string, { endpoint: string }>();
  /** Latest reminders uploaded per account. */
  readonly reminders = new Map<string, { id: string; at: number; data: string }[]>();
  readonly #challenges = new Set<string>();
  readonly #devices = new Map<string, Device>();
  #seq = 0;

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError('fetch failed');
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const token = new Headers(init.headers).get('Authorization')?.replace(/^Bearer /, '');
    const device = token ? this.#devices.get(token) : undefined;
    const route = `${method} ${pathname.replace(/^\/api\/v1/, '')}`;

    const request = requests[route];
    if (request) {
      const error = check(request, body);
      if (error) return reply(400, { error: 'bad_request', message: error });
    }

    const needsAuth =
      !['GET /info', 'POST /challenge', 'POST /session'].includes(route) &&
      !route.startsWith('GET /links/');
    if (needsAuth && !device) return reply(401, { error: 'unauthorized', message: 'no session' });
    const account = device?.account ?? '';

    switch (route) {
      case 'GET /info':
        return reply(200, { version: 1, registration: this.registration, vapid: 'BAUTH' }, 'Info');
      case 'POST /challenge': {
        const nonce = toBase64(randomBytes(32));
        this.#challenges.add(nonce);
        return reply(200, { nonce }, 'Challenge');
      }
      case 'POST /session': {
        const { publicKey, nonce, signature, invite } = body;
        if (!this.#challenges.delete(nonce))
          return reply(401, { error: 'unauthorized', message: 'nonce' });
        const valid = ed25519.verify(
          fromBase64(signature),
          challengeMessage(nonce),
          fromBase64(publicKey),
        );
        if (!valid) return reply(401, { error: 'unauthorized', message: 'signature' });
        const created = !this.accounts.has(publicKey);
        if (created) {
          if (this.registration === 'closed')
            return reply(403, { error: 'registration_closed', message: '' });
          if (this.registration === 'invite') {
            if (!invite) return reply(403, { error: 'invite_required', message: '' });
            if (!this.invites.delete(invite))
              return reply(403, { error: 'invalid_invite', message: '' });
          }
          this.accounts.add(publicKey);
        }
        const session = toBase64Url(randomBytes(32));
        const id = toBase64Url(randomBytes(9));
        this.#devices.set(session, {
          id,
          account: publicKey,
          name: body.device.name,
          created: Date.now(),
        });
        return reply(200, { token: session, deviceId: id, account: publicKey, created }, 'Session');
      }
      case 'DELETE /session':
        this.#devices.delete(token!);
        return reply(204);
      case 'GET /devices':
        return reply(
          200,
          {
            devices: [...this.#devices.entries()]
              .filter(([, d]) => d.account === account)
              .map(([t, d]) => ({
                id: d.id,
                name: d.name,
                created: d.created,
                lastSeen: d.created,
                current: t === token,
              })),
          },
          'Devices',
        );
      case 'POST /batches': {
        const existing = this.batches.find((b) => b.account === account && b.id === body.id);
        if (existing) return reply(200, { seq: existing.seq }, 'BatchPushed');
        if (fromBase64(body.data).length > 1 << 20) {
          return reply(413, { error: 'too_large', message: '' });
        }
        const seq = ++this.#seq;
        this.batches.push({ seq, account, id: body.id, data: body.data });
        return reply(200, { seq }, 'BatchPushed');
      }
      case 'GET /batches': {
        const after = Number(searchParams.get('after') ?? 0);
        const limit = Math.min(Number(searchParams.get('limit') ?? 500), 1000);
        const snapshot = this.snapshots.get(account)?.seq ?? 0;
        if (after < snapshot) return reply(410, { error: 'cursor_pruned', message: '' });
        const mine = this.batches.filter((b) => b.account === account);
        const next = mine.filter((b) => b.seq > after);
        return reply(
          200,
          {
            batches: next.slice(0, limit).map(({ seq, data }) => ({ seq, data })),
            more: next.length > limit,
            sinceSnapshot: mine.filter((b) => b.seq > snapshot).length,
          },
          'Batches',
        );
      }
      case 'GET /snapshot': {
        const snapshot = this.snapshots.get(account);
        return snapshot
          ? reply(200, snapshot, 'Snapshot')
          : reply(404, { error: 'not_found', message: '' });
      }
      case 'PUT /snapshot': {
        if (body.seq <= (this.snapshots.get(account)?.seq ?? 0))
          return reply(409, { error: 'stale_snapshot', message: '' });
        this.snapshots.set(account, { seq: body.seq, data: body.data });
        for (let i = this.batches.length - 1; i >= 0; i--) {
          const batch = this.batches[i]!;
          if (batch.account === account && batch.seq <= body.seq) this.batches.splice(i, 1);
        }
        return reply(204);
      }
      case 'PUT /push':
        this.pushes.set(device!.id, body);
        return reply(204);
      case 'DELETE /push':
        this.pushes.delete(device!.id);
        return reply(204);
      case 'PUT /reminders':
        this.reminders.set(account, body.reminders);
        return reply(204);
      case 'POST /links': {
        const id = toBase64Url(randomBytes(12));
        this.links.set(id, body.data);
        return reply(201, { id, expires: Date.now() + 600_000 }, 'LinkCreated');
      }
    }
    if (method === 'DELETE' && pathname.startsWith('/api/v1/devices/')) {
      const id = pathname.split('/').at(-1);
      const entry = [...this.#devices.entries()].find(
        ([, d]) => d.id === id && d.account === account,
      );
      if (!entry) return reply(404, { error: 'not_found', message: '' });
      this.#devices.delete(entry[0]);
      return reply(204);
    }
    if (method === 'GET' && pathname.startsWith('/api/v1/links/')) {
      const id = pathname.split('/').at(-1)!;
      const data = this.links.get(id);
      this.links.delete(id);
      return data ? reply(200, { data }, 'Link') : reply(404, { error: 'not_found', message: '' });
    }
    return reply(404, { error: 'not_found', message: route });
  };

  /** Everything the server stores, for checking that no plaintext leaks. */
  dump(): string {
    return JSON.stringify([
      ...this.batches,
      ...this.snapshots.values(),
      ...this.links.values(),
      ...this.reminders.values(),
    ]);
  }
}

const requests: Record<string, string> = {
  'POST /session': 'SessionRequest',
  'POST /batches': 'BatchPush',
  'PUT /snapshot': 'Snapshot',
  'POST /links': 'LinkCreate',
  'PUT /push': 'PushSubscription',
  'PUT /reminders': 'Reminders',
};

function reply(status: number, body?: unknown, name?: string): Response {
  const error = body === undefined ? undefined : check(status < 300 ? name! : 'Error', body);
  if (error) throw new Error(`Invalid ${name ?? 'Error'} response: ${error}`);
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
