import { t } from '../i18n';
import { useContext, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../data/store';
import { displayDate, formatYearMonth, optionColor, statusGroupLabel, statusGroupName } from '../data/format';
import { weekdayLabels, weekOffset } from '../data/settings';
import type { Filter, PageEntity, PropertyEntity, QueryResult, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Popover, type Anchor } from '../ui/overlay';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Tag } from '../ui/primitives';
import { FilterEditor, FilterValueInput, filterLabels, isDateProperty, newRule as makeRule, opLabel, operatorsFor, relativeDefault, relativeOf, relativePeriodLabels, relativeSummary, relativeUnitLabels, type RelativeValue } from '../dialogs/filters';
import { filterRules, updateView } from './shared';
import { ViewEditContext } from './viewEdit';

const typeIcon = (property: PropertyEntity | undefined) => property?.icon ?? `type-${property?.type ?? 'text'}`;
function useViewUpdate() { const edit = useContext(ViewEditContext); return edit?.update ?? updateView; }

export type Rule = { propertyId: string; op: string; value?: unknown; end?: boolean };

export function PropertyPicker({ anchor, properties, title, onPick, onClose, footer, width = 290 }: { anchor: Anchor; properties: PropertyEntity[]; title: string; onPick: (property: PropertyEntity) => void; onClose: () => void; footer?: MenuEntry[]; width?: number }) {
  return (
    <Menu anchor={anchor} width={width} offset={3} search={title} onClose={onClose}
      entries={[...properties.map(property => ({ label: property.name, icon: typeIcon(property), keywords: property.type, onSelect: () => onPick(property) } as MenuEntry)), ...(footer?.length ? [{ kind: 'separator' } as MenuEntry, ...footer] : [])]} />
  );
}

export function ruleSummary(rule: Rule, property: PropertyEntity | undefined, pages: Map<string, PageEntity>): string {
  if (rule.op === 'empty') return t("비어 있음");
  if (rule.op === 'not_empty') return t("비어 있지 않음");
  const value = rule.value;
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
  const names = (ids: unknown[]) => ids.map(id => id === '$currentSprint' ? t("현재 스프린트") : id === '$nextSprint' ? t("다음 스프린트") : property?.options?.find(option => option.id === id)?.name ?? pages.get(String(id))?.title ?? String(id)).join(', ');
  if (Array.isArray(value)) return `${rule.op === 'in' || rule.op === 'eq' ? '' : filterLabels[rule.op === 'not_in' ? 'neq' : rule.op] + ' '}${names(value)}`;
  if (property?.options || property?.type === 'relation') return `${rule.op === 'eq' ? '' : filterLabels[rule.op] + ' '}${names([value])}`;
  if (rule.op === 'relative') return relativeSummary(value);
  if (isDateProperty(property)) {
    const show = (day: unknown) => typeof day === 'string' && day ? displayDate(day.slice(0, 10), { withTime: false }) : '';
    if (rule.op === 'within') { const range = value as { start?: string; end?: string }; return range.start || range.end ? `${show(range.start)} → ${show(range.end)}` : ''; }
    return `${rule.op === 'eq' ? '' : opLabel(rule.op, property) + ' '}${show(value)}`;
  }
  if (typeof value === 'boolean') return value ? t("체크 표시됨") : t("체크 표시 안 됨");
  return `${rule.op === 'eq' ? '' : filterLabels[rule.op] + ' '}${String(value)}`;
}

