# Inkacre

**Pages, blocks and databases that live on your own computer — and that your AI agent can work in.**

English · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

![Getting started page](docs/screenshots/page.png)

Inkacre is a single-user, local-first workspace in the familiar style of blocks and databases. Everything is kept in one SQLite
file on your machine: no account, no cloud, no telemetry. The web interface, a built-in MCP server for AI agents and
the command engine all share that file, so an agent edits the same pages you do — and every change, yours or the
agent's, is recorded and can be undone.

## What most note apps don't do

- **Go back in time** — open the whole workspace as it was at any earlier moment, read-only in its own tab, and bring
  a page back to now or take out a copy.
- **Search inside files** — search also finds the words in attached PDF, Word, Excel, PowerPoint, HWPX, OpenDocument
  and text files, and shows the file and the line.
- **A link map** — every page as a point, with the links, mentions and relations between them; open it around one page
  to see what it touches.
- **Capture from anywhere** — add a line, a to-do or a database row from Shortcuts, Raycast, a script or the terminal
  without opening the app; files dropped into an inbox folder land on the same page.
- **Automatic backups** — hourly, daily or weekly when something changed, to another disk if you like; any backup can
  be checked or opened as a new workspace.
- **A Markdown mirror** — the whole workspace as Markdown and CSV files in a folder for Obsidian, an editor, Spotlight
  or git, updated a few seconds after each change (one way).
- **Agents work like you do** — Claude, Codex or any MCP client uses the same typed commands as the interface, and its
  changes are recorded and undoable like yours.

| Search inside an attached PDF | The link map | The time machine |
| --- | --- | --- |
| ![Search finding words inside a PDF](docs/screenshots/search.png) | ![Link map](docs/screenshots/graph.png) | ![A page in the time machine](docs/screenshots/time-machine.png) |

## And everything you'd expect from a note app

- **Write** — nested blocks, slash menu, Markdown shortcuts, mentions and reminders, backlinks, comments, page history
  and 51 templates to start from.
- **Organize** — databases with 23 property types, relations, rollups and formulas; filters, sorts and groups; table,
  board, list, gallery, calendar, timeline, feed, chart, map, form and dashboard views.
- **Keep it yours** — backups and restore into a new folder; import Markdown, text, HTML, Word (.docx), CSV, TSV,
  Excel (.xlsx, .xls), OpenDocument (.ods), EPUB, OPML, PDF and ZIP archives up to 5 GB (exports from other note apps included);
  export Markdown & CSV, HTML, PDF (with subpages, one PDF per page) and a lossless JSON bundle.
- **Several workspaces** — keep, say, personal notes and study apart in separate workspaces on the same computer and
  switch between them; each has its own data.
- **In your language** — English, 한국어, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português (Brasil).

## Why it exists

- **A personal workspace that stays apart from work.** Keep your own notes and projects out of a company account — no
  switching accounts, no logging out, and no paid plan for features you only use by yourself.
- **Built for AI agents.** Let an agent such as Claude read, sort and update your documents over MCP, with every change
  recorded and undoable.
- **Works without a cloud account.** Inkacre stores your workspace on your computer. Optional features such as place
  search and bookmark previews contact external services when you use them. AI clients you connect have their own data policies.

![Board view](docs/screenshots/board.png)

## Quick start

### Build the app

Build the package for your computer with `node scripts/package.mjs` from this folder. The files in `dist/` include the runtime.

| System | File | Then |
| --- | --- | --- |
| macOS (Apple silicon) | `Inkacre-…-macos-arm64.dmg` | Open it, drag **Inkacre** onto Applications and open it from there. |
| Windows (x64) | `Inkacre-…-windows-x64.zip` | Unzip and open **Inkacre.exe** in the `Inkacre` folder. |
| Linux (x64) | `Inkacre-…-linux-x64.tar.gz` | Extract and run `./inkacre` in the `inkacre` folder. |

