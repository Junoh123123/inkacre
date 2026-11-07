import { t, tx } from '../i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EditorView } from 'prosemirror-view';
import { NodeSelection } from 'prosemirror-state';
import { useWorkspace, report, setStatus, workspace } from '../data/store';
import { api } from '../data/api';
import { uploadFile, apply, attachFromUrl } from '../data/commands';
import { navigate, hrefFor } from '../data/router';
import { plainText } from '../data/format';
import type { AttachmentEntity, BlockEntity, ButtonDefinition, PageEntity, RichText } from '../data/types';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/overlay';
import { Menu, type MenuEntry } from '../ui/Menu';
import { EntityIcon } from '../page/EntityIcon';
import { DatabaseBlock } from '../database/DatabaseBlock';
import { readRich, richToFragment } from './richdom';
import { flatBlocks } from './plugins';
import { selectContents, type AtomEntry } from './views';
import type { PageSync } from './sync';
import { openWorkspaceDialog } from '../dialogs/registry';
import { ButtonEditor, runButton } from '../dialogs/buttons';
import { EmojiPicker } from '../page/PageView';
import { colorEntries } from './BlockMenu';
import { Switch, Dialog, confirmDialog } from '../ui/primitives';
import { PageEditor } from './PageEditor';
import { takeAutoOpen } from './autoOpen';
import { TabsHeader } from './TabsHeader';
import { captionTypes } from './caption';
import { HtmlAtom } from './HtmlBlock';
import { ResizableMedia } from './media';

export interface AtomProps { entry: AtomEntry; view: EditorView; pageId: string; sync: PageSync }

import { loadKatex } from './katex';
export { loadKatex };
import { AttachmentPicker, EmptyMedia, Pending, selectSelf, useBlock } from './mediaParts';
import { EmbedAtom, ImageAtom, LinkToPageAtom, PdfAtom } from './media';

export function DividerAtom(props: AtomProps) {
  return <div className="divider-wrap" onMouseDown={event => { event.preventDefault(); selectSelf(props); }}><div className="divider-line" /></div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// The actions over a video, audio or file block (on hover): 다운로드 · 원본 (a new tab) · 바꾸기.
function MediaActions({ href, name, editable, onReplace, children }: { href: string | null; name?: string; editable: boolean; onReplace: (anchor: Element) => void; children?: ReactNode }) {
  return (
    <div className="media-actions" onMouseDown={event => event.preventDefault()}>
      {children}
      {href && href.startsWith('/api/attachments/') ? <a className="media-action icon" href={href} download={name ?? true} aria-label={t("다운로드")} title={t("다운로드")}><Icon name="download" size={16} /></a> : null}
      {editable ? <button type="button" className="media-action" onClick={event => onReplace(event.currentTarget)}>{t("바꾸기")}</button> : null}
      {href ? <a className="media-action" href={href} target="_blank" rel="noopener noreferrer">{t("원본")}</a> : null}
    </div>
  );
}

export function FileAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [picker, setPicker] = useState<Element | null>(null);
  if (!block) return <Pending label={t("파일")} />;
  const attachment = block.attachmentId ? workspace.get<AttachmentEntity>(block.attachmentId) : undefined;
  return (
    <>
      {attachment ? (
        // Placed and sized like other media (정렬 among its actions).
        <ResizableMedia block={block} sync={props.sync} editable={props.view.editable} className="file-figure">{align => (
          <div className="file-block">
            <a className="file-row" href={`/api/attachments/${encodeURIComponent(attachment.id)}`} target="_blank" rel="noopener noreferrer">
              <Icon name="file" size={18} /><span className="file-name">{attachment.name}</span><span className="file-size">{formatBytes(attachment.bytes)}</span>
            </a>
            <MediaActions href={`/api/attachments/${encodeURIComponent(attachment.id)}`} name={attachment.name} editable={props.view.editable} onReplace={setPicker}>{align}</MediaActions>
          </div>
        )}</ResizableMedia>
      ) : <EmptyMedia icon="file" label={t("파일 업로드 또는 첨부 선택")} onClick={setPicker} blockId={block.id} />}
      {picker ? <AttachmentPicker anchor={picker} block={block} kind="file" onClose={() => setPicker(null)} sync={props.sync} /> : null}
    </>
  );
}

function embedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'm.youtube.com'].includes(url.hostname)) {
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') ?? url.pathname.split('/').at(-1);
      if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname) && /^\/\d+$/.test(url.pathname)) return `https://player.vimeo.com/video${url.pathname}`;
  } catch { /* invalid */ }
  return null;
}

export function VideoAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [picker, setPicker] = useState<Element | null>(null);
  if (!block) return <Pending label={t("동영상")} />;
  const embed = block.url ? embedUrl(block.url) : null;
  const source = block.attachmentId ? `/api/attachments/${encodeURIComponent(block.attachmentId)}` : block.url ?? null;
  const name = block.attachmentId ? workspace.get<AttachmentEntity>(block.attachmentId)?.name : undefined;
  return (
    <>
      {block.attachmentId || embed ? (
        // Like a picture: side handles set the width, 정렬 places it left, centre or right.
        <ResizableMedia block={block} sync={props.sync} editable={props.view.editable}
          actions={align => <MediaActions href={source} name={name} editable={props.view.editable} onReplace={setPicker}>{align}</MediaActions>}>
          {block.attachmentId ? <video className="video-player" controls preload="metadata" src={source!} />
            : <div className="video-embed"><iframe src={embed!} title={plainText(block.richText) || t("동영상")} loading="lazy" allowFullScreen referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" /></div>}
        </ResizableMedia>
      ) : block.url ? (
        <div className="file-block">
          <a className="file-row" href={block.url} target="_blank" rel="noopener noreferrer"><Icon name="video" size={18} /><span className="file-name">{block.url}</span></a>
          <MediaActions href={block.url} editable={props.view.editable} onReplace={setPicker} />
        </div>
      ) : <EmptyMedia icon="video" label={t("동영상 추가")} onClick={setPicker} blockId={block.id} />}
      {picker ? <AttachmentPicker anchor={picker} block={block} kind="video" onClose={() => setPicker(null)} sync={props.sync} /> : null}
    </>
  );
}

export function AudioAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [picker, setPicker] = useState<Element | null>(null);
  if (!block) return <Pending label={t("오디오")} />;
  const source = block.attachmentId ? `/api/attachments/${encodeURIComponent(block.attachmentId)}` : block.url && /^https?:/i.test(block.url) ? block.url : null;
  return (
    <>
      {source ? (
        <ResizableMedia block={block} sync={props.sync} editable={props.view.editable} className="audio-figure">{align => (
          <div className="file-block audio-block">
            <audio className="audio-player" controls preload="metadata" src={source} />
            <MediaActions href={source} name={block.attachmentId ? workspace.get<AttachmentEntity>(block.attachmentId)?.name : undefined} editable={props.view.editable} onReplace={setPicker}>{align}</MediaActions>
          </div>
        )}</ResizableMedia>
      ) : <EmptyMedia icon="audio" label={t("오디오 파일 추가")} onClick={setPicker} blockId={block.id} />}
      {picker ? <AttachmentPicker anchor={picker} block={block} kind="audio" onClose={() => setPicker(null)} sync={props.sync} /> : null}
    </>
  );
}