// A date rule's value (e.g. a 생성 일시 or 일정 property): a 236×28 field
// "날짜를 선택하거나 입력…" with ⌄, then the month (title 14/500, ‹ ›), weekdays 12px #8b9898 and 28×28 days
// 32 apart; the chosen day is blue, today a red disc. Typing a date (2026-10-26, 2026/10/26, 오늘) sets it.
// 기간 내: two 108×28 fields "시작" · "종료" side by side over the month; 오늘 기준 상대 날짜: [이번/지난/다음 ⌄]
// ([N]) [일/주/월/년 ⌄] over the month with the range marked (first day blue, last day paler, between tinted)
// and "필터는 최신 날짜에 맞춰 업데이트됩니다" under a line.
const pad2 = (value: number) => String(value).padStart(2, '0');
const keyOf = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const parseDay = (input: string) => {
  const match = input.match(/(\d{4})[-./年년\s]+(\d{1,2})[-./月월\s]+(\d{1,2})/);
  if (match) return `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
  if (/오늘|今日|today/i.test(input)) return keyOf(new Date());
  return null;
};
const dayOf = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
const monthOf = (day: string) => { const base = day ? new Date(`${day}T00:00:00`) : new Date(); return new Date(base.getFullYear(), base.getMonth(), 1); };

function FilterCalendar({ month, onMonth, mark, onPick }: { month: Date; onMonth: (month: Date) => void; mark: (key: string) => string; onPick?: (key: string) => void }) {
  const cells = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - weekOffset(month) + i));
  const today = keyOf(new Date());
  return (
    <>
      <div className="date-month-head filter-date-head">
        <div className="date-month-title">{formatYearMonth(month)}</div>
        <button type="button" className="icon-button tiny" aria-label={t("이전 달")} onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon name="chevron-left" size={16} /></button>
        <button type="button" className="icon-button tiny" aria-label={t("다음 달")} onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="chevron-right" size={16} /></button>
      </div>
      <div className="date-grid filter-date-grid" role="grid">
        {weekdayLabels().map(label => <div key={label} className="date-weekday">{label}</div>)}
        {cells.map(date => {
          const key = keyOf(date);
          return <button key={key} type="button" className={`date-day${date.getMonth() !== month.getMonth() ? ' other' : ''}${key === today ? ' today' : ''}${mark(key)}`} onClick={() => onPick?.(key)}>{date.getDate()}</button>;
        })}
      </div>
    </>
  );
}

function DayField({ value, placeholder, autoFocus = false, onChange, className = '' }: { value: string; placeholder: string; autoFocus?: boolean; onChange: (day: string | null) => void; className?: string }) {
  const [text, setText] = useState(value ? displayDate(value, { withTime: false }) : '');
  useEffect(() => { setText(value ? displayDate(value, { withTime: false }) : ''); }, [value]);
  return (
    <input className={className} autoFocus={autoFocus} value={text} placeholder={placeholder} aria-label={placeholder} onChange={event => setText(event.target.value)}
      onBlur={() => { const next = parseDay(text); if (next && next !== value) onChange(next); else if (!text.trim() && value) onChange(null); else setText(value ? displayDate(value, { withTime: false }) : ''); }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); (event.target as HTMLInputElement).blur(); } }} />
  );
}

function DateFilterValue({ value, onChange }: { value: unknown; onChange: (value: string | null) => void }) {
  const day = dayOf(value);
  const [month, setMonth] = useState(() => monthOf(day));
  useEffect(() => { if (day) setMonth(monthOf(day)); }, [day]);
  return (
    <div className="filter-date">
      <div className="filter-date-field">
        <DayField value={day} placeholder={t("날짜를 선택하거나 입력…")} autoFocus onChange={onChange} />
        <Icon name="chevron-down" size={12} />
      </div>
      <FilterCalendar month={month} onMonth={setMonth} mark={key => (key === day ? ' selected' : '')} onPick={key => onChange(key)} />
    </div>
  );
}

function DateRangeFilterValue({ value, onChange }: { value: unknown; onChange: (value: { start?: string; end?: string } | null) => void }) {
  const range = (value && typeof value === 'object' ? value : {}) as { start?: string; end?: string };
  const start = dayOf(range.start), end = dayOf(range.end);
  const [month, setMonth] = useState(() => monthOf(start || end));
  const [picking, setPicking] = useState<'start' | 'end'>(start && !end ? 'end' : 'start');
  const put = (next: { start?: string; end?: string }) => { const clean = { ...(next.start ? { start: next.start } : {}), ...(next.end ? { end: next.end } : {}) }; onChange(clean.start || clean.end ? clean : null); };
  const pick = (key: string) => {
    if (picking === 'start' || !start) { put({ start: key, end: end && end >= key ? end : undefined }); setPicking('end'); }
    else if (key < start) { put({ start: key, end: start }); setPicking('start'); }
    else { put({ start, end: key }); setPicking('start'); }
  };
  return (
    <div className="filter-date">
      <div className="filter-date-range">
        <span className={`filter-date-field${picking === 'start' ? ' picking' : ''}`} onFocusCapture={() => setPicking('start')}><DayField value={start} placeholder={t("date-range|시작")} autoFocus onChange={day => put({ start: day ?? undefined, end })} /></span>
        <span className={`filter-date-field${picking === 'end' ? ' picking' : ''}`} onFocusCapture={() => setPicking('end')}><DayField value={end} placeholder={t("date-range|종료")} onChange={day => put({ start, end: day ?? undefined })} /></span>
      </div>
      <FilterCalendar month={month} onMonth={setMonth} onPick={pick}
        mark={key => key === start && key === end ? ' selected' : key === start ? ' range-start' : key === end ? ' range-end' : start && end && key > start && key < end ? ' in-range' : ''} />
    </div>
  );
}

/** The days a relative rule covers today (inclusive), as the engine counts them. */
function relativeDays(value: RelativeValue): [string, string] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today), end = new Date(today);
  const shift = (date: Date, count: number) => { if (value.unit === 'day') date.setDate(date.getDate() + count); else if (value.unit === 'week') date.setDate(date.getDate() + 7 * count); else if (value.unit === 'month') date.setMonth(date.getMonth() + count); else date.setFullYear(date.getFullYear() + count); };
  if (value.period === 'this') {
    if (value.unit === 'week') start.setDate(start.getDate() - (value.weekStart === 1 ? (start.getDay() + 6) % 7 : start.getDay()));
    else if (value.unit === 'month') start.setDate(1);
    else if (value.unit === 'year') start.setMonth(0, 1);
    end.setTime(start.getTime()); shift(end, 1); end.setDate(end.getDate() - 1);
  } else if (value.period === 'past') shift(start, -(value.amount ?? 1));
  else shift(end, value.amount ?? 1);
  return [keyOf(start), keyOf(end)];
}

function RelativeFilterValue({ value, onChange }: { value: unknown; onChange: (value: RelativeValue) => void }) {
  const current = relativeOf(value ?? relativeDefault());
  const [from, to] = relativeDays(current);
  const [month, setMonth] = useState(() => monthOf(from));
  const [menu, setMenu] = useState<{ kind: 'period' | 'unit'; anchor: Element } | null>(null);
  const put = (patch: Partial<RelativeValue>) => { const next = { ...current, ...patch }; onChange(next.period === 'this' ? { period: 'this', unit: next.unit, weekStart: next.weekStart, timeZone: next.timeZone } : { ...next, amount: Math.max(1, Math.min(36500, Number(next.amount ?? 1) || 1)) }); };
  return (
    <div className="filter-date">
      <div className={`filter-relative${current.period === 'this' ? ' this' : ''}`}>
        <button type="button" className="filter-select" onClick={event => setMenu({ kind: 'period', anchor: event.currentTarget })}><span>{relativePeriodLabels[current.period]}</span><Icon name="chevron-down" size={12} /></button>
        {current.period !== 'this' ? <span className="filter-date-field filter-relative-amount"><input type="number" min={1} value={current.amount ?? 1} aria-label={t("기간 수")} onChange={event => put({ amount: Number(event.target.value) || 1 })} /></span> : null}
        <button type="button" className="filter-select" onClick={event => setMenu({ kind: 'unit', anchor: event.currentTarget })}><span>{relativeUnitLabels[current.unit]}</span><Icon name="chevron-down" size={12} /></button>
      </div>
      <FilterCalendar month={month} onMonth={setMonth}
        mark={key => key === from && key === to ? ' selected' : key === from ? ' range-start' : key === to ? ' range-end' : key > from && key < to ? ' in-range' : ''} />
      <div className="filter-relative-note">{t("필터는 최신 날짜에 맞춰 업데이트됩니다")}</div>
      {menu ? <Menu anchor={menu.anchor} placement="below-start" width={180} onClose={() => setMenu(null)}
        entries={menu.kind === 'period'
          ? (['past', 'next', 'this'] as const).map(id => ({ label: relativePeriodLabels[id], checked: id === current.period, onSelect: () => put({ period: id }) }))
          : (['day', 'week', 'month', 'year'] as const).map(id => ({ label: relativeUnitLabels[id], checked: id === current.unit, onSelect: () => put({ unit: id }) }))} /> : null}
    </div>
  );
}

// One filter chip's editor: under the chip, r10. Head: the property name (12px #a19e99),
// the condition as a small button (12/500 #7d7a75 ⌄ → list of conditions) and ⋯ (필터 삭제 · 고급 필터에 추가).
// Text, numbers and dates: 220 wide with a 196×28 field (r6, rgba(66,35,3,.03)) focused at once, ⓧ inside
// once it holds something. Select, multi-select, people and relations: 260 wide, a 236×30 field holding the
// chosen options as tags (× each, ⓧ clears) that also searches, then the options as 28-high rows with
// checkboxes. Status: its options grouped under 할 일 · 진행 중 · 완료, then 선택 지우기.
// A rule without a value hides nothing.
const optionTypes = new Set(['select', 'status', 'multi_select', 'person', 'relation']);
const statusIcon = (label: string) => label === statusGroupName('complete') ? 'status-done' : label === statusGroupName('in_progress') ? 'status-progress' : 'status-todo';
const plainInputTypes = new Set(['date', 'created_time', 'last_edited_time', 'checkbox']);

export function RulePopover({ anchor, rule, property, onChange, onRemove, onAdvanced, onClose }: { anchor: Anchor; rule: Rule; property: PropertyEntity | undefined; onChange: (rule: Rule) => void; onRemove: () => void; onAdvanced?: () => void; onClose: () => void }) {
  const ws = useWorkspace();
  const [current, setCurrent] = useState(rule);
  const [menu, setMenu] = useState<{ kind: 'op' | 'more' | 'edge'; anchor: Element } | null>(null);
  const [needle, setNeedle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const latest = useRef(rule);
  const committed = useRef(JSON.stringify(rule));
  const flush = () => { window.clearTimeout(timer.current); const text = JSON.stringify(latest.current); if (text !== committed.current) { committed.current = text; onChange(latest.current); } };
  const set = (next: Rule, now = false) => { setCurrent(next); latest.current = next; window.clearTimeout(timer.current); if (now) flush(); else timer.current = window.setTimeout(flush, 300); };
  const listed = !!property && optionTypes.has(property.type);
  const tokens = listed && property?.type !== 'status';
  const multiple = property?.type === 'select' || property?.type === 'status';
  // "in"/"not_in" are how several ticked options are stored; the menu shows them as is / is not.
  const base = current.op === 'in' ? 'eq' : current.op === 'not_in' ? 'neq' : current.op;
  const ops = [...new Set([...operatorsFor(property), base])];
  const options: Array<{ id: string; name: string; color?: string | null; group?: string }> =
    property?.type === 'relation' ? (ws.snapshot.objects.filter(item => item.kind === 'page' && (item as PageEntity).sourceId === property.targetSourceId && !(item as PageEntity).template && ws.visible(item.id)) as PageEntity[]).map(page => ({ id: page.id, name: page.title || t("새 페이지") }))
      : property?.type === 'person' ? [{ id: 'me', name: t("나") }]
      : (property?.options ?? []).map(option => ({ id: option.id, name: option.name, color: optionColor(property, option), group: property?.type === 'status' ? statusGroupLabel(option) : undefined }));
  const chosen = Array.isArray(current.value) ? (current.value as string[]) : current.value != null && current.value !== '' ? [String(current.value)] : [];
  const choose = (ids: string[]) => {
    if (!multiple) { set({ propertyId: current.propertyId, op: base, ...(ids.length ? { value: ids[ids.length - 1] } : {}) }, true); return; }
    const op = ids.length > 1 ? (base === 'neq' ? 'not_in' : 'in') : base;
    set({ propertyId: current.propertyId, op, ...(ids.length ? { value: ids.length > 1 ? ids : ids[0] } : {}) }, true);
  };
  const dateRule = isDateProperty(property);
  const pickOp = (op: string) => {
    const propertyId = current.propertyId;
    const end = current.end ? { end: true } : {};
    if (op === base) return;
    if (['empty', 'not_empty'].includes(op)) set({ propertyId, op, ...end }, true);
    else if (dateRule) {
      // A day stays a day across 같음 · 이전 · 이후 · 당일 또는 …; 기간 내 and 상대 날짜 start fresh.
      const day = dayOf(current.value);
      set({ propertyId, op, ...end, ...(op === 'relative' ? { value: relativeDefault() } : op === 'within' ? (day ? { value: { start: day } } : {}) : day ? { value: day } : {}) }, true);
    }
    else if (listed && multiple && chosen.length > 1) set({ propertyId, op: op === 'neq' ? 'not_in' : op === 'eq' ? 'in' : op, value: chosen }, true);
    else if (listed) set({ propertyId, op, ...(chosen.length ? { value: chosen[0] } : {}) }, true);
    else set({ propertyId, op, ...(current.value != null ? { value: current.value } : {}) }, true);
  };
  const toggle = (id: string) => choose(chosen.includes(id) ? chosen.filter(item => item !== id) : multiple ? [...chosen, id] : [id]);
  const groups = property?.type === 'status' ? [...new Set(options.map(option => option.group!))] : [];
  const needsValue = !['empty', 'not_empty'].includes(base);
  const dated = dateRule && needsValue;
  const wide = (listed && needsValue) || dateRule;
  const query = needle.trim().toLocaleLowerCase();
  const shown = tokens && query ? options.filter(option => option.name.toLocaleLowerCase().includes(query)) : options;
  const clearable = !listed && needsValue && current.op !== 'relative' && !(property && plainInputTypes.has(property.type));
  const filled = current.value != null && current.value !== '';
  const row = (option: (typeof options)[number], indent = false) => (
    <button type="button" key={option.id} className={`filter-option${indent ? ' indent' : ''}`} onClick={() => { toggle(option.id); if (tokens) { setNeedle(''); inputRef.current?.focus(); } }}>
      <span className={`filter-check${chosen.includes(option.id) ? ' on' : ''}`}>{chosen.includes(option.id) ? <Icon name="check" size={12} /> : null}</span>
      {property?.type === 'relation' || property?.type === 'person' ? <span className="filter-option-name">{option.name}</span> : <Tag color={option.color ?? 'default'} status={property?.type === 'status'}>{option.name}</Tag>}
    </button>
  );
  return (
    <Popover anchor={anchor} placement="below-start" offset={4} onClose={() => { flush(); onClose(); }} className="filter-rule-popover" style={{ width: wide ? 260 : 220 }} label={t("필터")}>
      <div className="filter-rule-head">
        {/* A date property's rule picks its start or end date in place of the name. */}
        {property?.type === 'date'
          ? <button type="button" className="filter-rule-op filter-rule-edge" onClick={event => setMenu({ kind: 'edge', anchor: event.currentTarget })}><span>{current.end ? t("종료일") : t("시작일")}</span><Icon name="chevron-down" size={10} /></button>
          : <span className="filter-rule-name">{property?.name ?? t("속성")}</span>}
        <button type="button" className="filter-rule-op" onClick={event => setMenu({ kind: 'op', anchor: event.currentTarget })}><span>{opLabel(base, property)}</span><Icon name="chevron-down" size={10} /></button>
        <span className="spacer" />
        <button type="button" className="icon-button filter-rule-more" aria-label={t("필터 메뉴")} onClick={event => setMenu({ kind: 'more', anchor: event.currentTarget })}><Icon name="more" size={14} /></button>
      </div>
      {!needsValue ? null : tokens ? (
        <>
          <div className="filter-rule-body">
            <div className="filter-token-field" onPointerDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); inputRef.current?.focus(); } }}>
              {chosen.map(id => { const option = options.find(item => item.id === id); return <Tag key={id} color={option?.color ?? 'default'} onRemove={() => toggle(id)}>{option?.name ?? t("삭제된 옵션")}</Tag>; })}
              <input ref={inputRef} className="filter-token-input" autoFocus value={needle} placeholder={chosen.length ? '' : property?.type === 'relation' || property?.type === 'person' ? t("하나 이상 선택…") : t("옵션을 하나 이상 선택…")} aria-label={t("옵션 검색")}
                onChange={event => setNeedle(event.target.value)}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === 'Backspace' && !needle && chosen.length) toggle(chosen[chosen.length - 1]);
                  if (event.key === 'Enter' && shown[0]) { event.preventDefault(); toggle(shown[0].id); setNeedle(''); }
                }} />
              {chosen.length ? <button type="button" className="filter-field-clear" aria-label={t("선택 지우기")} title={t("선택 지우기")} onClick={() => { choose([]); inputRef.current?.focus(); }}><Icon name="clear-circle" size={16} /></button> : null}
            </div>
          </div>
          <div className="filter-option-list tokens">
            {shown.map(option => row(option))}
            {!shown.length ? <div className="menu-empty">{t("옵션 없음")}</div> : null}
          </div>
        </>
      ) : listed ? (
        <div className="filter-option-list">
          {groups.map(group => {
            const members = options.filter(option => option.group === group);
            const all = members.length > 0 && members.every(option => chosen.includes(option.id));
            return (
              <div key={group} className="filter-status-group">
                <button type="button" className="filter-option group" onClick={() => choose(all ? chosen.filter(id => !members.some(option => option.id === id)) : [...new Set([...chosen, ...members.map(option => option.id)])])}>
                  <span className={`filter-check${all ? ' on' : ''}`}>{all ? <Icon name="check" size={12} /> : null}</span>
                  <span className={`filter-group-name group-${statusIcon(group)}`}><Icon name={statusIcon(group)} size={16} />{group}</span>
                </button>
                {members.map(option => row(option, true))}
              </div>
            );
          })}
          {!options.length ? <div className="menu-empty">{t("옵션 없음")}</div> : null}
          <div className="filter-rule-sep" />
          <button type="button" className="filter-option clear" onClick={() => choose([])}>{t("선택 지우기")}</button>
        </div>
      ) : (
        dated ? (
          <div className="filter-rule-body">
            {base === 'relative' ? <RelativeFilterValue value={current.value} onChange={value => set({ ...current, value }, true)} />
              : base === 'within' ? <DateRangeFilterValue value={current.value} onChange={value => set(value ? { ...current, value } : { propertyId: current.propertyId, op: current.op, ...(current.end ? { end: true } : {}) }, true)} />
              : <DateFilterValue value={current.value} onChange={value => set(value ? { ...current, value } : { propertyId: current.propertyId, op: current.op, ...(current.end ? { end: true } : {}) }, true)} />}
          </div>
        ) : <div className="filter-rule-body">
          <span className={`filter-value-wrap${clearable ? ' clearable' : ''}`}>
            <FilterValueInput property={property} op={current.op} value={current.value} autoFocus onChange={value => set({ ...current, value })} />
            {clearable && filled ? <button type="button" className="filter-field-clear" aria-label={t("지우기")} title={t("지우기")} onMouseDown={event => event.preventDefault()} onClick={() => set({ propertyId: current.propertyId, op: current.op }, true)}><Icon name="clear-circle" size={16} /></button> : null}
          </span>
        </div>
      )}
      {menu?.kind === 'op' ? <Menu anchor={menu.anchor} placement="below-start" width={dateRule ? 190 : 200} onClose={() => setMenu(null)} entries={ops.map(op => ({ label: opLabel(op, property), checked: op === base, onSelect: () => pickOp(op) }))} /> : null}
      {menu?.kind === 'edge' ? <Menu anchor={menu.anchor} placement="below-start" width={190} onClose={() => setMenu(null)} entries={[
        { label: t("시작일"), checked: !current.end, onSelect: () => { const { end: _end, ...rest } = current; set(rest, true); } },
        { label: t("종료일"), checked: !!current.end, onSelect: () => set({ ...current, end: true }, true) },
      ]} /> : null}
      {menu?.kind === 'more' ? <Menu anchor={menu.anchor} placement="below-start" width={220} onClose={() => setMenu(null)} entries={[
        { label: t("필터 삭제"), icon: 'trash', onSelect: () => { window.clearTimeout(timer.current); committed.current = JSON.stringify(latest.current); onRemove(); onClose(); } },
        ...(onAdvanced ? [{ label: t("고급 필터에 추가"), icon: 'filter', onSelect: () => { flush(); onClose(); onAdvanced(); } }] : []),
      ]} /> : null}
    </Popover>
  );
}

/** A rule's chip (bar, settings list, chart drill): type icon, "이름:" and the condition — blue once it
 *  filters, grey while it has no value. */
export function RuleChip({ rule, property, pages, onClick, chipRef, dot = false }: { rule: Rule; property: PropertyEntity | undefined; pages: Map<string, PageEntity>; onClick: (element: HTMLButtonElement) => void; chipRef?: (element: HTMLButtonElement | null) => void; dot?: boolean }) {
  const summary = ruleSummary(rule, property, pages);
  return (
    <button type="button" ref={chipRef} className={`filter-chip${summary ? ' active' : ''}`} onClick={event => onClick(event.currentTarget)}>
      {dot ? <span className="chip-dot" aria-hidden /> : null}
      <Icon name={typeIcon(property)} size={14} />
      <span className="filter-chip-name">{property?.name ?? t("삭제된 속성")}{summary ? ':' : ''}</span>{summary ? <span className="filter-chip-value">{summary}</span> : null}
      <Icon name="chevron-down" size={12} />
    </button>
  );
}

export function usePageIndex(): Map<string, PageEntity> {
  const ws = useWorkspace();
  return new Map((ws.snapshot.objects.filter(item => item.kind === 'page') as PageEntity[]).map(page => [page.id, page]));
}

/** The rules as a list (view settings › 필터 and the chart drill's filter panel): each
 *  chip behind a drag handle, rows 31 high, then grey "+ 필터 추가". A property already filtered is not
 *  offered again. */
export function FilterRuleList({ rules, properties, onChange, onAdvanced }: { rules: Rule[]; properties: PropertyEntity[]; onChange: (rules: Rule[]) => void; onAdvanced?: () => void }) {
  const pages = usePageIndex();
  const [open, setOpen] = useState<{ anchor: Element; index: number } | null>(null);
  const [picker, setPicker] = useState<Element | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const byId = new Map(properties.map(property => [property.id, property]));
  return (
    <div className="filter-rule-list">
      {rules.map((item, index) => (
        <div key={`${item.propertyId}-${index}`} className={`filter-rule-item${drag === index ? ' dragging' : ''}`} draggable onDragStart={() => setDrag(index)} onDragEnd={() => setDrag(null)} onDragOver={event => event.preventDefault()}
          onDrop={() => { if (drag === null || drag === index) return; const list = [...rules]; const [moved] = list.splice(drag, 1); list.splice(index, 0, moved); onChange(list); setDrag(null); }}>
          <span className="filter-rule-handle"><Icon name="drag" size={16} /></span>
          <RuleChip rule={item} property={byId.get(item.propertyId)} pages={pages} onClick={element => setOpen({ anchor: element, index })}
            chipRef={element => { if (element && fresh === index && !open) { setFresh(null); setOpen({ anchor: element, index }); } }} />
        </div>
      ))}
      <button type="button" className="filter-rule-add" onClick={event => setPicker(event.currentTarget)}><Icon name="plus" size={16} /><span>{t("필터 추가")}</span></button>
      {open && rules[open.index] ? (
        <RulePopover key={`${open.index}-${rules[open.index].propertyId}`} anchor={open.anchor} rule={rules[open.index]} property={byId.get(rules[open.index].propertyId)} onClose={() => setOpen(null)}
          onChange={next => onChange(rules.map((item, i) => i === open.index ? next : item))}
          onRemove={() => onChange(rules.filter((_, i) => i !== open.index))} onAdvanced={onAdvanced} />
      ) : null}
      {picker ? <PropertyPicker anchor={picker} title={t("필터 기준…")} properties={properties.filter(property => !rules.some(item => item.propertyId === property.id))} onClose={() => setPicker(null)}
        onPick={property => { onChange([...rules, makeRule(property)]); setFresh(rules.length); }} /> : null}
    </div>
  );
}

// The sort editor: under the sort chip, 335 wide, r10. A row per sort — drag handle,
// the property (a 32-high outlined button: type icon, name, ⌄) and the direction (150 wide, "A→Z…" for text,
// "낮음→높음…" for numbers, "과거→최신…" for dates), × at the right — then grey "정렬 추가" and "정렬 삭제".
// The property button opens a searchable property list; the direction one a 180-wide list right under it.
export function sortDirectionLabels(property?: PropertyEntity): [string, string] {
  const type = property?.type;
  if (type === 'number' || type === 'unique_id') return [t("낮음→높음 순으로 정렬"), t("높음→낮음 순으로 정렬")];
  if (type === 'date' || type === 'created_time' || type === 'last_edited_time') return [t("과거→최신 순으로 정렬"), t("최신→과거 순으로 정렬")];
  // The column menu's 정렬 submenu: checkboxes by checked state, options in order.
  if (type === 'checkbox') return [t("체크 안 됨→체크됨 순으로 정렬"), t("체크됨→체크 안 됨 순으로 정렬")];
  if (type === 'select' || type === 'status' || type === 'multi_select') return [t("오름차순 정렬"), t("내림차순 정렬")];
  return [t("A→Z 순으로 정렬"), t("Z→A 순으로 정렬")];
}

export function SortPopover({ anchor, view, result, onClose }: { anchor: Anchor; view: ViewEntity; result: QueryResult; onClose: () => void }) {
  const ws = useWorkspace();
  const live = ws.get<ViewEntity>(view.id) ?? view;
  const sorts = live.config.sorts ?? [];
  const [menu, setMenu] = useState<{ kind: 'property' | 'direction'; index: number; anchor: Element } | null>(null);
  const [picker, setPicker] = useState<Element | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const byId = new Map(result.properties.map(property => [property.id, property]));
  const update = useViewUpdate();
  const set = (next: typeof sorts) => update(live, { sorts: next });
  // The last sort removed with × takes the editor (and its chip) away.
  const had = useRef(sorts.length > 0);
  useEffect(() => { if (had.current && !sorts.length) onClose(); had.current = sorts.length > 0; }, [sorts.length]);
  const current = menu ? sorts[menu.index] : undefined;
  return (
    <Popover anchor={anchor} placement="below-start" offset={4} onClose={onClose} className="sort-popover" style={{ minWidth: 335 }} label={t("정렬")}>
      <div className="sort-list">
        {sorts.map((sort, index) => {
          const property = byId.get(sort.propertyId);
          const [asc, desc] = sortDirectionLabels(property);
          return (
            <div key={`${sort.propertyId}-${index}`} className={`sort-row${drag === index ? ' dragging' : ''}`} draggable onDragStart={() => setDrag(index)} onDragEnd={() => setDrag(null)} onDragOver={event => event.preventDefault()}
              onDrop={() => { if (drag === null || drag === index) return; const list = [...sorts]; const [moved] = list.splice(drag, 1); list.splice(index, 0, moved); set(list); setDrag(null); }}>
              <span className="sort-handle"><Icon name="drag" size={16} /></span>
              <button type="button" className="sort-field" onClick={event => setMenu({ kind: 'property', index, anchor: event.currentTarget })}>
                <Icon name={typeIcon(property)} size={16} className="sort-field-icon" /><span className="sort-field-text">{property?.name ?? t("삭제된 속성")}</span><Icon name="chevron-down" size={12} className="sort-field-chevron" />
              </button>
              <button type="button" className="sort-field direction" onClick={event => setMenu({ kind: 'direction', index, anchor: event.currentTarget })}>
                <span className="sort-field-text">{sort.direction === 'desc' ? desc : asc}</span><Icon name="chevron-down" size={12} className="sort-field-chevron" />
              </button>
              <span className="spacer" />
              <button type="button" className="icon-button sort-remove" aria-label={t("정렬 삭제")} title={t("정렬 삭제")} onClick={() => set(sorts.filter((_, i) => i !== index))}><Icon name="close" size={16} /></button>
            </div>
          );
        })}
      </div>
      <div className="sort-actions">
        <button type="button" className="menu-item sort-action" onClick={event => setPicker(event.currentTarget)}><span className="menu-item-icon"><Icon name="plus" /></span><span className="menu-item-label">{t("정렬 추가")}</span></button>
        <button type="button" className="menu-item sort-action" onClick={() => { set([]); onClose(); }}><span className="menu-item-icon"><Icon name="trash" /></span><span className="menu-item-label">{t("sort|정렬 삭제")}</span></button>
      </div>
      {menu?.kind === 'property' && current ? (
        <PropertyPicker anchor={menu.anchor} title={t("속성 검색…")} width={280} properties={result.properties.filter(property => property.id === current.propertyId || !sorts.some(sort => sort.propertyId === property.id))}
          onClose={() => setMenu(null)} onPick={property => set(sorts.map((item, i) => i === menu.index ? { ...item, propertyId: property.id } : item))} />
      ) : null}
      {menu?.kind === 'direction' && current ? (() => {
        const [asc, desc] = sortDirectionLabels(byId.get(current.propertyId));
        return <Menu anchor={menu.anchor} width={180} offset={0} onClose={() => setMenu(null)} entries={[
          { label: asc, onSelect: () => set(sorts.map((item, i) => i === menu.index ? { ...item, direction: 'asc' as const } : item)) },
          { label: desc, onSelect: () => set(sorts.map((item, i) => i === menu.index ? { ...item, direction: 'desc' as const } : item)) },
        ]} />;
      })() : null}
      {picker ? <PropertyPicker anchor={picker} title={t("정렬 기준…")} properties={result.properties.filter(property => !sorts.some(sort => sort.propertyId === property.id))} onClose={() => setPicker(null)} onPick={property => set([...sorts, { propertyId: property.id, direction: 'asc' }])} /> : null}
    </Popover>
  );
}

// The view's advanced filter: under its "규칙 N개" chip, 494 wide, r10;
// changes apply as they are made; "필터 삭제" removes the whole filter.
export function AdvancedFilterPopover({ anchor, view, onClose }: { anchor: Anchor; view: ViewEntity; onClose: () => void }) {
  const [value, setValue] = useState<Filter | null>(view.config.filter ?? null);
  const update = useViewUpdate();
  const change = (next: Filter | null) => { setValue(next); update(view, { filter: next, advancedFilter: true }); };
  return (
    <Popover anchor={anchor} placement="below-start" offset={4} onClose={onClose} className="advanced-filter-popover" style={{ minWidth: 494 }} label={t("고급 필터")}>
      <FilterEditor sourceId={view.sourceId} value={value} onChange={change} onDeleteAll={() => { update(view, { filter: null, advancedFilter: false }); onClose(); }} />
    </Popover>
  );
}

export function countRules(filter: Filter | null | undefined): number {
  if (!filter) return 0;
  if ('not' in filter) return countRules(filter.not);
  if ('all' in filter) return filter.all.reduce((sum, item) => sum + countRules(item), 0);
  if ('any' in filter) return filter.any.reduce((sum, item) => sum + countRules(item), 0);
  return 1;
}

// Chips under the tabs (shown when the view has filters or sorts). A sort chip shows its direction
// (↑ 이름 ⌄); the sort editor opens under it when a sort is first added or the toolbar's sort button brings
// the bar back.
export function FilterSortBar({ view, result, pendingRule, onPendingDone, changed, onReset }: { view: ViewEntity; result: QueryResult; pendingRule?: string | null; onPendingDone?: () => void; changed?: { sorts?: boolean; filter?: boolean }; onReset?: () => void }) {
  const pages = usePageIndex();
  const updateView = useViewUpdate();
  const [rule, setRule] = useState<{ anchor: Element; index: number } | null>(null);
  const [sort, setSort] = useState<Element | null>(null);
  const [picker, setPicker] = useState<Element | null>(null);
  const [advanced, setAdvanced] = useState<Element | null>(null);
  // A rule just added from "+ 필터" opens its editor once its chip is drawn.
  const [newRule, setNewRule] = useState<string | null>(null);
  const rules = view.config.advancedFilter && view.config.filter ? null : filterRules(view.config.filter);
  const sorts = view.config.sorts ?? [];
  const setRules = (next: Rule[]) => updateView(view, { filter: next.length ? { all: next } : null });
  // "고급 필터 추가": the simple rules become the advanced filter (a rule on the first property
  // is added when there are none); its editor opens under the chip.
  const chipRef = useRef<HTMLDivElement>(null);
  const openAdvanced = () => requestAnimationFrame(() => { const chip = chipRef.current?.querySelector('.filter-chip.advanced'); if (chip) setAdvanced(chip); });
  const startAdvanced = () => {
    const first = result.properties[0];
    const filter = view.config.filter ?? (first ? { all: [makeRule(first) as Filter] } : null);
    updateView(view, { filter, advancedFilter: true }).then(openAdvanced);
  };
  const byId = new Map(result.properties.map(property => [property.id, property]));
  return (
    <div className="filter-bar" ref={chipRef}>
      {sorts.length ? (
        <button type="button" className="filter-chip active sort-chip" ref={element => { if (element && pendingRule === '$sort' && !sort) { onPendingDone?.(); setSort(element); } }} onClick={event => setSort(event.currentTarget)}>
          {changed?.sorts ? <span className="chip-dot" aria-hidden /> : null}<Icon name={sorts.length === 1 ? (sorts[0].direction === 'desc' ? 'arrow-down' : 'arrow-up') : 'sort'} size={14} /><span>{sorts.length === 1 ? byId.get(sorts[0].propertyId)?.name ?? t("정렬") : t("정렬 {0}개", [sorts.length])}</span><Icon name="chevron-down" size={12} />
        </button>
      ) : null}
      {sorts.length ? <span className="filter-bar-divider" /> : null}
      {rules === null ? (
        <button type="button" className="filter-chip active advanced" ref={element => { if (element && pendingRule === '$advanced' && !advanced) { onPendingDone?.(); setAdvanced(element); } }} onClick={event => setAdvanced(event.currentTarget)}>{changed?.filter ? <span className="chip-dot" aria-hidden /> : null}<Icon name="filter" size={14} /><span>{t("규칙 {0}개", [countRules(view.config.filter)])}</span><Icon name="chevron-down" size={12} /></button>
      ) : rules.map((item, index) => (
        <RuleChip key={`${item.propertyId}-${index}`} rule={item} property={byId.get(item.propertyId)} pages={pages} dot={!!changed?.filter} onClick={element => setRule({ anchor: element, index })}
          chipRef={element => { if (element && (pendingRule === item.propertyId || newRule === item.propertyId) && index === rules.length - 1 && !rule) { onPendingDone?.(); setNewRule(null); setRule({ anchor: element, index }); } }} />
      ))}
      <button type="button" className="filter-add" onClick={event => setPicker(event.currentTarget)}><Icon name="plus" size={14} />{t("필터")}</button>
      {onReset && (changed?.sorts || changed?.filter) ? <><span className="spacer" /><button type="button" className="filter-reset" onClick={onReset}>{t("library|재설정")}</button></> : null}
      {rule && rules && rules[rule.index] ? (
        <RulePopover key={`${rule.index}-${rules[rule.index]?.propertyId}`} anchor={rule.anchor} rule={rules[rule.index]} property={byId.get(rules[rule.index]?.propertyId)} onClose={() => setRule(null)}
          onChange={next => setRules(rules.map((item, i) => i === rule.index ? next : item))}
          onRemove={() => setRules(rules.filter((_, i) => i !== rule.index))}
          onAdvanced={() => { updateView(view, { filter: rules.length ? { all: rules } : null, advancedFilter: true }).then(openAdvanced); }} />
      ) : null}
      {sort ? <SortPopover anchor={sort} view={view} result={result} onClose={() => setSort(null)} /> : null}
      {advanced ? <AdvancedFilterPopover anchor={advanced} view={view} onClose={() => setAdvanced(null)} /> : null}
      {picker ? (
        <PropertyPicker anchor={picker} title={t("필터 기준…")} properties={rules ? result.properties.filter(property => !rules.some(item => item.propertyId === property.id)) : result.properties} onClose={() => setPicker(null)}
          onPick={property => {
            const rule = makeRule(property);
            // With an advanced filter in place, a new rule joins it.
            if (rules) { setRules([...rules, rule]); setNewRule(property.id); }
            else updateView(view, { filter: { all: [...(view.config.filter ? [view.config.filter] : []), rule] }, advancedFilter: true });
          }}
          footer={[{ label: t("고급 필터 추가"), icon: 'plus', muted: true, onSelect: () => { setPicker(null); startAdvanced(); } }]} />
      ) : null}
    </div>
  );
}
