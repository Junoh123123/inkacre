import { t } from '../i18n';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { Menu, type MenuEntry } from '../ui/Menu';
import type { Anchor, Placement } from '../ui/overlay';
import { Icon, blockIcon } from '../ui/Icon';
import { blockLabels, colorLabel, colorNames, displayDate, titleNameField, wordCount, avatarLetter } from '../data/format';
import { workspace, report, setStatus } from '../data/store';
import { hrefFor } from '../data/router';
import type { BlockEntity } from '../data/types';
import { blockAt, duplicateBlocks, selectedOrCurrentBlocks, setBlockType, subtreeEnd, type BlockInfo } from './blocks';
import { blockSelectionKey, deleteBlocks, flatBlocks } from './plugins';
import { schema } from './schema';
import { startPresentation } from '../page/Presentation';
import { captionTypes, requestCaption } from './caption';
import { codeLanguages, languageLabels, readWrap, setCodeWrap } from './views';
import { startComment } from './Discussions';
import { openWorkspaceDialog } from '../dialogs/registry';
import { useWorkspace } from '../data/store';
import { Switch } from '../ui/primitives';
import { apply, newId } from '../data/commands';
import type { Entity } from '../data/types';
import { PagePickerPanel, destinationSource, type PickTarget } from '../dialogs/PagePickerPanel';
import type { PageSync } from './sync';
import { blockPreview } from './blockPreview';
import { htmlSource, openHtmlFullscreen, requestHtmlReplace } from './HtmlBlock';
import { plainText } from '../data/format';
import type { Operation, RichText } from '../data/types';

const colors = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

const lastColorKey = 'pageyard-last-color';
export function lastUsedColor(): { kind: 'color' | 'background'; color: string } | null {
  try { return JSON.parse(localStorage.getItem(lastColorKey) ?? 'null'); } catch { return null; }
}

// Block colour (whole block): a text colour or a background.
export function colorBlocks(view: EditorView, infos: BlockInfo[], kind: 'color' | 'background', color: string) {
  const tr = view.state.tr;
  const value = color === 'default' ? null : kind === 'color' ? color : `${color}_background`;
  for (const info of infos) {
    if (info.node.type.name !== 'text_block') continue;
    const pos = tr.mapping.map(info.pos);
    tr.setNodeMarkup(pos, undefined, { ...info.node.attrs, color: value });
  }
  try { localStorage.setItem(lastColorKey, JSON.stringify({ kind, color })); } catch { /* ignore */ }
  view.dispatch(tr);
}

export function colorEntries(onPick: (kind: 'color' | 'background', color: string) => void): MenuEntry[] {
  const last = lastUsedColor();
  return [
    ...(last ? [{ kind: 'section', label: t("color-menu|최근 사용") } as MenuEntry, {
      label: colorLabel(last.kind, last.color), shortcut: '⌘⇧H',
      icon: <span className={`swatch ${last.kind === 'color' ? `swatch-text-${last.color}` : `swatch-bg-${last.color}`}`}>{last.kind === 'color' ? 'A' : ''}</span>,
      onSelect: () => onPick(last.kind, last.color),
    } as MenuEntry, { kind: 'separator' } as MenuEntry] : []),
    { kind: 'section', label: t("텍스트 색") },
    ...colors.map(color => ({ label: colorLabel('color', color), keywords: `color text ${color}`, icon: <span className={`swatch swatch-text-${color}`}>A</span>, onSelect: () => onPick('color', color) } as MenuEntry)),
    { kind: 'separator' },
    { kind: 'section', label: t("배경색") },
    ...colors.map(color => ({ label: colorLabel('background', color), keywords: `background highlight ${color}`, icon: <span className={`swatch swatch-bg-${color}`} />, onSelect: () => onPick('background', color) } as MenuEntry)),
  ];
}

