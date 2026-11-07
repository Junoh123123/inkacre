import { readLocal, storeLocal } from '../data/api';

// The sidebar's layout, kept per browser: the 라이브러리
// shortcut, "새 페이지" shortcuts into databases, the sections (최근 · 즐겨찾기 · 개인 페이지 and
// database views added with "보기를 사이드바에 추가"), and the 홈 tab.

export const layoutKey = 'pageyard-sidebar-layout-v1';
const collapsedKey = 'pageyard-sidebar-collapsed';
const recentClosedKey = 'pageyard-recent-closed';
export const layoutEvent = 'sidebar-layout';

export type OpenAs = 'side' | 'center' | 'page';
export type BuiltinSection = 'recent' | 'favorites' | 'private';
export const builtinSections: BuiltinSection[] = ['recent', 'favorites', 'private'];
// A database view as a section: "<보기> · <DB>" heading, its first rows,
// opened in the side peek; the menu sets the name, how pages open, how many rows, icons, the view
// and the template new pages start from.
export interface ViewSectionConfig { viewId: string; sourceId: string; name?: string; openAs?: OpenAs; icons?: boolean; templateId?: string | null }
export interface SectionConfig { id: string; count: number; hidden?: boolean; collapsed?: boolean; sort?: 'manual' | 'edited'; view?: ViewSectionConfig }
// "사이드바에 바로가기 추가" from a database's 새로 만들기 ⌄: a row under 라이브러리 that makes a page in
// that database (opened in full by default), from a template or empty, matching a view's filters.
export interface PageShortcut { id: string; sourceId: string; viewId?: string; name?: string; openAs?: OpenAs; templateId?: string | null }
export interface HomeTab { label?: string; icon?: string; hideLabel?: boolean }
/** A shortcut that opens a page (사이드바 탭's page shortcuts). */
export interface LinkShortcut { id: string; pageId: string }
/** apps: the 홈 and 내 작업 rows above 라이브러리 (sidebar shortcuts; both shown unless removed). */
/** order: the rows above the sections as arranged ("home", "tasks", "library" and shortcut ids); the rest follow. */
export interface Layout { library: boolean; sections: SectionConfig[]; home?: HomeTab; shortcuts?: PageShortcut[]; links?: LinkShortcut[]; order?: string[]; homePage?: boolean; myTasks?: boolean }

// 사이드바 탭 (up to six sidebar tabs, each with its own sections): the first tab keeps the layout stored
// under layoutKey (as before tabs existed); the others live with their layouts under tabsKey.
const tabsKey = 'pageyard-sidebar-tabs-v1';
export const maxTabs = 6;
interface TabsState { active: string; tabs: Array<{ id: string; layout?: Partial<Layout> }> }
function readTabs(): TabsState {
  const saved = readLocal<TabsState | null>(tabsKey, null);
  const tabs = (saved?.tabs ?? []).filter(tab => tab && typeof tab.id === 'string' && tab.id !== 'home').slice(0, maxTabs - 1);
  const all = [{ id: 'home' }, ...tabs];
  return { active: all.some(tab => tab.id === saved?.active) ? saved!.active : 'home', tabs: all };
}
function writeTabs(state: TabsState) { storeLocal(tabsKey, JSON.stringify({ active: state.active, tabs: state.tabs.filter(tab => tab.id !== 'home') })); }
export function loadTabs(): Array<{ id: string; home: HomeTab; active: boolean }> {
  const state = readTabs();
  return state.tabs.map(tab => ({ id: tab.id, home: (tab.id === 'home' ? readLocal<Partial<Layout> | null>(layoutKey, null)?.home : tab.layout?.home) ?? {}, active: tab.id === state.active }));
}
export function selectTab(id: string) { const state = readTabs(); if (!state.tabs.some(tab => tab.id === id)) return; writeTabs({ ...state, active: id }); window.dispatchEvent(new CustomEvent(layoutEvent)); }
export function addTab(home: HomeTab) {
  const state = readTabs();
  if (state.tabs.length >= maxTabs) return;
  const id = `tab-${newKey()}`;
  // A new tab starts with the three page sections and no shortcuts.
  const layout: Partial<Layout> = { library: false, homePage: false, myTasks: false, shortcuts: [], home, sections: builtinSections.map(section => ({ id: section, count: 5 })) };
  writeTabs({ active: id, tabs: [...state.tabs, { id, layout }] });
  window.dispatchEvent(new CustomEvent(layoutEvent));
}
export function removeTab(id: string) {
  const state = readTabs();
  if (id === 'home') return;
  const tabs = state.tabs.filter(tab => tab.id !== id);
  writeTabs({ active: state.active === id ? 'home' : state.active, tabs });
  window.dispatchEvent(new CustomEvent(layoutEvent));
}
export function moveTab(id: string, by: number) {
  const state = readTabs(), at = state.tabs.findIndex(tab => tab.id === id), to = at + by;
  if (at <= 0 || to <= 0 || to >= state.tabs.length) return; // the first tab stays first
  const tabs = [...state.tabs]; [tabs[at], tabs[to]] = [tabs[to], tabs[at]];
  writeTabs({ ...state, tabs }); window.dispatchEvent(new CustomEvent(layoutEvent));
}

