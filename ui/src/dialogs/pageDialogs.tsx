import { t, translateServerMessage } from '../i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EditorView } from 'prosemirror-view';
import { api } from '../data/api';
import { apply, newId } from '../data/commands';
import { navigate } from '../data/router';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import { blockLabels, displayDate, formatValue, plainText } from '../data/format';
import type { BlockEntity, ButtonDefinition, Entity, Operation, PageEntity, PropertyEntity, ReminderEntity, RichText, SourceEntity, ViewEntity } from '../data/types';
import { Dialog, Switch } from '../ui/primitives';
import { openPrint, printSizes, type PrintSize } from '../page/PrintDocument';
import { Popover, type Anchor, type Placement } from '../ui/overlay';
import { PagePickerPanel, type PickTarget } from './PagePickerPanel';
import { Icon } from '../ui/Icon';
import { EntityIcon } from '../page/EntityIcon';
import { ButtonEditor, emptyButton } from './buttons';
import { schema } from '../editor/schema';
import { blockAt, selectedOrCurrentBlocks } from '../editor/blocks';
import { viaCommand } from '../editor/slashItems';
import type { PageSync } from '../editor/sync';

type Close = { onClose: () => void };

// ---------- page picker (move, link, move blocks) ----------

function pageCandidates(exclude: Set<string>, query: string): PageEntity[] {
  const needle = query.trim().toLocaleLowerCase();
  return (workspace.snapshot.objects.filter(item => item.kind === 'page' && !(item as PageEntity).template && workspace.visible(item.id) && !exclude.has(item.id)) as PageEntity[])
    .filter(page => !needle || (page.title || '').toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 60);
}

function pagePath(page: PageEntity) {
  return workspace.ancestry(page.id).filter(item => item.id !== page.id && item.kind === 'page').map(item => workspace.title(item) || t("새 페이지")).join(' / ');
}

export function PagePicker({ title, placeholder, exclude = new Set<string>(), allowRoot = false, onPick, onClose }: { title: string; placeholder: string; exclude?: Set<string>; allowRoot?: boolean; onPick: (page: PageEntity | null) => void | Promise<void>; onClose: () => void }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const pages = useMemo(() => pageCandidates(exclude, query), [ws.version, query]);
  const choices: Array<PageEntity | null> = [...(allowRoot && !query.trim() ? [null] : []), ...pages];
  const pick = async (page: PageEntity | null) => { try { await onPick(page); onClose(); } catch (error) { report(error); } };
  return (
    <Dialog title={title} onClose={onClose} width={440}>
      <input className="text-input" autoFocus placeholder={placeholder} value={query}
        onChange={event => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(choices.length - 1, index + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
          if (event.key === 'Enter') { event.preventDefault(); if (choices[active] !== undefined) pick(choices[active]); }
        }} />
      <div className="picker-list">
        {choices.map((page, index) => (
          <div key={page?.id ?? 'root'} className={`picker-row${index === active ? ' active' : ''}`} onPointerMove={() => setActive(index)} onClick={() => pick(page)}>
            {page ? <EntityIcon item={page} size={20} /> : <Icon name="home" size={20} />}
            <div className="picker-main">
              <div className="picker-title">{page ? page.title || t("새 페이지") : t("개인 페이지 (최상위)")}</div>
              {page && pagePath(page) ? <div className="picker-path">{pagePath(page)}</div> : null}
            </div>
          </div>
        ))}
        {!choices.length ? <p className="muted">{t("일치하는 페이지가 없습니다.")}</p> : null}
      </div>
    </Dialog>
  );
}

function descendants(id: string): Set<string> {
  const result = new Set<string>([id]);
  const walk = (parent: string) => { for (const child of workspace.children(parent)) { result.add(child.id); walk(child.id); } };
  walk(id);
  return result;
}

