import { t } from '../i18n';
import { readLocal, storeLocal } from '../data/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/Icon';
import { useWorkspace, workspace } from '../data/store';
import { useWorkspaceIdentity } from '../data/workspaces';
import { recentIds, hrefFor, openAppPage, openLibrary } from '../data/router';
import { Menu, type MenuEntry } from '../ui/Menu';
import { openWorkspaceDialog } from '../dialogs/registry';
import { setInboxOpen } from './InboxPanel';
import { showSettings } from './SettingsModal';
import { api } from '../data/api';
import { EntityIcon } from '../page/EntityIcon';
import { plainText } from '../data/format';
import type { BlockEntity, Entity, PageEntity } from '../data/types';

interface ResultFile { id: string; name: string; blockId: string | null; excerpt: string }
interface Result { id: string; title: string; excerpt?: string; archived?: boolean; files?: ResultFile[] }

// Search filters (제목만 · 위치 · 날짜 · 콘텐츠 상태, and 정렬 on the right). Kept while the window is open.
export type SearchSort = 'relevance' | 'edited_desc' | 'edited_asc' | 'created_desc' | 'created_asc';
interface DateFilter { field: 'edited' | 'created'; preset: 'today' | 'week' | 'month' | 'custom'; from?: string; to?: string }
const sortLabels: Record<SearchSort, string> = {
  relevance: t("최적 일치"), edited_desc: t("최종 편집 일시: 최신순"), edited_asc: t("최종 편집 일시: 오래된 순"),
  created_desc: t("생성 일시: 최신순"), created_asc: t("생성 일시: 오래된 순"),
};
const presetLabels = { today: t("오늘"), week: t("지난 7일"), month: t("지난 30일"), custom: t("직접 지정") };
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function dateRange(filter: DateFilter): { from?: string; to?: string } {
  const today = new Date();
  if (filter.preset === 'custom') return { from: filter.from || undefined, to: filter.to || undefined };
  const days = filter.preset === 'today' ? 0 : filter.preset === 'week' ? 6 : 29;
  return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)), to: isoDay(today) };
}

// "바로 가기" (jump-to): places of the app itself that match what was typed.
interface Destination { id: string; label: string; icon: string; keywords: string; open: () => void }
const destinations = (): Destination[] => [
  { id: 'jump:home', label: t("홈"), icon: 'home', keywords: 'home 홈', open: () => openAppPage('home') },
  { id: 'jump:tasks', label: t("내 작업"), icon: 'tasks', keywords: 'my tasks 작업 할 일 todo', open: () => openAppPage('tasks') },
  { id: 'jump:graph', label: t("연결 지도"), icon: 'graph', keywords: 'graph map links 연결 지도 그래프 백링크', open: () => openAppPage('graph') },
  { id: 'jump:library', label: t("라이브러리"), icon: 'library', keywords: 'library 라이브러리 최근 즐겨찾기', open: () => openLibrary('recents') },
  { id: 'jump:inbox', label: t("받은 알림"), icon: 'inbox', keywords: 'inbox 알림 수신함 리마인더', open: () => setInboxOpen(true) },
  { id: 'jump:trash', label: t("휴지통"), icon: 'trash', keywords: 'trash 휴지통 삭제', open: () => openWorkspaceDialog('trash') },
  { id: 'jump:settings', label: t("설정"), icon: 'settings', keywords: 'settings 설정 환경', open: () => showSettings() },
  { id: 'jump:import', label: t("가져오기"), icon: 'import', keywords: 'import 가져오기', open: () => openWorkspaceDialog('import') },
  { id: 'jump:export', label: t("모든 워크스페이스 콘텐츠 내보내기"), icon: 'export', keywords: 'export 내보내기 백업', open: () => openWorkspaceDialog('export', { id: '*' }) },
  { id: 'jump:shortcuts', label: t("키보드 단축키"), icon: 'command', keywords: 'shortcuts 단축키 키보드', open: () => openWorkspaceDialog('shortcuts') },
];
function matchingDestinations(query: string) {
  const text = query.trim().toLocaleLowerCase();
  if (!text) return [];
  return destinations().filter(item => item.label.toLocaleLowerCase().includes(text) || item.keywords.toLocaleLowerCase().split(' ').some(word => word && word.startsWith(text)));
}

