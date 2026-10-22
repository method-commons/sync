/*
 * Ablage im Speicher – für Tests und zum Ausprobieren. Verhält sich wie die GitHub-Ablage:
 * jeder Stand bekommt eine neue Kennung, Ändern und Löschen nur auf dem aktuellen Stand.
 */
import { ConflictError, SetupError, VERSIONS_PAGE, versionSlug } from './store.js';

/** @typedef {import('./store.js').StoredRecord} StoredRecord */

export class MemoryStore {
  /** @param {{ name?: string }} [opts] */
  constructor({ name = 'memory' } = {}) {
    this.name = name;
    /** @type {Map<string, { record: StoredRecord, head: string }>} */
    this.files = new Map();
    /** Verlauf aller Stände, wie die Commits eines Repos. @type {{ path: string, head: string | null, message: string }[]} */
    this.log = [];
    /** Stände je Datei, älteste zuerst. @type {Map<string, { sha: string, date: number, message: string, record: StoredRecord }[]>} */
    this.history = new Map();
    /** Benannte Stände. @type {import('./store.js').NamedVersion[]} */
    this.tags = [];
    this.counter = 0;
    /** Uhr für die Zeitpunkte der Stände (Tests). */
    this.now = Date.now;
    /** Geteilte Stände (wie geheime Gists). @type {Map<string, { record: StoredRecord, description: string }>} */
    this.shares = new Map();
  }

  /** @param {string} app @param {string} id */
  static path(app, id) { return `${app}/${id}.json`; }

  async check() { return { name: this.name, isPrivate: true, created: false, expiresAt: null }; }

  /** @param {string} app */
  async list(app) {
    return [...this.files].filter(([p]) => p.startsWith(`${app}/`))
      .map(([p, f]) => ({ id: p.slice(app.length + 1, -'.json'.length), head: f.head }));
  }

  /** @param {string} app @param {string} id */
  async get(app, id) {
    const f = this.files.get(MemoryStore.path(app, id));
    return f ? { record: structuredClone(f.record), head: f.head } : null;
  }

  /** @param {string} app @param {string} id @param {StoredRecord} record @param {string | null} baseHead @param {string} message */
  async put(app, id, record, baseHead, message) {
    const path = MemoryStore.path(app, id);
    const current = this.files.get(path);
    if ((current?.head ?? null) !== baseHead) throw new ConflictError();
    const head = `h${++this.counter}`;
    this.files.set(path, { record: structuredClone(record), head });
    this.log.push({ path, head, message });
    const list = this.history.get(path) ?? [];
    list.push({ sha: `c${this.counter}`, date: this.now(), message, record: structuredClone(record) });
    this.history.set(path, list);
    return head;
  }

  /** @param {string} app @param {string} id @param {string} baseHead @param {string} message */
  async remove(app, id, baseHead, message) {
    const path = MemoryStore.path(app, id);
    const current = this.files.get(path);
    if (!current) return;
    if (current.head !== baseHead) throw new ConflictError();
    this.files.delete(path);
    this.log.push({ path, head: null, message });
  }

  /** @param {string} app @param {string} id @param {number} [page] */
  async versions(app, id, page = 1) {
    const all = [...(this.history.get(MemoryStore.path(app, id)) ?? [])].reverse();
    const items = all.slice((page - 1) * VERSIONS_PAGE, page * VERSIONS_PAGE).map(({ sha, date, message }) => ({ sha, date, message }));
    return { items, more: all.length > page * VERSIONS_PAGE };
  }

  /** @param {string} app @param {string} id */
  async namedVersions(app, id) {
    return this.tags.filter(t => t.ref.startsWith(`${app}/${id}/`)).sort((a, b) => b.date - a.date).map(t => ({ ...t }));
  }

  /** @param {string} app @param {string} id @param {string} sha */
  async getVersion(app, id, sha) {
    const v = (this.history.get(MemoryStore.path(app, id)) ?? []).find(x => x.sha === sha);
    return v ? structuredClone(v.record) : null;
  }

  /** @param {string} app @param {string} id @param {{ sha: string, name: string, note?: string, date: number }} v */
  async saveVersion(app, id, { sha, name, note = '', date }) {
    let ref = `${app}/${id}/${versionSlug(name, date)}`;
    for (let n = 2; this.tags.some(t => t.ref === ref); n++) ref = `${app}/${id}/${versionSlug(name, date)}-${n}`;
    const tag = { sha, ref, name, note, date };
    this.tags.push(tag);
    return { ...tag };
  }

  /** @param {StoredRecord} record @param {string} description */
  async createShare(record, description) {
    const gist = `g${(++this.counter).toString(16).padStart(8, '0')}`;
    this.shares.set(gist, { record: structuredClone(record), description });
    return gist;
  }

  /** @param {string} gist @param {StoredRecord} record @param {string} description */
  async updateShare(gist, record, description) {
    if (!this.shares.has(gist)) throw new SetupError('share-missing', 404);
    this.shares.set(gist, { record: structuredClone(record), description });
  }

  /** @param {string} gist */
  async deleteShare(gist) { this.shares.delete(gist); }
}
