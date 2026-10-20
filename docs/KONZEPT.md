# Konzept: gemeinsame Ablage für alle Methoden-Apps

Stand: Oktober 2026 · Entscheidungen getroffen (am Ende) · Stufe 0 umgesetzt · **Stufe 1 umgesetzt** (Kern und Morphologische Matrix).

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
| 5 Why | `five-why:analysis:<id>` | Dokument direkt | 1 |
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
├── client/      Sync-Kern ohne DOM: engine.js (lokal zuerst, Drosselung, Konflikte, mehrere Tabs),
│                controller.js (Einstellungen, Start, Trennen), config.js (gemeinsame Einstellungen),
│                Ablagen mit gleicher Schnittstelle: memory.js (Tests), github.js; später supabase
├── backend/     (Stufe 3) nur für Supabase: SQL-Migrationen, Zugriffsregeln, Einrichtungs- und Update-Skripte
└── ui/          gemeinsame Bausteine (Preact, ohne JSX): Statusanzeige, Einrichtung, Ablage,
                 Konflikt, Zustand je Dokument, „Nur in der Ablage“; Texte de/en, styles.css
```

- **Einbindung als Git-Abhängigkeit** mit festem Tag, ohne npm-Veröffentlichung:
  `"@method-commons/sync": "git+https://github.com/method-commons/sync.git#v0.1.0"` (Tag oder Commit-ID). Jede App hebt die Version einzeln an.
- **Nachladen:** Der Kern wird erst geladen, wenn eine Ablage eingerichtet ist. Ohne Ablage bleibt das
  Bundle wie heute.
- **Gleiche Technik wie die Apps:** Vite, Preact, `@preact/signals`; Logik ohne DOM mit Typprüfung und
  Unit-Tests, Oberfläche getrennt.

## Schnittstellen

### Was jede App liefert

```js
AppAdapter = {
  app: 'raci-app',                  // feste App-Kennung = Name des Repos bzw. Teil der Pages-Adresse, auch Ordnername in der Ablage
  schemaVersion: 1,                 // Model.SCHEMA_VERSION
  list(),                           // Store.listDocs(): [{ id, savedAt, data }]
  read(id),                         // Store.readDoc(id): { id, savedAt, data } | null
  write(id, data, savedAt),         // Store.writeDoc(…); false = abgelehnt (ungespeicherte Eingaben → später Konflikt)
  normalize(raw),                   // Model.normalize – Prüfung bleibt in der App
  title(data), summary(data),       // Anzeigename und Kennzahlen für Listen und Konflikte
  duplicate(data, label),           // Kopie mit neuer ID für „Beide behalten“
}
```

Die App ruft nach jedem eigenen Speichern `changed(id)` und nach dem Löschen `removed(id)` auf und
reagiert auf `onRemoteChange(id)` (Dokument neu laden). Mehr weiß die App vom Sync nicht.
Einbinden: siehe [README](../README.md#einbinden-in-eine-app).

### Was jede Ablage bietet

```js
RemoteStore = {
  check(),                                   // erreichbar, privat, Kennzeichnung angelegt, Ablauf des Zugangs
  list(app),                                 // [{ id, head }]
  get(app, id),                              // { record: { app, schemaVersion, savedAt, device, data }, head } | null
  put(app, id, record, baseHead, message),   // neuer head – oder ConflictError
  remove(app, id, baseHead, message),
  // ab Stufe 2: versions(app, id), getVersion(app, id, v), saveVersion(app, id, name)
}
```

Fehlerarten: `ConflictError`, `AuthError` (Token abgelaufen oder ohne Zugriff), `OfflineError` (Netz,
Grenze der Anfragen, Serverfehler), `SetupError` (Repo nicht gefunden, falsches Format).

`head` ist die Kennung des Stands, auf dem eine Änderung beruht: bei Supabase eine laufende Nummer, bei
GitHub der `sha` der Datei.

## Ablage A: GitHub-Repo

Jede Person bzw. jedes Team hat ein **privates Repo**; die App liest und schreibt darin über die
GitHub-API direkt aus dem Browser.

```
meine-methoden/
├── morphological-matrix-app/<id>.json
├── two-axis-matrix-app/<id>.json
├── raci-app/<id>.json
├── 5-why-app/<id>.json
└── user-story-app/<id>.json
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
| 0 | Speicherschicht der vier jüngeren Apps angleichen (`{ savedAt, data }`, gleiche Funktionen) – lohnt sich auch ohne Sync | klein · **umgesetzt** |
| 1 | Kern mit `memory`- und GitHub-Adapter, Token-Assistent, Statusanzeige, Konfliktdialog; zuerst in einer App | groß · **umgesetzt** (Morphologische Matrix) |
| 2 | Versionen (automatisch, benannt, wiederherstellen); Einbau in alle Apps | mittel |
| 3 | Supabase-Adapter mit Einrichtungsassistent, Prüfung und Team-Einladungslink | groß |
| 4 | Versionen vergleichen, Übersichtsseite aller Dokumente | mittel |
| 5 | optional: Teilen mit Rechten (Supabase), „Anmelden mit GitHub“ über Tausch-Dienst, betriebene Ablage | groß |

