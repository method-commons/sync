# Konzept: gemeinsame Ablage für alle Methoden-Apps

Stand: Oktober 2026 · **Konzept, noch nicht umgesetzt** · offene Entscheidungen am Ende.

Grundlage: [BACKEND.md der Morphologischen Matrix](https://github.com/method-commons/morphological-matrix-app/blob/main/docs/BACKEND.md).
Dort beschriebene Punkte (Anmeldelink, Recht, Grenzen gegen Missbrauch …) gelten weiter und werden hier
nur aufgegriffen, wo sich durch „alle Apps“ oder „GitHub als Ablage“ etwas ändert.

## Ziel

- Alle Apps bleiben statisch auf GitHub Pages und **ohne Konto in vollem Umfang** nutzbar.
- Wer eine Ablage einrichtet, bekommt zusätzlich: Dokumente auf allen Geräten, Versionen, später Teilen im Team.
- Sync, Konflikte und Versionen gibt es **einmal** – nicht als fünf Kopien in fünf Apps.

## Ausgangslage

| App | Speicherschlüssel (localStorage) | gespeichert wird | Schema |
|---|---|---|---|
| Morphologische Matrix | `morphologische-matrix:doc:<id>` | `{ savedAt, data }` | 8 |
| 2-Achsen-Matrix | `two-axis:matrix:<id>` | Dokument direkt | 1 |
| RACI-Matrix | `raci:matrix:<id>` | Dokument direkt | 1 |
| 5 Warum | `five-why:analysis:<id>` | Dokument direkt | 1 |
| User Stories | `user-stories:project:<id>` | Dokument direkt | 1 |

Daraus folgt:

- **Gleicher Ursprung:** Alle Apps liegen unter `method-commons.github.io`. Sie teilen sich localStorage
  (getrennt durch die Präfixe). Eine eingetragene Ablage und eine Anmeldung **gelten damit in allen Apps**.
  Kehrseite: Eine Lücke (XSS) in einer App erreicht das Anmelde-Token aller Apps.
- **Uneinheitliche Speicherschicht:** Vier Apps kennen nur `createdAt`, keinen Zeitpunkt der letzten
  Änderung. Für den Sync braucht jede App dieselbe Schnittstelle mit Änderungszeitpunkt (Stufe 0).
- **Kleine Dokumente:** Die Beispiele haben 7–22 kB. Vollständige Kopien statt Unterschiede bleiben richtig.

## Aufbau

```
method-commons/sync
├── client/      Sync-Kern: lokal zuerst, Bündeln, optimistische Sperre, Konflikte,
│                mehrere Tabs, Versionen drosseln und ausdünnen
├── adapters/    Ablagen mit gleicher Schnittstelle: memory (Tests), github, supabase
├── backend/     nur für Supabase: SQL-Migrationen, Zugriffsregeln, Einrichtungs- und Update-Skripte
└── ui/          gemeinsame Bausteine (Preact): Statusanzeige, Ablage-/Konto-Dialog,
                 Versionen-Dialog, Konfliktdialog, Einrichtungsassistent; Texte de/en
```

- **Einbindung als Git-Abhängigkeit** mit festem Tag, ohne npm-Veröffentlichung:
  `"@method-commons/sync": "github:method-commons/sync#v1.0.0"`. Jede App hebt die Version einzeln an.
- **Nachladen:** Der Kern wird erst geladen, wenn eine Ablage eingerichtet ist. Ohne Ablage bleibt das
  Bundle wie heute.
- **Gleiche Technik wie die Apps:** Vite, Preact, `@preact/signals`; Logik ohne DOM mit Typprüfung und
  Unit-Tests, Oberfläche getrennt.

## Schnittstellen

### Was jede App liefert

```js
SyncAdapter = {
  app: 'raci',                      // feste App-Kennung, auch Ordnername in der Ablage
  schemaVersion: 1,                 // Model.SCHEMA_VERSION
  list(),                           // lokale Dokumente: [{ id, title, savedAt }]
  read(id),                         // { savedAt, data } | null
  write(id, data, savedAt),         // lokal speichern
  remove(id),
  normalize(raw),                   // Model.normalize – Prüfung bleibt in der App
  title(data),                      // Anzeigename für Listen und Versionen
}
```

Die App ruft nach jedem eigenen Speichern `sync.changed(id)` auf und reagiert auf `sync.onRemoteChange(id)`
(Dokument neu laden). Mehr weiß die App vom Sync nicht.

### Was jede Ablage bietet

```js
Store = {
  connect(config), status(),                 // erreichbar, angemeldet, pausiert, Schema passt?
  list(app),                                 // [{ id, title, head, updatedAt }]
  get(app, id),                              // { data, head }
  put(app, id, data, baseHead),              // neuer head – oder Fehler „Konflikt“
  remove(app, id, baseHead),
  versions(app, id), getVersion(app, id, v),
  saveVersion(app, id, name),                // benannter Stand
}
```

`head` ist die Kennung des Stands, auf dem eine Änderung beruht: bei Supabase eine laufende Nummer, bei
GitHub der `sha` der Datei.

## Ablage A: GitHub-Repo

Jede Person bzw. jedes Team hat ein **privates Repo**; die App liest und schreibt darin über die
GitHub-API direkt aus dem Browser.

```
meine-methoden/
├── morphologische-matrix/<id>.json
├── two-axis/<id>.json
├── raci/<id>.json
├── five-why/<id>.json
└── user-stories/<id>.json
```

- **Dateien** enthalten das Dokument wie beim Export (eingerückt, damit Unterschiede lesbar sind) und
  einen kleinen Kopf: `{ app, schemaVersion, savedAt, data }`.
- **Optimistische Sperre eingebaut:** Beim Ändern einer Datei verlangt die API den `sha` des bisherigen
  Stands; hat ein anderes Gerät inzwischen geschrieben, lehnt sie ab → Konfliktdialog.
- **Versionen sind Commits.** Benannte Stände: Commit-Nachricht „Stand: <Name>“ und zusätzlich ein Tag.
  Ausdünnen entfällt; Git speichert Unterschiede selbst platzsparend. Vergleichen geht auch auf GitHub.
- **Commits gedrosselt:** höchstens alle paar Minuten bei Aktivität, außerdem vor Import, Zurücksetzen
  und Schließen des Tabs (soweit möglich). Ungesendetes bleibt lokal und wird beim nächsten Öffnen nachgeholt.
- **Team:** Mitglieder des Repos; Rechte regelt GitHub.
- **Claude und Skripte** können dieselben Dateien lesen und schreiben (z. B. der Skill
  „morphologische-matrix“ legt eine Matrix direkt im Repo ab).

### Anmeldung

| Weg | Wie | Bewertung |
|---|---|---|
| **a) persönliches Token** | fine-grained Token, nur ein Repo, nur „Contents: read and write“, mit Ablaufdatum; in der App eintragen | **zum Start** – ohne Server; ein Assistent erklärt die Schritte mit Direktlink |
| b) Anmelden mit GitHub | GitHub-App mit OAuth; der Tausch Code → Token braucht ein Geheimnis und ist aus dem Browser nicht erreichbar (kein CORS) – also ein kleiner Tausch-Dienst (z. B. Cloudflare Worker) ohne gespeicherte Daten | **später** – bequemer, aber wieder ein (kleiner) Server mit Betrieb |
| c) Git im Browser (isomorphic-git) | Git-Protokoll gegen beliebige Server | **nicht empfohlen** – braucht CORS-Proxy, große Bibliothek |

