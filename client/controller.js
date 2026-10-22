/*
 * SyncController – hält für eine App Einstellungen, Ablage und Engine zusammen: einrichten,
 * starten, trennen, Gerätename, Ereignisse anderer Tabs und Apps. Ohne DOM-Aufbau; die
 * Oberfläche (`ui/`) liest nur `state` und ruft die Methoden auf.
 */
import { CONFIG_KEY, clearConfig, defaultDevice, defaultStorage, loadConfig, saveConfig } from './config.js';
import { SetupError } from './store.js';
import { META_PREFIX, SyncEngine } from './engine.js';
import { GitHubStore, fetchShared } from './github.js';

/** @typedef {import('./config.js').SyncConfig} SyncConfig */
/** @typedef {import('./config.js').KeyValue} KeyValue */
/** @typedef {import('./engine.js').AppAdapter} AppAdapter */
/** @typedef {import('./engine.js').SyncState} SyncState */

/**
 * Ablage zu den Einstellungen.
 * @param {Pick<SyncConfig, 'repo' | 'branch'>} config @param {string} token @param {typeof fetch} [fetchFn]
 */
export function createStore(config, token, fetchFn) {
  return new GitHubStore({ repo: config.repo, branch: config.branch, token, fetch: fetchFn });
}

/**
 * @typedef {object} ControllerState
 * @property {SyncConfig | null} config
 * @property {SyncState | null} sync
 */

export class SyncController {
  /**
   * @param {object} opts
   * @param {AppAdapter} opts.adapter
   * @param {KeyValue & Partial<Pick<Storage, 'length' | 'key'>> | null} [opts.storage]
   * @param {typeof fetch} [opts.fetch]
   * @param {Partial<ConstructorParameters<typeof SyncEngine>[0]>} [opts.engine] weitere Optionen der Engine
   * @param {Window | null} [opts.win] für Ereignisse (online, Sichtbarkeit, andere Tabs)
   */
  constructor({ adapter, storage = defaultStorage(), fetch: fetchFn, engine = {}, win = globalThis.window ?? null }) {
    this.adapter = adapter;
    this.storage = storage;
    this.fetch = fetchFn;
    this.engineOptions = engine;
    this.win = win;
    /** @type {SyncEngine | null} */
    this.engine = null;
    /** @type {ControllerState} */
    this.state = { config: null, sync: null };
    /** @type {Set<(s: ControllerState) => void>} */
    this.listeners = new Set();
    /** @type {Set<(id: string) => void>} */
    this.remoteListeners = new Set();
    /** @type {(() => void)[]} */
    this.cleanup = [];
    this.bindWindow();
  }

  /** @param {(s: ControllerState) => void} fn */
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  /** Ein Dokument wurde aus der Ablage übernommen – die App lädt es neu. @param {(id: string) => void} fn */
  onRemoteChange(fn) {
    this.remoteListeners.add(fn);
    return () => { this.remoteListeners.delete(fn); };
  }

  /** @param {Partial<ControllerState>} patch */
  setState(patch) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Eingerichtete Ablage starten (falls vorhanden). @returns {boolean} */
  start() {
    const loaded = loadConfig(this.storage);
    if (!loaded) { this.setState({ config: null, sync: null }); return false; }
    this.engine?.stop();
    const engine = new SyncEngine({
      adapter: this.adapter,
      store: createStore(loaded.config, loaded.token, this.fetch),
      device: loaded.config.device || defaultDevice(),
      storage: this.storage,
      ...this.engineOptions,
    });
    engine.subscribe(sync => this.setState({ sync }));
    engine.onRemoteChange(id => { for (const fn of this.remoteListeners) fn(id); });
    this.engine = engine;
    this.setState({ config: loaded.config });
    engine.refreshDocs(engine.loadMeta());
    engine.run().catch(() => {});
    return true;
  }

  /**
   * Zugang prüfen, ohne etwas zu speichern (Schritt „Verbinden“).
   * @param {{ repo: string, token: string, branch?: string }} input
   */
  async check({ repo, token, branch }) {
    const store = createStore({ repo: repo.trim(), branch }, token.trim(), this.fetch);
    return store.check();
  }

  /**
   * Ablage speichern und starten; gewählte Dokumente hochladen, die übrigen nur im Browser behalten.
   * @param {{ repo: string, token: string, branch?: string, device?: string, expiresAt?: string | null }} input
   * @param {string[]} upload IDs zum Hochladen
   */
  async connect({ repo, token, branch, device, expiresAt = null }, upload) {
    /** @type {SyncConfig} */
    const config = { kind: 'github', repo: repo.trim(), device: device?.trim() || defaultDevice(), connectedAt: Date.now(), expiresAt };
    if (branch) config.branch = branch;
    this.clearMeta();
    saveConfig(config, token.trim(), this.storage);
    this.start();
    const engine = /** @type {SyncEngine} */ (this.engine);
    const ids = new Set(upload);
    engine.keepLocal(this.adapter.list().map(d => d.id).filter(id => !ids.has(id)));
    await engine.upload([...ids]);
  }

