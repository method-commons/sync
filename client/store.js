/*
 * Gemeinsame Typen und Fehler der Ablagen. Eine Ablage speichert je App (Ordner) Dokumente als
 * Einträge `{ app, schemaVersion, savedAt, device, data }` und versteht `data` nicht.
 */

/**
 * @typedef {object} StoredRecord Eintrag in der Ablage
 * @property {string} app Kennung der App (Name ihres Repos), zugleich Ordner
 * @property {number} schemaVersion Version des Datenformats der App
 * @property {number} savedAt Zeitpunkt des Speicherns im Browser (ms)
 * @property {string} device Gerät, das den Stand übertragen hat
 * @property {unknown} data Dokument der App
 */

/**
 * @typedef {object} RemoteEntry Eintrag in der Liste eines Ordners
 * @property {string} id
 * @property {string} head Kennung des Stands (GitHub: `sha` der Datei)
 */

/**
 * @typedef {object} StoreCheck Ergebnis der Prüfung beim Verbinden
 * @property {string} name Anzeigename der Ablage (z. B. `besitzer/repo`)
 * @property {boolean} [isPrivate]
 * @property {boolean} [created] Kennzeichnung neu angelegt – Schreibrecht damit bestätigt
 * @property {string | null} [expiresAt] Ablauf des Zugangs (ISO), falls bekannt
 */

/**
 * @typedef {object} RemoteStore Schnittstelle jeder Ablage
 * @property {() => Promise<StoreCheck>} check
 * @property {(app: string) => Promise<RemoteEntry[]>} list
 * @property {(app: string, id: string) => Promise<{ record: StoredRecord, head: string } | null>} get
 * @property {(app: string, id: string, record: StoredRecord, baseHead: string | null, message: string) => Promise<string>} put
 *   neuer Stand; `baseHead` null = neu anlegen. Wirft {@link ConflictError}, wenn der Stand inzwischen ein anderer ist.
 * @property {(app: string, id: string, baseHead: string, message: string) => Promise<void>} remove
 */

/** Der Stand in der Ablage ist ein anderer als der, auf dem die Änderung beruht. */
export class ConflictError extends Error {
  constructor(message = 'conflict') { super(message); this.name = 'ConflictError'; }
}

/** Zugang ungültig, abgelaufen oder ohne Recht. */
export class AuthError extends Error {
  /** @param {string} [message] @param {number} [status] */
  constructor(message = 'auth', status = 401) { super(message); this.name = 'AuthError'; this.status = status; }
}

/** Ablage nicht erreichbar (offline, Zeitüberschreitung, Grenze der Anfragen erreicht). */
export class OfflineError extends Error {
  constructor(message = 'offline') { super(message); this.name = 'OfflineError'; }
}

/** Ablage oder Ordner nicht gefunden bzw. falsch eingerichtet. */
export class SetupError extends Error {
  /** @param {string} [message] @param {number} [status] */
  constructor(message = 'setup', status = 404) { super(message); this.name = 'SetupError'; this.status = status; }
}
