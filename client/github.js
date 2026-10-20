/*
 * Ablage in einem GitHub-Repo über die REST-API (Contents), direkt aus dem Browser.
 * Jedes Dokument ist eine Datei `<app>/<id>.json`, jeder übertragene Stand ein Commit.
 * Ändern und Löschen verlangen den `sha` des bisherigen Stands – so erkennt GitHub Konflikte.
 */
import { AuthError, ConflictError, OfflineError, SetupError } from './store.js';

/** @typedef {import('./store.js').StoredRecord} StoredRecord */

const API = 'https://api.github.com';
/** Kennzeichnung im Wurzelordner: Repo ist eine Ablage der Methoden-Apps. */
export const MARKER = 'method-commons.json';
export const MARKER_VERSION = 1;

/** Text → Base64 (UTF-8), wie die API es erwartet. @param {string} text */
export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Base64 (mit Zeilenumbrüchen, wie von der API geliefert) → Text. @param {string} b64 */
export function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

/** Pfadteile für die URL kodieren, Schrägstriche bleiben. @param {string} path */
const encPath = path => path.split('/').map(encodeURIComponent).join('/');

/**
 * Ablauf des Tokens aus dem Kopf `GitHub-Authentication-Token-Expiration`
 * (z. B. `2027-01-18 10:00:00 UTC` oder `… +0100`) als ISO-Zeit, sonst `null`.
 * @param {string | null} value
 */
export function parseExpiry(value) {
  if (!value) return null;
  const iso = value.trim().replace(/ UTC$/, 'Z').replace(' ', 'T').replace(/ ([+-]\d\d)(\d\d)$/, '$1:$2');
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export class GitHubStore {
  /**
   * @param {{ repo: string, token: string, branch?: string, fetch?: typeof fetch }} opts
   *   `repo` als `besitzer/name`; ohne `branch` der Standard-Branch des Repos.
   */
  constructor({ repo, token, branch, fetch: fetchFn }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new SetupError('repo-format', 400);
    this.repo = repo;
    this.token = token;
    this.branch = branch;
    this.fetch = fetchFn ?? globalThis.fetch.bind(globalThis);
    /** Ablauf des Tokens, sobald GitHub ihn in einer Antwort nennt. @type {string | null} */
    this.expiresAt = null;
  }

  /**
   * Anfrage an die API; Fehler werden auf die Fehlerarten der Ablage abgebildet.
   * @param {string} method @param {string} path @param {object} [body]
   * @param {{ allow404?: boolean }} [opts]
   * @returns {Promise<any>}
   */
  async request(method, path, body, { allow404 = false } = {}) {
    let res;
    try {
      res = await this.fetch(`${API}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new OfflineError(String(e));
    }
    this.expiresAt = parseExpiry(res.headers.get('github-authentication-token-expiration')) ?? this.expiresAt;
    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 404 && allow404) return null;
    const text = await res.text().catch(() => '');
    if (res.status === 401) throw new AuthError(text, 401);
    if (res.status === 403 || res.status === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) throw new OfflineError('rate-limit');
      throw new AuthError(text, 403);
    }
    if (res.status === 409 || res.status === 422) throw new ConflictError(text);
    if (res.status === 404) throw new SetupError(text, 404);
    if (res.status >= 500) throw new OfflineError(`${res.status}`);
    throw new SetupError(text, res.status);
  }

  /** Adresse einer Datei bzw. eines Ordners (zum Schreiben). @param {string} path */
  file(path) { return `/repos/${this.repo}/contents/${encPath(path)}`; }

  /** Adresse zum Lesen, auf dem gewählten Branch. @param {string} path */
  contents(path) { return `${this.file(path)}${this.branch ? `?ref=${encodeURIComponent(this.branch)}` : ''}`; }

  /** @param {object} body */
  withBranch(body) { return this.branch ? { ...body, branch: this.branch } : body; }

  /**
   * Prüft Zugang und Repo; legt beim ersten Mal die Kennzeichnung an (bestätigt das Schreibrecht).
   * @returns {Promise<import('./store.js').StoreCheck>}
   */
  async check() {
    const info = await this.request('GET', `/repos/${this.repo}`);
    const marker = await this.request('GET', this.contents(MARKER), undefined, { allow404: true });
    let created = false;
    if (!marker) {
      const text = `${JSON.stringify({ kind: 'method-commons-storage', version: MARKER_VERSION }, null, 2)}\n`;
      await this.request('PUT', this.file(MARKER), this.withBranch({ message: 'Ablage für die Methoden-Apps einrichten', content: encodeBase64(text) }));
      created = true;
    }
    return { name: this.repo, isPrivate: !!info.private, created, expiresAt: this.expiresAt };
  }

  /** @param {string} app */
  async list(app) {
    const items = await this.request('GET', this.contents(app), undefined, { allow404: true });
    if (!Array.isArray(items)) return [];
    return items.filter(i => i.type === 'file' && i.name.endsWith('.json'))
      .map(i => ({ id: i.name.slice(0, -'.json'.length), head: String(i.sha) }));
  }

  /** @param {string} app @param {string} id */
  async get(app, id) {
    const file = await this.request('GET', this.contents(`${app}/${id}.json`), undefined, { allow404: true });
    if (!file) return null;
    return { record: JSON.parse(decodeBase64(file.content)), head: String(file.sha) };
  }

  /** @param {string} app @param {string} id @param {StoredRecord} record @param {string | null} baseHead @param {string} message */
  async put(app, id, record, baseHead, message) {
    const content = encodeBase64(`${JSON.stringify(record, null, 2)}\n`);
    const body = this.withBranch({ message, content, ...(baseHead ? { sha: baseHead } : {}) });
    const res = await this.request('PUT', this.file(`${app}/${id}.json`), body);
    return String(res.content.sha);
  }

  /** @param {string} app @param {string} id @param {string} baseHead @param {string} message */
  async remove(app, id, baseHead, message) {
    await this.request('DELETE', this.file(`${app}/${id}.json`),
      this.withBranch({ message, sha: baseHead }), { allow404: true });
  }
}