// Breadcrumb (이동 경로): the pages above this one and the page itself in
// 16px, each a link (padding 2/6, r6) separated by a light 13px "/"; the block is 44 high.
export function BreadcrumbAtom(props: AtomProps) {
  const ws = useWorkspace();
  const page = ws.pageOf(props.entry.node.attrs.id) ?? ws.get<PageEntity>(props.pageId);
  const chain = page ? ws.ancestry(page.id).filter(item => item.kind === 'page') as PageEntity[] : [];
  return (
    <div className="breadcrumb-block" onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); selectSelf(props); } }}>
      {chain.map((item, index) => (
        <span key={item.id} className="breadcrumb-part">
          {index ? <span className="breadcrumb-sep">/</span> : null}
          <a className="breadcrumb-link" href={hrefFor(item.id)} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); navigate(item.id); }}>
            {item.icon ? <EntityIcon item={item} size={18} /> : null}<span>{ws.title(item) || t("새 페이지")}</span>
          </a>
        </span>
      ))}
    </div>
  );
}

export function BookmarkAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  if (!block) return <Pending label={t("북마크")} />;
  const create = async (target: string) => {
    setBusy(true);
    try {
      await props.sync.command([{ type: 'block.update', id: block.id, url: target }]);
      const preview = await api<{ url: string; title: string; description: string; siteName: string; image?: string | null; icon?: string | null }>('/api/bookmark-preview', { url: target });
      // The page's picture and the site's icon are downloaded once and kept as attachments (best effort).
      const keep = async (address: string | null | undefined, kind: 'image' | 'icon') => address ? attachFromUrl(address, kind).then(result => result.attachmentId).catch(() => null) : null;
      const [imageAttachmentId, iconAttachmentId] = await Promise.all([keep(preview.image, 'image'), keep(preview.icon, 'icon')]);
      const { image: _image, icon: _icon, ...bookmark } = preview;
      await props.sync.command([{ type: 'block.update', id: block.id, bookmark: { ...bookmark, ...(imageAttachmentId ? { imageAttachmentId } : {}), ...(iconAttachmentId ? { iconAttachmentId } : {}) } }]);
    } catch (error) { report(error); } finally { setBusy(false); }
  };
  if (!block.url) {
    return (
      <form className="bookmark-input" onSubmit={event => { event.preventDefault(); if (url.trim()) create(url.trim()); }}>
        <Icon name="bookmark" size={20} />
        <input className="text-input" placeholder={t("링크를 붙여넣어 북마크를 만드세요")} value={url} onChange={event => setUrl(event.target.value)} disabled={busy} />
        <button type="submit" className="blue-button" disabled={busy || !url.trim()}>{t("북마크 만들기")}</button>
      </form>
    );
  }
  let host = '';
  try { host = new URL(block.url).hostname; } catch { host = block.url; }
  return (
    <a className="bookmark-card" href={block.url} target="_blank" rel="noopener noreferrer" onMouseDown={event => { if (event.button === 0 && !event.metaKey) { /* allow link */ } }}>
      <div className="bookmark-text">
        <div className="bookmark-title">{block.bookmark?.title || host}</div>
        {block.bookmark?.description ? <div className="bookmark-description">{block.bookmark.description}</div> : null}
        <div className="bookmark-url">{block.bookmark?.iconAttachmentId ? <img className="bookmark-favicon" src={`/api/attachments/${encodeURIComponent(block.bookmark.iconAttachmentId)}`} alt="" width={16} height={16} /> : null}<span>{block.url}</span></div>
      </div>
      {block.bookmark?.imageAttachmentId ? <div className="bookmark-image"><img src={`/api/attachments/${encodeURIComponent(block.bookmark.imageAttachmentId)}`} alt="" loading="lazy" draggable={false} /></div> : null}
      {!block.bookmark ? <button type="button" className="text-button tertiary bookmark-refresh" onClick={event => { event.preventDefault(); create(block.url!); }}>{t("미리보기 가져오기")}</button> : null}
    </a>
  );
}

// Button block: the button itself (32 high, r6, 1px line, 14px) and, while
// its settings are open (at once when made from the / menu), a 600-wide r6 panel under it: an
// icon square and the name (17px), then "언제" — the 580×44 r10 "버튼 클릭" card — a short
// connector, "실행" with the action cards and "+ 새 작업", and a full-width blue "완료".
export function ButtonAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [editing, setEditing] = useState<boolean | 'fresh'>(false);
  useEffect(() => { if (block && takeAutoOpen(block.id)) setEditing('fresh'); }, [!!block]);
  if (!block) return <Pending label={t("버튼")} />;
  const label = block.button?.label || t("새 버튼");
  return (
    <div className="button-block" contentEditable={false}>
      <div className="button-block-row">
        <button type="button" className="button-block-run" onClick={() => props.sync.flush().then(() => runButton(block)).catch(report)}>
          {block.button?.icon ? <EntityIcon item={{ kind: 'page', icon: block.button.icon } as PageEntity} size={16} /> : null}<span>{label}</span>
        </button>
        <button type="button" className="icon-button small button-block-settings" aria-label={t("버튼 편집")} title={t("편집")} onClick={() => setEditing(open => !open)}><Icon name="settings" size={16} /></button>
      </div>
      {editing ? <ButtonPanel block={block} sync={props.sync} fresh={editing === 'fresh'} onDone={() => setEditing(false)} /> : null}
    </div>
  );
}

function ButtonPanel({ block, sync, fresh, onDone }: { block: BlockEntity; sync: PageSync; fresh: boolean; onDone: () => void }) {
  // A button just made starts with an empty name field (its placeholder is the default name).
  const [value, setValue] = useState<ButtonDefinition>(() => { const start = structuredClone(block.button ?? { label: '', confirmation: null, actions: [] }); return fresh && !start.actions.length ? { ...start, label: '' } : start; });
  const [iconPicker, setIconPicker] = useState<Element | null>(null);
  const [more, setMore] = useState<Element | null>(null);
  const sourceId = (workspace.ancestry(block.id).find(item => item.kind === 'page') as PageEntity | undefined)?.sourceId;
  const save = () => {
    onDone();
    const next = { ...value, label: value.label.trim() || t("새 버튼") };
    if (JSON.stringify(next) !== JSON.stringify(block.button)) sync.command([{ type: 'block.update', id: block.id, button: next }]).catch(report);
  };
  return (
    <div className="button-panel" onKeyDown={event => event.stopPropagation()}>
      <div className="button-panel-head">
        <button type="button" className="button-panel-icon" aria-label={t("아이콘")} onClick={event => setIconPicker(event.currentTarget)}>
          {value.icon ? <EntityIcon item={{ kind: 'page', icon: value.icon } as PageEntity} size={18} /> : <Icon name="emoji" size={16} />}
        </button>
        <input className="button-panel-name" autoFocus value={value.label} placeholder={t("새 버튼")} aria-label={t("버튼 이름")} onChange={event => setValue({ ...value, label: event.target.value })}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); save(); } }} />
        <button type="button" className="icon-button small" aria-label={t("버튼 옵션")} title={t("옵션")} onClick={event => setMore(event.currentTarget)}><Icon name="more" size={16} /></button>
      </div>
      {more ? <Menu anchor={more} placement="below-end" width={240} onClose={() => setMore(null)} entries={[
        value.confirmation == null
          ? { label: t("실행 전 확인 추가"), icon: 'warning', onSelect: () => setValue({ ...value, confirmation: t("이 버튼을 실행할까요?") }) }
          : { label: t("실행 전 확인 없애기"), icon: 'warning', onSelect: () => setValue({ ...value, confirmation: null }) },
      ]} /> : null}
      <div className="button-panel-body">
        <div className="button-panel-label">{t("언제")}</div>
        <div className="button-panel-card"><Icon name="button-click" size={16} /><span>{t("버튼 클릭")}</span></div>
        <div className="button-panel-connector" />
        <div className="button-panel-label">{t("실행")}</div>
        <ButtonEditor value={value} sourceId={sourceId} onChange={setValue} variant="panel" />
        <button type="button" className="blue-button button-panel-done" onClick={save}>{t("완료")}</button>
      </div>
      {iconPicker ? <EmojiPicker anchor={iconPicker} onClose={() => setIconPicker(null)} onPick={icon => setValue({ ...value, icon })} onRemove={value.icon ? () => setValue({ ...value, icon: null }) : undefined} /> : null}
    </div>
  );
}

