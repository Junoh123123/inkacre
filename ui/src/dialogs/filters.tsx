import { t } from '../i18n';
import { useContext, useState } from 'react';
import { ViewEditContext } from '../database/viewEdit';
import { getSettings } from '../data/settings';
const currentWeekStart = (): 0 | 1 => (getSettings().weekStartsMonday ? 1 : 0);
import { useWorkspace } from '../data/store';
import { Menu, type MenuEntry } from '../ui/Menu';
import type { Filter, PageEntity, PropertyEntity, SourceEntity } from '../data/types';
import { Icon } from '../ui/Icon';

// Filter conditions (AND / OR groups, NOT) shared by the view filter panel and button actions.

export const filterLabels: Record<string, string> = {
  eq: t("같음"), neq: t("같지 않음"), contains: t("포함"), not_contains: t("포함하지 않음"), empty: t("비어 있음"), not_empty: t("비어 있지 않음"),
  gt: t("보다 큼"), gte: t("크거나 같음"), lt: t("보다 작음"), lte: t("작거나 같음"), before: t("date-filter|이전"), after: t("date-filter|이후"), in: t("다음 중 하나"), not_in: t("다음 중 어느 것도 아님"), relative: t("상대 기간"),
  starts_with: t("다음으로 시작"), ends_with: t("다음으로 끝남"),
};

export function operatorsFor(property: PropertyEntity | undefined): string[] {
  switch (property?.type) {
    case 'number': case 'formula': case 'rollup': return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'];
    case 'checkbox': return ['eq', 'neq'];
    case 'select': case 'status': return ['eq', 'neq', 'empty', 'not_empty'];
    case 'multi_select': case 'relation': case 'person': case 'files': return ['contains', 'not_contains', 'empty', 'not_empty'];
    // Dates: 같음 · 이전 · 이후 · 당일 또는 이전 · 당일 또는 이후 · 기간 내 · 오늘 기준 상대 날짜 · 비어 있음 · 비어 있지 않음.
    case 'date': case 'created_time': case 'last_edited_time': return ['eq', 'before', 'after', 'lte', 'gte', 'within', 'relative', 'empty', 'not_empty'];
    // Text, in this order (is · is not · contains · does not contain · starts with · ends
    // with · is empty · is not empty); a new rule starts on "contains".
    default: return ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'empty', 'not_empty'];
  }
}

const textTypes = new Set(['title', 'text', 'url', 'email', 'phone', 'unique_id', undefined]);
// A date property's new rule starts on "오늘 기준 상대 날짜 · 이번 주" (so it filters at once); created/edited
// times start on 같음 with no date yet.
export const defaultOperator = (property: PropertyEntity | undefined) => textTypes.has(property?.type) ? 'contains' : property?.type === 'date' ? 'relative' : operatorsFor(property)[0];
export const isDateProperty = (property: PropertyEntity | undefined) => !!property && ['date', 'created_time', 'last_edited_time'].includes(property.type);