// "전환" in this order: text, headings 1–4, page, the lists, code, quote,
// callout, equation, synced block, toggle headings 1–4 and 2–5 columns. The last few rebuild the blocks
// through the engine (they wrap or replace the blocks), so they need the editor's pending edits saved first.
// "페이지로 옮기기" (right after 페이지): the blocks become pages inside the page or
// database picked beside it (their nested blocks go along) and leave this page.
async function turnIntoPageIn(view: EditorView, target: PickTarget) {
  const host = view.dom.closest<HTMLElement>('[data-page-id]');
  const sync = (host as unknown as { __sync?: PageSync } | null)?.__sync;
  const ids = selectedOrCurrentBlocks(view.state).filter(info => info.node.type.name === 'text_block' || info.node.type.name === 'code_block').map(info => info.node.attrs.id as string);
  if (!ids.length) return;
  await sync?.flush();
  const operations: Operation[] = [];
  const source = destinationSource(target);
  for (const id of ids) {
    const block = workspace.get<BlockEntity>(id);
    if (!block) continue;
    const page = newId();
    const title = plainText(block.richText);
    operations.push(source
      ? { type: 'page.create', id: page, title, parentId: source, sourceId: source } as Operation
      : { type: 'page.create', id: page, title, parentId: target?.id ?? null } as Operation);
    for (const child of workspace.children(id)) operations.push({ type: 'node.move', id: child.id, parentId: page });
    operations.push({ type: 'node.trash', id });
  }
  if (!operations.length) return;
  await apply(operations);
  setStatus(t("{0}(으)로 옮겼습니다.", [target ? workspace.title(target as Entity) || t("새 페이지") : t("개인 페이지")]));
}

export function turnIntoEntries(view: EditorView, current?: string, flush?: () => Promise<void>): MenuEntry[] {
  const text = (type: string): MenuEntry => ({
    label: blockLabels[type as keyof typeof blockLabels], icon: blockIcon[type], checked: current === type, keywords: `turn into ${type}`, preview: blockPreview(type),
    onSelect: () => { setBlockType(type, { toggleable: false })(view.state, view.dispatch); view.focus(); },
  });
  const pageId = view.dom.closest<HTMLElement>('[data-page-id]')?.dataset.pageId;
  const viaEngine = (build: (ids: string[], first: BlockEntity) => Operation[]) => async () => {
    if (!flush) return;
    const ids = selectedOrCurrentBlocks(view.state).map(info => info.node.attrs.id as string);
    await flush();
    const live = ids.filter(id => workspace.get(id));
    const first = workspace.get<BlockEntity>(live[0]);
    if (first) await apply(build(live, first)).catch(report);
  };
  return [
    ...(['paragraph', 'heading1', 'heading2', 'heading3', 'heading4'] as const).map(text),
    { label: t("페이지"), icon: 'page', keywords: t("turn into page 페이지로 전환"), preview: blockPreview('page'), onSelect: () => openWorkspaceDialog('turn-into-page', { view }) },
    ...(view.editable && pageId ? [{
      label: t("turn-into|페이지로 옮기기"), icon: 'page-send', keywords: t("turn into page in move 페이지로 옮기기"), panelWidth: 400, panelLabel: t("turn-into|페이지로 옮기기"),
      panel: (close: () => void) => <PagePickerPanel placeholder={t("page-in|추가할 페이지 검색…")} exclude={new Set([pageId])} close={close} onPick={target => turnIntoPageIn(view, target)} />,
    } as MenuEntry] : []),
    ...(['bullet', 'numbered', 'todo', 'toggle', 'code', 'quote', 'callout'] as const).map(text),
    ...(flush ? [
      { label: t("turn-into|수학 공식 블록"), icon: 'math', keywords: t("turn into equation math 수식"), preview: blockPreview('math'), onSelect: viaEngine(ids => ids.map(id => ({ type: 'block.update', id, blockType: 'math' }) as Operation)) } as MenuEntry,
      { label: t("동기화 블록"), icon: 'synced', keywords: t("turn into synced block 동기화"), preview: blockPreview('synced'), onSelect: viaEngine((ids, first) => {
        const synced = newId();
        return [{ type: 'block.create', id: synced, parentId: first.parentId, blockType: 'synced', beforeId: first.id } as Operation, ...ids.map(id => ({ type: 'node.move', id, parentId: synced }) as Operation)];
      }) } as MenuEntry,
    ] : []),
    ...[1, 2, 3, 4].map(level => ({
      label: t("토글 제목{0}", [level]), icon: `toggle-h${level}`, keywords: t("turn into toggle heading {0} 토글 제목", [level]), preview: blockPreview(`toggle-h${level}`),
      onSelect: () => { setBlockType(`heading${level}`, { toggleable: true })(view.state, view.dispatch); view.focus(); },
    } as MenuEntry)),
    ...(flush ? [2, 3, 4, 5].map(count => ({
      label: t("turn-into|{0}개의 열", [count]), icon: count === 2 ? 'columns' : `columns-${count}`, keywords: t("turn into columns {0} 열", [count]), preview: blockPreview(`columns-${count}`),
      onSelect: viaEngine((ids, first) => {
        const columns = newId(), columnIds = Array.from({ length: count }, () => newId());
        return [{ type: 'block.create', id: columns, parentId: first.parentId, blockType: 'columns', beforeId: first.id, columnIds } as Operation, ...ids.map(id => ({ type: 'node.move', id, parentId: columnIds[0] }) as Operation)];
      }),
    } as MenuEntry)) : []),
  ];
}

