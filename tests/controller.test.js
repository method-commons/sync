import { describe, expect, it, vi } from 'vitest';
import { CONFIG_KEY, TOKEN_KEY, loadConfig } from '../client/config.js';
import { SyncController } from '../client/controller.js';
import { META_PREFIX } from '../client/engine.js';
import { MemoryStore } from '../client/memory.js';
import { device } from './helpers.js';

/** localStorage mit `length`/`key`, wie im Browser. */
function storage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: k => { data.delete(k); },
    key: i => [...data.keys()][i] ?? null,
    get length() { return data.size; },
    data,
  };
}

/** Kleine Nachbildung der GitHub-API: nur, was `check`, `list` und `put` brauchen. */
function fakeFetch(store) {
  return async (url, init) => {
    const u = new URL(url);
    const m = u.pathname.match(/^\/repos\/team\/methoden(?:\/contents\/(.+))?$/);
    const json = (status, body) => new Response(JSON.stringify(body), { status });
    if (!m) return json(404, {});
    if (!m[1]) return json(200, { private: true });
    const path = decodeURIComponent(m[1]);
    if (init.method === 'GET') {
      if (path === 'method-commons.json') return json(200, { sha: 'm', content: '' });
      const list = await store.list(path);
      return list.length ? json(200, list.map(e => ({ type: 'file', name: `${e.id}.json`, sha: e.head }))) : json(404, {});
    }
    if (init.method === 'PUT') {
      const [app, file] = path.split('/');
      const body = JSON.parse(init.body);
      const record = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.content), c => c.charCodeAt(0))));
      const sha = await store.put(app, file.replace(/\.json$/, ''), record, body.sha ?? null, body.message);
      return json(201, { content: { sha } });
    }
    return json(405, {});
  };
}

/** Fenster-Ersatz für Ereignisse. */
function fakeWindow() {
  const win = new EventTarget();
  win.document = Object.assign(new EventTarget(), { hidden: false });
  return win;
}

function setup() {
  const store = new MemoryStore();
  const s = storage();
  const dev = device(store, 'A');
  const win = fakeWindow();
  const ctl = new SyncController({ adapter: dev.adapter, storage: s, fetch: fakeFetch(store), engine: { locks: null, timers: false }, win });
  return { store, s, dev, ctl, win };
}

describe('SyncController', () => {
  it('startet ohne Einstellungen nicht', () => {
    const { ctl } = setup();
    expect(ctl.start()).toBe(false);
    expect(ctl.state).toEqual({ config: null, sync: null });
    ctl.changed('x');
    ctl.removed('x');
  });

  it('prüft, verbindet und lädt nur die gewählten Dokumente hoch', async () => {
    const { ctl, dev, store, s } = setup();
    dev.docs.set('d1', { id: 'd1', savedAt: 10, data: { title: 'Eins', n: 1 } });
    dev.docs.set('d2', { id: 'd2', savedAt: 10, data: { title: 'Zwei', n: 2 } });
    expect(await ctl.check({ repo: ' team/methoden ', token: ' tok ' })).toMatchObject({ name: 'team/methoden', isPrivate: true, created: false });
    const states = [];
    ctl.subscribe(st => states.push(st));
    await ctl.connect({ repo: 'team/methoden', token: 'tok', device: 'Laptop', branch: 'daten' }, ['d1']);
    expect(loadConfig(s)?.config).toMatchObject({ kind: 'github', repo: 'team/methoden', branch: 'daten', device: 'Laptop' });
    expect(s.getItem(TOKEN_KEY)).toBe('tok');
    expect([...store.files.keys()]).toEqual(['test-app/d1.json']);
    expect(ctl.state.sync?.docs).toEqual({ d1: 'ok', d2: 'local' });
    expect(states.at(-1)?.config?.device).toBe('Laptop');
    expect(ctl.countsByApp()).toEqual({ 'test-app': 1 });
  });

  it('ändert Gerätename und Token, trennt und löscht alle Merklisten', async () => {
    const { ctl, s } = setup();
    await ctl.connect({ repo: 'team/methoden', token: 'tok' }, []);
    expect(ctl.state.config?.device).toBe('Browser');
    ctl.setDevice('  Büro  ');
    expect(loadConfig(s)?.config.device).toBe('Büro');
    expect(ctl.engine?.device).toBe('Büro');
    ctl.renewToken('neu', '2027-01-18T10:00:00.000Z');
    expect(loadConfig(s)).toMatchObject({ token: 'neu', config: { expiresAt: '2027-01-18T10:00:00.000Z' } });
    s.setItem(`${META_PREFIX}andere-app`, '{"x":{"head":"h","savedAt":1}}');
    ctl.disconnect();
    expect([s.getItem(CONFIG_KEY), s.getItem(`${META_PREFIX}andere-app`)]).toEqual([null, null]);
    expect(ctl.state).toEqual({ config: null, sync: null });
    ctl.setDevice('egal');
    ctl.renewToken('egal');
  });

  it('folgt Änderungen anderer Tabs und gleicht bei Ereignissen des Fensters ab', async () => {
    const { ctl, s, win, dev } = setup();
    await ctl.connect({ repo: 'team/methoden', token: 'tok' }, []);
    const run = vi.spyOn(ctl.engine, 'run');
    const flush = vi.spyOn(ctl.engine, 'flush');
    win.dispatchEvent(new Event('online'));
    win.document.hidden = true;
    win.document.dispatchEvent(new Event('visibilitychange'));
    win.document.hidden = false;
    win.document.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('pagehide'));
    expect(flush).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(4); // zwei direkt, zwei über flush

    // anderer Tab: Merkliste geändert → Zustände neu
    dev.docs.set('d9', { id: 'd9', savedAt: 5, data: { title: 'Neun', n: 9 } });
    win.dispatchEvent(Object.assign(new Event('storage'), { key: `${META_PREFIX}test-app` }));
    expect(ctl.state.sync?.docs.d9).toBe('pending');

    // anderer Tab trennt bzw. richtet wieder ein
    const config = s.getItem(CONFIG_KEY);
    s.removeItem(CONFIG_KEY);
    win.dispatchEvent(Object.assign(new Event('storage'), { key: CONFIG_KEY }));
    expect(ctl.engine).toBeNull();
    s.setItem(CONFIG_KEY, config);
    win.dispatchEvent(Object.assign(new Event('storage'), { key: CONFIG_KEY }));
    expect(ctl.engine).not.toBeNull();
    ctl.dispose();
  });

  it('meldet Übernahmen aus der Ablage an die App weiter', async () => {
    const { ctl } = setup();
    await ctl.connect({ repo: 'team/methoden', token: 'tok' }, []);
    const seen = vi.fn();
    const off = ctl.onRemoteChange(seen);
    for (const fn of ctl.engine.remoteListeners) fn('neu');
    off();
    for (const fn of ctl.engine.remoteListeners) fn('noch eins');
    expect(seen.mock.calls).toEqual([['neu']]);
  });
});