function pathOf(id: string): string {
  const chain = workspace.ancestry(id).filter(item => item.kind !== 'source').slice(0, -1);
  const names = chain.map(item => workspace.title(item) || t("새 페이지"));
  if (names.length > 3) return [names[0], '...', ...names.slice(-1)].join(' / ');
  return names.join(' / ');
}

function bucket(iso: string) {
  const date = new Date(iso), now = new Date();
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86400000);
  if (diff <= 0) return t("오늘");
  if (diff === 1) return t("어제");
  if (diff < 7) return t("지난 7일");
  if (diff < 30) return t("지난 30일");
  return t("older|이전");
}

function Preview({ id }: { id: string }) {
  const item = workspace.get(id);
  if (!item) return null;
  const blocks = item.kind === 'page' ? workspace.children(id).filter(child => child.kind === 'block').slice(0, 14) as BlockEntity[] : [];
  return (
    <div className="search-preview">
      <div className="search-preview-path">{pathOf(id)}</div>
      <div className="search-preview-title">{workspace.title(item) || t("새 페이지")}</div>
      <div className="search-preview-body">
        {blocks.length ? blocks.map(block => {
          const text = plainText(block.richText);
          if (block.blockType === 'divider') return <hr key={block.id} />;
          return text ? <p key={block.id} className={`preview-${block.blockType}`}>{text}</p> : null;
        }) : <p className="empty-note">{item.kind === 'page' ? t("내용이 없습니다.") : t("데이터베이스")}</p>}
      </div>
    </div>
  );
}