function htmlEntries(id: string, command?: (operations: Operation[]) => Promise<unknown>): MenuEntry[] {
  const attachmentId = workspace.get<BlockEntity>(id)?.attachmentId;
  const run = (operations: Operation[]) => (command ? command(operations) : apply(operations)).catch(report);
  return [
    { label: t("block-menu|전환"), icon: 'turn-into', submenuWidth: 220, submenu: () => [{ label: t("파일"), icon: 'file', onSelect: () => run([{ type: 'block.update', id, blockType: 'file' } as Operation]) }] } as MenuEntry,
    { label: t("block-menu|바꾸기"), icon: 'replace', onSelect: () => requestHtmlReplace(id) } as MenuEntry,
    ...(attachmentId ? [
      { label: t("다운로드"), icon: 'download', onSelect: () => { const link = document.createElement('a'); link.href = `/api/attachments/${encodeURIComponent(attachmentId)}`; link.download = workspace.get<{ name: string } & BlockEntity>(attachmentId)?.name ?? 'page.html'; link.click(); } } as MenuEntry,
    ] : []),
    { label: t("캡션"), icon: 'caption', shortcut: '⌘⌥M', onSelect: () => requestCaption(id) } as MenuEntry,
    ...(attachmentId ? [
      { label: t("전체 화면"), icon: 'zoom-in', shortcut: 'Space', onSelect: () => openHtmlFullscreen(id) } as MenuEntry,
      { label: t("원본 보기"), icon: 'arrow-up-right', onSelect: () => { window.open(htmlSource(attachmentId), '_blank', 'noopener'); } } as MenuEntry,
    ] : []),
  ];
}

export interface BlockMenuProps { view: EditorView; anchor: Anchor; placement?: Placement; onClose: () => void; pageId: string; flush: () => Promise<void>; command?: (operations: Operation[]) => Promise<unknown> }

// Switch that follows the stored table header flags while the menu stays open.
// Stretches (or shrinks) the columns in proportion so the table spans the text column.
function fitTableToWidth(view: EditorView, pos: number, id: string, command?: (operations: Operation[]) => Promise<unknown>) {
  const block = workspace.get<BlockEntity>(id);
  const wrap = (view.nodeDOM(pos) as HTMLElement | null)?.querySelector<HTMLElement>('.simple-table-wrap');
  const count = block?.cells?.[0]?.length ?? 0;
  if (!block || !wrap || !count) return;
  // The table ends where the text column (or the column block it sits in) ends, plus 2px.
  const table = wrap.querySelector('table');
  const container = wrap.closest('.block-column') ?? view.dom;
  const available = table ? container.getBoundingClientRect().right + 2 - table.getBoundingClientRect().left : wrap.clientWidth - 12;
  const widths = Array.from({ length: count }, (_, i) => block.columnWidths?.[i] ?? 120);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const next = widths.map(width => Math.max(32, Math.floor((width * available) / total)));
  const op = { type: 'block.update', id, columnWidths: next } as Operation;
  (command ? command([op]) : apply([op])).catch(report);
}

