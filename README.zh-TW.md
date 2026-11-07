# Inkacre

**儲存在你自己電腦上的頁面、區塊和資料庫——你的 AI 代理也能在裡面工作。**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · 繁體中文 · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

![入門頁面](docs/screenshots/page.png)

Inkacre 是一個採用熟悉的區塊與資料庫風格的單人本機優先工作空間。所有內容都儲存在你電腦上的一個 SQLite 檔案裡：沒有帳號、沒有
雲端，也不傳送使用資料。網頁介面、供 AI 代理使用的內建 MCP 伺服器和命令引擎共用這個檔案，所以代理編輯的就是你
看到的頁面——不論是你的變更還是代理的變更，都會被記錄下來，而且可以復原。

## 一般筆記應用沒有的功能

- **時光機** — 在獨立分頁中以唯讀方式開啟任一過去時刻的整個工作空間，並把頁面還原到現在或取出一份副本。
- **搜尋附件內容** — 搜尋也能找到附加的 PDF、Word、Excel、PowerPoint、韓文（HWPX）、OpenDocument 和文字檔中的詞語，並顯示該檔案和所在的行。
- **連結地圖** — 把每個頁面畫成點，把連結、提及和關聯畫成線；以某個頁面為中心開啟，就能看到它連到哪裡。
- **隨處快速記錄** — 不必開啟 App，即可從捷徑、Raycast、指令碼或終端機新增一行文字、待辦或資料庫項目；放進收件資料夾的檔案也會進入同一頁面。
- **自動備份** — 有變更時按每小時、每天或每週備份，也可以放到另一顆磁碟；每個備份都可以檢查，或作為新工作空間開啟。
- **Markdown 資料夾鏡像** — 將整個工作空間持續匯出為資料夾中的 Markdown 和 CSV 檔案，供 Obsidian、編輯器、Spotlight 或 git 使用；每次變更後幾秒內更新（單向）。
- **代理和你一樣工作** — Claude、Codex 或任何 MCP 用戶端使用與介面相同的型別化命令，它們的變更和你的一樣被記錄、可以復原。

| 搜尋附加的 PDF 內容 | 連結地圖 | 時光機 |
| --- | --- | --- |
| ![在 PDF 中找到詞語的搜尋](docs/screenshots/search.png) | ![連結地圖](docs/screenshots/graph.png) | ![在時光機中檢視的頁面](docs/screenshots/time-machine.png) |

## 以及你對筆記應用期待的一切

- **書寫** — 巢狀區塊、斜線選單、Markdown 快速輸入、提及與提醒、反向連結、留言、頁面歷史，以及 51 個可直接使用的範本。
- **整理** — 支援 23 種屬性、關聯、彙總和公式的資料庫；篩選、排序和分組；表格、看板、清單、圖庫、行事曆、時間軸、
  動態、圖表、地圖、表單和儀表板檢視。
- **資料歸你所有** — 備份並還原到新資料夾；匯入 Markdown、文字、HTML、Word（.docx）、CSV、TSV、Excel（.xlsx、.xls）、
  OpenDocument（.ods）、EPUB、OPML、PDF 和最多 5 GB 的 ZIP 壓縮檔（包含其他筆記應用的匯出檔）；匯出為 Markdown 與 CSV、HTML、
  PDF（含子頁面時每個頁面一個 PDF）以及無損 JSON 套件。
- **多個工作空間** — 例如把個人筆記和學習內容放在同一台電腦上的不同工作空間，並隨時切換；每個工作空間的資料
  分開儲存。
- **你的語言** — English、한국어、日本語、简体中文、繁體中文、Español、Français、Deutsch、Português (Brasil)。

## 為什麼做它

- **與工作分開的個人工作空間。** 把自己的筆記和專案與公司帳號分開——不必切換帳號、不必登出，也不必為只有自己
  使用的功能購買付費方案。
