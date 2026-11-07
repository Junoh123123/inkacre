# Inkacre

**保存在你自己电脑上的页面、块和数据库——你的 AI 智能体也能在里面工作。**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · 简体中文 · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

![入门页面](docs/screenshots/page.png)

Inkacre 是一个采用熟悉的块与数据库风格的单人本地优先工作空间。所有内容都保存在你电脑上的一个 SQLite 文件里：没有账号，没有云端，
也不发送使用数据。网页界面、供 AI 智能体使用的内置 MCP 服务器和命令引擎共用这个文件，所以智能体编辑的就是你看到的
页面——无论是你的修改还是智能体的修改，都会被记录下来，并且可以撤销。

## 一般笔记应用没有的功能

- **时光机** — 在单独的标签页中以只读方式打开任意过去时刻的整个工作空间，并把页面恢复到现在或取出一份副本。
- **搜索附件内容** — 搜索也能找到附加的 PDF、Word、Excel、PowerPoint、韩文（HWPX）、OpenDocument 和文本文件中的词语，并显示该文件和所在的行。
- **链接地图** — 把每个页面画成点，把链接、提及和关联画成线；以某个页面为中心打开，就能看到它连到哪里。
- **随处快速记录** — 无需打开应用，即可从快捷指令、Raycast、脚本或终端添加一行文字、待办或数据库条目；放进收件文件夹的文件也会进入同一页面。
- **自动备份** — 有变化时按每小时、每天或每周备份，也可以放到另一块磁盘；每个备份都可以检查，或作为新工作空间打开。
- **Markdown 文件夹镜像** — 将整个工作空间持续导出为文件夹中的 Markdown 和 CSV 文件，供 Obsidian、编辑器、Spotlight 或 git 使用；每次更改后几秒内更新（单向）。
- **智能体和你一样工作** — Claude、Codex 或任何 MCP 客户端使用与界面相同的类型化命令，它们的修改和你的一样被记录、可以撤销。

| 搜索附加的 PDF 内容 | 链接地图 | 时光机 |
| --- | --- | --- |
| ![在 PDF 中找到词语的搜索](docs/screenshots/search.png) | ![链接地图](docs/screenshots/graph.png) | ![在时光机中查看的页面](docs/screenshots/time-machine.png) |

## 以及你对笔记应用期待的一切

- **写作** — 嵌套块、斜杠菜单、Markdown 快捷输入、提及和提醒、反向链接、评论、页面历史，以及 51 个可直接使用的模板。
- **整理** — 支持 23 种属性、关联、汇总和公式的数据库；筛选、排序和分组；表格、看板、列表、画廊、日历、时间线、
  动态、图表、地图、表单和仪表板视图。
- **数据归你所有** — 备份并恢复到新文件夹；导入 Markdown、文本、HTML、Word（.docx）、CSV、TSV、Excel（.xlsx、.xls）、
  OpenDocument（.ods）、EPUB、OPML、PDF 和最大 5 GB 的 ZIP 压缩包（包括其他笔记应用的导出文件）；导出为 Markdown 和 CSV、HTML、
  PDF（含子页面时每个页面一个 PDF）以及无损 JSON 包。
- **多个工作空间** — 例如把个人笔记和学习内容放在同一台电脑上的不同工作空间里，并随时切换；每个工作空间的数据
  分开保存。
- **你的语言** — English、한국어、日本語、简体中文、繁體中文、Español、Français、Deutsch、Português (Brasil)。

## 为什么做它

- **与工作分开的个人工作空间。** 把自己的笔记和项目与公司账号分开——不用切换账号，不用退出登录，也不必为只有自己
  使用的功能购买付费方案。
- **为 AI 智能体而设计。** 让 Claude 等智能体通过 MCP 阅读、整理和更新你的文档，每一次修改都会被记录并可以撤销。
- **无需云端账号。** Inkacre 将工作区保存在你的电脑上。地点搜索和书签预览等可选功能会在使用时连接外部服务。
  连接的 AI 客户端遵循各自的数据政策。

![看板视图](docs/screenshots/board.png)

## 快速开始

### 打包应用

在此文件夹中运行 `node scripts/package.mjs`，即可在 `dist/` 中生成适用于当前电脑的安装包，其中包含运行所需的 Node.js。

| 系统 | 文件 | 然后 |
| --- | --- | --- |
| macOS（Apple 芯片） | `Inkacre-…-macos-arm64.dmg` | 打开后把 **Inkacre** 拖到“应用程序”文件夹，再从那里打开。 |
| Windows（x64） | `Inkacre-…-windows-x64.zip` | 解压后打开 `Inkacre` 文件夹中的 **Inkacre.exe**。 |
| Linux（x64） | `Inkacre-…-linux-x64.tar.gz` | 解压后在 `inkacre` 文件夹中运行 `./inkacre`。 |

