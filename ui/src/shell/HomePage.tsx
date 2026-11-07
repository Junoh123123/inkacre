import { t } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { api, readLocal, storeLocal } from '../data/api';
import { apply } from '../data/commands';
import { displayDate, relativeTime } from '../data/format';
import { hrefFor, navigate, openAppPage, openPeek, recentIds, visitedAt } from '../data/router';
import { report, useWorkspace, workspace } from '../data/store';
import type { Entity, PageEntity, PropertyEntity, SelectOption } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { EntityIcon } from '../page/EntityIcon';
import { createRow } from '../page/actions';

// 홈 (a landing page with sections such as recently visited, upcoming events and My Tasks; each section
// can be hidden, and the order is kept) and 내 작업 (the unfinished items of every task database
// in one list, by due date). Both are pages of the app (/?home=1, /?tasks=1); what they show is read from the
// workspace (the engine's task list for 내 작업), the recents and favorites from this browser.

// ---------- the engine's task list ----------

export interface TaskSource { id: string; name: string; pageId: string | null; statusPropertyId: string | null; datePropertyId: string | null; personPropertyId: string | null; options: SelectOption[] }
export interface TaskItem { id: string; title: string; icon?: string | null; sourceId: string; status: (SelectOption & { kind: 'todo' | 'in_progress' | 'complete' }) | null; due: { start: string; end?: string } | null; assignees: string[]; done: boolean; createdAt: string; updatedAt: string }
export interface TaskList { revision: number; sources: TaskSource[]; tasks: TaskItem[] }

export function useTasks(input: { includeDone?: boolean; assignee?: string | null; sourceId?: string | null; limit?: number }) {
  const ws = useWorkspace();
  const [list, setList] = useState<TaskList | null>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    let cancelled = false;
    api<TaskList>('/api/tasks', input).then(data => { if (!cancelled) setList(data); }).catch(error => { if (!cancelled) { setList({ revision: 0, sources: [], tasks: [] }); report(error); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ws.version]);
  return list;
}

const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const parseDay = (text: string) => { const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text); return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null; };
type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
const bucketLabels: Record<Bucket, string> = { overdue: t("기한 지남"), today: t("오늘"), week: t("앞으로 7일"), later: t("나중에"), none: t("날짜 없음") };
export function dueBucket(task: TaskItem, now = new Date()): Bucket {
  const day = task.due?.start ? parseDay(task.due.end ?? task.due.start) : null;
  if (!day) return 'none';
  const today = dayStart(now).getTime(), diff = Math.round((day.getTime() - today) / 86400000);
  if (diff < 0 && !task.done) return 'overdue';
  if (diff <= 0) return 'today';
  if (diff <= 7) return 'week';
  return 'later';
}

function StatusChip({ task, source }: { task: TaskItem; source?: TaskSource }) {
  const [anchor, setAnchor] = useState<Element | null>(null);
  const status = task.status;
  const set = (option: SelectOption) => { if (source?.statusPropertyId) apply([{ type: 'value.set', pageId: task.id, propertyId: source.statusPropertyId, value: option.id }]).catch(report); };
  return (
    <>
      <button type="button" className={`task-status kind-${status?.kind ?? 'none'}${status?.color ? ` color-${status.color}` : ''}`} disabled={!source?.statusPropertyId} onClick={event => { event.stopPropagation(); setAnchor(event.currentTarget); }}>
        <span className="task-status-dot" />{status?.name ?? t("상태 없음")}
      </button>
      {anchor && source ? <Menu anchor={anchor} placement="below-start" width={220} label={t("상태")} onClose={() => setAnchor(null)}
        entries={source.options.map(option => ({ label: option.name, checked: option.id === status?.id, onSelect: () => set(option) } as MenuEntry))} /> : null}
    </>
  );
}

function TaskRow({ task, source }: { task: TaskItem; source?: TaskSource }) {
  const overdue = dueBucket(task) === 'overdue';
  return (
    <div className={`task-row${task.done ? ' done' : ''}`} role="row" data-id={task.id} onClick={() => openPeek(task.id)}>
      <StatusChip task={task} source={source} />
      <span className="task-title"><EntityIcon item={workspace.get(task.id)} size={16} /><span>{task.title || t("제목 없음")}</span></span>
      {task.assignees.length ? <span className="task-assignees">{task.assignees.join(', ')}</span> : null}
      <span className={`task-due${overdue ? ' overdue' : ''}`}>{task.due?.start ? displayDate(task.due.start, { withTime: false }) : ''}</span>
      <a className="task-source" href={source?.pageId ? hrefFor(source.pageId) : undefined} onClick={event => { event.preventDefault(); event.stopPropagation(); if (source?.pageId) navigate(source.pageId); }}>{source?.name ?? ''}</a>
    </div>
  );
}

// ---------- 내 작업 ----------

