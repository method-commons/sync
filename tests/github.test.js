import { describe, expect, it } from 'vitest';
import { GitHubStore, MARKER, decodeBase64, encodeBase64, parseExpiry } from '../client/github.js';
import { AuthError, ConflictError, OfflineError, SetupError } from '../client/store.js';

/**
 * Nachbildung der Contents-API für ein Repo: Dateien mit `sha`, Ändern nur mit passendem `sha`.
 * Zeichnet alle Anfragen auf.
 */
function fakeGitHub({ isPrivate = true, headers = {} } = {}) {
  const files = new Map();
  const calls = [];
  let n = 0;
  const reply = (status, body, extra = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { ...headers, ...extra } });
  const fetch = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: u.pathname, search: u.search, body, auth: init.headers.Authorization });
    if (u.pathname === '/repos/team/methoden') return reply(200, { full_name: 'team/methoden', private: isPrivate });
    const m = u.pathname.match(/^\/repos\/team\/methoden\/contents\/(.+)$/);
    if (!m) return reply(404, { message: 'Not Found' });
    const path = decodeURIComponent(m[1]);
    if (init.method === 'GET') {
      if (files.has(path)) return reply(200, { type: 'file', sha: files.get(path).sha, content: files.get(path).content.replace(/(.{60})/g, '$1\n') });
      const dir = [...files].filter(([p]) => p.startsWith(`${path}/`)).map(([p, f]) => ({ type: 'file', name: p.slice(path.length + 1), sha: f.sha }));
      return dir.length ? reply(200, [...dir, { type: 'dir', name: 'unterordner', sha: 'x' }]) : reply(404, { message: 'Not Found' });
    }
    const cur = files.get(path);
    if (init.method === 'PUT') {
      if (cur && !body.sha) return reply(422, { message: '"sha" wasn\'t supplied.' });
      if (cur && body.sha !== cur.sha) return reply(409, { message: 'does not match' });
      const sha = `sha${++n}`;
      files.set(path, { sha, content: body.content });
      return reply(cur ? 200 : 201, { content: { sha } });
    }
    if (init.method === 'DELETE') {
      if (!cur) return reply(404, { message: 'Not Found' });
      if (body.sha !== cur.sha) return reply(409, { message: 'does not match' });
      files.delete(path);
      return reply(200, { commit: {} });
    }
    return reply(405, null);
  };
  return { fetch, files, calls };
}

const record = (n = 1) => ({ app: 'raci-app', schemaVersion: 1, savedAt: 5, device: 'Chrome · Linux', data: { title: 'Ümlaut ✓', n } });

describe('GitHubStore', () => {
  it('prüft das Repo und legt beim ersten Mal die Kennzeichnung an', async () => {
    const gh = fakeGitHub({ headers: { 'github-authentication-token-expiration': '2027-01-18 10:00:00 UTC' } });
    const store = new GitHubStore({ repo: 'team/methoden', token: 'tok', fetch: gh.fetch });
    expect(await store.check()).toEqual({ name: 'team/methoden', isPrivate: true, created: true, expiresAt: '2027-01-18T10:00:00.000Z' });
    expect(JSON.parse(decodeBase64(gh.files.get(MARKER).content))).toEqual({ kind: 'method-commons-storage', version: 1 });
    expect(gh.calls[0].auth).toBe('Bearer tok');
    expect((await store.check()).created).toBe(false);
  });

  it('speichert, listet, liest und löscht Dokumente mit sha', async () => {
    const gh = fakeGitHub();
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', fetch: gh.fetch });
    expect(await store.list('raci-app')).toEqual([]);
    expect(await store.get('raci-app', 'x')).toBeNull();
    const h1 = await store.put('raci-app', 'm1', record(1), null, 'Neu');
    expect(gh.calls.at(-1)).toMatchObject({ method: 'PUT', path: '/repos/team/methoden/contents/raci-app/m1.json', body: { message: 'Neu' } });
    expect(decodeBase64(gh.files.get('raci-app/m1.json').content)).toContain('\n  "app": "raci-app"');
    expect(await store.list('raci-app')).toEqual([{ id: 'm1', head: h1 }]);
    expect(await store.get('raci-app', 'm1')).toEqual({ record: record(1), head: h1 });
    const h2 = await store.put('raci-app', 'm1', record(2), h1, 'Zwei');
    await expect(store.put('raci-app', 'm1', record(3), h1, 'alt')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.put('raci-app', 'm1', record(3), null, 'ohne sha')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.remove('raci-app', 'm1', h1, 'alt')).rejects.toBeInstanceOf(ConflictError);
    await store.remove('raci-app', 'm1', h2, 'weg');
    await store.remove('raci-app', 'm1', h2, 'schon weg');
    expect(gh.files.has('raci-app/m1.json')).toBe(false);
  });

  it('liest und schreibt auf einem gewählten Branch', async () => {
    const gh = fakeGitHub();
    const store = new GitHubStore({ repo: 'team/methoden', token: 't', branch: 'daten', fetch: gh.fetch });
    await store.put('raci-app', 'm1', record(), null, 'x');
    await store.list('raci-app');
    expect(gh.calls[0].body.branch).toBe('daten');
    expect(gh.calls[1].search).toBe('?ref=daten');
  });

  it('bildet Fehler der API auf die Fehlerarten ab', async () => {
    const respond = (status, headers = {}) => new GitHubStore({ repo: 'team/methoden', token: 't', fetch: async () => new Response('{}', { status, headers }) });
    await expect(respond(401).list('a')).rejects.toBeInstanceOf(AuthError);
    await expect(respond(403).list('a')).rejects.toBeInstanceOf(AuthError);
    await expect(respond(403, { 'x-ratelimit-remaining': '0' }).list('a')).rejects.toBeInstanceOf(OfflineError);
    await expect(respond(429).list('a')).rejects.toBeInstanceOf(OfflineError);
    await expect(respond(502).list('a')).rejects.toBeInstanceOf(OfflineError);
    await expect(respond(404).check()).rejects.toBeInstanceOf(SetupError);
    await expect(respond(400).list('a')).rejects.toBeInstanceOf(SetupError);
    const offline = new GitHubStore({ repo: 'team/methoden', token: 't', fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(offline.list('a')).rejects.toBeInstanceOf(OfflineError);
    expect(() => new GitHubStore({ repo: 'kein repo', token: 't', fetch: async () => new Response() })).toThrow(SetupError);
  });
});

describe('Hilfen', () => {
  it('kodiert UTF-8 als Base64 und zurück', () => {
    const text = `Größe ✓ ${'x'.repeat(70000)}`;
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('liest das Ablaufdatum des Tokens', () => {
    expect(parseExpiry('2027-01-18 10:00:00 UTC')).toBe('2027-01-18T10:00:00.000Z');
    expect(parseExpiry('2027-01-18 10:00:00 +0100')).toBe('2027-01-18T09:00:00.000Z');
    expect(parseExpiry('irgendwann')).toBeNull();
    expect(parseExpiry(null)).toBeNull();
  });
});
