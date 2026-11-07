import { t } from '../i18n';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { apply } from '../data/commands';
import { useRoute, navigate, recentIds, recentKey, hrefFor, arrivedByHistory, openLibrary, openPeek, openAppPage, type LibraryTab } from '../data/router';
import { useWorkspace, report, workspace } from '../data/store';
import { readLocal, storeLocal } from '../data/api';
import { Icon, viewIcon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Popover, type Anchor } from '../ui/overlay';
import { PagePickerPanel } from '../dialogs/PagePickerPanel';
import { createDragGhost, edgeScroller, pastThreshold, useFadeList, type DragGhost } from '../ui/drag';
import { createDatabasePage, createPage, trashNode, toggleFavorite, duplicatePage } from '../page/actions';
import type { BlockEntity, Entity, PageEntity, ViewEntity } from '../data/types';
import { EntityIcon } from '../page/EntityIcon';
import { openWorkspaceDialog } from '../dialogs/registry';
import { RenamePopover } from '../ui/RenamePopover';
import { setInboxOpen, toggleInbox } from './InboxPanel';
import { WorkspaceMark, showSettings } from './SettingsModal';
import { createWorkspace, defaultWorkspaceName, useWorkspaceIdentity, useWorkspaceList } from '../data/workspaces';
import { EmojiPicker } from '../page/PageView';
import { relativeTime } from '../data/format';
import { addLinkShortcut, addTab, builtinSections, freshLayout, layoutEvent, loadLayout, loadTabs, maxTabs, moveTab, removeTab, saveLayout, selectTab, takeJustAdded, type BuiltinSection, type HomeTab, type Layout, type OpenAs, type PageShortcut, type SectionConfig, type ViewSectionConfig } from './sidebarLayout';
import { newId } from '../data/commands';
import { Switch } from '../ui/primitives';
import { useQuery } from '../data/hooks';
import type { QueryResult, SourceEntity } from '../data/types';
import { isDesktopApp, quitApp } from '../data/desktopApp';

// "페이지 캐시 삭제": drop the offline copies the service worker keeps, then reload from the server.
async function clearPageCache() {
  try { await Promise.all((await caches.keys()).map(key => caches.delete(key))); } catch { /* no cache storage */ }
  location.reload();
}

const expandedKey = 'pageyard-sidebar-expanded-v2';

// The sidebar: the "라이브러리" shortcut, then
// sections — 최근, 즐겨찾기 (only when there are favourites), 개인 페이지 — each showing 5 items
// (5/10/15/20/50 from the section menu) with "모두 보기" into the library when there are more,
// then "사이드바 사용자 지정". Order, counts, removed sections and folding are kept per browser
// (shell/sidebarLayout.ts), as are database shortcuts and view sections.
type SectionId = BuiltinSection;
const sectionInfo: Record<SectionId, { label: string; icon: string; tab: LibraryTab }> = {
  recent: { label: t("최근"), icon: 'clock', tab: 'recents' },
  favorites: { label: t("즐겨찾기"), icon: 'star', tab: 'favorites' },
  private: { label: t("개인 페이지"), icon: 'lock', tab: 'private' },
};
const isBuiltin = (id: string): id is SectionId => (builtinSections as string[]).includes(id);
const openLabels: Record<OpenAs, string> = { side: t("사이드 보기"), center: t("중앙에서 보기"), page: t("전체 페이지") };
const viewSectionLabel = (config: ViewSectionConfig) => {
  if (config.name?.trim()) return config.name.trim();
  const view = workspace.get<ViewEntity>(config.viewId), source = workspace.get(config.sourceId);
  return `${view?.name || t("제목 없음")} · ${source ? workspace.title(source) || t("제목 없음") : t("제목 없음")}`;
};
const shortcutLabel = (shortcut: PageShortcut) => {
  if (shortcut.name?.trim()) return shortcut.name.trim();
  const source = workspace.get(shortcut.sourceId);
  return t("새 페이지는 {0}에 만들어집니다.", [source ? workspace.title(source) || t("제목 없음") : t("제목 없음")]);
};
// A page made from a sidebar shortcut or a view section's "+": from its template, or empty with the
// values the view's filters ask for; opened the way the shortcut says.
async function createFromShortcut(sourceId: string, viewId: string | undefined, templateId: string | null | undefined, openAs: OpenAs) {
  const { createRow } = await import('../page/actions');
  let id: string;
  if (templateId && workspace.visible(templateId)) {
    id = newId();
    await apply([{ type: 'template.instantiate', id: templateId, newId: id, title: '', sourceId }]);
  } else {
    const { api } = await import('../data/api');
    const { valuesForNewRow } = await import('../database/shared');
    const result = viewId && workspace.visible(viewId) ? await api<QueryResult>('/api/query', { viewId, limit: 1 }).catch(() => null) : null;
    id = await createRow(sourceId, { values: valuesForNewRow(result), open: false });
  }
  if (openAs === 'page') navigate(id); else openPeek(id, openAs);
}

// Archived pages (보관됨) are kept out of the tree; links and search (보관된 페이지 포함) still reach them.
function treeChildren(parentId: string | null): Entity[] {
  return workspace.children(parentId).filter(item => (item.kind === 'page' && !(item as PageEntity).sourceId && !(item as PageEntity).archived) || item.kind === 'source' || (item.kind === 'view' && parentId !== null && workspace.get(parentId)?.kind === 'source'));
}

// Items shown under a tree row: sub pages, databases on the page, and for a database its views.
function rowChildren(item: Entity): Entity[] {
  if (item.kind === 'source') return workspace.viewsOf(item.id, item.parentId);
  // A "페이지 링크" block right on the page shows under it too (with an arrow), as a link to page does.
  if (item.kind === 'page') return workspace.children(item.id).filter(child => (child.kind === 'page' && !(child as PageEntity).sourceId && !(child as PageEntity).archived) || child.kind === 'source' || (child.kind === 'block' && (child as BlockEntity).blockType === 'link_to_page' && !!(child as BlockEntity).richText?.[0]?.pageId));
  return [];
}

type DragStart = (event: ReactPointerEvent, item: Entity) => void;

// Rows indent 8px per level (text at 46, 54, 62). Each section keeps its own open/closed
// state, so a page can be open under "최근" and closed under "개인 페이지".
function LinkedRow({ block, depth }: { block: BlockEntity; depth: number }) {
  const target = workspace.get<PageEntity>(block.richText?.[0]?.pageId);
  if (!target || !workspace.visible(target.id)) return null;
  return (
    <div className="sidebar-row sidebar-linked-row" style={{ paddingLeft: 8 + depth * 8 }} role="treeitem" data-tree-id={block.id} data-tree-kind="block" data-tree-depth={depth}>
      <a href={hrefFor(target.id)} className="sidebar-row-link" draggable={false} onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); navigate(target.id); }}>
        <span className="sidebar-row-icon"><span className="sidebar-icon-default"><EntityIcon item={target} size={20} /><span className="link-arrow" aria-hidden="true"><Icon name="arrow-up-right" size={10} /></span></span></span>
        <span className="sidebar-row-label">{target.title || t("새 페이지")}</span>
      </a>
    </div>
  );
}

