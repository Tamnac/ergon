import { describe, expect, it } from 'vitest';
import {
  ApiError,
  createDeviceLink,
  Database,
  deriveKeys,
  generateSeed,
  loadCredentials,
  patch,
  randomBytes,
  redeemDeviceLink,
  signIn,
  signOut,
  SyncApi,
  SyncEngine,
  toBase64,
  type Change,
  type SyncOptions,
} from '../src';
import { check, FakeServer, fixtures } from './fake-server';
import { rng } from './random';
import { memoryDriver } from './sqlite';

async function device(
  server: FakeServer,
  seed: Uint8Array,
  options: SyncOptions & { skew?: number } = {},
) {
  const driver = memoryDriver();
  const db = await Database.open(driver, () => Date.now() + (options.skew ?? 0));
  const credentials = await signIn(db, server.url, seed, { device: 'test', fetch: server.fetch });
  const engine = new SyncEngine(db, credentials, { fetch: server.fetch, ...options });
  const dump = async () => ({
    ops: (await db.compacted()).toSorted((a, b) => (a.hlc < b.hlc ? -1 : 1)),
    todos: await driver.query('SELECT * FROM todo ORDER BY id'),
    lists: await driver.query('SELECT * FROM list ORDER BY id'),
  });
  return { db, engine, dump };
}

describe('protocol fixtures', () => {
  for (const [name, { valid, invalid }] of Object.entries(fixtures)) {
    it(name, () => {
      for (const value of valid) expect(check(name, value)).toBeUndefined();
      for (const value of invalid) expect(check(name, value)).toBeDefined();
    });
  }
});

