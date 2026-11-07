import { formatShortDate } from '../data/format';
import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { navigate, openLibrary, openPeek, recentIds, recentKey, useRoute, visitedAt, hrefFor, type LibraryTab } from '../data/router';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import { readLocal, storeLocal } from '../data/api';
import { apply } from '../data/commands';
import type { Entity, Filter, PageEntity, PropertyEntity, QueryResult, ViewConfig, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import type { Anchor } from '../ui/overlay';
import { EntityIcon } from '../page/EntityIcon';
import { createPage, toggleFavorite, trashNode } from '../page/actions';
import { EmojiPicker } from '../page/PageView';
import { RenamePopover } from '../ui/RenamePopover';
import { openWorkspaceDialog } from '../dialogs/registry';
import { newRule } from '../dialogs/filters';
import { FilterRuleList, FilterSortBar, PropertyPicker, sortDirectionLabels } from '../database/FilterSortBar';
import { filterRules, isDatabasePage } from '../database/shared';
import { ViewEditContext } from '../database/viewEdit';
import { compareLibraryValues, matchesLibraryFilter, type LibraryValue } from './libraryQuery';

// "라이브러리" (sidebar shortcut and "모두 보기"), with the sidebar open: title 32/700 at the page's left padding (102), blue
// "새 페이지" on the right (94×32), pill tabs (32 high, r20, selected rgba(33,27,23,.05)), the tools 28×28 on the right,
// then a table: header 36 high (14/400 #7d7a75 with icons), rows 37 high (36 + 1px line), name column 420 wide, the
// others 200.
//
// The list works like a database table view. 필터 · 검색 · 설정 (28 each): 필터
// opens "필터 기준…" (290 wide: 페이지 이름 · 생성 일시 · 작성자 · 최종 편집 일시 · 최종 편집자 · 최종 열람 일시
// | + 고급 필터 추가); a chosen column becomes a chip in a bar under the tabs, after the tab's sort chip
// ("↓ 최종 열람 일시" on 최근) and a divider, then "+ 필터" and, while anything differs from the tab's default,
// "리셋" on the right. Chips that are not the default carry an orange dot (so does the 필터 tool). The
// rule and sort editors and the advanced filter are the database ones. 검색 opens a 150-wide field right of
// its icon ("입력하여 검색…"). 설정 docks a "보기 설정" panel (속성 표시/숨기기 n › · 필터 ›). A column head
// opens 필터 · 정렬 › · 그룹 (그룹 해제) · 숨기기 · 텍스트 줄바꿈. Pointing at a row shows a checkbox 26px
// left of the table and "열기" in the name; ticked rows bring "N개 선택됨 | 🗑 | ⋯" over the tabs; ⋯ and a
// right-click give the page menu. 생성 일시 and 최종 편집자 are columns hidden by default.

const tabs: Array<{ id: LibraryTab; label: string; icon: string }> = [
  { id: 'recents', label: t("최근"), icon: 'clock' },
  { id: 'favorites', label: t("즐겨찾기"), icon: 'star' },
  { id: 'private', label: t("개인 페이지"), icon: 'lock' },
];

// "방금", "3분 전", "1시간 전", "2일 전", "2주 전", "9월 16일", "2024년 5월 29일".
export function libraryTime(iso: string | undefined): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.floor((Date.now() - at) / 60000);
  if (minutes < 1) return t("방금");
  if (minutes < 60) return t("{0}분 전", [minutes]);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{0}시간 전", [hours]);
  const days = Math.floor(hours / 24);
  if (days < 7) return t("{0}일 전", [days]);
  if (days < 28) return t("{0}주 전", [Math.floor(days / 7)]);
  const date = new Date(at);
  return formatShortDate(date);
}

type Column = 'name' | 'creator' | 'location' | 'edited' | 'visited' | 'created' | 'editor';
const columnInfo: Record<Column, { label: string; icon: string; width: number; property?: string }> = {
  name: { label: t("페이지 이름"), icon: 'page', width: 420, property: 'name' },
  creator: { label: t("만든 사람"), icon: 'people', width: 200, property: 'creator' },
  location: { label: t("소스"), icon: 'arrow-up-right', width: 200 },
  edited: { label: t("최종 편집 일시"), icon: 'clock', width: 200, property: 'edited' },
  visited: { label: t("최종 열람 일시"), icon: 'clock', width: 200, property: 'visited' },
  created: { label: t("생성 일시"), icon: 'clock', width: 200, property: 'created' },
  editor: { label: t("최종 편집자"), icon: 'people', width: 200, property: 'editor' },
};
const columnsFor: Record<LibraryTab, Column[]> = {
  recents: ['name', 'creator', 'location', 'edited', 'visited', 'created', 'editor'],
  favorites: ['name', 'edited', 'created', 'creator', 'editor'],
  private: ['name', 'edited', 'created', 'creator', 'editor'],
};
const hiddenByDefault: Record<LibraryTab, Column[]> = { recents: ['created', 'editor'], favorites: ['created', 'creator', 'editor'], private: ['created', 'creator', 'editor'] };