## Entscheidungen

Getroffen im Oktober 2026, jeweils wie empfohlen:

1. **Gemeinsames Repo** statt Code in jeder App, eingebunden als Git-Abhängigkeit mit Tag.
2. **Erste Ablage: GitHub** als günstige Probe für den Kern, Supabase danach.
3. **Anmeldung bei GitHub:** zunächst **fine-grained Token**; Tausch-Dienst später.
4. **Erste App für Stufe 1:** **Morphologische Matrix**.
5. **Ein Repo für alle Apps** in der Ablage; **Ordner je App = Name des App-Repos** (`morphological-matrix-app/` …) – sprachunabhängig und eindeutig.
6. **Übersichtsseite** unter `method-commons.github.io`: **später** (Stufe 4).
7. **Gemeinsame Dialoge** aus `ui/`, Texte über die Apps ergänzbar.

## Stand der Stufe 0

Alle fünf Apps speichern jedes Dokument im localStorage als `{ savedAt, data }` und bieten in
`js/storage.js` dieselben Funktionen – Grundlage für den App-Adapter (`list`/`read`/`write`/`remove`):

| Funktion | Bedeutung |
|---|---|
| `readDoc(id)` | `{ id, savedAt, data }` (normalisiert) oder `null` |
| `writeDoc(id, data, savedAt?)` | speichern, `savedAt` vorgegeben z. B. beim Übernehmen aus einer Ablage |
| `removeDoc(id)` | entfernen |
| `listDocs()` | alle Einträge, zuletzt gespeicherte zuerst |
| `docIdFromKey(key)` | ID zu einem Speicherschlüssel (für `storage`-Ereignisse) |

In RACI-Matrix, 2-Achsen-Matrix, 5 Why und User Stories werden ältere Einträge ohne Hülle weiter
gelesen und beim nächsten Speichern umgestellt; `load`, `save` und `all` bleiben dort als Kurzformen
für die Oberfläche.

## Mockups der Stufe 1

