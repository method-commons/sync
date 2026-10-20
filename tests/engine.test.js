import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../client/memory.js';
import { AuthError, OfflineError, SetupError } from '../client/store.js';
import { device } from './helpers.js';

const MIN = 60_000;

/** Zwei Geräte an einer Ablage, gemeinsame Uhr. */
function setup() {
  const store = new MemoryStore();
  const clock = { t: 1000 };
  return { store, clock, a: device(store, 'A', { clock }), b: device(store, 'B', { clock }) };
}

describe('SyncEngine', () => {
  it('überträgt neue Dokumente sofort mit Gerät und Schema', async () => {
    const { store, a } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    const got = await store.get('test-app', 'd1');
    expect(got?.record).toMatchObject({ app: 'test-app', schemaVersion: 1, device: 'A', data: { title: 'Eins', n: 1 } });
    expect(store.log.map(l => l.message)).toEqual(['Eins (A)']);
    expect(a.engine.state.status).toBe('ok');
    expect(a.engine.state.docs).toEqual({ d1: 'ok' });
  });

  it('drosselt weitere Übertragungen auf eine je Intervall, außer bei flush', async () => {
    const { store, a, clock } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    a.save('d1', { title: 'Eins', n: 2 });
    expect(a.engine.state.docs.d1).toBe('pending');
    await a.engine.run();
    expect(store.log).toHaveLength(1);
    expect(a.engine.state.status).toBe('pending');
    clock.t += 5 * MIN;
    await a.engine.run();
    expect(store.log).toHaveLength(2);
    a.save('d1', { title: 'Eins', n: 3 });
    await a.engine.flush();
    expect(store.log).toHaveLength(3);
    expect((await store.get('test-app', 'd1'))?.record.data).toEqual({ title: 'Eins', n: 3 });
  });

  it('übernimmt Änderungen eines anderen Geräts und meldet sie der App', async () => {
    const { a, b } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    await b.engine.run();
    expect(b.engine.state.remoteOnly.map(d => [d.id, d.title, d.summary, d.device])).toEqual([['d1', 'Eins', '1 Teile', 'A']]);
    expect(await b.engine.download('d1')).toBe(true);
    expect(b.docs.get('d1')?.data).toEqual({ title: 'Eins', n: 1 });
    expect(b.engine.state.remoteOnly).toEqual([]);

    b.save('d1', { title: 'Eins', n: 5 });
    await b.engine.run();
    const seen = vi.fn();
    a.engine.onRemoteChange(seen);
    await a.engine.run();
    expect(a.docs.get('d1')?.data).toEqual({ title: 'Eins', n: 5 });
    expect(seen).toHaveBeenCalledWith('d1');
    expect(a.engine.state.docs.d1).toBe('ok');
  });

  describe('Konflikte', () => {
    async function conflict() {
      const s = setup();
      s.a.save('d1', { title: 'Eins', n: 1 });
      await s.a.engine.run();
      await s.b.engine.run();
      await s.b.engine.download('d1');
      s.b.save('d1', { title: 'Eins', n: 2 });
      await s.b.engine.run();
      s.a.save('d1', { title: 'Eins', n: 3 });
      await s.a.engine.run();
      return s;
    }

    it('erkennt beidseitige Änderungen und überträgt dann nicht', async () => {
      const { a, store } = await conflict();
      expect(a.engine.state.status).toBe('conflict');
      expect(a.engine.state.conflicts).toEqual(['d1']);
      expect((await store.get('test-app', 'd1'))?.record.data.n).toBe(2);
      const info = await a.engine.conflictInfo('d1');
      expect(info.local).toMatchObject({ device: 'A', summary: '3 Teile' });
      expect(info.remote).toMatchObject({ device: 'B', summary: '2 Teile' });
      expect(info.base).toBeGreaterThan(0);
      await a.engine.flush();
      expect((await store.get('test-app', 'd1'))?.record.data.n).toBe(2);
    });

    it('„Meine behalten“ überträgt den eigenen Stand', async () => {
      const { a, store } = await conflict();
      await a.engine.resolve('d1', 'mine');
      expect((await store.get('test-app', 'd1'))?.record.data.n).toBe(3);
      expect(a.engine.state.status).toBe('ok');
    });

    it('„Ablage übernehmen“ ersetzt den Stand im Browser', async () => {
      const { a } = await conflict();
      const seen = vi.fn();
      a.engine.onRemoteChange(seen);
      await a.engine.resolve('d1', 'theirs');
      expect(a.docs.get('d1')?.data.n).toBe(2);
      expect(seen).toHaveBeenCalledWith('d1');
      expect(a.engine.state.docs.d1).toBe('ok');
    });

    it('„Beide behalten“ legt den Stand der Ablage als Kopie an', async () => {
      const { a, store } = await conflict();
      const copy = await a.engine.resolve('d1', 'both');
      expect(copy).toBe('A-kopie-1');
      expect(a.docs.get('A-kopie-1')?.data).toEqual({ title: 'Eins (B)', n: 2 });
      expect((await store.get('test-app', 'd1'))?.record.data.n).toBe(3);
      expect((await store.get('test-app', 'A-kopie-1'))?.record.data.n).toBe(2);
      expect(a.engine.state.docs).toEqual({ d1: 'ok', 'A-kopie-1': 'ok' });
    });

    it('meldet gleiche IDs auf beiden Seiten als Konflikt', async () => {
      const { a, b } = setup();
      a.save('d1', { title: 'A', n: 1 });
      await a.engine.run();
      b.save('d1', { title: 'B', n: 1 });
      await b.engine.run();
      expect(b.engine.state.conflicts).toEqual(['d1']);
    });

    it('erkennt einen Konflikt auch erst beim Übertragen', async () => {
      const { a, store } = setup();
      a.save('d1', { title: 'Eins', n: 1 });
      await a.engine.run();
      // zwischen Liste und Übertragung ändert ein anderes Gerät die Datei
      const list = store.list.bind(store);
      store.list = async app => {
        const l = await list(app);
        const cur = await store.get('test-app', 'd1');
        await store.put('test-app', 'd1', { ...cur.record, device: 'B' }, cur.head, 'B');
        return l;
      };
      a.save('d1', { title: 'Eins', n: 2 });
      await a.engine.flush();
      expect(a.engine.state.conflicts).toEqual(['d1']);
    });
  });

  it('lässt bewusst lokale Dokumente im Browser und lädt sie auf Wunsch hoch', async () => {
    const { a, store } = setup();
    a.docs.set('d1', { id: 'd1', savedAt: 500, data: { title: 'Lokal', n: 0 } });
    a.engine.keepLocal(['d1']);
    expect(a.engine.state.docs.d1).toBe('local');
    await a.engine.run();
    expect(store.files.size).toBe(0);
    await a.engine.upload(['d1']);
    expect(store.files.size).toBe(1);
    expect(a.engine.state.docs.d1).toBe('ok');
  });

  it('löscht in der Ablage nur, was im Browser gelöscht wurde und dort unverändert ist', async () => {
    const { a, b, store } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    a.save('d2', { title: 'Zwei', n: 1 });
    await a.engine.run();
    a.docs.delete('d1');
    a.engine.removed('d1');
    await a.engine.run();
    expect(await store.get('test-app', 'd1')).toBeNull();
    expect(store.log.at(-1)?.message).toBe('Eins entfernt (A)');

    // d2 wird auf B geändert, bevor A die Löschung überträgt → bleibt in der Ablage
    await b.engine.run();
    await b.engine.download('d2');
    b.save('d2', { title: 'Zwei', n: 2 });
    await b.engine.run();
    a.docs.delete('d2');
    a.engine.removed('d2');
    await a.engine.run();
    expect((await store.get('test-app', 'd2'))?.record.data.n).toBe(2);
    expect(a.engine.state.remoteOnly.map(d => d.id)).toEqual(['d2']);
    a.engine.removed('gibt-es-nicht');
  });

  it('behält ein anderswo gelöschtes Dokument im Browser', async () => {
    const { a, b, store } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    await b.engine.run();
    await b.engine.download('d1');
    b.docs.delete('d1');
    b.engine.removed('d1');
    await b.engine.run();
    await a.engine.run();
    expect(a.docs.has('d1')).toBe(true);
    expect(a.engine.state.docs.d1).toBe('local');
    expect(store.files.size).toBe(0);
  });

  it('holt ein im Browser verschwundenes Dokument aus der Ablage zurück', async () => {
    const { a } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    await a.engine.run();
    a.docs.delete('d1'); // z. B. Speicher geleert, ohne removed()
    await a.engine.run();
    expect(a.docs.get('d1')?.data.title).toBe('Eins');
  });

  it('übernimmt keine Stände mit neuerem Datenformat oder ungültigen Daten', async () => {
    const store = new MemoryStore();
    const clock = { t: 1000 };
    const neu = device(store, 'Neu', { clock, schemaVersion: 2 });
    const alt = device(store, 'Alt', { clock, schemaVersion: 1 });
    neu.save('d1', { title: 'Eins', n: 1 });
    await neu.engine.run();
    await alt.engine.run();
    expect(await alt.engine.download('d1')).toBe(false);
    await store.put('test-app', 'kaputt', { app: 'test-app', schemaVersion: 1, savedAt: 1, device: 'X', data: {} }, null, 'x');
    expect(await alt.engine.download('kaputt')).toBe(false);
    await alt.engine.run();
    expect(alt.engine.state.remoteOnly.map(d => d.title).sort()).toEqual(['Eins', 'kaputt']);
  });

  it('meldet fehlenden Zugang, Netz und Einrichtungsfehler', async () => {
    const { a, store } = setup();
    a.save('d1', { title: 'Eins', n: 1 });
    store.list = async () => { throw new OfflineError(); };
    await a.engine.run();
    expect(a.engine.state).toMatchObject({ status: 'offline', error: 'offline' });
    store.list = async () => { throw new AuthError(); };
    await a.engine.run();
    expect(a.engine.state).toMatchObject({ status: 'auth', error: 'auth' });
    store.list = async () => { throw new SetupError('Not Found'); };
    await a.engine.run();
    expect(a.engine.state).toMatchObject({ status: 'error', error: 'Not Found' });
    delete store.list;
    await a.engine.run();
    expect(a.engine.state).toMatchObject({ status: 'ok', error: null });
  });

  it('gleicht unter einer Web-Sperre ab und bündelt gleichzeitige Aufrufe', async () => {
    const store = new MemoryStore();
    const request = vi.fn((name, cb) => cb());
    const a = device(store, 'A', { locks: { request } });
    a.save('d1', { title: 'Eins', n: 1 });
    await Promise.all([a.engine.run(), a.engine.run(), a.engine.flush()]);
    expect(request).toHaveBeenCalledWith('method-commons:sync:test-app', expect.any(Function));
    expect(request).toHaveBeenCalledTimes(2);
    expect(store.log).toHaveLength(1);
  });

  it('benachrichtigt Abonnenten und plant den nächsten Abgleich', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryStore();
      const a = device(store, 'A', { timers: true, now: () => Date.now(), delay: 3000 });
      const states = [];
      const off = a.engine.subscribe(s => states.push(s.status));
      a.docs.set('d1', { id: 'd1', savedAt: Date.now() + 1, data: { title: 'Eins', n: 1 } });
      a.engine.changed('d1');
      expect(store.files.size).toBe(0);
      await vi.advanceTimersByTimeAsync(3000);
      expect(store.files.size).toBe(1);
      expect(states).toContain('busy');
      expect(states.at(-1)).toBe('ok');
      off();
      a.engine.stop();
      await a.engine.run();
    } finally {
      vi.useRealTimers();
    }
  });
});
