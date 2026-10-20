import { describe, expect, it } from 'vitest';
import { deviceOf } from '../client/engine.js';
import { GitHubStore, encodeBase64 } from '../client/github.js';
import { MemoryStore } from '../client/memory.js';
import { ConflictError, SetupError, VERSIONS_PAGE, versionSlug } from '../client/store.js';
import { device } from './helpers.js';

const MIN = 60_000;

function setup() {
  const store = new MemoryStore();
  const clock = { t: Date.UTC(2026, 9, 20, 10, 0) };
  store.now = () => clock.t;
  return { store, clock, a: device(store, 'A', { clock }), b: device(store, 'B', { clock }) };
}

describe('Versionen in der Engine', () => {
  it('listet übertragene Stände, neueste zuerst, mit Gerät und aktuellem Stand', async () => {
    const { a, b, clock } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    await b.engine.run();
    await b.engine.download('d1');
    b.save('d1', { title: 'Eins', n: 2 });
    await b.engine.flush();
    clock.t += MIN;
    const { items, more } = await a.engine.versions('d1');
    expect(more).toBe(false);
    expect(items.map(v => [v.device, !!v.current])).toEqual([['B', true], ['A', false]]);
    expect(await a.engine.versionInfo('d1', items[1].sha)).toMatchObject({ device: 'A', title: 'Eins', summary: '1 Teile' });
  });

  it('„Stand speichern“ überträgt sofort, auch innerhalb des Intervalls, und benennt den Stand', async () => {
    const { store, a } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    a.save('d1', { title: 'Eins', n: 2 });
    await a.engine.run();
    expect(store.log).toHaveLength(1); // gedrosselt
    const tag = await a.engine.saveVersion('d1', ' vor Workshop ', 'Stand für die Runde am Freitag');
    expect(store.log).toHaveLength(2);
    expect(tag).toMatchObject({ ref: 'test-app/d1/2026-10-20-vor-workshop', name: 'vor Workshop', note: 'Stand für die Runde am Freitag' });
    expect(a.engine.state.docs.d1).toBe('ok');
    const { items, named } = await a.engine.versions('d1');
    expect(items[0]).toMatchObject({ current: true, name: 'vor Workshop' });
    expect(named.map(v => v.name)).toEqual(['vor Workshop']);
    // gleicher Name am selben Tag: eigener Tag
    expect((await a.engine.saveVersion('d1', 'vor Workshop')).ref).toBe('test-app/d1/2026-10-20-vor-workshop-2');
  });

  it('benennt nicht bei offenem Konflikt oder nur im Browser', async () => {
    const { a, b } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    await b.engine.run();
    await b.engine.download('d1');
    b.save('d1', { title: 'Eins', n: 2 });
    await b.engine.flush();
    a.save('d1', { title: 'Eins', n: 3 });
    await expect(a.engine.saveVersion('d1', 'x')).rejects.toBeInstanceOf(ConflictError);
    a.save('d2', { title: 'Zwei', n: 1 });
    a.engine.keepLocal(['d2']);
    await expect(a.engine.saveVersion('d2', 'x')).rejects.toBeInstanceOf(SetupError);
  });

  it('stellt einen früheren Stand als neuen Stand wieder her; der bisherige bleibt erhalten', async () => {
    const { store, a, clock } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    const first = (await a.engine.versions('d1')).items[0].sha;
    a.save('d1', { title: 'Eins', n: 2 });
    await a.engine.flush();
    clock.t += MIN;
    expect(await a.engine.restore('d1', first)).toBe(true);
    expect(a.docs.get('d1')?.data).toEqual({ title: 'Eins', n: 1 });
    expect((await store.get('test-app', 'd1'))?.record.data).toEqual({ title: 'Eins', n: 1 });
    const { items } = await a.engine.versions('d1');
    expect(items).toHaveLength(3);
    expect((await a.engine.versionData('d1', items[1].sha)).data).toEqual({ title: 'Eins', n: 2 });
  });

  it('meldet, wenn die App das Wiederherstellen ablehnt', async () => {
    const { a } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    const sha = (await a.engine.versions('d1')).items[0].sha;
    a.adapter.write = () => false;
    expect(await a.engine.restore('d1', sha)).toBe(false);
  });

  it('öffnet einen früheren Stand als Kopie', async () => {
    const { store, a } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    const sha = (await a.engine.versions('d1')).items[0].sha;
    a.save('d1', { title: 'Eins', n: 2 });
    const id = await a.engine.copyVersion('d1', sha, 'Stand vom 20.10.');
    expect(a.docs.get(id)?.data).toEqual({ title: 'Eins (Stand vom 20.10.)', n: 1 });
    expect((await store.get('test-app', id))?.record.data).toEqual({ title: 'Eins (Stand vom 20.10.)', n: 1 });
  });

  it('lehnt fehlende, unlesbare und neuere Stände ab', async () => {
    const { store, a } = setup();
    await expect(a.engine.versionData('d1', 'nix')).rejects.toBeInstanceOf(SetupError);
    expect(await a.engine.versionInfo('d1', 'nix')).toBeNull();
    await store.put('test-app', 'd9', { app: 'test-app', schemaVersion: 2, savedAt: 1, device: 'X', data: { title: 'Neu' } }, null, 'Neu (X)');
    await store.put('test-app', 'd8', { app: 'test-app', schemaVersion: 1, savedAt: 1, device: 'X', data: 'kaputt' }, null, 'kaputt (X)');
    const newer = (await store.versions('test-app', 'd9')).items[0].sha;
    const broken = (await store.versions('test-app', 'd8')).items[0].sha;
    await expect(a.engine.versionData('d9', newer)).rejects.toMatchObject({ message: 'newer-schema' });
    expect(await a.engine.versionInfo('d8', broken)).toMatchObject({ title: 'd8', summary: '' });
  });

  it('teilt lange Verläufe in Seiten', async () => {
    const { store, a } = setup();
    for (let i = 0; i <= VERSIONS_PAGE; i++) await store.put('test-app', 'd1', { app: 'test-app', schemaVersion: 1, savedAt: i, device: 'A', data: { title: 'x', n: i } }, (await store.get('test-app', 'd1'))?.head ?? null, `x (A)`);
    const p1 = await a.engine.versions('d1');
    const p2 = await a.engine.versions('d1', 2);
    expect([p1.items.length, p1.more, p2.items.length, p2.more, !!p2.items[0].current]).toEqual([VERSIONS_PAGE, true, 1, false, false]);
  });
});

