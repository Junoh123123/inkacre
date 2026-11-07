# Inkacre

**내 컴퓨터에 저장되는 페이지·블록·데이터베이스, 그리고 AI 에이전트가 함께 일할 수 있는 작업 공간.**

[English](README.md) · 한국어 · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

![시작하기 페이지](docs/screenshots/page.png)

Inkacre는 익숙한 블록·데이터베이스 방식의 1인용 로컬 작업 공간입니다. 모든 내용이 내 컴퓨터의 SQLite 파일 하나에 저장되며, 계정도
클라우드도 사용 기록 전송도 없습니다. 웹 화면, AI 에이전트용 MCP 서버, 명령 엔진이 같은 파일을 쓰기 때문에 에이전트도 내가
보는 페이지를 그대로 고칩니다. 내 변경이든 에이전트의 변경이든 모두 기록되고 되돌릴 수 있습니다.

## 흔한 노트 앱에는 없는 것

- **타임머신** — 지난 어느 시점의 워크스페이스 전체를 별도 탭에서 읽기 전용으로 열고, 페이지를 지금으로 되살리거나 복사본으로 꺼냅니다.
- **첨부 파일 내용 검색** — 첨부한 PDF, Word, Excel, PowerPoint, 한글(HWPX), OpenDocument, 텍스트 파일 속 단어로도 찾고, 결과에 그 파일과 해당 줄을 보여 줍니다.
- **연결 지도** — 모든 페이지를 점으로, 링크·멘션·관계를 선으로 보여 줍니다. 한 페이지를 중심으로 열면 그 페이지가 닿는 곳만 봅니다.
- **어디서든 빠른 기록** — 앱을 열지 않고 단축어, Raycast, 스크립트, 터미널에서 한 줄, 할 일, 데이터베이스 항목을 추가합니다. 받은 파일 폴더에 넣은 파일도 같은 페이지로 들어옵니다.
- **자동 백업** — 바뀐 것이 있을 때 매시간·매일·매주 백업하고, 원하면 다른 디스크에 둡니다. 백업마다 점검하거나 새 워크스페이스로 열 수 있습니다.
- **Markdown 폴더 미러** — 워크스페이스 전체를 Markdown과 CSV 파일로 폴더에 계속 써 두어 Obsidian, 편집기, Spotlight, git에서 씁니다. 바꾼 뒤 몇 초 안에 반영되는 한 방향 미러입니다.
- **에이전트도 나처럼** — Claude, Codex 등 MCP 클라이언트가 화면과 같은 형식의 명령을 쓰고, 그 변경도 내 변경처럼 기록되어 되돌릴 수 있습니다.

| 첨부한 PDF 속 단어 검색 | 연결 지도 | 타임머신 |
| --- | --- | --- |
| ![PDF 속 단어를 찾은 검색](docs/screenshots/search.png) | ![연결 지도](docs/screenshots/graph.png) | ![타임머신으로 본 페이지](docs/screenshots/time-machine.png) |

## 노트 앱에서 기대하는 기능은 그대로

- **쓰기** — 중첩 블록, / 메뉴, 마크다운 단축 입력, 멘션과 리마인더, 백링크, 댓글, 페이지 기록, 바로 시작할 수 있는 템플릿 51개.
- **정리하기** — 속성 23종, 관계·롤업·수식을 갖춘 데이터베이스, 필터·정렬·그룹, 표·보드·리스트·갤러리·캘린더·타임라인·
  피드·차트·지도·양식·대시보드 보기.
- **내 데이터는 내 것** — 백업과 새 폴더로 복원. Markdown, 텍스트, HTML, Word(.docx), CSV, TSV, Excel(.xlsx·.xls),
  OpenDocument(.ods), EPUB, OPML, PDF, 5GB까지의 ZIP 묶음(다른 노트 앱의 내보내기 포함) 가져오기. Markdown·CSV, HTML,
  PDF(하위 페이지는 페이지마다 PDF), 손실 없는 JSON 묶음으로 내보내기.
- **여러 워크스페이스** — 개인 메모와 공부처럼 나누고 싶은 것을 한 컴퓨터 안의 별도 워크스페이스로 두고 오갈 수 있습니다.
  워크스페이스마다 데이터가 따로 저장됩니다.
- **9개 언어** — English, 한국어, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português (Brasil).

## 만든 이유

- **회사와 분리된 개인 작업 공간.** 개인 메모와 프로젝트를 회사 계정과 섞지 않습니다. 계정을 바꾸거나 로그아웃할 필요가
  없고, 혼자 쓰는 기능에 유료 요금제도 필요 없습니다.
- **AI 에이전트를 위해.** Claude 같은 에이전트가 MCP로 문서를 읽고 정리하고 고칠 수 있으며, 모든 변경이 기록되고 되돌릴
  수 있습니다.
