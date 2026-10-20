/*
 * Sync-Engine: gleicht die Dokumente einer App im Browser mit einer Ablage ab.
 *
 * Lokal zuerst: Die App speichert wie bisher im Browser und meldet nur `changed(id)`. Die Engine
 * merkt sich je Dokument den zuletzt abgeglichenen Stand (`head` in der Ablage, `savedAt` im
 * Browser) und entscheidet daraus:
 *   - nur im Browser geändert  → übertragen (höchstens alle `interval` ms je Dokument),
 *   - nur in der Ablage geändert → in den Browser übernehmen,
 *   - auf beiden Seiten geändert → Konflikt; entscheidet die Person (`resolve`).
 * Die Merkliste liegt im localStorage und wird von allen Tabs der App geteilt; ein Abgleich läuft
 * unter einer Web-Sperre, damit nie zwei Tabs gleichzeitig übertragen.
 */
import { AuthError, ConflictError, OfflineError } from './store.js';

/** @typedef {import('./store.js').RemoteStore} RemoteStore */
/** @typedef {import('./store.js').StoredRecord} StoredRecord */
/** @typedef {import('./config.js').KeyValue} KeyValue */

/**
 * @typedef {object} LocalDoc Dokument im Browser, wie es die Speicherschicht der App liefert
 * @property {string} id
 * @property {number} savedAt
 * @property {unknown} data
 */

/**
 * @typedef {object} AppAdapter Was jede App liefert
 * @property {string} app Kennung = Name des App-Repos, zugleich Ordner in der Ablage
 * @property {number} schemaVersion
 * @property {() => LocalDoc[]} list
 * @property {(id: string) => LocalDoc | null} read
 * @property {(id: string, data: unknown, savedAt: number) => boolean} write
 * @property {(raw: unknown) => unknown} normalize Prüfung der App; wirft bei ungültigen Daten
 * @property {(data: unknown) => string} title
 * @property {(data: unknown) => string} [summary] kurze Kennzahlen, z. B. „6 Parameter · 3 Konzepte“
 * @property {(data: unknown, label: string) => { id: string, data: unknown }} duplicate Kopie mit neuer ID (für „Beide behalten“)
 */

/**
 * @typedef {object} DocMeta Zuletzt abgeglichener Stand eines Dokuments
 * @property {string | null} [head] Stand in der Ablage; null = noch nie übertragen
 * @property {number} savedAt `savedAt` des Browser-Stands beim letzten Abgleich
 * @property {string} [hash] Fingerabdruck des Inhalts beim letzten Abgleich (gleicher Inhalt = nicht geändert)
 * @property {number} [pushedAt] letzte Übertragung (für die Drosselung)
 * @property {string} [title]
 * @property {boolean} [localOnly] bewusst nur im Browser
 * @property {boolean} [deleted] im Browser gelöscht, in der Ablage noch zu löschen
 * @property {string | null} [conflict] Stand in der Ablage, der mit dem Browser-Stand kollidiert
 */

/** @typedef {'ok' | 'pending' | 'busy' | 'local' | 'conflict' | 'newer'} DocState */
/** @typedef {'idle' | 'ok' | 'pending' | 'busy' | 'offline' | 'auth' | 'error' | 'conflict'} SyncStatus */

/**
 * @typedef {object} RemoteDoc Dokument, das nur in der Ablage liegt
 * @property {string} id
 * @property {string} head
 * @property {number} savedAt
 * @property {string} device
 * @property {string} title
 * @property {string} summary
 */

/**
 * @typedef {object} SyncState
 * @property {SyncStatus} status
 * @property {string | null} error Fehlermeldung bzw. -art (`auth`, `offline`, `newer-schema` …)
 * @property {number | null} lastSyncAt
 * @property {Record<string, DocState>} docs
 * @property {string[]} conflicts IDs mit Konflikt
 * @property {RemoteDoc[]} remoteOnly
 */

export const META_PREFIX = 'method-commons:sync:docs:';
const MINUTE = 60_000;

/**
 * Fingerabdruck eines Dokuments (FNV-1a über das JSON). Apps speichern ein Dokument z. B. beim
 * Öffnen erneut, ohne es zu ändern – das soll keine Übertragung auslösen.
 * @param {unknown} data
 */