function TableCell({ runs, onCommit, header, label, onNavigate, color, rowSpan, colSpan, onMenu, onFill, inRange, onFocusCell, onExtend, onFillRange }: { runs: RichText; onCommit: (next: RichText) => void; header: boolean; label: string; onNavigate: (element: HTMLElement, key: 'next' | 'prev' | 'down') => void; color?: string | null; rowSpan?: number; colSpan?: number; onMenu?: (event: React.MouseEvent) => void; onFill?: (from: 'up' | 'left') => RichText | null; inRange?: boolean; onFocusCell?: () => void; onExtend?: () => boolean; onFillRange?: (direction: 'down' | 'right') => boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const serialized = JSON.stringify(runs);
  useEffect(() => {
    const element = ref.current;
    if (!element || element.contains(document.activeElement)) return;
    element.replaceChildren(richToFragment(runs));
  }, [serialized]);
  const Tag = header ? 'th' : 'td';
  return (
    <Tag className={`simple-table-cell${color ? color.endsWith('_background') ? ` cell-bg-${color.slice(0, -11)}` : ` cell-color-${color}` : ''}${inRange ? ' in-range' : ''}`} rowSpan={rowSpan && rowSpan > 1 ? rowSpan : undefined} colSpan={colSpan && colSpan > 1 ? colSpan : undefined} onContextMenu={onMenu}>
      <div ref={ref} className="simple-table-text" contentEditable suppressContentEditableWarning role="textbox" aria-label={label}
        onFocus={onFocusCell} onMouseDown={event => { if (event.shiftKey && onExtend?.()) event.preventDefault(); }}
        onBlur={event => { const next = readRich(event.currentTarget); if (JSON.stringify(next) !== serialized) onCommit(next); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          // ⌘D / ⌘R (fill down / fill right): this cell takes the content of the cell above / to the left.
          if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && (event.key.toLowerCase() === 'd' || event.key.toLowerCase() === 'r') && onFillRange?.(event.key.toLowerCase() === 'd' ? 'down' : 'right')) { event.preventDefault(); return; }
          if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && (event.key.toLowerCase() === 'd' || event.key.toLowerCase() === 'r') && onFill) {
            event.preventDefault();
            const next = onFill(event.key.toLowerCase() === 'd' ? 'up' : 'left');
            if (next) { event.currentTarget.replaceChildren(richToFragment(next)); onCommit(next); }
            return;
          }
          if (event.key === 'Tab') { event.preventDefault(); onNavigate(event.currentTarget, event.shiftKey ? 'prev' : 'next'); }
          else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onNavigate(event.currentTarget, 'down'); }
          else if (event.key === 'Escape') { event.preventDefault(); (event.currentTarget as HTMLElement).blur(); }
        }} />
    </Tag>
  );
}

type TableAxis = 'row' | 'column';
interface TableHover { r: number; c: number }
interface GripRect { left: number; top: number; width: number; height: number }