  /** Token erneuern (z. B. nach Ablauf). @param {string} token @param {string | null} [expiresAt] */
  renewToken(token, expiresAt = null) {
    const loaded = loadConfig(this.storage);
    if (!loaded) return;
    saveConfig({ ...loaded.config, expiresAt }, token.trim(), this.storage);
    this.start();
  }

  /** @param {string} device */
  setDevice(device) {
    const loaded = loadConfig(this.storage);
    if (!loaded || !device.trim()) return;
    const config = { ...loaded.config, device: device.trim() };
    saveConfig(config, undefined, this.storage);
    if (this.engine) this.engine.device = config.device;
    this.setState({ config });
  }

  /** Ablage trennen: Einstellungen, Token und Merklisten aller Apps löschen; Dokumente bleiben. */
  disconnect() {
    this.engine?.stop();
    this.engine = null;
    clearConfig(this.storage);
    this.clearMeta();
    this.setState({ config: null, sync: null });
  }

  /** Merklisten aller Apps löschen (passen nach Trennen oder Wechsel des Repos nicht mehr). */
  clearMeta() {
    const s = this.storage;
    if (!s?.key || s.length == null) { s?.removeItem(META_PREFIX + this.adapter.app); return; }
    /** @type {string[]} */
    const keys = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(META_PREFIX)) keys.push(k); }
    keys.forEach(k => s.removeItem(k));
  }

  /** Zahl der abgeglichenen Dokumente je App (aus den Merklisten, auch anderer Apps). @returns {Record<string, number>} */
  countsByApp() {
    const s = this.storage;
    /** @type {Record<string, number>} */
    const counts = {};
    if (!s?.key || s.length == null) return counts;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k?.startsWith(META_PREFIX)) continue;
      try {
        const meta = JSON.parse(s.getItem(k) || '{}');
        counts[k.slice(META_PREFIX.length)] = Object.values(meta).filter(m => m && !m.localOnly && !m.deleted).length;
      } catch (e) { /* beschädigt: auslassen */ }
    }
    return counts;
  }

  /** Die App hat ein Dokument gespeichert. @param {string} id */
  changed(id) { this.engine?.changed(id); }

  /**
   * Geteiltes Dokument lesen (Empfänger, ohne Ablage und ohne Anmeldung); prüft App und Datenformat.
   * @param {string} gist @returns {Promise<{ data: unknown, savedAt: number, device: string }>}
   */
  async readShared(gist) {
    const { record } = await fetchShared(gist, this.fetch);
    if (record.app !== this.adapter.app) throw new SetupError('share-other-app', 400);
    if (Number(record.schemaVersion) > this.adapter.schemaVersion) throw new SetupError('newer-schema', 400);
    return { data: this.adapter.normalize(record.data), savedAt: Number(record.savedAt) || 0, device: String(record.device || '') };
  }

  /** Die App hat ein Dokument gelöscht. @param {string} id */
  removed(id) { this.engine?.removed(id); }

  /** Online, Rückkehr in den Vordergrund, Verlassen der Seite, Änderungen anderer Tabs. */
  bindWindow() {
    const win = this.win;
    if (!win) return;
    /** @type {[string, EventListener, EventTarget][]} */
    const handlers = [
      ['online', () => { this.engine?.run().catch(() => {}); }, win],
      ['pagehide', () => { this.engine?.flush().catch(() => {}); }, win],
      ['visibilitychange', () => {
        const doc = win.document;
        if (doc.hidden) this.engine?.flush().catch(() => {});
        else this.engine?.run().catch(() => {});
      }, win.document],
      ['storage', e => {
        const key = /** @type {StorageEvent} */ (e).key;
        // In einem anderen Tab (auch einer anderen App) eingerichtet oder getrennt
        if (key === CONFIG_KEY || key === null) {
          if (loadConfig(this.storage)) { if (!this.engine) this.start(); } else if (this.engine) { this.engine.stop(); this.engine = null; this.setState({ config: null, sync: null }); }
        } else if (key === META_PREFIX + this.adapter.app && this.engine) {
          this.engine.refreshDocs(this.engine.loadMeta());
        }
      }, win],
    ];
    for (const [type, fn, target] of handlers) {
      target.addEventListener(type, fn);
      this.cleanup.push(() => target.removeEventListener(type, fn));
    }
  }

  /** Ereignisse lösen (Tests). */
  dispose() {
    this.engine?.stop();
    this.cleanup.forEach(fn => fn());
  }
}
