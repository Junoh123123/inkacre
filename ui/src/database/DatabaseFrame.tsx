import { t } from '../i18n';
import { EntityIcon } from '../page/EntityIcon';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apply, newId } from '../data/commands';
import { report, setStatus, showToast, useWorkspace, workspace } from '../data/store';
import { useLocalPreference, useQuery } from '../data/hooks';
import { navigate, hrefFor } from '../data/router';
import type { Operation, PageEntity, PropertyEntity, SourceEntity, ViewEntity, ViewType } from '../data/types';
import { Icon, viewIcon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { ValueEditor, readOnlyTypes } from './values';
import { TableView, type ViewProps } from './TableView';
import { BoardView } from './BoardView';
import { CalendarView } from './CalendarView';
import { TimelineView } from './TimelineView';
import { ChartView, DashboardView, FeedView, FormView, GalleryView, ListView, MapView } from './OtherViews';
import { FilterSortBar, PropertyPicker } from './FilterSortBar';
import { ViewSettingsPanel } from './ViewSettings';
import { automationsOf, openAutomationEditor } from './Automations';
import { addDataSource, newSourceName, takePendingNewSource, turnInlineIntoPage } from './DataSources';
import { AddViewMenu, ViewsOverflowMenu } from './ViewMenus';
import { ToolbarSlot, createView, isDatabasePage, layoutOrder, newRow, updateView, useDatabaseLock, viewTypeLabels } from './shared';
import { createTemplate, duplicatePage } from '../page/actions';
import { newRule } from '../dialogs/filters';
import { addPageShortcut, addViewSection } from '../shell/sidebarLayout';
import { openWorkspaceDialog } from '../dialogs/registry';
import { confirmDialog, confirmSmall } from '../ui/primitives';
import { completeSprint } from '../dialogs/databaseDialogs';

const views: Record<ViewType, (props: ViewProps) => ReactNode> = {
  table: TableView, board: BoardView, calendar: CalendarView, timeline: TimelineView, gallery: GalleryView, list: ListView,
  feed: FeedView, chart: ChartView, map: MapView, form: FormView, dashboard: DashboardView,
};

export interface DatabaseFrameProps {
  sourceId: string;
  viewIds: string[];
  pageId: string;
  inline?: boolean;
  linked?: boolean;
  compact?: boolean;
  title?: ReactNode;
  initialViewId?: string | null;
  /** A rule added to the view's own filter (a page layout tab: rows whose relation points at the open page). */
  extraFilter?: unknown;
  /** Values new rows start with here (that relation, so a row added in the tab belongs to the page). */
  newRowValues?: Record<string, unknown>;
}

function SelectionBar({ ids, result, onClear }: { ids: string[]; result: NonNullable<ReturnType<typeof useQuery>['result']>; onClear: () => void }) {
  const [editor, setEditor] = useState<{ anchor: Element; property: PropertyEntity } | null>(null);
  const [more, setMore] = useState<Element | null>(null);
  // Every editable property can be set on all selected rows: the first few as buttons, all of them under "속성 편집".
  const editable = result.properties.filter(property => !readOnlyTypes.has(property.type) && !['title', 'button'].includes(property.type));
  const [allProps, setAllProps] = useState<Element | null>(null);
  const bulk = (property: PropertyEntity, value: unknown) => {
    const operations: Operation[] = ids.map(id => property.type === 'relation' ? { type: 'relation.set', pageId: id, propertyId: property.id, targetIds: (value as string[]) ?? [] } : { type: 'value.set', pageId: id, propertyId: property.id, value });
    apply(operations).then(() => setStatus(t("{0}개 항목의 {1}을(를) 바꿨습니다.", [ids.length, property.name]))).catch(report);
  };
  return (
    <div className="selection-bar" role="toolbar" aria-label={t("선택한 항목 작업")}>
      <button type="button" className="selection-count" onClick={onClear} title={t("선택 해제")}>{t("{0}개 선택됨", [ids.length])}</button>
      {editable.filter(property => property.type !== 'files').slice(0, 4).map(property => (
        <button type="button" key={property.id} className="selection-action" title={t("{0} 편집", [property.name])} aria-label={t("{0} 편집", [property.name])} onClick={event => setEditor({ anchor: event.currentTarget, property })}><Icon name={`type-${property.type}`} size={16} /></button>
      ))}
      {editable.length ? <button type="button" className="selection-action labeled" aria-label={t("속성 편집")} onClick={event => setAllProps(event.currentTarget)}><Icon name="property-edit" size={16} /><span>{t("속성 편집")}</span></button> : null}
      {allProps ? <Menu anchor={allProps} width={240} placement="below-start" search={t("속성 검색…")} label={t("속성 편집")} onClose={() => setAllProps(null)}
        entries={editable.map(property => ({ label: property.name, icon: `type-${property.type}`, keywords: property.name, onSelect: () => { const anchor = allProps; setAllProps(null); setEditor({ anchor, property }); } }))} /> : null}
      <button type="button" className="selection-action" title={t("삭제")} aria-label={t("삭제")} onClick={async () => {
        if (ids.length > 1 && !(await confirmDialog(t("항목 삭제"), t("{0}개 항목을 휴지통으로 옮길까요?", [ids.length]), { confirmLabel: t("삭제"), danger: true }))) return;
        await apply(ids.map(id => ({ type: 'node.trash', id }))).catch(report); onClear();
      }}><Icon name="trash" size={16} /></button>
      <button type="button" className="selection-action" title={t("더 보기")} aria-label={t("더 보기")} onClick={event => setMore(event.currentTarget)}><Icon name="more" size={16} /></button>
      {editor ? <ValueEditor anchor={editor.anchor} pageId={ids[0]} property={editor.property} value={editor.property.type === 'checkbox' ? false : null} placement="below-start" onClose={() => setEditor(null)} onChange={value => bulk(editor.property, value)} /> : null}
      {more ? <Menu anchor={more} width={220} onClose={() => setMore(null)} entries={[
        { label: t("복제"), icon: 'duplicate', onSelect: async () => { for (const id of ids) { const page = workspace.get<PageEntity>(id); if (page) await duplicatePage(page); } onClear(); } },
        { label: t("링크 복사"), icon: 'link', onSelect: () => navigator.clipboard.writeText(ids.map(id => new URL(hrefFor(id), location.href).href).join('\n')).then(() => setStatus(t("링크를 복사했습니다."))).catch(report) },
        { kind: 'separator' },
        { label: t("선택 해제"), icon: 'close', onSelect: onClear },
      ]} /> : null}
    </div>
  );
}

// The data source's name over the tabs when the database has several (24/600, edits in place).
function SourceHeading({ source }: { source: SourceEntity }) {
  return (
    // A source still called "새 데이터 소스" shows that as the grey placeholder, as an unnamed source.
    <input key={`${source.id}:${source.name}`} className="db-source-title" defaultValue={source.name === newSourceName ? '' : source.name} aria-label={t("데이터 소스 이름")} placeholder={newSourceName}
      onBlur={event => { const name = event.target.value.trim(); if (name && name !== source.name) apply([{ type: 'source.update', id: source.id, name }]).catch(report); else event.target.value = source.name === newSourceName ? '' : source.name; }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) (event.target as HTMLInputElement).blur(); }} />
  );
}