### Vorteile

- Kein Backend-Schema, kein Einrichtungsskript, **keine Updates fremder Backends**.
- Versionen, Historie und Vergleich ohne eigenen Code auf der Ablage-Seite.
- Daten als lesbare Dateien; Export ist „Repo klonen“.
- Kein Betrieb und keine fremden Daten beim Maintainer.

### Nachteile und Risiken

- **Nur für Leute mit GitHub-Konto** – Moderierende und Fachabteilungen haben oft keins.
- **Token im Browser:** liegt im localStorage und gilt für alle Apps (gleicher Ursprung). Deshalb nur
  fine-grained, ein Repo, nur Inhalte, mit Ablauf; „Ablage trennen“ löscht es.
- **Löschen ist in Git nicht endgültig:** Die Historie behält alles. Echtes Löschen hieße Historie
  umschreiben – für personenbezogene Inhalte ein Nachteil; in der App deutlich sagen.
- **US-Anbieter**, kein EU-Speicherort wählbar. GitHub Enterprise Server oder Gitea im eigenen Netz wären
  eigene Adapter (Gitea ähnlich, GitLab mit anderer API).
- Anfragen begrenzt (5.000 je Stunde und Token) – bei gedrosselten Commits unkritisch.

## Ablage B: Supabase-Projekt