export function SearchModal({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const workspaceName = useWorkspaceIdentity().name;
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [titleOnly, setTitleOnly] = useState(false);
  // The two round buttons at the right of the search box show/hide the preview and the filters
  // (both shown, blue, by default; kept per browser).
  const [panes, setPanes] = useState(() => ({ preview: true, filters: true, ...readLocal<{ preview?: boolean; filters?: boolean }>('pageyard-search-panes', {}) }));
  const togglePane = (key: 'preview' | 'filters') => setPanes(current => { const next = { ...current, [key]: !current[key] }; storeLocal('pageyard-search-panes', JSON.stringify(next)); return next; });
  const [results, setResults] = useState<Result[] | null>(null);
  const [within, setWithin] = useState<string[]>([]);
  const [date, setDate] = useState<DateFilter | null>(null);
  const [archived, setArchived] = useState<'exclude' | 'include' | 'only'>('exclude');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [menu, setMenu] = useState<{ kind: 'within' | 'date' | 'archived' | 'sort'; anchor: Element } | null>(null);
  const filtered = within.length > 0 || !!date || archived !== 'exclude';
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()); }, []);
  useEffect(() => {
    const text = query.trim();
    // With a filter set, an empty box lists everything the filters let through (newest first).
    if (!text && !filtered) { setResults(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const range = date ? dateRange(date) : {};
      api<{ results: Result[] }>('/api/search', { query: text, titleOnly, limit: 50, ...(within.length ? { withinIds: within } : {}),
        ...(date ? { dateField: date.field, ...range } : {}), archived, sort: !text && sort === 'relevance' ? 'edited_desc' : sort }, ws.revision)
        .then(data => { if (!cancelled) { setResults(data.results.filter(result => !(ws.get<PageEntity>(result.id)?.template))); setActive(0); } })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, titleOnly, ws.revision, within.join(','), date && JSON.stringify(date), archived, sort]);
  const jumps = useMemo(() => matchingDestinations(query), [query]);

  const groups = useMemo((): Array<{ label: string; items: Result[] }> => {
    if (results) return [
      ...(jumps.length ? [{ label: t("바로 가기"), items: jumps.map((item): Result => ({ id: item.id, title: item.label })) }] : []),
      { label: t("검색 결과"), items: results.map((result): Result => ({ id: result.id, title: result.title, excerpt: result.excerpt, archived: result.archived, files: result.files })) },
    ].filter(group => group.items.length || group.label === t("검색 결과"));
    const seen = new Set<string>();
    const recent = [...recentIds(), ...ws.snapshot.objects.filter(item => item.kind === 'page' && !(item as PageEntity).sourceId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => item.id)]
      .filter(id => { if (seen.has(id)) return false; seen.add(id); return ws.visible(id) && ['page', 'source', 'view'].includes(ws.get(id)?.kind ?? '') && !(ws.get<PageEntity>(id)?.template); })
      .slice(0, 30).map(id => ws.get(id) as Entity);
    const map = new Map<string, Result[]>();
    for (const item of recent) {
      const label = bucket(item.updatedAt);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push({ id: item.id, title: ws.title(item) });
    }
    return [...map].map(([label, items]) => ({ label, items }));
  }, [results, ws.version, jumps]);
  const flat: Result[] = groups.flatMap(group => group.items);
  const selected = flat[active];
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(flat.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === 'Enter' && selected) {
      event.preventDefault();
      openResult(selected.id, event.metaKey || event.ctrlKey);
    }
  };
  const openResult = (id: string, newTab: boolean) => {
    const jump = id.startsWith('jump:') ? destinations().find(item => item.id === id) : undefined;
    if (jump) { onClose(); jump.open(); return; }
    if (newTab) window.open(hrefFor(id), '_blank'); else onOpen(id);
  };
  // A file that matched: its page, scrolled to the file's block (a file property's file opens the row).
  const openFile = (pageId: string, blockId: string | null, newTab: boolean) => {
    const anchor = blockId ? `#${encodeURIComponent(blockId)}` : '';
    if (newTab) { window.open(`${hrefFor(pageId)}${anchor}`, '_blank'); return; }
    onOpen(pageId);
    if (!blockId) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${anchor}`);
    window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(`.page-editor [data-block-id="${CSS.escape(blockId)}"]`);
      if (!element) return;
      element.scrollIntoView({ block: 'center' });
      element.classList.add('search-flash');
      window.setTimeout(() => element.classList.remove('search-flash'), 1600);
    }, 350);
  };
  const withinPages = within.map(id => ws.get(id)).filter(Boolean) as Entity[];
  const chip = (kind: 'within' | 'date' | 'archived', active: boolean, icon: string, label: string) => (
    <button type="button" className={`filter-chip${active ? ' active' : ''}`} data-filter={kind} onClick={event => setMenu({ kind, anchor: event.currentTarget })}>
      <Icon name={icon} size={16} /><span>{label}</span><Icon name="chevron-down" size={12} />
    </button>
  );
  const pageEntries = (): MenuEntry[] => {
    const pages = ws.snapshot.objects.filter(item => item.kind === 'page' && ws.visible(item.id) && !(item as PageEntity).template && !(item as PageEntity).sourceId) as PageEntity[];
    const order = new Map(recentIds().map((id, index) => [id, index]));
    pages.sort((a, b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6) || b.updatedAt.localeCompare(a.updatedAt));
    return [
      ...(within.length ? [{ label: t("모든 위치"), icon: 'close', onSelect: () => setWithin([]) } as MenuEntry, { kind: 'separator' } as MenuEntry] : []),
      ...pages.slice(0, 200).map(page => ({ label: page.title || t("새 페이지"), icon: <EntityIcon item={page} size={18} />, hint: pathOf(page.id) || undefined, checked: within.includes(page.id), keepOpen: true,
        onSelect: () => setWithin(current => current.includes(page.id) ? current.filter(id => id !== page.id) : [...current, page.id]) } as MenuEntry)),
    ];
  };
  const dateEntries = (): MenuEntry[] => [
    { kind: 'section', label: t("기준") },
    { label: t("최종 편집 일시"), checked: (date?.field ?? 'edited') === 'edited', keepOpen: true, onSelect: () => setDate(current => ({ preset: 'week', ...current, field: 'edited' })) },
    { label: t("생성 일시"), checked: date?.field === 'created', keepOpen: true, onSelect: () => setDate(current => ({ preset: 'week', ...current, field: 'created' })) },
    { kind: 'separator' },
    ...(['today', 'week', 'month'] as const).map(preset => ({ label: presetLabels[preset], checked: date?.preset === preset, onSelect: () => setDate(current => ({ field: current?.field ?? 'edited', preset })) } as MenuEntry)),
    { kind: 'custom', render: () => (
      <div className="search-date-range">
        <span>{t("직접 지정")}</span>
        <input type="date" className="text-input" aria-label={t("시작일")} value={date?.preset === 'custom' ? date.from ?? '' : ''} onChange={event => setDate(current => ({ field: current?.field ?? 'edited', preset: 'custom', to: current?.preset === 'custom' ? current.to : undefined, from: event.target.value }))} />
        <span>–</span>
        <input type="date" className="text-input" aria-label={t("종료일")} value={date?.preset === 'custom' ? date.to ?? '' : ''} onChange={event => setDate(current => ({ field: current?.field ?? 'edited', preset: 'custom', from: current?.preset === 'custom' ? current.from : undefined, to: event.target.value }))} />
      </div>
    ) },
    ...(date ? [{ kind: 'separator' } as MenuEntry, { label: t("날짜 필터 지우기"), icon: 'close', onSelect: () => setDate(null) } as MenuEntry] : []),
  ];
  const dateLabel = date ? `${date.field === 'created' ? t("생성") : t("편집")}: ${date.preset === 'custom' ? [date.from, date.to].filter(Boolean).join(' – ') || presetLabels.custom : presetLabels[date.preset]}` : t("날짜");
  const archivedLabels = { exclude: t("보관된 페이지 제외"), include: t("보관된 페이지 포함"), only: t("보관된 페이지만") };

  let index = -1;
  return (
    // 1006×686, centred; on a short window it sits 16px above the bottom (top 69 at 771).
    <Popover anchor={{ x: Math.max(12, (window.innerWidth - 1006) / 2), y: Math.max(12, Math.min(Math.round(window.innerHeight * 0.09), window.innerHeight - 708 - 16)) }} placement="point" onClose={onClose} className="search-modal" label={t("검색")}>
      <div className="search-modal-inner" onKeyDown={onKeyDown}>
        <div className="search-input-row">
          <Icon name="search" className="search-input-icon" />
          <input ref={inputRef} className="search-input" placeholder={t("{0}에서 검색", [workspaceName])} value={query} onChange={event => setQuery(event.target.value)} aria-label={t("검색어")} />
          {query ? <button type="button" className="icon-button small" aria-label={t("검색어 지우기")} onClick={() => setQuery('')}><Icon name="close" size={16} /></button> : null}
          <button type="button" className={`search-pane-toggle${panes.preview ? ' on' : ''}`} aria-pressed={panes.preview} aria-label={panes.preview ? t("미리 보기 숨기기") : t("미리 보기 표시")} title={panes.preview ? t("미리 보기 숨기기") : t("미리 보기 표시")} onClick={() => togglePane('preview')}><Icon name="peek-side" size={20} /></button>
          <button type="button" className={`search-pane-toggle${panes.filters ? ' on' : ''}`} aria-pressed={panes.filters} aria-label={panes.filters ? t("필터 숨기기") : t("필터 표시")} title={panes.filters ? t("필터 숨기기") : t("필터 표시")} onClick={() => togglePane('filters')}><Icon name="filter" size={20} /></button>
        </div>
        {panes.filters ? <div className="search-filters">
          <button type="button" className={`filter-chip${titleOnly ? ' active' : ''}`} onClick={() => setTitleOnly(value => !value)}><Icon name="type-title" size={16} /><span>{t("제목만 검색")}</span></button>
          {chip('within', within.length > 0, 'page', within.length === 1 ? (ws.title(withinPages[0]) || t("새 페이지")) : within.length ? t("위치 {0}곳", [within.length]) : t("위치"))}
          {chip('date', !!date, 'calendar', dateLabel)}
          {chip('archived', archived !== 'exclude', 'library', archived === 'exclude' ? t("콘텐츠 상태") : archivedLabels[archived])}
          <span className="search-filters-gap" />
          <button type="button" className={`filter-chip sort${sort !== 'relevance' ? ' active' : ''}`} data-filter="sort" onClick={event => setMenu({ kind: 'sort', anchor: event.currentTarget })}><Icon name="sort" size={16} /><span>{sortLabels[sort]}</span><Icon name="chevron-down" size={12} /></button>
        </div> : null}
        <div className={`search-body${panes.preview ? '' : ' no-preview'}`}>
          <div className="search-results" ref={listRef} role="listbox">
            {flat.length ? groups.map(group => (
              <div key={group.label} className="search-group">
                <div className="search-group-label">{group.label}</div>
                {group.items.map(item => {
                  index++;
                  const entity = ws.get(item.id);
                  const myIndex = index;
                  return (
                    <div key={item.id} role="option" aria-selected={myIndex === active} data-index={myIndex} className={`search-result${myIndex === active ? ' active' : ''}`}
                      onPointerMove={() => setActive(myIndex)} onClick={event => openResult(item.id, event.metaKey || event.ctrlKey)}>
                      {item.id.startsWith('jump:') ? <span className="search-jump-icon"><Icon name={destinations().find(jump => jump.id === item.id)?.icon ?? 'arrow-right'} size={18} /></span> : <EntityIcon item={entity} size={20} />}
                      <span className="search-result-title">{item.title || ws.title(entity) || t("새 페이지")}</span>
                      {item.archived ? <span className="search-result-badge">{t("보관됨")}</span> : null}
                      {!item.id.startsWith('jump:') && pathOf(item.id) ? <span className="search-result-path"><span className="dash">—</span>{pathOf(item.id)}</span> : null}
                      {results && item.excerpt && item.excerpt !== item.title ? <span className="search-result-excerpt">{item.excerpt}</span> : null}
                      {results && item.files?.length ? item.files.map(file => (
                        <button key={file.id} type="button" className="search-result-file" title={t("파일 내용에서 찾음")} onClick={event => { event.stopPropagation(); openFile(item.id, file.blockId, event.metaKey || event.ctrlKey); }}>
                          <Icon name="file" size={14} /><span className="search-result-file-name">{file.name}</span><span className="search-result-file-excerpt">{file.excerpt}</span>
                        </button>
                      )) : null}
                    </div>
                  );
                })}
              </div>
            )) : <div className="empty-note search-empty">{results ? t("결과가 없습니다.") : t("최근 페이지가 없습니다.")}</div>}
          </div>
          {panes.preview ? <div className="search-preview-pane">{selected && !selected.id.startsWith('jump:') ? <Preview id={selected.id} /> : null}</div> : null}
        </div>
        <div className="search-footer"><span className="search-footer-keys">⌘↵</span><span>{t("새 탭에서 열기")}</span><span className="search-footer-tip">{t("“따옴표”로 감싸면 정확히 그 구문을 찾습니다")}</span></div>
      </div>
      {menu?.kind === 'within' ? <Menu anchor={menu.anchor} placement="below-start" width={300} maxHeight={360} search={t("페이지 검색…")} label={t("위치")} onClose={() => setMenu(null)} entries={pageEntries()} /> : null}
      {menu?.kind === 'date' ? <Menu anchor={menu.anchor} placement="below-start" width={300} label={t("날짜")} onClose={() => setMenu(null)} entries={dateEntries()} /> : null}
      {menu?.kind === 'archived' ? <Menu anchor={menu.anchor} placement="below-start" width={240} label={t("콘텐츠 상태")} onClose={() => setMenu(null)} entries={(['exclude', 'include', 'only'] as const).map(value => ({ label: archivedLabels[value], checked: archived === value, onSelect: () => setArchived(value) }))} /> : null}
      {menu?.kind === 'sort' ? <Menu anchor={menu.anchor} placement="below-end" width={260} label={t("정렬")} onClose={() => setMenu(null)} entries={(Object.keys(sortLabels) as SearchSort[]).map(value => ({ label: sortLabels[value], checked: sort === value, onSelect: () => setSort(value) }))} /> : null}
    </Popover>
  );
}