// "다른 페이지로 옮기기": the page picker, 330×420, right under what opened it —
// the block handle (left edges lined up), the page ⋯ button (right edges), a menu's anchor — or, from
// the keyboard, under the page ⋯ button. Placeholder "페이지의 이동 위치…"; pages only.
export function MovePicker({ anchor, placement = 'below-start', exclude, allowRoot, onPick, onClose }: Close & { anchor?: Anchor; placement?: Placement; exclude: Set<string>; allowRoot: boolean; onPick: (page: PickTarget) => Promise<void> }) {
  const fallback = [...document.querySelectorAll<HTMLElement>('.topbar button[aria-haspopup="menu"]')].pop();
  const at = anchor ?? fallback ?? null;
  return (
    <Popover anchor={at ?? { x: window.innerWidth / 2 - 165, y: 120 }} placement={at ? (anchor ? placement : 'below-end') : 'point'} offset={0} onClose={onClose} className="menu-panel picker-popover" style={{ width: 330 }} label={t("다른 페이지로 옮기기")}>
      <PagePickerPanel placeholder={t("move|페이지의 이동 위치…")} exclude={exclude} allowRoot={allowRoot} pagesOnly close={onClose} onPick={onPick} />
    </Popover>
  );
}

export function MovePageDialog({ id, anchor, placement, onClose }: Close & { id: string; anchor?: Anchor; placement?: Placement }) {
  const item = workspace.get(id);
  if (!item) return null;
  if (item.kind === 'page' && (item as PageEntity).sourceId) {
    return <Dialog title={t("옮기기")} onClose={onClose} width={420}><p>{t("데이터베이스 항목은 다른 데이터베이스로 옮길 수 없습니다. 복제하거나 내보내기를 사용하세요.")}</p></Dialog>;
  }
  return <MovePicker anchor={anchor} placement={placement} allowRoot exclude={descendants(id)} onClose={onClose}
    onPick={async page => { await apply([{ type: 'node.move', id, parentId: page?.id ?? null }]); setStatus(t("{0}(으)로 옮겼습니다.", [page ? workspace.title(page) || t("새 페이지") : t("개인 페이지")])); }} />;
}

export function MoveBlocksDialog({ ids, pageId, anchor, placement, onClose }: Close & { ids: string[]; pageId: string; anchor?: Anchor; placement?: Placement }) {
  const existing = ids.filter(id => workspace.get(id));
  return <MovePicker anchor={anchor} placement={placement} allowRoot={false} exclude={new Set([pageId])} onClose={onClose}
    onPick={async page => {
      if (!page) return;
      if (!existing.length) throw new Error(t("저장된 블록이 없습니다."));
      await apply(existing.map(id => ({ type: 'node.move', id, parentId: page.id })));
      setStatus(t("{0}개 블록을 {1}(으)로 옮겼습니다.", [existing.length, workspace.title(page) || t("새 페이지")]));
    }} />;
}

export function LinkPageDialog({ view, sync, block, onClose }: Close & { view: EditorView; sync?: PageSync; block?: boolean }) {
  return <PagePicker title={t("페이지 링크")} placeholder={t("링크할 페이지 검색…")} onClose={onClose}
    onPick={async page => {
      if (!page) return;
      const info = blockAt(view.state.selection.$from);
      // The / command makes a link-to-page block: the empty line becomes it, otherwise it goes below.
      if (block && sync && info) {
        const runs = [{ text: page.title || t("새 페이지"), pageId: page.id }];
        await sync.flush();
        const id = info.node.attrs.id as string, current = workspace.get<BlockEntity>(id);
        const empty = info.node.type.name === 'text_block' && info.node.content.size === 0 && !!current;
        if (empty) await sync.command([{ type: 'block.update', id, blockType: 'link_to_page', richText: runs }]);
        else if (current) {
          const siblings = workspace.children(current.parentId), next = siblings[siblings.findIndex(item => item.id === id) + 1];
          await sync.command([{ type: 'block.create', parentId: current.parentId!, blockType: 'link_to_page', richText: runs, ...(next ? { beforeId: next.id } : {}) }]);
        }
        return;
      }
      const node = schema.nodes.mention.create({ pageId: page.id, text: page.title || t("새 페이지") });
      const tr = view.state.tr;
      if (info && info.node.type.name === 'text_block') tr.replaceSelectionWith(node);
      view.dispatch(tr.scrollIntoView());
      view.focus();
    }} />;
}

// ---------- linked view / synced reference (placed at the caret) ----------

function contextFor(view: EditorView, pageId: string, sync: PageSync) {
  const info = blockAt(view.state.selection.$from);
  if (!info) throw new Error(t("블록을 넣을 위치를 찾지 못했습니다."));
  return { view, pageId, sync, info, openDialog: () => undefined };
}