- **클라우드 계정 없이 사용.** Inkacre는 워크스페이스를 내 컴퓨터에 저장합니다. 장소 검색이나 북마크 미리보기 같은 선택 기능은
  사용할 때 외부 서비스에 연결합니다. 연결한 AI 도구의 데이터 처리에는 해당 도구의 정책이 적용됩니다.

![보드 보기](docs/screenshots/board.png)

## 빠른 시작

### 설치 파일 만들기

이 폴더에서 `node scripts/package.mjs`를 실행하면 현재 컴퓨터용 설치 파일이 `dist/`에 생성됩니다. 실행에 필요한 Node.js가 포함됩니다.

| 시스템 | 파일 | 그다음 |
| --- | --- | --- |
| macOS (Apple 실리콘) | `Inkacre-…-macos-arm64.dmg` | 열어서 **Inkacre**를 응용 프로그램 폴더로 끌어 놓고, 응용 프로그램에서 엽니다. |
| Windows (x64) | `Inkacre-…-windows-x64.zip` | 압축을 풀고 `Inkacre` 폴더의 **Inkacre.exe**를 엽니다. |
| Linux (x64) | `Inkacre-…-linux-x64.tar.gz` | 압축을 풀고 `inkacre` 폴더에서 `./inkacre`를 실행합니다. |

