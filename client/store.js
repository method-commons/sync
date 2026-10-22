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
 * @property {ShareInfo} [share] geteilt zum Ansehen (alle Geräte des Besitzers aktualisieren den Link)
 */

/**
 * @typedef {object} ShareInfo Dokument ist zum Ansehen geteilt (GitHub: geheimes Gist)
 * @property {string} gist Kennung des Gists
 * @property {number} since Zeitpunkt des Teilens (ms)
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
 * @typedef {object} RepoInfo Sichtbarkeit und Besitzer der Ablage (entscheidet, wie geteilt wird)
 * @property {boolean} isPrivate
 * @property {string} owner Konto bzw. Organisation
 * @property {boolean} isOrganization
 */

/**
 * @typedef {object} VersionEntry Ein übertragener Stand (GitHub: Commit, der die Datei ändert)
 * @property {string} sha Kennung des Stands (Commit)
 * @property {number} date Zeitpunkt (ms)
 * @property {string} message Commit-Nachricht („Titel (Gerät)“)
 */

/**
 * @typedef {object} NamedVersion Benannter Stand (GitHub: annotierter Tag auf den Commit)
 * @property {string} sha Commit, auf den der Name zeigt
 * @property {string} ref Name des Tags ohne `refs/tags/`
 * @property {string} name
 * @property {string} note
 * @property {number} date
 */

/**
 * @typedef {object} RemoteStore Schnittstelle jeder Ablage
 * @property {() => Promise<StoreCheck>} check
 * @property {(app: string) => Promise<RemoteEntry[]>} list
 * @property {(app: string, id: string) => Promise<{ record: StoredRecord, head: string } | null>} get
 * @property {(app: string, id: string, record: StoredRecord, baseHead: string | null, message: string) => Promise<string>} put
 *   neuer Stand; `baseHead` null = neu anlegen. Wirft {@link ConflictError}, wenn der Stand inzwischen ein anderer ist.
 * @property {(app: string, id: string, baseHead: string, message: string) => Promise<void>} remove
 * @property {(app: string, id: string, page?: number) => Promise<{ items: VersionEntry[], more: boolean }>} versions
 *   übertragene Stände, neueste zuerst, seitenweise
 * @property {(app: string, id: string) => Promise<NamedVersion[]>} namedVersions benannte Stände, neueste zuerst
 * @property {(app: string, id: string, sha: string) => Promise<StoredRecord | null>} getVersion Eintrag eines Stands
 * @property {(app: string, id: string, v: { sha: string, name: string, note?: string, date: number }) => Promise<NamedVersion>} saveVersion
 *   Stand benennen
 * @property {(record: StoredRecord, description: string) => Promise<string>} [createShare] zum Ansehen teilen; Kennung des Links
 * @property {(gist: string, record: StoredRecord, description: string) => Promise<void>} [updateShare]
 *   geteilten Stand erneuern; {@link SetupError} 404, wenn das Teilen inzwischen beendet ist
 * @property {(gist: string) => Promise<void>} [deleteShare] Teilen beenden
 * @property {() => Promise<RepoInfo>} [repoInfo] Sichtbarkeit und Besitzer (öffentlich: Teilen ohne Gist)
 */

/** Seitengröße der Versionsliste. */
export const VERSIONS_PAGE = 30;

/**
 * Name eines Stands als Teil eines Tag-Namens: Datum und Name, nur Kleinbuchstaben, Ziffern und Bindestriche.
 * @param {string} name @param {number} date
 */
export function versionSlug(name, date) {
  const day = new Date(date).toISOString().slice(0, 10);
  const words = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return words ? `${day}-${words}` : day;
}

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
