import { t } from '../i18n';
import { useState } from 'react';
import { apply, newId } from '../data/commands';
import { report, workspace } from '../data/store';
import { aggregateLabels, propertyLabels } from '../data/format';
import type { PropertyEntity, PropertyType, QueryResult, SelectOption, ViewEntity } from '../data/types';
import { Menu, type MenuEntry } from '../ui/Menu';
import type { Anchor, Placement } from '../ui/overlay';
import { Icon } from '../ui/Icon';
import { Switch } from '../ui/primitives';
import { openWorkspaceDialog } from '../dialogs/registry';
import { newRule } from '../dialogs/filters';
import { sortDirectionLabels } from './FilterSortBar';
import { updateView } from './shared';
import { defaultStatusOptions } from '../dialogs/databaseDialogs';

export const creatableTypes: PropertyType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'files', 'checkbox', 'url', 'email', 'phone', 'formula', 'relation', 'rollup', 'button', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id', 'place'];
const needsDialog = new Set<PropertyType>(['relation', 'rollup', 'formula', 'button']);

export function aggregationsFor(property: PropertyEntity): string[] {
  return ['count', 'count_nonempty', 'count_empty', 'percent_empty', 'percent_not_empty',
    ...(['number', 'formula', 'rollup'].includes(property.type) ? ['sum', 'average', 'median', 'min', 'max', 'range'] : []),
    ...(property.type === 'checkbox' ? ['checked', 'unchecked', 'percent_checked', 'percent_unchecked'] : []),
    ...(['date', 'created_time', 'last_edited_time'].includes(property.type) ? ['earliest_date', 'latest_date', 'date_range'] : []),
    ...(['select', 'multi_select', 'status', 'text', 'person', 'relation'].includes(property.type) ? ['unique'] : []),
  ].filter((value, index, list) => list.indexOf(value) === index);
}

export function typeEntries(onPick: (type: PropertyType) => void, current?: PropertyType): MenuEntry[] {
  return [
    { kind: 'section', label: t("유형") },
    ...creatableTypes.map(type => ({ label: propertyLabels[type], icon: `type-${type}`, checked: current === type, keywords: type, onSelect: () => onPick(type) } as MenuEntry)),
  ];
}

// Create a property from a type choice ("+" in the table header). Settings that
// need more input (relation target, formula, rollup, button) open the property panel.
export async function createProperty(sourceId: string, type: PropertyType, view: ViewEntity | null, result: QueryResult | null, { afterId, beforeId }: { afterId?: string; beforeId?: string } = {}) {
  if (needsDialog.has(type)) {
    openWorkspaceDialog('property', { sourceId, type, onCreated: (id: string) => placeColumn(view, result, id, { afterId, beforeId }) });
    return null;
  }
  const id = newId();
  const names = new Set(workspace.schema(sourceId).map(property => property.name));
  let name = propertyLabels[type];
  for (let n = 1; names.has(name); n++) name = `${propertyLabels[type]} ${n}`;
  const options: SelectOption[] | undefined = type === 'status' ? defaultStatusOptions() : ['select', 'multi_select'].includes(type) ? [] : undefined;
  await apply([{ type: 'property.create', id, sourceId, name, propertyType: type, ...(options ? { options } : {}) }]);
  await placeColumn(view, result, id, { afterId, beforeId });
  return id;
}

async function placeColumn(view: ViewEntity | null, result: QueryResult | null, id: string, { afterId, beforeId }: { afterId?: string; beforeId?: string }) {
  if (!view || !result) return;
  const order = (view.config.visibleProperties ?? result.visibleProperties).filter(item => item !== id);
  const at = afterId ? order.indexOf(afterId) + 1 : beforeId ? order.indexOf(beforeId) : order.length;
  order.splice(at < 0 ? order.length : at, 0, id);
  await updateView(view, { visibleProperties: order });
}

export interface HeaderMenuProps { anchor: Anchor; property: PropertyEntity; view: ViewEntity | null; result: QueryResult; onClose: () => void; placement?: Placement; onFilter?: (propertyId: string) => void; wrap?: boolean; onWrap?: (value: boolean) => void }

