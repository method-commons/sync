# sync – gemeinsamer Sync-Kern der Methoden-Apps

Stand: Oktober 2026 · Stufe 0 (einheitliche Speicherschicht) und **Stufe 1** (Kern, GitHub-Ablage, Oberfläche; eingebaut in die Morphologische Matrix) umgesetzt

Die Methoden-Apps von method-commons laufen ohne Server und speichern nur im Browser:

- [Morphologische Matrix](https://github.com/method-commons/morphological-matrix-app)
- [2-Achsen-Matrix](https://github.com/method-commons/two-axis-matrix-app)
- [RACI-Matrix](https://github.com/method-commons/raci-app)
- [5 Why](https://github.com/method-commons/5-why-app)
- [User Stories](https://github.com/method-commons/user-story-app)

Dieses Repo soll die **gemeinsame, optionale Speicherung außerhalb des Browsers** aufnehmen: Dokumente auf
allen Geräten, Versionen, später Teilen im Team. Die Apps bleiben ohne Konto in vollem Umfang nutzbar.

## Inhalt

| Datei | Inhalt |
|---|---|
| [docs/KONZEPT.md](docs/KONZEPT.md) | Gesamtkonzept: Aufbau, Schnittstelle, Ablagen (GitHub, Supabase), Sync, Versionen, Sicherheit, Stufen, Entscheidungen, Stand |
| `client/engine.js` | Abgleich: lokal zuerst, Drosselung (5 Min. je Dokument), Konflikte, Löschen, mehrere Tabs |
| `client/controller.js` | je App: Einstellungen, Start, Einrichten, Token erneuern, Gerätename, Trennen, Ereignisse anderer Tabs |
| `client/config.js` | gemeinsame Einstellungen aller Apps (localStorage), Gerätename – ohne Importe |
| `client/github.js`, `client/memory.js` | Ablagen: GitHub-Repo (Contents-API), Speicher (Tests) |
| `ui/index.js`, `ui/texts.js`, `ui/styles.css` | Oberfläche (Preact ohne JSX, eigene Klassen `mcs-…` auf den gemeinsamen Tokens): Statusanzeige, Einrichtung, Ablage, Konflikt, Zustand je Dokument |

Grundlage ist das Backend-Konzept der Morphologischen Matrix
([docs/BACKEND.md](https://github.com/method-commons/morphological-matrix-app/blob/main/docs/BACKEND.md)).
Dieses Konzept verallgemeinert es auf alle Apps und ergänzt GitHub als Ablage.

## Kurzfassung

- **Lokal zuerst:** Der Browser bleibt die Arbeitskopie; die Sync-Schicht gleicht im Hintergrund ab.
- **Ein Kern für alle Apps:** Sync, Konflikte, Versionen und die gemeinsamen Dialoge stehen hier, nicht
  fünfmal kopiert in den Apps. Jede App liefert nur einen kleinen Adapter.
- **Die Ablage versteht das Datenformat nicht:** Sie speichert JSON-Dokumente mit App-Kennung. Neue
  Schema-Versionen einer App ändern an der Ablage nichts.
- **Austauschbare Ablagen:** zuerst ein **GitHub-Repo** der Person bzw. des Teams, danach ein
  **Supabase-Projekt**; ein vom Maintainer betriebener Server erst bei Nachfrage.

## Einbinden in eine App

```sh
npm install git+https://github.com/method-commons/sync.git#<Tag oder Commit-ID>
```

Über `git+https` statt `github:` – npm schriebe sonst `git+ssh` ins Lockfile, und die CI hat keinen
SSH-Schlüssel. Prüfen: In `package-lock.json` muss `resolved` mit `git+https://` beginnen.

```js
// fest eingebunden – klein, ohne Importe
import { CONFIG_KEY, hasConfig } from '@method-commons/sync/config';

// erst bei Bedarf (eingerichtet oder „Ablage …“ gewählt)
const [core, syncUi] = await Promise.all([
  import('@method-commons/sync'), import('@method-commons/sync/ui'), import('@method-commons/sync/ui/styles.css'),
]);
const controller = new core.SyncController({ adapter, engine: { messages: syncUi.textsFor(lang).commit } });
const ui = syncUi.createSyncUI({ controller, lang, nouns: { one: 'Matrix', many: 'Matrizen', list: 'Meine Matrizen' },
  currentId: () => docId, onOpenDoc, toast, onPreview });   // onPreview(p | null): früheren Stand nur lesend zeigen
controller.onRemoteChange(id => reloadDoc(id));
render(h(ui.StatusChip), slotInHeader);   // Statusanzeige; in der Dokumentliste: ui.DocState, ui.RemoteOnly
render(h(ui.PreviewBar), slotAboveContent); // Leiste beim Ansehen eines früheren oder geteilten Stands
controller.start();
// nach dem Speichern: controller.changed(id) · nach dem Löschen: controller.removed(id)
// Menü: ui.openStorage(), ui.openVersions(id), ui.openShare(id) · vor einem Dokumentwechsel: ui.endPreview()
// Link `#g=<gist>` (geteilt zum Ansehen): ui.openShared(gist) – zeigt nur lesend über onPreview({ kind: 'shared', data }),
// speichert nichts; erst „Als Kopie speichern“ legt über adapter.duplicate/write ein Dokument an
```

- `adapter`: siehe [KONZEPT – Was jede App liefert](docs/KONZEPT.md#was-jede-app-liefert); Kennung `app` = Name des App-Repos.
- In `vite.config.js`: `resolve: { dedupe: ['preact'] }` (eine Preact-Instanz für App und Oberfläche).
- Vorlage: `js/ui/sync.jsx` der [Morphologischen Matrix](https://github.com/method-commons/morphological-matrix-app).

## Entwicklung

```sh
npm ci
npm test          # Lint, Typprüfung, Unit-Tests mit Mindestabdeckung
```

`.npmrc` setzt `legacy-peer-deps` (npm 10 scheitert sonst an optionalen Peer-Abhängigkeiten von Vitest).
Eine neue Version: Tests grün, `version` in `package.json` erhöhen, Tag `vX.Y.Z` setzen und pushen; die Apps
heben ihre Abhängigkeit einzeln an.

## Lizenz

[MIT](LICENSE)