Inkacre를 열면 뒤에서 실행되고 브라우저에서 **http://127.0.0.1:4141** 이 열립니다. 실행 중에 다시 열면 브라우저만
열립니다. 끄려면 워크스페이스 메뉴(왼쪽 아래 워크스페이스 이름) 맨 아래의 **Inkacre 끄기**를 고릅니다. 워크스페이스는
시스템의 앱 데이터 폴더에 따로 저장되므로([내 데이터](#내-데이터)), 새 버전은 앱만 바꾸면 그대로 이어서 씁니다.

아직 Apple·Microsoft 개발자 인증서로 서명하지 않아서 처음 열 때는 한 번 허용해야 합니다.

- **macOS**에서는 실행이 막힙니다. **시스템 설정 › 개인정보 보호 및 보안**에서 Inkacre에 관한 안내 옆의 **그래도
  열기**를 고릅니다.
- **Windows**에서 "Windows의 PC 보호" 창이 뜨면 **추가 정보 › 실행**을 고릅니다.

Intel Mac에서는 아래처럼 소스에서 실행합니다.

### 소스에서 실행

[Node.js](https://nodejs.org) 22.16 이상이 필요합니다(24 권장).

```sh
npm ci
npm start
```

**http://127.0.0.1:4141** 이 열립니다. 처음 실행하면 환영 화면에서 언어를 고르고, 짧은 안내와 예시로 시작할지 빈
워크스페이스로 시작할지 정합니다.

![환영 화면](docs/screenshots/welcome.png)

어디서나 명령으로 쓰려면 폴더에서 전역 설치합니다.

```sh
npm install -g .
inkacre            # npm start 와 같음
inkacre --help
```

| 옵션 | 하는 일 |
| --- | --- |
| `--port <번호>` | 사용할 포트 (기본 4141, 또는 `LOCAL_WORKSPACE_PORT`) |
| `--data <폴더>` | 워크스페이스를 저장할 곳 (또는 `LOCAL_WORKSPACE_DATA`) |
| `--lang <코드>` | 첫 실행 화면에 미리 고를 언어: `en`, `ko`, `ja`, `zh-CN`, `zh-TW`, `es`, `fr`, `de`, `pt-BR` |
| `--no-open` | 브라우저를 열지 않음 |

이미 실행 중일 때 다시 시작하면 실행 중인 앱을 열기만 합니다.

### Docker

```sh
docker build -t inkacre .
docker run -d --name inkacre -p 127.0.0.1:4141:4141 -v inkacre-data:/data inkacre
```

기존 Docker 설치를 업데이트할 때는 사용하던 데이터 볼륨을 다시 지정하세요.

포트는 반드시 `127.0.0.1`에만 엽니다. [보안](#보안)을 참고하세요.

### 업데이트

소스에서 실행하는 경우 새 버전의 폴더에서 `npm ci`를 실행합니다.

그다음 앱을 다시 시작합니다. 화면은 `web/app/`에 미리 빌드되어 있어 따로 빌드할 필요가 없습니다.

## 내 데이터

Inkacre는 기본적으로 운영체제의 앱 데이터 디렉터리에 저장합니다. 저장할 폴더를 직접 선택하려면 `--data <폴더>` 또는 `LOCAL_WORKSPACE_DATA`를 사용하세요. 업데이트할 때도 같은 폴더를 지정하세요.

데이터 폴더에는 `workspace.sqlite`와 `blobs/`(첨부
파일)가 있고, 새로 만든 다른 워크스페이스는 그 안의 `workspaces/<id>/`에 저장됩니다. 백업은 왼쪽 아래 **?** 메뉴의 **백업 만들기**로 만들고, 복원은 새 폴더로 합니다.

```sh
inkacre restore --from /백업/폴더 --to /새/폴더
inkacre --data /새/폴더
```

복원은 기존 폴더를 덮어쓰지 않으며, 먼저 해시·무결성·revision을 확인합니다.

백업은 저절로도 만들어집니다. 기본은 하루 한 번이고, 바뀐 것이 있을 때만 만듭니다. **설정 › 백업**에서 주기, 자동 백업을 몇 개 남길지, 어디에 둘지를 정합니다. 같은 디스크의 백업은 디스크와 함께 잃으니 다른 디스크의 폴더를 고르세요. 그곳의 백업은 통째로 점검하거나 지금 워크스페이스 옆에 새 워크스페이스로 열 수 있습니다.

같은 폴더의 `file-text.sqlite`에는 검색을 위해 첨부 파일에서 읽은 글이 있고(지우면 다시 읽습니다), `backup.json`·`inbox.json`·`mirror.json`에는 이 컴퓨터에서 쓰는 백업, 받은 파일 폴더, Markdown 미러 설정이 있습니다.

## 빠른 기록

**설정 › 빠른 기록**에서 페이지를 정하면(또는 페이지를 직접 지정하면) 이 컴퓨터 어디서든 바로 추가할 수 있습니다.

```sh
inkacre capture --todo "우유 사기"                       # 빠른 기록 페이지에 할 일로
inkacre capture --to "일기" "오늘 떠오른 생각"            # 제목으로 정한 페이지에
inkacre capture --db "독서" --prop "저자=박경리" "토지"    # 데이터베이스에 항목 추가
pbpaste | inkacre capture --to "받은 메모"               # 표준 입력, 한 줄에 블록 하나
```

요청을 보낼 수 있는 도구라면 무엇이든 됩니다. `http://127.0.0.1:4141/api/capture`로 `{"text": "…", "as": "todo"}` 같은
JSON을 POST 하세요. Apple 단축어에서는 **URL의 콘텐츠 가져오기** 동작 하나면 됩니다. 설정 화면에 바로 복사할 수 있는 예시가
있습니다. 기록은 일반 변경과 같아서 **변경 기록**에 남고 되돌릴 수 있습니다.

**받은 파일 폴더.** 같은 설정 화면에서 폴더를 고르면, 그 폴더에 새로 들어온 파일(스캔, 스크린샷, 다운로드)이 몇 초 뒤 빠른 기록 페이지에 붙고 다른 첨부처럼 내용 검색이 됩니다. 이미 있던 파일은 가져오지 않고 아무것도 지우지 않습니다(가져온 파일을 옆의 `Imported` 폴더로 옮기게 할 수 있습니다).

## AI 에이전트 (MCP)

앱을 켜 둔 채로 에이전트에 MCP 서버를 추가합니다.

```json
{
  "mcpServers": {
    "inkacre": { "command": "inkacre", "args": ["mcp"] }
  }
}
```

전역 설치 없이 저장소에서 실행 중이라면 command에 `app-local`의 전체 경로를 적습니다([mcp.example.json](mcp.example.json)).
Claude Code에서는 한 줄로 추가할 수 있습니다.

```sh
claude mcp add inkacre -- inkacre mcp
```

앱을 다른 포트에서 실행 중이면 MCP 서버에 `LOCAL_WORKSPACE_URL`(기본 `http://127.0.0.1:4141`)을 지정합니다.

| 용도 | 도구 |
| --- | --- |
| 읽기 | `workspace_status`, `workspace_get`, `workspace_query`, `workspace_search`, `workspace_tasks`, `workspace_command_schema`, `workspace_history`, `workspace_page_version` |
| 워크스페이스 | `workspace_list`, `workspace_use` |
| 미리보기·교환 | `workspace_preview_property_conversion`, `workspace_import_preview`, `workspace_export` |
| 변경·복구 | `workspace_apply`, `workspace_capture`, `workspace_undo`, `workspace_attachment_put`, `workspace_backup` |
| 실행 기록 | `workspace_run_log`, `workspace_run_list`, `workspace_run_read` |

`workspace_apply`에는 고유 명령 id, 에이전트가 읽은 revision, 작업 목록이 필요합니다. 한 묶음은 모두 저장되거나 모두
취소되고, 같은 명령을 다시 보내면 처음 결과를 돌려주며, 오래된 revision은 새 작업을 덮어쓰지 않고 거절됩니다. 에이전트의
변경도 내 변경처럼 **변경 기록**에 나타납니다.

## 언어

환영 화면에서, 또는 나중에 **설정 › 언어와 시간**에서 고릅니다. 이미 만든 페이지의 내용은 바뀌지 않습니다. 언어 추가는
JSON 파일 하나로 됩니다. [ui/src/i18n/README.md](ui/src/i18n/README.md)를 보세요.

## 보안

Inkacre에는 로그인 기능이 없습니다. `127.0.0.1`에서만 기다리며, 로컬 호스트 이름으로 온 요청 중 자기 화면에서
보낸 것만 받기 때문에 다른 컴퓨터나 다른 웹사이트는 접근할 수 없습니다. 네트워크 주소나 공개 프록시 뒤에 두지 마세요.
인터넷을 쓰는 기능(지도 타일과 장소 검색, 북마크 미리보기, 자동화의 웹훅·이메일)은 직접 쓰거나 설정했을 때만 동작합니다.
PDF 파일은 이 컴퓨터에 있는 Chrome·Edge 같은 Chromium 계열 브라우저가 만듭니다. 빈 프로필로 백그라운드에서 실행되며
네트워크에는 나가지 않습니다. 그런 브라우저가 없으면 PDF 내보내기는 인쇄 창을 엽니다.

첨부 파일은 이 컴퓨터의 백그라운드 스레드에서 검색용으로 읽으며 어디로도 보내지 않습니다. Markdown 미러는 고른 폴더(처음엔
비어 있어야 함)에만 쓰고, 그 폴더에서 바뀐 파일은 덮어쓰거나 지우지 않습니다.

백업, 받은 파일 폴더, Markdown 미러는 고른 폴더만 쓰며, 미러와 받은 파일 폴더는 Inkacre 데이터 폴더를 거절합니다.

## 어떻게 만들었나

- **파일 하나, 기록 하나.** 현재 객체와, 그것을 바꾼 모든 명령(바뀌기 전과 후)이 SQLite 파일 하나에 있습니다. 되돌리기, 페이지·데이터베이스 기록, 타임머신이 모두 이 기록에서 나오고, 백업은 이 기록을 통째로 담습니다.
- **바꾸는 길은 하나.** 화면, MCP 서버, 명령줄이 같은 형식의 명령을 보냅니다. 스키마로 검사한 작업들을, 기준이 된 revision에 대해 한 트랜잭션으로 적용합니다. 묶음은 통째로 저장되거나 아예 안 되고, 같은 명령을 다시 보내면 처음 결과를 돌려주며, 오래된 revision은 거절합니다.
- **평범한 Node.js.** 프로세스 하나(Node 내장 SQLite, 네이티브 모듈 없음)가 127.0.0.1에서 화면을 제공하고 백그라운드 일을 합니다. 첨부 파일 읽기는 worker 스레드에서, 백업·미러·받은 파일 폴더는 같은 프로세스에서 돕니다.
- **직접 만든 부분.** 편집기는 React와 ProseMirror입니다. PDF 글 읽기(CJK 글꼴과 표준 암호화 포함), Office·HWPX·OpenDocument 읽기, .xls 가져오기, ZIP64 스트리밍 가져오기, 연결 지도 배치는 파서 라이브러리를 가져다 쓰지 않고 이 프로젝트에서 만들었습니다.
- **실제 브라우저로 검증.** 엔진·서버 테스트(`npm test`, 푸시마다 CI에서 실행)와, 사람이 쓰듯 화면을 조작하는 `scripts/ux-trace/`의 Playwright 점검이 있습니다.

## 개발

```sh
npm install
cd ui && npm install && npm run build && cd ..   # 화면을 web/app/ 으로 다시 빌드
npm test                                         # 엔진 테스트
node scripts/package.mjs                         # 이 시스템용 내려받기 파일을 dist/ 에
```

화면은 `ui/`의 React·TypeScript·ProseMirror, 엔진·서버·MCP 서버는 `src/`의 Node입니다. 브라우저 점검은
`scripts/ux-trace/`(`local-suite*.mjs`)에 있으며, `node scripts/handoff-ui-fixture.mjs`로 만든 격리 자료에 Playwright로
실행합니다.

## 포함하지 않은 것

팀, 공유와 권한, 실시간 공동 편집, 웹 게시, 과금, 앱 안의 AI 기능, 외부 서비스 연동.

## 라이선스

프로젝트 코드는 [MIT 라이선스](LICENSE)로 배포합니다. Inkacre 이름과 로고는 브랜드 자산으로 별도 관리합니다. 제3자 구성 요소에는 각자의 라이선스가 적용됩니다.

Inkacre는 독립 프로젝트이며 Notion Labs, Inc.와 관계가 없습니다.
