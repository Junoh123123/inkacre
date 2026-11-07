import { t } from '../i18n';
import { useState } from 'react';
import { newId } from '../data/commands';
import { colorNames, tagColors } from '../data/format';
import type { ConditionalColorRule, PageEntity, PropertyEntity, QueryResult, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { Popover } from '../ui/overlay';
import { Switch } from '../ui/primitives';
import { FilterValueInput, filterLabels, operatorsFor } from '../dialogs/filters';
import { PropertyPicker, RulePopover, ruleSummary, usePageIndex } from './FilterSortBar';
import { updateView } from './shared';

// 조건부 색상 (view settings):
// - empty: a small picture of a coloured table, "페이지 색을 …" (12px #7d7a75) and a blue "+ 새 색상 설정";
// - "+" asks for a property (url · ID · email · phone · files are not offered), then a rule card (258 wide, r10,
//   rgb(249,248,247)): the property (12px #a19e99) and its condition (12/500 ⌄, starting on "비어 있지 않음") with a
//   bin, the value when the condition needs one, "페이지 배경" (option properties: 옵션 색과 일치, on by default;
//   otherwise one of ten colours, green first) and "적용 대상" (행 전체 · 이 속성); "+ 추가" under the cards.
// The first matching rule colours the row (or the cell); the colours are the block background colours.
const unavailable = new Set(['url', 'unique_id', 'email', 'phone', 'files', 'button']);
const optionTypes = new Set(['select', 'status', 'multi_select']);

export function ConditionalColorsPage({ view, result }: { view: ViewEntity; result: QueryResult }) {
  const rules = view.config.conditionalColors ?? [];
  const [picker, setPicker] = useState<Element | null>(null);
  const save = (next: ConditionalColorRule[]) => updateView(view, { conditionalColors: next });
  const properties = result.properties.filter(property => !unavailable.has(property.type));
  const add = (property: PropertyEntity) => save([...rules, { id: newId(), propertyId: property.id, op: 'not_empty', ...(optionTypes.has(property.type) ? { matchOption: true } : { color: 'green' }), applyTo: 'row' }]);
  return (
    <div className="ccolor-page">
      {rules.length ? rules.map((rule, index) => (
        <RuleCard key={rule.id} rule={rule} property={result.properties.find(item => item.id === rule.propertyId)}
          onChange={next => save(rules.map((item, i) => i === index ? next : item))} onRemove={() => save(rules.filter((_, i) => i !== index))} />
      )) : (
        <>
          <div className="ccolor-art" aria-hidden="true">
            {[['', 'gray'], ['green', 'green'], ['', ''], ['green', 'green'], ['yellow', 'yellow'], ['red', 'red']].map(([color], i) => (
              <div key={i} className={`ccolor-art-row${i === 0 ? ' head' : ''}${color ? ` bg-${color}` : ''}`}><span /><span /><span /></div>
            ))}
          </div>
          <p className="ccolor-text">{t("페이지 색을 사용자 지정하면 카테고리, 기한이 지난 일정, 업무를 더 보기 쉽고 이해하기 쉽게 표시할 수 있습니다.")}</p>
        </>
      )}
      <button type="button" className={rules.length ? 'ccolor-more' : 'ccolor-new'} onClick={event => setPicker(event.currentTarget)}>
        <Icon name="plus" size={14} /><span>{rules.length ? t("추가") : t("새 색상 설정")}</span>
      </button>
      {picker ? <PropertyPicker anchor={picker} title={t("속성 검색…")} width={258} properties={properties} onClose={() => setPicker(null)} onPick={property => { setPicker(null); add(property); }} /> : null}
    </div>
  );
}

function RuleCard({ rule, property, onChange, onRemove }: { rule: ConditionalColorRule; property: PropertyEntity | undefined; onChange: (rule: ConditionalColorRule) => void; onRemove: () => void }) {
  const pages = usePageIndex();
  const [menu, setMenu] = useState<{ kind: 'op' | 'apply'; anchor: Element } | null>(null);
  const [value, setValue] = useState<Element | null>(null);
  const [colors, setColors] = useState<Element | null>(null);
  const options = !!property && optionTypes.has(property.type);
  const matching = options && rule.matchOption !== false;
  const needsValue = !['empty', 'not_empty'].includes(rule.op);
  const listed = !!property && ['select', 'status', 'multi_select', 'person', 'relation'].includes(property.type);
  const base = rule.op === 'in' ? 'eq' : rule.op === 'not_in' ? 'neq' : rule.op;
  const summary = ruleSummary({ propertyId: rule.propertyId, op: rule.op, value: rule.value }, property, pages as Map<string, PageEntity>);
  return (
    <div className="ccolor-card">
      <div className="ccolor-head">
        <span className="ccolor-prop">{property?.name ?? t("삭제된 속성")}</span>
        <button type="button" className="ccolor-op" onClick={event => setMenu({ kind: 'op', anchor: event.currentTarget })}>{filterLabels[base] ?? base}<Icon name="chevron-down" size={10} /></button>
        <span className="spacer" />
        <button type="button" className="ccolor-remove" aria-label={t("색상 규칙 삭제")} title={t("삭제")} onClick={onRemove}><Icon name="trash" size={14} /></button>
      </div>
      {needsValue ? (listed ? (
        <button type="button" className={`ccolor-value${summary ? '' : ' empty'}`} onClick={event => setValue(event.currentTarget)}><span>{summary || t("선택…")}</span><Icon name="chevron-down" size={12} /></button>
      ) : <div className="ccolor-value-input"><FilterValueInput property={property} op={rule.op} value={rule.value} onChange={next => onChange({ ...rule, value: next })} /></div>) : null}
      <button type="button" className="ccolor-row" onClick={event => setColors(event.currentTarget)}>
        <span className="ccolor-row-label">{t("페이지 배경")}</span>
        {matching ? <span className="ccolor-row-value">{t("옵션 색과 일치")}</span> : <><span className={`ccolor-swatch small bg-${rule.color ?? 'green'}`} /><span className="ccolor-row-value">{colorNames[rule.color ?? 'green']}</span></>}
        <Icon name={colors ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      <button type="button" className="ccolor-row" onClick={event => setMenu({ kind: 'apply', anchor: event.currentTarget })}>
        <span className="ccolor-row-label">{t("적용 대상")}</span><span className="ccolor-row-value">{rule.applyTo === 'property' ? t("이 속성") : t("행 전체")}</span>
        <Icon name={menu?.kind === 'apply' ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {menu?.kind === 'op' ? <Menu anchor={menu.anchor} placement="below-start" width={200} onClose={() => setMenu(null)}
        entries={operatorsFor(property).map(op => ({ label: filterLabels[op] ?? op, checked: op === base, onSelect: () => onChange({ ...rule, op, ...(['empty', 'not_empty'].includes(op) ? { value: undefined } : {}) }) }))} /> : null}
      {menu?.kind === 'apply' ? <Menu anchor={menu.anchor} placement="below-end" width={150} onClose={() => setMenu(null)}
        entries={[{ label: t("행 전체"), checked: rule.applyTo !== 'property', onSelect: () => onChange({ ...rule, applyTo: 'row' }) }, { label: t("이 속성"), checked: rule.applyTo === 'property', onSelect: () => onChange({ ...rule, applyTo: 'property' }) }]} /> : null}
      {value ? <RulePopover anchor={value} rule={{ propertyId: rule.propertyId, op: rule.op, value: rule.value }} property={property}
        onChange={next => onChange({ ...rule, op: next.op, value: next.value })} onRemove={onRemove} onClose={() => setValue(null)} /> : null}
      {colors ? (
        <Popover anchor={colors} placement="below-end" offset={2} onClose={() => setColors(null)} className="ccolor-colors" label={t("페이지 배경")}>
          {options ? <label className="ccolor-match"><span>{t("옵션 색과 일치")}</span><Switch checked={matching} onChange={on => onChange({ ...rule, matchOption: on, ...(on ? {} : { color: rule.color ?? 'green' }) })} label={t("옵션 색과 일치")} /></label> : null}
          <div className={`ccolor-grid${matching ? ' disabled' : ''}`}>
            {tagColors.map(color => (
              <button type="button" key={color} className={`ccolor-swatch bg-${color}${!matching && (rule.color ?? 'green') === color ? ' active' : ''}`} aria-label={colorNames[color]} title={colorNames[color]} disabled={matching}
                onClick={() => onChange({ ...rule, color, matchOption: options ? false : undefined })} />
            ))}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
