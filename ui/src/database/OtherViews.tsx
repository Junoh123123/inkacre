import { t } from '../i18n';
import { useState, type ReactNode } from 'react';
import { report, useWorkspace, workspace } from '../data/store';
import type { Filter, PropertyEntity, QueryGroup, QueryRow, SourceEntity, ViewEntity } from '../data/types';
import { Popover } from '../ui/overlay';
import { FilterEditor } from '../dialogs/filters';
import { useLocalPreference } from '../data/hooks';
import { Icon } from '../ui/Icon';
import { EntityIcon } from '../page/EntityIcon';
import { ValueView, readOnlyTypes } from './values';
import { RowCard } from './BoardView';
import { displayGroups, groupValue, newRow, openRow, shownProperties, updateView } from './shared';
import { GroupLabel } from './TableView';
import type { ViewProps } from './TableView';
import { DatabaseFrame } from './DatabaseFrame';

// List and gallery draw their rows in sections when the view is grouped (same groups, order, hiding and
// collapsing as the table: collapsed groups are kept per view in this browser).
function GroupedSections({ result, view, sourceId, render }: ViewProps & { render: (rows: QueryRow[], values: Record<string, unknown>, group?: QueryGroup) => ReactNode }) {
  const key = view?.id ?? sourceId;
  const [collapsed, setCollapsed] = useLocalPreference<string[]>(`pageyard-group-collapsed:${key}`, []);
  const config = view?.config ?? {};
  if (!result.presentation.groups) return <>{render(result.rows, {})}</>;
  const groupProperty = result.properties.find(property => property.id === (config.groupBy ?? result.presentation.groupPropertyId));
  const index = new Map(result.rows.map(row => [row.id, row]));
  return (
    <div className="grouped-sections">
      {displayGroups(result, config, groupProperty).filter(group => !group.hidden).map(group => {
        const rows = group.rowIds.map(id => index.get(id)).filter((row): row is QueryRow => !!row);
        const isCollapsed = collapsed.includes(group.key);
        const values = groupProperty && !readOnlyTypes.has(groupProperty.type) ? { [groupProperty.id]: groupValue(groupProperty, group) } : {};
        return (
          <section key={group.key} className="view-group" data-group={group.key}>
            <div className="table-group-head">
              <button type="button" className="group-toggle icon-button tiny" aria-label={isCollapsed ? t("펼치기") : t("접기")} onClick={() => setCollapsed(isCollapsed ? collapsed.filter(item => item !== group.key) : [...collapsed, group.key])}><Icon name="triangle-right" size={12} className={isCollapsed ? '' : 'rotated'} /></button>
              <GroupLabel property={groupProperty} group={group} />
              <span className="group-count">{rows.length}</span>
              <span className="group-head-actions">
                <button type="button" className="icon-button tiny" aria-label={t("이 그룹에 새 페이지")} onClick={() => newRow(result, sourceId, { values }).catch(report)}><Icon name="plus" size={14} /></button>
              </span>
            </div>
            {isCollapsed ? null : render(rows, values, group)}
          </section>
        );
      })}
    </div>
  );
}

export function GalleryView(props: ViewProps) {
  const { result, view, sourceId } = props;
  const properties = shownProperties(result);
  const ordered = result.rows.map(row => row.id);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <GroupedSections {...props} render={(rows, values) => (
      <div className={`gallery-view card-${view?.config.cardSize ?? 'medium'}`}>
        {rows.map(row => <RowCard key={row.id} row={row} result={result} view={view} properties={properties} orderedIds={ordered} galleryCover={view?.config.galleryPreview !== 'none'} editing={editing === row.id} onEdited={() => setEditing(null)} />)}
        <button type="button" className="gallery-new" onClick={async () => { const id = await newRow(result, sourceId, { open: false, values }); setEditing(id); }}><Icon name="plus" size={16} /><span>{t("새 페이지")}</span></button>
      </div>
    )} />
  );
}

