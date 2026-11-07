# Inkacre

**Seiten, Blöcke und Datenbanken, die auf deinem eigenen Computer liegen — und in denen dein KI-Agent mitarbeiten kann.**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · Deutsch · [Português (Brasil)](README.pt-BR.md)

![Einstiegsseite](docs/screenshots/page.png)

Inkacre ist ein lokaler Arbeitsbereich für eine Person im vertrauten Stil aus Blöcken und Datenbanken. Alles liegt in einer einzigen
SQLite-Datei auf deinem Rechner: kein Konto, keine Cloud, keine Telemetrie. Die Weboberfläche, ein eingebauter
MCP-Server für KI-Agenten und die Befehls-Engine teilen sich diese Datei. Ein Agent bearbeitet also dieselben Seiten
wie du — und jede Änderung, ob von dir oder vom Agenten, wird aufgezeichnet und lässt sich rückgängig machen.

## Was die meisten Notiz-Apps nicht können

- **Zurück in der Zeit** — öffne den ganzen Arbeitsbereich, wie er zu einem beliebigen früheren Zeitpunkt war,
  schreibgeschützt in einem eigenen Tab, und hole eine Seite ins Jetzt zurück oder nimm eine Kopie heraus.
- **In Dateien suchen** — die Suche findet auch Wörter in angehängten PDF-, Word-, Excel-, PowerPoint-, HWPX-,
  OpenDocument- und Textdateien und zeigt die Datei und die Zeile.
- **Eine Verknüpfungskarte** — jede Seite als Punkt, dazu die Links, Erwähnungen und Relationen zwischen ihnen; um
  eine Seite herum geöffnet, zeigt sie, womit diese verbunden ist.
- **Von überall erfassen** — füge eine Zeile, eine Aufgabe oder eine Datenbankzeile aus Kurzbefehle, Raycast, einem
  Skript oder dem Terminal hinzu, ohne die App zu öffnen; Dateien in einem Eingangsordner landen auf derselben Seite.
- **Automatische Backups** — stündlich, täglich oder wöchentlich, wenn sich etwas geändert hat, auf Wunsch auf einer
  anderen Festplatte; jedes Backup lässt sich prüfen oder als neuer Arbeitsbereich öffnen.
- **Ein Markdown-Spiegel** — der ganze Arbeitsbereich als Markdown- und CSV-Dateien in einem Ordner für Obsidian,
  einen Editor, Spotlight oder git, wenige Sekunden nach jeder Änderung aktualisiert (nur in eine Richtung).
- **Agenten arbeiten wie du** — Claude, Codex oder jeder MCP-Client nutzt dieselben typisierten Befehle wie die
  Oberfläche, und ihre Änderungen werden wie deine aufgezeichnet und lassen sich rückgängig machen.

| Suche in einem angehängten PDF | Die Verknüpfungskarte | Die Zeitmaschine |
| --- | --- | --- |
| ![Suche, die Wörter in einem PDF findet](docs/screenshots/search.png) | ![Verknüpfungskarte](docs/screenshots/graph.png) | ![Eine Seite in der Zeitmaschine](docs/screenshots/time-machine.png) |

## Und alles, was du von einer Notiz-App erwartest

- **Schreiben** — verschachtelte Blöcke, Slash-Menü, Markdown-Kürzel, Erwähnungen und Erinnerungen, Rückverweise,
  Kommentare, Seitenverlauf und 51 Vorlagen für den Start.
- **Ordnen** — Datenbanken mit 23 Eigenschaftstypen, Relationen, Rollups und Formeln; Filter, Sortierungen und
  Gruppen; Ansichten als Tabelle, Board, Liste, Galerie, Kalender, Zeitleiste, Feed, Diagramm, Karte, Formular und
  Dashboard.
- **Deine Daten bleiben deine** — Backups und Wiederherstellung in einen neuen Ordner; Import von Markdown, Text, HTML,
  Word (.docx), CSV, TSV, Excel (.xlsx, .xls), OpenDocument (.ods), EPUB, OPML, PDF und ZIP-Archiven bis 5 GB (auch Exporte anderer Notiz-Apps); Export als Markdown und CSV, HTML, PDF (mit Unterseiten ein PDF pro Seite) und als verlustfreies
  JSON-Paket.
- **Mehrere Arbeitsbereiche** — trenne zum Beispiel private Notizen und Studium in getrennten Arbeitsbereichen auf
  demselben Computer und wechsle zwischen ihnen; jeder hat seine eigenen Daten.
- **In deiner Sprache** — English, 한국어, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português (Brasil).

## Warum es das gibt

- **Ein persönlicher Arbeitsbereich, getrennt von der Arbeit.** Halte deine eigenen Notizen und Projekte aus dem
  Firmenkonto heraus — kein Kontowechsel, kein Abmelden und kein Bezahltarif für Funktionen, die nur du nutzt.
