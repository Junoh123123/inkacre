import { t } from '../i18n';
import { useEffect } from 'react';
import { useRoute, navigate, recentIds, openLibrary, openAppPage } from '../data/router';
import { useSettings } from '../data/settings';
import { useWorkspace, report } from '../data/store';
import { PageView, trashRoot } from '../page/PageView';
import { DatabaseFullPage } from '../database/DatabaseFullPage';
import { isDatabasePage } from '../database/shared';
import { EntityIcon } from '../page/EntityIcon';
import { createPage } from '../page/actions';
import { relativeTime } from '../data/format';
import { openWorkspaceDialog } from '../dialogs/registry';
import type { PageEntity, ViewEntity } from '../data/types';
import { LibraryPage } from './Library';
import { HomePage, MyTasksPage } from './HomePage';
import { GraphPage } from '../graph/GraphPage';

// No page in the address (first open, "홈으로"): the app opens the page chosen in 설정 › 시작 시 열기: the last
// page seen (default), the top page in the sidebar, 홈 or the library.
function StartPage() {
  const ws = useWorkspace();
  const settings = useSettings();
  const roots = ws.children(null).filter(item => item.kind === 'page' && ws.visible(item.id) && !(item as PageEntity).template);
  const last = recentIds().find(id => ws.visible(id) && ['page', 'source', 'view'].includes(ws.get(id)?.kind ?? ''));
  const target = settings.startPage === 'library' ? 'library' : settings.startPage === 'home' ? 'home' : settings.startPage === 'top' ? roots[0]?.id ?? last : last ?? roots[0]?.id;
  useEffect(() => {
    if (!ws.loaded) return;
    if (target === 'library') openLibrary('recents', { replace: true });
    else if (target === 'home') openAppPage('home', { replace: true });
    else if (target) navigate(target, { replace: true });
  }, [ws.loaded, target]);
  if (!ws.loaded || target) return <div className="frame-scroller" />;
  return (
    <div className="frame-scroller">
      <div className="page-column start-empty">
        <p className="empty-note">{t("아직 페이지가 없습니다.")}</p>
        <button type="button" className="outline-button" onClick={() => createPage({ parentId: null }).catch(report)}>{t("새 페이지")}</button>
      </div>
    </div>
  );
}

export function pageByUniqueId(entities: ReadonlyArray<{ id: string; kind: string }>, text: string): string | null {
  const objects = entities as unknown as Array<{ id: string; kind: string } & Record<string, unknown>>;
  const match = /^([\p{L}\p{N}]+)-(\d+)$/u.exec(text.trim());
  if (!match) return null;
  const prefix = match[1].toLocaleLowerCase(), number = Number(match[2]);
  const sources = new Set(objects.filter(item => item.kind === 'property' && item.type === 'unique_id' && typeof item.idPrefix === 'string' && item.idPrefix.toLocaleLowerCase() === prefix).map(item => item.parentId as string));
  return objects.find(item => item.kind === 'page' && sources.has(item.sourceId as string) && item.uniqueId === number && item.alive !== false)?.id ?? null;
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="frame-scroller">
      <div className="page-column not-found">
        <h1>{t("이 페이지를 찾을 수 없습니다")}</h1>
        <p className="empty-note">{t("휴지통에 있거나 삭제되었을 수 있습니다. ({0})", [id])}</p>
        <div className="field-row">
          <button type="button" className="outline-button" onClick={() => openWorkspaceDialog('trash')}>{t("휴지통 보기")}</button>
          <button type="button" className="outline-button" onClick={() => navigate(null)}>{t("홈으로")}</button>
        </div>
      </div>
    </div>
  );
}

export function MainView() {
  const ws = useWorkspace();
  const route = useRoute();
  if (!route.id && route.library) return <LibraryPage />;
  if (!route.id && route.app === 'home') return <HomePage />;
  if (!route.id && route.app === 'tasks') return <MyTasksPage />;
  if (!route.id && route.app === 'graph') return <GraphPage focus={route.focus ?? null} />;
  if (!route.id) return <StartPage />;
  if (!ws.loaded) return <div className="frame-scroller"><div className="page-column loading-note">{t("불러오는 중…")}</div></div>;
  const current = ws.get(route.id);
  if (!current) {
    // A prefixed unique ID ("TASK-12") opens that row.
    const byId = pageByUniqueId(ws.snapshot.objects, route.id);
    if (byId && ws.visible(byId)) { queueMicrotask(() => navigate(byId, { replace: true })); return null; }
  }
  // A page in the trash opens read-only with 복원 · 영구 삭제 over it (not once it has been deleted for good).
  if (current && !ws.visible(current.id) && current.kind === 'page' && !isDatabasePage(current as PageEntity) && !trashRoot(current.id)?.purged) return <PageView page={current as PageEntity} />;
  if (!current || !ws.visible(current.id)) return <NotFound id={route.id} />;
  if (current.kind === 'page') {
    const page = current as PageEntity;
    if (isDatabasePage(page)) {
      const source = ws.children(page.id).filter(child => child.kind === 'source' && ws.visible(child.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (source) return <DatabaseFullPage sourceId={source.id} viewId={null} page={page} />;
    }
    return <PageView page={page} />;
  }
  if (current.kind === 'view') return <DatabaseFullPage sourceId={(current as ViewEntity).sourceId} viewId={current.id} />;
  if (current.kind === 'source') return <DatabaseFullPage sourceId={current.id} viewId={null} />;
  const page = ws.pageOf(current.id);
  if (page) { queueMicrotask(() => navigate(page.id, { replace: true })); return null; }
  return <NotFound id={route.id} />;
}