export function fingerprint(data) {
  const text = JSON.stringify(data) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** Im Browser seit dem letzten Abgleich geändert? @param {LocalDoc} local @param {DocMeta} m */
const isDirty = (local, m) => local.savedAt > m.savedAt && (m.hash == null || fingerprint(local.data) !== m.hash);

/** @param {unknown} e */
const errorKind = e => (e instanceof AuthError ? 'auth' : e instanceof OfflineError ? 'offline' : 'error');

export class SyncEngine {
  /**
   * @param {object} opts
   * @param {AppAdapter} opts.adapter
   * @param {RemoteStore} opts.store
   * @param {string} opts.device
   * @param {KeyValue | null} [opts.storage] Merkliste (Standard: localStorage)
   * @param {{ request: (name: string, cb: () => Promise<any>) => Promise<any> } | null} [opts.locks] Standard: navigator.locks
   * @param {() => number} [opts.now]
   * @param {number} [opts.interval] Mindestabstand zweier Übertragungen eines Dokuments (ms)
   * @param {number} [opts.delay] Wartezeit nach einer Änderung (ms)
   * @param {number} [opts.poll] Abstand der Abfragen auf Änderungen anderer Geräte (ms)
   * @param {{ save: (title: string, device: string) => string, remove: (title: string, device: string) => string }} [opts.messages] Commit-Nachrichten
   * @param {boolean} [opts.timers] false: keine Zeitgeber (Tests)
   */
  constructor({
    adapter, store, device, storage = globalThis.localStorage ?? null, locks = globalThis.navigator?.locks ?? null,
    now = Date.now, interval = 5 * MINUTE, delay = 3000, poll = 2 * MINUTE, messages, timers = true,
  }) {
    this.adapter = adapter;
    this.store = store;
    this.device = device;
    this.storage = storage;
    this.locks = locks;
    this.now = now;
    this.interval = interval;
    this.delay = delay;
    this.poll = poll;
    this.messages = messages ?? {
      save: (title, dev) => `${title} (${dev})`,
      remove: (title, dev) => `${title} entfernt (${dev})`,
    };
    this.timers = timers;
    /** @type {SyncState} */
    this.state = { status: 'idle', error: null, lastSyncAt: null, docs: {}, conflicts: [], remoteOnly: [] };
    /** @type {Set<(s: SyncState) => void>} */
    this.listeners = new Set();
    /** @type {Set<(id: string) => void>} */
    this.remoteListeners = new Set();
    /** Beschreibungen von Dokumenten nur in der Ablage, je Stand. @type {Map<string, RemoteDoc>} */
    this.described = new Map();
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.timer = undefined;
    /** @type {Promise<void> | null} */
    this.running = null;
    this.again = false;
    this.forceAgain = false;
    this.failures = 0;
    this.stopped = false;
  }

  // ---------- Merkliste ----------

  get metaKey() { return META_PREFIX + this.adapter.app; }

  /** @returns {Record<string, DocMeta>} */
  loadMeta() {
    try {
      const raw = JSON.parse(this.storage?.getItem(this.metaKey) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (e) {
      return {};
    }
  }

  /** @param {Record<string, DocMeta>} meta */
  saveMeta(meta) {
    try { this.storage?.setItem(this.metaKey, JSON.stringify(meta)); } catch (e) { /* voll: beim nächsten Abgleich erneut */ }
  }

  // ---------- Ereignisse ----------

  /** @param {(s: SyncState) => void} fn @returns {() => void} */
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** Dokument wurde aus der Ablage übernommen – die App lädt es neu. @param {(id: string) => void} fn */
  onRemoteChange(fn) {
    this.remoteListeners.add(fn);
    return () => this.remoteListeners.delete(fn);
  }

  /** @param {Partial<SyncState>} patch */
  setState(patch) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  // ---------- Aufrufe der App ----------

  /** Die App hat ein Dokument gespeichert. @param {string} id */
  changed(id) {
    const docs = { ...this.state.docs };
    if (docs[id] !== 'local' && docs[id] !== 'conflict') docs[id] = 'pending';
    this.setState({ docs, status: this.summarize(docs) });
    this.schedule(this.delay);
  }

  /** Die App hat ein Dokument gelöscht – in der Ablage ebenfalls entfernen. @param {string} id */
  removed(id) {
    const meta = this.loadMeta();
    const m = meta[id];
    if (!m) return;
    if (m.localOnly || !m.head) delete meta[id];
    else meta[id] = { ...m, deleted: true };
    this.saveMeta(meta);
    this.schedule(this.delay);
  }

  /** Dokumente zum Übertragen vormerken (z. B. „Hochladen“). @param {string[]} ids */
  async upload(ids) {
    const meta = this.loadMeta();
    for (const id of ids) meta[id] = { head: null, savedAt: 0 };
    this.saveMeta(meta);
    await this.run({ force: true });
  }

  /** Dokumente bewusst nur im Browser behalten. @param {string[]} ids */
  keepLocal(ids) {
    const meta = this.loadMeta();
    for (const id of ids) meta[id] = { savedAt: 0, localOnly: true };
    this.saveMeta(meta);
    this.refreshDocs(meta);
  }

  /** Ausstehende Änderungen sofort übertragen (ohne Drosselung). */
  flush() { return this.run({ force: true }); }

  /** Zeitgeber anhalten (z. B. beim Trennen der Ablage). */
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** @param {number} ms */
  schedule(ms) {
    if (!this.timers || this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.run().catch(() => {}); }, ms);
  }

  // ---------- Abgleich ----------

  /**
   * Ein Abgleich: Liste der Ablage holen, je Dokument übertragen, übernehmen oder Konflikt melden.
   * Läuft schon einer, folgt direkt danach ein weiterer.
   * @param {{ force?: boolean }} [opts]
   */
  async run({ force = false } = {}) {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      this.forceAgain = this.forceAgain || force;
      return this.running;
    }
    this.running = (async () => {
      /** @type {string[]} */
      const pulled = [];
      let next = Infinity;
      try {
        next = await this.withLock(() => this.cycle(force, pulled));
        this.failures = 0;
        this.setState({ error: this.state.error === 'newer-schema' ? 'newer-schema' : null, lastSyncAt: this.now() });
      } catch (e) {
        this.failures++;
        const kind = errorKind(e);
        this.setState({ status: kind === 'error' ? 'error' : kind, error: kind === 'error' ? String(/** @type {any} */ (e)?.message ?? e) : kind });
        // Offline: erneut nach 30 s, dann länger; ohne Zugang erst nach einer neuen Änderung
        if (kind === 'offline') next = this.now() + Math.min(30_000 * 2 ** (this.failures - 1), 5 * MINUTE);
      }
      for (const id of pulled) for (const fn of this.remoteListeners) fn(id);
      const wait = Math.max(Math.min(next - this.now(), this.poll), 1000);
      this.schedule(Number.isFinite(wait) ? wait : this.poll);
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
    if (this.again) {
      const f = !!this.forceAgain;
      this.again = false;
      this.forceAgain = false;
      await this.run({ force: f });
    }
  }

  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  withLock(fn) {
    return this.locks ? this.locks.request(`method-commons:sync:${this.adapter.app}`, fn) : fn();
  }

  /**
   * @param {boolean} force @param {string[]} pulled IDs, die aus der Ablage übernommen wurden
   * @returns {Promise<number>} Zeitpunkt der nächsten fälligen Übertragung (Infinity: keine)
   */
  async cycle(force, pulled) {
    const { adapter, store } = this;
    const app = adapter.app;
    const remote = new Map((await store.list(app)).map(e => [e.id, e.head]));
    const meta = this.loadMeta();
    const locals = new Map(adapter.list().map(d => [d.id, d]));
    let next = Infinity;
    let newer = false;

    for (const [id, m] of Object.entries(meta)) {
      if (m.localOnly) continue;
      const head = remote.get(id) ?? null;
      const local = locals.get(id);

      if (m.deleted) {
        if (head && head === m.head) await store.remove(app, id, head, this.messages.remove(m.title || id, this.device));
        // in der Ablage inzwischen geändert: dort lassen (erscheint als „nur in der Ablage“)
        delete meta[id];
        this.saveMeta(meta);
        continue;
      }
      if (m.conflict !== undefined) {
        if (head !== m.conflict) { meta[id] = { ...m, conflict: head }; this.saveMeta(meta); }
        continue;
      }
      if (!local) {
        // im Browser fehlend, aber nicht gelöscht (z. B. Speicher geleert): aus der Ablage holen
        if (head) { if (await this.pull(id, meta, pulled) === 'newer') newer = true; } else { delete meta[id]; this.saveMeta(meta); }
        continue;
      }
      if (!head && m.head) {
        // auf einem anderen Gerät aus der Ablage gelöscht: im Browser behalten, nicht mehr abgleichen
        meta[id] = { savedAt: m.savedAt, localOnly: true };
        this.saveMeta(meta);
        continue;
      }
      const dirty = isDirty(local, m);
      if (!dirty && local.savedAt > m.savedAt) {
        // nur neu gespeichert, Inhalt gleich: Zeitpunkt nachziehen
        meta[id] = { ...m, savedAt: local.savedAt };
        this.saveMeta(meta);
      }
      const changedRemote = head !== (m.head ?? null);
      if (changedRemote && dirty) {
        meta[id] = { ...m, conflict: head };
        this.saveMeta(meta);
      } else if (changedRemote) {
        if (await this.pull(id, meta, pulled) === 'newer') newer = true;
      } else if (dirty) {
        // von diesem Gerät noch nie übertragen: sofort, sonst höchstens einmal je Intervall
        const due = m.pushedAt ? m.pushedAt + this.interval : 0;
        if (force || due <= this.now()) await this.push(local, m.head ?? null, meta);
        else next = Math.min(next, due);
      }
    }

    // Neue Dokumente im Browser (nach dem Einrichten angelegt): übertragen
    for (const [id, local] of locals) {
      if (meta[id]) continue;
      const head = remote.get(id);
      if (head) { meta[id] = { head: null, savedAt: 0, conflict: head }; this.saveMeta(meta); continue; }
      await this.push(local, null, meta);
    }

    await this.describeRemoteOnly(remote, meta, locals);
    this.refreshDocs(meta, newer);
    return next;
  }

  /**
   * Stand im Browser übertragen; bei Konflikt vormerken.
   * @param {LocalDoc} local @param {string | null} baseHead @param {Record<string, DocMeta>} meta
   */
  async push(local, baseHead, meta) {
    const { adapter, store } = this;
    const title = adapter.title(local.data);
    /** @type {StoredRecord} */
    const record = { app: adapter.app, schemaVersion: adapter.schemaVersion, savedAt: local.savedAt, device: this.device, data: local.data };
    const docs = { ...this.state.docs, [local.id]: /** @type {DocState} */ ('busy') };
    this.setState({ docs, status: 'busy' });
    try {
      const head = await store.put(adapter.app, local.id, record, baseHead, this.messages.save(title, this.device));
      meta[local.id] = { head, savedAt: local.savedAt, pushedAt: this.now(), title, hash: fingerprint(local.data) };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      // Inzwischen anders in der Ablage: Konflikt merken. Datei verschwunden: beim nächsten Mal neu anlegen.
      const current = await store.get(adapter.app, local.id);
      const prev = meta[local.id] ?? { savedAt: 0 };
      meta[local.id] = current ? { ...prev, head: prev.head ?? null, conflict: current.head } : { ...prev, head: null };
    }
    this.saveMeta(meta);
  }

  /**
   * Stand aus der Ablage in den Browser übernehmen.
   * @param {string} id @param {Record<string, DocMeta>} meta @param {string[]} pulled
   * @returns {Promise<'ok' | 'newer' | 'missing' | 'invalid'>}
   */
  async pull(id, meta, pulled) {
    const { adapter } = this;
    const got = await this.store.get(adapter.app, id);
    if (!got) return 'missing';
    if (got.record.schemaVersion > adapter.schemaVersion) return 'newer';
    let data;
    try { data = adapter.normalize(got.record.data); } catch (e) { return 'invalid'; }
    const savedAt = Number(got.record.savedAt) || this.now();
    if (!adapter.write(id, data, savedAt)) return 'invalid';
    meta[id] = { head: got.head, savedAt, pushedAt: meta[id]?.pushedAt, title: adapter.title(data), hash: fingerprint(data) };
    this.saveMeta(meta);
    pulled.push(id);
    return 'ok';
  }

  /**
   * Dokumente, die nur in der Ablage liegen, mit Titel und Kennzahlen (je Stand zwischengespeichert).
   * @param {Map<string, string>} remote @param {Record<string, DocMeta>} meta @param {Map<string, LocalDoc>} locals
   */
  async describeRemoteOnly(remote, meta, locals) {
    /** @type {RemoteDoc[]} */
    const list = [];
    for (const [id, head] of remote) {
      if (meta[id] || locals.has(id)) continue;
      let desc = this.described.get(head);
      if (!desc) {
        const got = await this.store.get(this.adapter.app, id);
        if (!got) continue;
        const r = got.record;
        let title = id;
        let summary = '';
        try {
          const data = this.adapter.normalize(r.data);
          title = this.adapter.title(data);
          summary = this.adapter.summary?.(data) ?? '';
        } catch (e) { /* unlesbar: nur die ID */ }
        desc = { id, head: got.head, savedAt: Number(r.savedAt) || 0, device: String(r.device || ''), title, summary };
        this.described.set(head, desc);
      }
      list.push(desc);
    }
    list.sort((a, b) => b.savedAt - a.savedAt);
    this.setState({ remoteOnly: list });
  }

  /** Zustand je Dokument aus der Merkliste ableiten. @param {Record<string, DocMeta>} meta @param {boolean} [newer] */
  refreshDocs(meta, newer = false) {
    /** @type {Record<string, DocState>} */
    const docs = {};
    for (const local of this.adapter.list()) {
      const m = meta[local.id];
      docs[local.id] = !m ? 'pending'
        : m.localOnly ? 'local'
          : m.conflict !== undefined ? 'conflict'
            : isDirty(local, m) ? 'pending' : 'ok';
    }
    const conflicts = Object.keys(docs).filter(id => docs[id] === 'conflict');
    this.setState({ docs, conflicts, status: this.summarize(docs), error: newer ? 'newer-schema' : null });
  }

  /** @param {Record<string, DocState>} docs @returns {SyncStatus} */
  summarize(docs) {
    const states = Object.values(docs);
    if (states.includes('conflict')) return 'conflict';
    if (states.includes('busy')) return 'busy';
    if (states.includes('pending')) return 'pending';
    return 'ok';
  }

  // ---------- Konflikte und Dokumente nur in der Ablage ----------

  /**
   * Beide Stände eines Konflikts für den Dialog.
   * @param {string} id
   */
  async conflictInfo(id) {
    const m = this.loadMeta()[id];
    const local = this.adapter.read(id);
    const got = await this.store.get(this.adapter.app, id);
    /** @param {unknown} data */
    const describe = data => ({ title: this.adapter.title(data), summary: this.adapter.summary?.(data) ?? '' });
    let remoteData = null;
    try { remoteData = got ? this.adapter.normalize(got.record.data) : null; } catch (e) { /* unlesbar */ }
    return {
      id,
      base: m?.savedAt || null,
      local: local ? { savedAt: local.savedAt, device: this.device, ...describe(local.data) } : null,
      remote: got ? { savedAt: Number(got.record.savedAt) || 0, device: String(got.record.device || ''), ...(remoteData ? describe(remoteData) : { title: id, summary: '' }) } : null,
    };
  }

  /**
   * Konflikt auflösen.
   * - `mine`: Browser-Stand überträgt; der andere bleibt in der Historie der Ablage.
   * - `theirs`: Stand der Ablage ersetzt den im Browser.
   * - `both`: Stand der Ablage als eigenes Dokument anlegen, dann wie `mine`.
   * @param {string} id @param {'mine' | 'theirs' | 'both'} choice
   * @returns {Promise<string | null>} bei `both` die ID der Kopie
   */
  async resolve(id, choice) {
    /** @type {string[]} */
    const pulled = [];
    /** @type {string | null} */
    let copyId = null;
    await this.withLock(async () => {
      const { adapter } = this;
      const meta = this.loadMeta();
      const got = await this.store.get(adapter.app, id);
      const local = adapter.read(id);
      if (choice === 'theirs' || !local) {
        if (got) await this.pull(id, meta, pulled);
        else delete meta[id];
        this.saveMeta(meta);
        return;
      }
      if (choice === 'both' && got) {
        const copy = adapter.duplicate(adapter.normalize(got.record.data), String(got.record.device || ''));
        adapter.write(copy.id, copy.data, Number(got.record.savedAt) || this.now());
        copyId = copy.id;
        const copyDoc = adapter.read(copy.id);
        if (copyDoc) await this.push(copyDoc, null, meta);
      }
      meta[id] = { ...meta[id], savedAt: meta[id]?.savedAt ?? 0 };
      delete meta[id].conflict;
      await this.push(local, got?.head ?? null, meta);
    });
    for (const p of pulled) for (const fn of this.remoteListeners) fn(p);
    this.refreshDocs(this.loadMeta());
    return copyId;
  }

  /**
   * Dokument, das nur in der Ablage liegt, in den Browser holen.
   * @param {string} id @returns {Promise<boolean>}
   */
  async download(id) {
    /** @type {string[]} */
    const pulled = [];
    const ok = await this.withLock(async () => {
      const meta = this.loadMeta();
      return (await this.pull(id, meta, pulled)) === 'ok';
    });
    this.setState({ remoteOnly: this.state.remoteOnly.filter(d => d.id !== id) });
    this.refreshDocs(this.loadMeta());
    return ok;
  }
}