[morphological-matrix-app/docs/mockups/ablage](https://github.com/method-commons/morphological-matrix-app/tree/main/docs/mockups/ablage):
Menü „Ablage …“, Einrichtung mit GitHub-Repo und Token, Statusanzeige, Konfliktdialog, „Meine Matrizen“
mit Zustand je Dokument. Entschieden wie empfohlen, dazu:

- Statusanzeige in der Kopfzeile neben „Datei“ (mobil nur Symbol).
- Automatische Versionen (= Commits) höchstens alle 5 Minuten je Dokument.
- Konfliktdialog öffnet beim Klick auf die Anzeige; vor dem nächsten Übertragen des Dokuments muss entschieden sein.
- Beim Einrichten alle Dokumente zum Hochladen vorausgewählt, unveränderte Beispiele nicht.
- „Nur in der Ablage“ als Abschnitt der Dokumentliste der App.
- Dateiname `<Repo-Name der App>/<id>.json`.
- Gerätename automatisch aus dem Browser, im Dialog „Ablage“ änderbar.

## Stand der Stufe 1

Umgesetzt in diesem Repo (Version `0.1.0`, Commit `b98f3c4`) und eingebaut in die Morphologische Matrix:

- **Kern** (`client/`): Abgleich lokal zuerst; neue Dokumente sofort, weitere Änderungen je Dokument
  höchstens alle 5 Minuten (sofort bei „Jetzt übertragen“, beim Verlassen der Seite und im Hintergrund);
  Änderungen anderer Geräte werden übernommen, beidseitige Änderungen als Konflikt gemeldet. Mehrere Tabs
  teilen die Merkliste (`method-commons:sync:docs:<app>`) und gleichen unter einer Web-Sperre ab.
- **GitHub-Ablage:** Contents-API, ein Commit je Stand (Nachricht „Titel (Gerät)“), Konflikte über den `sha`;
  beim ersten Verbinden legt die App `method-commons.json` im Repo an (Kennzeichnung, bestätigt das Schreibrecht).
- **Oberfläche** (`ui/`): wie in den Mockups – Menü „Ablage …“, Einrichtung in drei Schritten,
  Statusanzeige mit Details, Konfliktdialog, Zustand je Dokument und „Nur in der Ablage“ in der Liste,
  Dialog „Ablage“ mit Token erneuern, Gerätename und Trennen.
- **Nachladen:** Die App bindet fest nur `@method-commons/sync/config` ein (ohne Importe); Kern, Oberfläche
  und Stile sind eigene Dateien und werden erst geladen, wenn eine Ablage eingerichtet ist oder „Ablage …“
  gewählt wird.

Abweichungen und Grenzen gegenüber Konzept und Mockups:

- **Konfliktdialog** zeigt je Stand Zeitpunkt, Gerät und Kennzahlen, aber keine Liste der Änderungen
  (braucht den Vergleich aus Stufe 4).
- **„Versionen …“** fehlt im Menü noch (Stufe 2); die Versionen liegen aber schon als Commits im Repo.
- **Ablauf des Tokens** steht nur da, wenn GitHub ihn im Antwortkopf mitliefert und der Browser ihn lesen
  darf (CORS); sonst „Ablauf unbekannt“. Ein abgelaufenes Token zeigt die Statusanzeige als „Zugang prüfen“.
- **Nur neu gespeichert, Inhalt gleich** (z. B. beim Öffnen eines Tabs): keine Übertragung – die Merkliste
  vergleicht einen Fingerabdruck des Inhalts.
- **Auf einem anderen Gerät gelöscht:** Das Dokument bleibt im Browser und gilt danach als „nur im Browser“.
  Fehlt ein Dokument im Browser, ohne dass es gelöscht wurde, holt die Engine es aus der Ablage zurück.
- **Neuere Version der App:** Stände mit höherer Schema-Version werden nicht übernommen („Seite neu laden“).
- **Unveränderte Beispiele** erkennt die App durch Vergleich mit den mitgelieferten Beispieldaten.

**Version 0.2.0:** Die Oberfläche ist eigenständig gestaltet (nur Klassen `mcs-…` auf den gemeinsamen
Design-Tokens), weil die Apps unterschiedliche Klassennamen für Knöpfe, Listen und Dialoge haben.

**Eingebaut in alle fünf Apps** (Oktober 2026, Kern `0.2.1`): Morphologische Matrix, RACI-Matrix,
2-Achsen-Matrix, User Stories, 5 Why – je mit `js/ui/sync.jsx` und E2E-Tests gegen eine nachgebildete
GitHub-API. Erkenntnisse beim Einbau:

- **Ungespeicherte Eingaben:** Die Apps speichern beim Tippen verzögert (300 ms). Ein Stand aus der Ablage
  wird abgelehnt, solange das geöffnete Dokument ungespeicherte Eingaben hat; nach dem Speichern meldet der
  Kern einen Konflikt. Übernommene Stände zeigt die App sofort an.
- **Änderungen melden:** In den vier jüngeren Apps meldet die Speicherschicht selbst (`Store.observe`), damit
  auch Import, Duplizieren und Beispiele erfasst sind; die Morphologische Matrix meldet nach dem Speichern.
- **Zeitplanung:** Ein früher geplanter Abgleich wird nicht durch einen späteren ersetzt (0.2.1).

Nächster Schritt: Stufe 2 (Versionen-Dialog: Liste, benannter Stand, Wiederherstellen).