- **為 AI 代理而設計。** 讓 Claude 等代理透過 MCP 閱讀、整理和更新你的文件，每一次變更都會被記錄並可以復原。
- **無須雲端帳號。** Inkacre 將工作區儲存在你的電腦上。地點搜尋和書籤預覽等選用功能會在使用時連線至外部服務。
  連接的 AI 用戶端遵循各自的資料政策。

![看板檢視](docs/screenshots/board.png)

## 快速開始

### 打包應用程式

在此資料夾中執行 `node scripts/package.mjs`，即可在 `dist/` 中產生適用於目前電腦的安裝檔，其中包含執行所需的 Node.js。

| 系統 | 檔案 | 接著 |
| --- | --- | --- |
| macOS（Apple 晶片） | `Inkacre-…-macos-arm64.dmg` | 打開後把 **Inkacre** 拖到「應用程式」資料夾，再從那裡開啟。 |
| Windows（x64） | `Inkacre-…-windows-x64.zip` | 解壓縮後開啟 `Inkacre` 資料夾中的 **Inkacre.exe**。 |
| Linux（x64） | `Inkacre-…-linux-x64.tar.gz` | 解壓縮後在 `inkacre` 資料夾中執行 `./inkacre`。 |

開啟 Inkacre 後它會在背景執行，並在瀏覽器中開啟 **http://127.0.0.1:4141**；執行中再次開啟時只會打開瀏覽器。要結束，
請在工作空間選單（左下角的工作空間名稱）最下方選擇 **結束 Inkacre**。工作空間儲存在系統的應用程式資料資料夾中
（[你的資料](#你的資料)），所以新版本只要替換應用程式就能繼續使用。

下載的檔案尚未使用 Apple 或 Microsoft 開發者憑證簽署，第一次開啟時需要允許一次：

- **macOS** 會阻止它執行。打開 **系統設定 › 隱私權與安全性**，在關於 Inkacre 的訊息旁選擇 **強制打開**。
- **Windows** 如果顯示「Windows 已保護您的電腦」，請選擇 **其他資訊 › 仍要執行**。

在 Intel Mac 上，請依下方方式從原始碼執行。

### 從原始碼執行

需要 [Node.js](https://nodejs.org) 22.16 或更新版本（建議 24）。

```sh
npm ci
npm start
```

應用程式會在 **http://127.0.0.1:4141** 開啟。第一次執行時，歡迎畫面會請你選擇語言，並選擇從簡短的導覽和範例開始，
還是從空白工作空間開始。

![歡迎畫面](docs/screenshots/welcome.png)

如果想在任何位置用命令啟動，可以在該資料夾中全域安裝：

```sh
npm install -g .
inkacre            # 與 npm start 相同
inkacre --help
```

| 選項 | 作用 |
| --- | --- |
| `--port <埠號>` | 監聽的連接埠（預設 4141，或 `LOCAL_WORKSPACE_PORT`） |
| `--data <資料夾>` | 工作空間的儲存位置（或 `LOCAL_WORKSPACE_DATA`） |
| `--lang <代碼>` | 第一次執行畫面預先選擇的語言：`en`、`ko`、`ja`、`zh-CN`、`zh-TW`、`es`、`fr`、`de`、`pt-BR` |
| `--no-open` | 不開啟瀏覽器 |

應用程式執行中再次啟動，只會開啟正在執行的應用程式。

### Docker

```sh
docker build -t inkacre .
docker run -d --name inkacre -p 127.0.0.1:4141:4141 -v pageyard-data:/data inkacre
```

連接埠只能發布到 `127.0.0.1`——請參閱[安全性](#安全性)。

### 更新

如果從原始碼執行，請在新版原始碼資料夾中執行 `npm ci`。

然後重新啟動應用程式。介面已預先建置在 `web/app/` 中，所以更新時不需要建置步驟。

## 你的資料

| 系統 | 預設資料夾 |
| --- | --- |
| macOS | `~/Library/Application Support/Pageyard` |
| Windows | `%APPDATA%\Pageyard` |
| Linux | `$XDG_DATA_HOME/pageyard`（通常為 `~/.local/share/pageyard`） |

如果複製的儲存庫中已有舊版本留下的 `data-live/` 或 `data/` 資料夾，會繼續使用它（優先 `data-live/`）。
該資料夾包含 `workspace.sqlite` 和 `blobs/`（附件）；你新建的其他工作空間儲存在其中的 `workspaces/<id>/`。
可以從左下角的 **?** 選單（**建立備份**）建立備份，並還原到新資料夾：

```sh
inkacre restore --from /備份/資料夾 --to /新的/資料夾
inkacre --data /新的/資料夾
```

還原絕不會覆寫既有的資料夾；會先檢查雜湊、完整性和修訂版本。

備份也會自動進行——預設每天一次，而且只在有變更時。在 **設定 › 備份** 中設定頻率、保留多少個自動備份以及存放位置：請選擇另一顆磁碟上的資料夾，因為同一磁碟上的備份會隨磁碟一起遺失。那裡的每個備份都可以完整檢查，或作為新工作空間在目前工作空間旁開啟。

同一資料夾中的 `file-text.sqlite` 保存為搜尋而從附件讀取的文字（刪除後會重新讀取），`backup.json`、`inbox.json`、`mirror.json` 保存這台電腦上備份、收件資料夾和 Markdown 鏡像的設定。

## 快速記錄

在 **設定 › 快速記錄** 中選擇一個頁面（或直接指定頁面），即可在這台電腦上的任何地方新增內容：

```sh
inkacre capture --todo "買牛奶"                          # 作為待辦新增到快速記錄頁面
inkacre capture --to "日記" "今天的想法"                  # 新增到依標題指定的頁面
inkacre capture --db "閱讀" --prop "作者=白先勇" "台北人"  # 在資料庫中新增項目
pbpaste | inkacre capture --to "收件匣"                   # 來自標準輸入，每行一個區塊
```

任何能傳送請求的工具都可以：向 `http://127.0.0.1:4141/api/capture` POST 類似 `{"text": "…", "as": "todo"}` 的
JSON。在 Apple 捷徑中只需一個 **取得 URL 內容** 動作。設定頁面提供可直接複製的範例。每次記錄都是一般的變更：
會出現在 **變更紀錄** 中，而且可以復原。

**收件資料夾。** 在同一設定頁面中選擇一個資料夾：其中新出現的檔案（掃描、截圖、下載）幾秒後會加到快速記錄頁面，並能像其他附件一樣搜尋內容。已經存在的檔案不會匯入，也不會刪除任何檔案（可以讓已匯入的檔案移到旁邊的 `Imported` 資料夾）。

## AI 代理（MCP）

保持應用程式執行，然後把 MCP 伺服器加到你的代理：

```json
{
  "mcpServers": {
    "inkacre": { "command": "inkacre", "args": ["mcp"] }
  }
}
```

如果沒有全域安裝、直接從複製的儲存庫執行，請把 `app-local` 的完整路徑當作 command（請參閱
[mcp.example.json](mcp.example.json)）。在 Claude Code 中：

```sh
claude mcp add inkacre -- inkacre mcp
```

如果應用程式在其他連接埠執行，請為 MCP 伺服器設定 `LOCAL_WORKSPACE_URL`（預設 `http://127.0.0.1:4141`）。

| 用途 | 工具 |
| --- | --- |
| 讀取 | `workspace_status`, `workspace_get`, `workspace_query`, `workspace_search`, `workspace_tasks`, `workspace_command_schema`, `workspace_history`, `workspace_page_version` |
| 工作空間 | `workspace_list`, `workspace_use` |
| 預覽與交換 | `workspace_preview_property_conversion`, `workspace_import_preview`, `workspace_export` |
| 變更與復原 | `workspace_apply`, `workspace_capture`, `workspace_undo`, `workspace_attachment_put`, `workspace_backup` |
| 執行紀錄 | `workspace_run_log`, `workspace_run_list`, `workspace_run_read` |

`workspace_apply` 需要一個唯一的命令 ID、代理讀取時的修訂版本以及操作清單。一批操作要麼全部儲存，要麼全部不儲存；
重試同一命令會傳回第一次的結果；過時的修訂版本會被拒絕，而不會覆寫較新的內容。代理的變更會和你自己的變更一樣
顯示在 **變更紀錄** 中。

## 語言

在歡迎畫面選擇語言，或之後在 **設定 › 語言與時間** 中變更。已經建立的頁面內容維持不變。新增一種語言只需要一個
JSON 檔案——請參閱 [ui/src/i18n/README.md](ui/src/i18n/README.md)。

## 安全性

Inkacre 沒有登入功能。它只在 `127.0.0.1` 上監聽，而且只回應使用本機主機名稱、來自它自己頁面的請求，因此其他電腦和
其他網站都無法存取它。不要把它放在網路位址上或公開代理伺服器之後。需要連網的功能——地圖圖磚和地點搜尋、書籤預覽、
自動化中的 Webhook 和電子郵件——只有在你使用或設定它們時才會執行。PDF 檔案由你電腦上已有的 Chrome、Edge 等以
Chromium 為基礎的瀏覽器產生：它以獨立的空白設定檔在背景啟動，而且無法連網；如果沒有這樣的瀏覽器，PDF 匯出會開啟列印視窗。

附件在這台電腦上的背景執行緒中讀取以供搜尋，不會傳送到任何地方。Markdown 鏡像只寫入你選擇的資料夾（初次選擇時須為空），
而且不會覆寫或刪除在那裡被修改過的檔案。

備份、收件資料夾和 Markdown 鏡像只使用你選擇的資料夾；鏡像和收件資料夾會拒絕 Inkacre 資料夾。

## 它是怎麼打造的

- **一個檔案，一份記錄。** 目前的物件以及改變它們的每條命令（含變更前後的狀態）都在一個 SQLite 檔案中。復原、頁面和資料庫歷史以及時光機都來自這份記錄，備份則完整包含這份記錄。
- **變更只有一條路。** 介面、MCP 伺服器和命令列傳送同樣的型別化命令：經結構描述檢查的操作，依據其基準修訂版本在一個交易中套用。一批操作要麼整體儲存要麼完全不儲存，重複的命令回傳第一次的結果，過期的修訂版本會被拒絕。
- **樸素的 Node.js。** 一個行程（Node 內建 SQLite，無原生模組）在 127.0.0.1 上提供介面並處理背景工作：在 worker 執行緒中讀取附件，備份、鏡像和收件資料夾也在同一行程中執行。
- **為本專案撰寫。** 編輯器使用 React 和 ProseMirror；PDF 文字讀取（含 CJK 字型與標準加密）、Office、HWPX 和 OpenDocument 讀取、.xls 匯入、ZIP64 串流匯入以及連結地圖的版面配置都在這裡撰寫，沒有引入解析函式庫。
- **在真實瀏覽器中測試。** 引擎和伺服器測試（`npm test`，每次推送由 CI 執行），以及 `scripts/ux-trace/` 中像人一樣操作介面的 Playwright 套件。

## 開發

```sh
npm install
cd ui && npm install && npm run build && cd ..   # 把介面重新建置到 web/app/
npm test                                         # 引擎測試
node scripts/package.mjs                         # 為本系統建置下載檔，輸出到 dist/
```

介面位於 `ui/`，使用 React、TypeScript 和 ProseMirror；引擎、伺服器和 MCP 伺服器是 `src/` 中的純 Node 程式碼。瀏覽器
檢查位於 `scripts/ux-trace/`（`local-suite*.mjs`），以 Playwright 針對 `node scripts/handoff-ui-fixture.mjs`
產生的測試資料執行。

## 不包含的內容

團隊、共用與權限、即時共同編輯、發布到網路、計費、應用程式內的 AI 功能以及第三方整合。

## 授權

專案程式碼採用 [MIT 授權條款](LICENSE)。第三方元件保留各自的授權。

Inkacre 是獨立專案，與 Notion Labs, Inc. 無關。
