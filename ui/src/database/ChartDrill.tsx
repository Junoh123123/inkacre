import { t } from '../i18n';
import { useRef, useState } from 'react';
import { useQuery } from '../data/hooks';
import { apply, newId } from '../data/commands';
import { navigate } from '../data/router';
import { report, setStatus, useWorkspace } from '../data/store';
import type { ChartBar, Filter, PropertyEntity, SourceEntity, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { Popover } from '../ui/overlay';
import { newRule } from '../dialogs/filters';
import { PagePicker } from '../dialogs/pageDialogs';
import { TableView } from './TableView';
import { FilterRuleList, PropertyPicker, RuleChip, RulePopover, usePageIndex, type Rule } from './FilterSortBar';
import { pageHolding } from './shared';

// What a chart bar, point or slice opens: a modal in the middle, 800 wide (the
// window's width when narrower) and 60% of the window high, r12, the large shadow, the backdrop
// rgba(15,15,15,.6). Head: the group (16px) with search, ⋯ (보기로 저장… · <DB> 열기) and ×; the group's
// condition as chips ("태그: 포함 개발") that edit this look only, "+ 필터" adding more; then the rows as a
// table, or — when nothing is left — "필터 편집", which docks a 필터 panel at the modal's right edge.
export function ChartDrill({ bar, title, sourceId, view, property, onClose }: { bar: ChartBar; title: string; view?: ViewEntity | null; sourceId: string; property?: PropertyEntity; onClose: () => void }) {
  const ws = useWorkspace();
  const pages = usePageIndex();
  const [search, setSearch] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { base, rules: initial } = splitDrilldown(bar.drilldown ?? null, view?.config.filter ?? null);
  const [rules, setRules] = useState<Rule[]>(initial);
  const [open, setOpen] = useState<{ anchor: Element; index: number } | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [picker, setPicker] = useState<Element | null>(null);
  const [more, setMore] = useState<Element | null>(null);
  const [panel, setPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const filter = combine(base, rules);
  const query = useQuery({ sourceId, filter: filter ?? undefined, ...(search?.trim() ? { search: search.trim() } : {}) });
  const width = Math.min(window.innerWidth, 800), height = Math.round(window.innerHeight * 0.6);
  const left = (window.innerWidth - width) / 2, top = (window.innerHeight - height) / 2;
  const properties = query.result?.properties ?? (property ? [property] : []);
  const byId = new Map(properties.map(item => [item.id, item]));
  const source = ws.get<SourceEntity>(sourceId);
  const emptyState = (
    <button type="button" className="table-empty-button" onClick={() => setPanel(true)}><Icon name="filter" size={14} /><span>{t("필터 편집")}</span></button>
  );
  const saveAsView = async (pageId: string, pageTitle: string) => {
    const id = newId();
    await apply([{ type: 'view.create', id, sourceId, parentId: pageId, name: title, viewType: 'table', config: filter ? { filter } : {} }]);
    setStatus(t("{0}에 보기를 저장했습니다.", [pageTitle || t("새 페이지")]));
  };
  return (
    <Popover anchor={{ x: left, y: top }} placement="point" modal onClose={onClose} className="chart-drill-modal" label={title} style={{ width, height }} motion="fade">
      <div ref={modalRef} className="chart-drill-inner">
        <div className="chart-drill-head">
          <span className="chart-drill-title">{title}</span>
          <span className="spacer" />
          {search !== null ? <input className="chart-drill-search" autoFocus value={search} placeholder={t("검색…")} onChange={event => setSearch(event.target.value)} onBlur={() => { if (!search) setSearch(null); }} /> : <button type="button" className="icon-button" aria-label={t("검색")} title={t("검색")} onClick={() => setSearch('')}><Icon name="search" size={16} /></button>}
          <button type="button" className="icon-button" aria-label={t("더 보기")} title={t("더 보기")} onClick={event => setMore(event.currentTarget)}><Icon name="more" size={16} /></button>
          <button type="button" className="settings-close" aria-label={t("닫기")} onClick={onClose}><Icon name="close" size={12} /></button>
        </div>
        <div className="chart-drill-chips">
          {rules.map((item, index) => (
            <RuleChip key={`${item.propertyId}-${index}`} rule={item} property={byId.get(item.propertyId)} pages={pages} onClick={element => setOpen({ anchor: element, index })}
              chipRef={element => { if (element && fresh === index && !open) { setFresh(null); setOpen({ anchor: element, index }); } }} />
          ))}
          <button type="button" className="filter-add" onClick={event => setPicker(event.currentTarget)}><Icon name="plus" size={14} />{t("필터")}</button>
        </div>
        <div className="chart-drill-body">
          {query.result ? <TableView result={query.result} view={null} sourceId={sourceId} inline selected={selected} onSelect={setSelected} emptyState={emptyState} /> : null}
        </div>
      </div>
      {open && rules[open.index] ? (
        <RulePopover key={`${open.index}-${rules[open.index].propertyId}`} anchor={open.anchor} rule={rules[open.index]} property={byId.get(rules[open.index].propertyId)} onClose={() => setOpen(null)}
          onChange={next => setRules(list => list.map((item, i) => i === open.index ? next : item))}
          onRemove={() => setRules(list => list.filter((_, i) => i !== open.index))} />
      ) : null}
      {picker ? (
        <PropertyPicker anchor={picker} title={t("필터 기준…")} properties={properties.filter(item => !rules.some(rule => rule.propertyId === item.id))} onClose={() => setPicker(null)}
          onPick={item => { setRules(list => [...list, newRule(item)]); setFresh(rules.length); }} />
      ) : null}
      {more ? (
        <Menu anchor={more} placement="below-center" width={180} onClose={() => setMore(null)} entries={[
          { label: t("보기로 저장…"), icon: 'plus', onSelect: () => setSaving(true) },
          { label: t("{0} 열기", [source?.name || t("데이터베이스")]), icon: 'arrow-up-right', onSelect: () => { onClose(); navigate(view?.id ?? pageHolding(sourceId)?.id ?? sourceId); } },
        ]} />
      ) : null}
      {panel ? (
        <Popover anchor={{ x: left + width, y: top + 38 }} placement="point" onClose={() => setPanel(false)} className="chart-drill-filter-panel" label={t("필터")} style={{ width: 290 }}>
          <div className="settings-head">
            <span className="settings-title">{t("필터")}</span>
            <span className="spacer" />
            <button type="button" className="settings-close" aria-label={t("닫기")} onClick={() => setPanel(false)}><Icon name="close" size={12} /></button>
          </div>
          <FilterRuleList rules={rules} properties={properties} onChange={setRules} />
        </Popover>
      ) : null}
      {saving ? <PagePicker title={t("보기로 저장")} placeholder={t("추가할 페이지 검색…")} onClose={() => setSaving(false)} onPick={page => page ? saveAsView(page.id, page.title).catch(report) : undefined} /> : null}
    </Popover>
  );
}

const isRule = (node: Filter): node is Filter & Rule => 'propertyId' in node;

/** The drilldown is the view's filter (kept, not shown) and the group's condition (shown as chips). */
function splitDrilldown(drilldown: Filter | null, viewFilter: Filter | null): { base: Filter | null; rules: Rule[] } {
  if (!drilldown) return { base: null, rules: [] };
  let group: Filter | null = drilldown;
  let base: Filter | null = null;
  if (viewFilter && 'all' in drilldown && drilldown.all.length === 2 && JSON.stringify(drilldown.all[0]) === JSON.stringify(viewFilter)) { base = viewFilter; group = drilldown.all[1]; }
  else if (viewFilter && JSON.stringify(drilldown) === JSON.stringify(viewFilter)) return { base: viewFilter, rules: [] };
  if (isRule(group)) return { base, rules: [group] };
  if ('all' in group && group.all.every(isRule)) return { base, rules: group.all as Rule[] };
  return { base: drilldown, rules: [] };
}

function combine(base: Filter | null, rules: Rule[]): Filter | null {
  const parts: Filter[] = [...(base ? [base] : []), ...(rules as Filter[])];
  return !parts.length ? null : parts.length === 1 ? parts[0] : { all: parts };
}