export function ListView(props: ViewProps) {
  const { result, view, sourceId } = props;
  const properties = shownProperties(result).filter(property => property.type !== 'title');
  const ordered = result.rows.map(row => row.id);
  return (
    <GroupedSections {...props} render={(rows, values) => (
      <div className="list-view">
        {rows.map(row => (
          <a key={row.id} href={`/?id=${encodeURIComponent(row.id)}`} className={`list-row${row.colors?.row ? ` cc-${row.colors.row}` : ''}`} onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); openRow(view, row.id, ordered, { side: event.altKey }); }}>
            {view?.config.showPageIcon === false ? null : <span className="list-icon"><EntityIcon item={workspace.get(row.id)} size={18} /></span>}
            <span className="list-title">{row.title || <span className="title-placeholder">{t("제목 없음")}</span>}</span>
            <span className="list-fields">
              {properties.map(property => {
                const value = row.values[property.id];
                if (property.type === 'checkbox' ? value !== true : value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
                return <span key={property.id} className="list-field"><ValueView property={property} value={value} row={row} mode="card" asCheckbox={property.type === 'status' && !!view?.config.checkboxStatus?.includes(property.id)} /></span>;
              })}
            </span>
          </a>
        ))}
        <button type="button" className="list-new" onClick={() => newRow(result, sourceId, { values }).catch(report)}><Icon name="plus" size={16} /><span>{t("새 페이지")}</span></button>
      </div>
    )} />
  );
}

export { FeedView } from './FeedView';
export { ChartView } from './ChartView';

export { MapView } from './MapView';
export { FormView } from './FormView';

