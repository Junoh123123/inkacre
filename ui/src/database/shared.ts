import { t } from '../i18n';
import { inTimeMachine } from '../data/timeMachine';
import { apply, newId } from '../data/commands';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import { navigate, openPeek, setPeekList } from '../data/router';
import { createRow } from '../page/actions';
import { statusGroupKeys, statusGroupLabel, statusGroupName } from '../data/format';
import { createContext, useEffect, useState } from 'react';

// Where a view can put its own controls in the database toolbar (left of filter/sort),
// e.g. the calendar's "날짜 없음" button. Null for inline databases without a toolbar.
export const ToolbarSlot = createContext<HTMLElement | null>(null);
import type { Filter, Operation, PageEntity, PropertyEntity, QueryGroup, QueryResult, QueryRow, SourceEntity, ViewConfig, ViewEntity, ViewType } from '../data/types';

export const viewTypeLabels: Record<ViewType, string> = {
  table: t("표"), board: t("보드"), timeline: t("타임라인"), calendar: t("캘린더"), list: t("리스트"), gallery: t("갤러리"), chart: t("차트"), feed: t("피드"), map: t("지도"), form: t("양식"), dashboard: t("대시보드"),
};
export const layoutOrder: ViewType[] = ['table', 'board', 'timeline', 'calendar', 'list', 'gallery', 'chart', 'feed', 'map', 'form', 'dashboard'];

export function updateView(view: ViewEntity | null | undefined, config: Partial<ViewConfig>, extra: { name?: string; viewType?: ViewType } = {}) {
  if (!view) return Promise.resolve();
  return apply([{ type: 'view.update', id: view.id, ...extra, ...(Object.keys(config).length ? { config } : {}) }]).catch(report);
}

export function shownProperties(result: QueryResult): PropertyEntity[] {
  const byId = new Map(result.properties.map(property => [property.id, property]));
  const order = result.visibleProperties.filter(id => byId.has(id));
  const title = result.properties.find(property => property.type === 'title');
  const list = order.map(id => byId.get(id)!);
  // The title column always shows and comes first.
  if (title) { const index = list.indexOf(title); if (index > 0) { list.splice(index, 1); list.unshift(title); } else if (index < 0) list.unshift(title); }
  return list;
}

export function rowIndex(result: QueryResult): Map<string, QueryRow> {
  const map = new Map<string, QueryRow>();
  const walk = (rows: QueryRow[]) => { for (const row of rows) { map.set(row.id, row); if (row.children?.length) walk(row.children); } };
  walk(result.rows);
  return map;
}

// ⌥-click opens a row in the side peek whatever the view's setting (listed as "⌥Click" in the row menu).
/** Feeds and maps open pages in the middle by default ("팝업"), the other layouts at the side. */
export function defaultOpenMode(type: ViewType | undefined): 'side' | 'center' | 'page' {
  return type === 'feed' || type === 'map' ? 'center' : 'side';
}

export function openRow(view: ViewEntity | null, rowId: string, orderedIds?: string[], { side = false } = {}) {
  const mode = side ? 'side' : view?.config.openMode ?? defaultOpenMode(view?.viewType);
  if (orderedIds) setPeekList(orderedIds);
  if (mode === 'page') navigate(rowId); else openPeek(rowId, mode);
}