Wie in [BACKEND.md, „Variante: eigenes Backend“](https://github.com/method-commons/morphological-matrix-app/blob/main/docs/BACKEND.md#variante-eigenes-backend)
beschrieben – Projekt-URL und öffentlicher Schlüssel eintragen, Einrichtungsskript im SQL-Editor ausführen,
die App prüft das Ergebnis. Geändert für alle Apps:

- **Eine Datenbank für alle Apps:**
  - `documents`: `id`, `owner`, **`app`**, `title`, `head`, `schema_version`, `updated_at`, `deleted_at`
  - `versions`: `document_id`, laufende Nummer, `created_at`, `schema_version`, Dokument als JSON, optional Name, Gerät
  - später `members`: `document_id`, `user_id`, Rolle (Teilen im Team)
  - `meta`: Schema-Version der Ablage selbst
- **Einrichtung und Team-Einladungslink einmal** – gilt für alle Apps.
- **Updates der Ablage selten:** Das Datenformat einer App liegt nur im JSON. Eine neue `SCHEMA_VERSION`
  einer App ändert an den Tabellen nichts; Update-Skripte braucht es nur, wenn sich die allgemeinen Tabellen
  ändern. Der „größte Daueraufwand“ aus BACKEND.md schrumpft damit deutlich.
- Zugriffsregeln (Row Level Security) wie dort: Jede Person sieht nur eigene bzw. geteilte Dokumente.

Vorteile gegenüber GitHub: kein GitHub-Konto nötig, echtes Löschen, EU-Rechenzentrum oder selbst gehostet,
Teilen mit feinen Rechten. Nachteile: Einrichtung mit SQL-Skript, pausierte kostenlose Projekte, begrenzter
E-Mail-Versand, größere Bibliothek (nur nachladen).

## Ablage C: betriebener Server

Ein vom Maintainer betriebenes Supabase-Projekt wäre nur ein **voreingestellter Eintrag** der Ablage B –
gleicher Code. Erst bei echter Nachfrage; dann gelten die Abschnitte „Recht“ und „Grenzen und Risiken“ aus
BACKEND.md vollständig.

## Gegenüberstellung

| | A: GitHub-Repo | B: Supabase-Projekt | C: betrieben |
|---|---|---|---|
| Für wen | Technikaffine mit GitHub | Teams, auch ohne GitHub | alle |
| Einrichtung | Repo + Token | Projekt + SQL-Skript | keine |
| Versionen | inklusive (Commits) | im Kern gebaut | im Kern gebaut |
| Updates der Ablage | keine | selten | beim Maintainer |
| Echtes Löschen | schwierig | ja | ja |
| Datenort | GitHub (US) | EU oder eigenes Netz | beim Maintainer |
| Betrieb/Recht beim Maintainer | kaum | kaum | voll |

## Sync und Konflikte

Wie in BACKEND.md, ergänzt um:

- **Lokal zuerst:** Die App speichert wie heute; `sync.changed(id)` merkt das Dokument vor, der Kern schiebt
  gebündelt nach wenigen Sekunden (GitHub: gedrosselt, siehe oben).
- **Konflikt:** Ablage lehnt wegen veraltetem `head` ab → Dialog „Meine behalten“, „Ablage übernehmen“,
  „Beide behalten“. Kein automatisches Zusammenführen, keine Echtzeit-Zusammenarbeit.
- **Mehrere Tabs und Apps:** Alle Apps eines Browsers teilen localStorage. Ein Tab übernimmt das Senden
  (Web Locks API), die anderen erfahren über `storage`-Ereignisse bzw. `BroadcastChannel` davon.
- **Schema neuer als die App:** Liegt in der Ablage ein Dokument mit höherer `schemaVersion`, als die App
  kennt, lädt die App es nicht und überschreibt es nicht („Bitte App neu laden“).
- **Erstes Verbinden:** Angebot, vorhandene lokale Dokumente hochzuladen – je App und je Dokument wählbar.
- Besonders zu testen: offline, mehrere Tabs, Wechsel zwischen Apps, Trennen mit ungesendeten Änderungen.

## Versionen

- **Automatisch** (gedrosselt) und **benannt** („Stand speichern“), Wiederherstellen legt eine neue Version an.
- GitHub: Commits und Tags. Supabase: Tabelle `versions`, automatisch z. B. die letzten 50, danach eine je
  Tag; benannte bleiben immer.
- **Vergleichen** berechnet der Browser; die Darstellung ist App-Sache (Adapter-Funktion `diff`, später).

## Oberfläche

- Menü „Datei“ jeder App: „Ablage …“ (einrichten, Status, trennen) und „Versionen …“.
- Statusanzeige in der Kopfzeile: „gespeichert ✓“, „wird gesendet“, „offline“, „Konflikt“.
- Gemeinsame Dialoge aus `ui/`; die Apps geben nur Texte für Dokumentarten („Matrix“, „Analyse“, „Projekt“).
- Ohne Ablage bleibt jede App wie heute; „Ablage …“ ist der einzige neue Eintrag.
- Später: Übersichtsseite „Alle meine Dokumente“ über alle Apps (`method-commons.github.io`).

## Sicherheit

- **Gemeinsamer Ursprung beachten:** Eine Lücke in einer App betrifft alle. Content Security Policy in allen
  Apps, keine fremden Skripte, Eingaben nie als HTML.
- **Schlüssel in localStorage:** `method-commons:sync:config` (Ablage, Repo bzw. Projekt-URL),
  `method-commons:sync:token` (Token bzw. Sitzung). Trennen löscht beides.
- CSP `connect-src`: `api.github.com` für A; für B beliebige HTTPS-Adressen (selbst gehostete Projekte) –
  schwächt die CSP etwas.
- Größengrenze je Dokument (z. B. 1 MB) im Kern, unabhängig von der Ablage.

## Repo, Tests, Veröffentlichung

- Dieses Repo: Kern, Adapter, Dialoge, Supabase-Skripte, Dokumentation. Lint, Typprüfung, Unit-Tests wie in
  den Apps; Sync-Logik gegen den `memory`-Adapter.
- Tests gegen GitHub mit einem Test-Repo und Token als CI-Geheimnis; gegen Supabase lokal in Docker.
- **Kern versionieren** (Tags `v1.x`): Änderungen an der Adapter-Schnittstelle sind „breaking“ und betreffen
  alle Apps.
- Eine kleine **Demo-Seite** im Repo (GitHub Pages) zum Ausprobieren der Ablagen ohne App.

## Stufen

| Stufe | Inhalt | Aufwand |
|---|---|---|
| 0 | Speicherschicht der vier jüngeren Apps angleichen (`{ savedAt, data }`, gleiche Funktionen) – lohnt sich auch ohne Sync | klein |
| 1 | Kern mit `memory`- und GitHub-Adapter, Token-Assistent, Statusanzeige, Konfliktdialog; zuerst in einer App | groß |
| 2 | Versionen (automatisch, benannt, wiederherstellen); Einbau in alle Apps | mittel |
| 3 | Supabase-Adapter mit Einrichtungsassistent, Prüfung und Team-Einladungslink | groß |
| 4 | Versionen vergleichen, Übersichtsseite aller Dokumente | mittel |
| 5 | optional: Teilen mit Rechten (Supabase), „Anmelden mit GitHub“ über Tausch-Dienst, betriebene Ablage | groß |

## Offene Entscheidungen

1. **Gemeinsames Repo statt Code in jeder App?** – Empfehlung: **ja**, eingebunden als Git-Abhängigkeit mit Tag.
2. **Erste Ablage:** GitHub oder Supabase? – Empfehlung: **GitHub** als günstige Probe für den Kern, Supabase danach.
3. **Anmeldung bei GitHub:** Token oder Tausch-Dienst? – Empfehlung: **zunächst fine-grained Token**.
4. **Erste App für Stufe 1:** – Empfehlung: **Morphologische Matrix** (Speicherschicht passt bereits, größte Nutzung).
5. **Ein Repo für alle Apps in der Ablage** (Ordner je App) statt je App ein Repo? – Empfehlung: **ein Repo**.
6. **Übersichtsseite** unter `method-commons.github.io`? – Empfehlung: **später** (Stufe 4).
7. **Gemeinsame Dialoge aus `ui/`** oder je App gebaut? – Empfehlung: **gemeinsam**, Texte über die Apps ergänzbar.

Nächster Schritt nach den Entscheidungen: Stufe 0 in den vier Apps, danach Mockups in der Morphologischen
Matrix (Menü „Ablage …“, Token-Assistent, Statusanzeige, Konfliktdialog), umsetzen erst nach „Ja“.
