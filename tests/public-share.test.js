import { describe, expect, it } from 'vitest';
import { isFixedRef, sharedHash, sharedLink } from '../client/config.js';
import { SyncController } from '../client/controller.js';
import { GitHubStore, fetchPublic, publicFileUrl } from '../client/github.js';
import { MemoryStore } from '../client/memory.js';
import { ConflictError, OfflineError } from '../client/store.js';
import { device, memoryStorage } from './helpers.js';

const SHA = '3f9c2e1a5b7d9f0e1c2b3a4d5e6f708192a3b4c5';
const record = { app: 'raci-app', schemaVersion: 1, savedAt: 5, device: 'Laptop', data: { name: 'Offen' } };
const reply = (status, body) => new Response(body == null ? null : typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('Links zum Ansehen', () => {
  it('liest und schreibt Gist- und Repo-Links', () => {
    expect(sharedLink('#g=abcdef12')).toEqual({ kind: 'gist', gist: 'abcdef12' });
    expect(sharedLink('#p=team/methoden/m-1')).toEqual({ kind: 'public', repo: 'team/methoden', id: 'm-1' });
    expect(sharedLink(`#p=team/methoden/m-1@${SHA}`)).toEqual({ kind: 'public', repo: 'team/methoden', id: 'm-1', ref: SHA });
    expect(sharedLink('#p=team/methoden/a%20b@feature%2Fx')).toEqual({ kind: 'public', repo: 'team/methoden', id: 'a b', ref: 'feature/x' });
    for (const bad of ['', '#/', '#g=xyz', '#p=team/m-1', '#p=team/methoden/a/b', '#p=../methoden/m-1', '#p=team/methoden/%E0%A4%A']) expect(sharedLink(bad)).toBeNull();
    for (const hash of ['#g=abcdef12', '#p=team/methoden/m-1', `#p=team/methoden/m-1@${SHA}`, '#p=team/methoden/a%20b@feature%2Fx']) {
      expect(sharedHash(/** @type {any} */ (sharedLink(hash)))).toBe(hash);
    }
    expect(isFixedRef(SHA)).toBe(true);
    expect(isFixedRef('main')).toBe(false);
    expect(isFixedRef(undefined)).toBe(false);
  });
});

describe('Lesen aus einem öffentlichen Repo', () => {
  it('liest über raw.githubusercontent.com ohne Anmeldung, auch einen festen Stand', async () => {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); return reply(200, record); };
    expect(await fetchPublic({ repo: 'team/methoden', id: 'm 1' }, 'raci-app', fetch)).toEqual({ record });
    expect(calls[0].url).toBe('https://raw.githubusercontent.com/team/methoden/HEAD/raci-app/m%201.json');
    expect(calls[0].init.headers).toBeUndefined();
    await fetchPublic({ repo: 'team/methoden', id: 'm1', ref: SHA }, 'raci-app', fetch);
    expect(calls[1].url).toBe(publicFileUrl('team/methoden', SHA, 'raci-app', 'm1'));
  });

  it('weicht bei Störungen auf die API aus und meldet fehlende Dateien', async () => {
    const urls = [];
    const fallback = async url => { urls.push(url); return url.startsWith('https://raw.') ? reply(503, 'busy') : reply(200, record); };
    expect(await fetchPublic({ repo: 'team/methoden', id: 'm1', ref: 'main' }, 'raci-app', fallback)).toEqual({ record });
    expect(urls[1]).toBe('https://api.github.com/repos/team/methoden/contents/raci-app/m1.json?ref=main');
    const offlineRaw = async url => { if (url.startsWith('https://raw.')) throw new TypeError('blocked'); return reply(404, {}); };
    await expect(fetchPublic({ repo: 'team/methoden', id: 'm1' }, 'raci-app', offlineRaw)).rejects.toMatchObject({ message: 'share-missing' });
    await expect(fetchPublic({ repo: 'team/methoden', id: 'm1' }, 'raci-app', async () => reply(404, 'x'))).rejects.toMatchObject({ message: 'share-missing' });
    const limited = async url => (url.startsWith('https://raw.') ? reply(500, '') : reply(403, {}));
    await expect(fetchPublic({ repo: 'team/methoden', id: 'm1' }, 'raci-app', limited)).rejects.toBeInstanceOf(OfflineError);
    const broken = async url => (url.startsWith('https://raw.') ? reply(500, '') : reply(502, {}));
    await expect(fetchPublic({ repo: 'team/methoden', id: 'm1' }, 'raci-app', broken)).rejects.toBeInstanceOf(OfflineError);
    await expect(fetchPublic({ repo: 'team/methoden', id: 'm1' }, 'raci-app', async () => { throw new TypeError('offline'); })).rejects.toBeInstanceOf(OfflineError);
  });

  it('prüft Link und Inhalt', async () => {
    const ok = async () => reply(200, record);
    await expect(fetchPublic({ repo: '../x', id: 'm1' }, 'raci-app', ok)).rejects.toMatchObject({ message: 'share-id' });
    await expect(fetchPublic({ repo: 'team/..', id: 'm1' }, 'raci-app', ok)).rejects.toMatchObject({ message: 'share-id' });
    await expect(fetchPublic({ repo: 'team/methoden', id: '..' }, 'raci-app', ok)).rejects.toMatchObject({ message: 'share-id' });
    await expect(fetchPublic({ repo: 'team/methoden', id: 'a/b' }, 'raci-app', ok)).rejects.toMatchObject({ message: 'share-id' });
    await expect(fetchPublic({ repo: 'team/methoden', id: 'm1' }, 'raci-app', async () => reply(200, 'kaputt'))).rejects.toMatchObject({ message: 'share-invalid' });
    await expect(fetchPublic({ repo: 'team/methoden', id: 'm1' }, 'raci-app', async () => reply(200, '[1]'))).rejects.toMatchObject({ message: 'share-invalid' });
  });

  it('Controller liest nur Dokumente der eigenen App im passenden Format', async () => {
    const files = { m1: record, m2: { ...record, app: '5-why-app' }, m3: { ...record, schemaVersion: 9 } };
    const fetch = async url => { const id = /\/(m\d)\.json$/.exec(url)?.[1]; return id ? reply(200, files[id]) : reply(404, ''); };
    const adapter = { app: 'raci-app', schemaVersion: 1, normalize: d => ({ ...d, ok: true }) };
    const c = new SyncController({ adapter: /** @type {any} */ (adapter), storage: memoryStorage(), fetch, win: null });
    expect(await c.readPublic({ repo: 'team/methoden', id: 'm1' })).toEqual({ data: { name: 'Offen', ok: true }, savedAt: 5, device: 'Laptop' });
    await expect(c.readPublic({ repo: 'team/methoden', id: 'm2' })).rejects.toMatchObject({ message: 'share-other-app' });
    await expect(c.readPublic({ repo: 'team/methoden', id: 'm3' })).rejects.toMatchObject({ message: 'newer-schema' });
  });
});

