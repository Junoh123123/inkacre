import { titleNameField } from '../data/format';
import { t } from '../i18n';
import { useState } from 'react';
import { apply, newId } from '../data/commands';
import { navigate } from '../data/router';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import type { Operation, PageEntity, SourceEntity, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { confirmSmall } from '../ui/primitives';
import { openWorkspaceDialog } from '../dialogs/registry';
import { PagePicker } from '../dialogs/pageDialogs';

// Several data sources in one database:
// - view settings › "데이터 소스 관리": "소스" — one row per source (name, "N개 보기", ⋯: 데이터 소스 ID 복사 ·
//   휴지통으로 이동) and "+ 데이터 소스 추가"; "연결됨" — sources of other databases shown here, and
//   "+ 기존 데이터 소스 연결".
// - adding one makes an empty source (a title property) with a table view, opens that view — the database then
//   shows each view's source name (24/600) between its title and the tabs — and offers what to fill it with.

export const newSourceName = t("새 데이터 소스");
let pendingNewSource: string | null = null;
export function takePendingNewSource(sourceId: string) { if (pendingNewSource !== sourceId) return false; pendingNewSource = null; return true; }

/** The page a view's database belongs to (its own sources and the views under it). */
export function databaseHolder(view: ViewEntity | undefined): string | null { return view?.parentId ?? null; }
export function viewsUnder(holderId: string): ViewEntity[] {
  return workspace.snapshot.objects.filter(item => item.kind === 'view' && item.alive && item.parentId === holderId && workspace.visible(item.id) && workspace.visible((item as ViewEntity).sourceId))
    .sort((a, b) => a.position - b.position) as ViewEntity[];
}
export function ownSources(holderId: string): SourceEntity[] {
  return workspace.children(holderId).filter(item => item.kind === 'source' && workspace.visible(item.id)) as SourceEntity[];
}

export async function addDataSource(holderId: string, name = newSourceName) {
  const sourceId = newId(), viewId = newId();
  await apply([
    { type: 'source.create', id: sourceId, pageId: holderId, name, titlePropertyId: newId(), ...titleNameField() },
    { type: 'view.create', id: viewId, sourceId, parentId: holderId, name: t("표 보기"), viewType: 'table', config: {} },
  ]);
  pendingNewSource = sourceId;
  navigate(viewId);
  return { sourceId, viewId };
}

export function trashDataSource(source: SourceEntity) {
  const views = workspace.snapshot.objects.filter(item => item.kind === 'view' && item.alive && (item as ViewEntity).sourceId === source.id);
  return apply([{ type: 'node.trash', id: source.id }, ...views.map(view => ({ type: 'node.trash', id: view.id }))])
    .then(() => setStatus(t("{0}을(를) 휴지통으로 옮겼습니다.", [source.name])));
}

function linkEntries(holderId: string, onPick: (source: SourceEntity) => void): MenuEntry[] {
  const own = new Set(ownSources(holderId).map(source => source.id));
  const sources = workspace.sources().filter(source => !own.has(source.id));
  if (!sources.length) return [{ label: t("연결할 데이터 소스가 없습니다"), disabled: true }];
  return sources.map(source => ({ label: source.name, icon: 'database', hint: workspace.get<PageEntity>(source.parentId)?.title || undefined, keywords: source.name, onSelect: () => onPick(source) }));
}
async function linkSource(holderId: string, source: SourceEntity) {
  const viewId = newId();
  await apply([{ type: 'view.create', id: viewId, sourceId: source.id, parentId: holderId, name: source.name, viewType: 'table', config: {} }]);
  navigate(viewId);
}

export function DataSourcesPage({ view }: { view: ViewEntity; sourceId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const holderId = databaseHolder(view);
  const [menu, setMenu] = useState<{ anchor: Element; source: SourceEntity } | null>(null);
  const [linking, setLinking] = useState<Element | null>(null);
  const [moving, setMoving] = useState<SourceEntity | null>(null);
  if (!holderId) return null;
  const views = viewsUnder(holderId);
  const own = ownSources(holderId);
  const linked = [...new Set(views.map(item => item.sourceId))].filter(id => !own.some(source => source.id === id)).map(id => ws.get<SourceEntity>(id)).filter((source): source is SourceEntity => !!source);
  const row = (source: SourceEntity) => (
    <div key={source.id} className="ds-row">
      <Icon name="database" size={16} /><span className="ds-name">{source.name}</span>
      <span className="ds-count">{t("{0}개 보기", [views.filter(item => item.sourceId === source.id).length])}</span>
      <button type="button" className="ds-more" aria-label={t("{0} 메뉴", [source.name])} onClick={event => setMenu({ anchor: event.currentTarget, source })}><Icon name="more" size={14} /></button>
    </div>
  );
  return (
    <div className="ds-page">
      <div className="ds-section">{t("소스")}</div>
      {own.map(row)}
      <button type="button" className="ds-add" onClick={() => addDataSource(holderId).catch(report)}><Icon name="plus" size={14} /><span>{t("데이터 소스 추가")}</span></button>
      <div className="ds-sep" />
      <div className="ds-section">{t("연결됨")}</div>
      {linked.map(row)}
      <button type="button" className="ds-add" onClick={event => setLinking(event.currentTarget)}><Icon name="plus" size={14} /><span>{t("기존 데이터 소스 연결")}</span></button>
      {menu ? <Menu anchor={menu.anchor} placement="below-end" width={200} onClose={() => setMenu(null)} entries={[
        { label: t("데이터 소스 ID 복사"), icon: 'copy', onSelect: () => navigator.clipboard.writeText(menu.source.id).then(() => setStatus(t("데이터 소스 ID를 복사했습니다."))).catch(report) },
        ...(own.some(source => source.id === menu.source.id) ? [{ label: t("이동"), icon: 'turn-into', onSelect: () => setMoving(menu.source) } as MenuEntry] : []),
        ...[{ label: own.some(source => source.id === menu.source.id) ? t("휴지통으로 이동") : t("연결 해제"), icon: 'trash', onSelect: async () => {
          const isOwn = own.some(source => source.id === menu.source.id);
          const count = views.filter(item => item.sourceId === menu.source.id).length;
          if (!isOwn) { await apply(views.filter(item => item.sourceId === menu.source.id).map(item => ({ type: 'node.trash', id: item.id }) as Operation)).catch(report); return; }
          if (await confirmSmall(t("{0}을(를) 휴지통으로 옮길까요?\n데이터 소스와 보기 {1}개가 휴지통으로 이동합니다.", [menu.source.name, count]), t("데이터 소스를 휴지통으로 이동"))) {
            const next = views.find(item => item.sourceId !== menu.source.id);
            await trashDataSource(menu.source).catch(report);
            if (next && view.sourceId === menu.source.id) navigate(next.id);
          }
        } } as MenuEntry],
      ]} /> : null}
      {linking ? <Menu anchor={linking} placement="below-start" width={260} search={t("데이터 소스 검색…")} onClose={() => setLinking(null)} entries={linkEntries(holderId, source => { linkSource(holderId, source).catch(report); })} /> : null}
      {moving ? <PagePicker title={t("데이터 소스 이동")} placeholder={t("데이터 소스 이동…")} exclude={new Set([holderId])} onClose={() => setMoving(null)}
        onPick={async target => { if (target) await moveDataSource(moving, holderId, target.id).catch(report); setMoving(null); }} /> : null}
    </div>
  );
}

// "이동": the source (with its views on this database) goes to another page — inline there, or one more source of a
// database page. One command, so one undo.
export async function moveDataSource(source: SourceEntity, holderId: string, targetId: string) {
  const views = viewsUnder(holderId).filter(item => item.sourceId === source.id);
  await apply([{ type: 'node.move', id: source.id, parentId: targetId }, ...views.map(item => ({ type: 'node.move', id: item.id, parentId: targetId }) as Operation)]);
  setStatus(t("{0}을(를) 옮겼습니다.", [source.name]));
  navigate(views[0]?.id ?? targetId);
}

// 페이지로 전환 (an inline database): a new page in its place becomes the database page — the source and its views
// on this page move into it. One command, so one undo.
export async function turnInlineIntoPage(source: SourceEntity, holderId: string) {
  const id = newId();
  const views = viewsUnder(holderId).filter(item => item.sourceId === source.id);
  await apply([
    { type: 'page.create', id, title: source.name, parentId: holderId },
    { type: 'node.move', id, parentId: holderId, beforeId: source.id },
    { type: 'page.update', id, databasePage: true },
    { type: 'node.move', id: source.id, parentId: id },
    ...views.map(item => ({ type: 'node.move', id: item.id, parentId: id }) as Operation),
  ]);
  setStatus(t("{0}을(를) 페이지로 전환했습니다.", [source.name]));
}

// "새 데이터 소스": what to start the new (empty) source with.
const presets: Record<string, Array<{ name: string; propertyType: string; options?: Array<{ name: string; color: string; group?: string }> }>> = {
  tasks: [
    { name: t("상태"), propertyType: 'status', options: [{ name: t("시작 전"), color: 'default', group: 'todo' }, { name: t("진행 중"), color: 'blue', group: 'in_progress' }, { name: t("완료"), color: 'green', group: 'complete' }] },
    { name: t("담당자"), propertyType: 'person' }, { name: t("마감일"), propertyType: 'date' },
    { name: t("우선순위"), propertyType: 'select', options: [{ name: t("높음"), color: 'red' }, { name: t("중간"), color: 'yellow' }, { name: t("낮음"), color: 'green' }] },
  ],
  projects: [
    { name: t("상태"), propertyType: 'status', options: [{ name: t("계획"), color: 'default', group: 'todo' }, { name: t("진행 중"), color: 'blue', group: 'in_progress' }, { name: t("완료"), color: 'green', group: 'complete' }] },
    { name: t("책임자"), propertyType: 'person' }, { name: t("기간"), propertyType: 'date' },
  ],
};
// 작업 데이터베이스로 변환 (turn into a task database): a task database needs a status, an assignee and a due
// date — whichever are missing are added (one command), then the sub-item and dependency settings open.
export async function convertToTaskDatabase(sourceId: string) {
  const schema = workspace.schema(sourceId);
  const wanted = presets.tasks.slice(0, 3).filter(item => !schema.some(property => property.type === item.propertyType));
  if (wanted.length) {
    await apply(wanted.map(item => ({ type: 'property.create', id: newId(), sourceId, name: item.name, propertyType: item.propertyType, ...(item.options ? { options: item.options.map(option => ({ id: newId(), ...option })) } : {}) }) as Operation));
    setStatus(t("작업 데이터베이스 속성을 추가했습니다: {0}", [wanted.map(item => item.name).join(', ')]));
  }
}
export function NewSourcePage({ view, sourceId, onClose }: { view: ViewEntity; sourceId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [linking, setLinking] = useState<Element | null>(null);
  const holderId = databaseHolder(view);
  const fill = (kind: keyof typeof presets, name: string) => {
    const operations: Operation[] = presets[kind].map(item => ({ type: 'property.create', id: newId(), sourceId, name: item.name, propertyType: item.propertyType, ...(item.options ? { options: item.options.map(option => ({ id: newId(), ...option })) } : {}) }));
    const source = ws.get<SourceEntity>(sourceId);
    apply(operations).then(() => { if (source?.name === newSourceName) return apply([{ type: 'source.update', id: sourceId, name }]); return undefined; }).then(onClose).catch(report);
  };
  const items: Array<{ id: string; label: string; icon: string; tone?: string; onClick: (anchor: Element) => void }> = [
    { id: 'empty', label: t("새 빈 데이터 소스"), icon: 'plus', onClick: () => onClose() },
    { id: 'csv', label: t("CSV 가져오기"), icon: 'import', onClick: () => { onClose(); openWorkspaceDialog('import', { sourceId }); } },
  ];
  const suggested: typeof items = [
    { id: 'tasks', label: t("작업 관리"), icon: 'status-done', tone: 'green', onClick: () => fill('tasks', t("db-name|작업")) },
    { id: 'projects', label: t("프로젝트"), icon: 'board', tone: 'blue', onClick: () => fill('projects', t("프로젝트")) },
  ];
  const needle = query.trim().toLowerCase();
  const match = (label: string) => !needle || label.toLowerCase().includes(needle);
  return (
    <div className="ds-new">
      <input className="automations-search" value={query} placeholder={t("검색…")} aria-label={t("검색")} autoFocus onChange={event => setQuery(event.target.value)} />
      {items.filter(item => match(item.label)).map(item => <button type="button" key={item.id} className="ds-new-row" onClick={event => item.onClick(event.currentTarget)}><span className="ds-new-icon"><Icon name={item.icon} size={16} /></span><span>{item.label}</span></button>)}
      {suggested.some(item => match(item.label)) ? <div className="ds-section">{t("추천")}</div> : null}
      {suggested.filter(item => match(item.label)).map(item => <button type="button" key={item.id} className="ds-new-row" onClick={event => item.onClick(event.currentTarget)}><span className={`ds-new-icon tone-${item.tone}`}><Icon name={item.icon} size={16} /></span><span>{item.label}</span></button>)}
      <div className="ds-sep" />
      <button type="button" className="ds-new-row plain" onClick={event => setLinking(event.currentTarget)}><Icon name="arrow-up-right" size={16} /><span>{t("기존 데이터 소스에 연결")}</span></button>
      {linking && holderId ? <Menu anchor={linking} placement="below-start" width={260} search={t("데이터 소스 검색…")} onClose={() => setLinking(null)} entries={linkEntries(holderId, source => {
        // Linking instead of the empty source: the new one goes away, a view of the chosen source takes its place.
        const fresh = ws.get<SourceEntity>(sourceId);
        (fresh ? trashDataSource(fresh) : Promise.resolve()).then(() => linkSource(holderId, source)).catch(report);
      })} /> : null}
    </div>
  );
}