const tasksPrefKey = 'pageyard-my-tasks';
export function MyTasksPage() {
  const [prefs, setPrefs] = useState(() => ({ includeDone: false, assignee: null as string | null, sourceId: null as string | null, ...readLocal<object>(tasksPrefKey, {}) }));
  const update = (patch: Partial<typeof prefs>) => setPrefs(current => { const next = { ...current, ...patch }; storeLocal(tasksPrefKey, JSON.stringify(next)); return next; });
  const list = useTasks({ includeDone: prefs.includeDone, assignee: prefs.assignee, sourceId: prefs.sourceId, limit: 500 });
  const allNames = useTasks({ includeDone: true, limit: 500 });
  const [menu, setMenu] = useState<{ kind: 'assignee' | 'source' | 'new'; anchor: Element } | null>(null);
  const sources = new Map((list?.sources ?? []).map(source => [source.id, source]));
  const names = useMemo(() => [...new Set((allNames?.tasks ?? []).flatMap(task => task.assignees))].sort((a, b) => a.localeCompare(b)), [allNames]);
  const groups = useMemo(() => {
    const result = new Map<Bucket, TaskItem[]>();
    for (const task of list?.tasks ?? []) { const bucket = dueBucket(task); if (!result.has(bucket)) result.set(bucket, []); result.get(bucket)!.push(task); }
    return (['overdue', 'today', 'week', 'later', 'none'] as Bucket[]).filter(bucket => result.has(bucket)).map(bucket => ({ bucket, items: result.get(bucket)! }));
  }, [list]);
  // A new task is a row of that database, opened at the side.
  const newTask = (source: TaskSource) => createRow(source.id, { open: 'side' });
  return (
    <div className="frame-scroller view-scroller app-page-scroller">
      <div className="app-page my-tasks">
        <header className="app-page-head">
          <h1><Icon name="tasks" size={28} />{t("내 작업")}</h1>
          <p className="muted">{t("상태 속성이 있는 데이터베이스(작업 데이터베이스)의 항목을 마감일 순으로 모읍니다.")}</p>
        </header>
        <div className="app-page-tools">
          <button type="button" className={`filter-chip${prefs.sourceId ? ' active' : ''}`} onClick={event => setMenu({ kind: 'source', anchor: event.currentTarget })}><Icon name="database" size={16} /><span>{prefs.sourceId ? sources.get(prefs.sourceId)?.name ?? t("데이터베이스") : t("모든 데이터베이스")}</span><Icon name="chevron-down" size={12} /></button>
          {names.length ? <button type="button" className={`filter-chip${prefs.assignee ? ' active' : ''}`} onClick={event => setMenu({ kind: 'assignee', anchor: event.currentTarget })}><Icon name="people" size={16} /><span>{prefs.assignee ?? t("모든 담당자")}</span><Icon name="chevron-down" size={12} /></button> : null}
          <button type="button" className={`filter-chip${prefs.includeDone ? ' active' : ''}`} aria-pressed={prefs.includeDone} onClick={() => update({ includeDone: !prefs.includeDone })}><Icon name="check" size={16} /><span>{t("완료한 작업 표시")}</span></button>
          <span className="app-page-tools-gap" />
          <button type="button" className="library-new" disabled={!list?.sources.length} onClick={event => {
            const all = list?.sources ?? [];
            if (all.length === 1 || prefs.sourceId) { const target = sources.get(prefs.sourceId ?? '') ?? all[0]; if (target) newTask(target).catch(report); }
            else setMenu({ kind: 'new', anchor: event.currentTarget });
          }}>{t("새 작업")}</button>
        </div>
        {!list ? <p className="muted">{t("불러오는 중…")}</p> : !list.sources.length ? (
          <div className="app-page-empty"><Icon name="tasks" size={32} /><p>{t("작업 데이터베이스가 없습니다. 상태 속성이 있는 데이터베이스를 만들면 여기에 모입니다.")}</p></div>
        ) : !list.tasks.length ? (
          <div className="app-page-empty"><Icon name="check" size={32} /><p>{t("남은 작업이 없습니다.")}</p></div>
        ) : groups.map(group => (
          <section key={group.bucket} className={`task-group bucket-${group.bucket}`}>
            <h2 className="task-group-head">{bucketLabels[group.bucket]}<span className="count">{group.items.length}</span></h2>
            <div role="table" className="task-table">{group.items.map(task => <TaskRow key={task.id} task={task} source={sources.get(task.sourceId)} />)}</div>
          </section>
        ))}
      </div>
      {menu?.kind === 'source' ? <Menu anchor={menu.anchor} placement="below-start" width={260} label={t("데이터베이스")} onClose={() => setMenu(null)} entries={[
        { label: t("모든 데이터베이스"), checked: !prefs.sourceId, onSelect: () => update({ sourceId: null }) },
        ...(list?.sources ?? []).map(source => ({ label: source.name, checked: prefs.sourceId === source.id, onSelect: () => update({ sourceId: source.id }) } as MenuEntry)),
      ]} /> : null}
      {menu?.kind === 'assignee' ? <Menu anchor={menu.anchor} placement="below-start" width={240} label={t("담당자")} onClose={() => setMenu(null)} entries={[
        { label: t("모든 담당자"), checked: !prefs.assignee, onSelect: () => update({ assignee: null }) },
        ...names.map(name => ({ label: name, checked: prefs.assignee === name, onSelect: () => update({ assignee: name }) } as MenuEntry)),
      ]} /> : null}
      {menu?.kind === 'new' ? <Menu anchor={menu.anchor} placement="below-end" width={260} label={t("새 작업")} onClose={() => setMenu(null)}
        entries={(list?.sources ?? []).map(source => ({ label: source.name, icon: 'database', onSelect: () => { newTask(source).catch(report); } } as MenuEntry))} /> : null}
    </div>
  );
}

