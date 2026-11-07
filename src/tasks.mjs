import { requireThat } from './contracts.mjs';

const rowsOf = (state, sourceId) => [...state.values()].filter(item => item.kind === 'page' && item.sourceId === sourceId && !item.template);
export const taskParent = (state, page) => {
  const config = state.get(page.sourceId)?.tasks?.subitems;
  return config?.enabled ? page.values[config.parentPropertyId]?.[0] ?? null : null;
};
export function taskDescendants(state, page) {
  const config = state.get(page.sourceId)?.tasks?.subitems;
  if (!config?.enabled) return [];
  const result = [], seen = new Set([page.id]), pending = [...page.values[config.childrenPropertyId] ?? []];
  for (let i = 0; i < pending.length; i++) {
    const child = state.get(pending[i]);
    if (!child || seen.has(child.id)) continue;
    seen.add(child.id); result.push(child); pending.push(...child.values[config.childrenPropertyId] ?? []);
  }
  return result;
}
export function taskMetadata(state, page, isVisible) {
  const settings = state.get(page.sourceId)?.tasks;
  if (!settings) return null;
  const links = propertyId => (page.values[propertyId] ?? []).filter(id => isVisible(state, id)).map(id => ({ id, title: state.get(id).title }));
  const subitems = settings.subitems, dependencies = settings.dependencies, ancestors = [];
  let parent = taskParent(state, page);
  while (parent && !ancestors.includes(parent)) { ancestors.push(parent); parent = taskParent(state, state.get(parent)); }
  return { parentId: taskParent(state, page), ancestors, children: subitems?.enabled ? links(subitems.childrenPropertyId) : [],
    predecessors: dependencies?.enabled ? links(dependencies.predecessorPropertyId) : [], successors: dependencies?.enabled ? links(dependencies.successorPropertyId) : [] };
}
function topological(rows, propertyId, code) {
  const index = new Map(rows.map(row => [row.id, row])), pending = new Map(), successors = new Map();
  for (const row of rows) {
    const ids = row.values[propertyId] ?? []; pending.set(row.id, ids.length);
    for (const id of ids) {
      requireThat(index.has(id), 'TASK_TARGET', '업무 관계는 같은 데이터베이스의 일반 항목만 연결할 수 있습니다.', { pageId: row.id, targetId: id });
      if (!successors.has(id)) successors.set(id, []);
      successors.get(id).push(row.id);
    }
  }
  const order = rows.filter(row => !pending.get(row.id));
  for (let i = 0; i < order.length; i++) for (const id of successors.get(order[i].id) ?? []) {
    pending.set(id, pending.get(id) - 1); if (!pending.get(id)) order.push(index.get(id));
  }
  requireThat(order.length === rows.length, code, '자기 자신이나 순환하는 업무 관계는 저장할 수 없습니다.', { pageIds: rows.filter(row => pending.get(row.id)).map(row => row.id) });
  return order;
}
export function validateTasks(state) {
  for (const source of state.values()) if (source.kind === 'source' && source.tasks) {
    const rows = rowsOf(state, source.id);
    function pair(config, first, second) {
      if (!config?.enabled) return false;
      const a = state.get(config[first]), b = state.get(config[second]);
      requireThat(a?.alive && b?.alive && a.id !== b.id && [a, b].every(property => property.type === 'relation' && property.sourceId === source.id && property.targetSourceId === source.id) && a.inversePropertyId === b.id && b.inversePropertyId === a.id,
        'TASK_SCHEMA', '업무 구조에 쓰는 두 관계 속성을 유지하세요. 먼저 해당 기능을 끈 뒤 유형을 바꾸거나 삭제할 수 있습니다.');
      for (const row of state.values()) if (row.kind === 'page' && row.sourceId === source.id && row.template) requireThat(!(row.values[a.id]?.length || row.values[b.id]?.length), 'TASK_TEMPLATE', '템플릿을 업무 관계의 대상으로 연결할 수 없습니다.');
      for (const row of rows) for (const id of row.values[a.id] ?? []) requireThat(state.get(id)?.kind === 'page' && !state.get(id).template, 'TASK_TARGET', '일반 업무 항목만 연결하세요.');
      return true;
    }
    const sub = source.tasks.subitems, dep = source.tasks.dependencies;
    if (pair(sub, 'parentPropertyId', 'childrenPropertyId')) {
      requireThat(rows.every(row => (row.values[sub.parentPropertyId] ?? []).length <= 1), 'TASK_PARENT_LIMIT', '상위 항목은 하나만 지정할 수 있습니다.');
      topological(rows, sub.parentPropertyId, 'TASK_PARENT_CYCLE');
    }
    if (pair(dep, 'predecessorPropertyId', 'successorPropertyId')) {
      requireThat(!sub?.enabled || ![sub.parentPropertyId, sub.childrenPropertyId].some(id => [dep.predecessorPropertyId, dep.successorPropertyId].includes(id)), 'TASK_SCHEMA', '상하위 관계와 의존성은 서로 다른 속성을 사용하세요.');
      topological(rows, dep.predecessorPropertyId, 'TASK_DEPENDENCY_CYCLE');
      if (dep.datePropertyId) requireThat(state.get(dep.datePropertyId)?.alive && state.get(dep.datePropertyId).type === 'date' && state.get(dep.datePropertyId).sourceId === source.id, 'TASK_DATE_PROPERTY', '일정 연동 날짜 속성을 유지하세요.');
      requireThat(dep.mode === 'none' || dep.datePropertyId, 'TASK_DATE_PROPERTY', '자동 일정 이동에는 날짜 속성이 필요합니다.');
    }
  }
}
const day = 86400000;
function instant(value) {
  requireThat(typeof value === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(value) || /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) && Number.isFinite(Date.parse(value)), 'TASK_DATE_VALUE', '자동 일정에는 날짜 또는 UTC 오프셋이 있는 시각을 사용하세요.');
  return Date.parse(value);
}
function shiftDate(value, delta) {
  const shift = text => new Date(instant(text) + delta).toISOString().slice(0, text.length === 10 ? 10 : undefined);
  return { ...value, start: shift(value.start), ...(value.end ? { end: shift(value.end) } : {}) };
}
function weekend(value, text) {
  const date = new Date(instant(text));
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: text.length === 10 ? 'UTC' : value.timeZone ?? 'UTC' }).format(date);
  return name === 'Sat' || name === 'Sun';
}
export function scheduleDependencies(state, before, isVisible) {
  for (const source of state.values()) {
    const config = source.kind === 'source' && source.tasks?.dependencies;
    if (!config?.enabled || config.mode === 'none' || !isVisible(state, source.id)) continue;
    const order = topological(rowsOf(state, source.id), config.predecessorPropertyId, 'TASK_DEPENDENCY_CYCLE');
    const explicitlyChanged = new Set(order.filter(row => JSON.stringify(before.get(row.id)?.values[config.datePropertyId]) !== JSON.stringify(row.values[config.datePropertyId])).map(row => row.id));
    for (const row of order) {
      if (!isVisible(state, row.id)) continue;
      const value = row.values[config.datePropertyId]; if (!value) continue;
      const predecessors = (row.values[config.predecessorPropertyId] ?? []).map(id => state.get(id)).filter(item => isVisible(state, item.id) && item.values[config.datePropertyId]);
      if (!predecessors.length) continue;
      const start = instant(value.start), floating = value.start.length === 10, deltas = [];
      let boundary = -Infinity;
      for (const predecessor of predecessors) {
        const current = predecessor.values[config.datePropertyId], end = current.end ?? current.start;
        requireThat((end.length === 10) === floating, 'TASK_DATE_PRECISION', '연동된 일정은 날짜끼리 또는 시각끼리 연결하세요.');
        boundary = Math.max(boundary, instant(end) + (floating ? day : 0));
        const old = before.get(predecessor.id)?.values[config.datePropertyId];
        if (old) { const delta = instant(end) - instant(old.end ?? old.start); if (delta) deltas.push(delta); }
      }
      let nextStart = start;
      if (config.mode === 'preserve' && !explicitlyChanged.has(row.id) && deltas.length) nextStart += Math.max(...deltas);
      nextStart = Math.max(nextStart, boundary);
      if (nextStart === start) continue;
      let next = shiftDate(value, nextStart - start);
      if (config.avoidWeekends) for (let i = 0; i < 7 && (weekend(next, next.start) || weekend(next, next.end ?? next.start)); i++) next = shiftDate(next, day);
      row.values = { ...row.values, [config.datePropertyId]: next };
    }
  }
}

export function taskPresentation(source, viewType, config) {
  if (!source.tasks?.subitems?.enabled) return { display: 'flat', include: 'all' };
  return config.subitems ?? (['table', 'list', 'timeline'].includes(viewType) ? { display: 'nested', include: 'all' } : ['board', 'calendar', 'gallery'].includes(viewType) ? { display: 'card', include: 'parents' } : { display: 'flat', include: 'all' });
}
export function nestTaskRows(allRows, rows) {
  const selected = new Map(rows.map(row => [row.id, row])), index = new Map(allRows.map(row => [row.id, row]));
  for (const row of rows) for (const id of row.task?.ancestors ?? []) if (index.has(id) && !selected.has(id)) selected.set(id, { ...index.get(id), contextOnly: true });
  const children = new Map();
  for (const row of allRows) if (selected.has(row.id)) {
    const parent = selected.has(row.task?.parentId) ? row.task.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(selected.get(row.id));
  }
  const output = [];
  function visit(parent, depth) { for (const row of children.get(parent) ?? []) { output.push({ ...row, depth }); visit(row.id, depth + 1); } }
  visit(null, 0); return output;
}