// Simple table: block 8 / scroller padding 8 0 24 8 /
// cells 120×35. Hovering a cell shows an 18×6 column grip on its column's top edge and a
// 6×18 row grip on its row's left edge; the grips open insert/duplicate/clear/delete menus
// and drag to reorder. "+" bars (16px, border #e6e5e3 r4) sit 8px right of / below the table.
export function TableAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const innerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<TableHover | null>(null);
  const [selected, setSelected] = useState<{ axis: TableAxis; index: number } | null>(null);
  const [menu, setMenu] = useState<{ axis: TableAxis; index: number; anchor: Element } | null>(null);
  const [drag, setDrag] = useState<{ axis: TableAxis; from: number; to: number } | null>(null);
  const [nearEdge, setNearEdge] = useState<{ right: boolean; bottom: boolean }>({ right: false, bottom: false });
  const [resize, setResize] = useState<{ c: number; left: number; active: boolean; widths?: number[] } | null>(null);
  // A single cell's menu (right-click): its colour, merging with the cell to the right or below, and splitting.
  const [cellMenu, setCellMenu] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  // A range of cells (Shift-click from the cell being edited): ⌘D fills it down from its top row, ⌘R right from its
  // left column.
  const anchorCell = useRef<{ r: number; c: number } | null>(null);
  const [cellRange, setCellRange] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  if (!block) return <Pending label={t("표")} />;
  const cells = block.cells ?? [[[], []], [[], []]];
  const rows = cells.length, cols = cells[0]?.length ?? 0;
  const header = block.tableHeader ?? { row: false, column: false };
  // Per-column widths and per-row/column colours travel with their lines on every edit.
  const widths = resize?.widths ?? Array.from({ length: cols }, (_, i) => block.columnWidths?.[i] ?? 120);
  const full = <T,>(list: T[] | undefined, length: number, fill: T) => Array.from({ length }, (_, i) => list?.[i] ?? fill);
  // Single-cell colours move with their row or column; merged ranges are undone when lines change.
  const cellGrid = () => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => block.cellColors?.[`${r}:${c}`] ?? null));
  const gridColors = (grid: Array<Array<string | null>>) => { const out: Record<string, string> = {}; grid.forEach((row, r) => row.forEach((color, c) => { if (color) out[`${r}:${c}`] = color; })); return Object.keys(out).length ? out : null; };
  const cellFields = (axis: TableAxis, change: <T>(list: T[], fill: T) => T[]): Record<string, unknown> => ({
    ...(block.cellColors ? { cellColors: gridColors(axis === 'row' ? change(cellGrid(), Array.from({ length: cols }, () => null as string | null)) : cellGrid().map(row => change(row, null as string | null))) } : {}),
    ...(block.merges?.length ? { merges: null } : {}),
  });
  const lineFields = (axis: TableAxis, change: <T>(list: T[], fill: T) => T[]): Record<string, unknown> => axis === 'column'
    ? { ...(block.columnWidths ? { columnWidths: change(full(block.columnWidths, cols, 120), 120) } : {}), ...(block.columnColors ? { columnColors: change(full<string | null>(block.columnColors, cols, null), null) } : {}), ...cellFields(axis, change) }
    : { ...(block.rowColors ? { rowColors: change(full<string | null>(block.rowColors, rows, null), null) } : {}), ...cellFields(axis, change) };
  const merges = block.merges ?? [];
  const spanAt = new Map(merges.map(m => [`${m.row}:${m.column}`, m]));
  const covered = new Set<string>();
  for (const m of merges) for (let dr = 0; dr < m.rows; dr++) for (let dc = 0; dc < m.columns; dc++) if (dr || dc) covered.add(`${m.row + dr}:${m.column + dc}`);
  const setCellColor = (r: number, c: number, kind: 'color' | 'background', color: string) => {
    const next = { ...(block.cellColors ?? {}) }, key = `${r}:${c}`;
    if (color === 'default') delete next[key]; else next[key] = kind === 'background' ? `${color}_background` : color;
    props.sync.command([{ type: 'block.update', id: block.id, cellColors: Object.keys(next).length ? next : null }]).catch(report);
  };
  const merge = (r: number, c: number, direction: 'right' | 'down') => {
    const current = spanAt.get(`${r}:${c}`) ?? { row: r, column: c, rows: 1, columns: 1 };
    const grown = direction === 'right' ? { ...current, columns: current.columns + 1 } : { ...current, rows: current.rows + 1 };
    if (grown.row + grown.rows > rows || grown.column + grown.columns > cols) return;
    const inside = (m: { row: number; column: number }) => m.row >= grown.row && m.row < grown.row + grown.rows && m.column >= grown.column && m.column < grown.column + grown.columns;
    const next = [...merges.filter(m => !(m.row === r && m.column === c) && !inside(m)), grown];
    props.sync.command([{ type: 'block.update', id: block.id, merges: next }]).catch(report);
  };
  const unmerge = (r: number, c: number) => props.sync.command([{ type: 'block.update', id: block.id, merges: merges.filter(m => !(m.row === r && m.column === c)).length ? merges.filter(m => !(m.row === r && m.column === c)) : null }]).catch(report);
  const update = (next: RichText[][], extra: Record<string, unknown> = {}) => props.sync.command([{ type: 'block.update', id: block.id, cells: next, ...extra }]).catch(report);
  const setLineColor = (axis: TableAxis, index: number, kind: 'color' | 'background', color: string) => {
    const value = color === 'default' ? null : kind === 'background' ? `${color}_background` : color;
    const list = full<string | null>(axis === 'row' ? block.rowColors : block.columnColors, axis === 'row' ? rows : cols, null);
    list[index] = value;
    props.sync.command([{ type: 'block.update', id: block.id, [axis === 'row' ? 'rowColors' : 'columnColors']: list.some(Boolean) ? list : null }]).catch(report);
  };
  const toggleHeader = (axis: TableAxis, value: boolean) => props.sync.command([{ type: 'block.update', id: block.id, tableHeader: { ...header, [axis === 'row' ? 'row' : 'column']: value } }]).catch(report);
  const setCell = (r: number, c: number, runs: RichText) => update(cells.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? runs : cell))));
  const bounds = cellRange ? { top: Math.min(cellRange.r0, cellRange.r1), bottom: Math.max(cellRange.r0, cellRange.r1), left: Math.min(cellRange.c0, cellRange.c1), right: Math.max(cellRange.c0, cellRange.c1) } : null;
  const inRange = (r: number, c: number) => !!bounds && r >= bounds.top && r <= bounds.bottom && c >= bounds.left && c <= bounds.right;
  const fillRange = (direction: 'down' | 'right') => {
    if (!bounds || (direction === 'down' ? bounds.top === bounds.bottom : bounds.left === bounds.right)) return false;
    (document.activeElement as HTMLElement | null)?.blur?.();
    update(cells.map((row, ri) => row.map((cell, ci) => {
      if (!inRange(ri, ci)) return cell;
      if (direction === 'down') return ri > bounds.top ? cells[bounds.top][ci] : cell;
      return ci > bounds.left ? cells[ri][bounds.left] : cell;
    })));
    return true;
  };
  const cellRect = (r: number, c: number): GripRect | null => {
    const inner = innerRef.current;
    const cell = inner?.querySelector<HTMLElement>(`tr:nth-child(${r + 1}) > :nth-child(${c + 1})`);
    if (!inner || !cell) return null;
    const a = inner.getBoundingClientRect(), b = cell.getBoundingClientRect();
    return { left: b.left - a.left, top: b.top - a.top, width: b.width, height: b.height };
  };
  const onMove = (event: React.MouseEvent) => {
    const cell = (event.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null;
    const inner = innerRef.current;
    if (inner) {
      const a = inner.querySelector('table')!.getBoundingClientRect();
      setNearEdge({ right: event.clientX > a.right - 40, bottom: event.clientY > a.bottom - 40 });
    }
    if ((event.target as HTMLElement).closest('.table-col-resizer')) return;
    if (!cell) { if (resize && !resize.active) setResize(null); return; }
    const r = (cell.parentElement as HTMLTableRowElement).rowIndex, c = cell.cellIndex;
    if (!hover || hover.r !== r || hover.c !== c) setHover({ r, c });
    // Column borders resize (a blue line shows on hover).
    if (inner && !resize?.active) {
      const box = cell.getBoundingClientRect(), origin = inner.getBoundingClientRect();
      const edge = event.clientX > box.right - 5 ? c : event.clientX < box.left + 5 && c > 0 ? c - 1 : -1;
      if (edge < 0) { if (resize) setResize(null); }
      else {
        const border = edge === c ? box.right : box.left;
        if (!resize || resize.c !== edge) setResize({ c: edge, left: border - origin.left, active: false });
      }
    }
  };
  const startResize = (event: React.PointerEvent) => {
    if (!resize || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const c = resize.c, startX = event.clientX, base = [...widths];
    const origin = innerRef.current!.getBoundingClientRect();
    let next = base;
    document.body.classList.add('resizing-columns');
    const onPointerMove = (moveEvent: PointerEvent) => {
      next = [...base];
      next[c] = Math.max(32, Math.round(base[c] + moveEvent.clientX - startX));
      const left = next.slice(0, c + 1).reduce((sum, width) => sum + width, 0);
      setResize({ c, left: left + (innerRef.current!.querySelector('table')!.getBoundingClientRect().left - origin.left), active: true, widths: next });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing-columns');
      setResize(null);
      if (next !== base && next[c] !== base[c]) props.sync.command([{ type: 'block.update', id: block.id, columnWidths: next }]).catch(report);
    };
    window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onUp);
  };
  const move = <T,>(list: T[], from: number, to: number) => { const copy = [...list]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy; };
  const act = (axis: TableAxis, index: number, action: 'before' | 'after' | 'duplicate' | 'clear' | 'delete') => {
    const lines = lineFields(axis, (list, fill) => {
      const copy = [...list];
      if (action === 'delete') copy.splice(index, 1);
      else if (action === 'before') copy.splice(index, 0, fill);
      else if (action === 'after') copy.splice(index + 1, 0, fill);
      else if (action === 'duplicate') copy.splice(index + 1, 0, list[index]);
      return copy;
    });
    if (axis === 'column') {
      if (action === 'delete') { if (cols > 1) update(cells.map(row => row.filter((_, ci) => ci !== index)), lines); return; }
      update(cells.map(row => {
        const copy = [...row];
        if (action === 'before') copy.splice(index, 0, []);
        else if (action === 'after') copy.splice(index + 1, 0, []);
        else if (action === 'duplicate') copy.splice(index + 1, 0, row[index]);
        else copy[index] = [];
        return copy;
      }), lines);
    } else {
      if (action === 'delete') { if (rows > 1) update(cells.filter((_, ri) => ri !== index), lines); return; }
      const copy = [...cells];
      const empty = () => cells[0].map(() => [] as RichText);
      if (action === 'before') copy.splice(index, 0, empty());
      else if (action === 'after') copy.splice(index + 1, 0, empty());
      else if (action === 'duplicate') copy.splice(index + 1, 0, cells[index]);
      else copy[index] = empty();
      update(copy, lines);
    }
  };
  const startGrip = (axis: TableAxis, index: number) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const grip = event.currentTarget as HTMLElement;
    const startX = event.clientX, startY = event.clientY;
    let dragging = false, target = index;
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
      dragging = true;
      const inner = innerRef.current; if (!inner) return;
      const lines = axis === 'column' ? [...inner.querySelectorAll<HTMLElement>('tr:first-child > *')] : [...inner.querySelectorAll<HTMLElement>('tr')];
      target = lines.findIndex(element => { const r = element.getBoundingClientRect(); return axis === 'column' ? e.clientX < r.right : e.clientY < r.bottom; });
      if (target < 0) target = lines.length - 1;
      setDrag({ axis, from: index, to: target });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (dragging) {
        if (target !== index) update(axis === 'column' ? cells.map(row => move(row, index, target)) : move(cells, index, target), lineFields(axis, list => move(list, index, target)));
        return;
      }
      setSelected({ axis, index });
      setMenu({ axis, index, anchor: grip });
    };
    window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onUp);
  };
  const navigate = (element: HTMLElement, key: 'next' | 'prev' | 'down') => {
    const cell = element.closest('td, th') as HTMLTableCellElement;
    const r = (cell.parentElement as HTMLTableRowElement).rowIndex, c = cell.cellIndex;
    let nr = r, nc = c;
    if (key === 'next') { nc++; if (nc >= cols) { nc = 0; nr++; } }
    else if (key === 'prev') { nc--; if (nc < 0) { nc = cols - 1; nr--; } }
    else nr++;
    const focusNow = (rr: number, cc: number) => {
      const next = innerRef.current?.querySelector<HTMLElement>(`tr:nth-child(${rr + 1}) > :nth-child(${cc + 1}) .simple-table-text`);
      if (!next) return false;
      next.focus();
      const range = document.createRange(); range.selectNodeContents(next); range.collapse(false);
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
      return true;
    };
    const focus = (rr: number, cc: number) => { if (!focusNow(rr, cc)) window.requestAnimationFrame(() => focusNow(rr, cc)); };
    if (nr < 0) return;
    if (nr >= rows) { if (key === 'down') { element.blur(); return; } update([...cells, cells[0].map(() => [])], lineFields('row', (list, fill) => [...list, fill])).then(() => focus(nr, nc)); element.blur(); return; }
    focus(nr, nc);
  };
  const shownHover = menu ? (menu.axis === 'column' ? { r: hover?.r ?? 0, c: menu.index } : { r: menu.index, c: hover?.c ?? 0 }) : hover;
  const colGrip = shownHover ? cellRect(0, shownHover.c) : null;
  const rowGrip = shownHover ? cellRect(shownHover.r, 0) : null;
  const outline = selected ? (() => {
    const first = selected.axis === 'column' ? cellRect(0, selected.index) : cellRect(selected.index, 0);
    const last = selected.axis === 'column' ? cellRect(rows - 1, selected.index) : cellRect(selected.index, cols - 1);
    if (!first || !last) return null;
    return { left: first.left, top: first.top, width: last.left + last.width - first.left, height: last.top + last.height - first.top };
  })() : null;
  const dropLine = drag && drag.to !== drag.from ? (() => {
    const rect = drag.axis === 'column' ? cellRect(0, drag.to) : cellRect(drag.to, 0);
    const table = innerRef.current?.querySelector('table');
    if (!rect || !table) return null;
    const after = drag.to > drag.from;
    return drag.axis === 'column'
      ? { left: rect.left + (after ? rect.width : 0) - 1.5, top: 0, width: 3, height: table.offsetHeight }
      : { left: 0, top: rect.top + (after ? rect.height : 0) - 1.5, width: table.offsetWidth, height: 3 };
  })() : null;
  const showRight = !!hover && (hover.c === cols - 1 || nearEdge.right);
  const showBottom = !!hover && (hover.r === rows - 1 || nearEdge.bottom);
  const lineHead = (axis: TableAxis, index: number): MenuEntry[] => [
    ...(index === 0 ? [{
      label: axis === 'row' ? t("머리글 행") : t("머리글 열"), icon: axis === 'row' ? 'table-header-row' : 'table-header-column', keepOpen: true,
      right: <Switch checked={axis === 'row' ? header.row : header.column} onChange={value => toggleHeader(axis, value)} label={axis === 'row' ? t("머리글 행") : t("머리글 열")} />,
      onSelect: () => toggleHeader(axis, !(axis === 'row' ? header.row : header.column)),
    } as MenuEntry] : []),
    { label: t("색"), icon: 'color', keywords: t("color 색"), submenu: () => colorEntries((kind, color) => setLineColor(axis, index, kind, color)), submenuWidth: 220 } as MenuEntry,
  ];
  const menuEntries = (axis: TableAxis, index: number): MenuEntry[] => axis === 'column' ? [
    ...lineHead(axis, index),
    { label: t("왼쪽에 삽입"), icon: 'arrow-left', onSelect: () => act(axis, index, 'before') },
    { label: t("오른쪽에 삽입"), icon: 'arrow-right', onSelect: () => act(axis, index, 'after') },
    { label: t("복제"), icon: 'duplicate', shortcut: '⌘D', onSelect: () => act(axis, index, 'duplicate') },
    { label: t("내용 지우기"), icon: 'clear-content', onSelect: () => act(axis, index, 'clear') },
    { label: t("삭제"), icon: 'trash', disabled: cols <= 1, onSelect: () => act(axis, index, 'delete') },
  ] : [
    ...lineHead(axis, index),
    { label: t("위에 삽입"), icon: 'arrow-up', onSelect: () => act(axis, index, 'before') },
    { label: t("아래에 삽입"), icon: 'arrow-down', onSelect: () => act(axis, index, 'after') },
    { label: t("복제"), icon: 'duplicate', shortcut: '⌘D', onSelect: () => act(axis, index, 'duplicate') },
    { label: t("내용 지우기"), icon: 'clear-content', onSelect: () => act(axis, index, 'clear') },
    { label: t("삭제"), icon: 'trash', disabled: rows <= 1, onSelect: () => act(axis, index, 'delete') },
  ];
  return (
    <div className="simple-table-wrap" onMouseLeave={() => { if (!menu && !drag) { setHover(null); setNearEdge({ right: false, bottom: false }); } if (!resize?.active) setResize(null); }}>
      <div className="simple-table-scroll">
        <div className="simple-table-inner" ref={innerRef} onMouseMove={onMove}>
          <table className="simple-table" style={{ width: widths.reduce((sum, width) => sum + width, 0) }}>
            <colgroup>{widths.map((width, c) => <col key={c} style={{ width }} />)}</colgroup>
            <tbody>
              {cells.map((row, r) => (
                <tr key={r}>
                  {row.map((runs, c) => covered.has(`${r}:${c}`) ? null : <TableCell key={c} runs={runs} header={(header.row && r === 0) || (header.column && c === 0)} label={t("표 {0}행 {1}열", [r + 1, c + 1])} onCommit={next => setCell(r, c, next)} onNavigate={navigate}
                    color={block.cellColors?.[`${r}:${c}`] ?? block.rowColors?.[r] ?? block.columnColors?.[c] ?? null} rowSpan={spanAt.get(`${r}:${c}`)?.rows} colSpan={spanAt.get(`${r}:${c}`)?.columns}
                    onMenu={props.view.editable ? event => { event.preventDefault(); event.stopPropagation(); setCellMenu({ r, c, x: event.clientX, y: event.clientY }); } : undefined}
                    onFill={from => from === 'up' ? (r > 0 ? cells[r - 1][c] : null) : (c > 0 ? cells[r][c - 1] : null)}
                    inRange={inRange(r, c)} onFocusCell={() => { anchorCell.current = { r, c }; if (cellRange) setCellRange(null); }}
                    onExtend={() => { const from = anchorCell.current; if (!from || !props.view.editable) return false; setCellRange({ r0: from.r, c0: from.c, r1: r, c1: c }); return true; }}
                    onFillRange={fillRange} />)}
                </tr>
              ))}
            </tbody>
          </table>
          {resize ? <div className={`table-col-resizer${resize.active ? ' active' : ''}`} style={{ left: resize.left - 2 }} onPointerDown={startResize} /> : null}
          {colGrip ? <button type="button" className={`table-grip column${menu?.axis === 'column' ? ' active' : ''}`} aria-label={t("열 옵션")} style={{ left: colGrip.left + colGrip.width / 2 - 9, top: -3 }} onPointerDown={startGrip('column', shownHover!.c)} /> : null}
          {rowGrip ? <button type="button" className={`table-grip row${menu?.axis === 'row' ? ' active' : ''}`} aria-label={t("행 옵션")} style={{ left: -3, top: rowGrip.top + rowGrip.height / 2 - 9 }} onPointerDown={startGrip('row', shownHover!.r)} /> : null}
          {outline ? <div className="table-selection" style={outline} /> : null}
          {dropLine ? <div className="table-drop-line" style={dropLine} /> : null}
          <button type="button" className={`table-add-column${showRight ? ' shown' : ''}`} aria-label={t("열 추가")} title={t("클릭하여 열 추가")} onClick={() => update(cells.map(row => [...row, []]), lineFields('column', (list, fill) => [...list, fill]))}><Icon name="plus" size={12} /></button>
          <button type="button" className={`table-add-row${showBottom ? ' shown' : ''}`} aria-label={t("행 추가")} title={t("클릭하여 행 추가")} onClick={() => update([...cells, cells[0].map(() => [])], lineFields('row', (list, fill) => [...list, fill]))}><Icon name="plus" size={12} /></button>
        </div>
      </div>
      {menu ? <Menu anchor={menu.anchor} placement="below-start" width={260} search={t("작업 검색…")} entries={menuEntries(menu.axis, menu.index)} onClose={() => { setMenu(null); setSelected(null); setHover(null); }} label={menu.axis === 'column' ? t("열 메뉴") : t("행 메뉴")} /> : null}
      {cellMenu ? <Menu anchor={{ x: cellMenu.x, y: cellMenu.y }} placement="pointer" width={240} label={t("셀 메뉴")} onClose={() => setCellMenu(null)} entries={[
        { kind: 'section', label: t("셀") },
        { label: t("셀 색"), icon: 'color', submenu: () => colorEntries((kind, color) => setCellColor(cellMenu.r, cellMenu.c, kind, color)), submenuWidth: 220 },
        { label: t("셀 내용 지우기"), icon: 'clear-content', onSelect: () => setCell(cellMenu.r, cellMenu.c, []) },
        { kind: 'separator' },
        { label: t("오른쪽 셀과 병합"), icon: 'arrow-right', disabled: (spanAt.get(`${cellMenu.r}:${cellMenu.c}`)?.columns ?? 1) + cellMenu.c >= cols, onSelect: () => merge(cellMenu.r, cellMenu.c, 'right') },
        { label: t("아래 셀과 병합"), icon: 'arrow-down', disabled: (spanAt.get(`${cellMenu.r}:${cellMenu.c}`)?.rows ?? 1) + cellMenu.r >= rows, onSelect: () => merge(cellMenu.r, cellMenu.c, 'down') },
        ...(spanAt.has(`${cellMenu.r}:${cellMenu.c}`) ? [{ label: t("셀 병합 해제"), icon: 'columns', onSelect: () => unmerge(cellMenu.r, cellMenu.c) } as MenuEntry] : []),
      ]} /> : null}
    </div>
  );
}