// ---------- 홈 ----------

type SectionId = 'recent' | 'upcoming' | 'tasks' | 'favorites';
const sectionLabels: Record<SectionId, string> = { recent: t("최근 방문"), upcoming: t("다가오는 일정"), tasks: t("내 작업"), favorites: t("즐겨찾기") };
const homeKey = 'pageyard-home-sections';
interface HomeLayout { order: SectionId[]; hidden: SectionId[] }
const defaultLayout: HomeLayout = { order: ['recent', 'upcoming', 'tasks', 'favorites'], hidden: [] };
function readLayout(): HomeLayout {
  const stored = readLocal<Partial<HomeLayout>>(homeKey, {});
  const order = [...(stored.order ?? []).filter(id => id in sectionLabels), ...defaultLayout.order.filter(id => !(stored.order ?? []).includes(id))];
  return { order, hidden: (stored.hidden ?? []).filter(id => id in sectionLabels) };
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 5 ? t("좋은 밤입니다") : hour < 12 ? t("좋은 아침입니다") : hour < 18 ? t("좋은 오후입니다") : t("좋은 저녁입니다");
}

function PageCard({ item }: { item: Entity }) {
  return (
    <a className="home-card" href={hrefFor(item.id)} onClick={event => { event.preventDefault(); navigate(item.id); }}>
      <span className="home-card-cover"><EntityIcon item={item} size={28} /></span>
      <span className="home-card-title">{workspace.title(item) || t("새 페이지")}</span>
      <span className="home-card-time">{relativeTime(item.updatedAt)}</span>
    </a>
  );
}

// Dates in the next two weeks: every database row's date values (and reminders set on pages).
interface Upcoming { id: string; pageId: string; title: string; at: string; label: string }
function upcomingEvents(days = 14): Upcoming[] {
  const today = dayStart(new Date()), until = new Date(today.getTime() + days * 86400000);
  const events: Upcoming[] = [];
  for (const item of workspace.snapshot.objects) {
    if (item.kind !== 'page' || !(item as PageEntity).sourceId || (item as PageEntity).template || !workspace.visible(item.id) || (item as PageEntity & { archived?: boolean }).archived) continue;
    const page = item as PageEntity;
    for (const property of workspace.schema(page.sourceId).filter(entry => entry.type === 'date') as PropertyEntity[]) {
      const value = page.values?.[property.id] as { start?: string } | null | undefined;
      const day = value?.start ? parseDay(value.start) : null;
      if (!day || day < today || day > until) continue;
      events.push({ id: `${page.id}:${property.id}`, pageId: page.id, title: page.title, at: value!.start!, label: property.name });
    }
  }
  for (const item of workspace.snapshot.objects) {
    if (item.kind !== 'reminder' || !workspace.visible(item.id)) continue;
    const at = (item as { at?: string }).at;
    if (!at) continue;
    const when = new Date(at);
    if (when < today || when > until) continue;
    const page = workspace.pageOf(item.parentId);
    if (page) events.push({ id: item.id, pageId: page.id, title: page.title, at, label: t("리마인더") });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 12);
}

