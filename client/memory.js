/*
 * Ablage im Speicher – für Tests und zum Ausprobieren. Verhält sich wie die GitHub-Ablage:
 * jeder Stand bekommt eine neue Kennung, Ändern und Löschen nur auf dem aktuellen Stand.
 */
import { ConflictError } from './store.js';

/** @typedef {import('./store.js').StoredRecord} StoredRecord */

export class MemoryStore {
  /** @param {{ name?: string }} [opts] */
  constructor({ name = 'memory' } = {}) {
    this.name = name;
    /** @type {Map<string, { record: StoredRecord, head: string }>} */
    this.files = new Map();
    /** Verlauf aller Stände, wie die Commits eines Repos. @type {{ path: string, head: string | null, message: string }[]} */
    this.log = [];
    this.counter = 0;
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
}