- **Für KI-Agenten gebaut.** Lass einen Agenten wie Claude deine Dokumente über MCP lesen, sortieren und aktualisieren;
  jede Änderung wird aufgezeichnet und lässt sich rückgängig machen.
- **Funktioniert ohne Cloud-Konto.** Inkacre speichert den Arbeitsbereich auf deinem Rechner. Optionale Funktionen wie
  die Ortssuche und die Lesezeichenvorschau greifen bei der Nutzung auf externe Dienste zu. Für verbundene KI-Clients
  gelten deren eigene Richtlinien zur Datenverarbeitung.

![Board-Ansicht](docs/screenshots/board.png)

## Schnellstart

### Die App paketieren

Erstelle das Paket für deinen Computer mit `node scripts/package.mjs` in diesem Ordner. Die Dateien in `dist/` enthalten die Node.js-Laufzeit.

| System | Datei | Danach |
| --- | --- | --- |
| macOS (Apple Silicon) | `Inkacre-…-macos-arm64.dmg` | Öffnen, **Inkacre** in „Programme“ ziehen und dort öffnen. |
| Windows (x64) | `Inkacre-…-windows-x64.zip` | Entpacken und **Inkacre.exe** im Ordner `Inkacre` öffnen. |
| Linux (x64) | `Inkacre-…-linux-x64.tar.gz` | Entpacken und `./inkacre` im Ordner `inkacre` ausführen. |