describe('Hilfen der Versionen', () => {
  it('liest das Gerät aus der Commit-Nachricht', () => {
    expect(deviceOf('Kaffeemaschine (Prototyp) (Chrome · Linux)')).toBe('Chrome · Linux');
    expect(deviceOf('Ohne Gerät')).toBe('');
    expect(deviceOf('Titel (Laptop)\n\nmehr')).toBe('Laptop');
  });

  it('bildet Tag-Namen aus Datum und Name', () => {
    const d = Date.UTC(2026, 9, 14, 16, 5);
    expect(versionSlug('Vor Workshop – Größe!', d)).toBe('2026-10-14-vor-workshop-groesse');
    expect(versionSlug('Café', d)).toBe('2026-10-14-cafe');
    expect(versionSlug('???', d)).toBe('2026-10-14');
  });
});

/** Nachbildung der Commits- und Tag-API für eine Datei. */
function fakeGitHub() {
  const calls = [];
  const refs = new Map();
  const tags = new Map();
  let n = 0;
  const reply = (status, body) => new Response(JSON.stringify(body), { status });
  const commits = [
    { sha: 'c2', commit: { message: 'Eins (Laptop)', committer: { date: '2026-10-20T10:42:00Z' } } },
    { sha: 'c1', commit: { message: 'Eins (Chrome · Linux)', author: { date: '2026-10-14T16:05:00Z' } } },
  ];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: decodeURIComponent(u.pathname), search: decodeURIComponent(u.search), body });
    const p = decodeURIComponent(u.pathname).replace('/repos/team/methoden', '');
    if (p === '/commits') return reply(200, commits);
    if (p.startsWith('/git/matching-refs/tags/')) {
      const prefix = p.slice('/git/matching-refs/'.length);
      return reply(200, [...refs].filter(([r]) => r.startsWith(`refs/${prefix}`)).map(([ref, object]) => ({ ref, object })));
    }
    if (p === '/git/tags' && init.method === 'POST') {
      const sha = `t${++n}`;
      tags.set(sha, { sha, message: `${body.message}\n`, object: { sha: body.object }, tagger: { date: '2026-10-20T10:43:00Z' } });
      return reply(201, { sha });
    }
    if (p.startsWith('/git/tags/')) return tags.has(p.slice(10)) ? reply(200, tags.get(p.slice(10))) : reply(404, {});
    if (p === '/git/refs' && init.method === 'POST') {
      if (refs.has(body.ref)) return reply(422, { message: 'Reference already exists' });
      refs.set(body.ref, { type: 'tag', sha: body.sha });
      return reply(201, {});
    }
    if (p === '/contents/raci-app/m1.json') {
      const ref = u.searchParams.get('ref');
      if (ref !== 'c1') return reply(404, {});
      return reply(200, { sha: 'f1', content: encodeBase64(JSON.stringify({ app: 'raci-app', schemaVersion: 1, savedAt: 5, device: 'Laptop', data: { n: 1 } })) });
    }
    return reply(404, { message: 'Not Found' });
  };
  return { fetch, calls, refs };
}

