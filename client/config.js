/*
 * Einstellungen der Ablage. Sie gelten für alle Methoden-Apps desselben Browser-Ursprungs
 * (method-commons.github.io) und liegen daher unter gemeinsamen Schlüsseln im localStorage.
 */
import { GitHubStore } from './github.js';

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

/** Ablage zu den Einstellungen. @param {SyncConfig} config @param {string} token @param {typeof fetch} [fetchFn] */
export function createStore(config, token, fetchFn) {
  return new GitHubStore({ repo: config.repo, branch: config.branch, token, fetch: fetchFn });
}