// The columns as filter/sort properties, in menu order.
const me = { id: 'me', name: t("나"), color: 'default' };
const libraryProperties: PropertyEntity[] = ([
  ['name', t("페이지 이름"), 'title', 'page'],
  ['created', t("생성 일시"), 'created_time', 'clock'],
  ['creator', t("작성자"), 'person', 'people'],
  ['edited', t("최종 편집 일시"), 'last_edited_time', 'clock'],
  ['editor', t("최종 편집자"), 'person', 'people'],
  ['visited', t("최종 열람 일시"), 'last_edited_time', 'clock'],
] as const).map(([id, name, type, icon]) => ({ id, kind: 'property', sourceId: 'library', name, type, icon, ...(type === 'person' ? { options: [me] } : {}) }) as unknown as PropertyEntity);
const propertyById = new Map(libraryProperties.map(property => [property.id, property]));

type Sort = { propertyId: string; direction: 'asc' | 'desc' };
interface TabState { filter: Filter | null; advancedFilter: boolean; sorts: Sort[]; bar: boolean }
const defaultSorts = (tab: LibraryTab): Sort[] => tab === 'recents' ? [{ propertyId: 'visited', direction: 'desc' }] : [];
const freshState = (tab: LibraryTab): TabState => ({ filter: null, advancedFilter: false, sorts: defaultSorts(tab), bar: false });
// Filters and sorts are kept for the visit only (they show as unsaved); the column
// choices (hidden, wrapped, grouped) stay in this browser.
const sessionStates = new Map<LibraryTab, TabState>();
const prefsKey = 'pageyard-library-view-v2';
interface Prefs { hidden?: Partial<Record<LibraryTab, Column[]>>; wrap: Column[]; group?: Partial<Record<LibraryTab, Column | null>>; order?: Partial<Record<LibraryTab, Column[]>> }

function childPages(id: string) {
  return workspace.children(id).filter(child => (child.kind === 'page' && !(child as PageEntity).sourceId) || child.kind === 'source').filter(child => workspace.visible(child.id));
}