export function DatabaseFrame({ sourceId: baseSourceId, viewIds, pageId, inline = false, linked = false, compact = false, title, initialViewId, extraFilter, newRowValues }: DatabaseFrameProps) {
  const ws = useWorkspace();
  const liveViews = viewIds.map(id => ws.get<ViewEntity>(id)).filter((view): view is ViewEntity => !!view && view.alive && ws.visible(view.sourceId));
  const [storedId, setStoredId] = useLocalPreference<string | null>(`pageyard-active-view:${pageId}:${baseSourceId}`, initialViewId ?? null);
  const fullPageRoute = !!initialViewId && !compact;
  const activeId = fullPageRoute ? initialViewId : storedId;
  // Full-page databases keep the open view in the URL (?v=); inline ones remember it per page.
  const setActiveId = (id: string) => { setStoredId(id); if (fullPageRoute) navigate(id, { replace: true }); };
  const active = liveViews.find(view => view.id === activeId) ?? liveViews.find(view => view.id === storedId) ?? liveViews[0] ?? null;
  // A database with several data sources: the open view decides which one the toolbar, rows and settings use.
  const sourceId = active?.sourceId ?? baseSourceId;
  const { locked } = useDatabaseLock(sourceId);
  const source = ws.get<SourceEntity>(sourceId);
  const sourceCount = new Set(liveViews.map(view => view.sourceId)).size;
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [settings, setSettings] = useState<string | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addMenu, setAddMenu] = useState<Element | null>(null);
  const [tabMenu, setTabMenu] = useState<{ anchor: Element; view: ViewEntity } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [templateMenu, setTemplateMenu] = useState<{ anchor: Element; template: PageEntity } | null>(null);
  // Tabs reorder by dragging them along the bar.
  const [tabDrag, setTabDrag] = useState<{ id: string; over: number } | null>(null);
  const tabDragged = useRef(false);
  const [newMenu, setNewMenu] = useState<Element | null>(null);
  const [filterPicker, setFilterPicker] = useState<Element | null>(null);
  const [sortPopover, setSortPopover] = useState<Element | null>(null);
  const [pendingRule, setPendingRule] = useState<string | null>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [showBar, setShowBar] = useState(false);
  // The toolbar's filter and sort buttons, once the view has rules, hide and bring back the chip bar;
  // the rules stay in force while it is hidden.
  const [barHidden, setBarHidden] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Tabs that do not fit collapse into an "N개 더" menu (the open view always stays visible).
  const tabsRef = useRef<HTMLDivElement>(null);
  // A narrow database (e.g. 358 wide beside a side peek) keeps only the settings button and
  // "새로 만들기" in its toolbar.
  const blockRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const block = blockRef.current;
    if (!block) return;
    const check = () => setNarrow(block.clientWidth > 0 && block.clientWidth < 450);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(block);
    return () => observer.disconnect();
  }, []);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(Number.MAX_SAFE_INTEGER);
  const [overflowMenu, setOverflowMenu] = useState<Element | null>(null);
  const tabKey = liveViews.map(view => `${view.id}:${view.name}:${view.viewType}`).join('|');
  useLayoutEffect(() => {
    const tabs = tabsRef.current, measure = measureRef.current;
    if (!tabs || !measure) return;
    const compute = () => {
      const widths = [...measure.children].map(child => (child as HTMLElement).getBoundingClientRect().width + 1);
      const total = widths.reduce((sum, width) => sum + width, 0);
      if (total + (compact ? 0 : 28) <= tabs.clientWidth) { setFit(Number.MAX_SAFE_INTEGER); return; }
      // Overflowing: "+" moves into the overflow menu; keep room for the "N개 더" button.
      const available = tabs.clientWidth;
      let used = 60, count = 0;
      for (const width of widths) { if (used + width > available) break; used += width; count++; }
      // Too narrow for two tabs and "N개 더": one switcher ("<view> ⌄") instead.
      setFit(count >= 2 ? count : 0);
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [tabKey, compact]);
  const shownViews = (() => {
    if (fit >= liveViews.length) return liveViews;
    if (fit === 0) return [];
    const head = liveViews.slice(0, fit);
    if (active && !head.includes(active)) head[head.length - 1] = active;
    return head;
  })();
  const hiddenViews = liveViews.filter(view => !shownViews.includes(view));
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(search), 150); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { setSelected(new Set()); setBarHidden(false); setShowBar(false); if (active && takePendingNewSource(active.sourceId)) setSettings('new-source'); }, [active?.id]);
  const automations = useMemo(() => automationsOf(sourceId), [ws.version, sourceId]);
  useEffect(() => {
    if (!selected.size) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.overlay-layer')) setSelected(new Set()); };
    // A click anywhere else (not a checkbox, the selection bar, a menu or a peek) clears the
    // selection.
    const onPointer = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if ((event.target as Element | null)?.closest?.('.row-gutter, .selection-bar, .overlay-layer, .peek, .peek-backdrop, [role="dialog"]')) return;
      setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPointer, true); };
  }, [selected.size]);
  const query = useQuery(source ? { ...(active ? { viewId: active.id } : { sourceId }), ...(debounced.trim() ? { search: debounced.trim() } : {}), ...(extraFilter ? { filter: extraFilter } : {}) } : null);
  const result = query.result && newRowValues ? { ...query.result, defaults: newRowValues } : query.result;
  // Switching views keeps the previous view on screen until the next one is ready (no loading box
  // in between).
  const lastShown = useRef<{ view: ViewEntity | null; result: NonNullable<typeof result> } | null>(null);
  if (result) lastShown.current = { view: active, result };
  const shown = result ? { view: active, result } : lastShown.current;
  const templates = useMemo(() => ws.snapshot.objects.filter(item => item.kind === 'page' && (item as PageEntity).template && (item as PageEntity).sourceId === sourceId && ws.visible(item.id)) as PageEntity[], [ws.version, sourceId]);

  if (!source) return <div className="database-missing">{t("데이터베이스를 찾을 수 없습니다.")}</div>;
  const config = active?.config ?? {};
  const hasFilter = !!(config.filter && (!('all' in config.filter) || config.filter.all.length));
  const hasChips = !!(config.sorts?.length || hasFilter);
  const barShown = !!active && ((hasChips && !barHidden) || showBar || !!pendingRule);
  // A chart's toolbar has only the filter and settings; a map's has no sort.
  const chartLike = active?.viewType === 'chart';
  const noSort = chartLike || active?.viewType === 'map';
  const View = active ? views[active.viewType] ?? TableView : TableView;
  const ShownView = shown?.view ? views[shown.view.viewType] ?? TableView : View;

  const addFilter = (property: PropertyEntity) => {
    if (!active) return;
    const current = config.filter;
    const rules = !current ? [] : 'all' in current ? current.all : [current];
    updateView(active, { filter: { all: [...rules, newRule(property)] } });
    setPendingRule(property.id);
    setShowBar(true);
    setBarHidden(false);
  };

  // "고급 필터 추가": the filter becomes one advanced filter — started with a
  // rule on the first property when there is none — and its editor opens under the chip.
  const addAdvancedFilter = () => {
    if (!active || !result) return;
    const first = result.properties[0];
    const filter = config.filter ?? (first ? { all: [newRule(first) as import('../data/types').Filter] } : null);
    updateView(active, { filter, advancedFilter: true });
    setPendingRule('$advanced');
    setShowBar(true);
    setBarHidden(false);
  };

  // A view tab's menu (on a full-page database): 이름 바꾸기 · 표시 유형 › · 보기 편집 ·
  // 소스 › | 보기 링크 복사 | 보기 복제 · 보기 삭제 (an inline database can also open the view as a full page).
  const tabEntries = (view: ViewEntity): MenuEntry[] => [
    { label: t("이름 바꾸기"), icon: 'pencil', onSelect: () => setRenaming(view.id) },
    { label: t("표시 유형"), icon: 'page-layout', submenuWidth: 220, submenu: () => layoutOrder.map(type => ({ label: viewTypeLabels[type], icon: viewIcon[type], checked: view.viewType === type, onSelect: () => { updateView(view, {}, { viewType: type }).catch(report); } }) as MenuEntry) },
    { label: t("탭 표시 방식"), icon: 'eye', submenuWidth: 200, submenu: () => ([['both', t("아이콘과 텍스트")], ['icon', t("아이콘만")], ['text', t("텍스트만")]] as const).map(([mode, label]) => ({ label, checked: (view.config.tabDisplay ?? 'both') === mode, onSelect: () => { updateView(view, { tabDisplay: mode }).catch(report); } }) as MenuEntry) },
    { label: t("보기 편집"), icon: 'sliders', onSelect: () => { setActiveId(view.id); setSettings('main'); } },
    { label: t("소스"), icon: 'swap', hint: source?.name, right: <Icon name="chevron-right" size={16} className="menu-item-chevron" />, onSelect: () => { setActiveId(view.id); setSettings('sources'); } },
    { kind: 'separator' },
    { label: t("보기 링크 복사"), icon: 'link', onSelect: () => navigator.clipboard.writeText(new URL(hrefFor(view.id), location.href).href).then(() => setStatus(t("보기 링크를 복사했습니다."))).catch(report) },
    // "보기를 사이드바에 추가": the view becomes a sidebar section listing its rows.
    { label: t("보기를 사이드바에 추가"), icon: 'sidebar', onSelect: () => addViewSection(view.id, sourceId) },
    ...(inline ? [{ label: t("전체 페이지로 열기"), icon: 'expand', onSelect: () => navigate(view.id) } as MenuEntry] : []),
    ...(inline && !linked && source && ws.get(pageId)?.kind === 'page' ? [{ label: t("페이지로 전환"), icon: 'turn-into', onSelect: () => { turnInlineIntoPage(source, pageId).catch(report); } } as MenuEntry] : []),
    { kind: 'separator' },
    { label: t("보기 복제"), icon: 'duplicate', onSelect: async () => { const id = newId(); await apply([{ type: 'view.create', id, sourceId, parentId: view.parentId ?? pageId, name: t("{0} (사본)", [view.name]), viewType: view.viewType, config: structuredClone(view.config) }]).catch(report); setActiveId(id); } },
    { label: t("보기 삭제"), icon: 'trash', danger: true, disabled: liveViews.length <= 1 && !linked, onSelect: async () => {
      // Deleting asks "이 보기를 삭제할까요?" with an outlined red "보기 삭제"; a form asks
      // "<이름>을(를) 완전히 삭제할까요?" with a note and "양식 삭제". Afterwards a note at the bottom.
      const form = view.viewType === 'form';
      const ok = form
        ? await confirmSmall(t("{0}을(를) 완전히 삭제할까요?", [view.name]), t("양식 삭제"), { outline: true, message: t("응답자가 더 이상 이 양식으로 데이터를 제출할 수 없습니다. 이미 제출된 데이터에는 영향이 없습니다.") })
        : await confirmSmall(t("이 보기를 삭제할까요?"), t("보기 삭제"), { outline: true });
      if (!ok) return;
      await apply([{ type: 'node.trash', id: view.id }]).then(() => showToast(form ? t("{0} 보기를 삭제했습니다", [view.name]) : t("삭제된 보기"))).catch(report);
    } },
  ];

  // A tile in the "+" menu makes the view at once and docks the "새 보기" panel (a form first asks whether
  // to make its questions from the properties).
  const addView = async (type: ViewType) => {
    setAddMenu(null); setOverflowMenu(null);
    const id = await createView(sourceId, active?.parentId ?? pageId, type);
    setActiveId(id);
    if (type === 'form') openWorkspaceDialog('form-questions', { viewId: id });
    else setSettings('new');
  };
  // Views are ordered by position among the page's children: the dragged one moves before its new
  // successor, or after the last view.
  const startTabDrag = (event: React.PointerEvent, id: string) => {
    if (event.button !== 0 || compact || locked) return;
    const startX = event.clientX, tabs = [...(tabsRef.current?.querySelectorAll<HTMLElement>('.db-tab[role="tab"]') ?? [])];
    let active = false, over = -1;
    const move = (moveEvent: PointerEvent) => {
      if (!active && Math.abs(moveEvent.clientX - startX) < 5) return;
      active = true;
      const index = tabs.findIndex(tab => { const box = tab.getBoundingClientRect(); return moveEvent.clientX < box.left + box.width / 2; });
      over = index < 0 ? tabs.length : index;
      setTabDrag({ id, over });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setTabDrag(null);
      if (!active) return;
      tabDragged.current = true;
      setTimeout(() => { tabDragged.current = false; }, 0);
      const shownIds = shownViews.map(view => view.id), from = shownIds.indexOf(id);
      if (from < 0 || over === from || over === from + 1) return;
      const before = shownIds[over];
      const ids = liveViews.map(view => view.id).filter(item => item !== id);
      const at = before ? ids.indexOf(before) : ids.indexOf(shownIds[shownIds.length - 1]) + 1;
      ids.splice(at < 0 ? ids.length : at, 0, id);
      reorderViews(id, ids).catch(report);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const reorderViews = async (id: string, ids: string[]) => {
    const parent = active?.parentId ?? pageId;
    const target = workspace.get<ViewEntity>(id);
    if (!target) return;
    let beforeId: string | undefined = ids[ids.indexOf(id) + 1];
    if (!beforeId) { const siblings = workspace.children(target.parentId ?? parent); const last = siblings.findIndex(child => child.id === liveViews[liveViews.length - 1]?.id); beforeId = siblings.slice(last + 1).find(child => child.id !== id)?.id; }
    await apply([{ type: 'node.move', id: target.id, parentId: target.parentId ?? parent, ...(beforeId ? { beforeId } : {}) }]);
  };

  // "새로 만들기" ⌄ (360 wide under the button, right-aligned): "템플릿: <DB>"
  // with a help mark, the templates (or, when there are none, a grey line saying what they are),
  // then "+ 새 템플릿" in grey, and "사이드바에 바로가기 추가" (a sidebar row that makes a page here).
  const instantiate = async (template: PageEntity) => {
    const id = newId();
    await apply([{ type: 'template.instantiate', id: template.id, newId: id, title: '', sourceId }]);
    const { openRow } = await import('./shared');
    openRow(active, id);
  };
  const newEntries: MenuEntry[] = [
    { kind: 'custom', render: () => (
      <div className="template-menu-head">
        <span className="template-menu-title">{t("템플릿:")}</span><span className="template-menu-source">{source.name}</span>
        <span className="spacer" />
        <button type="button" className="icon-button tiny" aria-label={t("템플릿 설정")} title={t("템플릿 설정")} onClick={() => { setNewMenu(null); openWorkspaceDialog('templates', { sourceId }); }}><Icon name="question" size={16} /></button>
      </div>
    ) },
    ...(templates.length ? templates.map(template => ({
      label: template.title || t("새 템플릿"), icon: template.icon ? <EntityIcon item={template} size={18} /> : 'template', checked: source.defaultTemplateId === template.id,
      // ⋯ (기본값으로 설정 · 편집 · 복제 · 삭제).
      right: <button type="button" className="icon-button tiny template-row-more" aria-label={t("템플릿 메뉴")} title={t("템플릿 메뉴")} onClick={event => { event.stopPropagation(); setTemplateMenu({ anchor: event.currentTarget, template }); }}><Icon name="more" size={16} /></button>,
      onSelect: () => instantiate(template).catch(report),
    } as MenuEntry)) : [{ kind: 'custom', render: () => <div className="template-menu-empty">{t("이 데이터베이스에서 다시 쓸 수 있는 페이지 템플릿을 만듭니다.")}</div> } as MenuEntry]),
    { kind: 'separator' },
    { label: t("새 템플릿"), icon: 'plus', className: 'template-menu-new', onSelect: () => createTemplate(sourceId).catch(report) } as MenuEntry,
    { kind: 'separator' },
    { label: t("사이드바에 바로가기 추가"), icon: 'sidebar', onSelect: () => addPageShortcut(sourceId, active?.id) },
  ];

  // A filter that leaves nothing: "필터 편집" (the settings' 필터 page) and "+ 새 페이지" in the middle.
  const emptyState = hasFilter && !compact && result ? (
    <>
      <button type="button" className="table-empty-button" onClick={() => setSettings('filter-only')}><Icon name="filter" size={14} /><span>{t("필터 편집")}</span></button>
      <button type="button" className="table-empty-button" onClick={() => newRow(result, sourceId).catch(report)}><Icon name="plus" size={12} /><span>{t("새 페이지")}</span></button>
    </>
  ) : undefined;

  // ⚡: blue while the database has automations switched on; with none it opens a new
  // one straight away, otherwise the list in the view settings panel. Charts and dashboards have none.
  const automationButton = active && !['chart', 'dashboard'].includes(active.viewType) ? (
    <button type="button" className={`db-tool${automations.some(item => item.enabled) ? ' active automation-on' : ''}`} aria-label={t("자동화")} title={t("자동화")}
      onClick={() => { if (!automations.length) { setSettings(null); openAutomationEditor(sourceId); } else setSettings(settings === 'automations' ? null : 'automations'); }}><Icon name="lightning" size={16} /></button>
  ) : null;
  const titleNode = title ?? (inline ? (
    <div className="db-title-row">
      <a className="db-title" href={hrefFor(active?.id ?? sourceId)} onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); navigate(active?.id ?? sourceId); }} title={t("전체 페이지로 열기")}>
        {linked ? <Icon name="arrow-up-right" size={16} className="db-linked-icon" /> : null}
        <span>{source.name}</span>
      </a>
    </div>
  ) : null);

  return (
    <div ref={blockRef} className={`database-block${inline ? ' inline' : ' full'}${compact ? ' compact' : ''}${settings ? ' settings-open' : ''}${narrow ? ' narrow' : ''}`} data-source-id={sourceId}>
      {titleNode}
      {!inline && sourceCount > 1 && source ? <SourceHeading source={source} /> : null}
      <div className="db-tabs-row">
        {selected.size && result ? <SelectionBar ids={[...selected]} result={result} onClear={() => setSelected(new Set())} /> : null}
        <div className="db-tabs-measure" ref={measureRef} aria-hidden="true">
          {liveViews.map(view => <span key={view.id} className="db-tab">{view.config.tabDisplay === 'text' ? null : <Icon name={viewIcon[view.viewType] ?? 'table'} size={20} />}{view.config.tabDisplay === 'icon' ? null : <span>{view.name}</span>}</span>)}
        </div>
        <div className="db-tabs" role="tablist" ref={tabsRef}>
          {shownViews.map((view, tabIndex) => (
            renaming === view.id ? (
              <input key={view.id} className="db-tab-rename" autoFocus defaultValue={view.name}
                onBlur={event => { const name = event.target.value.trim(); if (name && name !== view.name) updateView(view, {}, { name }); setRenaming(null); }}
                onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setRenaming(null); }} />
            ) : (
              <button type="button" key={view.id} role="tab" aria-selected={view.id === active?.id} title={view.config.tabDisplay === 'icon' ? view.name : undefined}
                className={`db-tab${view.id === active?.id ? ' active' : ''}${tabDrag?.id === view.id ? ' dragging' : ''}${tabDrag && tabDrag.over === tabIndex && tabDrag.id !== view.id ? ' drop-before' : ''}${tabDrag && tabDrag.over === shownViews.length && tabIndex === shownViews.length - 1 ? ' drop-after' : ''}`}
                onPointerDown={event => startTabDrag(event, view.id)}
                onClick={event => { if (tabDragged.current) { tabDragged.current = false; return; } if (view.id === active?.id && !compact) setTabMenu({ anchor: event.currentTarget, view }); else setActiveId(view.id); }}
                onContextMenu={event => { event.preventDefault(); setTabMenu({ anchor: event.currentTarget, view }); }}
                onDoubleClick={() => setRenaming(view.id)}>
                {view.config.tabDisplay === 'text' ? null : <Icon name={viewIcon[view.viewType] ?? 'table'} size={20} />}{view.config.tabDisplay === 'icon' ? null : <span>{view.name}</span>}
              </button>
            )
          ))}
          {!shownViews.length && active ? (
            <button type="button" className="db-tab db-tab-switcher active" aria-haspopup="menu" onClick={event => setOverflowMenu(event.currentTarget)}>
              <Icon name={viewIcon[active.viewType] ?? 'table'} size={20} /><span>{active.name}</span><Icon name="chevron-down" size={12} className="db-tab-switcher-chevron" />
            </button>
          ) : null}
          {hiddenViews.length && shownViews.length ? <button type="button" className="db-tab db-tab-more" onClick={event => setOverflowMenu(event.currentTarget)}>{t("{0}개 더", [hiddenViews.length])}</button> : null}
          {!compact && !hiddenViews.length && !locked ? <button type="button" className="db-tab-add icon-button small" aria-label={t("보기 추가")} title={t("보기 추가")} onClick={event => setAddMenu(event.currentTarget)}><Icon name="plus" size={16} /></button> : null}
          {overflowMenu ? <ViewsOverflowMenu anchor={overflowMenu} views={liveViews} activeId={active?.id} canAdd={!compact} onClose={() => setOverflowMenu(null)} onSelect={setActiveId}
            onMore={(view, anchor) => setTabMenu({ anchor, view })} onReorder={(id, ids) => reorderViews(id, ids).catch(report)} onNew={row => setAddMenu(row)}
            onNewSource={!inline && !compact && ws.get<PageEntity>(pageId)?.kind === 'page' && isDatabasePage(ws.get<PageEntity>(pageId)!) ? () => { addDataSource(pageId).catch(report); } : undefined} /> : null}
        </div>
        {!compact ? (
          <div className="db-toolbar">
            <span className="db-toolbar-slot" ref={setToolbarSlot} />
            {/* 스프린트 완료 on a view of the current sprint (its filter names $currentSprint). */}
            {source?.tasks?.sprints?.enabled && !locked && JSON.stringify(active?.config.filter ?? null).includes('$currentSprint') ? (
              <button type="button" className="db-text-tool sprint-complete" onClick={() => { confirmSmall(t("현재 스프린트를 완료할까요?"), t("스프린트 완료"), { message: source.tasks!.sprints!.unfinished === 'next' ? t("끝나지 않은 작업은 다음 스프린트로 옮겨집니다.") : t("끝나지 않은 작업은 백로그로 돌아갑니다.") }).then(ok => ok ? completeSprint(sourceId) : undefined).catch(report); }}>
                <Icon name="check" size={14} />{t("스프린트 완료")}
              </button>
            ) : null}
            {active?.viewType === 'form' ? null : <>
            <button type="button" className={`db-tool${hasFilter ? ' active' : ''}`} aria-label={t("필터")} title={t("필터")} onClick={event => {
              if (hasFilter || (barShown && !hasChips)) { if (barShown) { setBarHidden(true); setShowBar(false); setPendingRule(null); } else setBarHidden(false); }
              else setFilterPicker(event.currentTarget);
            }}><Icon name="filter" size={16} /></button>
            {noSort ? null : <button type="button" className={`db-tool${config.sorts?.length ? ' active' : ''}`} aria-label={t("정렬")} title={t("정렬")} onClick={event => {
              if (!config.sorts?.length) { setSortPopover(event.currentTarget); return; }
              if (barShown) { setBarHidden(true); setShowBar(false); setPendingRule(null); }
              else { setBarHidden(false); setPendingRule('$sort'); }
            }}><Icon name="sort" size={16} /></button>}
            {automationButton}
            {chartLike ? null : searchOpen ? (
              <span className="db-search">
                <Icon name="search" size={16} />
                <input ref={searchRef} autoFocus value={search} placeholder={t("검색어 입력…")} onChange={event => setSearch(event.target.value)}
                  onBlur={() => { if (!search) setSearchOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setSearch(''); setSearchOpen(false); } }} />
                {search ? <button type="button" className="icon-button tiny" aria-label={t("검색 지우기")} onClick={() => { setSearch(''); searchRef.current?.focus(); }}><Icon name="close" size={12} /></button> : null}
              </span>
            ) : <button type="button" className="db-tool" aria-label={t("검색")} title={t("검색")} onClick={() => setSearchOpen(true)}><Icon name="search" size={16} /></button>}
            </>}
            {active?.viewType === 'form' ? automationButton : null}
            <button type="button" ref={settingsButton} className={`db-tool db-tool-settings${settings ? ' active' : ''}`} aria-label={t("보기 설정")} title={t("보기 설정")} onClick={() => setSettings(settings ? null : 'main')}><Icon name="sliders" size={16} /></button>
            {active?.viewType === 'form' ? null : <span className="db-new">
              <button type="button" className="db-new-main" onClick={() => newRow(result, sourceId).catch(report)}>{t("새로 만들기")}</button>
              <button type="button" className="db-new-more" aria-label={t("템플릿")} onClick={event => setNewMenu(event.currentTarget)}><Icon name="chevron-down" size={14} /></button>
            </span>}
          </div>
        ) : null}
      </div>
      {active && result && barShown && !compact ? <FilterSortBar view={active} result={result} pendingRule={pendingRule} onPendingDone={() => setPendingRule(null)} /> : null}
      <div className="db-body">
        {query.error && !result ? <div className="database-error">{query.error}</div> : null}
        <ToolbarSlot.Provider value={compact ? null : toolbarSlot}>
          {shown ? <ShownView result={shown.result} view={shown.view} sourceId={sourceId} inline={inline} selected={selected} onSelect={setSelected} emptyState={emptyState} onFilterProperty={propertyId => { const property = shown.result.properties.find(item => item.id === propertyId); if (property) addFilter(property); }} /> : <div className="database-loading" aria-busy="true" />}
        </ToolbarSlot.Provider>
      </div>
      {settings && active && result ? <ViewSettingsPanel key={active.id} view={active} result={result} sourceId={sourceId} page={settings} onPage={setSettings} onClose={() => setSettings(null)} inline={inline} anchor={() => settingsButton.current} /> : null}
      {addMenu ? <AddViewMenu anchor={addMenu} onPick={type => addView(type).catch(report)} onClose={() => setAddMenu(null)} /> : null}
      {tabMenu ? <Menu anchor={tabMenu.anchor} width={220} entries={tabEntries(tabMenu.view)} onClose={() => setTabMenu(null)} /> : null}
      {templateMenu ? <Menu anchor={templateMenu.anchor} placement="right-start" width={220} onClose={() => setTemplateMenu(null)} entries={[
        { label: source?.defaultTemplateId === templateMenu.template.id ? t("기본값 해제") : t("기본값으로 설정"), icon: 'star', onSelect: () => { apply([{ type: 'source.configure_templates', id: sourceId, defaultTemplateId: source?.defaultTemplateId === templateMenu.template.id ? null : templateMenu.template.id }]).catch(report); } },
        { label: t("편집"), icon: 'pencil', onSelect: () => { setNewMenu(null); navigate(templateMenu.template.id); } },
        { label: t("복제"), icon: 'duplicate', onSelect: () => { duplicatePage(templateMenu.template).catch(report); } },
        { label: t("삭제"), icon: 'trash', danger: true, onSelect: () => { apply([{ type: 'node.trash', id: templateMenu.template.id }]).catch(report); } },
      ]} /> : null}
      {newMenu ? <Menu anchor={newMenu} placement="below-end" width={360} entries={newEntries} onClose={() => setNewMenu(null)} className="template-menu" /> : null}
      {filterPicker && result ? <PropertyPicker anchor={filterPicker} title={t("필터 기준…")} properties={result.properties} onClose={() => setFilterPicker(null)} onPick={addFilter} footer={[{ label: t("고급 필터 추가"), icon: 'plus', onSelect: () => { setFilterPicker(null); addAdvancedFilter(); } }]} /> : null}
      {sortPopover && active && result ? (
        <PropertyPicker anchor={sortPopover} title={t("정렬 기준…")} properties={result.properties} onClose={() => setSortPopover(null)}
          onPick={property => { updateView(active, { sorts: [{ propertyId: property.id, direction: 'asc' }] }).then(() => { setShowBar(true); setBarHidden(false); setPendingRule('$sort'); }); }} />
      ) : null}
    </div>
  );
}