export type RelativeValue = { period: 'this' | 'past' | 'next'; unit: 'day' | 'week' | 'month' | 'year'; amount?: number; weekStart?: 0 | 1; timeZone?: string };
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function relativeDefault(): RelativeValue { return { period: 'this', unit: 'week', weekStart: currentWeekStart(), timeZone: zone() }; }
/** Older rules (오늘 · 지난 주 · 지난 N일 …) read as the new direction + unit. */
export function relativeOf(value: unknown): RelativeValue {
  const v = (value ?? {}) as { period?: string; unit?: string; amount?: number; weekStart?: 0 | 1; timeZone?: string };
  if (v.period === 'this' || v.period === 'past' || v.period === 'next') return { period: v.period, unit: (['day', 'week', 'month', 'year'].includes(v.unit ?? '') ? v.unit : 'week') as RelativeValue['unit'], ...(v.period === 'this' ? {} : { amount: Math.max(1, Number(v.amount ?? 1)) }), weekStart: v.weekStart ?? currentWeekStart(), timeZone: v.timeZone ?? zone() };
  const map: Record<string, Omit<RelativeValue, 'timeZone'>> = {
    today: { period: 'this', unit: 'day' }, yesterday: { period: 'past', unit: 'day', amount: 1 }, tomorrow: { period: 'next', unit: 'day', amount: 1 },
    this_week: { period: 'this', unit: 'week' }, last_week: { period: 'past', unit: 'week', amount: 1 }, next_week: { period: 'next', unit: 'week', amount: 1 },
    this_month: { period: 'this', unit: 'month' }, last_month: { period: 'past', unit: 'month', amount: 1 }, next_month: { period: 'next', unit: 'month', amount: 1 },
    past_days: { period: 'past', unit: 'day', amount: v.amount ?? 7 }, next_days: { period: 'next', unit: 'day', amount: v.amount ?? 7 },
  };
  return { ...(map[v.period ?? ''] ?? { period: 'this', unit: 'week' }), weekStart: currentWeekStart(), timeZone: v.timeZone ?? zone() };
}
/** A new rule for a property, with the value it starts with. */
export function newRule(property: PropertyEntity): { propertyId: string; op: string; value?: unknown } {
  const op = defaultOperator(property);
  return { propertyId: property.id, op, ...(op === 'relative' ? { value: relativeDefault() } : {}) };
}
export const relativePeriodLabels: Record<RelativeValue['period'], string> = { this: t("relative|이번"), past: t("relative|지난"), next: t("relative|다음") };
export const relativeUnitLabels: Record<RelativeValue['unit'], string> = { day: t("relative|일"), week: t("relative|주"), month: t("relative|월"), year: t("relative|년") };
export function relativeSummary(value: unknown): string {
  const v = relativeOf(value);
  return v.period === 'this' || (v.amount ?? 1) === 1 ? `${relativePeriodLabels[v.period]} ${relativeUnitLabels[v.unit]}` : `${relativePeriodLabels[v.period]} ${v.amount} ${relativeUnitLabels[v.unit]}`;
}
const dateOpLabels: Record<string, string> = {
  eq: t("date-filter|같음"), before: t("date-filter|이전"), after: t("date-filter|이후"), lte: t("date-filter|당일 또는 이전"), gte: t("date-filter|당일 또는 이후"),
  within: t("date-filter|기간 내"), relative: t("date-filter|오늘 기준 상대 날짜"), empty: t("date-filter|비어 있음"), not_empty: t("date-filter|비어 있지 않음"),
};
/** A condition's name; dates have their own (당일 또는 이전 rather than 작거나 같음). */
export function opLabel(op: string, property: PropertyEntity | undefined): string {
  return (isDateProperty(property) ? dateOpLabels[op] : undefined) ?? filterLabels[op] ?? op;
}


export function FilterValueInput({ property, op, value, onChange, autoFocus = false }: { property: PropertyEntity | undefined; op: string; value: unknown; onChange: (value: unknown) => void; autoFocus?: boolean }) {
  const ws = useWorkspace();
  if (op === 'empty' || op === 'not_empty') return null;
  if (op === 'relative') {
    const current = relativeOf(value);
    const pick = (patch: Partial<RelativeValue>) => { const next = { ...current, ...patch }; onChange(next.period === 'this' ? { period: 'this', unit: next.unit, weekStart: next.weekStart, timeZone: next.timeZone } : { ...next, amount: Math.max(1, Number(next.amount ?? 1)) }); };
    return (
      <span className="filter-value relative">
        <select className="text-input" value={current.period} onChange={event => pick({ period: event.target.value as RelativeValue['period'] })}>
          {(['past', 'next', 'this'] as const).map(id => <option key={id} value={id}>{relativePeriodLabels[id]}</option>)}
        </select>
        {current.period !== 'this' ? <input className="text-input" type="number" min={1} value={current.amount ?? 1} onChange={event => pick({ amount: Number(event.target.value) || 1 })} /> : null}
        <select className="text-input" value={current.unit} onChange={event => pick({ unit: event.target.value as RelativeValue['unit'] })}>
          {(['day', 'week', 'month', 'year'] as const).map(id => <option key={id} value={id}>{relativeUnitLabels[id]}</option>)}
        </select>
      </span>
    );
  }
  if (op === 'within') {
    const range = (value ?? {}) as { start?: string; end?: string };
    return (
      <span className="filter-value relative">
        <input className="text-input" type="date" aria-label={t("date-range|시작")} value={range.start ?? ''} onChange={event => onChange({ ...range, start: event.target.value || undefined })} />
        <input className="text-input" type="date" aria-label={t("date-range|종료")} value={range.end ?? ''} onChange={event => onChange({ ...range, end: event.target.value || undefined })} />
      </span>
    );
  }
  let options = property?.options?.map(option => ({ id: option.id, name: option.name }));
  if (property?.type === 'relation') options = ws.snapshot.objects.filter(item => item.kind === 'page' && (item as PageEntity).sourceId === property.targetSourceId && !(item as PageEntity).template && ws.visible(item.id)).map(item => ({ id: item.id, name: (item as PageEntity).title || t("새 페이지") }));
  // A sprint relation can name whichever sprint is current or next (the sprint views do).
  if (property?.type === 'relation' && options && ws.snapshot.objects.some(item => item.kind === 'source' && (item as SourceEntity).tasks?.sprints?.relationPropertyId === property.id)) options = [{ id: '$currentSprint', name: t("현재 스프린트") }, { id: '$nextSprint', name: t("다음 스프린트") }, ...options];
  if (options) {
    if (op === 'in') {
      const selected = Array.isArray(value) ? value as string[] : [];
      return (
        <span className="filter-value checks">
          {options.map(option => (
            <label key={option.id} className="filter-check"><input type="checkbox" checked={selected.includes(option.id)} onChange={event => onChange(event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id))} />{option.name}</label>
          ))}
        </span>
      );
    }
    return (
      <select className="text-input filter-value" value={String(value ?? '')} onChange={event => onChange(event.target.value || null)}>
        <option value="">{t("placeholder|선택")}</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    );
  }
  if (property?.type === 'checkbox') {
    return (
      <select className="text-input filter-value" value={String(value ?? true)} onChange={event => onChange(event.target.value === 'true')}>
        <option value="true">{t("체크 표시됨")}</option><option value="false">{t("체크 표시 안 됨")}</option>
      </select>
    );
  }
  if (property && ['date', 'created_time', 'last_edited_time'].includes(property.type)) {
    return <input className="text-input filter-value" type="date" autoFocus={autoFocus} value={typeof value === 'string' ? value.slice(0, 10) : ''} onChange={event => onChange(event.target.value)} />;
  }
  return (
    <input className="text-input filter-value" autoFocus={autoFocus} type={property?.type === 'number' ? 'number' : 'text'} step="any" placeholder={t("값 입력…")} value={value == null ? '' : String(value)}
      onChange={event => onChange(property?.type === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value)} />
  );
}

