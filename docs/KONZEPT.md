# Konzept: gemeinsame Ablage für alle Methoden-Apps

Stand: Oktober 2026 · Entscheidungen getroffen (am Ende) · Stufen 0–2 umgesetzt (Kern `0.3.0`, eingebaut in alle fünf Apps) · nächster Schritt: Stufe 4 (Versionen vergleichen).

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
  versions(app, id, page),                   // { items: [{ sha, date, message }], more } – neueste zuerst, je 30
  namedVersions(app, id),                    // [{ sha, ref, name, note, date }]
  getVersion(app, id, sha),                  // record | null
  saveVersion(app, id, { sha, name, note, date }), // benennen
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

## Funktionsvergleich: nur Browser, GitHub, Supabase

Aus Sicht der Nutzenden (Oktober 2026; Angaben zu Supabase-Plänen und -Grenzen vor einer Entscheidung prüfen).

| | Nur Browser | GitHub-Repo (umgesetzt) | Supabase-Projekt (Stufe 3) |
|---|---|---|---|
| **Grundlagen** | | | |
| Einrichtung | keine | Repo anlegen, fine-grained Token | Projekt anlegen, SQL-Skript, Adresse und Schlüssel |
| Konto nötig | nein | GitHub-Konto je Person | Konto beim Einrichten; Nutzende per E-Mail-Link |
| Kosten | keine | kostenlos | kostenloser Plan reicht für Teams; bezahlt ca. 25 $/Monat |
| Datenort | nur dieses Gerät | GitHub (USA) | wählbar, z. B. Frankfurt (EU), oder selbst betrieben |
| **Arbeiten** | | | |
| Mehrere Geräte | nein (Export/Import) | ja, Abgleich im Hintergrund | ja, Abgleich im Hintergrund |
| Offline | ja | ja, wird nachgeholt | ja, wird nachgeholt |
| Änderungen anderer Geräte | – | Abfrage alle 2 Min. | sofort (Realtime) |
| Konflikte | – | Dialog (mein/Ablage/beide) | Dialog (mein/Ablage/beide) |
| Versionen | nein | Commits und benannte Stände (Tags) | Tabelle `versions` (z. B. letzte 50, dann eine je Tag; benannte bleiben) |
| Vergleichen (Stufe 4) | – | ja | ja |
| Löschen | sofort, endgültig | aus dem Repo, bleibt in der Historie | echt löschen |
| Verlauf außerhalb der App | – | auf GitHub (Commits, Diff) | Supabase-Dashboard |
| Grenzen | ca. 5–10 MB je Browser | 5.000 API-Anfragen/h; Abgleich je Dokument höchstens alle 5 Min. | Datenbankgröße im kostenlosen Plan (ca. 500 MB) |
| **Team und Sicherheit** | | | |
| Teilen | Teilen-Link, JSON | alle mit Repo-Zugriff sehen alles | Rechte je Dokument (lesen, bearbeiten; Stufe 5) |
| Einladen | – | Repo-Zugriff und eigenes Token je Person | Einladungslink, Anmeldung per E-Mail |
| Zugang | – | Token im Browser, läuft ab | Sitzung per Anmeldung, erneuert sich selbst |
| Anonyme Umfragen (Stufe 6) | nur „im Raum“ auf einem Gerät | nicht anonym möglich | möglich (abgeben ohne lesen) |
| Datenschutz | unkritisch | Daten in den USA | EU-Region oder eigener Server |
| **Betrieb** | | | |
| Wartung | keine | Token erneuern | gering; kostenloses Projekt pausiert nach ca. 1 Woche ohne Nutzung |
| Ausstieg | Backup-Datei | Repo klonen (lesbares JSON) | Export (SQL/CSV) |
| Eigener Server | – | nein | ja (quelloffen) |
| Aufwand für uns | – | erledigt | groß: Adapter, SQL-Skript, Anmeldung, Assistent |

**Kurz:** *Nur Browser* bleibt der Standard für Einzelne auf einem Gerät. *GitHub* passt für Einzelne und kleine
Teams mit GitHub-Konten, die Nachvollziehbarkeit wollen. *Supabase* passt für Teams ohne GitHub, mit
EU-Anforderung, Rechten je Dokument oder anonymen Umfragen.

## Entwurf: Teamarbeit mit Supabase