function TableHeaderSwitch({ id, axis, onChange }: { id: string; axis: 'row' | 'column'; onChange: (value: boolean) => void }) {
  const ws = useWorkspace();
  const block = ws.get<BlockEntity>(id);
  return <Switch checked={!!block?.tableHeader?.[axis]} onChange={onChange} label={axis === 'row' ? t("머리글 행") : t("머리글 열")} />;
}

// Simple table → inline database (top-level tables only: sources live directly under the page).
async function tableToDatabase(blockId: string, pageId: string, flush: () => Promise<void>) {
  await flush();
  const block = workspace.get<BlockEntity>(blockId);
  if (!block?.cells) return;
  const header = block.tableHeader?.row ?? false;
  const width = block.cells[0].length;
  const names = (header ? block.cells[0].map(cell => plainText(cell as RichText).trim()) : []).map((name, index) => name || (index === 0 ? t("이름") : t("열 {0}", [index + 1])));
  while (names.length < width) names.push(names.length === 0 ? t("이름") : t("열 {0}", [names.length + 1]));
  const rows = header ? block.cells.slice(1) : block.cells;
  const sourceId = newId(), titleId = newId(), viewId = newId();
  const propertyIds = names.map((_, index) => (index === 0 ? titleId : newId()));
  const ops: Operation[] = [
    { type: 'source.create', id: sourceId, pageId, name: t("새 데이터베이스"), titlePropertyId: titleId, ...titleNameField() },
    { type: 'property.update', id: titleId, name: names[0] },
    ...names.slice(1).map((name, index) => ({ type: 'property.create', id: propertyIds[index + 1], sourceId, name, propertyType: 'text' } as Operation)),
  ];
  for (const row of rows) {
    const rowId = newId();
    ops.push({ type: 'page.create', id: rowId, title: plainText(row[0] as RichText), parentId: sourceId, sourceId } as Operation);
    row.slice(1).forEach((cell, index) => { const text = plainText(cell as RichText); if (text) ops.push({ type: 'value.set', pageId: rowId, propertyId: propertyIds[index + 1], value: text }); });
  }
  ops.push({ type: 'view.create', id: viewId, sourceId, parentId: pageId, name: t("표"), viewType: 'table', config: {} } as Operation);
  // Keep the database where the table was: move the blocks that followed it after the source.
  const siblings = workspace.children(pageId);
  const index = siblings.findIndex(child => child.id === blockId);
  for (const child of siblings.slice(index + 1)) if (child.kind === 'block' || (child.kind === 'page' && !(child as { sourceId?: string }).sourceId)) ops.push({ type: 'node.move', id: child.id, parentId: pageId });
  ops.push({ type: 'node.trash', id: blockId });
  try { await apply(ops); setStatus(t("표를 데이터베이스로 전환했습니다.")); } catch (error) { report(error); }
}