describe('sync', () => {
  it('brings a new device up to date', async () => {
    const server = new FakeServer();
    const seed = generateSeed();
    const a = await device(server, seed);
    await a.db.write(patch('todo', 't1', { text: 'Buy milk', date: '2026-09-28', order: 'a0' }));
    await a.engine.sync();

    const b = await device(server, seed);
    await b.engine.sync();
    expect((await b.db.todosBetween('2026-09-28', '2026-09-28', '2026-09-28'))[0]?.text).toBe(
      'Buy milk',
    );
    expect(await a.db.outbox(10)).toEqual([]);
    expect(server.dump()).not.toContain('Buy milk');
  });

  it('converges after concurrent offline edits', async () => {
    for (let run = 1; run <= 8; run++) {
      const random = rng(run);
      const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
      const server = new FakeServer();
      const seed = generateSeed();
      const devices = await Promise.all(
        [0, 1, 2].map((i) =>
          device(server, seed, { skew: (i - 1) * 5000 * random(), snapshotAfter: 4 }),
        ),
      );
      const ids = ['a', 'b', 'c', 'd'];
      const changes = (): Change[] =>
        pick([
          () => patch('todo', pick(ids), { text: pick(['x', 'y', 'z']) }),
          () => patch('todo', pick(ids), { done: random() < 0.5 }),
          () => patch('todo', pick(ids), { date: pick(['2026-09-27', '2026-09-28', null]) }),
          () => patch('todo', pick(ids), { deleted: random() < 0.3 }),
          () =>
            patch('list', pick(ids), { name: pick(['Work', 'Home']), order: pick(['a0', 'a1']) }),
        ])();

      for (let step = 0; step < 80; step++) {
        const d = pick(devices);
        if (random() < 0.75) await d.db.write(changes());
        else await d.engine.sync();
      }
      for (let round = 0; round < 2; round++) {
        for (const d of devices) await d.engine.sync();
      }

      const [first, ...rest] = await Promise.all(devices.map((d) => d.dump()));
      for (const other of rest) expect(other).toEqual(first);
    }
  });

  it('restores from a snapshot after the server pruned old batches', async () => {
    const server = new FakeServer();
    const seed = generateSeed();
    const a = await device(server, seed, { snapshotAfter: 3 });
    const offline = await device(server, seed);
    await offline.engine.sync();
    await offline.db.write(patch('todo', 'mine', { text: 'written offline' }));

    for (let i = 0; i < 5; i++) {
      await a.db.write(patch('todo', `t${i}`, { text: `todo ${i}` }));
      await a.engine.sync();
    }
    expect(server.snapshots.size).toBe(1);
    expect(server.batches.length).toBeLessThan(5);

    await offline.engine.sync();
    await a.engine.sync();
    expect(await offline.dump()).toEqual(await a.dump());
    expect((await a.dump()).todos.map((t) => t.id)).toContain('mine');

    const fresh = await device(server, seed);
    await fresh.engine.sync();
    expect(await fresh.dump()).toEqual(await a.dump());
  });

  it('reports offline and retries', async () => {
    const server = new FakeServer();
    const statuses: string[] = [];
    const a = await device(server, generateSeed(), { onStatus: (s) => statuses.push(s.state) });
    server.offline = true;
    await a.db.write(patch('todo', 't', { text: 'x' }));
    await a.engine.sync();
    expect(a.engine.status.state).toBe('offline');
    server.offline = false;
    await a.engine.sync();
    a.engine.stop();
    expect(statuses).toEqual(['syncing', 'offline', 'syncing', 'synced']);
    expect(server.batches).toHaveLength(1);
  });

  it('pushes each outbox batch once even if retried', async () => {
    const server = new FakeServer();
    const a = await device(server, generateSeed());
    await a.db.write(patch('todo', 't', { text: 'x' }));
    const fetch = server.fetch;
    let lose = true;
    server.fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (lose && init?.method === 'POST' && url.endsWith('/batches')) {
        lose = false;
        throw new TypeError('connection reset');
      }
      return response;
    };
    const engine = new SyncEngine(a.db, (await loadCredentials(a.db))!, { fetch: server.fetch });
    await engine.sync();
    await engine.sync();
    engine.stop();
    expect(server.batches).toHaveLength(1);
  });

  it('stops when the device is revoked', async () => {
    const server = new FakeServer();
    const seed = generateSeed();
    let revoked = false;
    const a = await device(server, seed, { onRevoked: () => (revoked = true) });
    const b = await device(server, seed);
    const credentials = (await loadCredentials(a.db))!;
    const api = new SyncApi(server.url, (await loadCredentials(b.db))!.token, server.fetch);
    const devices = await api.devices();
    expect(devices.map((d) => d.current).toSorted()).toEqual([false, true]);
    await api.revokeDevice(credentials.deviceId);
    await a.engine.sync();
    expect(revoked).toBe(true);
  });

  it('splits a large outbox into batches the server accepts', async () => {
    const server = new FakeServer();
    const seed = generateSeed();
    const a = await device(server, seed);
    const noise = () => Array.from({ length: 8 }, () => toBase64(randomBytes(60_000))).join('');
    const texts = [noise(), noise(), noise()];
    await a.db.write(texts.flatMap((text, i) => patch('todo', `t${i}`, { text })));
    await a.engine.sync();
    expect(a.engine.status.state).toBe('synced');
    expect(server.batches).toHaveLength(3);

    const b = await device(server, seed);
    await b.engine.sync();
    expect((await b.dump()).todos.map((t) => t.text)).toEqual(texts);
  });

  it('stops an engine whose credentials were replaced', async () => {
    const server = new FakeServer();
    const a = await device(server, generateSeed());
    await signIn(a.db, server.url, generateSeed(), { device: 'x', fetch: server.fetch });
    await a.db.write(patch('todo', 't', { text: 'new account only' }));
    await a.engine.sync();
    expect(server.batches).toHaveLength(0);
    expect(await a.db.outbox(10)).not.toHaveLength(0);
  });

  it('re-uploads local data when switching accounts', async () => {
    const server = new FakeServer();
    const a = await device(server, generateSeed());
    await a.db.write(patch('todo', 't', { text: 'kept' }));
    await a.engine.sync();
    await signOut(a.db, server.fetch);
    expect(await loadCredentials(a.db)).toBeUndefined();

    const other = generateSeed();
    const credentials = await signIn(a.db, server.url, other, { device: 'x', fetch: server.fetch });
    await new SyncEngine(a.db, credentials, { fetch: server.fetch }).sync();
    const b = await device(server, other);
    await b.engine.sync();
    expect((await b.dump()).todos.map((t) => t.text)).toEqual(['kept']);
  });
});

describe('accounts', () => {
  it('requires an invite in invite mode', async () => {
    const server = new FakeServer();
    server.registration = 'invite';
    server.invites.add('abc');
    const db = await Database.open(memoryDriver());
    const seed = generateSeed();
    const attempt = (invite?: string) =>
      signIn(db, server.url, seed, { device: 'x', invite, fetch: server.fetch });
    await expect(attempt()).rejects.toMatchObject({ code: 'invite_required' });
    await expect(attempt('nope')).rejects.toBeInstanceOf(ApiError);
    await expect(attempt('abc')).resolves.toMatchObject({ server: server.url });
    await expect(attempt()).resolves.toBeDefined();
    expect(server.accounts).toEqual(new Set([deriveKeys(seed).account]));
  });

  it('links a device through a one-time link', async () => {
    const server = new FakeServer();
    const seed = generateSeed();
    const a = await device(server, seed);
    const link = await createDeviceLink((await loadCredentials(a.db))!, server.fetch);
    expect(server.dump()).not.toContain(link.key);
    expect(await redeemDeviceLink(link, server.fetch)).toEqual(seed);
    await expect(redeemDeviceLink(link, server.fetch)).rejects.toMatchObject({ code: 'not_found' });
  });
});
