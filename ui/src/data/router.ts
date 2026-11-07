import { useSyncExternalStore } from 'react';
import { storeLocal, readLocal } from './api';
import { inTimeMachine, timeMachineRevision, withMoment } from './timeMachine';

// URL state: /?id=<page|view|source>&peek=<row page id>&pm=<s|c>
export type LibraryTab = 'recents' | 'favorites' | 'private';
/** Pages of the app itself rather than of the workspace: 홈, 내 작업 and 연결 지도 (/?home=1, /?tasks=1, /?graph=1). */
export type AppPage = 'home' | 'tasks' | 'graph';
export interface Route { id: string | null; peek: string | null; peekMode: 'side' | 'center'; library?: LibraryTab | null; app?: AppPage | null; focus?: string | null }
const libraryTabs: LibraryTab[] = ['recents', 'favorites', 'private'];

function parse(): Route {
  const params = new URL(location.href).searchParams;
  const library = params.get('library') as LibraryTab | null;
  const app: AppPage | null = params.get('home') ? 'home' : params.get('tasks') ? 'tasks' : params.get('graph') ? 'graph' : null;
  return { id: params.get('id'), peek: params.get('peek'), peekMode: params.get('pm') === 'c' ? 'center' : 'side', library: library && libraryTabs.includes(library) ? library : null, app, focus: app === 'graph' ? params.get('focus') : null };
}

let route = parse();
const listeners = new Set<() => void>();
function emit() { for (const listener of listeners) listener(); }
const scroller = () => document.querySelector<HTMLElement>('.view-scroller');
// Back/forward bring the page back where it was scrolled; the position is
// kept on each history entry when leaving it.
function restoreScroll(top: number) {
  const started = performance.now();
  const attempt = () => {
    const element = scroller();
    if (element && element.scrollHeight - element.clientHeight >= top) { element.scrollTop = top; return; }
    if (performance.now() - started < 800) requestAnimationFrame(attempt); else if (element) element.scrollTop = top;
  };
  requestAnimationFrame(attempt);
}
// How the current page was reached: 'history' for back/forward, 'link' for everything else.
// The sidebar only scrolls to the selected page after back/forward.
let arrivedBy: 'history' | 'link' = 'link';
export const arrivedByHistory = () => arrivedBy === 'history';
window.addEventListener('popstate', event => {
  arrivedBy = 'history';
  route = parse(); recordVisit(route.id); emit();
  const top = (event.state as { scroll?: number } | null)?.scroll;
  if (typeof top === 'number') restoreScroll(top); else scroller()?.scrollTo({ top: 0 });
});
function rememberScroll() {
  const element = scroller();
  if (element) history.replaceState({ ...(history.state ?? {}), scroll: Math.round(element.scrollTop) }, '');
}

export function useRoute() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => route);
}
export const currentRoute = () => route;

function url(next: Route) {
  const params = new URLSearchParams();
  if (next.library && !next.id) params.set('library', next.library);
  if (next.app && !next.id && !next.library) params.set(next.app, '1');
  if (next.app === 'graph' && next.focus && !next.id) params.set('focus', next.focus);
  if (next.id) params.set('id', next.id);
  if (next.peek) { params.set('peek', next.peek); if (next.peekMode === 'center') params.set('pm', 'c'); }
  if (timeMachineRevision !== null) params.set('at', String(timeMachineRevision));
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export const recentKey = 'pageyard-recent';
export function recentIds(): string[] { return readLocal<string[]>(recentKey, []); }
// When each page was last opened (the library's "최종 열람 일시").
const visitedKey = 'pageyard-visited';
export function visitedAt(): Record<string, string> { return readLocal<Record<string, string>>(visitedKey, {}); }
function recordVisit(id: string | null) {
  if (!id || inTimeMachine()) return;
  const visits = visitedAt();
  visits[id] = new Date().toISOString();
  const kept = Object.entries(visits).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 500);
  storeLocal(visitedKey, JSON.stringify(Object.fromEntries(kept)));
}
recordVisit(route.id);

// The library page (sidebar "라이브러리", "모두 보기").
export function openLibrary(tab: LibraryTab, { replace = false } = {}) {
  arrivedBy = 'link';
  route = { id: null, peek: null, peekMode: 'side', library: tab };
  if (replace) history.replaceState({}, '', url(route)); else { rememberScroll(); history.pushState({}, '', url(route)); }
  emit();
  scroller()?.scrollTo({ top: 0 });
}

// 홈, 내 작업 and 연결 지도 (focus: the page the map is drawn around).
export function openAppPage(app: AppPage, { replace = false, focus = null }: { replace?: boolean; focus?: string | null } = {}) {
  arrivedBy = 'link';
  route = { id: null, peek: null, peekMode: 'side', library: null, app, focus };
  if (replace) history.replaceState({}, '', url(route)); else { rememberScroll(); history.pushState({}, '', url(route)); }
  emit();
  scroller()?.scrollTo({ top: 0 });
}

export function navigate(id: string | null, { replace = false } = {}) {
  arrivedBy = 'link';
  route = { id, peek: null, peekMode: 'side', library: null };
  if (id) storeLocal(recentKey, JSON.stringify([id, ...recentIds().filter(item => item !== id)].slice(0, 30)));
  recordVisit(id);
  if (replace) history.replaceState({}, '', url(route)); else { rememberScroll(); history.pushState({}, '', url(route)); }
  emit();
  scroller()?.scrollTo({ top: 0 });
}

export function openPeek(rowId: string | null, mode: 'side' | 'center' = 'side') {
  route = { ...route, peek: rowId, peekMode: mode };
  rememberScroll();
  history.pushState({}, '', url(route));
  emit();
}

export function hrefFor(id: string) { return withMoment(`/?id=${encodeURIComponent(id)}`); }

// Row order of the view that opened the peek (for the ↑ ↓ buttons).
let peekList: string[] = [];
export function setPeekList(ids: string[]) { peekList = ids; }
export function getPeekList() { return peekList; }
export function closePeek() { if (route.peek) openPeek(null); }