export function HomePage() {
  const ws = useWorkspace();
  const [layout, setLayout] = useState(readLayout);
  const [menu, setMenu] = useState<Element | null>(null);
  const save = (next: HomeLayout) => { setLayout(next); storeLocal(homeKey, JSON.stringify(next)); };
  const tasks = useTasks({ includeDone: false, limit: 6 });
  // Pages opened lately: the ones opened in the app and those reached by address, newest first.
  const recent = useMemo(() => {
    const visits = visitedAt(), order = new Map<string, string>(Object.entries(visits));
    recentIds().forEach((id, index) => { if (!order.has(id)) order.set(id, new Date(Date.now() - (index + 1) * 1000).toISOString()); });
    return [...order].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id)
      .filter(id => ws.visible(id) && ['page', 'source', 'view'].includes(ws.get(id)?.kind ?? '') && !(ws.get<PageEntity>(id)?.template)).slice(0, 12).map(id => ws.get(id)!);
  }, [ws.version]);
  const favorites = useMemo(() => ws.favorites().map(id => ws.get(id)!).filter(Boolean), [ws.version]);
  const upcoming = useMemo(() => upcomingEvents(), [ws.version]);
  const sources = new Map((tasks?.sources ?? []).map(source => [source.id, source]));
  const move = (id: SectionId, delta: number) => {
    const order = [...layout.order], index = order.indexOf(id), target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    save({ ...layout, order });
  };
  const body = (id: SectionId) => {
    if (id === 'recent') return recent.length ? <div className="home-cards">{recent.map(item => <PageCard key={item.id} item={item} />)}</div> : <p className="muted home-empty">{t("최근 방문한 페이지가 없습니다.")}</p>;
    if (id === 'favorites') return favorites.length ? <div className="home-cards">{favorites.map(item => <PageCard key={item.id} item={item} />)}</div> : <p className="muted home-empty">{t("즐겨찾기한 페이지가 없습니다.")}</p>;
    if (id === 'upcoming') return upcoming.length ? (
      <div className="home-events">{upcoming.map(event => (
        <a key={event.id} className="home-event" href={hrefFor(event.pageId)} onClick={clickEvent => { clickEvent.preventDefault(); const page = ws.get<PageEntity>(event.pageId); if (page?.sourceId) openPeek(page.id); else navigate(event.pageId); }}>
          <span className="home-event-date">{displayDate(event.at, { withTime: false })}</span>
          <span className="home-event-title"><EntityIcon item={ws.get(event.pageId)} size={16} />{event.title || t("제목 없음")}</span>
          <span className="home-event-label">{event.label}</span>
        </a>
      ))}</div>
    ) : <p className="muted home-empty">{t("앞으로 2주 동안 일정이 없습니다.")}</p>;
    return !tasks ? <p className="muted home-empty">{t("불러오는 중…")}</p> : tasks.tasks.length ? (
      <div className="task-table">{tasks.tasks.map(task => <TaskRow key={task.id} task={task} source={sources.get(task.sourceId)} />)}</div>
    ) : <p className="muted home-empty">{tasks.sources.length ? t("남은 작업이 없습니다.") : t("작업 데이터베이스가 없습니다. 상태 속성이 있는 데이터베이스를 만들면 여기에 모입니다.")}</p>;
  };
  return (
    <div className="frame-scroller view-scroller app-page-scroller">
      <div className="app-page home-page">
        <header className="home-head">
          <h1 className="home-greeting">{greeting()}</h1>
          <button type="button" className="icon-button" aria-label={t("홈 사용자 지정")} title={t("홈 사용자 지정")} onClick={event => setMenu(event.currentTarget)}><Icon name="sliders" size={18} /></button>
        </header>
        {layout.order.filter(id => !layout.hidden.includes(id)).map(id => (
          <section key={id} className={`home-section home-${id}`} data-section={id}>
            <h2 className="home-section-head">
              <span>{sectionLabels[id]}</span>
              {id === 'tasks' ? <button type="button" className="text-button small" onClick={() => openAppPage('tasks')}>{t("모두 보기")}</button> : null}
            </h2>
            {body(id)}
          </section>
        ))}
        {layout.hidden.length === layout.order.length ? <p className="muted">{t("모든 섹션을 숨겼습니다. 오른쪽 위 단추로 다시 표시하세요.")}</p> : null}
      </div>
      {menu ? <Menu anchor={menu} placement="below-end" width={260} label={t("홈 사용자 지정")} onClose={() => setMenu(null)} entries={[
        { kind: 'section', label: t("섹션") },
        ...layout.order.map((id, index) => ({ label: sectionLabels[id], checked: !layout.hidden.includes(id), keepOpen: true,
          onSelect: () => save({ ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter(item => item !== id) : [...layout.hidden, id] }),
          right: (
            <span className="home-order" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
              <button type="button" className="icon-button tiny" aria-label={t("위로 이동")} title={t("위로 이동")} disabled={index === 0} onClick={() => move(id, -1)}><Icon name="arrow-up" size={12} /></button>
              <button type="button" className="icon-button tiny" aria-label={t("아래로 이동")} title={t("아래로 이동")} disabled={index === layout.order.length - 1} onClick={() => move(id, 1)}><Icon name="arrow-down" size={12} /></button>
            </span>
          ) } as MenuEntry)),
        { kind: 'separator' },
        { label: t("기본값으로 재설정"), icon: 'undo', onSelect: () => save(defaultLayout) },
      ]} /> : null}
    </div>
  );
}