describe('GitHubStore – Versionen', () => {
  it('listet Commits der Datei auf dem Branch', async () => {
    const gh = fakeGitHub();
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', branch: 'daten', fetch: gh.fetch });
    const { items, more } = await store.versions('raci-app', 'm1', 2);
    expect(gh.calls[0].search).toBe('?path=raci-app/m1.json&per_page=30&page=2&sha=daten');
    expect(items).toEqual([
      { sha: 'c2', date: Date.parse('2026-10-20T10:42:00Z'), message: 'Eins (Laptop)' },
      { sha: 'c1', date: Date.parse('2026-10-14T16:05:00Z'), message: 'Eins (Chrome · Linux)' },
    ]);
    expect(more).toBe(false);
  });

  it('liest einen früheren Stand', async () => {
    const gh = fakeGitHub();
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', fetch: gh.fetch });
    expect(await store.getVersion('raci-app', 'm1', 'c1')).toMatchObject({ device: 'Laptop', data: { n: 1 } });
    expect(await store.getVersion('raci-app', 'm1', 'c9')).toBeNull();
  });

  it('benennt Stände als annotierte Tags und liest sie mit Notiz zurück', async () => {
    const gh = fakeGitHub();
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', fetch: gh.fetch });
    const date = Date.parse('2026-10-20T10:43:00Z');
    expect(await store.saveVersion('raci-app', 'm1', { sha: 'c2', name: 'vor Workshop', note: ' Für Freitag ', date }))
      .toEqual({ sha: 'c2', ref: 'raci-app/m1/2026-10-20-vor-workshop', name: 'vor Workshop', note: 'Für Freitag', date });
    expect(gh.calls[0].body).toEqual({ tag: 'raci-app/m1/2026-10-20-vor-workshop', message: 'vor Workshop\n\nFür Freitag', object: 'c2', type: 'commit' });
    // gleicher Name: Zahl anhängen
    expect((await store.saveVersion('raci-app', 'm1', { sha: 'c1', name: 'vor Workshop', date })).ref).toBe('raci-app/m1/2026-10-20-vor-workshop-2');
    gh.refs.set('refs/tags/raci-app/m1/leicht', { type: 'commit', sha: 'c1' });
    gh.refs.set('refs/tags/raci-app/m10/fremd', { type: 'commit', sha: 'c1' });
    const named = await store.namedVersions('raci-app', 'm1');
    expect(named.map(t => [t.name, t.note, t.sha])).toEqual([
      ['vor Workshop', 'Für Freitag', 'c2'], ['vor Workshop', '', 'c1'], ['leicht', '', 'c1'],
    ]);
  });

  it('gibt nach fünf vergebenen Namen auf', async () => {
    const gh = fakeGitHub();
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', fetch: gh.fetch });
    const date = Date.parse('2026-10-20T10:43:00Z');
    for (let i = 0; i < 5; i++) await store.saveVersion('raci-app', 'm1', { sha: 'c2', name: 'x', date });
    await expect(store.saveVersion('raci-app', 'm1', { sha: 'c2', name: 'x', date })).rejects.toBeInstanceOf(ConflictError);
  });
});
