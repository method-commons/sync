# CLAUDE.md – Hinweise für Claude Code

Gemeinsamer Sync-Kern der Methoden-Apps von method-commons (Morphologische Matrix, 2-Achsen-Matrix,
RACI-Matrix, 5 Warum, User Stories): lokal zuerst, Versionen, austauschbare Ablage (GitHub-Repo,
Supabase-Projekt). **Kern noch nicht umgesetzt** – Stand und Entscheidungen in [docs/KONZEPT.md](docs/KONZEPT.md).

## Zusammenarbeit

- **Sprache:** Antworten, Code-Kommentare, Commit-Nachrichten und PR-Texte auf **Deutsch**.
- **Erst zeigen, dann bauen:** neue Funktionen zuerst als Mockup in einer der Apps, umsetzen nach „Ja“.
- **Die Ablage versteht das Datenformat nicht:** Prüfung und Umwandlung bleiben in den Apps (`Model.normalize`); hier keine App-spezifische Logik, keine `if (app === '…')`.
- **Apps ohne Ablage bleiben unverändert:** Der Kern wird nur nachgeladen, wenn eine Ablage eingerichtet ist.
- **Pull Requests nur auf Nachfrage.** Keine Modellbezeichnungen in Commits, PRs oder Code.
- **Fertig heißt:** Tests grün (sobald vorhanden), KONZEPT/README aktualisiert, Commit und Push.