export function BlockMenu({ view, anchor, placement = 'left-center', onClose, pageId, flush, command }: BlockMenuProps) {
  const infos = selectedOrCurrentBlocks(view.state);
  const first = infos[0];
  const type = first?.node.type.name === 'text_block' ? first.node.attrs.blockType : first?.node.type.name === 'code_block' ? 'code' : first?.node.attrs.blockType ?? first?.node.type.name;
  const entity = first ? workspace.get<BlockEntity>(first.node.attrs.id) : undefined;
  const textual = infos.some(info => info.node.type.name === 'text_block');
  const text = infos.map(info => info.node.textContent).join(' ');
  const counts = wordCount(text);
  const remove = () => { deleteBlocks(view.state, infos, view.dispatch); view.focus(); };
  const toggleHeader = (axis: 'row' | 'column', value: boolean) => {
    const current = workspace.get<BlockEntity>(entity!.id);
    if (!current) return;
    const next = { row: current.tableHeader?.row ?? false, column: current.tableHeader?.column ?? false, [axis]: value };
    const op: Operation = { type: 'block.update', id: current.id, tableHeader: next } as Operation;
    (command ? command([op]) : apply([op])).catch(report);
  };
  const entries: MenuEntry[] = [
    { kind: 'section', label: infos.length > 1 ? t("{0}개 블록", [infos.length]) : type === 'html' ? t("block-menu|임베드") : (blockLabels as Record<string, string>)[type ?? ''] ?? (type === 'page_link' ? t("페이지") : type === 'database' ? t("데이터베이스") : t("블록")) },
    // An HTML block ("임베드"): 전환 › 파일 · 바꾸기 · 다운로드 · 캡션 · 전체 화면 · 원본 보기.
    ...(type === 'html' && first && infos.length === 1 ? htmlEntries(first.node.attrs.id, command) : []),
    ...(first && infos.length === 1 && first.node.type.name === 'atom_block' && captionTypes.has(first.node.attrs.blockType) && type !== 'html' ? [
      { label: t("캡션"), icon: 'caption', shortcut: '⌘⌥M', onSelect: () => requestCaption(first.node.attrs.id) } as MenuEntry,
    ] : []),
    // A code block offers 전환 but no 색.
    ...(textual || type === 'code' ? [
      { label: t("block-menu|전환"), icon: 'turn-into', keywords: t("turn into 전환 바꾸기"), submenu: () => turnIntoEntries(view, infos.length === 1 ? type : undefined, flush), submenuWidth: 220 } as MenuEntry,
    ] : []),
    ...(textual ? [
      { label: t("block-menu|색"), icon: 'color', keywords: t("color 색 색상"), submenu: () => colorEntries((kind, color) => { colorBlocks(view, infos, kind, color); view.focus(); }), submenuWidth: 220 } as MenuEntry,
    ] : []),
    // 텍스트 방향 (text direction): from the text, left to right, or right to left.
    ...(textual ? [
      { label: t("텍스트 방향"), icon: 'text-direction', keywords: t("direction rtl ltr 방향 오른쪽 왼쪽 아랍어 히브리어"), submenuWidth: 240, submenu: () => ([[null, t("자동 (글자에 따라)")], ['ltr', t("왼쪽에서 오른쪽")], ['rtl', t("오른쪽에서 왼쪽")]] as const).map(([direction, label]) => ({
        label, checked: (first?.node.attrs.direction ?? null) === direction, onSelect: () => { setDirection(view, infos, direction); view.focus(); },
      }) as MenuEntry) } as MenuEntry,
    ] : []),
    // A numbered list ("List format"): numbers, letters or roman numerals for the whole list at that depth.
    ...(type === 'numbered' && first ? [
      { label: t("목록 형식"), icon: 'numbered-list', submenuWidth: 220, submenu: () => ([['numbers', t("숫자 (1, 2, 3)")], ['letters', t("문자 (a, b, c)")], ['roman', t("로마 숫자 (i, ii, iii)")]] as const).map(([format, label]) => ({
        label, checked: (first.node.attrs.listFormat ?? listRunFormat(first)) === format, onSelect: () => { setListFormat(view, first, format); view.focus(); },
      }) as MenuEntry) } as MenuEntry,
    ] : []),
    ...(type === 'table' && entity && infos.length === 1 ? [
      { label: t("데이터베이스로 전환"), icon: 'turn-into', keywords: t("convert database 데이터베이스"), disabled: (first.node.attrs.depth ?? 0) > 0 || first.container.type.name !== 'doc', onSelect: () => tableToDatabase(entity.id, pageId, flush) } as MenuEntry,
      { label: t("너비에 맞추기"), icon: 'fit-width', keywords: t("fit width 너비 맞춤"), onSelect: () => fitTableToWidth(view, first.pos, entity.id, command) } as MenuEntry,
      ...(['row', 'column'] as const).map(axis => ({
        label: axis === 'row' ? t("머리글 행") : t("머리글 열"), icon: axis === 'row' ? 'table-header-row' : 'table-header-column', keepOpen: true, keywords: t("header 머리글"),
        right: <TableHeaderSwitch id={entity.id} axis={axis} onChange={value => toggleHeader(axis, value)} />,
        onSelect: () => toggleHeader(axis, !workspace.get<BlockEntity>(entity.id)?.tableHeader?.[axis]),
      } as MenuEntry)),
    ] : []),
    // A code block: 코드 복사 · 오른쪽 끝에서 줄바꿈 · 언어 › before the shared items.
    ...(type === 'code' && first && infos.length === 1 ? [
      { label: t("캡션"), icon: 'caption', shortcut: '⌘⌥M', onSelect: () => requestCaption(first.node.attrs.id) } as MenuEntry,
      { label: t("코드 복사"), icon: 'copy', onSelect: () => { navigator.clipboard.writeText(first.node.textContent).then(() => setStatus(t("코드를 복사했습니다."))).catch(report); } } as MenuEntry,
      { label: t("오른쪽 끝에서 줄바꿈"), icon: 'wrap', checked: readWrap(first.node.attrs.id), onSelect: () => setCodeWrap(first.node.attrs.id, !readWrap(first.node.attrs.id)) } as MenuEntry,
      { label: t("언어"), icon: 'code', hint: languageLabels[first.node.attrs.language] ?? first.node.attrs.language, submenuWidth: 220, submenu: () => codeLanguages.map(code => ({ label: languageLabels[code] ?? code, keywords: code, checked: code === first.node.attrs.language, onSelect: () => {
        const node = view.state.doc.nodeAt(first.pos);
        if (node?.type.name === 'code_block') view.dispatch(view.state.tr.setNodeMarkup(first.pos, undefined, { ...node.attrs, language: code }));
      } }) as MenuEntry) } as MenuEntry,
    ] : []),
    { kind: 'separator' },
    { label: t("블록 링크 복사"), icon: 'link', shortcut: '⌘⌃L', onSelect: () => { const url = new URL(hrefFor(pageId), location.href); url.hash = first?.node.attrs.id ?? ''; navigator.clipboard.writeText(url.href).then(() => setStatus(t("블록 링크를 복사했습니다."))).catch(report); } },
    { label: t("복제"), icon: 'duplicate', shortcut: '⌘D', onSelect: () => { duplicateBlocks(view.state, view.dispatch); view.focus(); } },
    { label: t("block-menu|옮기기"), icon: 'move', shortcut: '⌘⇧P', onSelect: async () => { await flush(); openWorkspaceDialog('move-blocks', { ids: infos.map(info => info.node.attrs.id), pageId, anchor, placement: 'below-start' }); } },
    { label: t("삭제"), icon: 'trash', shortcut: 'Del', onSelect: remove },
    { kind: 'separator' },
    ...(first ? [{ label: t("댓글"), icon: 'comment', shortcut: '⌘⇧M', onSelect: () => { startComment(view, first.node.attrs.id); } } as MenuEntry] : []),
    // "여기서 프레젠테이션 시작" (beta): slides from the one holding this block.
    ...(first ? [{ kind: 'separator' } as MenuEntry, { label: t("여기서 프레젠테이션 시작"), icon: 'presentation', badge: t("베타"), shortcut: '⌘⌥P', onSelect: () => startPresentation(pageId, first.node.attrs.id) } as MenuEntry] : []),
    // No 알림 설정 here; reminders come from "/" and "@".
    ...(type === 'button' && entity ? [{ label: t("버튼 설정"), icon: 'settings', onSelect: () => openWorkspaceDialog('button', { ownerId: entity.id }) } as MenuEntry] : []),
  ];
  const searchEntries = () => [
    { kind: 'section', label: t("전환") } as MenuEntry, ...turnIntoEntries(view, type, flush),
    ...colorEntries((kind, color) => { colorBlocks(view, infos, kind, color); view.focus(); }),
    { kind: 'section', label: t("작업") } as MenuEntry, ...entries.filter(entry => 'label' in entry && entry.kind !== 'section' && !('submenu' in entry && entry.submenu)),
  ];
  const footer = entity ? (
    <div className="menu-meta">
      <div className="menu-meta-title">{t("최종 편집")}</div>
      <div className="menu-meta-user"><span className="avatar">{avatarLetter(entity.updatedBy && entity.updatedBy !== 'user' ? entity.updatedBy : t("나"))}</span><span>{entity.updatedBy === 'user' ? t("나") : entity.updatedBy}</span></div>
      <div>{displayDate(entity.updatedAt)}</div>
      <div className="menu-meta-light">{t("{0}단어, {1}자", [counts.words, counts.characters])}</div>
    </div>
  ) : null;
  return <Menu anchor={anchor} placement={placement} offset={5} width={265} entries={entries} search={t("작업 검색…")} searchEntries={searchEntries} footer={footer} onClose={onClose} label={t("블록 메뉴")} />;
}

