import { describe, expect, it } from 'vitest';
import { SyncController } from '../client/controller.js';
import { GitHubStore, fetchShared } from '../client/github.js';
import { MemoryStore } from '../client/memory.js';
import { ConflictError, OfflineError, SetupError } from '../client/store.js';
import { device, memoryStorage } from './helpers.js';

function setup() {
  const store = new MemoryStore();
  const clock = { t: 1000 };
  return { store, clock, a: device(store, 'A', { clock }), b: device(store, 'B', { clock }) };
}

describe('Teilen in der Engine', () => {
  it('teilt ein Dokument, vermerkt die Kennung in der Ablage und erneuert den Link bei jeder Übertragung', async () => {
    const { store, a } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    a.save('d1', { title: 'Eins', n: 2 }); // gedrosselt, noch nicht übertragen
    const gist = await a.engine.share('d1');
    expect(store.shares.get(gist)?.record).toMatchObject({ app: 'test-app', device: 'A', data: { title: 'Eins', n: 2 } });
    expect(store.shares.get(gist)?.description).toBe('Eins');
    expect((await store.get('test-app', 'd1'))?.record.share).toEqual({ gist, since: expect.any(Number) });
    expect(a.engine.state.shared).toEqual(['d1']);
    expect(a.engine.shareInfo('d1')?.gist).toBe(gist);
    expect(await a.engine.share('d1')).toBe(gist); // zweites Mal: derselbe Link
    a.save('d1', { title: 'Eins', n: 3 });
    await a.engine.flush();
    expect(store.shares.get(gist)?.record.data).toEqual({ title: 'Eins', n: 3 });
  });

  it('ein anderes Gerät des Besitzers erneuert den Link ebenfalls', async () => {
    const { store, a, b } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    const gist = await a.engine.share('d1');
    await b.engine.run();
    await b.engine.download('d1');
    expect(b.engine.shareInfo('d1')?.gist).toBe(gist);
    b.save('d1', { title: 'Eins', n: 5 });
    await b.engine.flush();
    expect(store.shares.get(gist)?.record).toMatchObject({ device: 'B', data: { n: 5 } });
  });

  it('beendet das Teilen: Link weg, Kennung aus der Ablage entfernt', async () => {
    const { store, a } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    const gist = await a.engine.share('d1');
    await a.engine.unshare('d1');
    expect(store.shares.has(gist)).toBe(false);
    expect((await store.get('test-app', 'd1'))?.record.share).toBeUndefined();
    expect(a.engine.state.shared).toEqual([]);
    await a.engine.unshare('d1'); // nichts zu tun
  });

  it('Löschen des Dokuments beendet das Teilen; ein extern gelöschter Link wird vergessen', async () => {
    const { store, a } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    a.save('d2', { title: 'Zwei', n: 1 });
    await a.engine.run();
    const g1 = await a.engine.share('d1');
    const g2 = await a.engine.share('d2');
    a.docs.delete('d1');
    a.engine.removed('d1');
    await a.engine.run();
    expect(store.shares.has(g1)).toBe(false);
    store.shares.delete(g2); // auf GitHub gelöscht
    a.save('d2', { title: 'Zwei', n: 2 });
    await a.engine.flush();
    expect(a.engine.shareInfo('d2')).toBeNull();
  });

  it('teilt nicht bei Konflikt, nur im Browser oder ohne Fähigkeit der Ablage', async () => {
    const { a, b } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    await b.engine.run();
    await b.engine.download('d1');
    b.save('d1', { title: 'Eins', n: 2 });
    await b.engine.flush();
    a.save('d1', { title: 'Eins', n: 3 });
    await expect(a.engine.share('d1')).rejects.toBeInstanceOf(ConflictError);
    a.save('d2', { title: 'Zwei', n: 1 });
    a.engine.keepLocal(['d2']);
    await expect(a.engine.share('d2')).rejects.toMatchObject({ message: 'local-only' });
    const plain = device(Object.assign(new MemoryStore(), { createShare: undefined }), 'C');
    plain.save('d3', { title: 'Drei', n: 1 });
    await expect(plain.engine.share('d3')).rejects.toMatchObject({ message: 'share-unsupported' });
  });
});