export function TocAtom(props: AtomProps) {
  const ws = useWorkspace();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(tick => tick + 1), 1500);
    return () => window.clearInterval(timer);
  }, []);
  const headings = flatBlocks(props.view.state.doc).filter(item => item.node.type.name === 'text_block' && /^heading[123]$/.test(item.node.attrs.blockType));
  void ws.version;
  if (!headings.length) return <div className="toc-empty">{t("제목 블록을 추가하면 목차가 표시됩니다.")}</div>;
  return (
    <div className="toc">
      {headings.map(({ node }) => (
        <a key={node.attrs.id} className={`toc-item level-${node.attrs.blockType.slice(-1)}`} href={`#${node.attrs.id}`}
          onClick={event => { event.preventDefault(); props.view.dom.querySelector(`[data-block-id="${CSS.escape(node.attrs.id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>
          {node.textContent || t("빈 제목")}
        </a>
      ))}
    </div>
  );
}

// Equation block: empty, a 49-high r10 bar ("TeX 수식 추가", TeX glyph 25);
// the editor hangs right under the block's left edge — 400×79, r10, a monospace 14/21 field and a
// blue "완료 ↵" at its top right — and the block shows the formula as it is typed.
export function MathAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const preview = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<Element | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const saved = block ? plainText(block.richText) : '';
  const source = draft ?? saved;
  useEffect(() => {
    if (!preview.current) return;
    if (!source) { preview.current.textContent = ''; return; }
    // Errors are shown by us (KaTeX's own error span carries an inline style the page's policy blocks).
    loadKatex().then(module => {
      const target = preview.current;
      if (!target) return;
      try { module.default.render(source, target, { displayMode: true, throwOnError: true, trust: false, maxExpand: 1000, maxSize: 10 }); target.classList.remove('math-error'); }
      catch { target.textContent = source; target.classList.add('math-error'); }
    }).catch(() => { if (preview.current) preview.current.textContent = source; });
  }, [source]);
  useEffect(() => { if (block && takeAutoOpen(block.id) && box.current) setEditing(box.current); }, [!!block]);
  if (!block) return <Pending label={t("수식")} />;
  return (
    <>
      <div ref={box} className={`math-block${source ? '' : ' empty'}${editing ? ' editing' : ''}`} role="button" tabIndex={0} title={t("클릭하여 수식 편집")} onClick={event => setEditing(event.currentTarget)}>
        {source ? <div ref={preview} className="math-render" /> : <div className="math-empty"><Icon name="tex" size={24} /><span>{t("TeX 수식 추가")}</span></div>}
      </div>
      {editing ? <MathEditor anchor={editing} initial={saved} onDraft={setDraft} onClose={() => { setEditing(null); setDraft(null); }} onSave={text => props.sync.command([{ type: 'block.update', id: block.id, richText: text ? [{ text }] : [] }]).catch(report)} /> : null}
    </>
  );
}

const mathExample = '|x| = \\begin{cases}\n  x, &\\quad x \\geq 0 \\\\\n -x, &\\quad x < 0\n\\end{cases}';

export function MathEditor({ anchor, initial, onClose, onSave, onDraft }: { anchor: Element; initial: string; onClose: () => void; onSave: (text: string) => void; onDraft?: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const done = () => { onClose(); if (text !== initial) onSave(text); };
  return (
    <Popover anchor={anchor} placement="below-start" offset={0} onClose={done} className="math-popover" style={{ width: 400 }} label={t("수식 편집")}>
      <div className="math-editor">
        <textarea className="math-input" autoFocus rows={3} spellCheck={false} value={text} placeholder={mathExample} aria-label={t("TeX 수식")}
          onChange={event => { setText(event.target.value); onDraft?.(event.target.value); }}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !event.shiftKey) && !event.nativeEvent.isComposing) { event.preventDefault(); done(); } }} />
        <button type="button" className="blue-button math-done" onClick={done}>{tx("완료 {0}", [<span aria-hidden="true">↵</span>])}</button>
      </div>
    </Popover>
  );
}

// Inline equation editor: 400×41 under the equation (its left, 6 below), r10;
// a one-line monospace 14/21 field (placeholder "E = mc^2", TeX selected on open) on a faint fill and
// the blue "완료 ↵" (58×24) at the right. The equation shows the TeX as it is typed.
export function InlineEquationEditor({ anchor, initial, onClose, onDraft }: { anchor: { x: number; y: number; width: number; height: number }; initial: string; onClose: (tex: string) => void; onDraft?: (tex: string) => void }) {
  const [text, setText] = useState(initial);
  const done = () => onClose(text);
  return (
    <Popover anchor={anchor} placement="below-start" offset={6} onClose={done} className="math-popover inline" style={{ width: 400 }} label={t("수식 편집")}>
      <div className="math-editor inline">
        <input className="math-input inline" autoFocus spellCheck={false} value={text} placeholder="E = mc^2" aria-label={t("TeX 수식")} onFocus={event => event.currentTarget.select()}
          onChange={event => { setText(event.target.value); onDraft?.(event.target.value); }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); done(); } }} />
        <button type="button" className="blue-button math-done" onClick={done}>{tx("완료 {0}", [<span aria-hidden="true">↵</span>])}</button>
      </div>
    </Popover>
  );
}

// Synced block: its content sits in a 2px #f3ddcb r6 outline (6 inside),
// shown while the pointer or the caret is in it; on hover a 184×28 bar (r6, card shadow) rides
// above its right end: "원본 편집 중 ⌄" (where it is shared), a copy button and ⋯.
export function SyncedAtom(props: AtomProps) {
  const ws = useWorkspace();
  const id = props.entry.node.attrs.id;
  const [shared, setShared] = useState<Element | null>(null);
  const [more, setMore] = useState<Element | null>(null);
  const references = ws.snapshot.objects.filter(item => item.kind === 'block' && item.alive && (item as BlockEntity).blockType === 'synced_reference' && (item as BlockEntity).sourceBlockId === id) as BlockEntity[];
  const copy = () => navigator.clipboard.writeText(id).then(() => setStatus(t("동기화 블록을 복사했습니다. 다른 페이지에서 \"동기화 블록 참조\"로 붙여 넣으세요."))).catch(report);
  return (
    <div className="synced-top" contentEditable={false}>
      <div className="synced-toolbar" onMouseDown={event => event.preventDefault()}>
        <button type="button" className="synced-tool wide" aria-label={t("참조 위치")} onClick={event => setShared(event.currentTarget)}>
          <span>{t("원본 편집 중")}</span><Icon name="chevron-down" size={12} />
        </button>
        <span className="synced-tool-sep" />
        <button type="button" className="synced-tool" aria-label={t("동기화 블록 복사")} title={t("동기화 블록 복사")} onClick={copy}><Icon name="copy" size={16} /></button>
        <button type="button" className="synced-tool" aria-label={t("블록 작업 메뉴 열기")} title={t("블록 작업 메뉴 열기")} onClick={event => setMore(event.currentTarget)}><Icon name="more" size={16} /></button>
      </div>
      {shared ? (
        <Menu anchor={shared} placement="below-end" width={260} onClose={() => setShared(null)} entries={[
          { kind: 'section', label: references.length ? t("{0}개 위치에서 동기화됨", [references.length + 1]) : t("아직 다른 곳에 없습니다") },
          { label: workspace.title(workspace.pageOf(id)) || t("이 페이지"), icon: 'page', checked: true, hint: t("원본") },
          ...references.map(reference => { const page = workspace.pageOf(reference.id); return { label: workspace.title(page) || t("새 페이지"), icon: 'page', onSelect: () => { if (page) navigate(page.id); } } as MenuEntry; }),
        ]} />
      ) : null}
      {more ? (
        <Menu anchor={more} placement="below-end" width={240} onClose={() => setMore(null)} entries={[
          { label: t("동기화 블록 복사"), icon: 'copy', onSelect: copy },
          { label: t("블록 링크 복사"), icon: 'link', onSelect: () => { const url = new URL(hrefFor(props.pageId), location.href); url.hash = id; navigator.clipboard.writeText(url.href).then(() => setStatus(t("블록 링크를 복사했습니다."))).catch(report); } },
          // 모두 동기화 해제: every copy keeps its content as ordinary blocks, and so does the original.
          ...(props.view.editable ? [{ label: references.length ? t("모든 사본 동기화 해제") : t("동기화 해제"), icon: 'synced', onSelect: () => {
            confirmDialog(t("동기화 해제"), references.length ? t("{0}개 사본과 원본이 각자 따로 편집되는 일반 블록이 됩니다.", [references.length]) : t("이 블록이 일반 블록이 됩니다."), { confirmLabel: t("동기화 해제") })
              .then(ok => ok ? props.sync.flush().then(() => props.sync.command([{ type: 'block.unsync', id }])).then(() => setStatus(t("동기화를 해제했습니다."))) : undefined).catch(report);
          } } as MenuEntry] : []),
        ]} />
      ) : null}
    </div>
  );
}

function ReadOnlyBlocks({ parentId, depth = 0 }: { parentId: string; depth?: number }): ReactNode {
  const ws = useWorkspace();
  if (depth > 8) return null;
  return ws.children(parentId).filter(child => child.kind === 'block').map(child => {
    const block = child as BlockEntity;
    return (
      <div key={block.id} className={`readonly-block readonly-${block.blockType}`} style={{ paddingLeft: depth * 24 }}>
        <span>{block.blockType === 'bullet' ? '• ' : block.blockType === 'todo' ? (block.checked ? '☑ ' : '☐ ') : ''}{plainText(block.richText) || (block.blockType === 'divider' ? '──────' : '')}</span>
        <ReadOnlyBlocks parentId={block.id} depth={depth + 1} />
      </div>
    );
  });
}

export function SyncedReferenceAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [editing, setEditing] = useState(false);
  if (!block) return <Pending label={t("동기화 참조")} />;
  const source = block.sourceBlockId ? workspace.get<BlockEntity>(block.sourceBlockId) : undefined;
  const owner = source ? workspace.pageOf(source.id) : undefined;
  const live = !!source && workspace.visible(source.id);
  return (
    <div className="synced-reference">
      <div className="synced-header"><Icon name="synced" size={14} /><span>{t("동기화 참조{0}", [owner ? t(" · 원본: {0}", [owner.title || t("새 페이지")]) : ''])}</span>
        {/* 여기서 편집: the shared content in an editor of its own; every copy and the original change with it. */}
        {live && props.view.editable ? <button type="button" className="text-button tertiary" onClick={() => setEditing(true)}>{t("여기서 편집")}</button> : null}
        {owner ? <button type="button" className="text-button tertiary" onClick={() => navigate(owner.id)}>{t("원본으로 이동")}</button> : null}
        {props.view.editable ? <button type="button" className="text-button tertiary" onClick={() => props.sync.flush().then(() => props.sync.command([{ type: 'block.unsync', id: block.id }])).then(() => setStatus(t("이 사본의 동기화를 해제했습니다."))).catch(report)}>{t("동기화 해제")}</button> : null}
      </div>
      {editing && source ? <SyncedEditDialog sourceId={source.id} onClose={() => setEditing(false)} /> : null}
      {source && workspace.visible(source.id) ? <ReadOnlyBlocks parentId={source.id} /> : <div className="empty-note">{t("원본 블록을 찾을 수 없습니다.")}</div>}
    </div>
  );
}

function SyncedEditDialog({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  return (
    <Dialog title={t("동기화 블록 편집")} width={760} onClose={onClose}>
      <p className="muted small">{t("여기서 고친 내용은 원본과 모든 사본에 바로 반영됩니다.")}</p>
      <div className="synced-edit-host"><PageEditor pageId={sourceId} scroller={null} /></div>
    </Dialog>
  );
}

export function PageLinkAtom(props: AtomProps) {
  const ws = useWorkspace();
  const page = ws.get<PageEntity>(props.entry.node.attrs.id);
  if (!page) return null;
  return (
    <a className="page-link" href={hrefFor(page.id)} onClick={event => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); navigate(page.id); } }}>
      <span className="page-link-icon"><EntityIcon item={page} size={20} /></span>
      <span className="page-link-title">{page.title || t("새 페이지")}</span>
    </a>
  );
}

export function DatabaseAtom(props: AtomProps) {
  const { sourceId, viewIds, linked } = props.entry.node.attrs as { sourceId: string; viewIds: string[]; linked: boolean };
  return <DatabaseBlock sourceId={sourceId} viewIds={viewIds} pageId={props.pageId} linked={linked} inline />;
}

// Captions of media blocks ("캡션 ⌘⌥M"): the block's richText, a 14/19.6 line
// under it, "캡션을 작성하세요…" while empty; an empty caption goes away when the caret leaves it.
function AtomCaption({ entry, view, sync }: AtomProps) {
  const block = useBlock(entry.node.attrs.id);
  const saved = block ? plainText(block.richText) : '';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = entry.node.attrs.id as string;
  useEffect(() => {
    const onFocus = (event: Event) => {
      if ((event as CustomEvent<{ id: string }>).detail.id !== id) return;
      setOpen(true);
      window.setTimeout(() => {
        const element = ref.current;
        if (!element) return;
        element.focus();
        const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
        const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      }, 60);
    };
    window.addEventListener('caption-focus', onFocus);
    return () => window.removeEventListener('caption-focus', onFocus);
  }, [id]);
  useEffect(() => {
    const element = ref.current;
    if (element && document.activeElement !== element && (element.textContent ?? '') !== saved) element.textContent = saved;
  }, [saved, open]);
  if (!block || (!saved && !open)) return null;
  const save = () => {
    const text = (ref.current?.textContent ?? '').replace(/\n+/g, ' ');
    if (!text.trim()) setOpen(false);
    if (text.trim() === saved.trim()) return;
    sync.command([{ type: 'block.update', id, richText: text.trim() ? [{ text }] : [] }]).catch(report);
  };
  return (
    <div ref={ref} className="block-caption atom-caption" role="textbox" aria-label={t("캡션")} data-placeholder={t("캡션을 작성하세요…")}
      contentEditable={view.editable ? 'plaintext-only' : false} suppressContentEditableWarning onBlur={save}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') { event.preventDefault(); (event.currentTarget as HTMLElement).blur(); view.focus(); }
        else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectContents(event.currentTarget); }
      }} />
  );
}

export function renderAtom(props: AtomProps): ReactNode {
  const node = props.entry.node;
  if (captionTypes.has(node.attrs.blockType)) return <>{renderAtomBody(props)}<AtomCaption {...props} /></>;
  return renderAtomBody(props);
}

function renderAtomBody(props: AtomProps): ReactNode {
  const node = props.entry.node;
  if (node.type.name === 'page_link') return <PageLinkAtom {...props} />;
  if (node.type.name === 'tabs') return <TabsHeader {...props} />;
  if (node.type.name === 'database') return <DatabaseAtom {...props} />;
  switch (node.attrs.blockType) {
    case 'divider': return <DividerAtom {...props} />;
    case 'image': return <ImageAtom {...props} />;
    case 'file': return <FileAtom {...props} />;
    case 'video': return <VideoAtom {...props} />;
    case 'audio': return <AudioAtom {...props} />;
    case 'html': return <HtmlAtom {...props} />;
    case 'pdf': return <PdfAtom {...props} />;
    case 'embed': return <EmbedAtom {...props} />;
    case 'link_to_page': return <LinkToPageAtom {...props} />;
    case 'breadcrumb': return <BreadcrumbAtom {...props} />;
    case 'bookmark': return <BookmarkAtom {...props} />;
    case 'button': return <ButtonAtom {...props} />;
    case 'table': return <TableAtom {...props} />;
    case 'toc': return <TocAtom {...props} />;
    case 'math': return <MathAtom {...props} />;
    case 'synced': return <SyncedAtom {...props} />;
    case 'synced_reference': return <SyncedReferenceAtom {...props} />;
    default: return <div className="empty-note">{t("지원하지 않는 블록")}</div>;
  }
}

export function useAtomEntries(list: () => AtomEntry[], version: number) {
  return useMemo(() => list(), [version]);
}

export { apply };
