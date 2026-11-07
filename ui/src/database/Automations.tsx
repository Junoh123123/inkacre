import { formatHour, statusGroupLabel } from '../data/format';
import { intlLocale, t, tx } from '../i18n';
import { useMemo, useState, type ReactNode } from 'react';
import { apply } from '../data/commands';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import type { AutomationEntity as StoredAutomation, Filter, PropertyEntity, SourceEntity, ViewEntity } from '../data/types';
import { Icon, viewIcon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Popover, type Anchor } from '../ui/overlay';
import { Switch, confirmSmall, mountTransient } from '../ui/primitives';
import { EditableValue, OptionTag, ValueView, readOnlyTypes } from './values';
import { FilterEditor, FilterValueInput, newRule, opLabel, operatorsFor } from '../dialogs/filters';
import { WebhookEditor } from '../dialogs/buttons';
import { newId } from '../data/commands';
import { FormulaPopover, TokenField, ValueSource, VariablesCard, variableIcon, type Variable } from './AutomationVariables';

// Database automations (⚡):
// - the editor is a 500×600 r12 modal 88 from the top: the name (17px), the scope ("<DB> ∨ 의 모든 페이지", with an
//   "활성" switch once saved), then "언제" (or "모두 ∨ 트리거 발생 시") over 466-wide r10 cards and "+ 새 트리거",
//   a 2×56 connector, "실행" over the action cards and "+ 새 작업", and 취소 / 활성화 (완료 when editing).
// - triggers: 아무 속성이나 편집됨 · 페이지 추가됨 · ~마다 (a schedule), or one property (its options to watch);
//   actions: 속성 편집… · 페이지 추가 · 페이지 편집 · 알림 보내기 · Webhook 보내기 · 변수 정의.
// - the list lives in the view settings panel ("자동화"): search, a hint about schedules, one card per automation
//   (trigger → action icons, name, summary; "⋯" for 활성 / 삭제) and a blue "+ 새 자동화".

export type Schedule = { frequency: 'day' | 'weekday' | 'week' | 'month' | 'year'; interval: number; start: string; end?: string | null; timeZone: string };
export type TriggerCondition = { op: string; value?: unknown };
export type Trigger = { type: 'page_added' } | { type: 'any_property_edited' } | { type: 'property_edited'; propertyId: string; values?: unknown[]; condition?: TriggerCondition } | { type: 'recurring'; schedule: Schedule };
export type AutomationAction = Record<string, unknown> & { action: string };
type AutomationEntity = Omit<StoredAutomation, 'triggers' | 'actions'> & { triggers: Trigger[]; actions: AutomationAction[] };
interface Draft { name: string; enabled: boolean; match: 'all' | 'any'; viewId: string | null; triggers: Trigger[]; actions: AutomationAction[] }

export const defaultAutomationName = t("내 자동화");
export function automationsOf(sourceId: string): AutomationEntity[] {
  return (workspace.snapshot.objects.filter(item => item.kind === 'automation' && item.alive && (item as StoredAutomation).sourceId === sourceId && workspace.visible(item.id)) as StoredAutomation[])
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as unknown as AutomationEntity[];
}


const untriggerable = new Set(['place', 'unique_id', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'formula', 'rollup', 'files', 'button']);
const optionTypes = new Set(['select', 'status', 'multi_select', 'checkbox']);
const byName = (properties: PropertyEntity[]) => [...properties].sort((a, b) => a.type === 'title' ? -1 : b.type === 'title' ? 1 : a.name.localeCompare(b.name, intlLocale));
export const triggerProperties = (sourceId: string) => byName(workspace.schema(sourceId).filter(property => !untriggerable.has(property.type)));
const writableProperties = (sourceId: string) => byName(workspace.schema(sourceId).filter(property => !readOnlyTypes.has(property.type) && !['button', 'files'].includes(property.type)));