/** Nachbildung der Gist-API. */
function fakeGists({ forbidden = false } = {}) {
  const gists = new Map();
  const calls = [];
  let n = 0;
  const reply = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path: u.pathname, body, auth: init.headers?.Authorization });
    const id = u.pathname.split('/')[2];
    if (u.pathname === '/gists' && init.method === 'POST') {
      if (forbidden) return reply(403, { message: 'Resource not accessible by personal access token' });
      const gid = `abc${++n}def0`;
      gists.set(gid, { id: gid, description: body.description, public: body.public, files: body.files, updated_at: '2026-10-22T08:42:00Z' });
      return reply(201, { id: gid });
    }
    if (!gists.has(id)) return reply(404, { message: 'Not Found' });
    if (init.method === 'PATCH') { Object.assign(gists.get(id), { description: body.description, files: body.files }); return reply(200, {}); }
    if (init.method === 'DELETE') { gists.delete(id); return reply(204, null); }
    const g = gists.get(id);
    const files = Object.fromEntries(Object.entries(g.files).map(([name, f]) => [name, { filename: name, content: f.content, truncated: false }]));
    return reply(200, { ...g, files });
  };
  return { fetch, gists, calls };
}

const record = { app: 'raci-app', schemaVersion: 1, savedAt: 5, device: 'Laptop', data: { name: 'Fest' } };

describe('Teilen über geheime Gists', () => {
  it('legt ein geheimes Gist an, erneuert und löscht es; Empfänger lesen ohne Anmeldung', async () => {
    const gh = fakeGists();
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', fetch: gh.fetch });
    const gist = await store.createShare(record, 'Fest');
    expect(gh.calls[0]).toMatchObject({ method: 'POST', path: '/gists', body: { description: 'Fest', public: false }, auth: 'Bearer t' });
    expect(Object.keys(gh.calls[0].body.files)).toEqual(['raci-app.json']);
    await store.updateShare(gist, { ...record, data: { name: 'Fest 2' } }, 'Fest 2');
    const shared = await fetchShared(gist, gh.fetch);
    expect(gh.calls.at(-1).auth).toBeUndefined();
    expect(shared).toEqual({ record: { ...record, data: { name: 'Fest 2' } }, updatedAt: Date.parse('2026-10-22T08:42:00Z') });
    await store.deleteShare(gist);
    await store.deleteShare(gist); // schon gelöscht: kein Fehler
    await expect(fetchShared(gist, gh.fetch)).rejects.toMatchObject({ message: 'share-missing' });
    await expect(store.updateShare(gist, record, 'x')).rejects.toBeInstanceOf(SetupError);
  });

  it('meldet fehlende Berechtigung als Zugangsfehler 403', async () => {
    const gh = fakeGists({ forbidden: true });
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', fetch: gh.fetch });
    await expect(store.createShare(record, 'Fest')).rejects.toMatchObject({ name: 'AuthError', status: 403 });
  });

  it('prüft Kennung und Inhalt beim Lesen', async () => {
    const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });
    await expect(fetchShared('../x', reply(200, {}))).rejects.toMatchObject({ message: 'share-id' });
    await expect(fetchShared('abcdef12', reply(200, { files: {} }))).rejects.toMatchObject({ message: 'share-invalid' });
    await expect(fetchShared('abcdef12', reply(200, { files: { 'a.json': { filename: 'a.json', content: 'kaputt' } } }))).rejects.toMatchObject({ message: 'share-invalid' });
    await expect(fetchShared('abcdef12', reply(200, { files: { 'a.json': { filename: 'a.json', content: '{}', truncated: true } } }))).rejects.toMatchObject({ message: 'share-invalid' });
    await expect(fetchShared('abcdef12', reply(403, {}))).rejects.toBeInstanceOf(OfflineError);
    await expect(fetchShared('abcdef12', reply(500, {}))).rejects.toBeInstanceOf(OfflineError);
    await expect(fetchShared('abcdef12', async () => { throw new TypeError('offline'); })).rejects.toBeInstanceOf(OfflineError);
  });

  it('Controller liest geteilte Dokumente nur der eigenen App und im passenden Format', async () => {
    const gh = fakeGists();
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', fetch: gh.fetch });
    const own = await store.createShare(record, 'Fest');
    const other = await store.createShare({ ...record, app: '5-why-app' }, 'Fest');
    const newer = await store.createShare({ ...record, schemaVersion: 9 }, 'Fest');
    const adapter = { app: 'raci-app', schemaVersion: 1, normalize: d => ({ ...d, ok: true }) };
    const c = new SyncController({ adapter: /** @type {any} */ (adapter), storage: memoryStorage(), fetch: gh.fetch, win: null });
    expect(await c.readShared(own)).toEqual({ data: { name: 'Fest', ok: true }, savedAt: 5, device: 'Laptop' });
    await expect(c.readShared(other)).rejects.toMatchObject({ message: 'share-other-app' });
    await expect(c.readShared(newer)).rejects.toMatchObject({ message: 'newer-schema' });
  });
});
