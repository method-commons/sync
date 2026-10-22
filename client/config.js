/*
 * Einstellungen der Ablage. Sie gelten für alle Methoden-Apps desselben Browser-Ursprungs
 * (method-commons.github.io) und liegen daher unter gemeinsamen Schlüsseln im localStorage.
 * Ohne Importe: Apps binden diese Datei fest ein (`@method-commons/sync/config`) und laden den
 * übrigen Kern erst, wenn eine Ablage eingerichtet ist.
 */

export const CONFIG_KEY = 'method-commons:sync:config';
export const TOKEN_KEY = 'method-commons:sync:token';

/**
 * @typedef {object} SyncConfig
 * @property {'github'} kind Art der Ablage
 * @property {string} repo `besitzer/name`
 * @property {string} [branch] ohne Angabe der Standard-Branch
 * @property {string} device Gerätename für Commits und Konflikte
 * @property {number} connectedAt Zeitpunkt des Einrichtens (ms)
 * @property {string | null} [expiresAt] Ablauf des Tokens (ISO), falls bekannt
 */

/** @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} KeyValue */

/** Standard-Speicher: localStorage, falls verfügbar. @returns {KeyValue | null} */
export function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch (e) { return null; }
}

/**
 * Eingerichtete Ablage oder `null` (auch ohne Token).
 * @param {KeyValue | null} [storage]
 * @returns {{ config: SyncConfig, token: string } | null}
 */
export function loadConfig(storage = defaultStorage()) {
  try {
    const config = JSON.parse(storage?.getItem(CONFIG_KEY) || 'null');
    const token = storage?.getItem(TOKEN_KEY) || '';
    if (!config || config.kind !== 'github' || typeof config.repo !== 'string' || !token) return null;
    return { config: { device: '', connectedAt: 0, ...config }, token };
  } catch (e) {
    return null;
  }
}

/** Schnelle Prüfung ohne Parsen – entscheidet, ob eine App den Kern überhaupt lädt. @param {KeyValue | null} [storage] */
export function hasConfig(storage = defaultStorage()) {
  try { return !!(storage?.getItem(CONFIG_KEY) && storage.getItem(TOKEN_KEY)); } catch (e) { return false; }
}

/** @param {SyncConfig} config @param {string} [token] ohne Angabe bleibt das bisherige @param {KeyValue | null} [storage] */
export function saveConfig(config, token, storage = defaultStorage()) {
  storage?.setItem(CONFIG_KEY, JSON.stringify(config));
  if (token != null) storage?.setItem(TOKEN_KEY, token);
}

/** Ablage trennen: Einstellungen und Token löschen; Dokumente bleiben. @param {KeyValue | null} [storage] */
export function clearConfig(storage = defaultStorage()) {
  storage?.removeItem(CONFIG_KEY);
  storage?.removeItem(TOKEN_KEY);
}

/**
 * Gerätename aus dem Browser, z. B. „Chrome · Windows“.
 * @param {{ userAgent?: string }} [nav]
 */
export function defaultDevice(nav = globalThis.navigator) {
  const ua = nav?.userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ') || 'Browser';
}

// ---------- Links zum Ansehen ----------

/**
 * @typedef {{ kind: 'gist', gist: string } | { kind: 'public', repo: string, id: string, ref?: string }} SharedLink
 * Geteiltes Dokument: geheimes Gist (`#g=<gist>`) oder Datei in einem öffentlichen Repo
 * (`#p=<besitzer>/<repo>/<id>[@<ref>]`, `ref` = Branch oder Commit; ohne `ref` der Standard-Branch).
 */

/** Fester Stand (Commit) statt Branch? @param {string | undefined} ref */
export const isFixedRef = ref => !!ref && /^[0-9a-f]{40}$/i.test(ref);

/**
 * Geteiltes Dokument aus der Adresse, sonst `null`. Ohne Importe, damit Apps es fest einbinden können.
 * @param {string} hash @returns {SharedLink | null}
 */
export function sharedLink(hash) {
  const gist = /^#g=([0-9a-f]{8,64})$/i.exec(hash)?.[1];
  if (gist) return { kind: 'gist', gist };
  const m = /^#p=([\w.-]+)\/([\w.-]+)\/([^/@]+)(?:@([^/@]+))?$/.exec(hash);
  if (!m || [m[1], m[2]].some(x => /^\.+$/.test(x))) return null;
  try {
    const id = decodeURIComponent(m[3]);
    const ref = m[4] ? decodeURIComponent(m[4]) : undefined;
    return { kind: 'public', repo: `${m[1]}/${m[2]}`, id, ...(ref ? { ref } : {}) };
  } catch (e) {
    return null;
  }
}

/** Adresse (`#…`) zu einem geteilten Dokument. @param {SharedLink} link */
export function sharedHash(link) {
  if (link.kind === 'gist') return `#g=${link.gist}`;
  return `#p=${link.repo}/${encodeURIComponent(link.id)}${link.ref ? `@${encodeURIComponent(link.ref)}` : ''}`;
}
