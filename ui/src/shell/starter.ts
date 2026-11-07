import { t } from '../i18n';
import { newId } from '../data/commands';
import { titleNameField } from '../data/format';
import { viewTypeLabels } from '../database/shared';
import type { Operation } from '../data/types';

// The pages a new workspace can start with (welcome screen › "안내와 예시로 시작"): a getting-started checklist,
// a task database, a note, a reading list and how to connect an AI agent. Written for this app in every interface
// language; created as one command so a single undo removes them all. Returns the operations and the page to open.

type Run = { text: string; bold?: boolean; code?: boolean; pageId?: string };
const pad = (value: number) => String(value).padStart(2, '0');
const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };

export function starterOperations(): { operations: Operation[]; firstPageId: string } {
  const ops: Operation[] = [];
  const block = (parentId: string, blockType: string, richText: Run[] = [], extra: Record<string, unknown> = {}) => {
    const id = newId();
    ops.push({ type: 'block.create', id, parentId, blockType, richText, ...extra } as Operation);
    return id;
  };
  const text = (value: string): Run[] => [{ text: value }];
  const page = (title: string, icon: string, parentId: string | null = null) => {
    const id = newId();
    ops.push({ type: 'page.create', id, title, parentId } as Operation, { type: 'page.update', id, icon } as Operation);
    return id;
  };

  const guide = page(t("starter|시작하기"), '🧭');
  const tasksTitle = t("starter|할 일"), agentTitle = t("starter|AI 에이전트 연결하기");
  const tasks = page(tasksTitle, '✅');
  const note = page(t("starter|빠른 메모"), '📝');
  const reading = page(t("starter|독서 목록"), '📚');
  const agent = page(agentTitle, '🤖');

  // 시작하기 — a checklist to try things out.
  block(guide, 'paragraph', text(t("starter|이 워크스페이스의 내용은 모두 이 컴퓨터에 저장됩니다. 아래 항목을 하나씩 해 보며 사용법을 익혀 보세요. 다 끝나면 이 페이지는 지워도 됩니다.")));
  block(guide, 'heading2', text(t("starter|글쓰기")));
  const todo = (parent: string, runs: Run[]) => block(parent, 'todo', runs, { checked: false });
  todo(guide, text(t("starter|빈 줄에서 / 를 입력해 블록 메뉴를 여세요. 제목, 할 일, 표, 코드 등을 넣을 수 있습니다.")));
  todo(guide, text(t("starter|# 다음에 공백을 치면 제목, - 다음에 공백을 치면 글머리 목록, [] 를 치면 할 일이 됩니다.")));
  todo(guide, text(t("starter|글자를 선택해 굵게, 색, 링크를 넣어 보세요.")));
  todo(guide, text(t("starter|줄 왼쪽의 ⋮⋮ 손잡이를 끌어 순서를 바꾸고, 눌러서 블록 메뉴를 열어 보세요.")));
  todo(guide, text(t("starter|@ 를 입력해 다른 페이지나 날짜를 언급해 보세요.")));
  block(guide, 'heading2', text(t("starter|페이지 정리")));
  todo(guide, text(t("starter|사이드바의 + 로 새 페이지를 만들고, 페이지를 끌어 다른 페이지 안에 넣어 보세요.")));
  todo(guide, text(t("starter|⌘K(Windows는 Ctrl+K)로 모든 페이지를 검색하고 바로 이동하세요.")));
  todo(guide, text(t("starter|자주 여는 페이지는 오른쪽 위 ☆ 로 즐겨찾기에 추가하세요.")));
  block(guide, 'heading2', text(t("starter|데이터베이스")));
  todo(guide, [{ text: tasksTitle, pageId: tasks }, { text: ` ${t("starter|— 표 · 보드 · 캘린더 보기를 오가 보세요.")}` }]);
  todo(guide, text(t("starter|보드에서 카드를 다른 열로 끌면 상태가 바뀌고, 표에도 바로 반영됩니다.")));
  todo(guide, text(t("starter|필터를 눌러 이번 주에 마감인 일만 걸러 보세요.")));
  block(guide, 'heading2', text(t("starter|알아 두면 좋은 것")));
  const keys = block(guide, 'toggle', text(t("starter|자주 쓰는 단축키")));
  for (const [combo, label] of [['⌘N · Ctrl+N', t("새 페이지")], ['⌘\\ · Ctrl+\\', t("starter|사이드바 접기·펼치기")], ['⌘⇧L · Ctrl+Shift+L', t("다크 모드 전환")], ['⌘Z · Ctrl+Z', t("starter|실행 취소")], ['⌘⌥/ · Ctrl+Alt+/', t("키보드 단축키")]])
    block(keys, 'bullet', [{ text: combo, code: true }, { text: ` ${label}` }]);
  block(guide, 'callout', text(t("starter|데이터는 이 컴퓨터의 데이터 폴더에 SQLite 파일 하나로 저장됩니다. 왼쪽 아래 ? 메뉴의 ‘백업 만들기’로 언제든 백업할 수 있습니다.")), { icon: '💾' });
  block(guide, 'paragraph', [{ text: agentTitle, pageId: agent }, { text: ` ${t("starter|— Claude 같은 AI 에이전트가 이 워크스페이스를 직접 읽고 정리하게 할 수 있습니다.")}` }]);

  // 할 일 — a task database with table, board and calendar views.
  {
    const sourceId = newId(), statusId = newId(), dueId = newId(), priorityId = newId();
    const status = { todo: newId(), doing: newId(), done: newId() }, priority = { high: newId(), mid: newId(), low: newId() };
    ops.push(
      { type: 'source.create', id: sourceId, pageId: tasks, name: t("starter|할 일"), titlePropertyId: newId(), ...titleNameField() } as Operation,
      { type: 'property.create', id: statusId, sourceId, name: t("상태"), propertyType: 'status', options: [
        { id: status.todo, name: t("시작 전"), group: 'todo', color: 'gray' },
        { id: status.doing, name: t("진행 중"), group: 'in_progress', color: 'blue' },
        { id: status.done, name: t("완료"), group: 'complete', color: 'green' }] } as Operation,
      { type: 'property.create', id: dueId, sourceId, name: t("마감일"), propertyType: 'date' } as Operation,
      { type: 'property.create', id: priorityId, sourceId, name: t("우선순위"), propertyType: 'select', options: [
        { id: priority.high, name: t("높음"), color: 'red' }, { id: priority.mid, name: t("중간"), color: 'yellow' }, { id: priority.low, name: t("낮음"), color: 'gray' }] } as Operation,
      { type: 'view.create', id: newId(), sourceId, parentId: tasks, name: viewTypeLabels.table, viewType: 'table', config: {} } as Operation,
      { type: 'view.create', id: newId(), sourceId, parentId: tasks, name: viewTypeLabels.board, viewType: 'board', config: { groupBy: statusId } } as Operation,
      { type: 'view.create', id: newId(), sourceId, parentId: tasks, name: viewTypeLabels.calendar, viewType: 'calendar', config: { datePropertyId: dueId } } as Operation,
    );
    const rows: Array<[string, string, number, string]> = [
      [t("starter|시작하기 페이지 둘러보기"), status.doing, 0, priority.high],
      [t("starter|이번 주 계획 세우기"), status.todo, 2, priority.mid],
      [t("starter|장보기 목록 만들기"), status.todo, 4, priority.low],
      [t("starter|앱 설치하기"), status.done, 0, priority.mid],
    ];
    rows.forEach(([title, state, offset, rank], index) => {
      const id = newId();
      ops.push({ type: 'page.create', id, title, sourceId } as Operation,
        { type: 'value.set', pageId: id, propertyId: statusId, value: state } as Operation,
        { type: 'value.set', pageId: id, propertyId: dueId, value: { start: day(offset) } } as Operation,
        { type: 'value.set', pageId: id, propertyId: priorityId, value: rank } as Operation);
      if (index === 0) block(id, 'paragraph', text(t("starter|데이터베이스의 각 항목도 페이지입니다. 이렇게 본문에 메모를 남길 수 있습니다.")));
    });
  }

  // 빠른 메모
  block(note, 'paragraph', text(t("starter|떠오른 생각을 바로 적어 두는 곳입니다. 정리는 나중에 해도 됩니다.")));
  block(note, 'bullet', text(t("starter|/북마크로 링크를 제목과 설명이 담긴 카드로 저장할 수 있습니다.")));
  block(note, 'bullet', text(t("starter|할 일이 생기면 [] 로 바로 체크 목록을 만드세요.")));
  block(note, 'todo', text(t("starter|이 메모를 정리해서 다른 페이지로 옮기기")), { checked: false });

  // 독서 목록 — gallery and table.
  {
    const sourceId = newId(), authorId = newId(), stateId = newId();
    const state = { want: newId(), reading: newId(), done: newId() };
    ops.push(
      { type: 'source.create', id: sourceId, pageId: reading, name: t("starter|독서 목록"), titlePropertyId: newId(), ...titleNameField() } as Operation,
      { type: 'property.create', id: authorId, sourceId, name: t("starter|저자"), propertyType: 'text' } as Operation,
      { type: 'property.create', id: stateId, sourceId, name: t("상태"), propertyType: 'select', options: [
        { id: state.want, name: t("starter|읽고 싶음"), color: 'gray' }, { id: state.reading, name: t("starter|읽는 중"), color: 'blue' }, { id: state.done, name: t("starter|다 읽음"), color: 'green' }] } as Operation,
      { type: 'view.create', id: newId(), sourceId, parentId: reading, name: viewTypeLabels.gallery, viewType: 'gallery', config: { visibleProperties: [authorId, stateId], galleryPreview: 'none', cardSize: 'small' } } as Operation,
      { type: 'view.create', id: newId(), sourceId, parentId: reading, name: viewTypeLabels.table, viewType: 'table', config: {} } as Operation,
    );
    const books: Array<[string, string, string]> = [
      [t("starter|어린 왕자"), t("starter|앙투안 드 생텍쥐페리"), state.done],
      [t("starter|데미안"), t("starter|헤르만 헤세"), state.reading],
      [t("starter|오만과 편견"), t("starter|제인 오스틴"), state.want],
    ];
    for (const [title, author, value] of books) {
      const id = newId();
      ops.push({ type: 'page.create', id, title, sourceId } as Operation,
        { type: 'value.set', pageId: id, propertyId: authorId, value: author } as Operation,
        { type: 'value.set', pageId: id, propertyId: stateId, value } as Operation);
    }
  }

  // AI 에이전트 연결하기 — the built-in MCP server.
  block(agent, 'paragraph', text(t("starter|이 앱에는 MCP 서버가 들어 있어서 Claude, Codex 같은 AI 에이전트가 페이지와 데이터베이스를 직접 읽고 고칠 수 있습니다. 에이전트의 변경도 화면에서 하는 것과 같은 명령으로 기록되므로 변경 기록에서 확인하고 되돌릴 수 있습니다.")));
  block(agent, 'heading2', text(t("starter|연결 방법")));
  // Code sits inside its numbered step so the numbering carries on (1 · 2 · 3 · 4).
  const config = ['{', '  "mcpServers": {', '    "inkacre": { "command": "inkacre", "args": ["mcp"] }', '  }', '}'].join('\n');
  const step1 = block(agent, 'numbered', text(t("starter|앱을 켜 둔 채로 에이전트의 MCP 설정에 아래 서버를 추가하세요.")));
  block(step1, 'code', text(config), { language: 'json' });
  block(agent, 'numbered', text(t("starter|저장소 폴더에서 직접 실행하고 있다면 command를 그 폴더의 app-local 전체 경로로 바꾸세요.")));
  const step3 = block(agent, 'numbered', text(t("starter|Claude Code에서는 터미널에서 한 줄로 추가할 수도 있습니다.")));
  block(step3, 'code', text('claude mcp add inkacre -- inkacre mcp'), { language: 'bash' });
  block(agent, 'numbered', text(t("starter|에이전트에게 “할 일 데이터베이스에서 이번 주에 마감인 항목을 정리해 줘”처럼 요청해 보세요.")));
  // The template keeps "{0}" where the variable's name goes, in whatever word order the language needs.
  const [before, after = ''] = t("starter|앱을 다른 주소나 포트에서 실행 중이라면 환경 변수 {0}로 알려 주세요. 기본값은 http://127.0.0.1:4141 입니다.").split('{0}');
  block(agent, 'callout', [{ text: before }, { text: 'LOCAL_WORKSPACE_URL', code: true }, { text: after }], { icon: '💡' });

  return { operations: ops, firstPageId: guide };
}