function Row({ item, depth, expanded, toggle, active, onMenu, onDragStart, scope = '' }: { item: Entity; depth: number; expanded: Set<string>; toggle: (id: string) => void; active: string | null; onMenu: (event: MouseEvent, item: Entity, scope: string) => void; onDragStart?: DragStart; scope?: string }) {
  if (item.kind === 'block') return <LinkedRow block={item as BlockEntity} depth={depth} />;
  const children = rowChildren(item).filter(child => workspace.visible(child.id));
  const key = scope ? `${scope}:${item.id}` : item.id;
  const open = expanded.has(key);
  const name = workspace.title(item) || (item.kind === 'page' ? t("새 페이지") : t("제목 없음"));
  return (
    <>
      <div className={`sidebar-row${active === item.id ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 8 }} role="treeitem" aria-expanded={item.kind === 'view' ? undefined : open} aria-selected={active === item.id}
        data-tree-id={item.id} data-tree-kind={item.kind} data-tree-depth={depth} onPointerDown={onDragStart ? event => onDragStart(event, item) : undefined}
        onContextMenu={item.kind !== 'view' ? event => onMenu(event, item, scope) : undefined}>
        <a href={hrefFor(item.id)} className="sidebar-row-link" draggable={false} onClick={event => {
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          // ⌥-click opens the page in the side peek (listed in the row menu as "⌥Click").
          if (event.altKey && item.kind === 'page') openPeek(item.id, 'side'); else navigate(item.id);
        }}>
          <span className="sidebar-row-icon">
            <span className="sidebar-icon-default"><EntityIcon item={item} size={20} /></span>
            {item.kind !== 'view' ? (
              <button type="button" className="sidebar-toggle" aria-label={open ? t("접기") : t("펼치기")} onClick={event => { event.preventDefault(); event.stopPropagation(); toggle(key); }}>
                <Icon name="chevron-right" size={12} className={open ? 'rotated' : ''} />
              </button>
            ) : null}
          </span>
          <span className="sidebar-row-label">{name}</span>
        </a>
        {item.kind !== 'view' ? (
          <span className="sidebar-row-actions">
            {item.kind === 'page' ? <button type="button" className="icon-button tiny" aria-label={t("하위 페이지 추가")} onClick={event => { event.stopPropagation(); if (!expanded.has(key)) toggle(key); createPage({ parentId: item.id, open: 'center' }).catch(report); }}><Icon name="plus" size={16} /></button> : null}
            <button type="button" className="icon-button tiny" aria-label={t("삭제, 복제 등")} onClick={event => onMenu(event, item, scope)}><Icon name="more" size={16} /></button>
          </span>
        ) : null}
      </div>
      {open ? (children.length ? children.map(child => <Row key={child.id} item={child} depth={depth + 1} expanded={expanded} toggle={toggle} active={active} onMenu={onMenu} onDragStart={onDragStart} scope={scope} />)
        : <div className="sidebar-empty" style={{ paddingLeft: 8 + (depth + 1) * 8 + 30 }}>{item.kind === 'source' ? t("보기 없음") : t("하위 페이지 없음")}</div>) : null}
    </>
  );
}

// A database view added with "보기를 사이드바에 추가": "<보기> · <DB>" heading with
// ↗ (데이터베이스 열기) · + (새 페이지) · … on hover, then the view's first rows (5 by default), each
// opened the way the section says (side peek by default).
function ViewSectionBlock({ section, flash, active, onToggle, onMenu }: { section: SectionConfig; flash: boolean; active: string | null; onToggle: () => void; onMenu: (anchor: Element) => void }) {
  const config = section.view!;
  const live = workspace.visible(config.viewId);
  const { result } = useQuery(live && !section.collapsed ? { viewId: config.viewId, limit: section.count + 1 } : null);
  const rows = (result?.rows ?? []).map(row => workspace.get<PageEntity>(row.id)).filter((page): page is PageEntity => !!page);
  const label = viewSectionLabel(config);
  const openAs = config.openAs ?? 'side';
  const open = (id: string) => { if (openAs === 'page') navigate(id); else openPeek(id, openAs); };
  return (
    <section className={`sidebar-group sidebar-section sidebar-view-section${flash ? ' just-added' : ''}`} data-sidebar-section={section.id}>
      <div className="sidebar-section-head" role="button" tabIndex={0} aria-expanded={!section.collapsed} onClick={onToggle}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); } }}>
        <span className="sidebar-section-label">{label}</span>
        <Icon name="chevron-down" size={12} className={`section-chevron${section.collapsed ? ' closed' : ''}`} />
        <span className="sidebar-head-space" />
        <span className="sidebar-section-actions" onClick={event => event.stopPropagation()}>
          <button type="button" className="icon-button tiny" aria-label={t("데이터베이스 열기")} title={t("데이터베이스 열기")} onClick={() => { if (live) navigate(config.viewId); }}><Icon name="arrow-up-right" size={16} /></button>
          <button type="button" className="icon-button tiny" aria-label={t("새 페이지")} title={t("새 페이지")} onClick={() => createFromShortcut(config.sourceId, config.viewId, config.templateId, openAs).catch(report)}><Icon name="plus" size={16} /></button>
          <button type="button" className="icon-button tiny" aria-label={t("메뉴 열기")} title={t("메뉴 열기")} onClick={event => onMenu(event.currentTarget)}><Icon name="more" size={16} /></button>
        </span>
      </div>
      {!section.collapsed ? (
        <div role="tree" aria-label={label}>
          {rows.slice(0, section.count).map(page => (
            <div key={page.id} className={`sidebar-row${active === page.id ? ' selected' : ''}`} role="treeitem" aria-selected={active === page.id} style={{ paddingLeft: 8 }} data-tree-id={page.id} data-tree-kind="page">
              <a href={hrefFor(page.id)} className="sidebar-row-link" draggable={false} onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); open(page.id); }}>
                {config.icons !== false ? <span className="sidebar-row-icon"><span className="sidebar-icon-default"><EntityIcon item={page} size={20} /></span></span> : null}
                <span className="sidebar-row-label">{page.title || t("새 페이지")}</span>
              </a>
            </div>
          ))}
          {rows.length > section.count ? (
            <button type="button" className="sidebar-row sidebar-more" onClick={() => navigate(config.viewId)}><span className="sidebar-row-icon"><Icon name="more" size={16} /></span><span className="sidebar-row-label">{t("모두 보기")}</span></button>
          ) : null}
          {!live ? <div className="sidebar-empty" style={{ paddingLeft: 38 }}>{t("보기 없음")}</div> : result && !rows.length ? <div className="sidebar-empty" style={{ paddingLeft: 38 }}>{t("페이지 없음")}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

export function Sidebar({ open, onClose, onSearch, floating = 'off', onFloatHover }: { open: boolean; onClose: () => void; onSearch: () => void; floating?: 'off' | 'in' | 'out'; onFloatHover?: (inside: boolean) => void }) {
  const ws = useWorkspace();
  const route = useRoute();
  const identity = useWorkspaceIdentity();
  const workspaceName = identity.name;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readLocal<string[]>(expandedKey, [])));
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const setLayout = (next: Layout) => { setLayoutState(next); saveLayout(next); };
  const [tabs, setTabs] = useState(loadTabs);
  // Shortcuts and view sections added from a database land here; the new one is marked briefly.
  const [flash, setFlash] = useState('');
  useEffect(() => {
    const reload = () => {
      setLayoutState(loadLayout());
      setTabs(loadTabs());
      const added = takeJustAdded();
      if (added) { setFlash(added); window.setTimeout(() => setFlash(current => (current === added ? '' : current)), 1600); }
    };
    window.addEventListener(layoutEvent, reload);
    return () => window.removeEventListener(layoutEvent, reload);
  }, []);
  const updateSection = (id: string, patch: Partial<SectionConfig>) => setLayout({ ...layout, sections: layout.sections.map(section => (section.id === id ? { ...section, ...patch } : section)) });
  const updateView = (id: string, patch: Partial<ViewSectionConfig>) => setLayout({ ...layout, sections: layout.sections.map(section => (section.id === id && section.view ? { ...section, view: { ...section.view, ...patch } } : section)) });
  const removeSection = (id: string) => setLayout({ ...layout, sections: isBuiltin(id) ? layout.sections.map(section => (section.id === id ? { ...section, hidden: true } : section)) : layout.sections.filter(section => section.id !== id) });
  const shortcuts = (layout.shortcuts ?? []).filter(item => workspace.visible(item.sourceId));
  // The rows above the sections — 홈 · 내 작업 · 라이브러리, page shortcuts and new-page shortcuts — in the order set
  // by dragging them in 사이드바 사용자 지정 (sidebar tab shortcuts).
  const links = (layout.links ?? []).filter(item => workspace.visible(item.pageId));
  const topIds = [
    ...(layout.homePage !== false ? ['home'] : []), ...(layout.myTasks !== false ? ['tasks'] : []), ...(layout.library ? ['library'] : []),
    ...links.map(item => item.id), ...shortcuts.map(item => item.id),
  ].map((id, index) => ({ id, rank: (layout.order?.indexOf(id) ?? -1) >= 0 ? layout.order!.indexOf(id) : 1000 + index })).sort((a, b) => a.rank - b.rank).map(item => item.id);
  const removeLink = (id: string) => setLayout({ ...layout, links: (layout.links ?? []).filter(item => item.id !== id) });
  const updateShortcut = (id: string, patch: Partial<PageShortcut>) => setLayout({ ...layout, shortcuts: (layout.shortcuts ?? []).map(item => (item.id === id ? { ...item, ...patch } : item)) });
  const moveShortcutUp = (id: string) => {
    const list = [...(layout.shortcuts ?? [])], at = list.findIndex(item => item.id === id);
    if (at <= 0) return;
    [list[at - 1], list[at]] = [list[at], list[at - 1]];
    setLayout({ ...layout, shortcuts: list });
  };
  const [shortcutMenu, setShortcutMenu] = useState<{ anchor: Element; id: string } | null>(null);
  const [shortcutRename, setShortcutRename] = useState<{ anchor: Anchor; id: string; section: boolean } | null>(null);
  const moveSection = (id: string, by: number) => {
    const shown = layout.sections.filter(section => !section.hidden);
    const at = shown.findIndex(section => section.id === id), to = at + by;
    if (at < 0 || to < 0 || to >= shown.length) return;
    const order = [...shown]; [order[at], order[to]] = [order[to], order[at]];
    setLayout({ ...layout, sections: [...order, ...layout.sections.filter(section => section.hidden)] });
  };
  const [customizing, setCustomizing] = useState(false);
  const [sectionMenu, setSectionMenu] = useState<{ anchor: Element; id: string; compact: boolean } | null>(null);
  const [moreMenu, setMoreMenu] = useState<Element | null>(null);
  const [helpMenu, setHelpMenu] = useState<Element | null>(null);
  const [addMenu, setAddMenu] = useState<{ anchor: Element; kind: 'shortcut' | 'section' } | null>(null);
  const [orderDrop, setOrderDrop] = useState<{ key: string; top: number; left: number; width: number; group?: 'top' } | null>(null);
  const [linkPicker, setLinkPicker] = useState<Element | null>(null);
  const fadingOrderDrops = useFadeList(orderDrop, entry => entry.key);
  const [menu, setMenu] = useState<{ anchor: Anchor; owner: Element | null; item: Entity; pointer: boolean; scope: string; row: Element | null } | null>(null);
  const [rename, setRename] = useState<{ anchor: Anchor; item: PageEntity } | null>(null);
  const [renameIcon, setRenameIcon] = useState<{ anchor: Element; item: PageEntity } | null>(null);
  const [tabMenu, setTabMenu] = useState<Element | null>(null);
  const [tabRename, setTabRename] = useState<Element | null>(null);
  const [tabIcon, setTabIcon] = useState<Element | null>(null);
  // "…" opens the menu under the button; a right-click opens it at the pointer (fading in).
  const openItemMenu = (event: MouseEvent, target: Entity, scope: string) => {
    event.preventDefault(); event.stopPropagation();
    const pointer = event.type === 'contextmenu';
    const row = (event.currentTarget as Element).closest('.sidebar-row');
    // From "…" it opens at the pointer's x, 15px above the row.
    const top = (row ?? event.currentTarget as Element).getBoundingClientRect().top - 16;
    setMenu({ anchor: pointer ? { x: event.clientX, y: event.clientY } : { x: event.clientX, y: top }, owner: pointer ? null : event.currentTarget as Element, item: target, pointer, scope, row });
  };
  const [workspaceMenu, setWorkspaceMenu] = useState<Element | null>(null);
  const [desktopApp, setDesktopApp] = useState(false);
  useEffect(() => { isDesktopApp().then(setDesktopApp); }, []);
  const workspaces = useWorkspaceList(!!workspaceMenu);
  const [drop, setDrop] = useState<{ key: string; top: number; left: number; width: number; height: number; inside: boolean } | null>(null);
  const fadingDrops = useFadeList(drop, entry => entry.key);
  const suppressClick = useRef(false);
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    storeLocal(expandedKey, JSON.stringify([...next]));
    return next;
  });
  const active = route.id;
  const scrollerRef = useRef<HTMLDivElement>(null);
  // After back/forward the sidebar scrolls so the page is in view. A click in the sidebar
  // itself — e.g. on "최근" — never scrolls it, even though the same page is also marked in the
  // tree below (every place a page appears is marked).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !active || !arrivedByHistory()) return;
    const frame = requestAnimationFrame(() => {
      const view = scroller.getBoundingClientRect();
      const marked = [...scroller.querySelectorAll<HTMLElement>('.sidebar-row.selected')];
      // Already in view somewhere (e.g. in "최근"): leave the sidebar where it is.
      if (marked.some(element => { const box = element.getBoundingClientRect(); return box.top >= view.top && box.bottom <= view.bottom; })) return;
      const row = scroller.querySelector<HTMLElement>(`[role=tree] .sidebar-row.selected`) ?? marked[0];
      if (!row) return;
      const box = row.getBoundingClientRect();
      if (box.top < view.top) scroller.scrollTop -= view.top - box.top;
      else if (box.bottom > view.bottom) scroller.scrollTop += box.bottom - view.bottom;
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const favorites = ws.favorites().map(id => ws.get(id)!).filter(Boolean);
  // "최근" keeps the order it had when the app opened: visiting a page records it for next time
  // but does not reorder or grow the list under the pointer.
  const [recentSnapshot, setRecentSnapshot] = useState(() => recentIds());
  const forgetRecent = (id: string) => {
    const next = recentIds().filter(item => item !== id);
    storeLocal(recentKey, JSON.stringify(next));
    setRecentSnapshot(current => current.filter(item => item !== id));
  };
  const recent = recentSnapshot.filter(id => ws.visible(id) && !(ws.get<PageEntity>(id)?.template)).map(id => ws.get(id)!).filter(item => item && ['page', 'source', 'view'].includes(item.kind));
  // 개인 페이지: manual order, or by last edit (Sort › Last edited; dragging to reorder is then off).
  const privateSort = layout.sections.find(section => section.id === 'private')?.sort ?? 'manual';
  const manualRoots = treeChildren(null).filter(item => ws.visible(item.id));
  const roots = privateSort === 'edited' ? [...manualRoots].sort((a, b) => String((b as PageEntity).updatedAt ?? '').localeCompare(String((a as PageEntity).updatedAt ?? ''))) : manualRoots;
  const unread = ws.snapshot.objects.filter(item => item.kind === 'notification' && !(item as { read?: boolean }).read && ws.visible(item.id)).length;

  // Drag a page in the tree: top/bottom quarter of a row = reorder (blue line across the row),
  // middle = nest inside (row filled light blue). Pages only (node.move covers pages). Like the
  // original, the row stays put while a 40% copy follows the pointer, and the marks fade in/out.
  const [treeDragging, setTreeDragging] = useState(false);
  const [trashOver, setTrashOver] = useState(false);
  const startDrag: DragStart = (event, item) => {
    if (event.button !== 0 || item.kind !== 'page' || (event.target as Element).closest('button')) return;
    const startX = event.clientX, startY = event.clientY;
    const rowElement = event.currentTarget as HTMLElement;
    let ghost: DragGhost | null = null;
    // favorite: a place in 즐겨찾기 (dropping there adds the page to the favorites, or reorders them; the page stays put).
    let target: { id: string; mode: 'before' | 'after' | 'inside'; favorite?: boolean } | null = null;
    const descendants = new Set<string>();
    const collect = (id: string) => { for (const child of workspace.children(id)) { descendants.add(child.id); collect(child.id); } };
    collect(item.id);
    let overTrash = false;
    const onMove = (e: PointerEvent) => {
      if (!ghost) {
        if (!pastThreshold(e.clientX - startX, e.clientY - startY)) return;
        ghost = createDragGhost([rowElement], startX, startY);
        document.body.classList.add('dragging-tree');
        setTreeDragging(true);
      }
      ghost.move(e.clientX, e.clientY);
      last = { x: e.clientX, y: e.clientY };
      locate(e.clientX, e.clientY);
      auto.update(e.clientX, e.clientY);
    };
    // Near the top or bottom of the sidebar it scrolls along.
    let last = { x: startX, y: startY };
    const auto = edgeScroller(scrollerRef.current, () => { if (ghost) locate(last.x, last.y); });
    const locate = (cx: number, cy: number) => {
      // Over the trash drop (shown at the bottom while dragging): the page goes to the trash.
      const trash = (document.elementFromPoint(cx, cy) as Element | null)?.closest('.sidebar-trash-drop');
      if (trash !== null && trash !== undefined) { overTrash = true; setTrashOver(true); target = null; setDrop(null); return; }
      if (overTrash) { overTrash = false; setTrashOver(false); }
      const under = document.elementFromPoint(cx, cy) as Element | null;
      const favoritesSection = under?.closest<HTMLElement>('.sidebar-scroller [data-builtin-section="favorites"]');
      if (favoritesSection) {
        const scrollerElement = favoritesSection.closest('.sidebar-scroller') as HTMLElement;
        const box = scrollerElement.getBoundingClientRect();
        const origin = { top: box.top - scrollerElement.scrollTop, left: box.left };
        const favoriteRow = under?.closest<HTMLElement>('.sidebar-row[data-tree-id][data-tree-depth="0"]');
        if (favoriteRow?.dataset.treeId === item.id) { target = null; setDrop(null); return; }
        if (favoriteRow && favoritesSection.contains(favoriteRow) && favoriteRow.dataset.treeId) {
          const rect = favoriteRow.getBoundingClientRect(), mode = (cy - rect.top) / rect.height < 0.5 ? 'before' : 'after';
          target = { id: favoriteRow.dataset.treeId, mode, favorite: true };
          setDrop({ key: `fav:${favoriteRow.dataset.treeId}:${mode}`, top: (mode === 'before' ? rect.top - 1 : rect.bottom) - origin.top, left: rect.left - origin.left, width: rect.width, height: 4, inside: false });
        } else {
          const head = favoritesSection.querySelector<HTMLElement>('.sidebar-section-head') ?? favoritesSection, rect = head.getBoundingClientRect();
          target = { id: '', mode: 'inside', favorite: true };
          setDrop({ key: 'fav:end', top: rect.top - origin.top, left: rect.left - origin.left, width: rect.width, height: rect.height, inside: true });
        }
        return;
      }
      if (privateSort === 'edited') { target = null; setDrop(null); return; }
      const row = (document.elementFromPoint(cx, cy) as Element | null)?.closest<HTMLElement>('.sidebar-scroller [data-section="private"] .sidebar-row[data-tree-id]');
      const id = row?.dataset.treeId;
      if (!row || !id || id === item.id || descendants.has(id) || row.dataset.treeKind === 'view') { target = null; setDrop(null); return; }
      const rect = row.getBoundingClientRect();
      const scrollerElement = row.closest('.sidebar-scroller') as HTMLElement;
      const box = scrollerElement.getBoundingClientRect();
      const scroller = { top: box.top - scrollerElement.scrollTop, left: box.left };
      const ratio = (cy - rect.top) / rect.height;
      const kind = row.dataset.treeKind;
      const mode: 'before' | 'after' | 'inside' = kind === 'page' && ratio > 0.25 && ratio < 0.75 ? 'inside' : ratio < 0.5 ? 'before' : 'after';
      // No line at the top of the row right below the dragged one (nothing would
      // move); the line under the row above it is still shown.
      const siblings = workspace.children(workspace.get(id)?.parentId ?? null).map(child => child.id);
      const own = siblings.indexOf(item.id), there = siblings.indexOf(id);
      if (own >= 0 && there >= 0 && mode === 'before' && there === own + 1) { target = null; setDrop(null); return; }
      target = { id, mode };
      setDrop(mode === 'inside'
        ? { key: `${id}:inside`, top: rect.top - scroller.top, left: rect.left - scroller.left, width: rect.width, height: rect.height, inside: true }
        : { key: `${id}:${mode}`, top: (mode === 'before' ? rect.top - 1 : rect.bottom) - scroller.top, left: rect.left - scroller.left, width: rect.width, height: 4, inside: false });
    };
    const onUp = () => {
      auto.stop();
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('dragging-tree');
      const dragged = !!ghost;
      ghost?.remove();
      setDrop(null);
      setTreeDragging(false); setTrashOver(false);
      if (!dragged) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (overTrash) { trashNode(item.id).then(() => { if (route.id === item.id) navigate(null); }).catch(report); return; }
      if (!target) return;
      if (target.favorite) {
        const favorites = workspace.favorites().filter(id => id !== item.id);
        const at = target.id ? favorites.indexOf(target.id) + (target.mode === 'after' ? 1 : 0) : favorites.length;
        favorites.splice(Math.max(0, at), 0, item.id);
        apply([{ type: 'navigation.set', favorites }]).catch(report);
        return;
      }
      const dest = workspace.get(target.id);
      if (!dest) return;
      let op: { type: 'node.move'; id: string; parentId: string | null; beforeId?: string };
      if (target.mode === 'inside') {
        op = { type: 'node.move', id: item.id, parentId: dest.id };
        if (!expanded.has(dest.id)) toggle(dest.id);
      } else {
        const parentId = dest.parentId ?? null;
        const siblings = workspace.children(parentId).filter(child => child.id !== item.id);
        const index = siblings.findIndex(child => child.id === dest.id);
        const beforeId = target.mode === 'before' ? dest.id : siblings[index + 1]?.id;
        op = { type: 'node.move', id: item.id, parentId, ...(beforeId ? { beforeId } : {}) };
      }
      apply([op]).catch(report);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Customize mode: sections are reordered by dragging their rows (copy + line like everywhere else).
  // Dragging a row above the sections (사이드바 사용자 지정) to another place among them.
  const startTopDrag = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    const row = event.currentTarget as HTMLElement;
    const startX = event.clientX, startY = event.clientY;
    let ghost: DragGhost | null = null;
    let at = -1;
    const onMove = (moveEvent: PointerEvent) => {
      if (!ghost) {
        if (!pastThreshold(moveEvent.clientX - startX, moveEvent.clientY - startY)) return;
        ghost = createDragGhost([row], startX, startY);
        document.body.classList.add('dragging-tree');
      }
      ghost.move(moveEvent.clientX, moveEvent.clientY);
      const group = row.parentElement!;
      const rows = [...group.querySelectorAll<HTMLElement>('[data-top-id]')];
      const index = rows.findIndex(element => { const box = element.getBoundingClientRect(); return moveEvent.clientY < box.top + box.height / 2; });
      at = index < 0 ? rows.length : index;
      const own = rows.findIndex(element => element.dataset.topId === id);
      if (at === own || at === own + 1) { setOrderDrop(null); return; }
      const groupBox = group.getBoundingClientRect();
      const reference = rows[Math.min(at, rows.length - 1)].getBoundingClientRect();
      setOrderDrop({ key: `top-${at}`, top: (at < rows.length ? reference.top - 1 : reference.bottom) - groupBox.top, left: reference.left - groupBox.left, width: reference.width, group: 'top' });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('dragging-tree');
      const dragged = !!ghost;
      ghost?.remove();
      setOrderDrop(null);
      if (!dragged || at < 0) return;
      const own = topIds.indexOf(id);
      if (own < 0 || at === own || at === own + 1) return;
      const order = topIds.filter(item => item !== id);
      order.splice(at > own ? at - 1 : at, 0, id);
      setLayout({ ...layout, order });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const startSectionDrag = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    const row = event.currentTarget as HTMLElement;
    const startX = event.clientX, startY = event.clientY;
    let ghost: DragGhost | null = null;
    let at = -1;
    const onMove = (moveEvent: PointerEvent) => {
      if (!ghost) {
        if (!pastThreshold(moveEvent.clientX - startX, moveEvent.clientY - startY)) return;
        ghost = createDragGhost([row], startX, startY);
        document.body.classList.add('dragging-tree');
      }
      ghost.move(moveEvent.clientX, moveEvent.clientY);
      const group = row.parentElement!;
      const rows = [...group.querySelectorAll<HTMLElement>('[data-section-id]')];
      const index = rows.findIndex(element => { const box = element.getBoundingClientRect(); return moveEvent.clientY < box.top + box.height / 2; });
      at = index < 0 ? rows.length : index;
      const own = rows.findIndex(element => element.dataset.sectionId === id);
      if (at === own || at === own + 1) { setOrderDrop(null); return; }
      const groupBox = group.getBoundingClientRect();
      const reference = rows[Math.min(at, rows.length - 1)].getBoundingClientRect();
      setOrderDrop({ key: String(at), top: (at < rows.length ? reference.top - 1 : reference.bottom) - groupBox.top, left: reference.left - groupBox.left, width: reference.width });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('dragging-tree');
      const dragged = !!ghost;
      ghost?.remove();
      setOrderDrop(null);
      if (!dragged || at < 0) return;
      const shown = layout.sections.filter(section => !section.hidden);
      const own = shown.findIndex(section => section.id === id);
      if (at === own || at === own + 1) return;
      const order = shown.filter(section => section.id !== id);
      order.splice(at > own ? at - 1 : at, 0, shown[own]);
      setLayout({ ...layout, sections: [...order, ...layout.sections.filter(section => section.hidden)] });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Section "…" (and the sliders button in customize mode): how many items, move up/down, remove.
  const sectionEntries = (id: string, compact: boolean): MenuEntry[] => {
    const shown = layout.sections.filter(section => !section.hidden);
    const at = shown.findIndex(section => section.id === id);
    const section = shown[at];
    if (section?.view) return viewSectionEntries(section, at, shown.length, compact);
    return [
      { label: t("표시"), icon: 'hash', right: <span className="menu-value">{section?.count ?? 5}</span>, submenu: () => [5, 10, 15, 20, 50].map(count => ({ label: t("{0}개 항목", [count]), checked: section?.count === count, onSelect: () => updateSection(id, { count }) })) },
      ...(id === 'private' ? [{ label: t("정렬"), icon: 'sort', right: <span className="menu-value">{section?.sort === 'edited' ? t("최종 편집") : t("수동")}</span>, submenu: () => (['manual', 'edited'] as const).map(sort => ({ label: sort === 'edited' ? t("최종 편집") : t("수동"), checked: (section?.sort ?? 'manual') === sort, onSelect: () => updateSection(id, { sort }) })) } as MenuEntry] : []),
      { kind: 'separator' },
      { label: t("위로"), icon: 'arrow-up', disabled: at <= 0, onSelect: () => moveSection(id, -1) },
      { label: t("아래로"), icon: 'arrow-down', disabled: at < 0 || at >= shown.length - 1, onSelect: () => moveSection(id, 1) },
      ...(compact ? [] : [
        { kind: 'separator' } as MenuEntry,
        { label: t("섹션 삭제"), icon: 'close', onSelect: () => removeSection(id) } as MenuEntry,
        { label: t("사이드바 사용자 지정"), icon: 'sliders', onSelect: () => setCustomizing(true) } as MenuEntry,
      ]),
    ];
  };

  // Templates a database's new pages can start from ("비어 있음" = none).
  const templateEntries = (sourceId: string, current: string | null | undefined, pick: (id: string | null) => void): MenuEntry[] => [
    { label: t("비어 있음"), icon: 'page', checked: !current, onSelect: () => pick(null) },
    ...ws.snapshot.objects.filter(item => item.kind === 'page' && (item as PageEntity).template && (item as PageEntity).sourceId === sourceId && ws.visible(item.id))
      .map(item => ({ label: (item as PageEntity).title || t("새 템플릿"), icon: <EntityIcon item={item} size={18} />, checked: current === item.id, onSelect: () => pick(item.id) }) as MenuEntry),
  ];
  const templateName = (id: string | null | undefined) => (id && ws.visible(id) ? ws.get<PageEntity>(id)?.title || t("새 템플릿") : t("비어 있음"));
  const openEntries = (current: OpenAs, pick: (mode: OpenAs) => void): MenuEntry[] => (['side', 'center', 'page'] as OpenAs[]).map(mode => ({ label: openLabels[mode], icon: mode === 'side' ? 'peek-side' : mode === 'center' ? 'peek-center' : 'peek-full', checked: current === mode, onSelect: () => pick(mode) }));
  const sourceViews = (sourceId: string) => ws.viewsOf(sourceId, ws.get<SourceEntity>(sourceId)?.parentId ?? undefined);

  // A view section's "…" (220 wide): 이름 바꾸기 · 표시 형식 › · 표시 › · 페이지 아이콘 표시 ·
  // 소스 · 보기 › · 템플릿 › | 위로 · 섹션 삭제 | 사이드바 사용자 지정.
  const viewSectionEntries = (section: SectionConfig, at: number, _count: number, compact: boolean): MenuEntry[] => {
    const config = section.view!;
    const source = ws.get(config.sourceId);
    const view = ws.get<ViewEntity>(config.viewId);
    return [
      { label: t("이름 바꾸기"), icon: 'pencil', onSelect: () => { const head = document.querySelector(`[data-sidebar-section="${section.id}"]`); const box = head?.getBoundingClientRect(); setShortcutRename({ anchor: box ? { x: box.left, y: box.bottom + 4 } : { x: 20, y: 200 }, id: section.id, section: true }); } },
      { label: t("표시 형식:"), icon: 'peek-side', hint: openLabels[config.openAs ?? 'side'], submenuWidth: 220, submenu: () => openEntries(config.openAs ?? 'side', mode => updateView(section.id, { openAs: mode })) },
      { label: t("표시"), icon: 'hash', hint: String(section.count), submenuWidth: 220, submenu: () => [5, 10, 15, 20].map(n => ({ label: String(n), checked: section.count === n, onSelect: () => updateSection(section.id, { count: n }) })) },
      { label: t("페이지 아이콘 표시"), icon: 'emoji', keepOpen: true, right: <Switch checked={config.icons !== false} onChange={value => updateView(section.id, { icons: value })} label={t("페이지 아이콘 표시")} />, onSelect: () => updateView(section.id, { icons: config.icons === false }) },
      { label: t("소스"), icon: 'swap', hint: source ? ws.title(source) || t("제목 없음") : '' , disabled: true },
      { label: t("sidebar|보기"), icon: view ? viewIconName(view) : 'table', hint: view?.name ?? '', submenuWidth: 240, submenu: () => sourceViews(config.sourceId).map(item => ({ label: item.name || t("제목 없음"), icon: viewIconName(item), checked: item.id === config.viewId, onSelect: () => updateView(section.id, { viewId: item.id }) })) },
      { label: t("템플릿"), icon: 'template', hint: templateName(config.templateId), submenuWidth: 240, submenu: () => templateEntries(config.sourceId, config.templateId, id => updateView(section.id, { templateId: id })) },
      { kind: 'separator' },
      { label: t("위로"), icon: 'arrow-up', disabled: at <= 0, onSelect: () => moveSection(section.id, -1) },
      ...(compact ? [] : [
        { label: t("섹션 삭제"), icon: 'close', onSelect: () => removeSection(section.id) } as MenuEntry,
        { kind: 'separator' } as MenuEntry,
        { label: t("사이드바 사용자 지정"), icon: 'sliders', onSelect: () => setCustomizing(true) } as MenuEntry,
      ]),
    ];
  };

  // A "새 페이지" shortcut's "…" (240 wide): 바로가기 이름 바꾸기 · 표시 형식 › ·
  // <DB> 열기 · 템플릿 › · 보기에 추가 › | 위로 · 바로가기 삭제 | 사이드바 사용자 지정.
  const shortcutEntries = (shortcut: PageShortcut, row: Element | null): MenuEntry[] => {
    const source = ws.get(shortcut.sourceId);
    const view = shortcut.viewId ? ws.get<ViewEntity>(shortcut.viewId) : undefined;
    const list = layout.shortcuts ?? [];
    return [
      { label: t("바로가기 이름 바꾸기"), icon: 'pencil', onSelect: () => { const box = (row ?? document.body).getBoundingClientRect(); setShortcutRename({ anchor: { x: box.left, y: box.bottom + 4 }, id: shortcut.id, section: false }); } },
      { label: t("표시 형식:"), icon: 'peek-full', hint: openLabels[shortcut.openAs ?? 'page'], submenuWidth: 220, submenu: () => openEntries(shortcut.openAs ?? 'page', mode => updateShortcut(shortcut.id, { openAs: mode })) },
      { label: t("{0} 열기", [source ? ws.title(source) || t("제목 없음") : t("제목 없음")]), icon: 'database', onSelect: () => navigate(shortcut.viewId && ws.visible(shortcut.viewId) ? shortcut.viewId : ws.get<SourceEntity>(shortcut.sourceId)?.parentId ?? shortcut.sourceId) },
      { label: t("템플릿"), icon: 'template', hint: templateName(shortcut.templateId), submenuWidth: 240, submenu: () => templateEntries(shortcut.sourceId, shortcut.templateId, id => updateShortcut(shortcut.id, { templateId: id })) },
      { label: t("보기에 추가"), icon: view ? viewIconName(view) : 'table', hint: view?.name ?? '', submenuWidth: 240, submenu: () => sourceViews(shortcut.sourceId).map(item => ({ label: item.name || t("제목 없음"), icon: viewIconName(item), checked: item.id === shortcut.viewId, onSelect: () => updateShortcut(shortcut.id, { viewId: item.id }) })) },
      { kind: 'separator' },
      { label: t("위로"), icon: 'arrow-up', disabled: list.findIndex(item => item.id === shortcut.id) <= 0, onSelect: () => moveShortcutUp(shortcut.id) },
      { label: t("바로가기 삭제"), icon: 'close', onSelect: () => setLayout({ ...layout, shortcuts: list.filter(item => item.id !== shortcut.id) }) },
      { kind: 'separator' },
      { label: t("사이드바 사용자 지정"), icon: 'sliders', onSelect: () => setCustomizing(true) },
    ];
  };

  // A row's "…" menu (and right-click): "페이지" heading, favourite, remove from 최근 (in that
  // section), link / duplicate / rename / move / trash, then open in a new tab or the side peek.
  const itemMenu = (item: Entity, scope: string, row: Element | null): MenuEntry[] => {
    const starred = ws.favorites().includes(item.id);
    const page = item.kind === 'page' ? item as PageEntity : null;
    return [
      { kind: 'section', label: item.kind === 'page' ? t("페이지") : t("데이터베이스") },
      { label: starred ? t("즐겨찾기에서 제거") : t("즐겨찾기에 추가"), icon: starred ? 'star-filled' : 'star', onSelect: () => toggleFavorite(item.id).catch(report) },
      ...(scope === 'recent' ? [{ label: t("최근 항목에서 제거"), icon: 'eye-off', onSelect: () => forgetRecent(item.id) } as MenuEntry] : []),
      { kind: 'separator' },
      { label: t("링크 복사"), icon: 'link', onSelect: () => navigator.clipboard.writeText(new URL(hrefFor(item.id), location.href).href).catch(report) },
      ...(page ? [
        { label: t("복제"), icon: 'duplicate', shortcut: '⌘D', onSelect: () => { duplicatePage(page).catch(report); } } as MenuEntry,
        { label: t("이름 바꾸기"), icon: 'pencil', shortcut: '⌘⇧R', onSelect: () => {
          const box = (row ?? document.body).getBoundingClientRect();
          setRename({ anchor: { x: box.right + 1, y: box.bottom + 21 }, item: page });
        } } as MenuEntry,
        { label: t("다른 페이지로 옮기기"), icon: 'move', shortcut: '⌘⇧P', onSelect: () => openWorkspaceDialog('move', { id: item.id, anchor: document.querySelector(`.sidebar-row[data-tree-id="${CSS.escape(item.id)}"]`) ?? undefined, placement: 'below-start' }) } as MenuEntry,
      ] : []),
      { label: t("휴지통으로 이동"), icon: 'trash', onSelect: () => { trashNode(item.id).then(() => { if (route.id === item.id) navigate(null); }).catch(report); } },
      { kind: 'separator' },
      { label: t("새 탭에서 열기"), icon: 'arrow-up-right', shortcut: '⌘⇧↵', onSelect: () => { window.open(hrefFor(item.id), '_blank'); } },
      ...(page ? [{ label: t("사이드 보기로 열기"), icon: 'peek-side', shortcut: '⌥Click', onSelect: () => openPeek(item.id, 'side') } as MenuEntry] : []),
    ];
  };

  const home = layout.home ?? {};
  const activeTab = tabs.find(tab => tab.active)?.id ?? 'home';
  const tabLabel = (id: string, tab: HomeTab) => tab.label?.trim() || (id === 'home' ? t("홈") : t("탭 {0}", [tabs.findIndex(item => item.id === id) + 1]));
  const homeLabel = tabLabel(activeTab, home);
  // ⌃1 … ⌃6 open the sidebar's tabs; ⌃⇧1 … ⌃⇧9 open the workspaces on this computer, in the switcher's order.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && digit) {
        event.preventDefault();
        fetch('/api/workspaces').then(response => response.json()).then((data: { workspaces?: Array<{ url: string | null; current: boolean }> }) => {
          const target = data.workspaces?.[Number(digit) - 1];
          if (target?.url && !target.current) location.href = target.url;
        }).catch(() => {});
        return;
      }
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !/^[1-6]$/.test(event.key)) return;
      const tab = loadTabs()[Number(event.key) - 1];
      if (tab) { event.preventDefault(); selectTab(tab.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const setHome = (patch: HomeTab | null) => setLayout({ ...layout, home: patch === null ? {} : { ...home, ...patch } });
  // The tab's own menu (clicking the selected tab), 240 wide under the tab:
  // 이름 바꾸기 · 탭 삭제 | 홈 프리셋: 프리셋 관리 · 탭 초기화 | 탭 이름 숨기기 · 사이드바 사용자 지정.
  // Deleting the only tab and the workspace presets have nothing to act on here.
  const tabEntries: MenuEntry[] = [
    { label: t("이름 바꾸기"), icon: 'pencil', onSelect: () => setTabRename(tabMenu) },
    ...(activeTab !== 'home' ? [
      { label: t("왼쪽으로 옮기기"), icon: 'arrow-left', disabled: tabs.findIndex(tab => tab.id === activeTab) <= 1, onSelect: () => moveTab(activeTab, -1) } as MenuEntry,
      { label: t("오른쪽으로 옮기기"), icon: 'arrow-right', disabled: tabs.findIndex(tab => tab.id === activeTab) >= tabs.length - 1, onSelect: () => moveTab(activeTab, 1) } as MenuEntry,
      { label: t("탭 삭제"), icon: 'trash', onSelect: () => removeTab(activeTab) } as MenuEntry,
    ] : []),
    { kind: 'separator' },
    { kind: 'section', label: t("홈 프리셋") },
    { label: t("탭 초기화"), icon: 'undo', onSelect: () => setLayout(freshLayout()) },
    { kind: 'separator' },
    { label: home.hideLabel ? t("탭 이름 표시") : t("탭 이름 숨기기"), icon: home.hideLabel ? 'eye' : 'eye-off', onSelect: () => setHome({ hideLabel: !home.hideLabel }) },
    { label: t("사이드바 사용자 지정"), icon: 'sliders', onSelect: () => setCustomizing(true) },
  ];
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const tabIconOf = (id: string, tab: HomeTab) => tab.icon ? <span className="sidebar-tab-emoji">{tab.icon}</span> : <Icon name={id === 'home' ? 'home' : 'page'} />;
  const homeIcon = tabIconOf(activeTab, home);

  return (
    <nav className={`sidebar${open ? '' : ' closed'}${!open && floating !== 'off' ? ` floating floating-${floating}` : ''}`} aria-label={t("사이드바")}>
      {open ? <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label={t("사이드바 너비 조절")} title={t("끌어서 너비 조절, 클릭해 닫기")} onPointerDown={event => startSidebarResize(event, onClose)} /> : null}
      <div className="sidebar-inner" onPointerEnter={!open ? () => onFloatHover?.(true) : undefined} onPointerLeave={!open ? () => onFloatHover?.(false) : undefined}>
        <div className="sidebar-head">
          <button type="button" className="icon-button" aria-label={t("사이드바 닫기")} title={t("사이드바 닫기 (⌘\\)")} onClick={onClose}><Icon name="sidebar" /></button>
          <span className="sidebar-head-space" />
          <button type="button" className="icon-button" aria-label={t("받은 알림{0}", [unread ? t(" {0}개", [unread]) : ''])} title={t("받은 알림")} data-inbox-toggle onClick={() => toggleInbox()}>
            <Icon name="inbox" />{unread ? <span className="badge">{unread > 99 ? '99+' : unread}</span> : null}
          </button>
          <button type="button" className="icon-button" aria-label={t("새 페이지")} title={t("새로 만들기…")} aria-haspopup="menu" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setNewMenu({ x: rect.left - 6, y: rect.bottom + 4 }); }}><Icon name="compose" /></button>
        </div>
        {/* The new-page button: a 180-wide menu 4 under it, 6 to its left — 페이지 · 데이터베이스. */}
        {newMenu ? <Menu anchor={newMenu} placement="point" width={180} onClose={() => setNewMenu(null)} className="new-menu" entries={[
          { label: t("페이지"), icon: 'page', onSelect: () => createPage({ parentId: null, placeable: true }).catch(report) },
          { label: t("데이터베이스"), icon: 'database', onSelect: () => createDatabasePage(null).catch(report) },
        ]} /> : null}
        <button type="button" className="sidebar-search" onClick={onSearch}>
          <span className="sidebar-search-text">{t("검색")}</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="sidebar-tabs" role="tablist" aria-label={t("사이드바 탐색")}>
          {/* Always the selected tab; clicking it opens its menu rather than a page. */}
          {tabs.map((tab, index) => tab.active ? (
            <button type="button" key={tab.id} role="tab" aria-selected="true" aria-haspopup="menu" aria-label={homeLabel} title={`${homeLabel} ⌃${index + 1}`} className={`sidebar-tab selected${home.hideLabel ? ' icon-only' : ''}`} data-tab-id={tab.id} onClick={event => setTabMenu(event.currentTarget)}>{homeIcon}{home.hideLabel ? null : <span>{homeLabel}</span>}</button>
          ) : (
            // Other tabs show as their icon; a click opens that tab's sections.
            <button type="button" key={tab.id} role="tab" aria-selected="false" aria-label={tabLabel(tab.id, tab.home)} title={`${tabLabel(tab.id, tab.home)} ⌃${index + 1}`} className="sidebar-tab icon-only" data-tab-id={tab.id} onClick={() => selectTab(tab.id)}>{tabIconOf(tab.id, tab.home)}</button>
          ))}
          {tabs.length < maxTabs ? <button type="button" className="sidebar-tab add icon-only" aria-label={t("탭 추가")} title={t("탭 추가")} onClick={() => addTab({})}><Icon name="plus" size={16} /></button> : null}
        </div>
        <div className="sidebar-scroller" ref={scrollerRef} onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}>
          {fadingDrops.map(entry => <div key={entry.id} className={`${entry.item.inside ? 'sidebar-drop-target' : 'sidebar-drop-line'} drop-fade${entry.leaving ? ' leaving' : ''}`} style={{ top: entry.item.top, left: entry.item.left, width: entry.item.width, height: entry.item.height }} />)}
          {customizing ? (
            <>
              <div className="sidebar-group" data-customize-top>
                {fadingOrderDrops.filter(entry => entry.item.group === 'top').map(entry => <div key={entry.id} className={`sidebar-drop-line drop-fade${entry.leaving ? ' leaving' : ''}`} style={{ top: entry.item.top, left: entry.item.left, width: entry.item.width, height: 4 }} />)}
                {topIds.map(id => {
                  const link = links.find(item => item.id === id), shortcut = shortcuts.find(item => item.id === id);
                  const linked = link ? ws.get<PageEntity>(link.pageId) : undefined;
                  const app = id === 'home' ? { icon: 'home', label: t("홈"), remove: () => setLayout({ ...layout, homePage: false }) }
                    : id === 'tasks' ? { icon: 'tasks', label: t("내 작업"), remove: () => setLayout({ ...layout, myTasks: false }) }
                    : id === 'library' ? { icon: 'library', label: t("라이브러리"), remove: () => setLayout({ ...layout, library: false }) } : null;
                  const icon = app ? <Icon name={app.icon} /> : linked ? <EntityIcon item={linked} size={18} /> : <Icon name="compose" />;
                  const label = app ? app.label : linked ? linked.title || t("새 페이지") : shortcut ? shortcutLabel(shortcut) : '';
                  const remove = app ? app.remove : link ? () => removeLink(link.id) : () => setLayout({ ...layout, shortcuts: (layout.shortcuts ?? []).filter(item => item.id !== id) });
                  return (
                    <div key={id} className="sidebar-row customize-row" data-top-id={id} onPointerDown={event => startTopDrag(event, id)}>
                      <span className="customize-handle" aria-hidden="true"><Icon name="drag" size={14} /></span>
                      <span className="sidebar-row-icon">{icon}</span><span className="sidebar-row-label">{label}</span>
                      <span className="customize-actions"><button type="button" className="icon-button tiny" aria-label={t("사이드바에서 제거")} onClick={remove}><Icon name="close" size={14} /></button></span>
                    </div>
                  );
                })}
                <button type="button" className="sidebar-row sidebar-add" onClick={event => setAddMenu({ anchor: event.currentTarget, kind: 'shortcut' })}><span className="sidebar-row-icon"><Icon name="plus" size={16} /></span><span className="sidebar-row-label">{t("바로가기 추가")}</span></button>
              </div>
              <div className="customize-divider" />
              <div className="sidebar-group" data-customize-sections>
                {fadingOrderDrops.filter(entry => entry.item.group !== 'top').map(entry => <div key={entry.id} className={`sidebar-drop-line drop-fade${entry.leaving ? ' leaving' : ''}`} style={{ top: entry.item.top, left: entry.item.left, width: entry.item.width, height: 4 }} />)}
                {layout.sections.filter(section => !section.hidden).map(section => (
                  <div key={section.id} className="sidebar-row customize-row" data-section-id={section.id} onPointerDown={event => startSectionDrag(event, section.id)}>
                    <span className="customize-handle" aria-hidden="true"><Icon name="drag" size={14} /></span>
                    <span className="sidebar-row-icon"><Icon name={section.view ? viewIconName(ws.get<ViewEntity>(section.view.viewId) ?? { viewType: 'table' } as ViewEntity) : isBuiltin(section.id) ? sectionInfo[section.id].icon : 'table'} /></span>
                    <span className="sidebar-row-label">{section.view ? viewSectionLabel(section.view) : isBuiltin(section.id) ? sectionInfo[section.id].label : ''}</span>
                    <span className="customize-actions">
                      <button type="button" className="icon-button tiny" aria-label={t("메뉴 열기")} onClick={event => setSectionMenu({ anchor: event.currentTarget, id: section.id, compact: true })}><Icon name="sliders" size={14} /></button>
                      <button type="button" className="icon-button tiny" aria-label={t("사이드바에서 제거")} onClick={() => removeSection(section.id)}><Icon name="close" size={14} /></button>
                    </span>
                  </div>
                ))}
                <button type="button" className="sidebar-row sidebar-add" onClick={event => setAddMenu({ anchor: event.currentTarget, kind: 'section' })}><span className="sidebar-row-icon"><Icon name="plus" size={16} /></span><span className="sidebar-row-label">{t("섹션 추가")}</span></button>
              </div>
            </>
          ) : (
            <>
              {topIds.length ? (
                <div className="sidebar-group">
                  {topIds.map(id => {
                    if (id === 'home') return (
                      <button key={id} type="button" className={`sidebar-row sidebar-app-link${route.app === 'home' && !route.id ? ' selected' : ''}`} data-app="home" onClick={() => openAppPage('home')}>
                        <span className="sidebar-row-icon"><Icon name="home" /></span><span className="sidebar-row-label">{t("홈")}</span>
                      </button>
                    );
                    if (id === 'tasks') return (
                      <button key={id} type="button" className={`sidebar-row sidebar-app-link${route.app === 'tasks' && !route.id ? ' selected' : ''}`} data-app="tasks" onClick={() => openAppPage('tasks')}>
                        <span className="sidebar-row-icon"><Icon name="tasks" /></span><span className="sidebar-row-label">{t("내 작업")}</span>
                      </button>
                    );
                    if (id === 'library') return (
                      <button key={id} type="button" className={`sidebar-row sidebar-shortcut${route.library && !route.id ? ' selected' : ''}`} onClick={() => openLibrary('recents')}>
                        <span className="sidebar-row-icon"><Icon name="library" /></span><span className="sidebar-row-label">{t("라이브러리")}</span>
                      </button>
                    );
                    const link = links.find(item => item.id === id);
                    if (link) {
                      const target = ws.get<PageEntity>(link.pageId)!;
                      return (
                        <a key={id} href={hrefFor(target.id)} draggable={false} className={`sidebar-row sidebar-shortcut sidebar-link-shortcut${active === target.id ? ' selected' : ''}${flash === id ? ' just-added' : ''}`} data-link-id={id}
                          onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); navigate(target.id); }}>
                          <span className="sidebar-row-icon"><EntityIcon item={target} size={18} /></span><span className="sidebar-row-label">{target.title || t("새 페이지")}</span>
                          <span className="sidebar-row-actions">
                            <button type="button" className="icon-button tiny" aria-label={t("바로가기 삭제")} title={t("바로가기 삭제")} onClick={event => { event.preventDefault(); event.stopPropagation(); removeLink(id); }}><Icon name="close" size={14} /></button>
                          </span>
                        </a>
                      );
                    }
                    const shortcut = shortcuts.find(item => item.id === id);
                    if (!shortcut) return null;
                    return (
                      <div key={shortcut.id} className={`sidebar-row sidebar-shortcut sidebar-page-shortcut${flash === shortcut.id ? ' just-added' : ''}`} role="button" tabIndex={0} aria-label={shortcutLabel(shortcut)} data-shortcut-id={shortcut.id}
                        onClick={() => createFromShortcut(shortcut.sourceId, shortcut.viewId, shortcut.templateId, shortcut.openAs ?? 'page').catch(report)}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); createFromShortcut(shortcut.sourceId, shortcut.viewId, shortcut.templateId, shortcut.openAs ?? 'page').catch(report); } }}>
                        <span className="sidebar-row-icon"><Icon name="compose" /></span><span className="sidebar-row-label">{shortcutLabel(shortcut)}</span>
                        <span className="sidebar-row-actions">
                          <button type="button" className="icon-button tiny" aria-label={t("바로가기 메뉴 열기")} title={t("바로가기 메뉴 열기")} onClick={event => { event.stopPropagation(); setShortcutMenu({ anchor: event.currentTarget, id: shortcut.id }); }}><Icon name="more" size={16} /></button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {layout.sections.filter(section => !section.hidden).map(section => {
                if (section.view) return <ViewSectionBlock key={section.id} section={section} flash={flash === section.id} active={active} onToggle={() => updateSection(section.id, { collapsed: !section.collapsed })} onMenu={anchor => setSectionMenu({ anchor, id: section.id, compact: false })} />;
                if (!isBuiltin(section.id)) return null;
                const items = section.id === 'recent' ? recent : section.id === 'favorites' ? favorites : roots;
                if (section.id !== 'private' && !items.length) return null;
                const info = sectionInfo[section.id];
                return (
                  <section key={section.id} className="sidebar-group sidebar-section" data-builtin-section={section.id}>
                    <div className="sidebar-section-head" role="button" tabIndex={0} aria-expanded={!section.collapsed}
                      onClick={() => updateSection(section.id, { collapsed: !section.collapsed })}
                      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); updateSection(section.id, { collapsed: !section.collapsed }); } }}>
                      <span className="sidebar-section-label">{info.label}</span>
                      <Icon name="chevron-down" size={12} className={`section-chevron${section.collapsed ? ' closed' : ''}`} />
                      <span className="sidebar-head-space" />
                      <span className="sidebar-section-actions" onClick={event => event.stopPropagation()}>
                        <button type="button" className="icon-button tiny" aria-label={t("라이브러리에서 열기")} title={t("라이브러리에서 열기")} onClick={() => openLibrary(info.tab)}><Icon name="arrow-up-right" size={16} /></button>
                        {section.id === 'private' ? <button type="button" className="icon-button tiny" aria-label={t("페이지 추가")} title={t("페이지 추가")} onClick={() => createPage({ parentId: null, open: 'center' }).catch(report)}><Icon name="plus" size={16} /></button> : null}
                        <button type="button" className="icon-button tiny" aria-label={t("메뉴 열기")} title={t("메뉴 열기")} onClick={event => setSectionMenu({ anchor: event.currentTarget, id: section.id, compact: false })}><Icon name="more" size={16} /></button>
                      </span>
                    </div>
                    {!section.collapsed ? (
                      <div role="tree" aria-label={info.label} data-section={section.id}>
                        {items.slice(0, section.count).map(item => <Row key={item.id} item={item} depth={0} expanded={expanded} toggle={toggle} active={active} onMenu={openItemMenu} scope={section.id === 'private' ? '' : section.id} onDragStart={section.id === 'private' || section.id === 'favorites' ? startDrag : undefined} />)}
                        {items.length > section.count ? (
                          <button type="button" className="sidebar-row sidebar-more" onClick={() => openLibrary(info.tab)}><span className="sidebar-row-icon"><Icon name="more" size={16} /></span><span className="sidebar-row-label">{t("모두 보기")}</span></button>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                );
              })}
              <div className="sidebar-group sidebar-customize-group">
                <button type="button" className="sidebar-row sidebar-customize" onClick={() => setCustomizing(true)}><span className="sidebar-row-icon"><Icon name="sliders" size={18} /></span><span className="sidebar-row-label">{t("사이드바 사용자 지정")}</span></button>
              </div>
            </>
          )}
        </div>
        {treeDragging ? <div className={`sidebar-trash-drop${trashOver ? ' over' : ''}`}><Icon name="trash" size={18} /><span>{t("휴지통으로 이동")}</span></div> : null}
        {customizing ? <div className="sidebar-done"><button type="button" className="sidebar-done-button" onClick={() => setCustomizing(false)}>{t("완료")}</button></div> : null}
        <div className="sidebar-foot">
          <button type="button" className="workspace-switcher" aria-haspopup="menu" onClick={event => setWorkspaceMenu(event.currentTarget)}>
            <WorkspaceMark name={workspaceName} icon={identity.icon} /><span className="workspace-name">{workspaceName}</span><Icon name="chevron-down" size={12} />
          </button>
          <span className="sidebar-head-space" />
          <button type="button" className="icon-button" aria-label={t("도움말")} title={t("도움말")} aria-haspopup="menu" onClick={event => setHelpMenu(event.currentTarget)}><Icon name="question" /></button>
          <button type="button" className="icon-button sidebar-more-button" aria-label={t("라이브러리, 휴지통, 기타…")} title={t("라이브러리, 휴지통, 기타…")} onClick={event => setMoreMenu(event.currentTarget)}><Icon name="apps" /></button>
        </div>
      </div>
      {menu ? <Menu anchor={menu.anchor} entries={itemMenu(menu.item, menu.scope, menu.row)} onClose={() => setMenu(null)} owner={menu.owner} placement="pointer" motion={menu.pointer ? 'fade' : undefined} width={265} label={t("페이지 메뉴")} /> : null}
      {rename ? (
        <RenamePopover anchor={rename.anchor} placement="pointer" value={rename.item.title} placeholder={t("제목 없음")} icon={<EntityIcon item={rename.item} size={18} />}
          onIcon={button => setRenameIcon({ anchor: button, item: rename.item })}
          onCommit={value => apply([{ type: 'page.update', id: rename.item.id, title: value }]).catch(report)} onClose={() => setRename(null)} />
      ) : null}
      {renameIcon ? <EmojiPicker anchor={renameIcon.anchor} onClose={() => setRenameIcon(null)} onPick={value => apply([{ type: 'page.update', id: renameIcon.item.id, icon: value }]).catch(report)} onRemove={renameIcon.item.icon ? () => apply([{ type: 'page.update', id: renameIcon.item.id, icon: null }]).catch(report) : undefined} /> : null}
      {tabMenu ? <Menu anchor={tabMenu} placement="below-start" width={240} entries={tabEntries} onClose={() => setTabMenu(null)} label={t("탭 메뉴")} /> : null}
      {tabRename ? (
        <RenamePopover variant="tab" anchor={tabRename} placement="below-start" value={home.label ?? homeLabel} placeholder={t("탭 이름")} icon={homeIcon}
          onIcon={button => setTabIcon(button)} onCommit={value => setHome({ label: value.trim() && value.trim() !== t("홈") ? value.trim() : undefined })} onClose={() => setTabRename(null)} />
      ) : null}
      {tabIcon ? <EmojiPicker anchor={tabIcon} onClose={() => setTabIcon(null)} onPick={value => setHome({ icon: value })} onRemove={home.icon ? () => setHome({ icon: undefined }) : undefined} /> : null}
      {shortcutMenu && layout.shortcuts?.some(item => item.id === shortcutMenu.id) ? (
        <Menu anchor={shortcutMenu.anchor} placement="below-start" width={240} label={t("바로가기 메뉴")} onClose={() => setShortcutMenu(null)}
          entries={shortcutEntries(layout.shortcuts.find(item => item.id === shortcutMenu.id)!, shortcutMenu.anchor.closest('.sidebar-row'))} />
      ) : null}
      {shortcutRename ? (() => {
        const shortcut = layout.shortcuts?.find(item => item.id === shortcutRename.id);
        const section = layout.sections.find(item => item.id === shortcutRename.id);
        const value = shortcutRename.section ? (section?.view ? viewSectionLabel(section.view) : '') : shortcut ? shortcutLabel(shortcut) : '';
        return (
          <RenamePopover anchor={shortcutRename.anchor} placement="point" value={value} placeholder={t("이름")} onClose={() => setShortcutRename(null)}
            icon={<Icon name={shortcutRename.section ? viewIconName(ws.get<ViewEntity>(section?.view?.viewId ?? '') ?? { viewType: 'table' } as ViewEntity) : 'compose'} size={18} />}
            onCommit={name => { if (shortcutRename.section) updateView(shortcutRename.id, { name: name.trim() || undefined }); else updateShortcut(shortcutRename.id, { name: name.trim() || undefined }); }} />
        );
      })() : null}
      {sectionMenu ? <Menu anchor={sectionMenu.anchor} width={220} entries={sectionEntries(sectionMenu.id, sectionMenu.compact)} onClose={() => setSectionMenu(null)} label={t("섹션 메뉴")} /> : null}
      {addMenu ? (
        <Menu anchor={addMenu.anchor} width={220} onClose={() => setAddMenu(null)} entries={addMenu.kind === 'shortcut'
          ? ([
            { label: t("페이지"), icon: 'page', hint: '…', onSelect: () => setLinkPicker(addMenu.anchor) },
            ...(layout.homePage === false ? [{ label: t("홈"), icon: 'home', onSelect: () => setLayout({ ...layout, homePage: true }) }] : []),
            ...(layout.myTasks === false ? [{ label: t("내 작업"), icon: 'tasks', onSelect: () => setLayout({ ...layout, myTasks: true }) }] : []),
            ...(layout.library ? [] : [{ label: t("라이브러리"), icon: 'library', onSelect: () => setLayout({ ...layout, library: true }) }]),
          ])
          : (layout.sections.some(section => section.hidden)
            ? layout.sections.filter(section => section.hidden && isBuiltin(section.id)).map(section => ({ label: sectionInfo[section.id as SectionId].label, icon: sectionInfo[section.id as SectionId].icon, onSelect: () => setLayout({ ...layout, sections: [...layout.sections.filter(item => !item.hidden), { ...section, hidden: false }, ...layout.sections.filter(item => item.hidden && item.id !== section.id)] }) }))
            : [{ label: t("추가할 섹션이 없습니다"), disabled: true }])} />
      ) : null}
      {linkPicker ? (
        <Popover anchor={linkPicker} placement="below-start" onClose={() => setLinkPicker(null)} className="menu-panel picker-popover" style={{ width: 330 }} label={t("바로가기로 추가할 페이지")}>
          <PagePickerPanel placeholder={t("바로가기로 추가할 페이지 검색…")} exclude={new Set(links.map(item => item.pageId))} allowRoot={false} pagesOnly close={() => setLinkPicker(null)}
            onPick={target => { if (target && target.kind === 'page') addLinkShortcut(target.id); }} />
        </Popover>
      ) : null}
      {moreMenu ? (
        <Menu anchor={moreMenu} placement="above-start" offset={6} width={240} onClose={() => setMoreMenu(null)} entries={[
          { label: t("홈"), icon: 'home', onSelect: () => openAppPage('home') },
          { label: t("내 작업"), icon: 'tasks', onSelect: () => openAppPage('tasks') },
          { label: t("라이브러리"), icon: 'library', onSelect: () => openLibrary('recents') },
          { label: t("휴지통"), icon: 'trash', onSelect: () => openWorkspaceDialog('trash') },
          { label: t("템플릿"), icon: 'template', onSelect: () => openWorkspaceDialog('template-gallery') },
        ]} />
      ) : null}
      {helpMenu ? (
        // The help menu (260 wide, above the ? button; "더 보기 ›" opens a 225-wide submenu ending
        // in the app's version and last update).
        <Menu anchor={helpMenu} placement="above-start" offset={0} width={260} onClose={() => setHelpMenu(null)} entries={[
          { label: t("키보드 단축키"), icon: 'command', shortcut: '⌘⌥/', onSelect: () => openWorkspaceDialog('shortcuts') },
          { label: t("백업 만들기"), icon: 'backup', onSelect: () => openWorkspaceDialog('backup') },
          { label: t("더 보기"), icon: 'more', submenuWidth: 225, submenu: () => [
            { label: t("페이지 캐시 삭제"), onSelect: () => clearPageCache() },
            { label: t("이전 화면 열기"), onSelect: () => { location.href = `/classic${location.search}`; } },
            { kind: 'custom', render: () => <div className="help-menu-meta"><div>{`${__APP_NAME__} ${__APP_VERSION__}`}</div><div>{t("최종 업데이트: {0}", [relativeTime(__APP_BUILT__)])}</div></div> },
          ] },
        ]} />
      ) : null}
      {workspaceMenu ? (
        <Menu anchor={workspaceMenu} placement="above-start" width={260} onClose={() => setWorkspaceMenu(null)} entries={[
          // Every workspace on this computer (each its own data and address); a click opens it.
          ...(workspaces && workspaces.length > 1 ? [
            { kind: 'section', label: t("워크스페이스") } as MenuEntry,
            ...workspaces.map(item => ({ label: item.name || defaultWorkspaceName(), icon: <WorkspaceMark name={item.name || defaultWorkspaceName()} icon={item.icon} size={20} />, checked: item.current, onSelect: () => { if (!item.current && item.url) location.href = item.url; } }) as MenuEntry),
            { kind: 'separator' } as MenuEntry,
          ] : []),
          { kind: 'section', label: workspaceName },
          { label: t("이름과 아이콘"), icon: 'pencil', onSelect: () => showSettings('general') },
          { label: t("설정"), icon: 'settings', onSelect: () => showSettings() },
          { kind: 'separator' },
          { label: t("받은 알림"), icon: 'inbox', onSelect: () => setInboxOpen(true) },
          { label: t("변경 기록"), icon: 'history', onSelect: () => openWorkspaceDialog('history', {}) },
          { label: t("타임머신"), icon: 'clock', onSelect: () => openWorkspaceDialog('time-machine') },
          { label: t("연결 지도"), icon: 'graph', onSelect: () => openAppPage('graph') },
          { label: t("에이전트 실행 기록"), icon: 'agent', onSelect: () => openWorkspaceDialog('runs') },
          { label: t("보류한 저장"), icon: 'warning', onSelect: () => openWorkspaceDialog('pending') },
          { label: t("외부 전송 기록"), icon: 'arrow-up-right', onSelect: () => openWorkspaceDialog('deliveries') },
          { kind: 'separator' },
          { label: t("가져오기"), icon: 'import', onSelect: () => openWorkspaceDialog('import', {}) },
          { label: t("백업 만들기"), icon: 'backup', onSelect: () => openWorkspaceDialog('backup') },
          { label: t("데스크톱 알림"), icon: 'bell', onSelect: () => openWorkspaceDialog('desktop-notifications') },
          { label: t("휴지통"), icon: 'trash', onSelect: () => openWorkspaceDialog('trash') },
          { kind: 'separator' },
          { label: t("키보드 단축키"), icon: 'question', onSelect: () => openWorkspaceDialog('shortcuts') },
          { label: t("이전 화면 열기"), icon: 'arrow-up-right', onSelect: () => { location.href = `/classic${location.search}`; } },
          { kind: 'separator' },
          { label: t("새 워크스페이스 만들기"), icon: 'plus', onSelect: () => { createWorkspace(t("새 워크스페이스")).catch(report); } },
          ...(desktopApp ? [{ kind: 'separator' } as MenuEntry, { label: t("Inkacre 끄기"), icon: 'power', onSelect: () => { quitApp().catch(report); } }] : []),
        ]} />
      ) : null}
    </nav>
  );
}

export function viewIconName(view: ViewEntity) { return viewIcon[view.viewType] ?? 'table'; }

// Sidebar width: drag the edge; a click on it closes the sidebar. Kept per browser.
const widthKey = 'pageyard-sidebar-width';
const clampWidth = (value: number) => Math.round(Math.max(220, Math.min(480, value)));
export function applySidebarWidth() {
  try { const stored = Number(localStorage.getItem(widthKey)); if (stored) document.documentElement.style.setProperty('--sidebar-width', `${clampWidth(stored)}px`); } catch { /* storage unavailable */ }
}
applySidebarWidth();
function startSidebarResize(event: React.PointerEvent, onClose: () => void) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX, startWidth = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
  let moved = false, width = startWidth;
  document.body.classList.add('resizing-sidebar');
  const move = (moveEvent: PointerEvent) => {
    if (!moved && Math.abs(moveEvent.clientX - startX) < 3) return;
    moved = true;
    width = clampWidth(startWidth + moveEvent.clientX - startX);
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    document.body.classList.remove('resizing-sidebar');
    if (!moved) { onClose(); return; }
    try { localStorage.setItem(widthKey, String(width)); } catch { /* storage unavailable */ }
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
