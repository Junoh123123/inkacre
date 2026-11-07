// 타임머신: /?at=<revision> opens the whole workspace as it was right after that revision, read-only — every page,
// database view and search reads the past state from the app (GET /api/state?at=…, queries and search with ?at=…).
// Nothing can be changed there; a page is brought back with 지금으로 되살리기 or 복사본으로 꺼내기 (the time machine
// bar), which go to the app as it is now. Kept free of the store so the router and the API can use it.
const raw = new URLSearchParams(location.search).get('at');
export const timeMachineRevision: number | null = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
export const inTimeMachine = () => timeMachineRevision !== null;
// Routes that read the workspace: in the time machine they read it as it was.
const pastReads = new Set(['/api/state', '/api/query', '/api/search', '/api/tasks']);
export function pastRoute(route: string) {
  if (timeMachineRevision === null || !pastReads.has(route)) return route;
  return `${route}?at=${timeMachineRevision}`;
}
// An address in the time machine keeps its moment.
export function withMoment(href: string) {
  if (timeMachineRevision === null) return href;
  return href.includes('?') ? `${href}&at=${timeMachineRevision}` : `${href}?at=${timeMachineRevision}`;
}
export function timeMachineHref(revision: number, pageId?: string | null) {
  const params = new URLSearchParams({ at: String(revision) });
  if (pageId) params.set('id', pageId);
  return `/?${params}`;
}
