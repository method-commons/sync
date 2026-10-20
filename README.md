# sync – gemeinsamer Sync-Kern der Methoden-Apps

Stand: Oktober 2026 · **Konzept** · Entscheidungen getroffen · Stufe 0 (einheitliche Speicherschicht in allen Apps) umgesetzt

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
| [docs/KONZEPT.md](docs/KONZEPT.md) | Gesamtkonzept: Aufbau, Schnittstelle, Ablagen (GitHub, Supabase), Sync, Versionen, Sicherheit, Stufen, offene Entscheidungen |

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

## Lizenz

[MIT](LICENSE)