export function selectBlockAt(view: EditorView, pos: number) {
  const info = blockAt(view.state.doc.resolve(pos));
  if (!info) return null;
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, { ids: [info.node.attrs.id], anchor: info.node.attrs.id, head: info.node.attrs.id }).setMeta('keepBlockSelection', true));
  return info;
}

export function focusEnd(view: EditorView, id: string) {
  const entry = flatBlocks(view.state.doc).find(item => item.node.attrs.id === id);
  if (!entry) return;
  const pos = entry.node.isTextblock ? entry.pos + 1 + entry.node.content.size : entry.pos;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).setMeta(blockSelectionKey, { ids: [], anchor: null, head: null }));
  view.focus();
}

export { subtreeEnd, Icon };

// The numbered items around a block at its depth form one list (deeper blocks inside it do not break it).
function listRun(info: BlockInfo): number[] {
  const depth = info.node.attrs.depth ?? 0, container = info.container;
  const inRun = (index: number) => { const node = container.maybeChild(index); return !!node && node.type.name === 'text_block' && (node.attrs.depth ?? 0) === depth && node.attrs.blockType === 'numbered'; };
  const deeper = (index: number) => { const node = container.maybeChild(index); return !!node && (node.attrs.depth ?? 0) > depth; };
  let start = info.index;
  for (let i = info.index - 1; i >= 0; i--) { if (deeper(i)) continue; if (inRun(i)) start = i; else break; }
  const run: number[] = [];
  for (let i = start; i < container.childCount; i++) { if (deeper(i)) continue; if (inRun(i)) run.push(i); else break; }
  return run;
}

function listRunFormat(info: BlockInfo): string {
  const first = info.container.child(listRun(info)[0] ?? info.index);
  if (first.attrs.listFormat) return first.attrs.listFormat;
  const level = (info.node.attrs.depth ?? 0) % 3;
  return level === 0 ? 'numbers' : level === 1 ? 'letters' : 'roman';
}

function setDirection(view: EditorView, infos: BlockInfo[], direction: 'ltr' | 'rtl' | null) {
  const tr = view.state.tr;
  for (const info of infos) {
    const node = tr.doc.nodeAt(info.pos);
    if (node?.type.name === 'text_block') tr.setNodeMarkup(info.pos, undefined, { ...node.attrs, direction });
  }
  view.dispatch(tr);
}

function setListFormat(view: EditorView, info: BlockInfo, format: string) {
  const tr = view.state.tr;
  for (const index of listRun(info)) {
    let pos = info.containerStart;
    for (let i = 0; i < index; i++) pos += info.container.child(i).nodeSize;
    const node = tr.doc.nodeAt(pos);
    if (node?.type.name === 'text_block') tr.setNodeMarkup(pos, undefined, { ...node.attrs, listFormat: format });
  }
  view.dispatch(tr);
}