export function PropertyHeaderMenu({ anchor, property, view, result, onClose, placement = 'below-start', onFilter, wrap, onWrap }: HeaderMenuProps) {
  const [name, setName] = useState(property.name);
  const config = view?.config ?? {};
  const sorts = config.sorts ?? [];
  const frozen = config.frozenProperties ?? [];
  const isTitle = property.type === 'title';
  const rename = () => { const value = name.trim(); if (value && value !== property.name) apply([{ type: 'property.update', id: property.id, name: value }]).catch(report); };
  const order = config.visibleProperties ?? result.visibleProperties;
  const aggregation = config.columnAggregations?.[property.id];
  const convertTo = (type: PropertyType) => {
    if (type === property.type) return;
    openWorkspaceDialog('property', { sourceId: property.sourceId, propertyId: property.id, type });
  };
  const entries: MenuEntry[] = [
    { kind: 'custom', render: close => (
      <div className="property-name-row">
        <span className="property-type-box" title={propertyLabels[property.type]}><Icon name={`type-${property.type}`} size={16} /></span>
        <input className="menu-name-input" value={name} autoFocus aria-label={t("속성 이름")} onChange={event => setName(event.target.value)} onBlur={rename}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); rename(); close(); } }} />
      </div>
    ) },
    // The title column has no 속성 편집 but switches the rows' page icons; a checkbox has nothing to edit and an
    // ID cannot change type.
    ...(isTitle || property.type === 'checkbox' ? [] : [{ label: t("속성 편집"), icon: 'property-edit', onSelect: () => openWorkspaceDialog('property', { sourceId: property.sourceId, propertyId: property.id }) } as MenuEntry]),
    ...(isTitle && view ? [{ label: t("페이지 아이콘 표시"), icon: 'emoji', keepOpen: true, right: <Switch checked={config.showPageIcon !== false} onChange={value => updateView(view, { showPageIcon: value })} label={t("페이지 아이콘 표시")} />, onSelect: () => updateView(view, { showPageIcon: config.showPageIcon === false }) } as MenuEntry] : []),
    ...(!isTitle && property.type !== 'unique_id' ? [{ label: t("유형 변경"), icon: 'turn-into', submenu: () => typeEntries(convertTo, property.type), submenuWidth: 240 } as MenuEntry] : []),
    { kind: 'separator' },
    ...(view ? [
      { label: t("필터"), icon: 'filter', onSelect: () => {
        if (onFilter) onFilter(property.id);
        else updateView(view, { filter: { all: [...(config.filter && 'all' in config.filter ? config.filter.all : config.filter ? [config.filter] : []), newRule(property)] } });
      } } as MenuEntry,
      { label: t("정렬"), icon: 'sort', submenuWidth: 200, submenu: () => (['asc', 'desc'] as const).map((direction, index) => ({
        label: sortDirectionLabels(property)[index], checked: sorts[0]?.propertyId === property.id && sorts[0].direction === direction,
        onSelect: () => updateView(view, { sorts: [{ propertyId: property.id, direction }, ...sorts.filter(sort => sort.propertyId !== property.id)] }),
      } as MenuEntry)) } as MenuEntry,
      ...(property.type === 'files' || property.type === 'unique_id' ? [] : [{ label: t("그룹"), icon: 'group', checked: config.groupBy === property.id, onSelect: () => updateView(view, { groupBy: config.groupBy === property.id ? null : property.id }) } as MenuEntry]),
      { label: t("계산"), icon: 'sigma', hint: aggregation ? aggregateLabels[aggregation] : undefined, submenuWidth: 240, submenu: () => [
        { label: t("없음"), checked: !aggregation, onSelect: () => { const next = { ...(config.columnAggregations ?? {}) }; delete next[property.id]; updateView(view, { columnAggregations: next }); } },
        ...aggregationsFor(property).map(operation => ({ label: aggregateLabels[operation], checked: aggregation === operation, onSelect: () => updateView(view, { columnAggregations: { ...(config.columnAggregations ?? {}), [property.id]: operation } }) } as MenuEntry)),
      ] } as MenuEntry,
      { label: frozen.includes(property.id) ? t("고정 해제") : t("고정"), icon: 'pin', onSelect: () => {
        // Freezing a column freezes every column up to it.
        if (frozen.includes(property.id)) updateView(view, { frozenProperties: [] });
        else { const index = order.indexOf(property.id); updateView(view, { frozenProperties: index >= 0 ? order.slice(0, index + 1) : [property.id] }); }
      } } as MenuEntry,
      ...(!isTitle ? [{ label: t("숨기기"), icon: 'eye-off', onSelect: () => updateView(view, { visibleProperties: order.filter(id => id !== property.id) }) } as MenuEntry] : []),
      ...(onWrap ? [{ label: t("텍스트 줄바꿈"), icon: 'wrap', checked: !!wrap, onSelect: () => onWrap(!wrap) } as MenuEntry] : []),
      // A status column can show as a checkbox.
      ...(property.type === 'status' ? [(() => {
        const asCheckbox = !!config.checkboxStatus?.includes(property.id);
        const set = (value: boolean) => updateView(view, { checkboxStatus: value ? [...(config.checkboxStatus ?? []).filter(id => id !== property.id), property.id] : (config.checkboxStatus ?? []).filter(id => id !== property.id) });
        return { label: t("표시 유형"), icon: 'eye', hint: asCheckbox ? t("체크박스") : t("status-display|선택"), submenuWidth: 200, submenu: () => [
          { label: t("체크박스"), icon: 'type-checkbox', checked: asCheckbox, onSelect: () => set(true) },
          { label: t("status-display|선택"), icon: 'type-select', checked: !asCheckbox, onSelect: () => set(false) },
        ] } as MenuEntry;
      })()] : []),
      { kind: 'separator' } as MenuEntry,
      { label: t("왼쪽에 삽입"), icon: 'insert-left', submenuWidth: 240, submenu: () => typeEntries(type => { createProperty(property.sourceId, type, view, result, { beforeId: property.id }).catch(report); }) } as MenuEntry,
      { label: t("오른쪽에 삽입"), icon: 'insert-right', submenuWidth: 240, submenu: () => typeEntries(type => { createProperty(property.sourceId, type, view, result, { afterId: property.id }).catch(report); }) } as MenuEntry,
    ] : []),
    ...(!isTitle ? [
      { label: t("속성 복제"), icon: 'duplicate', onSelect: () => {
        const id = newId();
        const copy: Record<string, unknown> = { type: 'property.create', id, sourceId: property.sourceId, name: t("{0} (사본)", [property.name]), propertyType: property.type };
        for (const key of ['options', 'formula', 'targetSourceId', 'button', 'relationLimit', 'displayProperties', 'numberFormat', 'rollup']) if ((property as unknown as Record<string, unknown>)[key] != null) copy[key] = structuredClone((property as unknown as Record<string, unknown>)[key]);
        apply([copy as never]).then(() => placeColumn(view, result, id, { afterId: property.id })).catch(report);
      } } as MenuEntry,
      { label: t("속성 삭제"), icon: 'trash', danger: true, onSelect: () => apply([{ type: 'node.trash', id: property.id }]).catch(report) } as MenuEntry,
    ] : []),
  ];
  return <Menu anchor={anchor} placement={placement} width={260} entries={entries} onClose={onClose} label={t("{0} 속성", [property.name])} submenuPlacement="side-middle" />;
}

export function NewPropertyMenu({ anchor, sourceId, view, result, onClose, placement = 'below-end' }: { anchor: Anchor; sourceId: string; view: ViewEntity | null; result: QueryResult | null; onClose: () => void; placement?: Placement }) {
  return <Menu anchor={anchor} placement={placement} width={260} search={t("속성 유형 검색…")} entries={typeEntries(type => { createProperty(sourceId, type, view, result).catch(report); })} onClose={onClose} label={t("새 속성")} maxHeight={420} />;
}