const frequencies: Array<{ id: string; label: string; schedule: Pick<Schedule, 'frequency' | 'interval'> }> = [
  { id: 'day', label: t("일"), schedule: { frequency: 'day', interval: 1 } }, { id: 'weekday', label: t("평일"), schedule: { frequency: 'weekday', interval: 1 } },
  { id: 'week', label: t("주"), schedule: { frequency: 'week', interval: 1 } }, { id: 'week2', label: t("2주"), schedule: { frequency: 'week', interval: 2 } },
  { id: 'month', label: t("월"), schedule: { frequency: 'month', interval: 1 } }, { id: 'month3', label: t("3개월"), schedule: { frequency: 'month', interval: 3 } },
  { id: 'month6', label: t("6개월"), schedule: { frequency: 'month', interval: 6 } }, { id: 'year', label: t("년"), schedule: { frequency: 'year', interval: 1 } },
];
const unitLabels: Record<Schedule['frequency'], string> = { day: t("일"), weekday: t("평일"), week: t("주"), month: t("개월"), year: t("년") };
// "2주", "3개월" — a count of units, worded per language.
const intervalLabel = (schedule: Schedule) => {
  const n = schedule.interval;
  switch (schedule.frequency) {
    case 'day': return t("interval-day|{0}일", [n]);
    case 'week': return t("interval-week|{0}주", [n]);
    case 'month': return t("interval-month|{0}개월", [n]);
    case 'year': return t("interval-year|{0}년", [n]);
    default: return unitLabels[schedule.frequency];
  }
};
const frequencyLabel = (schedule: Schedule) => frequencies.find(item => item.schedule.frequency === schedule.frequency && item.schedule.interval === schedule.interval)?.label ?? intervalLabel(schedule);
function localNow(offsetDays = 0) {
  const at = new Date(Date.now() + offsetDays * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
const defaultSchedule = (pick: Pick<Schedule, 'frequency' | 'interval'>): Schedule => ({ ...pick, start: `${localNow(1)}T00:00`, end: null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });

function propertyName(id: string) { return workspace.get<PropertyEntity>(id)?.name ?? t("삭제된 속성"); }
export function triggerSummary(trigger: Trigger): string {
  if (trigger.type === 'page_added') return t("페이지 추가됨");
  if (trigger.type === 'any_property_edited') return t("아무 속성이나 편집됨");
  if (trigger.type === 'recurring') return t("{0}마다", [frequencyLabel(trigger.schedule)]);
  return t("trigger|{0} 편집", [propertyName(trigger.propertyId)]);
}
// Variables defined by the actions before `index` (what a later 속성 편집 can use).
function variablesBefore(actions: AutomationAction[], index: number): Variable[] {
  return actions.slice(0, index).flatMap(action => action.action === 'define_variables' ? action.variables as Variable[] : []);
}
const isReference = (value: unknown): value is { $variable?: string; $formula?: string } => !!value && typeof value === 'object' && !Array.isArray(value) && ('$variable' in value || '$formula' in value);
function valueText(property: PropertyEntity | undefined, value: unknown): string {
  if (!property) return '';
  if (isReference(value)) return value.$formula != null ? t("수식") : t("변수");
  if (value === '$today') return t("오늘"); if (value === '$now') return t("지금");
  if (property.type === 'checkbox') return value ? t("체크됨") : t("체크 안 됨");
  const ids = Array.isArray(value) ? value : value == null ? [] : [value];
  if (property.options) return ids.map(id => property.options!.find(option => option.id === id)?.name ?? '').filter(Boolean).join(', ') || t("비어 있음");
  if (value && typeof value === 'object' && 'start' in (value as object)) return String((value as { start: string }).start);
  return value == null || value === '' ? t("비어 있음") : String(value);
}
export function actionSummary(action: AutomationAction): string {
  if (action.action === 'set_property') { const property = workspace.get<PropertyEntity>(String(action.propertyId)); return t("{0}을(를) {1}(으)로 설정", [property?.name ?? t("속성"), valueText(property, action.value)]); }
  if (action.action === 'add_page') return t("{0}에 페이지 추가", [workspace.get<SourceEntity>(String(action.sourceId))?.name ?? t("데이터베이스")]);
  if (action.action === 'edit_pages') return t("{0}의 페이지 편집", [workspace.get<SourceEntity>(String(action.sourceId))?.name ?? t("데이터베이스")]);
  if (action.action === 'notify') return t("알림 보내기");
  if (action.action === 'send_webhook') return t("Webhook 보내기");
  if (action.action === 'define_variables') return t("변수 정의");
  return action.action;
}
const triggerIcon = (trigger: Trigger) => trigger.type === 'page_added' ? 'plus' : trigger.type === 'any_property_edited' ? 'pencil' : trigger.type === 'recurring' ? 'repeat' : `type-${workspace.get<PropertyEntity>(trigger.propertyId)?.type ?? 'text'}`;
const actionIcon = (action: AutomationAction) => action.action === 'set_property' ? `type-${workspace.get<PropertyEntity>(String(action.propertyId))?.type ?? 'text'}` : action.action === 'add_page' ? 'plus' : action.action === 'edit_pages' ? 'pencil' : action.action === 'notify' ? 'bell' : action.action === 'define_variables' ? 'variable' : 'link';

// ---------- the editor ----------

export function openAutomationEditor(sourceId: string, id?: string, preset?: Partial<Draft>) {
  mountTransient(close => <AutomationEditor sourceId={sourceId} id={id} preset={preset} onClose={close} />);
}

function AutomationEditor({ sourceId, id, preset, onClose }: { sourceId: string; id?: string; preset?: Partial<Draft>; onClose: () => void }) {
  const ws = useWorkspace();
  const existing = id ? ws.get<StoredAutomation>(id) as unknown as AutomationEntity | undefined : undefined;
  const initial = useMemo<Draft>(() => existing
    ? { name: existing.name, enabled: existing.enabled, match: existing.match ?? 'all', viewId: existing.viewId ?? null, triggers: existing.triggers, actions: existing.actions }
    : { name: '', enabled: true, match: 'all', viewId: null, triggers: [], actions: [], ...preset }, []);
  const [draft, setDraft] = useState<Draft>(initial);
  const [menu, setMenu] = useState<{ kind: 'trigger' | 'action' | 'scope' | 'match' | 'frequency' | 'card-trigger' | 'card-action'; anchor: Element; index?: number } | null>(null);
  const [valuesFor, setValuesFor] = useState<{ anchor: Element; propertyId: string; index?: number } | null>(null);
  const [conditionFor, setConditionFor] = useState<{ anchor: Element; index: number } | null>(null);
  const [actionFor, setActionFor] = useState<{ anchor: Element; index: number; fresh?: boolean } | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Element | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const source = ws.get<SourceEntity>(sourceId);
  const views = ws.viewsOf(sourceId).filter(view => !['form', 'dashboard', 'chart'].includes(view.viewType));
  const recurring = draft.triggers.find(trigger => trigger.type === 'recurring') as Extract<Trigger, { type: 'recurring' }> | undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const ready = draft.triggers.length > 0 && draft.actions.length > 0;
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const usedProperties = new Set(draft.triggers.flatMap(trigger => trigger.type === 'property_edited' ? [trigger.propertyId] : []));

  const cancel = async () => { if (!dirty || await confirmSmall(t("이 자동화에 저장되지 않은 변경 사항을 삭제할까요?"), t("삭제"))) onClose(); };
  const save = () => {
    const name = draft.name.trim() || defaultAutomationName;
    const fields = { name, match: draft.match, viewId: recurring ? null : draft.viewId, triggers: draft.triggers, actions: draft.actions };
    const operation = existing ? { type: 'automation.update', id: existing.id, enabled: draft.enabled, ...fields } : { type: 'automation.create', sourceId, enabled: true, ...fields };
    apply([operation]).then(() => { if (!existing) setStatus(t("{0}을(를) 만들었습니다", [name])); onClose(); }).catch(report);
  };

  const triggerEntries = (): MenuEntry[] => [
    { kind: 'section', label: t("이벤트") },
    ...(draft.triggers.some(trigger => trigger.type === 'any_property_edited') ? [] : [{ label: t("아무 속성이나 편집됨"), icon: 'pencil', onSelect: () => set({ triggers: [...draft.triggers, { type: 'any_property_edited' }] }) } as MenuEntry]),
    ...(draft.triggers.some(trigger => trigger.type === 'page_added') ? [] : [{ label: t("페이지 추가됨"), icon: 'plus', onSelect: () => set({ triggers: [...draft.triggers, { type: 'page_added' }] }) } as MenuEntry]),
    ...(draft.triggers.length ? [] : [{ label: t("~마다"), icon: 'repeat', onSelect: () => set({ triggers: [{ type: 'recurring', schedule: defaultSchedule({ frequency: 'day', interval: 1 }) }], viewId: null }) } as MenuEntry]),
    { kind: 'separator' },
    { kind: 'section', label: t("속성") },
    ...triggerProperties(sourceId).filter(property => !usedProperties.has(property.id)).map(property => ({
      label: property.name, icon: `type-${property.type}`, keywords: property.name, right: <Icon name="chevron-right" size={14} className="menu-item-chevron" />,
      onSelect: () => {
        if (optionTypes.has(property.type) && menu) setValuesFor({ anchor: menu.anchor, propertyId: property.id });
        else set({ triggers: [...draft.triggers, { type: 'property_edited', propertyId: property.id }] });
      },
    } as MenuEntry)),
  ];
  const addAction = (action: AutomationAction, anchor: Element) => {
    const index = insertAt ?? draft.actions.length;
    const actions = [...draft.actions]; actions.splice(index, 0, action);
    set({ actions }); setInsertAt(null);
    if (action.action !== 'define_variables' && (action.action !== 'notify' || !action.message)) setActionFor({ anchor, index, fresh: true });
  };
  const actionEntries = (anchor: Element): MenuEntry[] => [
    ...(recurring ? [] : [{ label: t("속성 편집…"), icon: 'sliders', submenuWidth: 250, submenu: () => writableProperties(sourceId).map(property => ({ label: property.name, icon: `type-${property.type}`, keywords: property.name, onSelect: () => addAction({ action: 'set_property', propertyId: property.id, value: property.type === 'checkbox' ? true : null }, anchor) }) as MenuEntry) } as MenuEntry]),
    { label: t("페이지 추가"), icon: 'plus', onSelect: () => addAction({ action: 'add_page', sourceId, title: '' }, anchor) },
    { label: t("페이지 편집"), icon: 'pencil', onSelect: () => addAction({ action: 'edit_pages', sourceId, filter: { all: [] }, propertyId: '', value: null }, anchor) },
    { label: t("알림 보내기…"), icon: 'bell', onSelect: () => addAction({ action: 'notify', message: '' }, anchor) },
    { label: t("Webhook 보내기"), icon: 'link', onSelect: () => addAction({ action: 'send_webhook', url: '', body: { text: '' } }, anchor) },
    { label: t("변수 정의"), icon: 'variable', onSelect: () => {
      const taken = new Set(draft.actions.flatMap(action => action.action === 'define_variables' ? (action.variables as Variable[]).map(item => item.name) : []));
      let n = taken.size + 1; while (taken.has(t("변수 {0}", [n]))) n++;
      addAction({ action: 'define_variables', variables: [{ id: newId(), name: t("변수 {0}", [n]), mode: 'text', value: '' }] }, anchor);
    } },
  ];

  const scopeLabel = draft.viewId ? ws.get<ViewEntity>(draft.viewId)?.name ?? source?.name : source?.name;
  return (
    <Popover anchor={{ x: Math.max(16, (window.innerWidth - 500) / 2), y: 88 }} placement="point" onClose={() => { cancel().catch(report); }} modal className="automation-editor" label={t("자동화 편집")}>
      <div className="automation-head">
        <input className="automation-name" value={draft.name} placeholder={defaultAutomationName} aria-label={t("자동화 이름")} onChange={event => set({ name: event.target.value })} />
        <button type="button" className="automation-close" aria-label={t("닫기")} onClick={() => { cancel().catch(report); }}><Icon name="close" size={12} /></button>
        <div className="automation-scope">
          {existing ? <label className="automation-enabled"><Switch checked={draft.enabled} onChange={value => set({ enabled: value })} label={t("활성")} /><span>{t("활성")}</span></label> : null}
          {existing ? <span className="automation-scope-sep" /> : null}
          {recurring ? <span className="automation-scope-text">{tx("{0} 대상", [<strong>{source?.name}</strong>])}</span> : (
            tx("{0}의 모든 페이지", [<button type="button" className="automation-scope-button" onClick={event => setMenu({ kind: 'scope', anchor: event.currentTarget })}><strong>{scopeLabel}</strong><Icon name="chevron-down" size={12} /></button>])
          )}
        </div>
      </div>
      <div className="automation-body">
        {draft.triggers.length && !recurring ? (
          <div className="automation-label"><button type="button" className="automation-match" onClick={event => setMenu({ kind: 'match', anchor: event.currentTarget })}>{draft.match === 'any' ? t("하나라도") : t("모두")}<Icon name="chevron-down" size={10} /></button><span>{t("트리거 발생 시")}</span></div>
        ) : <div className="automation-label">{t("언제")}</div>}
        {draft.triggers.map((trigger, index) => (
          <div key={index} className="automation-card" title={triggerSummary(trigger)} onClick={event => {
            if (trigger.type === 'property_edited' && optionTypes.has(workspace.get<PropertyEntity>(trigger.propertyId)?.type ?? '')) setValuesFor({ anchor: event.currentTarget, propertyId: trigger.propertyId, index });
            else if (trigger.type === 'property_edited' && workspace.get<PropertyEntity>(trigger.propertyId)) setConditionFor({ anchor: event.currentTarget, index });
          }}>
            <Icon name={triggerIcon(trigger)} size={16} />
            {trigger.type === 'recurring' ? (
              <span className="automation-card-text">
                {tx("{0}마다{1}", [<button type="button" className="automation-frequency" onClick={event => { event.stopPropagation(); setMenu({ kind: 'frequency', anchor: event.currentTarget }); }}>{frequencyLabel(trigger.schedule)}<Icon name="chevron-down" size={10} /></button>, <button type="button" className="automation-schedule-open" onClick={event => { event.stopPropagation(); setScheduleFor(event.currentTarget.closest('.automation-card')); }}>{scheduleSummary(trigger.schedule)}</button>])}
              </span>
            ) : <span className="automation-card-text"><TriggerText trigger={trigger} /></span>}
            <button type="button" className="automation-card-more" aria-label={t("트리거 옵션")} onClick={event => { event.stopPropagation(); setMenu({ kind: 'card-trigger', anchor: event.currentTarget, index }); }}><Icon name="more" size={14} /></button>
          </div>
        ))}
        {!recurring ? <button type="button" className="automation-add" onClick={event => setMenu({ kind: 'trigger', anchor: event.currentTarget })}><Icon name="plus" size={14} /><span>{draft.triggers.length ? t("트리거 추가") : t("새 트리거")}</span></button> : null}
        <div className="automation-connector" />
        <div className="automation-label">{t("실행")}</div>
        {draft.actions.map((action, index) => action.action === 'define_variables' ? (
          <VariablesCard key={index} variables={action.variables as Variable[]} sourceId={sourceId} hasPage={!recurring}
            onChange={variables => set({ actions: draft.actions.map((item, i) => i === index ? { ...item, variables } : item) })}
            onMore={anchor => setMenu({ kind: 'card-action', anchor, index })} />
        ) : (
          <div key={index} className="automation-card" title={actionSummary(action)} onClick={event => setActionFor({ anchor: event.currentTarget, index })}>
            <Icon name={actionIcon(action)} size={16} />
            <span className="automation-card-text"><ActionText action={action} variables={variablesBefore(draft.actions, index)} /></span>
            <button type="button" className="automation-card-more" aria-label={t("작업 옵션")} onClick={event => { event.stopPropagation(); setMenu({ kind: 'card-action', anchor: event.currentTarget, index }); }}><Icon name="more" size={14} /></button>
          </div>
        ))}
        <button type="button" className="automation-add" onClick={event => setMenu({ kind: 'action', anchor: event.currentTarget })}><Icon name="plus" size={14} /><span>{draft.actions.length ? t("작업 추가") : t("새 작업")}</span></button>
      </div>
      <div className="automation-foot">
        <button type="button" className="outline-button automation-cancel" onClick={() => { cancel().catch(report); }}>{t("취소")}</button>
        <button type="button" className="blue-button automation-save" disabled={!ready || (!!existing && !dirty)} onClick={save}>{existing ? t("완료") : t("활성화")}</button>
      </div>
      {menu?.kind === 'trigger' ? <Menu anchor={menu.anchor} placement="below-start" offset={0} width={266} search={t("트리거 검색…")} maxHeight={366} entries={triggerEntries()} onClose={() => setMenu(null)} label={t("트리거")} /> : null}
      {menu?.kind === 'action' ? <Menu anchor={menu.anchor} placement="below-start" offset={0} width={261} search={t("작업 검색…")} entries={actionEntries(menu.anchor)} onClose={() => setMenu(null)} label={t("작업")} /> : null}
      {menu?.kind === 'match' ? <Menu anchor={menu.anchor} width={200} onClose={() => setMenu(null)} entries={[{ label: t("모두"), checked: draft.match === 'all', onSelect: () => set({ match: 'all' }) }, { label: t("하나라도"), checked: draft.match === 'any', onSelect: () => set({ match: 'any' }) }]} /> : null}
      {menu?.kind === 'scope' ? <Menu anchor={menu.anchor} width={260} search={t("보기 검색…")} onClose={() => setMenu(null)} label={t("대상")}
        entries={[{ label: source?.name ?? '', hint: t("데이터 소스 전체"), checked: !draft.viewId, onSelect: () => set({ viewId: null }) }, { kind: 'separator' },
          ...views.map(view => ({ label: view.name, icon: viewIcon[view.viewType] ?? 'table', hint: t("이 보기의 모든 페이지"), checked: draft.viewId === view.id, keywords: view.name, onSelect: () => set({ viewId: view.id }) }) as MenuEntry)]} /> : null}
      {menu?.kind === 'frequency' && recurring ? <Menu anchor={menu.anchor} width={176} onClose={() => setMenu(null)}
        entries={frequencies.map(item => ({ label: item.label, checked: recurring.schedule.frequency === item.schedule.frequency && recurring.schedule.interval === item.schedule.interval, onSelect: () => { set({ triggers: [{ type: 'recurring', schedule: { ...recurring.schedule, ...item.schedule } }] }); } }))} /> : null}
      {menu?.kind === 'card-trigger' && menu.index != null ? <Menu anchor={menu.anchor} placement="below-end" width={180} onClose={() => setMenu(null)}
        entries={[{ label: t("삭제"), icon: 'trash', onSelect: () => set({ triggers: draft.triggers.filter((_, i) => i !== menu.index) }) }]} /> : null}
      {menu?.kind === 'card-action' && menu.index != null ? <Menu anchor={menu.anchor} placement="below-end" width={240} onClose={() => setMenu(null)}
        entries={[
          ...(draft.actions[menu.index]?.action === 'define_variables' ? [] : [{ label: t("편집"), icon: 'pencil', onSelect: () => setActionFor({ anchor: menu.anchor.closest('.automation-card') ?? menu.anchor, index: menu.index! }) } as MenuEntry, { kind: 'separator' } as MenuEntry]),
          { label: t("위에 작업 추가"), icon: 'turn-into', onSelect: () => { setInsertAt(menu.index!); setMenu({ kind: 'action', anchor: menu.anchor.closest('.automation-card') ?? menu.anchor }); }, keepOpen: true },
          { label: t("아래에 작업 추가"), icon: 'arrow-down', onSelect: () => { setInsertAt(menu.index! + 1); setMenu({ kind: 'action', anchor: menu.anchor.closest('.automation-card') ?? menu.anchor }); }, keepOpen: true },
          { kind: 'separator' },
          { label: t("복제"), icon: 'duplicate', onSelect: () => {
            const copy = structuredClone(draft.actions[menu.index!]);
            // Copied variables get new ids and names of their own.
            if (copy.action === 'define_variables') copy.variables = (copy.variables as Variable[]).map(item => ({ ...item, id: newId(), name: t("{0} 사본", [item.name]) }));
            const actions = [...draft.actions]; actions.splice(menu.index! + 1, 0, copy); set({ actions });
          } },
          { label: t("삭제"), icon: 'trash', onSelect: () => set({ actions: draft.actions.filter((_, i) => i !== menu.index) }) },
        ]} /> : null}
      {valuesFor ? <TriggerValues anchor={valuesFor.anchor} property={workspace.get<PropertyEntity>(valuesFor.propertyId)!}
        initial={valuesFor.index != null ? (draft.triggers[valuesFor.index] as Extract<Trigger, { type: 'property_edited' }>).values : undefined}
        onClose={() => setValuesFor(null)}
        onDone={values => {
          const trigger: Trigger = { type: 'property_edited', propertyId: valuesFor.propertyId, ...(values ? { values } : {}) };
          set({ triggers: valuesFor.index != null ? draft.triggers.map((item, i) => i === valuesFor.index ? trigger : item) : [...draft.triggers, trigger] });
          setValuesFor(null);
        }} /> : null}
      {conditionFor && draft.triggers[conditionFor.index]?.type === 'property_edited' ? (() => {
        const trigger = draft.triggers[conditionFor.index] as Extract<Trigger, { type: 'property_edited' }>;
        return <TriggerConditionPopover anchor={conditionFor.anchor} property={workspace.get<PropertyEntity>(trigger.propertyId)!} condition={trigger.condition}
          onChange={condition => set({ triggers: draft.triggers.map((item, i) => i === conditionFor.index ? { type: 'property_edited', propertyId: trigger.propertyId, ...(condition ? { condition } : {}) } : item) })}
          onClose={() => setConditionFor(null)} />;
      })() : null}
      {actionFor && draft.actions[actionFor.index] ? <ActionPopover anchor={actionFor.anchor} sourceId={sourceId} action={draft.actions[actionFor.index]} variables={variablesBefore(draft.actions, actionFor.index)} hasPage={!recurring}
        onChange={action => set({ actions: draft.actions.map((item, i) => i === actionFor.index ? action : item) })}
        onClose={() => setActionFor(null)} /> : null}
      {scheduleFor && recurring ? <SchedulePopover anchor={scheduleFor} schedule={recurring.schedule} onChange={schedule => set({ triggers: [{ type: 'recurring', schedule }] })} onClose={() => setScheduleFor(null)} /> : null}
    </Popover>
  );
}

function TriggerText({ trigger }: { trigger: Trigger }) {
  if (trigger.type !== 'property_edited') return <>{triggerSummary(trigger)}</>;
  const property = workspace.get<PropertyEntity>(trigger.propertyId);
  if (trigger.condition && property) return <>{tx("{0} 편집 · {1}", [<strong>{property.name}</strong>, conditionText(property, trigger.condition)])}</>;
  if (!trigger.values?.length || !property) return <>{tx("trigger|{0} 편집", [<strong>{property?.name ?? t("삭제된 속성")}</strong>])}</>;
  return <>{tx("{0}을(를) {1}(으)로 설정", [<strong>{property.name}</strong>, <ValueTags property={property} values={trigger.values} />], { 1: valueText(property, trigger.values[trigger.values.length - 1]) })}</>;
}
function ValueTags({ property, values }: { property: PropertyEntity; values: unknown[] }) {
  if (property.type === 'checkbox') return <span className="automation-value">{values.map(value => value ? t("체크됨") : t("체크 안 됨")).join(', ')}</span>;
  return <span className="automation-tags">{values.map(value => <OptionTag key={String(value)} property={property} id={String(value)} />)}</span>;
}
function ActionText({ action, variables }: { action: AutomationAction; variables: Variable[] }) {
  if (action.action !== 'set_property') return <>{actionSummary(action)}</>;
  const property = workspace.get<PropertyEntity>(String(action.propertyId));
  if (!property) return <>{t("속성 편집")}</>;
  if (isReference(action.value)) {
    const ref = action.value;
    const variable = ref.$variable != null ? variables.find(item => item.id === ref.$variable) : undefined;
    return <>{tx("{0}을(를)\u00a0\"{1}\"(으)로 설정", [<strong>{property.name}</strong>, <span className="automation-chip"><Icon name={variable ? variableIcon(variable) : 'sigma'} size={12} />{variable ? variable.name : ref.$formula != null ? t("사용자 지정 수식") : t("삭제된 변수")}</span>])}</>;
  }
  const shown = action.value === '$today' || action.value === '$now' || property.type === 'checkbox' || action.value == null
    ? <span className="automation-value">{valueText(property, action.value)}</span>
    : <span className="automation-tags"><ValueView property={property} value={action.value} mode="card" /></span>;
  const tail = valueText(property, action.value);
  return <>{tx("{0}을(를) {1}(으)로 설정", [<strong>{property.name}</strong>, shown], { 1: tail })}</>;
}

// "<속성>을(를) 다음으로 설정:" — which options set the trigger off (all checked = any option).
function TriggerValues({ anchor, property, initial, onDone, onClose }: { anchor: Anchor; property: PropertyEntity; initial?: unknown[]; onDone: (values: unknown[] | undefined) => void; onClose: () => void }) {
  const choices: Array<{ id: unknown; label: ReactNode; group?: string }> = property.type === 'checkbox'
    ? [{ id: true, label: t("체크됨") }, { id: false, label: t("체크 안 됨") }]
    : (property.options ?? []).map(option => ({ id: option.id, label: <OptionTag property={property} id={option.id} />, group: statusGroupLabel(option) }));
  const [chosen, setChosen] = useState<unknown[]>(initial?.length ? initial : choices.map(choice => choice.id));
  const all = chosen.length === choices.length;
  const toggle = (id: unknown) => setChosen(chosen.some(item => item === id) ? chosen.filter(item => item !== id) : [...chosen, id]);
  const groups = property.type === 'status' ? [...new Set(choices.map(choice => choice.group ?? ''))] : [''];
  return (
    <Popover anchor={anchor} placement="below-start" onClose={onClose} className="automation-values" style={{ width: 261 }} label={t("트리거 값")}>
      <div className="automation-values-head"><Icon name="arrow-left" size={14} /><span>{t("{0}을(를) 다음으로 설정:", [property.name])}</span><button type="button" className="automation-values-done" onClick={() => onDone(all || !chosen.length ? undefined : chosen)}>{t("완료")}</button></div>
      <label className="automation-values-row any"><input type="checkbox" checked={all} onChange={() => setChosen(all ? [] : choices.map(choice => choice.id))} /><span>{t("아무 옵션")}</span></label>
      <div className="automation-values-sep" />
      {groups.map(group => (
        <div key={group}>
          {group ? <div className="automation-values-group">{group}</div> : null}
          {choices.filter(choice => (choice.group ?? '') === group).map(choice => (
            <label key={String(choice.id)} className="automation-values-row"><input type="checkbox" checked={chosen.some(item => item === choice.id)} onChange={() => toggle(choice.id)} /><span>{choice.label}</span></label>
          ))}
        </div>
      ))}
    </Popover>
  );
}

// 트리거 조건 (a property-edited trigger narrowed by a condition): for text, number, date, person, relation and
// the other non-option properties — the same rules as a filter ("포함", "보다 큼", "이번 주" …), checked on the
// page's new value. No condition: any edit.
const conditionText = (property: PropertyEntity, condition: TriggerCondition) => {
  const value = condition.value;
  const shown = value == null || ['empty', 'not_empty'].includes(condition.op) ? '' : typeof value === 'object' && !Array.isArray(value) && 'period' in (value as object) ? '' : Array.isArray(value) ? value.map(String).join(', ') : typeof value === 'object' && 'start' in (value as object) ? String((value as { start: string }).start) : String(value);
  return `${opLabel(condition.op, property)}${shown ? ` ${shown}` : ''}`;
};
function TriggerConditionPopover({ anchor, property, condition, onChange, onClose }: { anchor: Element; property: PropertyEntity; condition?: TriggerCondition; onChange: (condition: TriggerCondition | undefined) => void; onClose: () => void }) {
  const [rule, setRule] = useState<TriggerCondition | null>(condition ?? null);
  const ops = operatorsFor(property);
  const update = (next: TriggerCondition | null) => { setRule(next); onChange(next ?? undefined); };
  return (
    <Popover anchor={anchor} placement="below-start" onClose={onClose} className="automation-values automation-condition" style={{ width: 300 }} label={t("트리거 조건")}>
      <div className="automation-values-head"><Icon name="arrow-left" size={14} /><span>{t("{0}이(가) 편집되었을 때", [property.name])}</span><button type="button" className="automation-values-done" onClick={onClose}>{t("완료")}</button></div>
      <label className="automation-values-row any"><input type="radio" checked={!rule} onChange={() => update(null)} /><span>{t("값과 상관없이")}</span></label>
      <label className="automation-values-row any"><input type="radio" checked={!!rule} onChange={() => { const fresh = newRule(property); update({ op: fresh.op, ...(fresh.value !== undefined ? { value: fresh.value } : {}) }); }} /><span>{t("조건에 맞을 때만")}</span></label>
      {rule ? (
        <div className="automation-condition-body">
          <select className="text-input" value={rule.op} aria-label={t("조건")} onChange={event => update({ op: event.target.value, ...(['empty', 'not_empty'].includes(event.target.value) ? {} : { value: rule.value }) })}>
            {ops.map(op => <option key={op} value={op}>{opLabel(op, property)}</option>)}
          </select>
          {!['empty', 'not_empty'].includes(rule.op) ? <FilterValueInput property={property} op={rule.op} value={rule.value} onChange={value => update({ op: rule.op, value })} /> : null}
        </div>
      ) : null}
    </Popover>
  );
}

// Properties whose value is words: written in a token field (@ mentions, Σ formulas).
const textLike = (property: PropertyEntity) => ['title', 'text', 'url', 'email', 'phone'].includes(property.type);

// Editing one action: its value (속성 편집) or its fields (other kinds).
function ActionPopover({ anchor, sourceId, action, variables, hasPage, onChange, onClose }: { anchor: Element; sourceId: string; action: AutomationAction; variables: Variable[]; hasPage: boolean; onChange: (action: AutomationAction) => void; onClose: () => void }) {
  const ws = useWorkspace();
  const [formula, setFormula] = useState<Element | null>(null);
  const sources = ws.sources();
  const actionSource = String(action.sourceId ?? sourceId);
  const property = ws.get<PropertyEntity>(String(action.propertyId ?? ''));
  const head = (title: string) => <div className="automation-values-head"><Icon name="arrow-left" size={14} /><span>{title}</span><button type="button" className="automation-values-done" onClick={onClose}>{t("완료")}</button></div>;
  let body: ReactNode;
  if (action.action === 'set_property' && property) {
    body = (
      <>
        {head(t("{0}을(를) 설정", [property.name]))}
        {/* Text values take @ mentions and Σ like a notice; other values are picked. */}
        <div className="automation-action-field">{textLike(property) && !isReference(action.value)
          ? <TokenField value={typeof action.value === 'string' ? action.value : ''} sourceId={sourceId} hasPage={hasPage} variables={variables} onChange={value => onChange({ ...action, value })} />
          : <EditableValue pageId="" property={property} value={isReference(action.value) ? null : action.value ?? null} onChange={value => onChange({ ...action, value })} placeholder={t("값 선택")} />}</div>
        {property.type === 'date' ? <div className="button-tokens"><button type="button" className="text-button small" onClick={() => onChange({ ...action, value: '$today' })}>{t("오늘")}</button><button type="button" className="text-button small" onClick={() => onChange({ ...action, value: '$now' })}>{t("지금")}</button></div> : null}
        {variables.map(variable => (
          <button type="button" key={variable.id} className={`automation-action-option${isReference(action.value) && action.value.$variable === variable.id ? ' active' : ''}`} onClick={() => { onChange({ ...action, value: { $variable: variable.id } }); onClose(); }}><Icon name={variableIcon(variable)} size={16} /><span>{variable.name}</span></button>
        ))}
        <button type="button" className={`automation-action-option${isReference(action.value) && action.value.$formula != null ? ' active' : ''}`} onClick={event => setFormula(event.currentTarget)}><Icon name="sigma" size={16} /><span>{t("사용자 지정 수식")}</span><Icon name="chevron-right" size={14} className="automation-action-chevron" /></button>
        {formula ? <FormulaPopover anchor={formula} value={isReference(action.value) ? action.value.$formula ?? '' : ''} sourceId={sourceId} hasPage={hasPage} names={variables.map(item => item.name)}
          onDone={text => { setFormula(null); if (text.trim()) onChange({ ...action, value: { $formula: text } }); }} /> : null}
      </>
    );
  } else if (action.action === 'add_page') {
    // The new page's title (with @ mentions of the trigger page's properties and variables) and its properties —
    // each a fixed value, a variable or a formula.
    const values = (action.values ?? {}) as Record<string, unknown>;
    const targetProperties = writableProperties(actionSource).filter(item => item.type !== 'title');
    const unset = targetProperties.filter(item => !(item.id in values));
    body = (
      <>
        {head(t("페이지 추가"))}
        <label className="field"><span>{t("데이터베이스")}</span><select className="text-input" value={actionSource} onChange={event => onChange({ ...action, sourceId: event.target.value, values: {} })}>{sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="field"><span>{t("새 페이지 제목")}</span><TokenField value={String(action.title ?? '')} sourceId={sourceId} hasPage={hasPage} variables={variables} onChange={title => onChange({ ...action, title })} /></div>
        {Object.keys(values).length ? <div className="field"><span>{t("속성")}</span>
          {Object.entries(values).map(([id, value]) => {
            const item = ws.get<PropertyEntity>(id);
            if (!item) return null;
            return (
              <div key={id} className="automation-page-value">
                <span className="automation-page-value-name"><Icon name={`type-${item.type}`} size={14} />{item.name}</span>
                {isReference(value) ? null : textLike(item)
                  ? <TokenField value={typeof value === 'string' ? value : ''} sourceId={sourceId} hasPage={hasPage} variables={variables} onChange={next => onChange({ ...action, values: { ...values, [id]: next } })} />
                  : <EditableValue pageId="" property={item} value={value ?? null} onChange={next => onChange({ ...action, values: { ...values, [id]: next } })} placeholder={t("값 선택")} />}
                {/* A fixed value, a variable or a formula. */}
                <ValueSource value={value} variables={variables} sourceId={sourceId} hasPage={hasPage} onChange={next => onChange({ ...action, values: { ...values, [id]: next } })} />
                <button type="button" className="icon-button tiny" aria-label={t("삭제")} onClick={() => { const next = { ...values }; delete next[id]; onChange({ ...action, values: next }); }}><Icon name="close" size={12} /></button>
              </div>
            );
          })}
        </div> : null}
        {unset.length ? <select className="text-input automation-page-value-add" value="" aria-label={t("속성 값 추가")} onChange={event => { if (event.target.value) onChange({ ...action, values: { ...values, [event.target.value]: null } }); }}>
          <option value="">{t("+ 속성 값 추가")}</option>{unset.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select> : null}
      </>
    );
  } else if (action.action === 'edit_pages') {
    const editable = writableProperties(actionSource);
    const target = editable.find(item => item.id === action.propertyId);
    body = (
      <>
        {head(t("페이지 편집"))}
        <label className="field"><span>{t("데이터베이스")}</span><select className="text-input" value={actionSource} onChange={event => onChange({ ...action, sourceId: event.target.value, propertyId: '', value: null, filter: { all: [] } })}>{sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {/* Which pages: every page matching the condition, or the pages a variable or formula gives (a relation, say). */}
        <div className="field"><span>{t("대상 페이지")}</span><ValueSource label={t("대상 페이지")} emptyLabel={t("조건에 맞는 모든 페이지")} value={action.pages ?? null} variables={variables} sourceId={sourceId} hasPage={hasPage} onChange={pages => { const next = { ...action }; if (pages) next.pages = pages; else delete next.pages; onChange(next); }} /></div>
        <div className="field"><span>{t("조건")}</span><FilterEditor sourceId={actionSource} value={(action.filter as Filter | undefined) ?? null} onChange={filter => onChange({ ...action, filter: filter ?? { all: [] } })} /></div>
        <label className="field"><span>{t("속성")}</span><select className="text-input" value={String(action.propertyId ?? '')} onChange={event => onChange({ ...action, propertyId: event.target.value, value: null })}><option value="">{t("속성 선택")}</option>{editable.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {target ? <div className="field"><span>{t("값")}</span>
          {isReference(action.value) ? null : textLike(target) ? <TokenField value={typeof action.value === 'string' ? action.value : ''} sourceId={sourceId} hasPage={hasPage} variables={variables} onChange={value => onChange({ ...action, value })} /> : <EditableValue pageId="" property={target} value={action.value ?? null} onChange={value => onChange({ ...action, value })} placeholder={t("값 선택")} />}
          <ValueSource value={action.value} variables={variables} sourceId={sourceId} hasPage={hasPage} onChange={value => onChange({ ...action, value })} />
        </div> : null}
      </>
    );
  } else if (action.action === 'notify') {
    body = <>{head(t("알림 보내기"))}<div className="field"><span>{t("알림 내용")}</span><TokenField value={String(action.message ?? '')} sourceId={sourceId} hasPage={hasPage} variables={variables} onChange={message => onChange({ ...action, message })} /></div></>;
  } else {
    body = <>{head(t("Webhook 보내기"))}<WebhookEditor action={action} onChange={onChange} tokens={{ sourceId, hasPage, variables }} /></>;
  }
  return <Popover anchor={anchor} placement="below-start" onClose={onClose} className="automation-action" style={{ width: action.action === 'set_property' ? 261 : 360 }} label={t("작업 편집")}>{body}</Popover>;
}

const hourLabel = (hour: number) => t("{0}경", [formatHour(hour)]);
function offsetLabel(timeZone: string) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value ?? timeZone; } catch { return timeZone; }
}
function scheduleSummary(schedule: Schedule) { return `${hourLabel(Number(schedule.start.slice(11, 13)))}`; }
// The schedule's settings: every N units, the hour, start, end, time zone and the next run.
function SchedulePopover({ anchor, schedule, onChange, onClose }: { anchor: Element; schedule: Schedule; onChange: (schedule: Schedule) => void; onClose: () => void }) {
  const hour = Number(schedule.start.slice(11, 13));
  const zones = useMemo(() => { try { return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [schedule.timeZone]; } catch { return [schedule.timeZone]; } }, []);
  return (
    <Popover anchor={anchor} placement="below-start" onClose={onClose} className="automation-schedule" style={{ width: 290 }} label={t("반복 일정")}>
      <div className="automation-schedule-row"><span>{t("모든")}</span><span className="spacer" />
        <input className="text-input automation-interval" type="number" min={1} max={365} value={schedule.interval} disabled={schedule.frequency === 'weekday'} onChange={event => onChange({ ...schedule, interval: Math.max(1, Math.min(365, Number(event.target.value) || 1)) })} aria-label={t("간격")} />
        <select className="text-input automation-unit" value={schedule.frequency} onChange={event => onChange({ ...schedule, frequency: event.target.value as Schedule['frequency'], interval: event.target.value === 'weekday' ? 1 : schedule.interval })} aria-label={t("단위")}>
          {(Object.keys(unitLabels) as Schedule['frequency'][]).map(unit => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}
        </select>
      </div>
      <label className="automation-schedule-row"><span>{t("시간")}</span><span className="spacer" />
        <select className="text-input" value={hour} onChange={event => onChange({ ...schedule, start: `${schedule.start.slice(0, 11)}${String(event.target.value).padStart(2, '0')}:00` })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
      </label>
      <div className="automation-values-sep" />
      <label className="automation-schedule-row"><span>{t("시작")}</span><span className="spacer" /><input className="text-input" type="date" value={schedule.start.slice(0, 10)} onChange={event => { if (event.target.value) onChange({ ...schedule, start: `${event.target.value}${schedule.start.slice(10)}` }); }} /></label>
      <label className="automation-schedule-row"><span>{t("종료")}</span><span className="spacer" /><input className="text-input" type="date" value={schedule.end ?? ''} onChange={event => onChange({ ...schedule, end: event.target.value || null })} aria-label={t("종료일 (비우면 종료일 미정)")} /></label>
      <label className="automation-schedule-row"><span>{t("시간대")}</span><span className="spacer" /><select className="text-input" value={schedule.timeZone} onChange={event => onChange({ ...schedule, timeZone: event.target.value })}>{zones.map(zone => <option key={zone} value={zone}>{zone === schedule.timeZone ? offsetLabel(zone) : zone}</option>)}</select></label>
      <div className="automation-values-sep" />
      <div className="automation-next">{tx("다음 예정:{0}{1} {2}{3}", [<br />, schedule.start.slice(0, 10), hourLabel(hour), schedule.end ? t(" · {0}까지", [schedule.end]) : ''])}</div>
    </Popover>
  );
}

// ---------- the list (view settings › 자동화) ----------

const hintKey = 'pageyard-automation-hint-dismissed';
export function AutomationsPanel({ sourceId }: { sourceId: string }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ anchor: Element; id: string } | null>(null);
  const [hint, setHint] = useState(() => { try { return localStorage.getItem(hintKey) !== '1'; } catch { return true; } });
  const items = automationsOf(sourceId).filter(item => !query.trim() || `${item.name} ${item.triggers.map(triggerSummary).join(' ')} ${item.actions.map(actionSummary).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  void ws.version;
  return (
    <div className="automations-panel">
      <input className="automations-search" value={query} placeholder={t("자동화 검색…")} aria-label={t("자동화 검색")} autoFocus onChange={event => setQuery(event.target.value)} />
      {hint ? (
        <div className="automations-hint" role="button" tabIndex={0} onClick={() => openAutomationEditor(sourceId, undefined, { triggers: [{ type: 'recurring', schedule: defaultSchedule({ frequency: 'day', interval: 1 }) }] })}>
          <div className="automations-hint-title">{t("반복 트리거 사용해 보기")}{" "}<Icon name="arrow-up-right" size={14} /></div>
          <div className="automations-hint-text">{t("일정에 따라 항목을 자동으로 만들거나 편집합니다")}</div>
          <button type="button" className="automations-hint-close" aria-label={t("닫기")} onClick={event => { event.stopPropagation(); setHint(false); try { localStorage.setItem(hintKey, '1'); } catch { /* per-browser hint only */ } }}><Icon name="close" size={10} /></button>
        </div>
      ) : null}
      {items.map(item => (
        <div key={item.id} className={`automation-item${item.enabled ? '' : ' off'}`} role="button" tabIndex={0} title={t("{0}\n트리거: {1} 시 작업: {2}", [item.name, item.triggers.map(triggerSummary).join(', '), item.actions.map(actionSummary).join(', ')])}
          onClick={() => openAutomationEditor(sourceId, item.id)} onKeyDown={event => { if (event.key === 'Enter') openAutomationEditor(sourceId, item.id); }}>
          <div className="automation-item-icons"><span className="automation-item-icon trigger"><Icon name={triggerIcon(item.triggers[0])} size={14} /></span><Icon name="arrow-right" size={14} /><span className="automation-item-icon action"><Icon name={actionIcon(item.actions[0])} size={14} /></span></div>
          <div className="automation-item-name">{item.name || defaultAutomationName}</div>
          <div className="automation-item-text">{t("트리거: {0} 시 작업: {1}", [item.triggers.map(triggerSummary).join(', '), item.actions.map(actionSummary).join(', ')])}</div>
          <button type="button" className="automation-item-more" aria-label={t("자동화 옵션")} onClick={event => { event.stopPropagation(); setMenu({ anchor: event.currentTarget, id: item.id }); }}><Icon name="more" size={14} /></button>
        </div>
      ))}
      <button type="button" className="automations-new" onClick={() => openAutomationEditor(sourceId)}><Icon name="plus" size={14} /><span>{t("새 자동화")}</span></button>
      {menu ? (() => {
        const item = ws.get<StoredAutomation>(menu.id) as unknown as AutomationEntity | undefined;
        if (!item) return null;
        return <Menu anchor={menu.anchor} placement="below-start" width={180} onClose={() => setMenu(null)} entries={[
          { kind: 'custom', render: () => <label className="menu-item automation-active-row"><Icon name="lightning" size={16} /><span className="menu-item-label">{t("활성")}</span><Switch checked={item.enabled} onChange={value => apply([{ type: 'automation.update', id: item.id, enabled: value }]).catch(report)} label={t("활성")} /></label> },
          { label: t("삭제"), icon: 'trash', onSelect: async () => { if (await confirmSmall(t("{0}을(를) 삭제할까요?", [item.name || defaultAutomationName]), t("삭제"))) apply([{ type: 'automation.delete', id: item.id }]).catch(report); } },
        ]} />;
      })() : null}
    </div>
  );
}