Opening Inkacre starts it in the background and opens it in your browser at **http://127.0.0.1:4141**; opening it
again while it runs just brings up the browser. To stop it, choose **Quit Inkacre** at the bottom of the workspace
menu (the workspace name at the bottom left). Your workspace is kept in your system's app data folder
([Your data](#your-data)), so a newer version simply replaces the app and keeps everything.

The downloads aren't signed with an Apple or Microsoft developer certificate yet, so the first time you open one:

- **macOS** stops it. Open **System Settings › Privacy & Security** and choose **Open Anyway** next to the message
  about Inkacre.
- **Windows** may show "Windows protected your PC". Choose **More info › Run anyway**.

On an Intel Mac, run it from source as below.

### From source

You need [Node.js](https://nodejs.org) 22.16 or newer (24 recommended).

```sh
npm ci
npm start
```

The app opens at **http://127.0.0.1:4141**. On first run a welcome screen asks for your language and whether to
start with a short guide and examples or with an empty workspace.

![Welcome screen](docs/screenshots/welcome.png)

To use it as a command from anywhere, install it globally from the folder:

```sh
npm install -g .
inkacre            # same as npm start
inkacre --help
```

| Option | What it does |
| --- | --- |
| `--port <number>` | Port to listen on (default 4141, or `LOCAL_WORKSPACE_PORT`) |
| `--data <folder>` | Where the workspace is kept (or `LOCAL_WORKSPACE_DATA`) |
| `--lang <code>` | Language preselected on the first-run screen: `en`, `ko`, `ja`, `zh-CN`, `zh-TW`, `es`, `fr`, `de`, `pt-BR` |
| `--no-open` | Don't open the browser |

Starting it again while it runs just opens the running app.

### Docker

```sh
docker build -t inkacre .
docker run -d --name inkacre -p 127.0.0.1:4141:4141 -v inkacre-data:/data inkacre
```

When updating an existing Docker installation, reuse its data volume.

Publish the port to `127.0.0.1` only — see [Security](#security).

### Updating

To update a source installation, run `npm ci` in the newer source folder.

Then restart the app. The interface comes prebuilt in `web/app/`, so updating needs no build step.

## Your data

Inkacre uses your operating system’s application data directory by default. To use a specific folder, pass `--data <folder>` or set `LOCAL_WORKSPACE_DATA`. Keep using that folder when updating.

The folder holds `workspace.sqlite` and `blobs/` (attachments); other workspaces you create are kept in
`workspaces/<id>/` inside it. Make a backup from the **?** menu at the bottom left (**Create backup**), and restore one
into a new folder:

```sh
inkacre restore --from /path/to/backup --to /path/to/new-folder
inkacre --data /path/to/new-folder
```

A restore never overwrites an existing folder; hashes, integrity and revisions are checked first.

Backups are also made on their own — once a day by default, only when something changed. **Settings › Backups** sets
how often, how many scheduled backups to keep and where they go: choose a folder on another disk, since a backup on
the same disk goes with it. Each backup there can be checked whole or opened as a new workspace beside this one.

The same folder holds `file-text.sqlite`, the text read from attachments for search (rebuilt if you delete it), and
this computer's settings for backups, the inbox folder and the Markdown mirror (`backup.json`, `inbox.json`,
`mirror.json`).

## Quick capture

Choose a page in **Settings › Quick capture** (or name one), then add to it from anywhere on this computer:

```sh
inkacre capture --todo "Buy milk"                       # to the quick capture page, as a to-do
inkacre capture --to "Journal" "A thought for today"    # to a page by its title
inkacre capture --db "Reading" --prop "Author=Toni Morrison" "Beloved"   # a row in a database
pbpaste | inkacre capture --to "Inbox"                  # text from stdin, one block per line
```

Anything that can send a request works too: POST JSON such as `{"text": "…", "as": "todo"}` to
`http://127.0.0.1:4141/api/capture` — in Apple Shortcuts, one **Get Contents of URL** action. The settings page shows
ready-to-copy calls. Each capture is an ordinary change: it appears in **Change history** and can be undone.

**Inbox folder.** On the same settings page, choose a folder: new files that appear in it — scans, screenshots,
downloads — are added to the quick capture page a few seconds later and can be searched like any attachment. Files
already there are left out, and nothing is deleted (taken files can be moved into an `Imported` folder beside them).

## AI agents (MCP)

Keep the app running and add the MCP server to your agent:

```json
{
  "mcpServers": {
    "inkacre": { "command": "inkacre", "args": ["mcp"] }
  }
}
```

Running from a clone without a global install? Use the full path of `app-local` as the command (see
[mcp.example.json](mcp.example.json)). In Claude Code:

```sh
claude mcp add inkacre -- inkacre mcp
```

If the app runs on another port, set `LOCAL_WORKSPACE_URL` (default `http://127.0.0.1:4141`) for the MCP server.

| Use | Tools |
| --- | --- |
| Read | `workspace_status`, `workspace_get`, `workspace_query`, `workspace_search`, `workspace_tasks`, `workspace_command_schema`, `workspace_history`, `workspace_page_version` |
| Workspaces | `workspace_list`, `workspace_use` |
| Preview and exchange | `workspace_preview_property_conversion`, `workspace_import_preview`, `workspace_export` |
| Change and recover | `workspace_apply`, `workspace_capture`, `workspace_undo`, `workspace_attachment_put`, `workspace_backup` |
| Run notes | `workspace_run_log`, `workspace_run_list`, `workspace_run_read` |

`workspace_apply` takes a unique command id, the revision the agent read and a list of operations. A batch is saved
whole or not at all, a retried command returns its first result, and a stale revision is rejected instead of
overwriting newer work. Agent changes appear in **Change history** like your own.

## Languages

Pick a language on the welcome screen or later in **Settings › Language & time**. Pages you already made keep their
text. Adding a language is one JSON file — see [ui/src/i18n/README.md](ui/src/i18n/README.md).

## Security

Inkacre has no sign-in. It listens on `127.0.0.1` and answers only requests that name a local host and come
from its own pages, so other machines and other websites can't reach it. Don't put it on a network address or behind
a public proxy. Features that go online — map tiles and place search, bookmark previews, webhooks and email from
automations — run only when you use or configure them. PDF files are printed by a Chrome, Edge or other
Chromium-based browser already on your computer, started in the background with an empty profile of its own and no
network access; without one, PDF export opens the print window.

Attachments are read for search on this computer, in a background thread; nothing is sent anywhere. The Markdown
mirror writes only into the folder you choose — empty at first — and never overwrites or removes a file changed there.

Backups, the inbox folder and the Markdown mirror only use the folders you choose; the mirror and the inbox folder
refuse a Inkacre data folder.

## How it's built

- **One file, one log.** The current objects and every command that changed them — with the state before and after —
  live in one SQLite file. Undo, page and database history and the time machine all come from that log, and a backup carries it whole.
- **One way to change anything.** The interface, the MCP server and the command line send the same typed commands:
  operations checked against a schema and applied in one transaction against the revision they were based on. A batch
  is saved whole or not at all, a repeated command returns its first result, and a stale revision is refused.
- **Plain Node.js.** One process (Node's built-in SQLite, no native modules) serves the interface on 127.0.0.1 and
  does the background work: reading attachments in a worker thread, backups, the mirror and the inbox folder.
- **Written for this project.** The editor is React and ProseMirror; the PDF text reader (CJK fonts and standard
  encryption included), the Office, HWPX and OpenDocument readers, the .xls importer, streaming ZIP64 import and the
  link map's layout are written here rather than pulled in as parsers.
- **Tested in a real browser.** Engine and server tests (`npm test`, run by CI on every push) and Playwright suites in
  `scripts/ux-trace/` that drive the interface the way a person would.

## Development

```sh
npm install
cd ui && npm install && npm run build && cd ..   # rebuild the interface into web/app/
npm test                                         # engine tests
node scripts/package.mjs                         # the download for this system, into dist/
```

The interface is React, TypeScript and ProseMirror in `ui/`; the engine, server and MCP server are plain Node in
`src/`. Browser checks live in `scripts/ux-trace/` (`local-suite*.mjs`, run with Playwright against a fixture made by
`node scripts/handoff-ui-fixture.mjs`).

## Not included

Teams, sharing and permissions, real-time co-editing, publishing to the web, billing, AI features inside the app, and
third-party integrations.

## License

Project code is available under the [MIT License](LICENSE). The Inkacre name and logo are reserved as brand assets. Third-party components retain their own licenses.

The [UI bundle notices](web/app/THIRD_PARTY_NOTICES.md) and [vendored browser bundle notices](web/vendor/THIRD_PARTY_NOTICES.txt) accompany the app. Desktop downloads also include the bundled Node.js license in the runtime folder.

Inkacre is an independent project and is not affiliated with Notion Labs, Inc.