// 대시보드 (dashboards): widgets in rows of up to four (`dashboardRows`; widgets not placed yet fill rows of
// two), "편집" to move a widget left, right, up or down or onto a row of its own, and filters that narrow every
// widget of one data source at once (`dashboardFilters`, keyed by source).
export function dashboardLayout(widgets: string[], rows: string[][] | undefined): string[][] {
  const placed = new Set<string>();
  const result = (rows ?? []).map(row => row.filter(id => widgets.includes(id) && !placed.has(id) && placed.add(id))).filter(row => row.length);
  const rest = widgets.filter(id => !placed.has(id));
  for (let i = 0; i < rest.length; i += 2) result.push(rest.slice(i, i + 2));
  return result;
}
// The shared filter read for another data source: each rule moves to that source's property with the same name and
// type (select, status and multi-select values by option name); a rule with no counterpart there is left out.
export function sharedFilterFor(filter: Filter | null | undefined, fromSourceId: string, toSourceId: string): Filter | null {
  if (!filter) return null;
  if (fromSourceId === toSourceId) return filter;
  const propertiesOf = (sourceId: string) => workspace.children(sourceId).filter(item => item.kind === 'property' && workspace.visible(item.id)) as PropertyEntity[];
  const targets = propertiesOf(toSourceId);
  const walk = (node: Filter): Filter | null => {
    if ('all' in node) { const list = node.all.map(walk).filter((item): item is Filter => !!item); return list.length ? { all: list } : null; }
    if ('any' in node) { const list = node.any.map(walk).filter((item): item is Filter => !!item); return list.length ? { any: list } : null; }
    if ('not' in node) { const inner = walk(node.not); return inner ? { not: inner } : null; }
    const from = workspace.get<PropertyEntity>(node.propertyId);
    const to = from ? targets.find(item => item.type === from.type && item.name.trim().toLocaleLowerCase() === from.name.trim().toLocaleLowerCase()) : undefined;
    if (!from || !to) return null;
    if (['relation', 'person'].includes(from.type) && (from as { targetSourceId?: string }).targetSourceId !== (to as { targetSourceId?: string }).targetSourceId) return null;
    const option = (id: unknown) => { const name = from.options?.find(item => item.id === id)?.name; return name === undefined ? id : to.options?.find(item => item.name === name)?.id ?? id; };
    const value = ['select', 'status', 'multi_select'].includes(from.type) && node.value !== undefined ? (Array.isArray(node.value) ? node.value.map(option) : option(node.value)) : node.value;
    return { ...node, propertyId: to.id, ...(node.value !== undefined ? { value } : {}) } as Filter;
  };
  return walk(filter);
}
export function DashboardView({ result, view }: ViewProps) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [filterFor, setFilterFor] = useState<{ anchor: Element; sourceId: string; shared?: boolean } | null>(null);
  const widgets = (result.presentation.widgets ?? []).map(id => ws.get<ViewEntity>(id)).filter((item): item is ViewEntity => !!item && item.alive);
  if (!widgets.length) return <div className="board-empty"><p>{t("보기 설정에서 대시보드에 넣을 보기를 고르세요.")}</p>{view ? <button type="button" className="outline-button small" onClick={() => updateView(view, { widgets: ws.snapshot.objects.filter(item => item.kind === 'view' && (item as ViewEntity).viewType !== 'dashboard' && ws.visible(item.id)).slice(0, 4).map(item => item.id) })}>{t("보기 4개 자동 추가")}</button> : null}</div>;
  const config = view?.config ?? {};
  const rows = dashboardLayout(widgets.map(widget => widget.id), config.dashboardRows);
  const filters = config.dashboardFilters ?? {};
  // Widget sizes (레이아웃 편집): each widget's share of its row's width and its height in pixels.
  const sizes = config.dashboardSizes ?? {};
  const [dragSize, setDragSize] = useState<Record<string, { width?: number; height?: number }> | null>(null);
  const sizeOf = (id: string) => ({ ...sizes[id], ...dragSize?.[id] });
  const startWidth = (event: React.PointerEvent, row: string[], index: number) => {
    event.preventDefault(); event.stopPropagation();
    const rowElement = (event.currentTarget as HTMLElement).closest('.dashboard-row') as HTMLElement | null;
    if (!rowElement || index >= row.length - 1) return;
    const shares = row.map(id => sizeOf(id).width ?? 1), total = shares.reduce((sum, share) => sum + share, 0);
    const unit = (rowElement.clientWidth - 16 * (row.length - 1)) / total, x0 = event.clientX;
    const a = row[index], b = row[index + 1], pair = shares[index] + shares[index + 1];
    let next: Record<string, { width?: number; height?: number }> = {};
    const move = (e: PointerEvent) => {
      const left = Math.max(0.25, Math.min(pair - 0.25, shares[index] + (e.clientX - x0) / unit));
      const round = (value: number) => Math.round(value * 100) / 100;
      next = { [a]: { ...sizes[a], width: round(left) }, [b]: { ...sizes[b], width: round(pair - left) } };
      setDragSize(next);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (view && Object.keys(next).length) updateView(view, { dashboardSizes: { ...sizes, ...next } }); setDragSize(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const startHeight = (event: React.PointerEvent, id: string) => {
    event.preventDefault(); event.stopPropagation();
    const widget = (event.currentTarget as HTMLElement).closest('.dashboard-widget') as HTMLElement | null;
    const start = widget?.offsetHeight ?? 320, y0 = event.clientY;
    let height = start;
    const move = (e: PointerEvent) => { height = Math.round(Math.max(160, Math.min(1200, start + e.clientY - y0))); setDragSize({ [id]: { ...sizes[id], height } }); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (view && height !== start) updateView(view, { dashboardSizes: { ...sizes, [id]: { ...sizes[id], height } } }); setDragSize(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const sources = [...new Set(widgets.map(widget => widget.sourceId))];
  const save = (next: string[][]) => { if (view) updateView(view, { dashboardRows: next.filter(row => row.length) }); };
  const move = (id: string, direction: 'left' | 'right' | 'up' | 'down' | 'alone') => {
    const next = rows.map(row => [...row]);
    const r = next.findIndex(row => row.includes(id)), c = next[r].indexOf(id);
    if (direction === 'left' && c > 0) [next[r][c - 1], next[r][c]] = [next[r][c], next[r][c - 1]];
    else if (direction === 'right' && c < next[r].length - 1) [next[r][c + 1], next[r][c]] = [next[r][c], next[r][c + 1]];
    else if (direction === 'up' || direction === 'down') {
      const target = direction === 'up' ? r - 1 : r + 1;
      next[r].splice(c, 1);
      if (target < 0) next.unshift([id]);
      else if (target >= next.length) next.push([id]);
      else if (next[target].length >= 4) next.splice(direction === 'up' ? r : target + 1, 0, [id]);
      else next[target].push(id);
    } else if (direction === 'alone' && next[r].length > 1) { next[r].splice(c, 1); next.splice(r + 1, 0, [id]); }
    save(next);
  };
  const remove = (id: string) => { if (view) updateView(view, { widgets: (config.widgets ?? []).filter(item => item !== id), dashboardRows: rows.map(row => row.filter(item => item !== id)).filter(row => row.length) }); };
  const countOf = (filter: Filter | undefined | null) => filter ? ('all' in filter ? filter.all.length : 1) : 0;
  const filterCount = (sourceId: string) => countOf(filters[sourceId] as Filter | undefined);
  // 모든 위젯 필터: one filter for every widget (several data sources), written with the first source's properties.
  const shared = config.dashboardShared && sources.includes(config.dashboardShared.sourceId) ? config.dashboardShared : null;
  const sharedSource = shared?.sourceId ?? sources[0];
  const widgetFilter = (sourceId: string): Filter | undefined => {
    const own = filters[sourceId] as Filter | undefined, common = shared ? sharedFilterFor(shared.filter, shared.sourceId, sourceId) : null;
    return own && common ? { all: [own, common] } : own ?? common ?? undefined;
  };
  return (
    <div className={`dashboard-view${editing ? ' editing' : ''}`}>
      <div className="dashboard-toolbar">
        {sources.length > 1 ? (
          <button type="button" className={`filter-chip dashboard-shared-filter${countOf(shared?.filter) ? ' active' : ''}`} onClick={event => setFilterFor({ anchor: event.currentTarget, sourceId: sharedSource, shared: true })}>
            <Icon name="filter" size={14} /><span>{t("모든 위젯")}</span>{countOf(shared?.filter) ? <span className="filter-chip-count">{countOf(shared?.filter)}</span> : null}
          </button>
        ) : null}
        {sources.map(sourceId => (
          <button type="button" key={sourceId} className={`filter-chip${filterCount(sourceId) ? ' active' : ''}`} onClick={event => setFilterFor({ anchor: event.currentTarget, sourceId })}>
            <Icon name="filter" size={14} /><span>{sources.length > 1 ? ws.get<SourceEntity>(sourceId)?.name ?? t("필터") : t("대시보드 필터")}</span>{filterCount(sourceId) ? <span className="filter-chip-count">{filterCount(sourceId)}</span> : null}
          </button>
        ))}
        <span className="spacer" />
        {view ? <button type="button" className={`text-button small${editing ? ' active' : ''}`} aria-pressed={editing} onClick={() => setEditing(!editing)}><Icon name={editing ? 'check' : 'pencil'} size={14} />{editing ? t("편집 완료") : t("레이아웃 편집")}</button> : null}
      </div>
      {rows.map((row, r) => (
        <div key={row.join(':')} className="dashboard-row" style={{ gridTemplateColumns: row.map(id => `minmax(0, ${sizeOf(id).width ?? 1}fr)`).join(' ') }}>
          {row.map((id, c) => {
            const widget = widgets.find(item => item.id === id)!;
            return (
              <div key={id} className="dashboard-widget" data-widget-id={id} style={sizeOf(id).height ? { height: sizeOf(id).height, maxHeight: 'none' } : undefined}>
                {editing ? (
                  <div className="dashboard-widget-tools" role="toolbar" aria-label={t("위젯 배치")}>
                    <span className="dashboard-widget-name">{widget.name}</span>
                    <button type="button" className="icon-button tiny" aria-label={t("왼쪽으로")} disabled={c === 0} onClick={() => move(id, 'left')}><Icon name="arrow-left" size={14} /></button>
                    <button type="button" className="icon-button tiny" aria-label={t("오른쪽으로")} disabled={c === row.length - 1} onClick={() => move(id, 'right')}><Icon name="arrow-right" size={14} /></button>
                    <button type="button" className="icon-button tiny" aria-label={t("위 줄로")} disabled={r === 0 && row.length === 1} onClick={() => move(id, 'up')}><Icon name="arrow-up" size={14} /></button>
                    <button type="button" className="icon-button tiny" aria-label={t("아래 줄로")} disabled={r === rows.length - 1 && row.length === 1} onClick={() => move(id, 'down')}><Icon name="arrow-down" size={14} /></button>
                    <button type="button" className="icon-button tiny" aria-label={t("한 줄 전체로")} disabled={row.length === 1} onClick={() => move(id, 'alone')}><Icon name="expand" size={14} /></button>
                    <button type="button" className="icon-button tiny" aria-label={t("대시보드에서 빼기")} onClick={() => remove(id)}><Icon name="close" size={14} /></button>
                  </div>
                ) : null}
                <DatabaseFrame sourceId={widget.sourceId} viewIds={[widget.id]} pageId={widget.parentId ?? ''} inline compact extraFilter={widgetFilter(widget.sourceId)} />
                {editing && c < row.length - 1 ? <div className="dashboard-resize width" role="separator" aria-orientation="vertical" aria-label={t("너비 조절")} onPointerDown={event => startWidth(event, row, c)} /> : null}
                {editing ? <div className="dashboard-resize height" role="separator" aria-orientation="horizontal" aria-label={t("높이 조절")} onPointerDown={event => startHeight(event, id)} /> : null}
              </div>
            );
          })}
        </div>
      ))}
      {filterFor?.shared && view ? (
        <Popover anchor={filterFor.anchor} placement="below-start" onClose={() => setFilterFor(null)} className="filter-popover dashboard-filter" style={{ width: 520 }} label={t("모든 위젯 필터")}>
          <p className="muted small dashboard-filter-note">{t("모든 위젯에 적용됩니다. 다른 데이터 소스에는 이름과 유형이 같은 속성으로 적용됩니다.")}</p>
          <FilterEditor sourceId={filterFor.sourceId} value={(shared?.filter as Filter | undefined) ?? null}
            onChange={filter => updateView(view, { dashboardShared: filter && !('all' in filter && !filter.all.length) ? { sourceId: filterFor.sourceId, filter } : null })}
            onDeleteAll={() => { updateView(view, { dashboardShared: null }); setFilterFor(null); }} />
        </Popover>
      ) : null}
      {filterFor && !filterFor.shared && view ? (
        <Popover anchor={filterFor.anchor} placement="below-start" onClose={() => setFilterFor(null)} className="filter-popover dashboard-filter" style={{ width: 520 }} label={t("대시보드 필터")}>
          <p className="muted small dashboard-filter-note">{t("이 데이터 소스에서 온 모든 위젯에 적용됩니다.")}</p>
          <FilterEditor sourceId={filterFor.sourceId} value={(filters[filterFor.sourceId] as Filter | undefined) ?? null}
            onChange={filter => { const next = { ...filters }; if (filter && !('all' in filter && !filter.all.length)) next[filterFor.sourceId] = filter; else delete next[filterFor.sourceId]; updateView(view, { dashboardFilters: next }); }}
            onDeleteAll={() => { const next = { ...filters }; delete next[filterFor.sourceId]; updateView(view, { dashboardFilters: next }); setFilterFor(null); }} />
        </Popover>
      ) : null}
    </div>
  );
}

export type { QueryRow };
