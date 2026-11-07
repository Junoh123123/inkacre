import { t, tx } from '../i18n';
import { FormulaEditor } from '../database/FormulaEditor';
import { useMemo, useState } from 'react';
import { api } from '../data/api';
import { apply, newId } from '../data/commands';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import { aggregateLabels, colorNames, formatValue, propertyLabels, statusGroupKey, statusGroupKeys, statusGroupName, tagColors, titleNameField, type StatusGroupKey } from '../data/format';
import type { ButtonDefinition, NumberFormat, Operation, PageEntity, PropertyEntity, PropertyType, SelectOption, SourceEntity } from '../data/types';
import { Dialog, Switch, Tag, confirmDialog } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { ButtonEditor, emptyButton } from './buttons';

type Close = { onClose: () => void };

const typeOrder: PropertyType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'files', 'checkbox', 'url', 'email', 'phone', 'formula', 'relation', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'button', 'unique_id', 'place'];
const rollupAggregations = ['count', 'count_nonempty', 'count_empty', 'percent_empty', 'percent_not_empty', 'sum', 'average', 'median', 'min', 'max', 'range', 'values', 'unique', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked', 'earliest_date', 'latest_date', 'date_range'];

export const defaultStatusOptions = (): SelectOption[] => [
  { id: newId(), name: t("시작 전"), group: 'todo', color: 'gray' },
  { id: newId(), name: t("진행 중"), group: 'in_progress', color: 'blue' },
  { id: newId(), name: t("완료"), group: 'complete', color: 'green' },
];

function OptionsEditor({ type, options, onChange }: { type: PropertyType; options: SelectOption[]; onChange: (options: SelectOption[]) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const set = (index: number, patch: Partial<SelectOption>) => onChange(options.map((option, i) => i === index ? { ...option, ...patch } : option));
  const groups: Array<StatusGroupKey | null> = type === 'status' ? statusGroupKeys : [null];
  return (
    <div className="options-editor">
      {groups.map(group => (
        <div key={group ?? 'all'} className="options-group">
          {group ? <div className="options-group-head">{statusGroupName(group)}<button type="button" className="icon-button tiny" aria-label={t("{0} 옵션 추가", [statusGroupName(group)])} onClick={() => onChange([...options, { id: newId(), name: '', group, color: group === 'complete' ? 'green' : group === 'in_progress' ? 'blue' : 'gray' }])}><Icon name="plus" size={14} /></button></div> : null}
          {options.map((option, index) => (group && (statusGroupKey(option.group) ?? 'todo') !== group) ? null : (
            <div key={option.id} className={`option-edit-row${drag === index ? ' dragging' : ''}`} draggable
              onDragStart={() => setDrag(index)} onDragOver={event => event.preventDefault()}
              onDrop={event => { event.preventDefault(); if (drag === null || drag === index) return; const list = [...options]; const [moved] = list.splice(drag, 1); list.splice(index, 0, moved); onChange(list); setDrag(null); }}
              onDragEnd={() => setDrag(null)}>
              <span className="option-handle"><Icon name="drag" size={16} /></span>
              <input className="text-input" value={option.name} placeholder={t("옵션 이름")} aria-label={t("옵션 이름")} onChange={event => set(index, { name: event.target.value })} />
              <select className="text-input color-select" value={option.color && tagColors.includes(option.color) ? option.color : 'default'} aria-label={t("옵션 색")} onChange={event => set(index, { color: event.target.value === 'default' ? undefined : event.target.value })}>
                {tagColors.map(color => <option key={color} value={color}>{colorNames[color]}</option>)}
              </select>
              <Tag color={option.color ?? (type === 'status' ? (group === 'complete' ? 'green' : group === 'in_progress' ? 'blue' : 'gray') : 'default')} status={type === 'status'}>{option.name || t("이름 없음")}</Tag>
              <button type="button" className="icon-button small" aria-label={t("옵션 삭제")} onClick={() => onChange(options.filter((_, i) => i !== index))}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      ))}
      {type !== 'status' ? <button type="button" className="text-button small" onClick={() => onChange([...options, { id: newId(), name: '', color: tagColors[1 + (options.length % 9)] }])}><Icon name="plus" size={14} />{t("옵션 추가")}</button> : null}
    </div>
  );
}

function NumberFormatEditor({ value, onChange }: { value: NumberFormat; onChange: (value: NumberFormat) => void }) {
  return (
    <div className="number-format">
      <label className="field"><span>{t("숫자 형식")}</span>
        <select className="text-input" value={value.style} onChange={event => onChange({ ...value, style: event.target.value as NumberFormat['style'] })}>
          <option value="number">{t("숫자")}</option><option value="percent">{t("백분율")}</option><option value="currency">{t("통화")}</option>
        </select>
      </label>
      {value.style === 'currency' ? (
        <label className="field"><span>{t("통화")}</span>
          <select className="text-input" value={value.currency ?? 'KRW'} onChange={event => onChange({ ...value, currency: event.target.value })}>
            {['KRW', 'USD', 'JPY', 'EUR', 'CNY', 'GBP'].map(code => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
      ) : null}
      <label className="field"><span>{t("소수 자릿수")}</span><input className="text-input" type="number" min={0} max={20} value={value.digits ?? ''} placeholder={t("자동")} onChange={event => onChange({ ...value, digits: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
      <label className="field inline"><span>{t("천 단위 구분")}</span><Switch checked={value.grouping ?? true} onChange={grouping => onChange({ ...value, grouping })} /></label>
      <label className="field"><span>{t("표시 방식")}</span>
        <select className="text-input" value={value.display ?? 'number'} onChange={event => onChange({ ...value, display: event.target.value as NumberFormat['display'] })}>
          <option value="number">{t("숫자")}</option><option value="bar">{t("막대")}</option><option value="ring">{t("링")}</option>
        </select>
      </label>
      {value.display === 'bar' || value.display === 'ring' ? (
        <>
          <label className="field"><span>{t("색")}</span>
            <select className="text-input" value={value.color ?? 'green'} onChange={event => onChange({ ...value, color: event.target.value })}>
              {tagColors.map(color => <option key={color} value={color}>{colorNames[color]}</option>)}
            </select>
          </label>
          <label className="field"><span>{t("나누기")}</span><input className="text-input" type="number" min={0} step="any" value={value.divideBy ?? ''} placeholder={value.style === 'percent' ? '1' : '100'} onChange={event => onChange({ ...value, divideBy: event.target.value === '' || Number(event.target.value) <= 0 ? undefined : Number(event.target.value) })} /></label>
          <label className="field inline"><span>{t("숫자 표시")}</span><Switch checked={value.showNumber ?? true} onChange={showNumber => onChange({ ...value, showNumber })} /></label>
        </>
      ) : null}
    </div>
  );
}

interface ConversionPreview {
  allowed: boolean; revision: number; operation: Operation;
  error?: { message: string; details?: { rows?: Array<{ title: string; message: string }>; properties?: Array<{ name: string }> } };
  property: { before: PropertyEntity; after: PropertyEntity };
  notes: string[]; changes: Array<{ id: string; title: string; visible: boolean; before: unknown; after: unknown }>;
  effects: Array<{ title: string; name: string; before: unknown; after: unknown }>;
  viewChanges: Array<{ name: string }>;
}

export function PropertyDialog({ sourceId, propertyId, initialType, onClose, onCreated }: Close & { sourceId: string; propertyId?: string; initialType?: PropertyType; onCreated?: (id: string) => void }) {
  const ws = useWorkspace();
  const existing = propertyId ? ws.get<PropertyEntity>(propertyId) : undefined;
  const [name, setName] = useState(existing?.name ?? (initialType ? propertyLabels[initialType] : ''));
  const [type, setType] = useState<PropertyType>(initialType ?? existing?.type ?? 'text');
  const [options, setOptions] = useState<SelectOption[]>(() => existing?.options ? structuredClone(existing.options) : (initialType ?? existing?.type) === 'status' ? defaultStatusOptions() : []);
  const [formula, setFormula] = useState(existing?.formula ?? '');
  const [target, setTarget] = useState(existing?.targetSourceId ?? sourceId);
  const [twoWay, setTwoWay] = useState(false);
  const [inverseName, setInverseName] = useState('');
  const [limit, setLimit] = useState<1 | null>(existing?.relationLimit ?? null);
  const [display, setDisplay] = useState<string[]>(existing?.displayProperties ?? []);
  const [rollup, setRollup] = useState(existing?.rollup ?? { relationPropertyId: '', targetPropertyId: '', aggregation: 'count' });
  const [numberFormat, setNumberFormat] = useState<NumberFormat>(existing?.numberFormat ?? { style: 'number', grouping: true });
  const [button, setButton] = useState<ButtonDefinition>(existing?.button ?? emptyButton());
  const [idPrefix, setIdPrefix] = useState(existing?.idPrefix ?? '');
  const [dateFormat, setDateFormat] = useState<string>(existing?.dateFormat ?? '');
  const [timeFormat, setTimeFormat] = useState<string>(existing?.timeFormat ?? '');
  const [preview, setPreview] = useState<ConversionPreview | null>(null);
  const schema = ws.schema(sourceId);
  const relations = schema.filter(property => property.type === 'relation');
  const rollupTargetSchema = ws.schema(ws.get<PropertyEntity>(rollup.relationPropertyId)?.targetSourceId ?? '');
  const source = ws.get<SourceEntity>(sourceId);
  const converting = !!existing && existing.type !== type;
  const isTitle = existing?.type === 'title';

  const buildOperation = (): Operation => {
    const base: Operation = existing
      ? { type: converting ? 'property.convert' : 'property.update', id: existing.id, name: name.trim() || existing.name, ...(converting ? { propertyType: type, fromType: existing.type } : {}) }
      : { type: 'property.create', id: newId(), sourceId, name: name.trim() || propertyLabels[type], propertyType: type };
    if (['select', 'multi_select', 'status'].includes(type) && (!converting || options.length)) base.options = options.filter(option => option.name.trim()).map(option => ({ ...option, name: option.name.trim(), ...(type === 'status' ? { group: option.group ?? t("할 일") } : {}) }));
    if (type === 'formula' && (!existing || formula !== existing.formula || converting)) base.formula = formula;
    if (type === 'relation') {
      if (!existing || converting) { base.targetSourceId = target; if (twoWay) base.inverse = { name: inverseName.trim() || t("{0} 관계", [source?.name ?? '']).trim() }; }
      base.relationLimit = limit; base.displayProperties = display;
    }
    if (type === 'unique_id' && !converting && (!existing || idPrefix.trim() !== (existing.idPrefix ?? ''))) {
      const prefix = idPrefix.trim();
      if (prefix && !/^[\p{L}\p{N}]{1,12}$/u.test(prefix)) throw new Error(t("접두사는 글자와 숫자로 12자까지 쓸 수 있습니다."));
      if (prefix || existing?.idPrefix) base.idPrefix = prefix || null;
    }
    if (type === 'rollup') {
      if (!rollup.relationPropertyId || !rollup.targetPropertyId) throw new Error(t("롤업할 관계와 속성을 고르세요."));
      base.rollup = rollup;
    }
    if (type === 'button') base.button = button;
    if (['number', 'formula', 'rollup'].includes(type)) base.numberFormat = numberFormat;
    // 날짜 형식 · 시간 형식 (date, created and edited time); empty: the language's own.
    if (['date', 'created_time', 'last_edited_time'].includes(type) && !converting && (!existing || dateFormat !== (existing.dateFormat ?? '') || timeFormat !== (existing.timeFormat ?? ''))) {
      if (dateFormat || existing?.dateFormat) base.dateFormat = dateFormat || null;
      if (timeFormat || existing?.timeFormat) base.timeFormat = timeFormat || null;
    }
    return base;
  };

  if (preview) {
    const property = preview.property;
    return (
      <Dialog title={t("속성 유형 변환")} onClose={onClose} width={560} submitLabel={t("변환")} onSubmit={async () => { await apply([preview.operation], { revision: preview.revision, freshCommand: true }); }}
        footer={<button type="button" className="text-button" onClick={() => setPreview(null)}>{t("뒤로")}</button>}>
        <p>{t("{0}{1}: {2} → {3} · {4}개 항목", [property.before.name, property.before.name === property.after.name ? '' : ` → ${property.after.name}`, propertyLabels[property.before.type], propertyLabels[property.after.type], preview.changes.length])}</p>
        {preview.notes.map((note, index) => <p key={index} className="muted">{note}</p>)}
        <div className="conversion-list">
          {preview.changes.slice(0, 100).map(row => <div key={row.id} className="conversion-row"><span>{row.title || t("새 페이지")}{row.visible ? '' : t(" (휴지통)")}</span><span>{formatValue(row.before, property.before) || t("비어 있음")} → {formatValue(row.after, property.after) || t("비어 있음")}</span></div>)}
        </div>
        {preview.effects.length ? <><h3 className="dialog-subtitle">{t("계산 결과의 변화")}</h3>{preview.effects.map((effect, index) => <p key={index} className="muted">{effect.title} · {effect.name}: {formatValue(effect.before)} → {formatValue(effect.after)}</p>)}</> : null}
        {preview.viewChanges.length ? <><h3 className="dialog-subtitle">{t("함께 바뀌는 보기 설정")}</h3>{preview.viewChanges.map((view, index) => <p key={index} className="muted">{t("{0}: 필터·날짜·장소 연결 갱신", [view.name])}</p>)}</> : null}
      </Dialog>
    );
  }

  return (
    <Dialog title={existing ? t("속성 편집") : t("새 속성")} onClose={onClose} width={type === 'formula' ? 760 : 520} submitLabel={existing ? (converting ? t("변환 미리보기") : t("저장")) : t("속성 만들기")}
      footer={existing && !isTitle ? (
        <span className="dialog-footer-left">
          <button type="button" className="text-button" onClick={async () => {
            const copy: Record<string, unknown> = { ...buildOperation(), type: 'property.create', id: newId(), sourceId, name: t("{0} (사본)", [name]), propertyType: existing.type };
            delete (copy as Record<string, unknown>).fromType;
            if (existing.type === 'relation') { delete (copy as Record<string, unknown>).inverse; copy.targetSourceId = existing.targetSourceId; }
            await apply([copy as Operation]).catch(report); onClose();
          }}><Icon name="duplicate" size={14} />{t("속성 복제")}</button>
          <button type="button" className="text-button danger" onClick={async () => {
            if (!(await confirmDialog(t("속성 삭제"), t("\"{0}\" 속성을 삭제할까요? 휴지통에서 복원할 수 있습니다.{1}", [existing.name, existing.inversePropertyId ? t(" 연결된 반대쪽 관계 속성도 함께 삭제됩니다.") : '']), { confirmLabel: t("삭제"), danger: true }))) return;
            await apply([{ type: 'node.trash', id: existing.id }]).catch(report); onClose();
          }}><Icon name="trash" size={14} />{t("속성 삭제")}</button>
        </span>
      ) : null}
      onSubmit={async () => {
        const operation = buildOperation();
        if (converting) {
          const result = await api<ConversionPreview>('/api/property-conversion/preview', operation);
          if (!result.allowed) throw new Error([result.error?.message, ...(result.error?.details?.rows ?? []).map(row => `${row.title}: ${row.message}`), ...(result.error?.details?.properties ?? []).map(property => property.name)].filter(Boolean).join('\n'));
          setPreview(result);
          return false;
        }
        await apply([operation]);
        if (!existing) onCreated?.(operation.id as string);
        return undefined;
      }}>
      <div className="property-head">
        <span className="property-type-box"><Icon name={`type-${type}`} size={18} /></span>
        <input className="text-input" autoFocus value={name} placeholder={t("속성 이름")} onChange={event => setName(event.target.value)} />
      </div>
      <label className="field"><span>{t("유형")}</span>
        <select className="text-input" value={type} disabled={isTitle} onChange={event => { const next = event.target.value as PropertyType; setType(next); if (next === 'status' && !options.length) setOptions(defaultStatusOptions()); }}>
          {isTitle ? <option value="title">{t("제목")}</option> : null}
          {typeOrder.map(id => <option key={id} value={id}>{propertyLabels[id]}</option>)}
        </select>
      </label>
      {['select', 'multi_select', 'status'].includes(type) ? <OptionsEditor type={type} options={options} onChange={setOptions} /> : null}
      {converting && ['select', 'multi_select', 'status'].includes(type) && !options.length ? <p className="muted">{t("옵션을 비워 두면 기존 값으로 옵션을 만듭니다.")}</p> : null}
      {type === 'formula' ? (
        <div className="field"><span>{t("수식")}</span>
          <FormulaEditor sourceId={sourceId} propertyId={existing?.id} value={formula} onChange={setFormula} />
          <span className="muted small">{t("속성은 prop(\"이름\")으로 참조합니다. 예: if(prop(\"완료\"), \"✓\", \"\")")}</span>
        </div>
      ) : null}
      {type === 'relation' ? (
        <>
          <label className="field"><span>{t("관계 대상 데이터베이스")}</span>
            <select className="text-input" value={target} disabled={!!existing && !converting} onChange={event => setTarget(event.target.value)}>
              {(ws.sources() as SourceEntity[]).map(item => <option key={item.id} value={item.id}>{item.name}{item.id === sourceId ? t(" (이 데이터베이스)") : ''}</option>)}
            </select>
          </label>
          {!existing || converting ? (
            <>
              <label className="field inline"><span>{tx("{0}에 표시 (양방향)", [ws.get<SourceEntity>(target)?.name ?? t("대상")])}</span><Switch checked={twoWay} onChange={setTwoWay} /></label>
              {twoWay ? <label className="field"><span>{t("반대쪽 속성 이름")}</span><input className="text-input" value={inverseName} placeholder={t("{0} 관계", [source?.name ?? ''])} onChange={event => setInverseName(event.target.value)} /></label> : null}
            </>
          ) : existing?.inversePropertyId ? <p className="muted">{tx("양방향 관계: {0}", [ws.get<PropertyEntity>(existing.inversePropertyId)?.name])}</p> : null}
          <label className="field"><span>{t("연결 개수 제한")}</span>
            <select className="text-input" value={limit === 1 ? 'one' : 'many'} onChange={event => setLimit(event.target.value === 'one' ? 1 : null)}><option value="many">{t("제한 없음")}</option><option value="one">{t("1개 페이지")}</option></select>
          </label>
          <div className="field"><span>{t("대상에서 함께 표시할 속성")}</span>
            <div className="check-list">{ws.schema(existing?.targetSourceId ?? target).filter(property => property.type !== 'title').map(property => (
              <label key={property.id} className="filter-check"><input type="checkbox" checked={display.includes(property.id)} onChange={event => setDisplay(event.target.checked ? [...display, property.id] : display.filter(id => id !== property.id))} />{property.name}</label>
            ))}</div>
          </div>
        </>
      ) : null}
      {type === 'unique_id' ? (
        <label className="field"><span>{t("접두사")}</span><input className="text-input" value={idPrefix} placeholder={t("예: TASK")} maxLength={12} onChange={event => setIdPrefix(event.target.value)} /><span className="field-hint">{idPrefix.trim() ? t("{0}-1, {0}-2 …로 표시되고, 주소에 {0}-번호를 넣어 바로 열 수 있습니다.", [idPrefix.trim()]) : t("번호 앞에 붙일 글자")}</span></label>
      ) : null}
      {type === 'rollup' ? (
        <>
          <label className="field"><span>{t("관계")}</span>
            <select className="text-input" value={rollup.relationPropertyId} onChange={event => setRollup({ ...rollup, relationPropertyId: event.target.value, targetPropertyId: '' })}>
              <option value="">{t("관계 선택")}</option>
              {relations.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
            </select>
          </label>
          <label className="field"><span>{t("속성")}</span>
            <select className="text-input" value={rollup.targetPropertyId} onChange={event => setRollup({ ...rollup, targetPropertyId: event.target.value })}>
              <option value="">{t("속성 선택")}</option>
              {rollupTargetSchema.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
            </select>
          </label>
          <label className="field"><span>{t("계산")}</span>
            <select className="text-input" value={rollup.aggregation} onChange={event => setRollup({ ...rollup, aggregation: event.target.value })}>
              {rollupAggregations.map(id => <option key={id} value={id}>{aggregateLabels[id] ?? id}</option>)}
            </select>
          </label>
          {!relations.length ? <p className="muted">{t("먼저 관계형 속성을 만드세요.")}</p> : null}
        </>
      ) : null}
      {['number', 'formula', 'rollup'].includes(type) ? <NumberFormatEditor value={numberFormat} onChange={setNumberFormat} /> : null}
      {['date', 'created_time', 'last_edited_time'].includes(type) && !converting ? (
        <div className="field-row">
          <label className="field"><span>{t("날짜 형식")}</span>
            <select className="text-input" value={dateFormat} onChange={event => setDateFormat(event.target.value)}>
              <option value="">{t("전체 날짜")}</option><option value="short">{t("짧은 날짜")}</option><option value="mdy">{t("월/일/연도")}</option><option value="dmy">{t("일/월/연도")}</option><option value="ymd">{t("연도/월/일")}</option><option value="relative">{t("상대 날짜 (오늘 · 내일)")}</option>
            </select></label>
          <label className="field"><span>{t("시간 형식")}</span>
            <select className="text-input" value={timeFormat} onChange={event => setTimeFormat(event.target.value)}>
              <option value="">{t("언어에 따라")}</option><option value="12">{t("12시간")}</option><option value="24">{t("24시간")}</option><option value="hidden">{t("숨기기")}</option>
            </select></label>
        </div>
      ) : null}
      {type === 'button' ? <ButtonEditor value={button} sourceId={sourceId} onChange={setButton} /> : null}
      {type === 'place' ? <p className="muted">{t("위치 값은 장소 이름과 좌표로 저장합니다. 지도 보기에 표시됩니다.")}</p> : null}
    </Dialog>
  );
}

export function TemplatesDialog({ sourceId, onClose }: Close & { sourceId: string }) {
  const ws = useWorkspace();
  const source = ws.get<SourceEntity>(sourceId);
  const templates = ws.snapshot.objects.filter(item => item.kind === 'page' && (item as PageEntity).template && (item as PageEntity).sourceId === sourceId && ws.visible(item.id)) as PageEntity[];
  const [defaultId, setDefaultId] = useState(source?.defaultTemplateId ?? '');
  const revision = workspace.revision;
  return (
    <Dialog title={t("템플릿")} onClose={onClose} width={480} submitLabel={t("저장")} onSubmit={() => apply([{ type: 'source.configure_templates', id: sourceId, defaultTemplateId: defaultId || null }], { revision })}>
      <label className="field"><span>{t("새 항목의 기본 템플릿")}</span>
        <select className="text-input" value={defaultId} onChange={event => setDefaultId(event.target.value)}>
          <option value="">{t("빈 페이지")}</option>
          {templates.map(template => <option key={template.id} value={template.id}>{template.title || t("새 템플릿")}</option>)}
        </select>
      </label>
      <div className="history-list">
        {templates.map(template => (
          <div key={template.id} className="history-item">
            <div className="history-main"><div className="history-title">{template.title || t("새 템플릿")}</div><div className="history-meta">{template.recurrence?.enabled ? t("반복: {0} {1}마다", [template.recurrence.interval, ({ day: t("일"), week: t("주"), month: t("개월"), year: t("년") } as Record<string, string>)[template.recurrence.frequency] ?? '']) : t("반복 없음")}</div></div>
            <div className="history-actions">
              <button type="button" className="text-button small" onClick={() => { onClose(); import('./registry').then(module => module.openWorkspaceDialog('recurrence', { templateId: template.id })); }}>{t("반복 설정")}</button>
              <button type="button" className="text-button small" onClick={() => { onClose(); import('../data/router').then(module => module.navigate(template.id)); }}>{t("편집")}</button>
            </div>
          </div>
        ))}
        {!templates.length ? <p className="muted">{t("템플릿이 없습니다. 새로 만들기 ▾ 메뉴에서 템플릿을 추가하세요.")}</p> : null}
      </div>
    </Dialog>
  );
}

export function RecurrenceDialog({ templateId, onClose }: Close & { templateId: string }) {
  const template = workspace.get<PageEntity>(templateId);
  const rule = template?.recurrence ?? null;
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [frequency, setFrequency] = useState(rule?.frequency ?? 'week');
  const [interval, setInterval] = useState(rule?.interval ?? 1);
  const [start, setStart] = useState(rule?.start ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [zone, setZone] = useState(rule?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const revision = workspace.revision;
  return (
    <Dialog title={t("반복")} onClose={onClose} width={440} submitLabel={t("저장")} onSubmit={() => apply([{ type: 'template.configure', id: templateId, recurrence: { enabled, frequency, interval: Number(interval) || 1, start, timeZone: zone } }], { revision })}
      footer={rule ? <button type="button" className="text-button danger" onClick={() => { apply([{ type: 'template.configure', id: templateId, recurrence: null }]).catch(report); onClose(); }}>{t("반복 끄기")}</button> : null}>
      <p className="muted">{t("{0} 템플릿으로 정해진 때마다 새 항목을 만듭니다.", [template?.title || t("새 템플릿")])}</p>
      <label className="field inline"><span>{t("반복 사용")}</span><Switch checked={enabled} onChange={setEnabled} /></label>
      <div className="field-row">
        <label className="field"><span>{t("간격")}</span><input className="text-input" type="number" min={1} max={365} value={interval} onChange={event => setInterval(Number(event.target.value))} /></label>
        <label className="field"><span>{t("단위")}</span><select className="text-input" value={frequency} onChange={event => setFrequency(event.target.value)}><option value="day">{t("일")}</option><option value="week">{t("주")}</option><option value="month">{t("개월")}</option><option value="year">{t("년")}</option></select></label>
      </div>
      <label className="field"><span>{t("첫 생성 날짜와 시각")}</span><input className="text-input" type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label className="field"><span>{t("시간대")}</span><input className="text-input" value={zone} onChange={event => setZone(event.target.value)} /></label>
    </Dialog>
  );
}

export function TaskSettingsDialog({ sourceId, onClose }: Close & { sourceId: string }) {
  const ws = useWorkspace();
  const source = ws.get<SourceEntity>(sourceId);
  const settings = source?.tasks ?? {};
  const schema = ws.schema(sourceId);
  const pairs = useMemo(() => schema.filter(property => property.type === 'relation' && property.targetSourceId === sourceId && property.inversePropertyId && property.inversePropertyId !== property.id && ws.get<PropertyEntity>(property.inversePropertyId)?.alive && ws.get<PropertyEntity>(property.inversePropertyId)?.inversePropertyId === property.id), [ws.version]);
  const [sub, setSub] = useState(!!settings.subitems?.enabled);
  const [dep, setDep] = useState(!!settings.dependencies?.enabled);
  const [parent, setParent] = useState(settings.subitems?.parentPropertyId ?? '');
  const [predecessor, setPredecessor] = useState(settings.dependencies?.predecessorPropertyId ?? '');
  const [date, setDate] = useState(settings.dependencies?.datePropertyId ?? schema.find(property => property.type === 'date')?.id ?? '');
  const [mode, setMode] = useState(settings.dependencies?.mode ?? 'none');
  const [weekends, setWeekends] = useState(!!settings.dependencies?.avoidWeekends);
  const revision = workspace.revision;
  const pair = (value: string, first: string, second: string) => value ? { [first]: value, [second]: ws.get<PropertyEntity>(value)?.inversePropertyId } : { [first]: newId(), [second]: newId() };
  const pairLabel = (property: PropertyEntity) => `${property.name} / ${ws.get<PropertyEntity>(property.inversePropertyId)?.name ?? ''}`;
  return (
    <Dialog title={t("하위 항목과 종속성")} onClose={onClose} width={500} submitLabel={t("저장")} onSubmit={() => apply([{ type: 'source.configure_tasks', id: sourceId,
      subitems: { enabled: sub, ...(sub ? pair(parent, 'parentPropertyId', 'childrenPropertyId') : {}) },
      dependencies: { enabled: dep, ...(dep ? pair(predecessor, 'predecessorPropertyId', 'successorPropertyId') : {}), datePropertyId: date || null, mode, avoidWeekends: weekends },
    }], { revision })}>
      <section className="dialog-section">
        <label className="field inline"><span>{tx("{0} · 항목 아래에 하위 항목을 둡니다", [<strong>{t("하위 항목")}</strong>])}</span><Switch checked={sub} onChange={setSub} /></label>
        {sub ? <label className="field"><span>{t("상위 / 하위 관계 속성")}</span><select className="text-input" value={parent} onChange={event => setParent(event.target.value)}><option value="">{t("새 관계 속성 쌍 만들기")}</option>{pairs.map(property => <option key={property.id} value={property.id}>{pairLabel(property)}</option>)}</select></label> : null}
      </section>
      <section className="dialog-section">
        <label className="field inline"><span>{tx("{0} · 선행·후행 작업을 연결합니다", [<strong>{t("종속성")}</strong>])}</span><Switch checked={dep} onChange={setDep} /></label>
        {dep ? (
          <>
            <label className="field"><span>{t("선행 / 후행 관계 속성")}</span><select className="text-input" value={predecessor} onChange={event => setPredecessor(event.target.value)}><option value="">{t("새 관계 속성 쌍 만들기")}</option>{pairs.map(property => <option key={property.id} value={property.id}>{pairLabel(property)}</option>)}</select></label>
            <label className="field"><span>{t("일정 날짜 속성")}</span><select className="text-input" value={date} onChange={event => setDate(event.target.value)}><option value="">{t("선택 안 함")}</option>{schema.filter(property => property.type === 'date').map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
            <label className="field"><span>{t("선행 작업 날짜가 바뀌면")}</span><select className="text-input" value={mode} onChange={event => setMode(event.target.value)}><option value="none">{t("자동으로 옮기지 않음")}</option><option value="overlap">{t("겹칠 때만 후행 작업 옮기기")}</option><option value="preserve">{t("간격 유지하며 옮기기")}</option></select></label>
            <label className="field inline"><span>{t("옮긴 일정의 시작·종료가 주말이면 피하기")}</span><Switch checked={weekends} onChange={setWeekends} /></label>
          </>
        ) : null}
      </section>
    </Dialog>
  );
}

// 스프린트 (sprints): length, first weekday, what happens to unfinished tasks, how many sprints wait ahead,
// completing by itself after the last day; turning it on makes the sprints database and the sprint views.
export const sprintLabels = () => ({ database: t("스프린트"), title: t("스프린트 이름"), dates: t("날짜"), status: t("스프린트 상태"), tasks: t("작업"), sprint: t("스프린트"), past: t("sprint|지난"), current: t("sprint|현재"), next: t("sprint|다음"), future: t("sprint|예정"),
  sprintName: t("스프린트 {0}"), currentView: t("현재 스프린트"), planningView: t("스프린트 계획"), backlogView: t("백로그"), allView: t("모든 스프린트") });
export function completeSprint(sourceId: string) {
  return apply([{ type: 'sprint.complete', id: sourceId }]).then(() => setStatus(t("스프린트를 완료했습니다. 다음 스프린트가 시작됐습니다.")));
}
export function SprintSettingsDialog({ sourceId, onClose }: Close & { sourceId: string }) {
  const ws = useWorkspace();
  const config = ws.get<SourceEntity>(sourceId)?.tasks?.sprints;
  const on = !!config?.enabled;
  const [length, setLength] = useState(config?.lengthWeeks ?? 2);
  const [startDay, setStartDay] = useState(config?.startDay ?? 1);
  const [unfinished, setUnfinished] = useState<'next' | 'backlog'>(config?.unfinished ?? 'next');
  const [upcoming, setUpcoming] = useState(config?.upcoming ?? 2);
  const [auto, setAuto] = useState(!!config?.autoComplete);
  const days = [t("일요일"), t("월요일"), t("화요일"), t("수요일"), t("목요일"), t("금요일"), t("토요일")];
  const settings = { lengthWeeks: length, startDay, unfinished, upcoming, autoComplete: auto, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
  return (
    <Dialog title={t("스프린트")} onClose={onClose} width={480} submitLabel={on ? t("저장") : t("스프린트 사용")}
      onSubmit={() => apply([{ type: 'source.configure_sprints', id: sourceId, enabled: true, ...settings, ...(on ? {} : { labels: sprintLabels() }) }]).then(() => setStatus(on ? t("스프린트 설정을 저장했습니다.") : t("스프린트를 켰습니다. 스프린트 데이터베이스와 보기를 만들었습니다.")))}
      footer={on ? <>
        <button type="button" className="outline-button" onClick={() => { completeSprint(sourceId).then(onClose).catch(report); }}>{t("현재 스프린트 완료")}</button>
        <button type="button" className="text-button danger" onClick={() => { apply([{ type: 'source.configure_sprints', id: sourceId, enabled: false }]).then(onClose).catch(report); }}>{t("스프린트 끄기")}</button>
      </> : undefined}>
      {!on ? <p className="muted small">{t("작업을 기간별 스프린트로 나눕니다. 스프린트 데이터베이스와 \"스프린트\" 관계 속성, 현재 스프린트 · 스프린트 계획 · 백로그 보기가 생깁니다.")}</p> : null}
      <label className="field"><span>{t("스프린트 길이")}</span><select className="text-input" value={length} onChange={event => setLength(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{t("{0}주", [n])}</option>)}</select></label>
      <label className="field"><span>{t("시작 요일")}</span><select className="text-input" value={startDay} onChange={event => setStartDay(Number(event.target.value))}>{days.map((day, index) => <option key={index} value={index}>{day}</option>)}</select></label>
      <label className="field"><span>{t("끝나지 않은 작업")}</span><select className="text-input" value={unfinished} onChange={event => setUnfinished(event.target.value as 'next' | 'backlog')}><option value="next">{t("다음 스프린트로 옮기기")}</option><option value="backlog">{t("백로그로 돌려보내기")}</option></select></label>
      <label className="field"><span>{t("미리 만들어 둘 스프린트")}</span><select className="text-input" value={upcoming} onChange={event => setUpcoming(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{t("{0}개", [n])}</option>)}</select></label>
      <label className="field inline"><span>{t("마지막 날이 지나면 스프린트 자동 완료")}</span><Switch checked={auto} onChange={setAuto} /></label>
    </Dialog>
  );
}

export function NewDatabaseDialog({ pageId, onClose, onCreated }: Close & { pageId: string; onCreated?: (viewId: string) => void }) {
  const [name, setName] = useState(t("새 데이터베이스"));
  return (
    <Dialog title={t("데이터베이스 만들기")} onClose={onClose} width={420} submitLabel={t("만들기")} onSubmit={async () => {
      const id = newId(), viewId = newId();
      await apply([{ type: 'source.create', id, pageId, name: name.trim() || t("새 데이터베이스"), ...titleNameField() }, { type: 'view.create', id: viewId, sourceId: id, parentId: pageId, name: t("표"), viewType: 'table', config: {} }]);
      onCreated?.(viewId);
      setStatus(t("데이터베이스를 만들었습니다."));
    }}>
      <label className="field"><span>{t("이름")}</span><input className="text-input" autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
    </Dialog>
  );
}
