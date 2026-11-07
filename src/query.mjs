import {isText,textValue} from './formula-values.mjs';
import { children, createReader, properties, visible,relationDisplay, isArchived, sprintToken } from './workspace.mjs';
import { filterSchema, requireThat } from './contracts.mjs';
import { isEmpty } from './formula.mjs';
import { taskMetadata, taskPresentation, nestTaskRows } from './tasks.mjs';
import {aggregate} from './aggregation.mjs';
import {matchesRelative} from './relative-date.mjs';

const normalize = value => (isText(value)?textValue(value):String(value ?? '')).normalize('NFKC').toLocaleLowerCase();
const same = (a, b) => JSON.stringify(isText(a)?textValue(a):a) === JSON.stringify(isText(b)?textValue(b):b);
const scalar = value => isText(value)?textValue(value):value && typeof value === 'object' && !Array.isArray(value) ? value.start ?? value.name ?? JSON.stringify(value) : value;
function compare(a, b) {
  if (same(a, b)) return 0;
  if (isEmpty(a)) return 1;
  if (isEmpty(b)) return -1;
  a = scalar(a); b = scalar(b);
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ko', { numeric: true });
}
function compareProperty(a, b, property) {
  if (!['select', 'multi_select', 'status'].includes(property?.type)) return compare(a, b);
  const order = new Map((property.options ?? []).map((option, index) => [option.id, index]));
  const ranks = value => (Array.isArray(value) ? value : [value]).map(id => order.get(id) ?? order.size).sort((x, y) => x - y);
  const left = ranks(a), right = ranks(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
export function matchesFilter(filter, values,now) {
  if (!filter) return true;
  if (filter.all) return filter.all.every(child => matchesFilter(child, values,now));
  if (filter.any) return filter.any.some(child => matchesFilter(child, values,now));
  if (filter.not) return !matchesFilter(filter.not, values,now);
  let current = values[filter.propertyId]; const expected = filter.value;
  // A rule still waiting for its value filters nothing (adding a filter doesn't hide rows
  // until something is chosen or typed).
  if (!['empty', 'not_empty'].includes(filter.op) && (expected === undefined || expected === null || expected === '' || (Array.isArray(expected) && !expected.length))) return true;
  if (current?.error) return false;
  // "종료일": compare the range's end (a single date is its own end).
  if (filter.end && current?.start) current = { start: current.end ?? current.start };
  // Dates against a day (YYYY-MM-DD): compared by day, in the date's own offset.
  const day = current?.start ? current.start.slice(0, 10) : null;
  const wantDay = typeof expected === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expected) ? expected : null;
  if (day && wantDay && ['eq', 'neq', 'before', 'after', 'gte', 'lte'].includes(filter.op)) {
    switch (filter.op) {
      case 'eq': return day === wantDay;
      case 'neq': return day !== wantDay;
      case 'before': return day < wantDay;
      case 'after': return day > wantDay;
      case 'lte': return day <= wantDay;
      case 'gte': return day >= wantDay;
    }
  }
  if (filter.op === 'within') {
    const range = expected && typeof expected === 'object' ? expected : {};
    if (!range.start && !range.end) return true;
    if (!day) return false;
    return (!range.start || day >= String(range.start).slice(0, 10)) && (!range.end || day <= String(range.end).slice(0, 10));
  }
  switch (filter.op) {
    case 'empty': return isEmpty(current);
    case 'not_empty': return !isEmpty(current);
    case 'eq': return current?.start && typeof expected === 'string' ? expected.length === 10 ? current.start.slice(0, 10) === expected : Date.parse(current.start) === Date.parse(expected) : same(current, expected);
    case 'neq': return !matchesFilter({ ...filter, op: 'eq' }, values);
    case 'contains': return Array.isArray(current) ? current.some(value => same(value, expected)) : normalize(current).includes(normalize(expected));
    case 'not_contains': return !matchesFilter({ ...filter, op: 'contains' }, values);
    case 'in': return Array.isArray(expected) && expected.some(value => same(value, current));
    case 'not_in': return Array.isArray(expected) && !expected.some(value => same(value, current));
    case 'starts_with': return normalize(current).startsWith(normalize(expected));
    case 'ends_with': return normalize(current).endsWith(normalize(expected));
    case 'gt': return !isEmpty(current) && compare(current, expected) > 0;
    case 'gte': return !isEmpty(current) && compare(current, expected) >= 0;
    case 'lt': return !isEmpty(current) && compare(current, expected) < 0;
    case 'lte': return !isEmpty(current) && compare(current, expected) <= 0;
    case 'before': return !isEmpty(current) && Date.parse(scalar(current)) < Date.parse(scalar(expected));
    case 'after': return !isEmpty(current) && Date.parse(scalar(current)) > Date.parse(scalar(expected));
    // "시작일" compares a range's start ("종료일" its end, above), as the other date conditions do.
    case 'relative': return matchesRelative(current?.start ? { start: current.start } : current, expected, now);
  }
  return false;
}
function searchable(state, page, values, schema) {
  const pieces = [page.title];
  for (const property of schema) {
    const value = values[property.id];
    if (value?.error || value == null) continue;
    if (property.type === 'relation') pieces.push(...value.map(id => state.get(id)?.title ?? ''));
    else if (['select', 'status', 'multi_select'].includes(property.type)) {
      for (const id of Array.isArray(value) ? value : [value]) pieces.push(property.options?.find(option => option.id === id)?.name ?? '');
    } else if (property.type === 'unique_id' && property.idPrefix) pieces.push(`${property.idPrefix}-${value}`);
    else pieces.push(isText(value)?textValue(value):typeof value==='object'?JSON.stringify(value):String(value));
  }
  return pieces.join('\n');
}
function grouped(rows, propertyId) {
  const groups = new Map();
  for (const row of rows) {
    const raw = propertyId ? row.values[propertyId] : null;
    const values = Array.isArray(raw) ? raw.length ? raw : [null] : [raw ?? null];
    for (const value of values) {
      const key = JSON.stringify(value);
      if (!groups.has(key)) groups.set(key, { key, value, rowIds: [] });
      groups.get(key).rowIds.push(row.id);
    }
  }
  return [...groups.values()];
}
export function querySource(state, input) {
  const view = input.viewId ? state.get(input.viewId) : null;
  requireThat(!input.viewId || view?.kind === 'view' && visible(state, view.id), 'NOT_FOUND', '보기를 찾을 수 없습니다.');
  const sourceId = view?.sourceId ?? input.sourceId, source = state.get(sourceId);
  requireThat(source?.kind === 'source' && visible(state, sourceId), 'NOT_FOUND', '데이터 소스를 찾을 수 없습니다.');
  const config = view?.config ?? {}, schema = properties(state, sourceId), read = createReader(state);
  if (input.filter) filterSchema.parse(input.filter);
  const rawFilter = input.filter && config.filter ? { all: [config.filter, input.filter] } : input.filter ?? config.filter;
  // Sprint views name "the current sprint" ($currentSprint) rather than one sprint page.
  const tokens = node => !node ? node : node.all ? { all: node.all.map(tokens) } : node.any ? { any: node.any.map(tokens) } : node.not ? { not: tokens(node.not) }
    : typeof node.value === 'string' && /^\$(current|next)Sprint$/.test(node.value) ? { ...node, value: sprintToken(state, sourceId, node.value) ?? '∅' } : node;
  const filter = source.tasks?.sprints?.enabled ? tokens(rawFilter) : rawFilter;
  function validateFilter(node) {
    if (!node) return;
    if (node.all || node.any) (node.all ?? node.any).forEach(validateFilter);
    else if (node.not) validateFilter(node.not);
    else requireThat(schema.some(property => property.id === node.propertyId), 'QUERY_PROPERTY', '필터 속성이 없거나 삭제됐습니다.', { propertyId: node.propertyId });
  }
  validateFilter(filter);
  const search = normalize(input.search ?? config.search ?? '');
  // Archived rows (보관됨) stay out of views unless asked for.
  const allRows = [...state.values()].filter(entity => entity.kind === 'page' && entity.sourceId === sourceId && !entity.template && visible(state, entity.id) && (input.includeArchived || !entity.archived)).map(page => ({
    id: page.id, title: page.title, version: page.version, position: page.position,coverAttachmentId:page.coverAttachmentId,
    values: Object.fromEntries(schema.map(property => [property.id, read(page.id, property.id)])),
    relationDisplay:relationDisplay(state,page,read),
    // Formatted text values as their runs (the values above hold the plain words).
    ...(schema.some(property => property.type === 'text' && Array.isArray(page.values?.[property.id])) ? { rich: Object.fromEntries(schema.filter(property => property.type === 'text' && Array.isArray(page.values?.[property.id])).map(property => [property.id, page.values[property.id]])) } : {}),
    ...(source.tasks ? { task: taskMetadata(state, page, visible) } : {}),
  }));
  const taskDisplay = taskPresentation(source, view?.viewType ?? 'table', config);
  let rows = allRows.filter(row => matchesFilter(filter, row.values) && (!search || normalize(searchable(state, row, row.values, schema)).includes(search)) &&
    (taskDisplay.include === 'all' || (taskDisplay.include === 'parents' ? !row.task?.parentId : !!row.task?.parentId)));
  const sorts = config.sorts ?? [];
  const compareRows = (a, b) => {
    for (const sort of sorts) {
      const av = a.values[sort.propertyId], bv = b.values[sort.propertyId];
      const emptyA = isEmpty(av), emptyB = isEmpty(bv);
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      const result = compareProperty(av, bv, schema.find(property => property.id === sort.propertyId));
      if (result) return result * (sort.direction === 'desc' ? -1 : 1);
    }
    return a.position - b.position || a.id.localeCompare(b.id);
  };
  rows.sort(compareRows); allRows.sort(compareRows);
  // 조건부 색상: per row, the first matching rule's colour for the whole row and per property for single cells.
  // "옵션 색과 일치" takes the colour of the row's own option (the first one for several).
  if (config.conditionalColors?.length) for (const row of allRows) {
    const colors = {};
    for (const rule of config.conditionalColors) {
      const property = schema.find(item => item.id === rule.propertyId);
      if (!property || !matchesFilter({ propertyId: rule.propertyId, op: rule.op, ...(rule.value !== undefined ? { value: rule.value } : {}) }, row.values)) continue;
      let color = rule.color ?? 'green';
      if (rule.matchOption !== false && property.options) {
        const value = row.values[rule.propertyId], first = Array.isArray(value) ? value[0] : value;
        const option = property.options.find(item => item.id === first);
        color = option ? option.color ?? 'default' : rule.color ?? 'default';
      }
      if (color === 'default') continue;
      if ((rule.applyTo ?? 'row') === 'row') colors.row ??= color;
      else { colors.cells ??= {}; colors.cells[rule.propertyId] ??= color; }
    }
    if (colors.row || colors.cells) row.colors = colors;
  }
  const total = rows.length, presentation = { type: view?.viewType ?? 'table' };
  const presentationRows = taskDisplay.display === 'nested' ? nestTaskRows(allRows, rows) : rows;
  if (source.tasks?.subitems?.enabled) presentation.subitems = taskDisplay;
  presentation.columnAggregations=Object.fromEntries(Object.entries(config.columnAggregations??{}).map(([id,operation])=>{try{return [id,aggregate(rows.map(row=>row.values[id]),operation)]}catch(error){return [id,{error:{code:error.code,message:error.message}}]}}));
  if (source.tasks?.dependencies?.enabled) presentation.dependencies = presentationRows.flatMap(row => row.task.predecessors.map(predecessor => ({ predecessorId: predecessor.id, successorId: row.id, predecessorTitle: predecessor.title, successorTitle: row.title })));
  if (config.groupBy || presentation.type === 'board') {
    const property = state.get(config.groupBy ?? schema.find(property => property.type === 'status')?.id);
    presentation.groupPropertyId = property?.id ?? null;
    presentation.groups = grouped(rows, property?.id);
    if (presentation.type === 'board' && property?.options) {
      const groups = new Map(presentation.groups.map(group => [group.key, group]));
      presentation.groups = [...property.options.map(option => option.id), null].map(value => groups.get(JSON.stringify(value)) ?? { key: JSON.stringify(value), value, rowIds: [] });
    }
    // Group order: option order (ascending) by default, reversed for "desc", the saved order for "manual" (or when only an order was saved).
    if (config.groupSort === 'desc') { const empty = presentation.groups.filter(group => group.value == null); presentation.groups = [...presentation.groups.filter(group => group.value != null).reverse(), ...empty]; }
    else if (config.groupSort !== 'asc') { const order=new Map((config.groupOrder??[]).map((key,i)=>[key,i]));if(order.size)presentation.groups.sort((a,b)=>(order.get(a.key)??order.size)-(order.get(b.key)??order.size)); }
    for(const group of presentation.groups){group.hidden=(config.hiddenGroups??[]).includes(group.key);if(config.subgroupBy)group.subgroups=grouped(rows.filter(row=>group.rowIds.includes(row.id)),config.subgroupBy);}
  }
  if (['calendar', 'timeline'].includes(presentation.type)) {
    const dateId = config.datePropertyId ?? schema.find(property => property.type === 'date')?.id;
    presentation.datePropertyId = dateId ?? null;
    presentation.items = presentationRows.filter(row => row.values[dateId]?.start).map(row => ({ rowId: row.id, ...row.values[dateId], end: row.values[config.endDatePropertyId]?.start ?? row.values[dateId].end ?? row.values[dateId].start }));
    presentation.undated = presentationRows.filter(row => !row.values[dateId]?.start).map(row => row.id);
  }
  if (presentation.type === 'chart') {
    const chart = config.chart ?? { groupBy: config.groupBy ?? schema.find(property => property.type === 'status')?.id, aggregation: 'count' };
    const rowIndex = new Map(rows.map(row => [row.id, row]));
    const groupProperty = state.get(chart.groupBy);
    // One value per group: a count, or an aggregate of a property (numeric ones need numbers: others are reported, not guessed).
    const numeric = ['sum', 'average', 'median', 'min', 'max', 'range'].includes(chart.aggregation);
    const measure = members => {
      if (chart.aggregation === 'count') return members.length;
      if (!chart.valuePropertyId) return { error: { code: 'CHART_TYPE', message: '숫자 집계에는 숫자 값이 필요합니다.' } };
      const values = members.map(row => row.values[chart.valuePropertyId]);
      if (numeric && values.some(value => !isEmpty(value) && typeof value !== 'number')) return { error: { code: 'CHART_TYPE', message: '숫자 집계에는 숫자 값이 필요합니다.' } };
      try { const result = aggregate(values, chart.aggregation); return Array.isArray(result) ? result.length : result; }
      catch (error) { return { error: { code: error.code ?? 'CHART_TYPE', message: error.message } }; }
    };
    // X-axis buckets: a status axis by its groups (할 일 · 진행 중 · 완료) or options; a date
    // axis by relative period, day, week, month or year. The bucket replaces the value only for grouping.
    const statusGroups = groupProperty?.type === 'status' && chart.statusGrouping === 'group';
    const dateAxis = ['date', 'created_time', 'last_edited_time'].includes(groupProperty?.type) && chart.dateGrouping;
    const statusKey = id => { const option = groupProperty.options?.find(item => item.id === id); return option ? statusKind(option) : null; };
    const dayOf = value => { const iso = typeof value === 'string' ? value : value?.start; return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null; };
    const shift = (day, days) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    const today = new Date().toISOString().slice(0, 10);
    const bucketOf = value => {
      const day = dayOf(value);
      if (!day) return null;
      if (dateAxis === 'day') return day;
      if (dateAxis === 'month') return day.slice(0, 7);
      if (dateAxis === 'year') return day.slice(0, 4);
      if (dateAxis === 'week') { const d = new Date(`${day}T00:00:00Z`); return shift(day, -((d.getUTCDay() + 6) % 7)); }
      const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
      return diff === 0 ? 'today' : diff === -1 ? 'yesterday' : diff === 1 ? 'tomorrow' : diff < 0 && diff >= -7 ? 'past_7' : diff > 0 && diff <= 7 ? 'next_7' : diff < 0 && diff >= -30 ? 'past_30' : diff > 0 && diff <= 30 ? 'next_30' : day.slice(0, 7);
    };
    const relativeOrder = ['past_30', 'past_7', 'yesterday', 'today', 'tomorrow', 'next_7', 'next_30'];
    const bucketRange = key => {
      if (/^\d{4}$/.test(key)) return [`${key}-01-01`, `${Number(key) + 1}-01-01`];
      if (/^\d{4}-\d{2}$/.test(key)) { const d = new Date(`${key}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return [`${key}-01`, d.toISOString().slice(0, 10)]; }
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return [key, shift(key, dateAxis === 'week' ? 7 : 1)];
      return { today: [today, shift(today, 1)], yesterday: [shift(today, -1), today], tomorrow: [shift(today, 1), shift(today, 2)], past_7: [shift(today, -7), shift(today, -1)], next_7: [shift(today, 2), shift(today, 8)], past_30: [shift(today, -30), shift(today, -7)], next_30: [shift(today, 8), shift(today, 31)] }[key];
    };
    const derive = statusGroups ? statusKey : dateAxis ? bucketOf : null;
    const groupRows = derive ? rows.map(row => ({ ...row, values: { ...row.values, [chart.groupBy]: derive(row.values[chart.groupBy]) } })) : rows;
    // Order of buckets: status groups as listed; relative periods around today with older months before and later ones after.
    const order = value => statusGroups ? ['todo', 'in_progress', 'complete'].indexOf(value) : dateAxis === 'relative' ? (relativeOrder.includes(value) ? relativeOrder.indexOf(value) : String(value) < today.slice(0, 7) ? -1 : 7) : null;
    let groups = grouped(groupRows, chart.groupBy);
    // Natural order: option order for select/status (rows without a value first), otherwise ascending values.
    groups.sort((a, b) => {
      if (isEmpty(a.value) !== isEmpty(b.value)) return isEmpty(a.value) ? -1 : 1;
      const oa = order(a.value), ob = order(b.value);
      if (oa != null && ob != null && oa !== ob) return oa - ob;
      return derive ? String(a.value).localeCompare(String(b.value)) : compareProperty(a.value, b.value, groupProperty);
    });
    const bars = groups.map(group => {
      const members = group.rowIds.map(id => rowIndex.get(id));
      const errors = members.filter(row => chart.valuePropertyId && numeric && !isEmpty(row.values[chart.valuePropertyId]) && typeof row.values[chart.valuePropertyId] !== 'number').map(row => row.id);
      const groupType = groupProperty?.type;
      let groupFilter = chart.groupBy ? { propertyId: chart.groupBy, op: isEmpty(group.value) ? 'empty' : ['multi_select', 'relation', 'person', 'files'].includes(groupType) ? 'contains' : 'eq', value: group.value } : null;
      if (statusGroups && !isEmpty(group.value)) groupFilter = { propertyId: chart.groupBy, op: 'in', value: (groupProperty.options ?? []).filter(option => statusKey(option.id) === group.value).map(option => option.id) };
      if (dateAxis && !isEmpty(group.value)) { const [from, to] = bucketRange(group.value) ?? []; groupFilter = from ? { all: [{ propertyId: chart.groupBy, op: 'gte', value: { start: from } }, { propertyId: chart.groupBy, op: 'lt', value: { start: to } }] } : null; }
      const stacks = chart.stackBy ? grouped(members, chart.stackBy).sort((a, b) => isEmpty(a.value) !== isEmpty(b.value) ? (isEmpty(a.value) ? -1 : 1) : compareProperty(a.value, b.value, state.get(chart.stackBy))).map(stack => ({ key: stack.key, group: stack.value, rowIds: stack.rowIds, value: measure(stack.rowIds.map(id => rowIndex.get(id))) })) : undefined;
      return { ...group, group: group.value, count: members.length, value: measure(members), errors, stacks, hidden: (chart.hiddenGroups ?? []).includes(group.key), drilldown: filter && groupFilter ? { all: [filter, groupFilter] } : groupFilter ?? filter ?? null };
    });
    const number = bar => typeof bar.value === 'number' ? bar.value : -Infinity;
    const sort = chart.sort ?? 'asc';
    // Equal values fall back to the groups' names in alphabetical order (three tied tags whose
    // options are listed 디자인 · 개발 · 조사 show as 개발 · 디자인 · 조사).
    const nameOf = bar => { const ids = Array.isArray(bar.group) ? bar.group : [bar.group]; return ids.map(id => groupProperty?.options?.find(option => option.id === id)?.name ?? String(id ?? '')).join(', '); };
    const tie = (a, b) => isEmpty(a.group) !== isEmpty(b.group) ? (isEmpty(a.group) ? -1 : 1) : nameOf(a).localeCompare(nameOf(b));
    if (sort === 'desc') { const empty = bars.filter(bar => isEmpty(bar.group)); bars.splice(0, bars.length, ...bars.filter(bar => !isEmpty(bar.group)).reverse(), ...empty); }
    else if (sort === 'valueAsc') bars.sort((a, b) => number(a) - number(b) || tie(a, b));
    else if (sort === 'valueDesc') bars.sort((a, b) => number(b) - number(a) || tie(a, b));
    else if (sort === 'manual') { const order = new Map((chart.groupOrder ?? []).map((key, i) => [key, i])); bars.sort((a, b) => (order.get(a.key) ?? order.size) - (order.get(b.key) ?? order.size)); }
    // "누적": each bar carries the running total of the bars before it, in the order shown.
    if (chart.cumulative) { let running = 0; for (const bar of bars) if (typeof bar.value === 'number' && !bar.hidden) { running += bar.value; bar.value = running; } }
    presentation.bars = bars;
    // The whole set's value (the donut's centre and the number chart).
    presentation.total = measure(rows);
  }
  if (presentation.type === 'map') {
    const placeId = config.placePropertyId ?? schema.find(property => property.type === 'place')?.id;
    presentation.points = rows.filter(row => row.values[placeId]).map(row => ({ rowId: row.id, ...row.values[placeId] }));
    presentation.unlocated = rows.filter(row => !row.values[placeId]).map(row => row.id);
    presentation.basemap = 'not-configured';
  }
  if (presentation.type === 'form') presentation.fields = (config.visibleProperties ?? schema.map(property => property.id)).map(id => schema.find(property => property.id === id)).filter(property => property && !['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(property.type));
  if (presentation.type === 'dashboard') presentation.widgets = config.widgets ?? [];
  const offset = Math.max(Number(input.offset) || 0, 0), limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
  rows = rows.slice(offset, offset + limit);
  const hasMore = offset + rows.length < total;
  if (taskDisplay.display === 'nested') rows = nestTaskRows(allRows, rows);
  return { source, view, properties: schema, visibleProperties: config.visibleProperties ?? schema.map(property => property.id), rows, total, offset, hasMore, presentation };
}

function textBlocks(state, parentId, visited = new Set()) {
  if (visited.has(parentId)) return [];
  visited.add(parentId);
  const result = [];
  for (const child of children(state, parentId).filter(child => child.kind === 'block' && child.alive)) {
    const text = [...(child.richText ?? []),...(child.cells?.flat(2)??[])].map(run => run.text).join('');
    if (text) result.push({ id: child.id, text });
    result.push(...textBlocks(state, child.blockType === 'synced_reference' ? child.sourceBlockId : child.id, new Set(visited)));
  }
  return result;
}
// The files of a page: attachments in its body (file, PDF, image, audio and video blocks, nested and synced too) and
// in its file properties, each once.
function pageFiles(state, page, schema) {
  const found = new Map();
  const add = (attachmentId, blockId) => { const file = state.get(attachmentId); if (file?.kind === 'attachment' && file.alive !== false && !found.has(file.id)) found.set(file.id, { file, blockId }); };
  const walk = (parentId, visited) => {
    if (visited.has(parentId)) return;
    visited.add(parentId);
    for (const child of children(state, parentId)) {
      if (child.kind !== 'block' || !child.alive) continue;
      if (child.attachmentId) add(child.attachmentId, child.id);
      walk(child.blockType === 'synced_reference' ? child.sourceBlockId : child.id, new Set(visited));
    }
  };
  walk(page.id, new Set());
  for (const property of schema) if (property.type === 'files') for (const id of page.values?.[property.id] ?? []) add(id, null);
  return [...found.values()];
}
// A line of a file's text around the first word found.
function fileExcerpt(entry, terms) {
  let at = -1, size = 0;
  for (const term of terms) { const index = entry.folded.indexOf(term.text); if (index >= 0 && (at < 0 || index < at)) { at = index; size = term.text.length; } }
  if (at < 0) return entry.text.slice(0, 160);
  const text = entry.folded.length === entry.text.length ? entry.text : entry.folded;
  let start = Math.max(0, at - 60), end = Math.min(text.length, at + size + 100);
  const lineStart = text.lastIndexOf('\n', at), lineEnd = text.indexOf('\n', at + size);
  if (lineStart >= start) start = lineStart + 1;
  if (lineEnd >= 0 && lineEnd < end && lineEnd - start > 40) end = lineEnd;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}
// The words of a query: "quoted phrases" stay whole, other words are matched one by one (all must appear).
export function searchTerms(query) {
  const terms = [];
  for (const match of String(query ?? '').matchAll(/"([^"]*)"|“([^”]*)”|(\S+)/g)) {
    const term = normalize(match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (term) terms.push({ text: term, phrase: match[1] !== undefined || match[2] !== undefined });
  }
  return terms;
}
const dayOf = iso => String(iso ?? '').slice(0, 10);
// 검색 (⌘K): pages whose title, properties or content hold every word (or "the exact phrase"). Filters: titleOnly,
// withinIds (those pages and everything under them), a created/edited date range (YYYY-MM-DD, inclusive), archived
// ('exclude' by default, 'include', 'only'); sort by best match or by edited/created time. With no words but a
// filter, every page the filters let through is listed.
// fileText (sha256 → { text, folded }) adds what attached files say (첨부 파일 내용 검색): a page matches when its words
// are in it or in its files, and lists the files that matched with a line of each.
export function searchWorkspace(state, { query = '', titleOnly = false, sourceId, pageId, limit = 50, withinIds, dateField = 'edited', from, to, archived = 'exclude', sort = 'relevance' }, { fileText = null } = {}) {
  const terms = searchTerms(query), needle = normalize(query).trim(), results = [], blocks = [], read = createReader(state);
  const filtered = (withinIds?.length ?? 0) > 0 || !!from || !!to || archived !== 'exclude';
  requireThat(terms.length > 0 || filtered, 'SEARCH_QUERY', '검색어를 입력하세요.');
  const within = withinIds?.length ? new Set(withinIds) : null;
  const inside = page => {
    if (!within) return true;
    const seen = new Set();
    for (let item = page; item && !seen.has(item.id); item = item.parentId ? state.get(item.parentId) : null) { seen.add(item.id); if (within.has(item.id)) return true; }
    return false;
  };
  const has = (text, term) => normalize(text).includes(term.text);
  for (const page of state.values()) {
    if (page.kind !== 'page' || page.template || !visible(state, page.id) || sourceId && page.sourceId !== sourceId || pageId && page.id !== pageId) continue;
    const archivedPage = isArchived(state, page.id);
    if (archived === 'exclude' && archivedPage || archived === 'only' && !archivedPage) continue;
    if (!inside(page)) continue;
    const when = dayOf(dateField === 'created' ? page.createdAt : page.updatedAt);
    if (from && when < from || to && when > to) continue;
    const schema = page.sourceId ? properties(state, page.sourceId) : [];
    const values = Object.fromEntries(schema.map(property => [property.id, read(page.id, property.id)]));
    const body = titleOnly || !terms.length ? [] : textBlocks(state, page.id);
    const full = titleOnly ? page.title : searchable(state, page, values, schema);
    // "TASK-12" finds the row whose unique ID is 12 under the prefix TASK, even in a title-only search.
    const idMatch = !!needle && schema.some(property => property.type === 'unique_id' && property.idPrefix && normalize(`${property.idPrefix}-${values[property.id]}`) === needle);
    const everywhere = [full, ...body.map(block => block.text)].join('\n');
    const files = fileText && !titleOnly && terms.length ? pageFiles(state, page, schema).map(item => ({ ...item, entry: fileText(item.file.sha256) })).filter(item => item.entry) : [];
    if (terms.length && !idMatch && !terms.every(term => has(everywhere, term) || files.some(item => item.entry.folded.includes(term.text)))) continue;
    const matchedFiles = files.filter(item => terms.some(term => item.entry.folded.includes(term.text)));
    const matchedBlocks = terms.length ? body.filter(block => terms.some(term => has(block.text, term))) : [];
    const titleAll = terms.length > 0 && terms.every(term => has(page.title, term));
    const score = (idMatch ? 100 : 0) + (titleAll ? 50 : 0) + (needle && normalize(page.title) === needle ? 30 : 0) + (needle && normalize(page.title).startsWith(needle) ? 10 : 0)
      + terms.filter(term => has(page.title, term)).length * 5 + Math.min(matchedBlocks.length, 5) + Math.min(matchedFiles.length, 3);
    results.push({ id: page.id, title: page.title, titleMatch: idMatch || titleAll, score, excerpt: (matchedBlocks[0]?.text ?? full).slice(0, 280), location: `/?id=${encodeURIComponent(page.id)}`,
      createdAt: page.createdAt, updatedAt: page.updatedAt, ...(archivedPage ? { archived: true } : {}),
      ...(matchedFiles.length ? { files: matchedFiles.slice(0, 3).map(item => ({ id: item.file.id, name: item.file.name, mediaType: item.file.mediaType, blockId: item.blockId, excerpt: fileExcerpt(item.entry, terms) })) } : {}) });
    if (pageId) blocks.push(...matchedBlocks);
  }
  const byTime = (key, direction) => (a, b) => direction * a[key].localeCompare(b[key]);
  const order = sort === 'edited_desc' ? byTime('updatedAt', -1) : sort === 'edited_asc' ? byTime('updatedAt', 1) : sort === 'created_desc' ? byTime('createdAt', -1) : sort === 'created_asc' ? byTime('createdAt', 1)
    : (a, b) => b.score - a.score || Number(b.titleMatch) - Number(a.titleMatch) || b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, 'ko');
  results.sort(order);
  return { query, titleOnly, total: results.length, results: results.slice(0, Math.min(Math.max(Number(limit) || 50, 1), 200)).map(({ score, ...result }) => result), blocks };
}
// The status of an option by its group: complete, in progress or to do (groups are named in any language).
export function statusKind(option) {
  const group = `${option?.group ?? ''}`.toLowerCase();
  return /complete|done|완료|完了|已完成|完成|termin|abgeschlossen|erledigt|conclu|complet|hecho|fait/.test(group) ? 'complete' : /progress|doing|진행|進行|进行|curso|cours|bearbeitung|andamento/.test(group) ? 'in_progress' : 'todo';
}
// 내 작업 (My Tasks): the rows of every task database — one with a status property, or set up for sub-items and
// dependencies — by due date. A row is done when its status is in the complete group. assignee keeps the rows whose
// person property names that person (people are names here; there is one user).
export function listTasks(state, { includeDone = false, assignee = null, sourceId = null, limit = 200 } = {}) {
  const read = createReader(state), sources = [];
  for (const source of state.values()) {
    if (source.kind !== 'source' || !visible(state, source.id) || sourceId && source.id !== sourceId) continue;
    const schema = properties(state, source.id);
    const status = schema.find(property => property.type === 'status');
    if (!status && !source.tasks) continue;
    const dates = schema.filter(property => property.type === 'date');
    const date = dates.find(property => property.id === source.tasks?.dependencies?.datePropertyId) ?? dates.find(property => /due|deadline|마감|기한|期限|截止|fällig|échéance|vencimiento|prazo/i.test(property.name)) ?? dates[0] ?? null;
    const person = schema.find(property => property.type === 'person') ?? null;
    let page = state.get(source.parentId);
    while (page && page.kind !== 'page') page = state.get(page.parentId);
    sources.push({ id: source.id, name: source.name, pageId: page?.id ?? null, statusPropertyId: status?.id ?? null, datePropertyId: date?.id ?? null, personPropertyId: person?.id ?? null, options: status?.options ?? [] });
  }
  const bySource = new Map(sources.map(source => [source.id, source]));
  const tasks = [];
  for (const page of state.values()) {
    const source = page.kind === 'page' && !page.template && bySource.get(page.sourceId);
    if (!source || !visible(state, page.id) || isArchived(state, page.id)) continue;
    const option = source.statusPropertyId ? source.options.find(item => item.id === read(page.id, source.statusPropertyId)) ?? null : null;
    const done = option ? statusKind(option) === 'complete' : false;
    if (done && !includeDone) continue;
    const people = source.personPropertyId ? (read(page.id, source.personPropertyId) ?? []) : [];
    if (assignee && !people.includes(assignee)) continue;
    const due = source.datePropertyId ? read(page.id, source.datePropertyId) : null;
    tasks.push({ id: page.id, title: page.title, icon: page.icon ?? null, sourceId: source.id, status: option ? { ...option, kind: statusKind(option) } : null,
      due: due?.start ? due : null, assignees: people, done, createdAt: page.createdAt, updatedAt: page.updatedAt });
  }
  const dueKey = task => task.due ? String(task.due.end ?? task.due.start) : '9999';
  tasks.sort((a, b) => Number(a.done) - Number(b.done) || dueKey(a).localeCompare(dueKey(b)) || a.createdAt.localeCompare(b.createdAt));
  return { sources, total: tasks.length, tasks: tasks.slice(0, Math.min(Math.max(Number(limit) || 200, 1), 1000)) };
}