打开 Inkacre 后它会在后台运行，并在浏览器中打开 **http://127.0.0.1:4141**；运行中再次打开时只会打开浏览器。要退出，
请在工作空间菜单（左下角的工作空间名称）最下方选择 **退出 Inkacre**。工作空间保存在系统的应用数据文件夹中
（[你的数据](#你的数据)），所以新版本只需替换应用即可继续使用。

下载的文件尚未使用 Apple 或 Microsoft 开发者证书签名，第一次打开时需要允许一次：

- **macOS** 会阻止它运行。打开 **系统设置 › 隐私与安全性**，在关于 Inkacre 的提示旁选择 **仍要打开**。
- **Windows** 如果显示“Windows 已保护你的电脑”，请选择 **更多信息 › 仍要运行**。

在 Intel Mac 上，请按下面的方法从源码运行。

### 从源码运行

需要 [Node.js](https://nodejs.org) 22.16 或更高版本（推荐 24）。

```sh
npm ci
npm start
```

应用会在 **http://127.0.0.1:4141** 打开。首次运行时，欢迎界面会让你选择语言，并选择从简短的指南和示例开始，
还是从空白工作空间开始。

![欢迎界面](docs/screenshots/welcome.png)

如果想在任何位置用命令启动，可以在该文件夹中全局安装：

```sh
npm install -g .
inkacre            # 与 npm start 相同
inkacre --help
```

| 选项 | 作用 |
| --- | --- |
| `--port <端口号>` | 监听的端口（默认 4141，或 `LOCAL_WORKSPACE_PORT`） |
| `--data <文件夹>` | 工作空间的保存位置（或 `LOCAL_WORKSPACE_DATA`） |
| `--lang <代码>` | 首次运行界面预选的语言：`en`、`ko`、`ja`、`zh-CN`、`zh-TW`、`es`、`fr`、`de`、`pt-BR` |
| `--no-open` | 不打开浏览器 |

应用运行时再次启动，只会打开正在运行的应用。

### Docker

```sh
docker build -t inkacre .
docker run -d --name inkacre -p 127.0.0.1:4141:4141 -v pageyard-data:/data inkacre
```

端口只能发布到 `127.0.0.1`——参见[安全](#安全)。

### 更新

如果从源代码运行，请在新版源代码文件夹中运行 `npm ci`。

然后重新启动应用。界面已预先构建在 `web/app/` 中，所以更新时不需要构建步骤。

## 你的数据

| 系统 | 默认文件夹 |
| --- | --- |
| macOS | `~/Library/Application Support/Pageyard` |
| Windows | `%APPDATA%\Pageyard` |
| Linux | `$XDG_DATA_HOME/pageyard`（通常为 `~/.local/share/pageyard`） |

如果克隆的仓库中已有旧版本留下的 `data-live/` 或 `data/` 文件夹，会继续使用它（优先 `data-live/`）。
该文件夹包含 `workspace.sqlite` 和 `blobs/`（附件）；你新建的其他工作空间保存在其中的 `workspaces/<id>/`。
可以通过左下角的 **?** 菜单（**创建备份**）创建备份，并恢复到新文件夹：

```sh
inkacre restore --from /备份/文件夹 --to /新的/文件夹
inkacre --data /新的/文件夹
```

恢复永远不会覆盖已有的文件夹；会先检查哈希、完整性和修订版本。

备份也会自动进行——默认每天一次，且只在有变化时。在 **设置 › 备份** 中设定频率、保留多少个自动备份以及存放位置：请选择另一块磁盘上的文件夹，因为同一磁盘上的备份会随磁盘一起丢失。那里的每个备份都可以完整检查，或作为新工作空间在当前工作空间旁打开。

同一文件夹中的 `file-text.sqlite` 保存为搜索而从附件读取的文本（删除后会重新读取），`backup.json`、`inbox.json`、`mirror.json` 保存这台电脑上备份、收件文件夹和 Markdown 镜像的设置。

## 快速记录

在 **设置 › 快速记录** 中选择一个页面（或直接指定页面），即可在这台电脑上的任何地方添加内容：

```sh
inkacre capture --todo "买牛奶"                          # 作为待办添加到快速记录页面
inkacre capture --to "日记" "今天的想法"                  # 添加到按标题指定的页面
inkacre capture --db "阅读" --prop "作者=鲁迅" "呐喊"      # 在数据库中添加条目
pbpaste | inkacre capture --to "收件箱"                   # 来自标准输入，每行一个块
```

任何能发送请求的工具都可以：向 `http://127.0.0.1:4141/api/capture` POST 类似 `{"text": "…", "as": "todo"}` 的
JSON。在 Apple 快捷指令中只需一个 **获取 URL 内容** 操作。设置页面提供可直接复制的示例。每次记录都是普通的更改：
会出现在 **更改记录** 中，并且可以撤销。

**收件文件夹。** 在同一设置页面中选择一个文件夹：其中新出现的文件（扫描件、截图、下载）几秒后会添加到快速记录页面，并能像其他附件一样搜索内容。已经存在的文件不会导入，也不会删除任何文件（可以让已导入的文件移到旁边的 `Imported` 文件夹）。

## AI 智能体（MCP）

保持应用运行，然后把 MCP 服务器添加到你的智能体：

```json
{
  "mcpServers": {
    "inkacre": { "command": "inkacre", "args": ["mcp"] }
  }
}
```

如果没有全局安装、直接从克隆的仓库运行，请把 `app-local` 的完整路径作为 command（参见
[mcp.example.json](mcp.example.json)）。在 Claude Code 中：

```sh
claude mcp add inkacre -- inkacre mcp
```

如果应用运行在其他端口，请为 MCP 服务器设置 `LOCAL_WORKSPACE_URL`（默认 `http://127.0.0.1:4141`）。

| 用途 | 工具 |
| --- | --- |
| 读取 | `workspace_status`, `workspace_get`, `workspace_query`, `workspace_search`, `workspace_tasks`, `workspace_command_schema`, `workspace_history`, `workspace_page_version` |
| 工作空间 | `workspace_list`, `workspace_use` |
| 预览与交换 | `workspace_preview_property_conversion`, `workspace_import_preview`, `workspace_export` |
| 修改与恢复 | `workspace_apply`, `workspace_capture`, `workspace_undo`, `workspace_attachment_put`, `workspace_backup` |
| 运行记录 | `workspace_run_log`, `workspace_run_list`, `workspace_run_read` |

`workspace_apply` 需要一个唯一的命令 ID、智能体读取时的修订版本以及操作列表。一批操作要么全部保存，要么全部不保存；
重试同一命令会返回第一次的结果；过时的修订版本会被拒绝，而不会覆盖较新的内容。智能体的修改会和你自己的修改一样
显示在 **更改记录** 中。

## 语言

在欢迎界面选择语言，或之后在 **设置 › 语言和时间** 中更改。已经创建的页面内容保持不变。添加一种语言只需要一个
JSON 文件——参见 [ui/src/i18n/README.md](ui/src/i18n/README.md)。

## 安全

Inkacre 没有登录功能。它只在 `127.0.0.1` 上监听，并且只响应使用本地主机名、来自它自己页面的请求，因此其他电脑和
其他网站都无法访问它。不要把它放在网络地址上或公开代理之后。需要联网的功能——地图图块和地点搜索、书签预览、
自动化中的 Webhook 和电子邮件——只有在你使用或配置它们时才会运行。PDF 文件由你电脑上已有的 Chrome、Edge 等基于
Chromium 的浏览器生成：它以独立的空配置文件在后台启动，并且不能访问网络；如果没有这样的浏览器，PDF 导出会打开打印窗口。

附件在这台电脑上的后台线程中读取以供搜索，不会发送到任何地方。Markdown 镜像只写入你选择的文件夹（初次选择时须为空），
并且不会覆盖或删除在那里被修改过的文件。

备份、收件文件夹和 Markdown 镜像只使用你选择的文件夹；镜像和收件文件夹会拒绝 Inkacre 数据文件夹。

## 它是怎样构建的

- **一个文件，一份记录。** 当前对象以及改变它们的每条命令（含变化前后的状态）都在一个 SQLite 文件中。撤销、页面和数据库历史以及时光机都来自这份记录，备份则完整包含这份记录。
- **改动只有一条路。** 界面、MCP 服务器和命令行发送同样的类型化命令：经架构检查的操作，基于其依据的修订版本在一个事务中应用。一批操作要么整体保存要么完全不保存，重复的命令返回第一次的结果，过期的修订版本会被拒绝。
- **朴素的 Node.js。** 一个进程（Node 内置 SQLite，无原生模块）在 127.0.0.1 上提供界面并处理后台工作：在 worker 线程中读取附件，备份、镜像和收件文件夹也在同一进程中运行。
- **为本项目编写。** 编辑器使用 React 和 ProseMirror；PDF 文本读取（含 CJK 字体与标准加密）、Office、HWPX 和 OpenDocument 读取、.xls 导入、ZIP64 流式导入以及链接地图的布局都在这里编写，没有引入解析库。
- **在真实浏览器中测试。** 引擎和服务器测试（`npm test`，每次推送由 CI 运行），以及 `scripts/ux-trace/` 中像人一样操作界面的 Playwright 套件。

## 开发

```sh
npm install
cd ui && npm install && npm run build && cd ..   # 把界面重新构建到 web/app/
npm test                                         # 引擎测试
node scripts/package.mjs                         # 为本系统构建下载包，输出到 dist/
```

界面位于 `ui/`，使用 React、TypeScript 和 ProseMirror；引擎、服务器和 MCP 服务器是 `src/` 中的纯 Node 代码。浏览器
检查位于 `scripts/ux-trace/`（`local-suite*.mjs`），用 Playwright 针对 `node scripts/handoff-ui-fixture.mjs`
生成的测试数据运行。

## 不包含的内容

团队、共享与权限、实时协同编辑、发布到网页、计费、应用内 AI 功能以及第三方集成。

## 许可

项目代码采用 [MIT 许可证](LICENSE)。第三方组件保留各自的许可证。

Inkacre 是独立项目，与 Notion Labs, Inc. 无关。
