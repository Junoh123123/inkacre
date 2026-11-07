import { colorLabel, tagColors, titleNameField } from '../data/format';
import { t } from '../i18n';
import { TextSelection, NodeSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { ChartType } from '../data/types';
import { schema } from './schema';
import { blockAt, duplicateBlocks, newTextBlock, subtreeEnd, type BlockInfo } from './blocks';
import { deleteBlocks, triggerKey } from './plugins';
import { autoOpenTypes, markAutoOpen } from './autoOpen';
import { insertEquation } from './equation';
import { newTabsNode } from './tabs';
import { newBlockId } from './convert';
import { apply, newId } from '../data/commands';
import { workspace, report } from '../data/store';
import { navigate } from '../data/router';
import type { Operation } from '../data/types';
import type { PageSync } from './sync';

export interface SlashContext { view: EditorView; pageId: string; sync: PageSync; info: BlockInfo; openDialog: (name: string, args?: Record<string, unknown>) => void }

export interface SlashItem {
  id: string;
  section: string;
  label: string;
  icon: string;
  hint?: string;
  sub?: string;
  badge?: string;
  keywords: string;
  // Shown only when typed for (the actions /duplicate, /moveto, /delete).
  queryOnly?: boolean;
  // Listed only while browsing (the 추천 copies), and with their "· sub" shown there too.
  browseOnly?: boolean;
  showSub?: boolean;
  // A colour command shows a swatch (the colour menus' look) instead of an icon.
  swatch?: string;
  run: (context: SlashContext) => void | Promise<void>;
}

// Replace the current (now empty) block or insert after it.
function placeNode(view: EditorView, info: BlockInfo, node: ReturnType<typeof schema.nodes.atom_block.create>, { trailingText = true } = {}) {
  const state = view.state;
  const current = state.doc.nodeAt(info.pos);
  const tr = state.tr;
  const depth = current?.attrs.depth ?? 0;
  const placed = node.type.create({ ...node.attrs, depth }, node.content);
  if (current && current.type.name === 'text_block' && current.content.size === 0) {
    tr.replaceWith(info.pos, info.pos + current.nodeSize, placed);
    const after = info.pos + placed.nodeSize;
    const next = tr.doc.nodeAt(after);
    if (trailingText && (!next || next.type.name !== 'text_block')) {
      tr.insert(after, newTextBlock({ depth }));
    }
    if (placed.isTextblock) tr.setSelection(TextSelection.create(tr.doc, info.pos + 1));
    else tr.setSelection(NodeSelection.create(tr.doc, info.pos));
  } else {
    const end = subtreeEnd(info).end;
    tr.insert(end, placed);
    if (placed.isTextblock) tr.setSelection(TextSelection.create(tr.doc, end + 1));
    else tr.setSelection(NodeSelection.create(tr.doc, end));
  }
  view.dispatch(tr.scrollIntoView());
}

function turnInto(blockType: string, extra: Record<string, unknown> = {}) {
  return ({ view, info }: SlashContext) => {
    const node = view.state.doc.nodeAt(info.pos);
    if (!node) return;
    const tr = view.state.tr;
    if (node.type.name === 'text_block') tr.setNodeMarkup(info.pos, undefined, { ...node.attrs, blockType, checked: false, toggleable: false, ...extra });
    else return;
    tr.setSelection(TextSelection.create(tr.doc, info.pos + 1 + node.content.size));
    view.dispatch(tr.scrollIntoView());
  };
}

function atom(blockType: string) {
  return ({ view, info }: SlashContext) => {
    const id = newBlockId();
    if (autoOpenTypes.has(blockType)) markAutoOpen(id);
    placeNode(view, info, schema.nodes.atom_block.create({ id, blockType }));
  };
}

// Blocks that need data the engine creates server-side are made with a command,
// after the editor's pending edits are saved.
export interface Placement { siblingAfter?: string; parentId: string; topSiblingAfter?: string }
export async function viaCommand(context: SlashContext, build: (place: Placement) => Operation[], openAfter?: string) {
  const { view, info, sync, pageId } = context;
  const node = view.state.doc.nodeAt(info.pos);
  const empty = !!node && node.type.name === 'text_block' && node.content.size === 0;
  const blockId = node?.attrs.id as string | undefined;
  await sync.flush();
  const state = view.state;
  let target: BlockInfo | null = info;
  state.doc.descendants((child, pos) => { if (child.attrs?.id === blockId) { target = blockAt(state.doc.resolve(pos + (child.isLeaf ? 0 : 1))); return false; } return true; });
  const place = placementOf(state, target ?? info, pageId);
  const ops = build(place);
  if (empty && blockId && workspace.get(blockId)) ops.push({ type: 'node.trash', id: blockId });
  try {
    await apply(ops);
    if (openAfter) navigate(openAfter);
  } catch (error) { report(error); }
}

function placementOf(state: EditorState, info: BlockInfo, pageId: string): Placement {
  const depth = info.node.attrs.depth ?? 0;
  const parentId = parentOf(state, info) ?? (info.container.type.name === 'column' ? info.container.attrs.id : pageId);
  const after = info.container.maybeChild(subtreeEndIndex(info) + 1);
  const siblingAfter = after && (after.attrs.depth ?? 0) === depth && workspace.get(after.attrs.id) ? after.attrs.id as string : undefined;
  // Top-level sibling after the cursor (for pages, which live directly under the page).
  let topSiblingAfter: string | undefined;
  if (info.container.type.name === 'doc') {
    for (let i = info.index + 1; i < info.container.childCount; i++) {
      const child = info.container.child(i);
      if ((child.attrs.depth ?? 0) === 0 && workspace.get(child.attrs.id)) { topSiblingAfter = child.attrs.id; break; }
    }
  }
  return { siblingAfter, parentId, topSiblingAfter };
}

function subtreeEndIndex(info: BlockInfo) {
  const depth = info.node.attrs.depth ?? 0;
  let index = info.index;
  for (let i = info.index + 1; i < info.container.childCount; i++) {
    const child = info.container.child(i);
    if ((child.attrs.depth ?? 0) <= depth) break;
    index = i;
  }
  return index;
}

function parentOf(state: EditorState, info: BlockInfo): string | null {
  const depth = info.node.attrs.depth ?? 0;
  if (!depth) return null;
  for (let i = info.index - 1; i >= 0; i--) {
    const child = info.container.child(i);
    if ((child.attrs.depth ?? 0) < depth) return child.attrs.id;
  }
  return null;
}

function createInlineDatabase(viewType: string, chart?: ChartType) {
  return async (context: SlashContext) => {
    const { pageId } = context;
    const sourceId = newId(), viewId = newId(), titleId = newId();
    await viaCommand(context, ({ topSiblingAfter: siblingAfter }) => {
      const following: string[] = [];
      if (siblingAfter) {
        let collecting = false;
        for (const child of workspace.children(pageId)) {
          if (child.id === siblingAfter) collecting = true;
          if (collecting && (child.kind === 'block' || (child.kind === 'page' && !(child as { sourceId?: string }).sourceId))) following.push(child.id);
        }
      }
      const statusId = newId();
      return [
        { type: 'source.create', id: sourceId, pageId, name: t("새 데이터베이스"), titlePropertyId: titleId, ...titleNameField() },
        ...(viewType === 'board' || viewType === 'timeline' || viewType === 'calendar' ? [{ type: 'property.create', id: statusId, sourceId, name: t("상태"), propertyType: 'status', options: [
          { id: newId(), name: t("시작 전"), group: 'todo', color: 'gray' }, { id: newId(), name: t("진행 중"), group: 'in_progress', color: 'blue' }, { id: newId(), name: t("완료"), group: 'complete', color: 'green' }] } as Operation] : []),
        ...(viewType === 'calendar' || viewType === 'timeline' ? [{ type: 'property.create', id: newId(), sourceId, name: t("날짜"), propertyType: 'date' } as Operation] : []),
        { type: 'view.create', id: viewId, sourceId, parentId: pageId, name: viewType === 'form' ? t("양식 빌더") : viewNames[viewType] ?? t("표"), viewType, config: viewType === 'board' ? { groupBy: statusId } : chart ? { chart: { groupBy: titleId, aggregation: 'count', type: chart } } : {} },
        // Sources are appended to the page; move the blocks that follow the cursor after it.
        ...following.map(id => ({ type: 'node.move', id, parentId: pageId })),
      ];
    });
  };
}

const chartSlashLabels: Record<ChartType, string> = { bar: t("세로 막대형 차트"), hbar: t("가로 막대형 차트"), line: t("꺾은선형 차트"), donut: t("도넛형 차트"), number: t("숫자 차트") };
const chartIcons: Record<ChartType, string> = { bar: 'chart-bar', hbar: 'chart-hbar', line: 'chart-line', donut: 'chart-donut', number: 'hash' };
const viewNames: Record<string, string> = { table: t("표"), board: t("보드"), gallery: t("갤러리"), list: t("리스트"), calendar: t("캘린더"), timeline: t("타임라인"), chart: t("차트"), feed: t("피드"), map: t("지도"), form: t("양식"), dashboard: t("대시보드") };

function columns(count: number) {
  return async (context: SlashContext) => {
    const columnsId = newId();
    await viaCommand(context, ({ siblingAfter, parentId }) => [
      { type: 'block.create', id: columnsId, parentId, blockType: 'columns', ...(siblingAfter ? { beforeId: siblingAfter } : {}) },
      ...Array.from({ length: Math.max(0, count - 2) }, () => ({ type: 'block.create', parentId: columnsId, blockType: 'column' })),
    ]);
  };
}

export const slashItems: SlashItem[] = [
  { id: 'paragraph', section: t("기본 블록"), label: t("텍스트"), icon: 'text-block', keywords: t("text paragraph 텍스트 일반 plain"), run: turnInto('paragraph') },
  { id: 'heading1', section: t("기본 블록"), label: t("제목1"), icon: 'h1', hint: '#', keywords: t("h1 heading1 title 제목 큰"), run: turnInto('heading1') },
  { id: 'heading2', section: t("기본 블록"), label: t("제목2"), icon: 'h2', hint: '##', keywords: t("h2 heading2 subtitle 제목 중간"), run: turnInto('heading2') },
  { id: 'heading3', section: t("기본 블록"), label: t("제목3"), icon: 'h3', hint: '###', keywords: t("h3 heading3 제목 작은"), run: turnInto('heading3') },
  { id: 'heading4', section: t("기본 블록"), label: t("제목4"), icon: 'h4', hint: '####', keywords: t("h4 heading4 제목 가장 작은"), run: turnInto('heading4') },
  { id: 'bullet', section: t("기본 블록"), label: t("글머리 기호 목록"), icon: 'bullet-list', hint: '-', keywords: t("bullet bulleted list ul unordered 글머리 목록 리스트"), run: turnInto('bullet') },
  { id: 'numbered', section: t("기본 블록"), label: t("번호 매기기 목록"), icon: 'numbered-list', hint: '1.', keywords: t("numbered ordered list ol 번호 목록 리스트"), run: turnInto('numbered') },
  { id: 'todo', section: t("기본 블록"), label: t("할 일 목록"), icon: 'todo-list', hint: '[]', keywords: t("todo to-do checkbox task 할일 체크"), run: turnInto('todo') },
  { id: 'toggle', section: t("기본 블록"), label: t("토글 목록"), icon: 'toggle-list', hint: '>', keywords: t("toggle collapse 토글 접기"), run: turnInto('toggle') },
  { id: 'page', section: t("기본 블록"), label: t("페이지"), icon: 'page', keywords: t("page subpage 페이지 하위"), run: async context => {
    const id = newId();
    await viaCommand(context, ({ topSiblingAfter }) => [{ type: 'page.create', id, title: '', parentId: context.pageId }, ...(topSiblingAfter ? [{ type: 'node.move', id, parentId: context.pageId, beforeId: topSiblingAfter }] : [])], id);
  } },
  { id: 'callout', section: t("기본 블록"), label: t("콜아웃"), icon: 'callout', keywords: t("callout note box 콜아웃 강조"), run: turnInto('callout') },
  { id: 'quote', section: t("기본 블록"), label: t("인용"), icon: 'quote', hint: '"', keywords: t("quote blockquote 인용"), run: turnInto('quote') },
  { id: 'table', section: t("기본 블록"), label: t("표"), icon: 'table', keywords: t("table simple grid 표 테이블"), run: atom('table') },
  { id: 'divider', section: t("기본 블록"), label: t("구분선"), icon: 'divider', hint: '---', keywords: t("divider separator hr line 구분선 줄"), run: atom('divider') },
  // 페이지 링크 (link to page): a block pointing at another page, listed under this page in the sidebar too.
  { id: 'link-page', section: t("기본 블록"), label: t("페이지 링크"), icon: 'link-page', keywords: t("link to page mention 페이지 링크 연결"), run: ({ openDialog, info }) => openDialog('link-page', { blockId: info.node.attrs.id, block: true }) },
  { id: 'image', section: t("미디어"), label: t("이미지"), icon: 'image', keywords: t("image picture photo img 이미지 사진 그림"), run: atom('image') },
  { id: 'video', section: t("미디어"), label: t("동영상"), icon: 'video', keywords: t("video youtube vimeo movie 동영상 비디오 영상"), run: atom('video') },
  { id: 'audio', section: t("미디어"), label: t("오디오"), icon: 'audio', keywords: t("audio sound music mp3 voice 오디오 소리 음악 음성"), run: atom('audio') },
  // "HTML · 임베드" (신규): an uploaded .html file shown in a sandboxed frame.
  { id: 'html', section: t("미디어"), label: t("block|HTML"), sub: t("slash|임베드"), icon: 'html', badge: t("slash|신규"), keywords: t("html web page embed file 웹 페이지 임베드 파일"), run: atom('html') },
  { id: 'code', section: t("미디어"), label: t("코드"), icon: 'code', hint: '```', keywords: t("code snippet 코드 프로그램"), run: ({ view, info }) => {
    const node = view.state.doc.nodeAt(info.pos);
    const code = schema.nodes.code_block.create({ id: node?.type.name === 'text_block' ? node.attrs.id : newBlockId(), depth: node?.attrs.depth ?? 0 }, node?.textContent ? schema.text(node.textContent) : undefined);
    const tr = view.state.tr.replaceWith(info.pos, info.pos + (node?.nodeSize ?? 0), code);
    tr.setSelection(TextSelection.create(tr.doc, info.pos + 1 + code.content.size));
    view.dispatch(tr);
  } },
  { id: 'file', section: t("미디어"), label: t("slash|파일"), icon: 'file', keywords: t("file upload attachment 파일 첨부 업로드"), run: atom('file') },
  { id: 'pdf', section: t("미디어"), label: 'PDF', icon: 'pdf', keywords: t("pdf document 문서 피디에프"), run: atom('pdf') },
  { id: 'embed', section: t("미디어"), label: t("임베드"), icon: 'embed', keywords: t("embed iframe web link url 임베드 웹 링크 지도 maps"), run: atom('embed') },
  { id: 'bookmark', section: t("미디어"), label: t("웹 북마크"), icon: 'bookmark', keywords: t("bookmark link url web 북마크 링크 웹"), run: atom('bookmark') },
  // In this order: the views, the five chart kinds, the form, then the databases.
  ...(['table', 'board', 'gallery', 'list', 'feed', 'dashboard', 'calendar', 'timeline', 'map'] as const).map(type => ({
    id: `db-${type}`, section: t("데이터베이스"), label: type === 'map' ? t("slash|지도 보기") : t("{0} 보기", [viewNames[type]]), icon: type, keywords: t("database db {0} view 데이터베이스 보기 {1}", [type, viewNames[type]]), run: createInlineDatabase(type),
  } as SlashItem)),
  ...(Object.keys(chartSlashLabels) as ChartType[]).map(chart => ({
    id: `db-chart-${chart}`, section: t("데이터베이스"), label: chartSlashLabels[chart], icon: chartIcons[chart], keywords: t("database chart graph {0} 차트 그래프 {1}", [chart, chartSlashLabels[chart]]), run: createInlineDatabase('chart', chart),
  } as SlashItem)),
  { id: 'db-form', section: t("데이터베이스"), label: t("slash|양식 보기"), icon: 'form', keywords: t("database form survey 양식 설문 {0}", [viewNames.form]), run: createInlineDatabase('form') },
  { id: 'db-inline', section: t("데이터베이스"), label: t("데이터베이스: 인라인"), icon: 'database', keywords: t("database inline db table 데이터베이스 인라인"), run: createInlineDatabase('table') },
  { id: 'db-page', section: t("데이터베이스"), label: t("데이터베이스: 전체 페이지"), icon: 'database', keywords: t("database full page db 데이터베이스 전체 페이지"), run: async context => {
    const id = newId(), sourceId = newId(), viewId = newId();
    await viaCommand(context, ({ topSiblingAfter }) => [
      { type: 'page.create', id, title: t("새 데이터베이스"), parentId: context.pageId },
      ...(topSiblingAfter ? [{ type: 'node.move', id, parentId: context.pageId, beforeId: topSiblingAfter }] : []),
      { type: 'source.create', id: sourceId, pageId: id, name: t("새 데이터베이스"), titlePropertyId: newId(), ...titleNameField() },
      { type: 'view.create', id: viewId, sourceId, parentId: id, name: t("표"), viewType: 'table', config: {} },
    ], id);
  } },
  { id: 'db-linked', section: t("데이터베이스"), label: t("데이터 소스 연결 보기"), icon: 'link', keywords: t("linked view database 연결 링크된 데이터베이스 보기"), run: ({ openDialog }) => openDialog('linked-view') },
  { id: 'toc', section: t("고급 블록"), label: t("목차"), icon: 'toc', keywords: t("toc table of contents outline 목차"), run: atom('toc') },
  { id: 'math', section: t("고급 블록"), label: t("수학 공식 블록"), icon: 'math', keywords: t("math equation latex tex formula katex 수식 공식"), run: atom('math') },
  { id: 'button', section: t("고급 블록"), label: t("버튼"), icon: 'button', keywords: t("button action automation 버튼 동작"), run: atom('button') },
  { id: 'breadcrumb', section: t("고급 블록"), label: t("이동 경로"), icon: 'breadcrumb', keywords: t("breadcrumb bread path 이동 경로 위치"), run: atom('breadcrumb') },
  // "탭" (badge 신규): three tabs, the caret on a new line under the block.
  { id: 'tabs', section: t("고급 블록"), label: t("탭"), icon: 'tabs', badge: t("slash|신규"), keywords: t("tabs tab 탭 탭 블록 탭블록"), run: ({ view, info }) => {
    const node = view.state.doc.nodeAt(info.pos);
    const depth = node?.attrs.depth ?? 0;
    const tabs = newTabsNode(depth);
    const reuse = node?.type.name === 'text_block' && node.content.size === 0;
    const at = reuse ? info.pos : subtreeEnd(info).end;
    const tr = reuse ? view.state.tr.replaceWith(info.pos, info.pos + node!.nodeSize, tabs) : view.state.tr.insert(at, tabs);
    const after = at + tabs.nodeSize;
    const next = tr.doc.nodeAt(after);
    if (!next || next.type.name !== 'text_block' || next.content.size > 0 || (next.attrs.depth ?? 0) !== depth) tr.insert(after, newTextBlock({ depth }));
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    view.dispatch(tr.scrollIntoView());
  } },
  { id: 'synced', section: t("고급 블록"), label: t("동기화 블록"), icon: 'synced', keywords: t("synced block sync 동기화"), run: ({ view, info }) => {
    const node = view.state.doc.nodeAt(info.pos);
    const depth = node?.attrs.depth ?? 0;
    const synced = schema.nodes.atom_block.create({ id: newBlockId(), depth, blockType: 'synced' });
    const child = newTextBlock({ depth: depth + 1 });
    const tr = view.state.tr;
    if (node && node.type.name === 'text_block' && node.content.size === 0) tr.replaceWith(info.pos, info.pos + node.nodeSize, [synced, child]);
    else tr.insert(subtreeEnd(info).end, [synced, child]);
    const childPos = (node && node.content.size === 0 ? info.pos : subtreeEnd(info).end) + synced.nodeSize + 1;
    tr.setSelection(TextSelection.create(tr.doc, childPos));
    view.dispatch(tr);
  } },
  { id: 'synced-reference', section: t("고급 블록"), label: t("동기화 블록 참조"), icon: 'synced', keywords: t("synced reference copy 동기화 참조"), run: ({ openDialog, info }) => openDialog('synced-reference', { afterBlockId: info.node.attrs.id }) },
  ...[1, 2, 3].map(level => ({ id: `toggle-heading${level}`, section: t("고급 블록"), label: t("토글 제목{0}", [level]), icon: `toggle-h${level}`, hint: `${'#'.repeat(level)} >`, keywords: t("toggle heading{0} h{1} 토글 제목 접기", [level, level]), run: turnInto(`heading${level}`, { toggleable: true }) } as SlashItem)),
  ...[2, 3, 4, 5].map(count => ({ id: `columns-${count}`, section: t("고급 블록"), label: t("{0}개의 열", [count]), icon: count === 2 ? 'columns' : `columns-${count}`, keywords: t("columns column {0} 열 다단 {1}단", [count, count]), run: columns(count) } as SlashItem)),
  // "코드: Mermaid": a Mermaid code block with a two-box sample, selected, its diagram under it.
  { id: 'mermaid', section: t("고급 블록"), label: t("코드: Mermaid"), icon: 'code', keywords: t("mermaid diagram flowchart chart code 다이어그램 머메이드 순서도"), run: ({ view, info }) => {
    const node = view.state.doc.nodeAt(info.pos);
    const sample = 'graph TD\n  Mermaid --> Diagram';
    const reuse = node?.type.name === 'text_block' && !node.textContent;
    const code = schema.nodes.code_block.create({ id: reuse ? node!.attrs.id : newBlockId(), depth: node?.attrs.depth ?? 0, language: 'mermaid' }, schema.text(sample));
    const at = reuse ? info.pos : subtreeEnd(info).end;
    const tr = reuse ? view.state.tr.replaceWith(info.pos, info.pos + node!.nodeSize, code) : view.state.tr.insert(at, code);
    tr.setSelection(TextSelection.create(tr.doc, at + 1, at + 1 + sample.length));
    view.dispatch(tr);
  } },
  { id: 'mention-page', section: t("인라인"), label: t("페이지 멘션"), icon: 'mention', keywords: t("mention page link @ 멘션 페이지"), run: ({ view }) => { view.dispatch(view.state.tr.insertText('@')); } },
  { id: 'reminder', section: t("인라인"), label: t("날짜 또는 리마인더"), icon: 'calendar', keywords: t("date reminder remind 날짜 리마인더 알림"), run: ({ openDialog, info }) => openDialog('reminder', { parentId: info.node.attrs.id }) },
  { id: 'emoji', section: t("인라인"), label: t("이모지"), icon: 'emoji', keywords: t("emoji smile 이모지 이모티콘 그림문자"), run: ({ view }) => {
    const from = view.state.selection.from;
    view.dispatch(view.state.tr.insertText(':', from).setMeta(triggerKey, { kind: 'emoji', from, token: ':', full: true }));
  } },
  // "/import": the import window, its pages made under this page.
  { id: 'import', section: t("작업"), label: t("가져오기"), icon: 'import', queryOnly: true, keywords: t("import 가져오기 불러오기 word pdf csv"), run: ({ openDialog, pageId }) => { openDialog('import', { parentId: pageId }); } },
  { id: 'equation', section: t("인라인"), label: t("인라인 수식"), icon: 'math', keywords: t("inline equation math tex latex katex 인라인 수식"), run: ({ view }) => { insertEquation(view); } },
  { id: 'duplicate', section: t("작업"), label: t("복제"), icon: 'duplicate', queryOnly: true, keywords: t("duplicate copy 복제 복사"), run: ({ view }) => { duplicateBlocks(view.state, view.dispatch); } },
  { id: 'moveto', section: t("작업"), label: t("옮기기"), icon: 'move', queryOnly: true, keywords: t("moveto move 옮기기 이동"), run: async ({ view, sync, info, pageId, openDialog }) => { await sync.flush(); const dom = view.nodeDOM(info.pos) as HTMLElement | null; openDialog('move-blocks', { ids: [info.node.attrs.id], pageId, ...(dom ? { anchor: dom, placement: 'below-start' } : {}) }); } },
  { id: 'delete', section: t("작업"), label: t("삭제"), icon: 'trash', queryOnly: true, keywords: t("delete remove 삭제 지우기"), run: ({ view, info }) => {
    const current = blockAt(view.state.selection.$from) ?? info;
    deleteBlocks(view.state, [current], view.dispatch);
  } },
];

// 추천 (HTML · 페이지 · 데이터 소스 연결 보기): copies of those items at the top, each with its section shown after the name.
for (const [id, sub] of [['html', t("slash|임베드")], ['page', ''], ['db-linked', t("slash|데이터베이스")]] as const) {
  const item = slashItems.find(entry => entry.id === id);
  if (item) slashItems.splice(slashItems.filter(entry => entry.browseOnly).length, 0, { ...item, id: `suggested-${id}`, section: t("slash|추천"), browseOnly: true, showSub: !!sub, sub: sub || item.sub });
}

// Colour commands ("/red", "/blue background"): typed for, never listed while browsing.
for (const kind of ['color', 'background'] as const) {
  for (const color of tagColors) {
    slashItems.push({
      id: `color-${kind}-${color}`, section: t("작업"), label: colorLabel(kind, color), icon: 'color', queryOnly: true,
      swatch: kind === 'color' ? `swatch-text-${color}` : `swatch-bg-${color}`,
      keywords: `${kind === 'color' ? 'color text' : 'background highlight color'} ${color} ${t("색")}`,
      run: ({ view, info }) => {
        const current = blockAt(view.state.selection.$from) ?? info;
        const node = view.state.doc.nodeAt(current.pos);
        if (node?.type.name !== 'text_block') return;
        const value = color === 'default' ? null : kind === 'color' ? color : `${color}_background`;
        view.dispatch(view.state.tr.setNodeMarkup(current.pos, undefined, { ...node.attrs, color: value }));
      },
    });
  }
}

// Most used and recently used commands (this browser): browsing shows them first under 추천, a typed query ranks
// them first among equals (by how often, then how lately).
const recentKey = 'pageyard-slash-recent';
const countKey = 'pageyard-slash-counts';
export function slashCounts(): Record<string, number> {
  try { const counts = JSON.parse(localStorage.getItem(countKey) ?? '{}'); return counts && typeof counts === 'object' && !Array.isArray(counts) ? counts : {}; } catch { return {}; }
}
export function recentSlash(): string[] {
  try { const list = JSON.parse(localStorage.getItem(recentKey) ?? '[]'); return Array.isArray(list) ? list.filter(item => typeof item === 'string') : []; } catch { return []; }
}
export function noteSlashUse(id: string) {
  const base = id.replace(/^suggested-/, '');
  try { localStorage.setItem(recentKey, JSON.stringify([base, ...recentSlash().filter(item => item !== base)].slice(0, 20))); } catch { /* storage unavailable */ }
  try {
    const counts = slashCounts(); counts[base] = (Number(counts[base]) || 0) + 1;
    // Keep the 60 most used.
    const kept = Object.fromEntries(Object.entries(counts).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 60));
    localStorage.setItem(countKey, JSON.stringify(kept));
  } catch { /* storage unavailable */ }
}
// The suggested order: the one used last, then the most used (at least twice), then the other recent ones.
function usedOrder(): string[] {
  const recent = recentSlash(), counts = slashCounts();
  const often = Object.entries(counts).filter(([id, count]) => Number(count) >= 2 && id !== recent[0]).sort((a, b) => Number(b[1]) - Number(a[1]) || (recent.indexOf(a[0]) + 1 || 99) - (recent.indexOf(b[0]) + 1 || 99)).map(([id]) => id).slice(0, 2);
  const first = recent.slice(0, 1);
  return [...first, ...often, ...recent.filter(id => !often.includes(id) && !first.includes(id))];
}