export function LibraryPage() {
  const ws = useWorkspace();
  const route = useRoute();
  const tab = route.library ?? 'recents';
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [prefs, setPrefs] = useState<Prefs>(() => ({ wrap: [], ...readLocal<Partial<Prefs>>(prefsKey, {}) }));
  const savePrefs = (next: Prefs) => { setPrefs(next); storeLocal(prefsKey, JSON.stringify(next)); };
  const [state, setStateRaw] = useState<TabState>(() => sessionStates.get(tab) ?? freshState(tab));
  useEffect(() => { setStateRaw(sessionStates.get(tab) ?? freshState(tab)); setSelected([]); setQuery(null); }, [tab]);
  const setState = (next: TabState) => { sessionStates.set(tab, next); setStateRaw(next); };
  const [pending, setPending] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: 'filter' | 'column' | 'item' | 'bulk'; anchor: Anchor; column?: Column; item?: Entity } | null>(null);
  const [panel, setPanel] = useState<null | 'main' | 'properties' | 'filter'>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [rename, setRename] = useState<{ anchor: Anchor; item: Entity } | null>(null);
  const [iconFor, setIconFor] = useState<{ anchor: Element; item: Entity } | null>(null);
  const [bulkIcon, setBulkIcon] = useState<{ anchor: Element; ids: string[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [recentList, setRecentList] = useState(() => recentIds());
  const visits = useMemo(() => visitedAt(), [tab, ws.version]);

  const allColumns = prefs.order?.[tab] ? [...prefs.order[tab]!, ...columnsFor[tab].filter(column => !prefs.order![tab]!.includes(column))] : columnsFor[tab];
  const hidden = prefs.hidden?.[tab] ?? hiddenByDefault[tab];
  const columns = allColumns.filter(column => column === 'name' || !hidden.includes(column));
  const group = prefs.group?.[tab] ?? null;
  const setHidden = (next: Column[]) => savePrefs({ ...prefs, hidden: { ...prefs.hidden, [tab]: next } });

  const base: Entity[] = tab === 'recents'
    ? recentList.map(id => ws.get(id)).filter((item): item is Entity => !!item && ws.visible(item.id) && ['page', 'source', 'view'].includes(item.kind) && !(item as PageEntity).template)
    : tab === 'favorites' ? ws.favorites().map(id => ws.get(id)).filter((item): item is Entity => !!item && ws.visible(item.id))
      : ws.children(null).filter(item => ((item.kind === 'page' && !(item as PageEntity).sourceId) || item.kind === 'source') && ws.visible(item.id) && !(item as PageEntity).template);
  const valuesOf = (item: Entity): Record<string, LibraryValue> => ({
    name: ws.title(item) || '',
    created: item.createdAt ? { start: item.createdAt } : null,
    creator: ['me'],
    edited: item.updatedAt ? { start: item.updatedAt } : null,
    editor: ['me'],
    visited: visits[item.id] ? { start: visits[item.id] } : null,
  });
  let rows = base.filter(item => matchesLibraryFilter(state.filter, valuesOf(item)));
  const needle = query?.trim().toLocaleLowerCase();
  if (needle) rows = rows.filter(item => (ws.title(item) || '').toLocaleLowerCase().includes(needle));
  if (state.sorts.length) {
    const keyed = rows.map(item => ({ item, values: valuesOf(item) }));
    keyed.sort((a, b) => {
      for (const sort of state.sorts) {
        const x = a.values[sort.propertyId], y = b.values[sort.propertyId];
        const order = compareLibraryValues(x, y);
        if (!order) continue;
        const emptyX = x == null || x === '', emptyY = y == null || y === '';
        return emptyX || emptyY ? order : sort.direction === 'desc' ? -order : order;
      }
      return 0;
    });
    rows = keyed.map(entry => entry.item);
  }

  const locationOf = (item: Entity) => { const parent = item.parentId ? ws.get(item.parentId) : null; return parent && ws.visible(parent.id) ? parent : null; };
  const groupKey = (item: Entity) => group === 'location' ? locationOf(item)?.id ?? 'private' : group === 'creator' || group === 'editor' ? 'me' : '';
  const groups = group ? [...new Set(rows.map(groupKey))].map(key => ({ key, items: rows.filter(item => groupKey(item) === key) })) : [{ key: '', items: rows }];
  const groupLabel = (key: string) => {
    if (group === 'creator' || group === 'editor') return <span className="library-person"><span className="avatar small">{t("나").slice(0, 1)}</span>{t("나")}</span>;
    const parent = key === 'private' ? null : ws.get(key);
    return parent ? <span className="library-location"><EntityIcon item={parent} size={16} /><span>{ws.title(parent) || t("새 페이지")}</span></span> : <span className="library-location"><Icon name="lock" size={16} /><span>{t("개인 페이지")}</span></span>;
  };

  const cell = (item: Entity, column: Column, depth: number) => {
    if (column === 'name') {
      const kids = childPages(item.id);
      const expanded = open.has(item.id);
      return (
        <div className="library-name" style={{ paddingLeft: 8 + depth * 24 }}>
          {kids.length ? <button type="button" className="library-toggle" aria-label={expanded ? t("접기") : t("펼치기")} onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); }}><Icon name="triangle-right" size={12} className={expanded ? 'rotated' : ''} /></button> : <span className="library-toggle-space" />}
          <span className="library-icon"><EntityIcon item={item} size={18} /></span>
          <span className="library-title">{ws.title(item) || t("새 페이지")}</span>
          <button type="button" className="library-open" onClick={event => { event.preventDefault(); event.stopPropagation(); if (item.kind === 'page') openPeek(item.id, 'side'); else navigate(item.id); }}><Icon name="peek-side" size={14} />{t("열기")}</button>
        </div>
      );
    }
    if (column === 'creator' || column === 'editor') {
      const by = (item as PageEntity).createdBy;
      const name = !by || by === 'user' || column === 'editor' ? t("나") : by;
      return <span className="library-person"><span className="avatar small">{name.slice(0, 1)}</span>{name}</span>;
    }
    if (column === 'location') {
      const parent = locationOf(item);
      return parent ? <span className="library-location"><EntityIcon item={parent} size={16} /><span>{ws.title(parent) || t("새 페이지")}</span></span> : <span className="library-location"><Icon name="lock" size={16} /><span>{t("개인 페이지")}</span></span>;
    }
    return <span className="library-date">{libraryTime(column === 'edited' ? item.updatedAt : column === 'created' ? item.createdAt : visits[item.id])}</span>;
  };

  const rowsWithChildren = (items: Entity[], depth: number): Array<{ item: Entity; depth: number }> => items.flatMap(item => [{ item, depth }, ...(open.has(item.id) && depth < 8 ? rowsWithChildren(childPages(item.id), depth + 1) : [])]);

  // ----- filters and sorts (the database chips over a stand-in view) -----
  const fakeView = { id: `library:${tab}`, kind: 'view', sourceId: 'library', name: t("라이브러리"), viewType: 'table', parentId: null, config: { filter: state.filter, advancedFilter: state.advancedFilter, sorts: state.sorts } } as unknown as ViewEntity;
  const fakeResult = { properties: libraryProperties, visibleProperties: libraryProperties.map(property => property.id) } as unknown as QueryResult;
  const editor = useMemo(() => ({
    schema: libraryProperties,
    update: (_view: ViewEntity, config: Partial<ViewConfig>) => {
      const current = sessionStates.get(tab) ?? freshState(tab);
      const next: TabState = { ...current, bar: true, ...(config.filter !== undefined ? { filter: config.filter ?? null } : {}), ...(config.advancedFilter !== undefined ? { advancedFilter: !!config.advancedFilter } : {}), ...(config.sorts !== undefined ? { sorts: (config.sorts ?? []) as Sort[] } : {}) };
      if (!next.filter) next.advancedFilter = false;
      sessionStates.set(tab, next); setStateRaw(next);
      return Promise.resolve();
    },
  }), [tab]);
  const sortsChanged = JSON.stringify(state.sorts) !== JSON.stringify(defaultSorts(tab));
  const filtered = !!state.filter;
  const rules = state.advancedFilter && state.filter ? null : filterRules(state.filter);
  const addRule = (propertyId: string) => {
    const property = propertyById.get(propertyId); if (!property) return;
    const rule = newRule(property);
    if (rules) setState({ ...state, bar: true, filter: { all: [...rules, rule] } });
    else setState({ ...state, bar: true, filter: { all: [...(state.filter ? [state.filter] : []), rule] }, advancedFilter: true });
    setPending(rules ? propertyId : '$advanced');
  };
  const startAdvanced = () => {
    const first = libraryProperties[0];
    setState({ ...state, bar: true, filter: state.filter ?? { all: [newRule(first) as Filter] }, advancedFilter: true });
    setPending('$advanced');
  };
  const reset = () => setState({ ...freshState(tab), bar: true });

  // ----- selection and the page menu -----
  const toggleSelected = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const allIds = groups.flatMap(entry => entry.items.map(item => item.id));
  useEffect(() => {
    if (!selected.length) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.menu, .popover')) setSelected([]); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.length]);
  const forgetRecent = (ids: string[]) => { const next = recentIds().filter(id => !ids.includes(id)); storeLocal(recentKey, JSON.stringify(next)); setRecentList(next); };
  const itemEntries = (item: Entity, rowElement: Element | null): MenuEntry[] => {
    const starred = ws.favorites().includes(item.id);
    const page = item.kind === 'page' ? item as PageEntity : null;
    const box = (rowElement ?? document.body).getBoundingClientRect();
    return [
      { kind: 'section', label: page && !isDatabasePage(page) ? t("페이지") : t("데이터베이스") },
      { label: starred ? t("즐겨찾기에서 제거") : t("즐겨찾기에 추가"), icon: starred ? 'star-filled' : 'star', onSelect: () => toggleFavorite(item.id).catch(report) },
      ...(tab === 'recents' ? [{ label: t("library|최근 항목에서 제거"), icon: 'eye-off', onSelect: () => forgetRecent([item.id]) } as MenuEntry] : []),
      { label: t("아이콘 편집"), icon: 'emoji', onSelect: () => { const icon = rowElement?.querySelector('.library-icon') ?? rowElement; if (icon) setIconFor({ anchor: icon, item }); } },
      { label: t("library|이름 바꾸기"), icon: 'pencil', shortcut: '⌘⇧R', onSelect: () => setRename({ anchor: { x: box.left + 44, y: box.bottom + 2 }, item }) },
      { kind: 'separator' },
      { label: t("새 탭에서 열기"), icon: 'arrow-up-right', shortcut: '⌘⇧↵', onSelect: () => { window.open(hrefFor(item.id), '_blank'); } },
      ...(page ? [{ label: t("사이드 보기로 열기"), icon: 'peek-side', shortcut: '⌥Click', onSelect: () => openPeek(item.id, 'side') } as MenuEntry] : []),
      { kind: 'separator' },
      { label: t("링크 복사"), icon: 'link', onSelect: () => navigator.clipboard.writeText(new URL(hrefFor(item.id), location.href).href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report) },
      ...(page ? [{ label: t("다른 페이지로 옮기기"), icon: 'move', shortcut: '⌘⇧P', onSelect: () => openWorkspaceDialog('move', { id: item.id, anchor: rowElement ?? undefined, placement: 'below-start' }) } as MenuEntry] : []),
      { label: t("휴지통으로 이동"), icon: 'trash', shortcut: 'Del', onSelect: () => { trashNode(item.id).then(() => setSelected(current => current.filter(id => id !== item.id))).catch(report); } },
    ];
  };
  const bulkEntries = (): MenuEntry[] => {
    if (selected.length === 1) { const item = ws.get(selected[0]); if (item) return itemEntries(item, document.querySelector(`.library-row[data-id="${CSS.escape(item.id)}"]`)); }
    // Several at once: move, delete, unfavorite or change icons for many pages.
    const favorites = ws.favorites();
    const allStarred = selected.every(id => favorites.includes(id));
    const pages = selected.filter(id => ws.get(id)?.kind === 'page' && !ws.get<PageEntity>(id)?.sourceId);
    const anchor = document.querySelector('.library-selection-trash') ?? document.body;
    return [
      { kind: 'section', label: t("{0}개 선택됨", [selected.length]) },
      { label: allStarred ? t("즐겨찾기에서 제거") : t("즐겨찾기에 추가"), icon: allStarred ? 'star-filled' : 'star',
        onSelect: () => { apply([{ type: 'navigation.set', favorites: allStarred ? favorites.filter(id => !selected.includes(id)) : [...favorites, ...selected.filter(id => !favorites.includes(id))] }]).then(() => setStatus(allStarred ? t("즐겨찾기에서 제거했습니다.") : t("즐겨찾기에 추가했습니다."))).catch(report); } },
      { label: t("아이콘 변경"), icon: 'emoji', disabled: !pages.length, onSelect: () => setBulkIcon({ anchor, ids: selected.filter(id => ws.get(id)?.kind === 'page') }) },
      { label: t("다른 페이지로 옮기기"), icon: 'move', disabled: !pages.length, onSelect: () => openWorkspaceDialog('pick-page', { title: t("{0}개 페이지 옮기기", [pages.length]), placeholder: t("페이지의 이동 위치…"), allowRoot: true,
        onPick: (target: PageEntity | null) => apply(pages.filter(id => id !== target?.id).map(id => ({ type: 'node.move', id, parentId: target?.id ?? null }))).then(() => { setSelected([]); setStatus(t("{0}개 페이지를 옮겼습니다.", [pages.length])); }) }) },
      ...(tab === 'recents' ? [{ label: t("library|최근 항목에서 제거"), icon: 'eye-off', onSelect: () => { forgetRecent(selected); setSelected([]); } } as MenuEntry] : []),
      { label: t("링크 복사"), icon: 'link', onSelect: () => navigator.clipboard.writeText(selected.map(id => new URL(hrefFor(id), location.href).href).join('\n')).then(() => setStatus(t("링크를 복사했습니다."))).catch(report) },
      { label: t("휴지통으로 이동"), icon: 'trash', shortcut: 'Del', onSelect: () => { apply(selected.map(id => ({ type: 'node.trash', id }))).then(() => setSelected([])).catch(report); } },
    ];
  };
  const openItemMenu = (event: ReactMouseEvent, item: Entity) => {
    event.preventDefault();
    if (!selected.includes(item.id)) setSelected([item.id]);
    setMenu({ kind: 'item', anchor: { x: event.clientX, y: event.clientY }, item });
  };

  // ----- column heads -----
  const columnEntries = (column: Column): MenuEntry[] => {
    const property = columnInfo[column].property ? propertyById.get(columnInfo[column].property!) : undefined;
    const [asc, desc] = sortDirectionLabels(property);
    const groupable = column === 'creator' || column === 'editor' || column === 'location';
    return [
      ...(property ? [
        { label: t("필터"), icon: 'filter', onSelect: () => addRule(property.id) } as MenuEntry,
        { label: t("정렬"), icon: 'sort', submenuWidth: 200, submenu: () => [
          { label: asc, icon: 'arrow-up', onSelect: () => setState({ ...state, bar: true, sorts: [{ propertyId: property.id, direction: 'asc' }] }) },
          { label: desc, icon: 'arrow-down', onSelect: () => setState({ ...state, bar: true, sorts: [{ propertyId: property.id, direction: 'desc' }] }) },
        ] } as MenuEntry,
      ] : []),
      ...(groupable ? [group === column
        ? { label: t("그룹 해제"), icon: 'group', onSelect: () => savePrefs({ ...prefs, group: { ...prefs.group, [tab]: null } }) } as MenuEntry
        : { label: t("그룹"), icon: 'group', onSelect: () => savePrefs({ ...prefs, group: { ...prefs.group, [tab]: column } }) } as MenuEntry] : []),
      ...(column !== 'name' ? [{ label: t("숨기기"), icon: 'eye-off', onSelect: () => setHidden([...hidden, column]) } as MenuEntry] : []),
      { label: t("텍스트 줄바꿈"), icon: 'wrap', checked: prefs.wrap.includes(column), onSelect: () => savePrefs({ ...prefs, wrap: prefs.wrap.includes(column) ? prefs.wrap.filter(item => item !== column) : [...prefs.wrap, column] }) },
    ];
  };

  const headRow = (key: string) => (
    <div className="library-row head" role="row" key={key}>
      <span className={`library-check head${selected.length ? ' shown' : ''}`} role="cell">
        <input type="checkbox" aria-label={t("모두 선택")} checked={allIds.length > 0 && allIds.every(id => selected.includes(id))} ref={element => { if (element) element.indeterminate = selected.length > 0 && !allIds.every(id => selected.includes(id)); }}
          onChange={() => setSelected(allIds.every(id => selected.includes(id)) ? [] : allIds)} />
      </span>
      {columns.map(column => (
        <button type="button" key={column} role="columnheader" className="library-cell library-head-cell" style={{ width: columnInfo[column].width }} onClick={event => setMenu({ kind: 'column', anchor: event.currentTarget, column })}>
          <Icon name={columnInfo[column].icon} size={16} /><span>{columnInfo[column].label}</span>
        </button>
      ))}
    </div>
  );

  const showBar = state.bar || filtered || sortsChanged;
  const rowsOf = (items: Entity[]) => rowsWithChildren(items, 0).map(({ item, depth }) => {
    const ticked = selected.includes(item.id);
    return (
      <a key={`${item.id}-${depth}`} data-id={item.id} href={hrefFor(item.id)} role="row" className={`library-row${ticked ? ' selected' : ''}`}
        onClick={event => { if (event.altKey && item.kind === 'page') { event.preventDefault(); openPeek(item.id, 'side'); return; } if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); navigate(item.id); } }}
        onContextMenu={event => openItemMenu(event, item)}>
        <span className={`library-check${selected.length ? ' shown' : ''}`} role="cell" onClick={event => { event.stopPropagation(); }}>
          <input type="checkbox" aria-label={t("{0} 선택", [ws.title(item) || t("새 페이지")])} checked={ticked} onClick={event => event.stopPropagation()} onChange={() => toggleSelected(item.id)} />
        </span>
        {columns.map(column => <div key={column} role="cell" className={`library-cell cell-${column}${prefs.wrap.includes(column) ? ' wrap' : ''}`} style={{ width: columnInfo[column].width }}>{cell(item, column, depth)}</div>)}
      </a>
    );
  });

  return (
    <ViewEditContext.Provider value={editor}>
      <div className={`frame-scroller library-scroller view-scroller${panel ? ' settings-open' : ''}`}>
        <div className="library">
          <div className="library-head">
            <h1 className="library-title-text">{t("라이브러리")}</h1>
            <button type="button" className="library-new" onClick={() => createPage({ parentId: null }).catch(report)}>{t("새 페이지")}</button>
          </div>
          <div className="library-bar">
            {selected.length ? (
              <div className="selection-bar library-selection" role="toolbar" aria-label={t("선택한 항목 작업")}>
                <button type="button" className="selection-count" onClick={() => setSelected([])} title={t("선택 해제")}>{t("{0}개 선택됨", [selected.length])}</button>
                <button type="button" className="selection-action library-selection-trash" title={t("휴지통으로 이동")} aria-label={t("휴지통으로 이동")} onClick={() => { apply(selected.map(id => ({ type: 'node.trash', id }))).then(() => setSelected([])).catch(report); }}><Icon name="trash" size={16} /></button>
                <button type="button" className="selection-action" title={t("더 보기")} aria-label={t("더 보기")} onClick={event => setMenu({ kind: 'bulk', anchor: event.currentTarget })}><Icon name="more" size={16} /></button>
              </div>
            ) : null}
            <div className="library-tabs" role="tablist">
              {tabs.map(item => (
                <button type="button" key={item.id} role="tab" aria-selected={tab === item.id} className={`library-tab${tab === item.id ? ' selected' : ''}`} onClick={() => { setOpen(new Set()); openLibrary(item.id); }}>
                  <Icon name={item.icon} size={16} /><span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="library-tools">
              <button type="button" className={`icon-button filter-tool${filtered ? ' active' : ''}`} aria-label={t("필터")} title={t("필터")} onClick={event => setMenu({ kind: 'filter', anchor: event.currentTarget })}><Icon name="filter" size={16} />{filtered ? <span className="chip-dot" aria-hidden /> : null}</button>
              <button type="button" className={`icon-button${query !== null ? ' active' : ''}`} aria-label={t("검색")} title={t("검색")} onClick={() => setQuery(current => (current === null ? '' : null))}><Icon name="search" size={16} /></button>
              {query !== null ? <input className="library-search" autoFocus placeholder={t("library|입력하여 검색…")} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(null); }} onBlur={() => { if (!query) setQuery(null); }} /> : null}
              <button type="button" className={`icon-button${panel ? ' active' : ''}`} aria-label={t("설정")} title={t("설정")} onClick={() => setPanel(value => (value ? null : 'main'))}><Icon name="sliders" size={16} /></button>
            </div>
          </div>
          {showBar ? (
            <div className="library-filter-bar">
              <FilterSortBar view={fakeView} result={fakeResult} pendingRule={pending} onPendingDone={() => setPending(null)} changed={{ sorts: sortsChanged, filter: filtered }} onReset={reset} />
            </div>
          ) : null}
          <div className="library-table" role="table">
            {groups.map(entry => (
              <div key={entry.key || 'all'} className={group ? 'library-group' : undefined}>
                {group ? (
                  <button type="button" className="library-group-head" onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(entry.key)) next.delete(entry.key); else next.add(entry.key); return next; })}>
                    <Icon name="triangle-right" size={12} className={collapsed.has(entry.key) ? '' : 'rotated'} />{groupLabel(entry.key)}<span className="library-group-count">{entry.items.length}</span>
                  </button>
                ) : null}
                {collapsed.has(entry.key) ? null : <>{headRow(`head-${entry.key}`)}{rowsOf(entry.items)}</>}
              </div>
            ))}
            {!rows.length ? <div className="library-empty">{needle || filtered ? t("결과 없음") : tab === 'favorites' ? t("즐겨찾기한 페이지가 없습니다.") : tab === 'recents' ? t("최근에 연 페이지가 없습니다.") : t("페이지가 없습니다.")}</div> : null}
          </div>
        </div>
        {panel ? <LibrarySettings page={panel} onPage={setPanel} columns={allColumns} hidden={hidden} onHidden={setHidden} onOrder={order => savePrefs({ ...prefs, order: { ...prefs.order, [tab]: order } })}
          rules={rules} onRules={next => setState({ ...state, bar: true, filter: next.length ? { all: next } : null, advancedFilter: false })} onAdd={addRule} onAdvanced={startAdvanced} /> : null}
        {menu?.kind === 'filter' ? (
          <PropertyPicker anchor={menu.anchor as Element} title={t("필터 기준…")} properties={rules ? libraryProperties.filter(property => !rules.some(rule => rule.propertyId === property.id)) : libraryProperties}
            onClose={() => setMenu(null)} onPick={property => addRule(property.id)}
            footer={[{ label: t("고급 필터 추가"), icon: 'plus', muted: true, onSelect: () => { setMenu(null); startAdvanced(); } } as MenuEntry]} />
        ) : null}
        {menu?.kind === 'column' && menu.column ? <Menu anchor={menu.anchor} placement="below-start" width={220} onClose={() => setMenu(null)} entries={columnEntries(menu.column)} /> : null}
        {menu?.kind === 'item' && menu.item ? <Menu anchor={menu.anchor} placement="pointer" width={265} search={t("작업 검색…")} label={t("페이지 메뉴")} onClose={() => setMenu(null)} entries={itemEntries(menu.item, document.querySelector(`.library-row[data-id="${CSS.escape(menu.item.id)}"]`))} /> : null}
        {menu?.kind === 'bulk' ? <Menu anchor={menu.anchor} placement="below-start" width={265} search={t("작업 검색…")} label={t("선택한 항목 작업")} onClose={() => setMenu(null)} entries={bulkEntries()} /> : null}
        {rename ? (
          <RenamePopover anchor={rename.anchor} placement="pointer" value={ws.title(rename.item)} placeholder={t("제목 없음")} icon={<EntityIcon item={rename.item} size={18} />}
            onIcon={button => setIconFor({ anchor: button, item: rename.item })}
            onCommit={value => apply([rename.item.kind === 'source' ? { type: 'source.update', id: rename.item.id, name: value } : { type: 'page.update', id: rename.item.id, title: value }]).catch(report)} onClose={() => setRename(null)} />
        ) : null}
        {bulkIcon ? <EmojiPicker anchor={bulkIcon.anchor} onClose={() => setBulkIcon(null)} onPick={value => apply(bulkIcon.ids.map(id => ({ type: 'page.update', id, icon: value }))).catch(report)}
          onRemove={() => apply(bulkIcon.ids.map(id => ({ type: 'page.update', id, icon: null }))).catch(report)} /> : null}
        {iconFor ? <EmojiPicker anchor={iconFor.anchor} onClose={() => setIconFor(null)} onPick={value => apply([{ type: iconFor.item.kind === 'source' ? 'source.update' : 'page.update', id: iconFor.item.id, icon: value }]).catch(report)}
          onRemove={(iconFor.item as PageEntity).icon ? () => apply([{ type: iconFor.item.kind === 'source' ? 'source.update' : 'page.update', id: iconFor.item.id, icon: null }]).catch(report) : undefined} /> : null}
      </div>
    </ViewEditContext.Provider>
  );
}

