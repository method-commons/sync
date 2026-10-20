import { SyncEngine } from '../client/engine.js';

/** Einfacher Schlüssel-Wert-Speicher wie localStorage. */
export function memoryStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: k => { data.delete(k); },
    data,
  };
}

/**
 * Ein „Gerät“: Dokumente im Browser (Map) und eine Engine an der gemeinsamen Ablage.
 * Dokumente sind `{ title, n }`; `normalize` lehnt alles ohne Titel ab.
 */
export function device(store, name, { clock = { t: 1000 }, schemaVersion = 1, ...opts } = {}) {
  /** @type {Map<string, { id: string, savedAt: number, data: any }>} */
  const docs = new Map();
  let copies = 0;
  const adapter = {
    app: 'test-app',
    schemaVersion,
    list: () => [...docs.values()].map(d => structuredClone(d)),
    read: id => (docs.has(id) ? structuredClone(docs.get(id)) : null),
    write: (id, data, savedAt) => { docs.set(id, { id, savedAt, data: structuredClone(data) }); return true; },
    normalize: raw => {
      if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string') throw new Error('ungültig');
      return { title: raw.title, n: Number(raw.n) || 0 };
    },
    title: data => data.title,
    summary: data => `${data.n} Teile`,
    duplicate: (data, label) => ({ id: `${name}-kopie-${++copies}`, data: { ...data, title: `${data.title} (${label})` } }),
  };
  const engine = new SyncEngine({
    adapter, store, device: name, storage: memoryStorage(), locks: null, now: () => clock.t, timers: false, ...opts,
  });
  /** Im Browser speichern, wie es die App tut. */
  const save = (id, data) => {
    clock.t += 1000;
    docs.set(id, { id, savedAt: clock.t, data });
    engine.changed(id);
  };
  return { docs, adapter, engine, save, clock };
}