export function LinkedViewDialog({ view, pageId, sync, onClose }: Close & { view: EditorView; pageId: string; sync: PageSync }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const sources = (ws.sources() as SourceEntity[]).filter(source => !query.trim() || source.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const create = async (source: SourceEntity, base?: ViewEntity) => {
    const id = newId();
    await viaCommand(contextFor(view, pageId, sync), ({ topSiblingAfter }) => [
      { type: 'view.create', id, sourceId: source.id, parentId: pageId, name: base?.name ?? t("표"), viewType: base?.viewType ?? 'table', config: base ? structuredClone(base.config) : {} },
      ...(topSiblingAfter ? [{ type: 'node.move', id, parentId: pageId, beforeId: topSiblingAfter } as Operation] : []),
    ]);
    onClose();
  };
  return (
    <Dialog title={t("데이터 소스의 링크된 보기")} onClose={onClose} width={460}>
      <input className="text-input" autoFocus placeholder={t("데이터 소스 검색…")} value={query} onChange={event => setQuery(event.target.value)} />
      <div className="picker-list">
        {sources.map(source => {
          const views = ws.viewsOf(source.id) as ViewEntity[];
          return (
            <div key={source.id} className="picker-group">
              <div className="picker-row" onClick={() => create(source, views[0]).catch(report)}>
                <Icon name="database" size={20} />
                <div className="picker-main"><div className="picker-title">{source.name}</div><div className="picker-path">{workspace.title(workspace.get(source.parentId)) || ''}</div></div>
              </div>
              {views.length > 1 ? views.map(base => (
                <div key={base.id} className="picker-row sub" onClick={() => create(source, base).catch(report)}>
                  <Icon name={base.viewType === 'table' ? 'table' : base.viewType} size={16} /><span>{t("{0} 보기에서 시작", [base.name])}</span>
                </div>
              )) : null}
            </div>
          );
        })}
        {!sources.length ? <p className="muted">{t("데이터베이스가 없습니다.")}</p> : null}
      </div>
    </Dialog>
  );
}

export function SyncedReferenceDialog({ view, pageId, sync, onClose }: Close & { view: EditorView; pageId: string; sync: PageSync }) {
  const ws = useWorkspace();
  const originals = (ws.snapshot.objects.filter(item => item.kind === 'block' && (item as BlockEntity).blockType === 'synced' && ws.visible(item.id)) as BlockEntity[]);
  const labelOf = (block: BlockEntity) => plainText((ws.children(block.id)[0] as BlockEntity | undefined)?.richText) || t("동기화 블록");
  return (
    <Dialog title={t("동기화 블록 붙여넣기")} onClose={onClose} width={460}>
      <p className="muted">{t("원본 동기화 블록을 고르면 이 위치에 같은 내용을 보여 줍니다. 원본을 고치면 모든 곳에 반영됩니다.")}</p>
      <div className="picker-list">
        {originals.map(block => {
          const page = workspace.ancestry(block.id).find(item => item.kind === 'page') as PageEntity | undefined;
          return (
            <div key={block.id} className="picker-row" onClick={async () => {
              await viaCommand(contextFor(view, pageId, sync), ({ siblingAfter, parentId }) => [{ type: 'block.create', parentId, blockType: 'synced_reference', sourceBlockId: block.id, ...(siblingAfter ? { beforeId: siblingAfter } : {}) }]);
              onClose();
            }}>
              <Icon name="synced" size={20} />
              <div className="picker-main"><div className="picker-title">{labelOf(block)}</div><div className="picker-path">{page?.title || ''}</div></div>
            </div>
          );
        })}
        {!originals.length ? <p className="muted">{t("동기화 블록이 없습니다. 먼저 /동기화 블록으로 원본을 만드세요.")}</p> : null}
      </div>
    </Dialog>
  );
}

// ---------- turn into page ----------

export async function turnIntoPage(view: EditorView, pageId: string, sync: PageSync) {
  const infos = selectedOrCurrentBlocks(view.state).filter(info => info.node.type.name === 'text_block' || info.node.type.name === 'code_block');
  if (!infos.length) return;
  const ids = infos.map(info => info.node.attrs.id as string);
  await sync.flush();
  const operations: Operation[] = [];
  const opened: string[] = [];
  for (const id of ids) {
    const block = workspace.get<BlockEntity>(id);
    if (!block) continue;
    const page = newId();
    operations.push({ type: 'page.create', id: page, title: plainText(block.richText), parentId: block.parentId ?? pageId });
    operations.push({ type: 'node.move', id: page, parentId: block.parentId ?? pageId, beforeId: id });
    for (const child of workspace.children(id)) operations.push({ type: 'node.move', id: child.id, parentId: page });
    operations.push({ type: 'node.trash', id });
    opened.push(page);
  }
  if (!operations.length) return;
  await apply(operations);
  setStatus(opened.length > 1 ? t("{0}개 페이지로 전환했습니다.", [opened.length]) : t("페이지로 전환했습니다."));
}

// ---------- comments ----------

export function CommentDialog({ parentId, quote, onClose }: Close & { parentId: string; quote?: string }) {
  const [text, setText] = useState('');
  const revision = workspace.revision;
  return (
    <Dialog title={t("댓글")} onClose={onClose} width={460} submitLabel={t("댓글 달기")} onSubmit={async () => {
      if (!text.trim()) throw new Error(t("내용을 입력하세요."));
      if (!workspace.get(parentId)) throw new Error(t("블록을 먼저 저장하고 있습니다. 잠시 후 다시 시도하세요."));
      const runs: RichText = quote ? [{ text: `“${quote}” ` , italic: true }, { text }] : [{ text }];
      await apply([{ type: 'comment.create', parentId, richText: runs }], { revision });
    }}>
      {quote ? <blockquote className="comment-quote">{quote}</blockquote> : null}
      <textarea className="text-input" autoFocus rows={4} placeholder={t("댓글 추가…")} value={text} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }} />
      <p className="muted small">{t("개인용 메모로 저장됩니다. ⌘Enter로 저장.")}</p>
    </Dialog>
  );
}