// The docked "보기 설정": under the tab row on the content's right edge, 290 wide
// with a 1px #e6e5e3 line on its left, down to the window bottom over the list. "보기 설정" 12/500 #7d7a75
// (padding 14 16 6) and ⓧ; rows 28 high 8 in: 속성 표시/숨기기 n › · 필터 ›. 속성 표시/숨기기: ← title ⓧ, "속성 검색…",
// "표에 표시" (모두 숨기기) with handles and eyes, "표에서 숨김" (모두 표시). 필터 with no rules: "← 필터 추가",
// "필터 기준…" and the columns; with rules, the rule chips and "+ 필터 추가".
function LibrarySettings({ page, onPage, columns, hidden, onHidden, onOrder, rules, onRules, onAdd, onAdvanced }: {
  page: 'main' | 'properties' | 'filter'; onPage: (page: null | 'main' | 'properties' | 'filter') => void; columns: Column[]; hidden: Column[]; onHidden: (hidden: Column[]) => void; onOrder: (order: Column[]) => void;
  rules: ReturnType<typeof filterRules>; onRules: (rules: NonNullable<ReturnType<typeof filterRules>>) => void; onAdd: (propertyId: string) => void; onAdvanced: () => void;
}) {
  const [needle, setNeedle] = useState('');
  const drag = useRef<Column | null>(null);
  useEffect(() => setNeedle(''), [page]);
  const close = <button type="button" className="settings-close" aria-label={t("닫기")} onClick={() => onPage(null)}><Icon name="close" size={12} /></button>;
  const header = (title: string) => (
    <div className="settings-head"><button type="button" className="icon-button tiny settings-back" aria-label={t("뒤로")} onClick={() => onPage('main')}><Icon name="arrow-left" size={16} /></button><span className="settings-title">{title}</span><span className="spacer" />{close}</div>
  );
  const search = (placeholder: string) => <div className="settings-search"><input className="text-input" autoFocus value={needle} placeholder={placeholder} aria-label={placeholder} onChange={event => setNeedle(event.target.value)} /></div>;
  const match = (label: string) => !needle.trim() || label.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
  let body;
  if (page === 'main') {
    body = (
      <>
        <div className="settings-head library-settings-head"><span className="library-settings-title">{t("보기 설정")}</span><span className="spacer" />{close}</div>
        <div className="settings-section">
          <button type="button" className="settings-row" onClick={() => onPage('properties')}><Icon name="eye" size={20} /><span className="settings-row-label">{t("속성 표시/숨기기")}</span><span className="settings-row-value">{columns.filter(column => column === 'name' || !hidden.includes(column)).length}</span><Icon name="chevron-right" size={16} className="settings-row-chevron" /></button>
          <button type="button" className="settings-row" onClick={() => onPage('filter')}><Icon name="filter" size={20} /><span className="settings-row-label">{t("필터")}</span>{rules?.length ? <span className="settings-row-value">{rules.length}</span> : null}<Icon name="chevron-right" size={16} className="settings-row-chevron" /></button>
        </div>
      </>
    );
  } else if (page === 'properties') {
    const shown = columns.filter(column => column === 'name' || !hidden.includes(column));
    const off = columns.filter(column => column !== 'name' && hidden.includes(column));
    const reorder = (target: Column) => { const from = drag.current; drag.current = null; if (!from || from === target) return; const next = columns.filter(column => column !== from); next.splice(next.indexOf(target) + 1, 0, from); onOrder(next); };
    body = (
      <>
        {header(t("속성 표시/숨기기"))}
        {search(t("속성 검색…"))}
        <div className="settings-list">
          <div className="settings-subhead"><span>{t("library|표에 표시")}</span><button type="button" className="text-button small settings-link" onClick={() => onHidden(columns.filter(column => column !== 'name'))}>{t("모두 숨기기")}</button></div>
          {shown.filter(column => match(columnInfo[column].label)).map(column => (
            <div key={column} className="settings-row property-toggle" draggable={column !== 'name'} onDragStart={() => { drag.current = column; }} onDragOver={event => event.preventDefault()} onDrop={() => reorder(column)}>
              <Icon name="drag" size={16} className="option-handle" />
              <Icon name={columnInfo[column].icon} size={16} />
              <span className="settings-row-label">{columnInfo[column].label}</span>
              <button type="button" className="icon-button tiny" disabled={column === 'name'} aria-label={t("{0} 숨기기", [columnInfo[column].label])} onClick={() => onHidden([...hidden, column])}><Icon name="eye" size={16} /></button>
            </div>
          ))}
          {off.length ? <div className="settings-subhead"><span>{t("library|표에서 숨김")}</span><button type="button" className="text-button small settings-link" onClick={() => onHidden([])}>{t("모두 표시")}</button></div> : null}
          {off.filter(column => match(columnInfo[column].label)).map(column => (
            <div key={column} className="settings-row property-toggle hidden-property">
              <Icon name="drag" size={16} className="option-handle" />
              <Icon name={columnInfo[column].icon} size={16} />
              <span className="settings-row-label">{columnInfo[column].label}</span>
              <button type="button" className="icon-button tiny" aria-label={t("{0} 표시", [columnInfo[column].label])} onClick={() => onHidden(hidden.filter(item => item !== column))}><Icon name="eye-off" size={16} /></button>
            </div>
          ))}
        </div>
      </>
    );
  } else {
    body = rules && rules.length ? (
      <>
        {header(t("필터"))}
        <FilterRuleList rules={rules} properties={libraryProperties} onChange={onRules} onAdvanced={onAdvanced} />
      </>
    ) : (
      <>
        {header(t("필터 추가"))}
        {search(t("필터 기준…"))}
        <div className="settings-section plain">
          {libraryProperties.filter(property => match(property.name)).map(property => (
            <button type="button" key={property.id} className="settings-row" onClick={() => { onAdd(property.id); onPage(null); }}><Icon name={property.icon ?? 'page'} size={16} /><span className="settings-row-label">{property.name}</span></button>
          ))}
        </div>
      </>
    );
  }
  return <aside className="view-settings library-settings" aria-label={t("보기 설정")}>{body}</aside>;
}
