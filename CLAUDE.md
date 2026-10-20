# CLAUDE.md – Hinweise für Claude Code

Gemeinsamer Sync-Kern der Methoden-Apps von method-commons (Morphologische Matrix, 2-Achsen-Matrix,
RACI-Matrix, 5 Why, User Stories): lokal zuerst, Versionen, austauschbare Ablage (GitHub-Repo,
Supabase-Projekt). Stand und Entscheidungen in [docs/KONZEPT.md](docs/KONZEPT.md), Einbinden in eine App in der [README](README.md).

## Befehle

```sh
npm test                       # Lint, Typprüfung, Unit-Tests mit Mindestabdeckung
npx vitest run [datei]         # Unit-Tests (tests/)
```

Getestet wird die Oberfläche in den Apps (E2E mit nachgebildeter GitHub-API, z. B. `tests/e2e/sync.spec.js`
der Morphologischen Matrix). Änderungen hier dort mit `npm install ../sync` ausprobieren, dann Tag setzen.

## Zusammenarbeit

- **Sprache:** Antworten, Code-Kommentare, Commit-Nachrichten und PR-Texte auf **Deutsch**.
- **Erst zeigen, dann bauen:** neue Funktionen zuerst als Mockup in einer der Apps, umsetzen nach „Ja“.
- **Die Ablage versteht das Datenformat nicht:** Prüfung und Umwandlung bleiben in den Apps (`Model.normalize`); hier keine App-spezifische Logik, keine `if (app === '…')`.
- **Apps ohne Ablage bleiben unverändert:** Der Kern wird nur nachgeladen, wenn eine Ablage eingerichtet ist.
- **Pull Requests nur auf Nachfrage.** Keine Modellbezeichnungen in Commits, PRs oder Code.
- **Fertig heißt:** Tests grün, KONZEPT/README aktualisiert, Commit und Push; für Apps: neue Version mit Tag.
- **Oberfläche ohne JSX** (`h` aus Preact), damit Apps das Paket ohne eigenen Build-Schritt nutzen; Texte nur in `ui/texts.js` (de maßgeblich, en gleiche Struktur, wird geprüft).