export function loadLayout(): Layout {
  const state = readTabs();
  const saved = state.active === 'home' ? readLocal<Partial<Layout> | null>(layoutKey, null) : state.tabs.find(tab => tab.id === state.active)?.layout ?? null;
  const defaults: SectionConfig[] = [
    { id: 'recent', count: 5, collapsed: localStorage.getItem(recentClosedKey) === '1' },
    { id: 'favorites', count: 5 },
    { id: 'private', count: 5, collapsed: readLocal<boolean>(collapsedKey, false) === true },
  ];
  const sections = (saved?.sections ?? []).filter(section => (builtinSections as string[]).includes(section.id) || (section.view && section.view.viewId));
  for (const section of defaults) if (!sections.some(item => item.id === section.id)) sections.push(section);
  return { library: saved?.library ?? true, sections, home: saved?.home ?? {}, shortcuts: (saved?.shortcuts ?? []).filter(item => item && item.sourceId), links: (saved?.links ?? []).filter(item => item && item.pageId), order: Array.isArray(saved?.order) ? saved.order : undefined, homePage: saved?.homePage ?? true, myTasks: saved?.myTasks ?? true };
}
// 탭 초기화: the tab as new — its name, icon, shortcuts and sections back to the defaults.
export function freshLayout(): Layout {
  return { library: true, sections: [{ id: 'recent', count: 5 }, { id: 'favorites', count: 5 }, { id: 'private', count: 5 }], home: {}, shortcuts: [], links: [], homePage: true, myTasks: true };
}
export function addLinkShortcut(pageId: string) {
  const layout = loadLayout();
  if (layout.links?.some(item => item.pageId === pageId)) return;
  const id = newKey();
  saveLayout({ ...layout, links: [...(layout.links ?? []), { id, pageId }] }, id);
}

// The id of the shortcut or section just added: the sidebar marks it for a moment.
let justAdded = '';
export const takeJustAdded = () => { const id = justAdded; justAdded = ''; return id; };

export function saveLayout(next: Layout, added = '') {
  const state = readTabs();
  if (state.active === 'home') storeLocal(layoutKey, JSON.stringify(next));
  else writeTabs({ ...state, tabs: state.tabs.map(tab => tab.id === state.active ? { ...tab, layout: next } : tab) });
  if (added) justAdded = added;
  window.dispatchEvent(new CustomEvent(layoutEvent));
}

const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 18);

export function addPageShortcut(sourceId: string, viewId?: string) {
  const layout = loadLayout();
  const id = `shortcut-${newKey()}`;
  saveLayout({ ...layout, shortcuts: [...(layout.shortcuts ?? []), { id, sourceId, ...(viewId ? { viewId } : {}), openAs: 'page', templateId: null }] }, id);
}

export function addViewSection(viewId: string, sourceId: string) {
  const layout = loadLayout();
  const id = `view-${newKey()}`;
  const shown = layout.sections.filter(section => !section.hidden), hidden = layout.sections.filter(section => section.hidden);
  saveLayout({ ...layout, sections: [...shown, { id, count: 5, view: { viewId, sourceId, openAs: 'side', icons: true, templateId: null } }, ...hidden] }, id);
}