*Stand Oktober 2026 – zum Nachdenken, nichts entschieden.* Braucht Stufe 3 (Supabase als Ablage) und das Teilen
aus Stufe 5.

**Rollen:** eine *einrichtende Person* (legt das Projekt an, verwaltet das Team) und *Teammitglieder*
(brauchen nur einen Einladungslink und ihre E-Mail-Adresse).

| Phase | Ablauf |
|---|---|
| **Einrichten** (einmalig, ca. 10 Min.) | Supabase-Projekt anlegen (Region z. B. Frankfurt) → Einrichtungsskript aus der App im SQL-Editor ausführen → in der App Projekt-Adresse und öffentlichen Schlüssel eintragen, die App prüft → mit E-Mail anmelden (Link, kein Passwort) → eigene Dokumente hochladen. Empfohlen: eigenen E-Mail-Versand eintragen (der eingebaute schafft nur wenige Mails pro Stunde). |
| **Einladen** | „Team einladen …“ erzeugt einen Einladungslink (optional nur für bestimmte Adressen/Domain), weitergeben per Chat, Mail oder QR-Code → Teammitglied öffnet ihn, die Ablage ist eingetragen, E-Mail eingeben, Anmeldelink antippen → angemeldet für alle fünf Apps im Browser; weitere Geräte nur anmelden. |
| **Arbeiten** | Neue Dokumente sind zunächst privat. „Teilen …“ an Personen oder das ganze Team (lesen/bearbeiten); geteilte Dokumente erscheinen bei den anderen in der Liste. Lokal zuerst wie heute, Änderungen anderer erscheinen sofort (Realtime). Kein Live-Mitschreiben: Hinweis „Anna bearbeitet gerade“ beugt vor, sonst Konfliktdialog. Versionen mit Namen der Person. Wer nur lesen darf, sieht das Dokument wie eine Vorschau. |
| **Verwalten** | Person entfernen beendet den Zugriff sofort; Dokumente vorher übergeben. Löschen ist echt (mit Versionen). Auflösen: alles exportieren, Projekt löschen. Kostenloser Plan pausiert nach ca. 1 Woche ohne Nutzung. |

Offene Fragen (mit vorläufiger Empfehlung):

1. Teilen je Dokument oder ein gemeinsamer Team-Bereich? – zuerst **persönlicher Bereich und Team-Bereich**, Rechte je Dokument später.
2. Ein oder mehrere Teams je Projekt? – **ein Team je Supabase-Projekt**.
3. Hinweis „bearbeitet gerade“ gleich mit Stufe 3? – **ja**.

## Entwurf: gemischter Betrieb

*Stand Oktober 2026 – zum Nachdenken, nichts entschieden.*

| Fall | Heute | Bedeutung | Aufwand |
|---|---|---|---|
| Ablage und „nur im Browser“ je Dokument | **gibt es** | je Dokument hochladen oder bewusst lokal behalten; gilt für jede Ablage. Mit Team-Bereich: *nur im Browser*, *persönlich*, *im Team*. | – |
| Ablage wechseln (z. B. GitHub → Supabase) | nein | einmaliger Umzug: aktuelle Stände und benannte Stände; automatische Zwischenstände bleiben im alten Repo; Nur-Browser-Dokumente bleiben. | klein–mittel |
| GitHub und Supabase gleichzeitig | nein | je Dokument wählen, wohin; zwei Engines, Statusanzeige und Versionen je Ablage, „Verschieben nach …“. Nutzen vor allem „Privates auf GitHub, Team in Supabase“ – deckt Supabase mit persönlichem und Team-Bereich auch ab. | groß |
| Team gemischt (manche GitHub, manche Supabase) | – | kein gemeinsamer Stand, zwei unabhängige Kopien ohne Abgleich; Austausch nur über Export/Teilen-Link. | nicht sinnvoll |

Vorläufige Empfehlung: eine Ablage je Browser (wie heute) mit „nur im Browser“ je Dokument; „Ablage umziehen …“
mit Stufe 3; Privat und Team innerhalb von Supabase trennen; zwei Ablagen gleichzeitig nur bei echtem Bedarf.
Regel für Teams: alle nutzen dieselbe Ablage.

## Alternativen zu Supabase (zu prüfen)