// ---------- reminders ----------

const toLocalInput = (iso?: string) => iso ? new Date(Date.parse(iso) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

export function ReminderDialog({ parentId, existing, onClose }: Close & { parentId: string; existing?: ReminderEntity }) {
  const parent = workspace.get(parentId);
  const page = parent?.kind === 'page' ? parent as PageEntity : undefined;
  const dates = page?.sourceId ? workspace.schema(page.sourceId).filter(property => property.type === 'date') : [];
  const [propertyId, setPropertyId] = useState(existing?.datePropertyId ?? '');
  const [at, setAt] = useState(() => toLocalInput(existing?.at) || (() => { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(9, 0, 0, 0); return toLocalInput(date.toISOString()); })());
  const [offset, setOffset] = useState(existing?.offsetMinutes ?? 0);
  const [message, setMessage] = useState(existing?.message ?? (page?.title ? t("{0} 알림", [page.title]) : t("reminder|알림")));
  const revision = workspace.revision;
  return (
    <Dialog title={t("알림 설정")} onClose={onClose} width={440} submitLabel={t("알림 저장")} onSubmit={async () => {
      if (!workspace.get(parentId)) throw new Error(t("블록을 먼저 저장하고 있습니다. 잠시 후 다시 시도하세요."));
      if (!propertyId && !at) throw new Error(t("알림 시각을 정하세요."));
      await apply([{ type: 'reminder.set', id: existing?.id ?? newId(), parentId, ...(propertyId ? { datePropertyId: propertyId } : { at: new Date(at).toISOString() }), offsetMinutes: Number(offset) || 0, message: message || t("알림") }], { revision });
      setStatus(t("알림을 저장했습니다."));
    }}>
      {dates.length ? (
        <label className="field"><span>{t("기준")}</span>
          <select className="text-input" value={propertyId} onChange={event => setPropertyId(event.target.value)}>
            <option value="">{t("직접 시각 지정")}</option>
            {dates.map(property => <option key={property.id} value={property.id}>{t("{0} 날짜에 맞춤", [property.name])}</option>)}
          </select>
        </label>
      ) : null}
      {propertyId ? (
        <label className="field"><span>{t("날짜 시작 몇 분 전")}</span><input className="text-input" type="number" min={0} value={offset} onChange={event => setOffset(Number(event.target.value))} /></label>
      ) : (
        <label className="field"><span>{t("알림 시각 (이 기기의 시간대)")}</span><input className="text-input" type="datetime-local" value={at} onChange={event => setAt(event.target.value)} /></label>
      )}
      <label className="field"><span>{t("알림 내용")}</span><input className="text-input" value={message} onChange={event => setMessage(event.target.value)} /></label>
    </Dialog>
  );
}

// ---------- button settings ----------

export function ButtonSettingsDialog({ ownerId, onClose }: Close & { ownerId: string }) {
  const owner = workspace.get<BlockEntity | PropertyEntity>(ownerId);
  const [value, setValue] = useState<ButtonDefinition>(() => structuredClone(owner?.button ?? emptyButton()));
  const revision = workspace.revision;
  if (!owner) return null;
  const sourceId = owner.kind === 'property' ? (owner as PropertyEntity).sourceId : (workspace.ancestry(owner.id).find(item => item.kind === 'page') as PageEntity | undefined)?.sourceId;
  return (
    <Dialog title={t("버튼 설정")} onClose={onClose} width={600} submitLabel={t("저장")} onSubmit={async () => {
      if (!value.label.trim()) throw new Error(t("버튼 이름을 입력하세요."));
      await apply([{ type: owner.kind === 'property' ? 'property.update' : 'block.update', id: owner.id, button: value }], { revision });
    }}>
      <ButtonEditor value={value} sourceId={sourceId} onChange={setValue} />
    </Dialog>
  );
}

// ---------- export ----------

// 내보내기 (Markdown & CSV · HTML · PDF; include content, include subpages, create folders for subpages,
// comments in HTML, a database's current or default view; PDF page format and scale). Several files come as one ZIP.
// "Inkacre 묶음" keeps everything (structure, formulas, attachments) for restoring here.
// PDF files are made by this computer's Chromium-based browser in the background (src/pdf-export.mjs): one PDF, or
// with subpages a ZIP of one PDF per page and folders of their pictures and files. The interface's
// language and settings go along so the pages read as they do here. Without such a browser, the print window.
const pdfPrefs = ['pageyard-language', 'pageyard-settings-v1', 'pageyard-toggle-open-v2', 'pageyard-chart-background'];
interface PdfJob { id: string; status: 'running' | 'done' | 'failed' | 'cancelled'; done: number; total: number; filename?: string; error?: { message: string } }
function downloadUrl(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
}

export function ExportDialog({ id, viewId, onClose }: Close & { id: string; viewId?: string | null }) {
  // id "*": every top-level page (설정 › 일반 › 모든 워크스페이스 콘텐츠 내보내기).
  const whole = id === '*';
  const current = whole ? undefined : workspace.get(id);
  const isSource = current?.kind === 'source';
  const page = current?.kind === 'page' ? current as PageEntity : null;
  const pageSource = page ? workspace.children(page.id).find(child => child.kind === 'source' && workspace.visible(child.id)) : undefined;
  const database = isSource || !!pageSource;
  // 기본 보기: the database's first view (its filters and properties); without views, every row.
  const exportSourceId = isSource ? id : pageSource?.id;
  const holderId = isSource ? current?.parentId ?? null : page?.id ?? null;
  const defaultViewId = exportSourceId && holderId ? workspace.children(holderId).find(child => child.kind === 'view' && workspace.visible(child.id) && (child as { sourceId?: string }).sourceId === exportSourceId)?.id ?? null : null;
  const formats = [
    { id: 'markdown', name: t("Markdown 및 CSV") }, ...(page ? [{ id: 'html', name: 'HTML' }, { id: 'pdf', name: 'PDF' }] : [{ id: 'html', name: 'HTML' }]), ...(whole ? [] : [{ id: 'bundle', name: t("Inkacre 묶음 (모든 구조와 첨부, JSON)") }]),
  ];
  const [format, setFormat] = useState('markdown');
  const [files, setFiles] = useState(true);
  const [subpages, setSubpages] = useState(false);
  const [folders, setFolders] = useState(true);
  const [comments, setComments] = useState(false);
  const [scope, setScope] = useState<'current' | 'default'>(viewId ? 'current' : 'default');
  const [size, setSize] = useState<PrintSize>('A4');
  const [scale, setScale] = useState(100);
  const [result, setResult] = useState<{ text: string; encoding?: string; mediaType: string; filename: string; warnings: string[] } | null>(null);
  const [pdfBrowser, setPdfBrowser] = useState<{ available: boolean; browser: string | null } | null>(null);
  const [pdfJob, setPdfJob] = useState<PdfJob | null>(null);
  const running = useRef<string | null>(null);
  useEffect(() => { if (format === 'pdf' && !pdfBrowser) api<{ available: boolean; browser: string | null }>('/api/export/pdf').then(setPdfBrowser).catch(() => setPdfBrowser({ available: false, browser: null })); }, [format, pdfBrowser]);
  const close = () => { if (running.current) api(`/api/export/pdf/${running.current}/cancel`, {}).catch(() => undefined); running.current = null; onClose(); };
  const makePdf = async () => {
    const prefs: Record<string, string> = {};
    for (const key of pdfPrefs) { try { const value = localStorage.getItem(key); if (value != null) prefs[key] = value; } catch { /* storage blocked */ } }
    let job = await api<PdfJob>('/api/export/pdf', { id, subpages, files, size, scale, prefs });
    running.current = job.id; setPdfJob(job);
    while (job.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, 400));
      if (running.current !== job.id) return false;
      job = await api<PdfJob>(`/api/export/pdf/${job.id}`);
      setPdfJob(job);
    }
    running.current = null;
    if (job.status !== 'done') throw new Error(job.error?.message ? translateServerMessage(job.error.message) : t("PDF를 만들지 못했습니다."));
    downloadUrl(`/api/export/pdf/${job.id}/file`, job.filename ?? 'export.pdf');
    setStatus(t("{0}을(를) 저장했습니다.", [job.filename ?? 'PDF']));
    return undefined;
  };
  const download = (data: NonNullable<typeof result>) => {
    const blob = new Blob([data.encoding === 'base64' ? Uint8Array.from(atob(data.text), c => c.charCodeAt(0)) : data.text], { type: data.mediaType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = data.filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const row = (label: string, control: ReactNode, note?: string) => <div className="export-row"><div className="export-row-text"><span>{label}</span>{note ? <span className="muted small">{note}</span> : null}</div>{control}</div>;
  return (
    <Dialog title={whole ? t("모든 워크스페이스 콘텐츠 내보내기") : t("내보내기")} onClose={close} width={480} submitLabel={format === 'pdf' ? t("PDF로 저장") : t("내보내기")} onSubmit={async () => {
      if (format === 'pdf' && page) {
        if (pdfBrowser?.available) return makePdf();
        openPrint(page.id, { subpages, files, size, scale }); return undefined;
      }
      const data = await api<NonNullable<typeof result>>('/api/export', { id, format, ...(format === 'bundle' ? {} : { files, subpages: whole || subpages, folders, ...(format === 'html' ? { comments } : {}), ...(database && (scope === 'current' ? viewId : defaultViewId) ? { viewId: scope === 'current' ? viewId! : defaultViewId! } : {}) }) });
      setResult(data);
      download(data);
      return data.warnings.length ? false : undefined;
    }}>
      {row(t("내보내기 형식"), <select className="text-input export-select" value={format} onChange={event => { setFormat(event.target.value); setResult(null); }}>{formats.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>)}
      {format !== 'bundle' ? (
        <>
          {row(t("포함할 콘텐츠"), <select className="text-input export-select" value={files ? 'all' : 'none'} onChange={event => setFiles(event.target.value === 'all')}><option value="all">{t("모두")}</option><option value="none">{t("파일과 이미지 제외")}</option></select>)}
          {database && format !== 'pdf' ? row(t("데이터베이스"), <select className="text-input export-select" value={scope} onChange={event => setScope(event.target.value as 'current' | 'default')}><option value="current" disabled={!viewId}>{t("현재 보기")}</option><option value="default">{t("기본 보기")}</option></select>, t("보기의 필터 · 정렬 · 표시 속성대로 CSV를 만듭니다")) : null}
          {format === 'pdf' ? row(t("페이지 형식"), <select className="text-input export-select" value={size} onChange={event => setSize(event.target.value as PrintSize)}>{printSizes.map(item => <option key={item} value={item}>{item}</option>)}</select>) : null}
          {format === 'pdf' ? row(t("배율"), <span className="export-scale"><input className="text-input" type="number" min={25} max={200} value={scale} onChange={event => setScale(Math.max(25, Math.min(200, Number(event.target.value) || 100)))} />%</span>) : null}
          {whole ? null : row(t("하위 페이지 포함"), <Switch checked={subpages} onChange={setSubpages} />)}
          {(subpages || whole) && format !== 'pdf' ? row(t("하위 페이지마다 폴더 만들기"), <Switch checked={folders} onChange={setFolders} />, t("끄면 모든 파일이 한 폴더에 들어갑니다")) : null}
          {format === 'html' ? row(t("댓글 포함"), <Switch checked={comments} onChange={setComments} />) : null}
          {format === 'pdf' && pdfBrowser && !pdfBrowser.available ? <p className="muted small">{t("새 창에서 인쇄 창이 열립니다. 대상을 \"PDF로 저장\"으로 고르세요.")}{subpages ? ` ${t("페이지마다 PDF 파일로 나누려면 Chrome · Edge 같은 Chromium 계열 브라우저가 이 컴퓨터에 있어야 합니다. 지금은 하위 페이지까지 한 문서로 인쇄합니다.")}` : ''}</p> : null}
          {format === 'pdf' && pdfBrowser?.available ? <p className="muted small export-pdf-note">{subpages ? t("페이지마다 PDF 파일을 만들어 그림 · 파일 폴더와 함께 ZIP으로 저장합니다.") : t("PDF 파일로 바로 저장합니다.")}</p> : null}
          {pdfJob && pdfJob.status === 'running' ? <div className="import-progress export-pdf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={pdfJob.total} aria-valuenow={pdfJob.done}><div className="import-progress-bar" style={{ width: `${(pdfJob.done / Math.max(1, pdfJob.total)) * 100}%` }} /><span>{t("PDF 만드는 중 · {0}/{1}", [Math.min(pdfJob.done + 1, pdfJob.total), pdfJob.total])}</span></div> : null}
        </>
      ) : null}
      {result?.warnings.map((warning, index) => <p key={index} className="warning-text">{warning}</p>)}
    </Dialog>
  );
}

// ---------- page versions ----------

interface PastPage { entity: PageEntity; properties: Array<PropertyEntity & { value: unknown }>; blocks: BlockEntity[] }

export function VersionDialog({ pageId, revision, onClose }: Close & { pageId: string; revision: number }) {
  const [past, setPast] = useState<PastPage | null>(null);
  const [current, setCurrent] = useState<{ revision: number; entity: PageEntity & { computed?: Record<string, unknown> } } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api<PastPage>(`/api/versions/${encodeURIComponent(pageId)}?revision=${revision}`), api<{ revision: number; entity: PageEntity & { computed?: Record<string, unknown> } }>(`/api/objects/${encodeURIComponent(pageId)}`)])
      .then(([pastPage, now]) => { setPast(pastPage); setCurrent(now); })
      .catch(failure => setError(failure.message));
  }, [pageId, revision]);
  return (
    <Dialog title={t("버전 {0} 비교", [revision])} onClose={onClose} width={640} submitLabel={t("이 버전으로 복원")} onSubmit={past && current ? async () => {
      await apply([{ type: 'page.restore_version', id: pageId, revision }], { revision: current.revision });
      setStatus(t("이전 버전으로 복원했습니다."));
    } : undefined}>
      {error ? <p className="error-text">{error}</p> : null}
      {!past ? <p className="muted">{t("불러오는 중…")}</p> : (
        <div className="version-preview">
          <p className="muted">{t("제목·속성·본문을 복원합니다. 현재 위치와 댓글은 유지됩니다.")}</p>
          <h2 className="version-title">{past.entity.title || t("새 페이지")}</h2>
          {past.properties.filter(property => !['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(property.type)).map(property => (
            <div key={property.id} className="version-property"><span>{property.name}</span><span>{formatValue(current?.entity.computed?.[property.id], property) || t("비어 있음")} → {formatValue(property.value, property) || t("비어 있음")}</span></div>
          ))}
          <div className="version-body">
            {past.blocks.map(block => <p key={block.id} className={`version-block version-${block.blockType}`}>{plainText(block.richText) || <span className="muted">{blockLabels[block.blockType]}</span>}</p>)}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export type { Entity };