// Values a new row needs to land in a group / match the view's simple filters.
export function valuesForNewRow(result: QueryResult | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const filter = result?.view?.config.filter;
  const rules = filter && 'all' in filter ? filter.all : filter && 'propertyId' in filter ? [filter] : [];
  for (const rule of rules) {
    if (!('propertyId' in rule)) continue;
    const property = result?.properties.find(item => item.id === rule.propertyId);
    if (!property || ['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'title', 'button'].includes(property.type)) continue;
    if (rule.op === 'eq' && rule.value != null && property.type !== 'date') values[property.id] = property.type === 'multi_select' ? [rule.value] : rule.value;
    if (rule.op === 'contains' && rule.value != null && ['multi_select', 'relation', 'person'].includes(property.type)) values[property.id] = [rule.value];
    if (rule.op === 'eq' && property.type === 'checkbox') values[property.id] = rule.value === true;
  }
  return { ...values, ...(result?.defaults ?? {}), ...extra };
}

// Groups as the view shows them. A status grouped "by group" folds its options into the
// three status groups (할 일 · 진행 중 · 완료 and any custom ones), each keyed
// `{"statusGroup":"<name>"}` (group keys are JSON, like the server's); empty groups can be hidden.
export const statusGroupOrder = statusGroupKeys.map(statusGroupName);

export function displayGroups(result: QueryResult, config: ViewConfig, property: PropertyEntity | undefined): QueryGroup[] {
  let groups = result.presentation.groups ?? [];
  if (property?.type === 'status' && (config.statusGrouping ?? 'group') === 'group') {
    const rowOrder = new Map(result.rows.map((row, i) => [row.id, i]));
    const byRow = (a: string, b: string) => (rowOrder.get(a) ?? 0) - (rowOrder.get(b) ?? 0);
    const options = property.options ?? [];
    const labels = [...statusGroupOrder, ...new Set(options.map(statusGroupLabel).filter(label => !statusGroupOrder.includes(label)))];
    const merged = new Map<string, QueryGroup>(labels.map(label => {
      const key = JSON.stringify({ statusGroup: label });
      const first = options.find(option => statusGroupLabel(option) === label);
      return [label, { key, value: first?.id ?? null, rowIds: [], statusGroup: label, hidden: (config.hiddenGroups ?? []).includes(key) }];
    }));
    const rest: QueryGroup[] = [];
    for (const group of groups) {
      const option = options.find(item => item.id === group.value);
      const target = option ? merged.get(statusGroupLabel(option)) : undefined;
      if (!target) { if (group.rowIds.length) rest.push(group); continue; }
      target.rowIds.push(...group.rowIds);
      if (group.subgroups) {
        const subs = target.subgroups ?? (target.subgroups = []);
        for (const sub of group.subgroups) { const same = subs.find(item => item.key === sub.key); if (same) same.rowIds.push(...sub.rowIds); else subs.push({ ...sub, rowIds: [...sub.rowIds] }); }
      }
    }
    for (const group of merged.values()) { group.rowIds.sort(byRow); for (const sub of group.subgroups ?? []) sub.rowIds.sort(byRow); }
    let ordered = [...merged.values()].filter(group => group.value != null || group.rowIds.length);
    if (config.groupSort === 'desc') ordered.reverse();
    else if (config.groupSort === 'manual' || (!config.groupSort && config.groupOrder?.length)) {
      const order = new Map((config.groupOrder ?? []).map((key, i) => [key, i]));
      ordered = ordered.sort((a, b) => (order.get(a.key) ?? order.size) - (order.get(b.key) ?? order.size));
    }
    groups = [...ordered, ...rest];
  }
  if (config.hideEmptyGroups) groups = groups.filter(group => group.rowIds.length);
  return groups;
}

export function groupValue(property: PropertyEntity | undefined, group: QueryGroup): unknown {
  if (!property) return undefined;
  if (property.type === 'multi_select' || property.type === 'relation' || property.type === 'person') return group.value == null ? [] : [group.value];
  return group.value;
}

export async function newRow(result: QueryResult | null, sourceId: string, { values = {}, open = true, title = '', beforeId }: { values?: Record<string, unknown>; open?: boolean | 'side' | 'center' | 'page'; title?: string; beforeId?: string } = {}) {
  const view = result?.view ?? null;
  const mode = open === true ? view?.config.openMode ?? 'side' : open;
  const id = await createRow(sourceId, { values: valuesForNewRow(result, values), title, open: false, beforeId });
  if (mode) openRow(view, id);
  return id;
}

export function filterRules(filter: Filter | null | undefined): Array<{ propertyId: string; op: string; value?: unknown }> | null {
  if (!filter) return [];
  if ('propertyId' in filter) return [filter];
  if ('all' in filter && filter.all.every(item => 'propertyId' in item)) return filter.all as Array<{ propertyId: string; op: string; value?: unknown }>;
  return null; // advanced (nested / OR / NOT)
}

export function sourceOf(sourceId: string) { return workspace.get<SourceEntity>(sourceId); }
export function pageHolding(sourceId: string) { const source = sourceOf(sourceId); return source ? workspace.get<PageEntity>(source.parentId) : undefined; }

// A "full page" database: the page was created together with its database
// and holds nothing else. An inline database added to a page later stays inline.
export function isDatabasePage(page: PageEntity): boolean {
  const children = workspace.children(page.id);
  // A database may hold several data sources (the first one was made with the page).
  const sources = children.filter(child => child.kind === 'source' && workspace.visible(child.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!sources.length) return false;
  // Turned into one or the other (페이지로 전환 · 인라인으로 전환) — that decides.
  if (page.databasePage !== undefined) return page.databasePage;
  if (children.some(child => child.kind === 'block' || (child.kind === 'page' && !(child as PageEntity).sourceId))) return false;
  return Math.abs(Date.parse(sources[0].createdAt) - Date.parse(page.createdAt)) < 5000;
}

export async function createView(sourceId: string, parentId: string, viewType: ViewType, base?: ViewEntity) {
  const id = newId();
  const schema = workspace.schema(sourceId);
  const config: ViewConfig = base ? structuredClone(base.config) : {};
  if (viewType === 'board' && !config.groupBy) config.groupBy = schema.find(property => property.type === 'status')?.id ?? schema.find(property => property.type === 'select')?.id ?? null;
  if ((viewType === 'calendar' || viewType === 'timeline') && !config.datePropertyId) config.datePropertyId = schema.find(property => property.type === 'date')?.id ?? null;
  if (viewType === 'chart' && !config.chart) { const group = config.groupBy ?? schema.find(property => ['status', 'select'].includes(property.type))?.id ?? schema.find(property => property.type === 'title')?.id; if (group) config.chart = { groupBy: group, aggregation: 'count', type: 'bar' }; }
  // A new feed shows no properties (only the title).
  if (viewType === 'feed' && !base) config.visibleProperties = schema.filter(property => property.type === 'title').map(property => property.id);
  if (viewType === 'map' && !config.placePropertyId) config.placePropertyId = schema.find(property => property.type === 'place')?.id ?? null;
  // A new form view is named "양식 빌더"; the others take their layout's name.
  await apply([{ type: 'view.create', id, sourceId, parentId, name: viewType === 'form' ? t("양식 빌더") : viewTypeLabels[viewType], viewType, config }]);
  return id;
}

export const isReadOnlyProperty = (property: PropertyEntity) => ['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(property.type);

// 데이터베이스 잠금: "데이터베이스 잠금" in the view settings locks every
// source of the database — the property headers stop opening, "+" for properties and views go away, and the
// view-name, 그룹, 조건부 색상, 소스, 속성 편집, 변환 and 기타 설정 rows grey out; the breadcrumb shows "🔒 잠김",
// which offers 잠금 해제 (for now, in this window) and 모든 사용자 잠금 해제.
const unlockedForNow = new Set<string>();
const lockListeners = new Set<() => void>();
export function databaseSourceIds(sourceId: string): string[] {
  const source = workspace.get<SourceEntity>(sourceId);
  if (!source?.parentId) return [sourceId];
  const ids = workspace.children(source.parentId).filter(item => item.kind === 'source' && workspace.visible(item.id)).map(item => item.id);
  return ids.includes(sourceId) ? ids : [sourceId];
}
export function isDatabaseLocked(sourceId: string | null | undefined): boolean {
  if (inTimeMachine()) return true;
  if (!sourceId) return false;
  return !!workspace.get<SourceEntity>(sourceId)?.locked && !unlockedForNow.has(sourceId);
}
export function useDatabaseLock(sourceId: string | null | undefined) {
  useWorkspace();
  const [, force] = useState(0);
  useEffect(() => { const listener = () => force(n => n + 1); lockListeners.add(listener); return () => { lockListeners.delete(listener); }; }, []);
  const stored = !!sourceId && !!workspace.get<SourceEntity>(sourceId)?.locked;
  return { locked: isDatabaseLocked(sourceId), stored, unlockedForNow: stored && !!sourceId && unlockedForNow.has(sourceId) };
}
export function setDatabaseLock(sourceId: string, locked: boolean) {
  const ids = databaseSourceIds(sourceId);
  for (const id of ids) unlockedForNow.delete(id);
  lockListeners.forEach(listener => listener());
  return apply(ids.map(id => ({ type: 'source.update', id, locked }) as Operation)).then(() => setStatus(locked ? t("데이터베이스를 잠갔습니다.") : t("데이터베이스 잠금을 해제했습니다."))).catch(report);
}
export function unlockDatabaseForNow(sourceId: string, unlock = true) {
  for (const id of databaseSourceIds(sourceId)) { if (unlock) unlockedForNow.add(id); else unlockedForNow.delete(id); }
  lockListeners.forEach(listener => listener());
}