Beim Öffnen startet Inkacre im Hintergrund und öffnet sich im Browser unter **http://127.0.0.1:4141**; öffnest du es
erneut, während es läuft, geht nur der Browser auf. Zum Beenden wähle **Inkacre beenden** ganz unten im
Arbeitsbereichsmenü (der Name des Arbeitsbereichs unten links). Dein Arbeitsbereich liegt im App-Datenordner des Systems
([Deine Daten](#deine-daten)) – eine neue Version ersetzt einfach die App und behält alles.

Die Downloads sind noch nicht mit einem Entwicklerzertifikat von Apple oder Microsoft signiert. Beim ersten Öffnen:

- **macOS** blockiert den Start. Öffne **Systemeinstellungen › Datenschutz & Sicherheit** und wähle **Dennoch öffnen**
  neben dem Hinweis zu Inkacre.
- **Windows** zeigt eventuell „Der Computer wurde durch Windows geschützt“. Wähle **Weitere Informationen › Trotzdem
  ausführen**.

Auf einem Intel-Mac starte es wie unten beschrieben aus dem Quellcode.

### Aus dem Quellcode

Du brauchst [Node.js](https://nodejs.org) 22.16 oder neuer (24 empfohlen).

```sh
npm ci
npm start
```

Die App öffnet sich unter **http://127.0.0.1:4141**. Beim ersten Start fragt ein Willkommensbildschirm nach deiner
Sprache und ob du mit einer kurzen Anleitung und Beispielen oder mit einem leeren Arbeitsbereich beginnen möchtest.

![Willkommensbildschirm](docs/screenshots/welcome.png)

Um sie von überall als Befehl zu nutzen, installiere sie global aus dem Ordner:

```sh
npm install -g .
inkacre            # wie npm start
inkacre --help
```

| Option | Wirkung |
| --- | --- |
| `--port <Nummer>` | Port, auf dem die App lauscht (Standard 4141 oder `LOCAL_WORKSPACE_PORT`) |
| `--data <Ordner>` | Speicherort des Arbeitsbereichs (oder `LOCAL_WORKSPACE_DATA`) |
| `--lang <Code>` | Vorausgewählte Sprache auf dem Startbildschirm: `en`, `ko`, `ja`, `zh-CN`, `zh-TW`, `es`, `fr`, `de`, `pt-BR` |
| `--no-open` | Öffnet den Browser nicht |

Ein erneuter Start, während die App läuft, öffnet nur die laufende App.

### Docker

```sh
docker build -t inkacre .
docker run -d --name inkacre -p 127.0.0.1:4141:4141 -v inkacre-data:/data inkacre
```

Verwende beim Aktualisieren einer bestehenden Docker-Installation dasselbe Datenvolume.

Gib den Port nur für `127.0.0.1` frei — siehe [Sicherheit](#sicherheit).

### Aktualisieren

Wenn du die App aus dem Quellcode startest, führe `npm ci` im Ordner der neuen Version aus.

Starte die App danach neu. Die Oberfläche liegt bereits fertig gebaut in `web/app/`, ein Build-Schritt ist also nicht
nötig.

## Deine Daten

Inkacre verwendet standardmäßig das Anwendungsdatenverzeichnis des Betriebssystems. Einen bestimmten Ordner kannst du mit `--data <Ordner>` oder `LOCAL_WORKSPACE_DATA` festlegen. Verwende diesen Ordner auch nach einem Update.

Der Ordner enthält `workspace.sqlite` und `blobs/` (Anhänge); weitere Arbeitsbereiche, die du
anlegst, liegen darin unter `workspaces/<id>/`. Ein Backup erstellst du im **?**-Menü unten links
(**Backup erstellen**), wiederhergestellt wird in einen neuen Ordner:

```sh
inkacre restore --from /pfad/zum/backup --to /pfad/zum/neuen-ordner
inkacre --data /pfad/zum/neuen-ordner
```

Eine Wiederherstellung überschreibt nie einen vorhandenen Ordner; Hashes, Integrität und Revisionen werden vorher
geprüft.

Backups entstehen auch von selbst – standardmäßig einmal am Tag und nur, wenn sich etwas geändert hat. Unter
**Einstellungen › Backups** legst du fest, wie oft, wie viele automatische Backups behalten werden und wohin sie
gehen: Wähle einen Ordner auf einer anderen Festplatte, denn ein Backup auf derselben Festplatte geht mit ihr
verloren. Jedes Backup dort lässt sich vollständig prüfen oder als neuer Arbeitsbereich neben diesem öffnen.

Im selben Ordner liegen `file-text.sqlite` mit dem für die Suche aus Anhängen gelesenen Text (wird neu aufgebaut, wenn
du sie löschst) sowie die Einstellungen dieses Computers für Backups, den Eingangsordner und den Markdown-Spiegel
(`backup.json`, `inbox.json`, `mirror.json`).

## Schnellerfassung

Wähle unter **Einstellungen › Schnellerfassung** eine Seite (oder gib eine an) und füge von überall auf diesem Computer
etwas hinzu:

```sh
inkacre capture --todo "Milch kaufen"                   # auf die Schnellerfassungsseite, als Aufgabe
inkacre capture --to "Tagebuch" "Ein Gedanke für heute" # auf eine Seite mit diesem Titel
inkacre capture --db "Lesen" --prop "Autor=Thomas Mann" "Buddenbrooks"   # eine Zeile in einer Datenbank
pbpaste | inkacre capture --to "Eingang"                # Text aus stdin, ein Block pro Zeile
```

Alles, was eine Anfrage senden kann, funktioniert auch: sende JSON wie `{"text": "…", "as": "todo"}` per POST an
`http://127.0.0.1:4141/api/capture` – in Apple Kurzbefehle reicht eine Aktion **Inhalte von URL abrufen**. Die
Einstellungsseite zeigt Aufrufe zum Kopieren. Jede Erfassung ist eine normale Änderung: Sie erscheint im
**Änderungsverlauf** und lässt sich rückgängig machen.

**Eingangsordner.** Wähle auf derselben Einstellungsseite einen Ordner: Neue Dateien darin – Scans, Bildschirmfotos,
Downloads – werden wenige Sekunden später auf der Schnellerfassungsseite angefügt und sind wie jeder Anhang
durchsuchbar. Dateien, die schon da waren, bleiben außen vor, und nichts wird gelöscht (übernommene Dateien können in
einen Ordner `Imported` daneben verschoben werden).

## KI-Agenten (MCP)

Lass die App laufen und füge deinem Agenten den MCP-Server hinzu:

```json
{
  "mcpServers": {
    "inkacre": { "command": "inkacre", "args": ["mcp"] }
  }
}
```

Du startest aus einem Klon ohne globale Installation? Dann trage den vollständigen Pfad von `app-local` als Befehl ein
(siehe [mcp.example.json](mcp.example.json)). In Claude Code:

```sh
claude mcp add inkacre -- inkacre mcp
```

Läuft die App auf einem anderen Port, setze `LOCAL_WORKSPACE_URL` (Standard `http://127.0.0.1:4141`) für den
MCP-Server.

| Zweck | Werkzeuge |
| --- | --- |
| Lesen | `workspace_status`, `workspace_get`, `workspace_query`, `workspace_search`, `workspace_tasks`, `workspace_command_schema`, `workspace_history`, `workspace_page_version` |
| Arbeitsbereiche | `workspace_list`, `workspace_use` |
| Vorschau und Austausch | `workspace_preview_property_conversion`, `workspace_import_preview`, `workspace_export` |
| Ändern und wiederherstellen | `workspace_apply`, `workspace_capture`, `workspace_undo`, `workspace_attachment_put`, `workspace_backup` |
| Ausführungsnotizen | `workspace_run_log`, `workspace_run_list`, `workspace_run_read` |

`workspace_apply` erwartet eine eindeutige Befehls-ID, die vom Agenten gelesene Revision und eine Liste von
Operationen. Ein Stapel wird ganz oder gar nicht gespeichert, ein wiederholter Befehl liefert sein erstes Ergebnis,
und eine veraltete Revision wird abgelehnt, statt neuere Arbeit zu überschreiben. Änderungen des Agenten erscheinen
wie deine eigenen im **Änderungsverlauf**.

## Sprachen

Wähle eine Sprache auf dem Willkommensbildschirm oder später unter **Einstellungen › Sprache und Zeit**. Bereits
erstellte Seiten behalten ihren Text. Eine Sprache hinzuzufügen ist eine einzige JSON-Datei — siehe
[ui/src/i18n/README.md](ui/src/i18n/README.md).

## Sicherheit

Inkacre hat keine Anmeldung. Die App lauscht auf `127.0.0.1` und beantwortet nur Anfragen an einen lokalen Hostnamen,
die von ihren eigenen Seiten kommen; andere Rechner und andere Websites erreichen sie daher nicht. Stelle sie nicht auf
eine Netzwerkadresse oder hinter einen öffentlichen Proxy. Funktionen, die online gehen — Kartenkacheln und Ortssuche,
Lesezeichen-Vorschauen, Webhooks und E-Mails aus Automatisierungen — laufen nur, wenn du sie nutzt oder einrichtest.
PDF-Dateien druckt ein Chromium-basierter Browser, der schon auf deinem Computer ist (Chrome, Edge oder ein anderer),
im Hintergrund gestartet mit einem eigenen leeren Profil und ohne Netzwerkzugang; ohne einen solchen Browser öffnet der
PDF-Export das Druckfenster.

Anhänge werden für die Suche auf diesem Computer in einem Hintergrund-Thread gelesen; nichts wird irgendwohin gesendet.
Der Markdown-Spiegel schreibt nur in den Ordner, den du wählst – anfangs leer – und überschreibt oder löscht nie eine
dort geänderte Datei.

Backups, der Eingangsordner und der Markdown-Spiegel nutzen nur die Ordner, die du wählst; Spiegel und Eingangsordner
lehnen einen Inkacre-Datenordner ab.

## Wie es gebaut ist

- **Eine Datei, ein Protokoll.** Die aktuellen Objekte und jeder Befehl, der sie geändert hat – mit dem Zustand davor
  und danach –, liegen in einer SQLite-Datei. Rückgängig, Seiten- und Datenbankverlauf und die Zeitmaschine kommen aus diesem Protokoll, und jedes Backup enthält es vollständig.
- **Ein Weg für jede Änderung.** Oberfläche, MCP-Server und Befehlszeile senden dieselben typisierten Befehle: per
  Schema geprüfte Operationen, in einer Transaktion auf die Revision angewendet, von der sie ausgingen. Ein Stapel
  wird ganz oder gar nicht gespeichert, ein wiederholter Befehl liefert sein erstes Ergebnis, und eine veraltete
  Revision wird abgelehnt.
- **Schlichtes Node.js.** Ein Prozess (Nodes eingebautes SQLite, keine nativen Module) liefert die Oberfläche auf
  127.0.0.1 aus und erledigt die Hintergrundarbeit: Anhänge in einem Worker-Thread lesen, Backups, den Spiegel und den
  Eingangsordner.
- **Für dieses Projekt geschrieben.** Der Editor ist React und ProseMirror; der PDF-Textleser (inklusive CJK-Schriften
  und Standardverschlüsselung), die Leser für Office, HWPX und OpenDocument, der .xls-Import, der streamende
  ZIP64-Import und das Layout der Verknüpfungskarte sind hier geschrieben statt als Parser eingebunden.
- **Im echten Browser getestet.** Engine- und Servertests (`npm test`, von der CI bei jedem Push ausgeführt) und
  Playwright-Suites in `scripts/ux-trace/`, die die Oberfläche bedienen wie ein Mensch.

## Entwicklung

```sh
npm install
cd ui && npm install && npm run build && cd ..   # baut die Oberfläche neu nach web/app/
npm test                                         # Engine-Tests
node scripts/package.mjs                         # der Download für dieses System, nach dist/
```

Die Oberfläche besteht aus React, TypeScript und ProseMirror in `ui/`; Engine, Server und MCP-Server sind reines Node
in `src/`. Browserprüfungen liegen in `scripts/ux-trace/` (`local-suite*.mjs`) und laufen mit Playwright gegen
Testdaten, die `node scripts/handoff-ui-fixture.mjs` erzeugt.

## Nicht enthalten

Teams, Freigaben und Berechtigungen, gemeinsames Bearbeiten in Echtzeit, Veröffentlichen im Web, Abrechnung,
KI-Funktionen in der App und Integrationen von Drittanbietern.

## Lizenz

Der Projektcode steht unter der [MIT-Lizenz](LICENSE). Für Komponenten Dritter gelten ihre jeweiligen Lizenzen.

Inkacre ist ein unabhängiges Projekt und steht in keiner Verbindung zu Notion Labs, Inc.