*Ungeprüfte Kandidaten als Ausgangspunkt – Funktionen, CORS aus dem Browser, Preise und Datenort vor einer
Entscheidung prüfen.* Maßstab: ohne eigenen Server nutzbar (oder einfach selbst zu betreiben), Anmeldung ohne
GitHub, EU möglich, Zugriffsregeln je Person/Team, Teilnahme aus dem Browser.

| Kandidat | Art | Mögliche Stärken | Mögliche Schwächen |
|---|---|---|---|
| Supabase selbst betrieben | Postgres + Dienste, quelloffen | gleiche Schnittstelle wie gehostet, Daten im eigenen Netz | Betrieb mehrerer Dienste (Docker) |
| Codeberg / Forgejo / Gitea | Git-Hosting, quelloffen | wie GitHub (Commits, Tags), EU (Codeberg) oder selbst betrieben; Adapter ähnlich `github.js` | Konten je Person, Löschen bleibt in der Historie, CORS/Token-Modell prüfen |
| PocketBase | ein Programm mit Datenbank, Anmeldung, Realtime | sehr einfach selbst zu betreiben, Zugriffsregeln | braucht einen (kleinen) Server; kein großer Hosting-Anbieter |
| Appwrite (Cloud oder selbst) | Backend-Dienst | Anmeldung, Teams, Rechte eingebaut; EU-Region | weitere Abhängigkeit, Einrichtung ähnlich aufwendig |
| CouchDB / PouchDB | Dokumentdatenbank mit eingebautem Sync | Offline-Sync und Konflikterkennung „ab Werk“, passt zu lokal zuerst | Hosting (z. B. selbst) nötig, Rechte je Dokument umständlich |
| Nextcloud / WebDAV | Dateiablage | in vielen Organisationen vorhanden, EU/eigener Server | CORS und Anmeldung aus dem Browser oft schwierig, keine Konfliktprüfung |
| Firebase | Backend-Dienst (Google) | ausgereift, Realtime, Anmeldung | US-Anbieter, nicht quelloffen, Bindung an Google |
| Lokal-zuerst-Sync (Automerge/Yjs) | CRDT | automatisches Zusammenführen statt Konfliktdialog; **auch ohne eigenen Server** über die bestehende Ablage, siehe [unten](#entwurf-crdt-automergeyjs-ohne-eigenen-server) | großer Umbau der Datenhaltung in allen Apps |

## Entwurf: CRDT (Automerge/Yjs) ohne eigenen Server

*Stand Oktober 2026 – zum Nachdenken, nichts entschieden; Angaben zu den Bibliotheken beim Prototyp prüfen.*

CRDTs (Datenstrukturen, die Änderungen verschiedener Geräte automatisch zusammenführen) brauchen selbst keinen
Server. Ein Server übernimmt sonst nur *Weiterreichen* in Echtzeit und *Aufbewahren*, solange niemand online ist.

| Weg | Wie | Echtzeit | bleibt, wenn alle offline | eigener Server | Einschätzung |
|---|---|---|---|---|---|
| **A. CRDT über die bestehende Ablage** | Dokument als CRDT-Datei in GitHub bzw. Supabase; Abgleich = holen, lokal zusammenführen, zurückschreiben; bei geändertem `sha` erneut, ohne Nachfrage | nein (Abfrage) | ja | nein | **aussichtsreich** |
| B. Supabase Realtime als Relais | Änderungen über Broadcast-Kanäle, Stand in der Datenbank | ja | ja | nein (Supabase-Projekt) | gut zusammen mit Stufe 3 |
| C. Browser zu Browser (WebRTC, z. B. y-webrtc) | direkte Verbindung der Geräte | ja | nein | Vermittlungsdienst nötig (öffentliche nur für Demos) | ungeeignet als Ablage |
| D. gehosteter Dienst (z. B. Liveblocks, Y-Sweet) | Anbieter betreibt den Sync-Server | ja | ja | nein, aber fremder Dienst mit Konto/Kosten | widerspricht „eigene Ablage“ |

**Gewinn (Weg A):** Konfliktdialog entfällt fast immer – nur bei Änderungen am *selben Feld* gewinnt eine Seite
automatisch, die andere bleibt in den Versionen. Die Ablage muss nur Bytes aufbewahren (GitHub, Supabase, vermutlich
auch die übrigen Kandidaten). Automerge führt die Änderungsgeschichte im Dokument – Versionen und Vergleichen
(Stufe 4) unabhängig von der Ablage.

**Kosten:**

- *Datenhaltung der Apps:* größter Umbau bisher (größer als Stufe 3). Automerges `change(doc, d => …)` ähnelt
  `mutate`; nötig sind Listen mit IDs statt Positionen und CRDT-Text für zeichengenaues Zusammenführen.
- *Migrationen und `normalize`:* Formatänderungen werden selbst zu CRDT-Änderungen; die Formate der Apps neu denken.
- *Größe:* große Bibliothek (Automerge mit WebAssembly), nur bei Bedarf nachladen; Dokumente wachsen mit ihrer
  Geschichte, gelegentlich verdichten.
- *Lesbarkeit:* Dateien binär statt JSON – Diffs auf GitHub unlesbar; Abhilfe: zusätzlich eine JSON-Fassung ablegen.
- *Echtzeit:* nur mit Weg B.

**Möglicher nächster Schritt:** Prototyp in der 2-Achsen-Matrix (einfachstes Datenmodell): Automerge über die
vorhandene GitHub-Ablage, zwei Geräte ändern gleichzeitig. Zu messen: Umfang des Umbaus, Dateigröße, Nachladezeit,
Verhalten bei Formatänderungen. Erst danach über CRDT für alle Apps entscheiden.

## Entwurf: Links zum Teilen aus einer GitHub-Ablage

*Stand Oktober 2026 – zum Nachdenken, nichts entschieden.* Grundsatz: Bei GitHub gelten Rechte immer für das
**ganze Repo**, nie für eine Datei – wer ein Dokument bearbeiten darf, darf alle bearbeiten.

| Weg | Wie | Empfänger braucht | aktuell | Zugriff | Einschätzung |
|---|---|---|---|---|---|
| 1. Momentaufnahme-Link | Dokument komprimiert im Link (wie `#m=…` der Morphologischen Matrix) | nichts | nein, Stand beim Teilen | nur dieses Dokument | teils vorhanden, in allen Apps vereinheitlichen |
| **2. Link zum Ansehen über ein geheimes Gist** | App legt das geteilte Dokument zusätzlich als *secret Gist* ab und aktualisiert es bei jedem Abgleich; der Link enthält nur die Gist-ID | nichts | **ja, beim Öffnen und per „Aktualisieren“** (keine Live-Ansicht nötig) | nur dieses Dokument, **nur lesen** | **aussichtsreich** |
| 3. Token im Link | zweites Token (lesen oder schreiben) steckt im Link | nichts | ja | **ganzes Repo** | nicht empfehlenswert |
| 4. Mitarbeitende im Repo | auf GitHub einladen, eigenes Token | GitHub-Konto | ja, mit Bearbeiten | ganzes Repo | geht heute schon |
| 5. eigenes Repo je Dokument | geteiltes Dokument in separatem Repo | je nach Variante | ja | nur dieses Dokument | möglich, aber umständlich |

**Weg 2 im Ablauf:** „Teilen … → Link zum Ansehen“ legt das Gist an (Link z. B. `…/5-why-app/#g=<gist-id>`);
jeder Abgleich schreibt den neuen Stand auch ins Gist (die Gist-Historie liefert nebenbei Versionen). Der Empfänger
öffnet den Link, die App lädt das Gist **ohne Anmeldung** und zeigt es nur lesend (Vorschau aus Stufe 2 mit Leiste
„Geteilt von … · Stand von …“, optional „Als Kopie speichern“). **Keine Live-Ansicht:** Neue Stände holt der
Empfänger selbst über „Aktualisieren“ in der Leiste (bzw. beim erneuten Öffnen) – kein Abfragen im Hintergrund.
„Teilen beenden“ löscht das Gist.

**Geprüft in der GitHub-Dokumentation (Oktober 2026):**

- Fine-grained Tokens haben die **Benutzer-Berechtigung „Gists“**; mit *write* dürfen sie Gists anlegen
  (`POST /gists`), ändern (`PATCH /gists/{id}`) und löschen (`DELETE /gists/{id}`).
- **Lesen eines Gists** (`GET /gists/{id}`) geht **ohne Anmeldung** (permissionless access).
- *Secret gists aren't private:* Sie erscheinen nicht in der Suche, aber wer den Link hat, kann sie sehen –
  auch bei Weitergabe. GitHub durchsucht geheime Gists nach geleakten Schlüsseln (für uns ohne Belang).
- Folge für bestehende Ablagen: Das Token braucht zusätzlich „Gists: Read and write“ – einmal erneuern
  (Einrichtungsassistent und „Token erneuern“ entsprechend ergänzen).

**Grenzen:** Ohne Anmeldung sind Abrufe pro Netzwerk begrenzt (bekannt: 60 je Stunde). Da nur beim Öffnen und
per „Aktualisieren“ abgerufen wird, reicht das auch für viele Betrachtende im selben WLAN. Bearbeiten durch andere nicht über GitHub lösen
(Wege 3–5), sondern mit Supabase (Stufen 3 und 5); bis dahin Weg 4 für vertraute Personen.

Vorläufige Empfehlung: Momentaufnahme-Link in allen Apps vereinheitlichen; Link zum Ansehen über geheimes Gist für
GitHub-Ablagen (manuell aktualisieren, Entscheidung des Maintainers); Bearbeiten durch andere mit Supabase.

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
| 1 | Kern mit `memory`- und GitHub-Adapter, Token-Assistent, Statusanzeige, Konfliktdialog; zuerst in einer App | groß · **umgesetzt** (alle fünf Apps) |
| 2 | Versionen (automatisch, benannt, wiederherstellen); Einbau in alle Apps | mittel · **umgesetzt** (Kern 0.3.0) |
| 3 | Supabase-Adapter mit Einrichtungsassistent, Prüfung und Team-Einladungslink | groß |
| 4 | Versionen vergleichen, Übersichtsseite aller Dokumente | mittel |
| 5 | optional: Teilen mit Rechten (Supabase), „Anmelden mit GitHub“ über Tausch-Dienst, betriebene Ablage | groß |
| 6 | optional: [Rückmeldungen sammeln](#optional-rückmeldungen-sammeln-anonyme-umfragen) (anonyme Umfragen, z. B. Stimmung in der Retro); setzt Stufe 3 voraus | mittel |

## Optional: Rückmeldungen sammeln (anonyme Umfragen)

Idee (Oktober 2026, noch nicht entschieden): In Retrospektiven wird oft anonym die Stimmung im Team abgefragt
(Stimmung 1–5, ROTI, Ampel, kurze Freitexte). Das wäre eine eigene kleine Methoden-App (Arbeitstitel „Retro-Puls“)
auf einem neuen, allgemeinen Baustein im Kern: **Rückmeldungen sammeln** – getrennt vom Sync eigener Dokumente und
später auch anderswo nutzbar (z. B. Gewichten in der Morphologischen Matrix, Dot-Voting).

**Nicht mit der GitHub-Ablage:**

- *Keine Anonymität:* Jede Abgabe wäre ein Commit mit dem persönlichen Token – Konto und Gerät stehen in der
  Historie, für alle mit Zugriff auf das Repo sichtbar und nicht nachträglich zu verbergen.
- *Hohe Hürde:* Alle Teilnehmenden bräuchten ein GitHub-Konto, Schreibzugriff und ein eigenes Token.
- *Gleichzeitiges Schreiben:* Viele Abgaben in derselben Minute führen bei einer Datei zu Konflikten; eine Datei je
  Person macht die Zuordnung noch deutlicher.
- *Rechte:* Das Token erlaubt Lesen und Schreiben im ganzen Repo – also auch alle Antworten und Dokumente.

**Mit Supabase (Stufe 3):**

- Moderation legt eine Umfrage an und teilt Link bzw. QR-Code; Teilnahme **ohne Konto**.
- Zugriffsregeln (Row Level Security): Teilnehmende dürfen nur **abgeben, nicht lesen**.
- Antworten **ohne Personenbezug** gespeichert: keine Konto-ID, kein Gerät, Zeit nur auf den Tag genau.
- Ergebnis erst **nach dem Schließen**, nur **zusammengefasst** und ab einer **Mindestzahl** (z. B. 3 Antworten).
- Mehrfachabgabe nur weich verhindert (Merkzeichen im Browser) – für eine Retro ausreichend.

**Grenzen (offen benennen):**

- Wer das Supabase-Projekt betreibt, sieht technisch Zugriffsprotokolle (IP-Adressen): anonym gegenüber dem Team,
  nicht vollständig gegenüber dem Betreiber.
- Freitexte können über Inhalt oder Schreibstil auf Personen schließen lassen; Skalen sind deutlich anonymer.
- Ohne Ablage bleibt die Variante „im Raum“: ein Gerät wird herumgereicht und zeigt nur die Summe – echt anonym,
  aber nur vor Ort.

**Für Stufe 3 vormerken:** das Datenmodell so anlegen, dass Umfragen und Antworten (`surveys`, `responses` ohne
`user_id`) später ohne Umbau dazukommen. Nächster Schritt erst nach Stufe 3: Mockups der Retro-App (Umfrage-Link,
Abgabe auf dem Telefon, Ergebnis nach dem Schließen).

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

## Stand der Stufe 2 (Versionen)

Umgesetzt im Kern `0.3.0` nach den [Mockups](https://github.com/method-commons/morphological-matrix-app/tree/main/docs/mockups/versionen)
mit den Entscheidungen wie empfohlen:

- **Versionen = Commits der Datei** (`GET /commits?path=…`, je Seite 30); das Gerät steht in der Commit-Nachricht.
- **Benannte Stände = annotierte Tags** `<app>/<id>/<datum>-<name>` auf den Commit, Notiz in der Nachricht des
  Tags; gleicher Name am selben Tag bekommt eine Zahl. „Stand speichern“ überträgt vorher sofort (ohne Drosselung).
- **Liste:** nach Tagen, der neueste Tag (bzw. heute) ausgeklappt, ältere eingeklappt; Filter „Nur benannte“;
  Kennzahlen je Stand werden erst geladen, wenn er zu sehen ist (`versionInfo`, je Stand zwischengespeichert).
- **Ansehen:** Die App zeigt den Stand nur lesend (`onPreview` → App sperrt Speichern und Bearbeiten), Leiste
  `PreviewBar` mit „Wiederherstellen …“, „Als Kopie öffnen“, „Zurück zum aktuellen Stand“.
- **Wiederherstellen:** überträgt zuerst den bisherigen Stand (bleibt als Version), dann den früheren als neuen
  Stand; bei offenem Konflikt abgelehnt. **Als Kopie öffnen:** neues Dokument „Titel (Stand vom …)“.
- **Ohne Ablage:** „Versionen …“ erklärt die Ablage und bietet „Ablage einrichten …“ an.
- **Zugang:** Menü „Datei → Versionen …“ der App (`ui.openVersions(id)`) und Details der Statusanzeige.

Nächster Schritt: Stufe 4 – Versionen vergleichen (ohne Übersichtsseite, die folgt später); danach Stufe 3 (Supabase).

## Stand: Teilen zum Ansehen (GitHub)

Umgesetzt im Kern `0.4.0` nach den [Mockups](https://github.com/method-commons/morphological-matrix-app/tree/main/docs/mockups/teilen)
und dem Entwurf oben (Weg 2, ohne Live-Ansicht):

- **Besitzer:** `engine.share(id)` überträgt sofort, legt ein **geheimes Gist** an (Datei `<app>.json` = Eintrag der
  Ablage) und vermerkt `{ gist, since }` im Eintrag im Repo (`share`) – so erneuern **alle Geräte** des Besitzers
  den Link bei jedem Abgleich (`PATCH /gists/{id}`). `unshare(id)` löscht das Gist; **Löschen** des Dokuments
  beendet das Teilen ebenfalls. Ein auf GitHub gelöschtes Gist wird beim nächsten Abgleich vergessen.
- **Empfänger:** Link `…/#g=<gist>` → `ui.openShared(gist)` liest **ohne Anmeldung** (`fetchShared`), prüft App
  und Datenformat und zeigt das Dokument **nur lesend** (Vorschau mit Leiste „Geteilte … von … · Stand …“).
  **Es wird nichts gespeichert** – weder im Browser noch in einer eingerichteten Ablage. „Aktualisieren“ lädt neu,
  „Als Kopie speichern“ legt bewusst ein eigenes Dokument an, „Schließen“ verwirft die Ansicht.
- **Token:** Einrichtungsassistent und „Token erneuern“ verlinken ein vorbelegtes fine-grained Token
  (Contents write, Gists write, 90 Tage). Fehlt „Gists“ (z. B. Repo in einer Organisation), erklärt „Teilen …“ das.
- **Kennzeichen** „geteilt“ in der Dokumentliste (`DocState`), Klick öffnet „Teilen …“.