export const slashSections = [t("slash|추천"), t("기본 블록"), t("미디어"), t("데이터베이스"), t("고급 블록"), t("인라인")];

export function filterSlash(query: string): SlashItem[] {
  const needle = query.trim().toLocaleLowerCase();
  const recent = recentSlash(), counts = slashCounts();
  if (!needle) {
    const browse = slashItems.filter(item => !item.queryOnly);
    const suggested = browse.filter(item => item.browseOnly).map(item => item.id.replace(/^suggested-/, ''));
    // Typed-only actions (복제 · 옮기기 · 삭제) are not suggested; colour commands are.
    const used = usedOrder().filter(id => !suggested.includes(id)).map(id => slashItems.find(item => item.id === id && !item.browseOnly && !['duplicate', 'moveto', 'delete'].includes(item.id))).filter((item): item is SlashItem => !!item).slice(0, 3)
      .map(item => ({ ...item, id: `recent-${item.id}`, section: t("slash|추천"), browseOnly: true }));
    return [...used, ...browse];
  }
  const pool = slashItems.filter(item => !item.browseOnly);
  const rank = (item: SlashItem) => { const at = recent.indexOf(item.id); return -(Number(counts[item.id]) || 0) * 100 + (at < 0 ? recent.length : at); };
  const words = needle.split(/\s+/);
  return pool
    .map(item => {
      const label = item.label.toLocaleLowerCase();
      const haystack = `${label} ${item.keywords.toLocaleLowerCase()} ${item.hint ?? ''}`;
      if (!words.every(word => haystack.includes(word))) return null;
      const score = label.startsWith(needle) ? 0 : label.includes(needle) ? 1 : item.keywords.toLocaleLowerCase().split(' ').some(word => word.startsWith(needle)) ? 2 : 3;
      return { item, score };
    })
    .filter((entry): entry is { item: SlashItem; score: number } => !!entry)
    .sort((a, b) => a.score - b.score || rank(a.item) - rank(b.item))
    .map(entry => entry.item);
}

export type { Transaction };