type Group = { mode: 'all' | 'any'; negate: boolean; items: Array<Filter> };

function toGroup(filter: Filter | null | undefined): Group {
  if (!filter) return { mode: 'all', negate: false, items: [] };
  if ('not' in filter) { const inner = toGroup(filter.not); return { ...inner, negate: !inner.negate }; }
  if ('all' in filter) return { mode: 'all', negate: false, items: filter.all };
  if ('any' in filter) return { mode: 'any', negate: false, items: filter.any };
  return { mode: 'all', negate: false, items: [filter] };
}
function fromGroup(group: Group): Filter | null {
  if (!group.items.length) return null;
  const base: Filter = group.mode === 'all' ? { all: group.items } : { any: group.items };
  return group.negate ? { not: base } : base;
}

// The advanced filter editor (494 wide): rows of
// "조건" / "그리고 ⌄" · a property button (type icon, 32 high, r6) · the value (gray field) · the
// condition button · ⋯ (삭제 · 복제 · 그룹으로 변환); groups sit in a tinted box; under them
// "+ 필터 규칙 추가 ⌄" (필터 규칙 추가 · 필터 그룹 추가).
export function FilterEditor({ sourceId, value, onChange, depth = 0, onDeleteAll }: { sourceId: string; value: Filter | null; onChange: (value: Filter | null) => void; depth?: number; onDeleteAll?: () => void }) {
  const ws = useWorkspace();
  const edit = useContext(ViewEditContext);
  const schema = edit?.schema ?? ws.schema(sourceId);
  const group = toGroup(value);
  const [menu, setMenu] = useState<{ anchor: Element; kind: 'property' | 'op' | 'join' | 'more' | 'add'; index: number } | null>(null);
  const set = (next: Group) => onChange(fromGroup(next));
  const setItem = (index: number, item: Filter | null) => set({ ...group, items: item ? group.items.map((entry, i) => i === index ? item : entry) : group.items.filter((_, i) => i !== index) });
  const firstRule = (): Filter => newRule(schema[0]) as Filter;
  const open = (kind: 'property' | 'op' | 'join' | 'more' | 'add', index: number) => (event: React.MouseEvent) => setMenu({ anchor: event.currentTarget, kind, index });
  const current = menu ? group.items[menu.index] as { propertyId?: string; op?: string; value?: unknown } | undefined : undefined;
  let entries: MenuEntry[] = [];
  if (menu?.kind === 'property' && current) entries = schema.map(entry => ({ label: entry.name, icon: entry.icon ?? `type-${entry.type}`, checked: entry.id === current.propertyId, onSelect: () => setItem(menu.index, newRule(entry) as Filter) }));
  if (menu?.kind === 'op' && current) {
    const property = schema.find(entry => entry.id === current.propertyId);
    entries = [...new Set([...operatorsFor(property), current.op ?? ''])].filter(Boolean).map(op => ({ label: opLabel(op, property), checked: op === current.op, onSelect: () => setItem(menu.index, { propertyId: current.propertyId!, op, ...(['empty', 'not_empty'].includes(op) ? {} : op === 'relative' ? { value: current.op === 'relative' ? current.value : relativeDefault() } : op === 'within' || current.op === 'within' || current.op === 'relative' ? {} : { value: current.value }) }) }));
  }
  if (menu?.kind === 'join') entries = [{ label: t("그리고"), checked: group.mode === 'all', onSelect: () => set({ ...group, mode: 'all' }) }, { label: t("또는"), checked: group.mode === 'any', onSelect: () => set({ ...group, mode: 'any' }) }];
  if (menu?.kind === 'more') {
    const item = group.items[menu.index];
    const nested = !!item && ('all' in item || 'any' in item || 'not' in item);
    entries = [
      { label: t("삭제"), icon: 'trash', danger: true, onSelect: () => setItem(menu.index, null) },
      { label: t("복제"), icon: 'duplicate', onSelect: () => set({ ...group, items: [...group.items.slice(0, menu.index + 1), structuredClone(item), ...group.items.slice(menu.index + 1)] }) },
      ...(nested ? [] : depth < 2 ? [{ label: t("그룹으로 변환"), icon: 'repeat', onSelect: () => setItem(menu.index, { all: [item] }) } as MenuEntry] : []),
    ];
  }
  if (menu?.kind === 'add') entries = [
    { label: t("필터 규칙 추가"), icon: 'plus', disabled: !schema.length, onSelect: () => set({ ...group, items: [...group.items, firstRule()] }) },
    ...(depth < 2 ? [{ label: t("필터 그룹 추가"), icon: 'duplicate', hint: t("여러 필터를 중첩하는 그룹"), disabled: !schema.length, onSelect: () => set({ ...group, items: [...group.items, { all: [firstRule()] }] }) } as MenuEntry] : []),
    ...(group.items.length ? [{ kind: 'separator' } as MenuEntry, { label: t("결과 반전"), icon: 'repeat', checked: group.negate, onSelect: () => set({ ...group, negate: !group.negate }) } as MenuEntry] : []),
  ];
  return (
    <div className={`filter-editor depth-${depth}${group.negate ? ' negated' : ''}`}>
      {group.negate ? <div className="filter-negated-note">{t("아래 조건에 맞지 않는 항목")}</div> : null}
      {group.items.map((item, index) => {
        const nested = 'all' in item || 'any' in item || 'not' in item;
        const rule = item as { propertyId: string; op: string; value?: unknown };
        const property = nested ? undefined : schema.find(entry => entry.id === rule.propertyId);
        return (
          <div key={index} className="filter-editor-row">
            <span className="filter-join">
              {index === 0 ? t("조건") : index === 1 ? (
                <button type="button" className="filter-button join" onClick={open('join', index)}><span>{group.mode === 'all' ? t("그리고") : t("또는")}</span><Icon name="chevron-down" size={12} /></button>
              ) : group.mode === 'all' ? t("그리고") : t("또는")}
            </span>
            {nested ? (
              <div className="filter-nested"><FilterEditor sourceId={sourceId} value={item} depth={depth + 1} onChange={next => setItem(index, next)} /></div>
            ) : (
              <span className="filter-rule">
                <button type="button" className="filter-button property" onClick={open('property', index)}>
                  <Icon name={property?.icon ?? `type-${property?.type ?? 'text'}`} size={16} /><span className="filter-button-label">{property?.name ?? t("삭제된 속성")}</span><Icon name="chevron-down" size={12} />
                </button>
                <span className="filter-rule-value"><FilterValueInput property={property} op={rule.op} value={rule.value} onChange={next => setItem(index, { ...rule, value: next })} /></span>
                <button type="button" className="filter-button op" onClick={open('op', index)}><span>{opLabel(rule.op, property)}</span><Icon name="chevron-down" size={12} /></button>
              </span>
            )}
            <button type="button" className="icon-button filter-more" aria-label={t("규칙 옵션")} title={t("옵션")} onClick={open('more', index)}><Icon name="more" size={16} /></button>
          </div>
        );
      })}
      <button type="button" className="filter-add-rule" onClick={open('add', group.items.length)}><Icon name="plus" size={16} /><span>{t("필터 규칙 추가")}</span><Icon name="chevron-down" size={12} /></button>
      {onDeleteAll ? <><div className="filter-editor-sep" /><button type="button" className="filter-delete-all" onClick={onDeleteAll}><Icon name="trash" size={16} /><span>{t("필터 삭제")}</span></button></> : null}
      {menu ? <Menu anchor={menu.anchor} placement="below-start" width={menu.kind === 'add' ? 260 : menu.kind === 'property' ? 240 : 200} search={menu.kind === 'property' ? t("속성 검색…") : undefined} onClose={() => setMenu(null)} entries={entries} /> : null}
    </div>
  );
}