describe('Sichtbarkeit und sofortiges Übertragen', () => {
  it('GitHub: Sichtbarkeit und Besitzer des Repos', async () => {
    const fetch = async () => reply(200, { private: false, owner: { login: 'team', type: 'Organization' } });
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', fetch });
    expect(await store.repoInfo()).toEqual({ isPrivate: false, owner: 'team', isOrganization: true });
    const bare = new GitHubStore({ repo: 'anna/ablage', token: 't', fetch: async () => reply(200, { private: true }) });
    expect(await bare.repoInfo()).toEqual({ isPrivate: true, owner: 'anna', isOrganization: false });
  });

  it('Engine fragt die Sichtbarkeit einmal und erneut nach einem Fehler', async () => {
    const store = new MemoryStore();
    let n = 0;
    const real = store.repoInfo.bind(store);
    store.repoInfo = async () => { n++; if (n === 1) throw new OfflineError('x'); return real(); };
    const a = device(store, 'A');
    await expect(a.engine.repoInfo()).rejects.toBeInstanceOf(OfflineError);
    expect(await a.engine.repoInfo()).toEqual({ isPrivate: true, owner: 'memory', isOrganization: false });
    await a.engine.repoInfo();
    expect(n).toBe(2);
    const plain = device(Object.assign(new MemoryStore(), { repoInfo: undefined }), 'B');
    expect(await plain.engine.repoInfo()).toBeNull();
  });

  it('überträgt vor dem Teilen sofort; nicht bei Konflikt oder nur im Browser', async () => {
    const store = new MemoryStore();
    const clock = { t: 1000 };
    const a = device(store, 'A', { clock });
    const b = device(store, 'B', { clock });
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    a.save('d1', { title: 'Eins', n: 2 }); // gedrosselt
    await a.engine.uploadNow('d1');
    expect((await store.get('test-app', 'd1'))?.record.data).toEqual({ title: 'Eins', n: 2 });
    await b.engine.run();
    await b.engine.download('d1');
    b.save('d1', { title: 'Eins', n: 3 });
    await b.engine.flush();
    a.save('d1', { title: 'Eins', n: 4 });
    await expect(a.engine.uploadNow('d1')).rejects.toBeInstanceOf(ConflictError);
    a.save('d2', { title: 'Zwei', n: 1 });
    a.engine.keepLocal(['d2']);
    await expect(a.engine.uploadNow('d2')).rejects.toMatchObject({ message: 'local-only' });
  });
});
