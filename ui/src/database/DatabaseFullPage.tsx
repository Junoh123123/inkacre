import { t } from '../i18n';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { apply, titleDraftKey } from '../data/commands';
import { readLocal, storeLocal } from '../data/api';
import { report, useWorkspace, workspace } from '../data/store';
import type { PageEntity, SourceEntity, ViewEntity } from '../data/types';
import { DatabaseFrame } from './DatabaseFrame';
import { isDatabasePage } from './shared';
import { ownSources, viewsUnder } from './DataSources';

function DatabaseTitle({ page, fallback }: { page: PageEntity | undefined; fallback: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const timer = useRef(0);
  const editable = !!page && isDatabasePage(page);
  const shown = editable ? (readLocal<{ value: string } | null>(titleDraftKey(page!.id), null)?.value ?? page!.title) : fallback;
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && document.activeElement !== element && element.textContent !== shown) element.textContent = shown;
  }, [shown]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = () => {
    window.clearTimeout(timer.current);
    if (!page || !ref.current) return;
    const value = ref.current.textContent ?? '';
    if (value !== workspace.get<PageEntity>(page.id)?.title) apply([{ type: 'page.update', id: page.id, title: value }]).catch(report);
  };
  return (
    <h1 ref={ref} className="db-page-title" contentEditable={editable} suppressContentEditableWarning data-placeholder={t("새 데이터베이스")} spellCheck
      title={editable ? undefined : t("데이터베이스 이름은 이 앱에서 아직 바꿀 수 없습니다.")}
      onInput={() => { if (!page) return; storeLocal(titleDraftKey(page.id), JSON.stringify({ value: ref.current?.textContent ?? '', baseRevision: workspace.revision })); window.clearTimeout(timer.current); timer.current = window.setTimeout(save, 600); }}
      onBlur={save}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); (event.target as HTMLElement).blur(); } }} />
  );
}

// Full-page database (route to a source, one of its views, or a page that only holds a database).
export function DatabaseFullPage({ sourceId, viewId, page }: { sourceId: string; viewId: string | null; page?: PageEntity }) {
  const ws = useWorkspace();
  const source = ws.get<SourceEntity>(sourceId);
  if (!source) return null;
  const routedView = viewId ? ws.get<ViewEntity>(viewId) : undefined;
  const routedHolder = ws.get<PageEntity>(routedView?.parentId ?? source.parentId);
  const holder = page ?? (routedHolder?.kind === 'page' && isDatabasePage(routedHolder) ? routedHolder : ws.get<PageEntity>(source.parentId));
  // A database page shows every view under it, whichever of its data sources each one shows.
  const multi = !!holder && isDatabasePage(holder);
  const views = multi ? viewsUnder(holder!.id) : ws.viewsOf(sourceId, source.parentId);
  const routed = viewId ? ws.get<ViewEntity>(viewId) : undefined;
  const viewIds = routed && !views.some(view => view.id === routed.id) ? [routed.id, ...views.map(view => view.id)] : views.map(view => view.id);
  return (
    <div className="frame-scroller view-scroller database-page">
      <div className="database-page-inner">
        <DatabaseTitle page={holder} fallback={source.name} />
        <DatabaseFrame sourceId={(multi ? ownSources(holder!.id)[0]?.id : undefined) ?? sourceId} viewIds={viewIds} pageId={multi ? holder!.id : routed?.parentId ?? source.parentId ?? sourceId} initialViewId={viewId} />
      </div>
    </div>
  );
}
