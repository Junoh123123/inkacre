import { t } from '../i18n';
import { useRef, useState, type ReactNode } from 'react';
import type { ChartConfig, ChartPalette, ChartType, PropertyEntity, QueryResult, ViewEntity } from '../data/types';
import { aggregateLabels } from '../data/format';
import { Icon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Popover } from '../ui/overlay';
import { Switch } from '../ui/primitives';
import { newId } from '../data/commands';
import { updateView } from './shared';
import { SwitchRow, ValueRow } from './settingsRows';
import { GroupTitle } from './BoardView';
import { chartTypeLabels, groupColor, groupLabel, heightLabels, measureLabel, paletteLabels, paletteOrder, paletteSwatches } from './chartModel';

// The chart part of the view settings (290-wide panel):
// "차트 유형" (12/500 #7d7a75 at y136) over five 42×40 r8 icon tiles from x16 every 50 (the chosen one ringed
// 2px #2783de, the others 1px #e6e5e3); then, for bars and lines, "X축" (데이터 · 정렬 · 0 값 제외), "Y축"
// (데이터 · [소수 자릿수] · 그룹화 · [누적] · 범위 · 기준선) and "스타일" (색상 · 기타 스타일 옵션); a donut has
// "데이터" (데이터 · 슬라이스 기준 · 정렬) and "스타일"; a number has the title switch and field, "데이터" (데이터 ·
// 계산 · 형식) and "스타일" (색 · 높이). Rows are 28 high with a 20px icon at 16 and the label at 44; each
// opens a 250-wide list under the row (its chevron turns down) or, for 범위 · 기준선 · 기타 스타일 옵션, a card.
const xTypes = ['title', 'select', 'status', 'multi_select', 'checkbox', 'person', 'relation', 'text', 'number', 'date', 'url', 'email', 'created_by', 'last_edited_by', 'created_time', 'last_edited_time', 'formula'];
const numericTypes = ['number', 'formula', 'rollup'];
const numberAggregations = ['sum', 'average', 'min', 'max', 'median', 'range', 'unique'];
const countAggregations = ['count_nonempty', 'count_empty', 'unique', 'percent_empty', 'percent_not_empty'];
const tiles: ChartType[] = ['bar', 'hbar', 'line', 'donut', 'number'];
const tileIcons: Record<ChartType, string> = { bar: 'chart-bar', hbar: 'chart-hbar', line: 'chart-line', donut: 'chart-donut', number: 'hash' };
const gridLabels = { none: t("없음"), horizontal: t("가로선"), vertical: t("세로선"), both: t("chart-both|모두") } as const;
const axisLabelNames = { none: t("없음"), x: t("X축"), y: t("Y축"), both: t("chart-both|모두") } as const;
const dateLabels = { relative: t("상대 날짜"), day: t("일"), week: t("주"), month: t("월"), year: t("연") } as const;
const referenceColors: Array<[string, string]> = [[t("검은색"), 'rgb(85, 83, 78)'], [t("회색"), 'rgb(166, 162, 153)'], [t("갈색"), 'rgb(159, 107, 83)'], [t("노란색"), 'rgb(203, 145, 47)'], [t("주황색"), 'rgb(217, 115, 13)'],
  [t("초록색"), 'rgb(68, 131, 97)'], [t("파란색"), 'rgb(51, 126, 169)'], [t("보라색"), 'rgb(144, 101, 176)'], [t("분홍색"), 'rgb(193, 76, 138)'], [t("빨간색"), 'rgb(212, 76, 71)']];
const numberColorNames: Array<[string, string]> = [['default', t("기본")], ['gray', t("회색")], ['brown', t("갈색")], ['yellow', t("노란색")], ['orange', t("주황색")], ['green', t("초록색")], ['blue', t("파란색")], ['purple', t("보라색")], ['pink', t("분홍색")], ['red', t("빨간색")]];

export function defaultChart(schema: PropertyEntity[]): ChartConfig {
  const group = schema.find(property => property.type === 'status') ?? schema.find(property => property.type === 'select') ?? schema.find(property => xTypes.includes(property.type));
  return { groupBy: group?.id ?? schema[0]?.id ?? '', aggregation: 'count', type: 'bar', ...(group?.type === 'status' ? { statusGrouping: 'option' as const } : {}) };
}

type Kind = 'x' | 'sort' | 'y' | 'decimals' | 'stack' | 'range' | 'reference' | 'palette' | 'style' | 'data' | 'calc' | 'format' | 'color' | 'height';

export function ChartSettings({ view, result }: { view: ViewEntity; result: QueryResult; onPage?: (page: string) => void }) {
  const schema = result.properties;
  const chart = view.config.chart ?? defaultChart(schema);
  const type = chart.type ?? 'bar';
  const [menu, setMenu] = useState<{ kind: Kind; anchor: HTMLElement } | null>(null);
  const set = (patch: Partial<ChartConfig>) => {
    const next: ChartConfig = { ...chart, ...patch };
    for (const key of Object.keys(next) as Array<keyof ChartConfig>) if (next[key] === undefined) delete next[key];
    return updateView(view, { chart: next });
  };
  const property = (id?: string | null) => schema.find(item => item.id === id);
  const xProperty = property(chart.groupBy), valueProperty = property(chart.valuePropertyId), stackProperty = property(chart.stackBy);
  const measure = measureLabel(chart, valueProperty);
  const measureShort = chart.aggregation === 'count' || !valueProperty ? t("개수") : valueProperty.name;
  const sortLabel = (sort: ChartConfig['sort']) => ({ manual: t("수동"), asc: t("{0} 오름차순", [xProperty?.name ?? '']), desc: t("{0} 내림차순", [xProperty?.name ?? '']), valueAsc: t("{0} 작음 → 큼", [measureShort]), valueDesc: t("{0} 큼 → 작음", [measureShort]) })[sort ?? 'asc'];
  const row = (kind: Kind, icon: string, label: string, value: ReactNode, disabled = false) => <ValueRow icon={icon} label={label} value={value} open={menu?.kind === kind} disabled={disabled} onClick={anchor => setMenu({ kind, anchor })} />;
  const xValue = xProperty ? `${xProperty.name}${xProperty.type === 'status' ? ` (${chart.statusGrouping === 'group' ? t("그룹") : t("옵션")})` : chart.dateGrouping ? ` (${dateLabels[chart.dateGrouping]})` : ''}` : t("없음");
  const ordered = ['status', 'date', 'created_time', 'last_edited_time', 'number'].includes(xProperty?.type ?? '');
  const numericY = !!valueProperty && numericTypes.includes(valueProperty.type) && chart.aggregation !== 'count';

  const entries = (): MenuEntry[] => {
    switch (menu?.kind) {
      case 'x':
        return schema.filter(item => xTypes.includes(item.type) || item.type === 'phone').map(item => {
          const pick = (patch: Partial<ChartConfig> = {}) => set({ groupBy: item.id, hiddenGroups: [], groupOrder: [], sort: ['select', 'multi_select'].includes(item.type) ? 'manual' : 'asc', statusGrouping: undefined, dateGrouping: undefined, ...patch });
          const entry: MenuEntry = { label: item.name, icon: `type-${item.type}`, keywords: item.name, checked: item.id === chart.groupBy, disabled: item.type === 'phone', onSelect: () => pick() };
          if (item.type === 'status') return { ...entry, onSelect: undefined, submenuWidth: 200, submenu: () => (['group', 'option'] as const).map(mode => ({ label: mode === 'group' ? t("그룹") : t("옵션"), icon: 'type-status', checked: item.id === chart.groupBy && (chart.statusGrouping ?? 'option') === mode, onSelect: () => pick({ statusGrouping: mode }) })) } as MenuEntry;
          if (['date', 'created_time', 'last_edited_time'].includes(item.type)) return { ...entry, onSelect: undefined, submenuWidth: 200, submenu: () => (Object.keys(dateLabels) as Array<keyof typeof dateLabels>).map(mode => ({ label: dateLabels[mode], icon: 'type-date', checked: item.id === chart.groupBy && chart.dateGrouping === mode, onSelect: () => pick({ dateGrouping: mode }) })) } as MenuEntry;
          return entry;
        });
      case 'y':
      case 'data':
      case 'calc': {
        if (menu.kind === 'calc') {
          const list = !valueProperty ? ['count'] : numericTypes.includes(valueProperty.type) ? ['count', ...countAggregations, 'sum', 'average', 'median', 'min', 'max', 'range'] : ['count', ...countAggregations];
          return list.map(operation => ({ label: aggregateLabels[operation], checked: chart.aggregation === operation, onSelect: () => set({ aggregation: operation }) }));
        }
        if (menu.kind === 'data') return [
          { label: t("없음"), checked: !chart.valuePropertyId, onSelect: () => set({ valuePropertyId: undefined, aggregation: 'count' }) },
          { kind: 'separator' },
          ...schema.filter(item => item.type !== 'button').map(item => ({ label: item.name, icon: `type-${item.type}`, keywords: item.name, checked: chart.valuePropertyId === item.id, onSelect: () => set({ valuePropertyId: item.id, aggregation: 'count' }) })),
        ];
        const numeric = schema.filter(item => numericTypes.includes(item.type));
        const others = schema.filter(item => !numericTypes.includes(item.type) && item.type !== 'button');
        return [
          { label: t("개수"), icon: 'digits', checked: chart.aggregation === 'count', onSelect: () => set({ aggregation: 'count', valuePropertyId: undefined, decimals: undefined }) },
          ...(numeric.length ? [{ kind: 'separator' } as MenuEntry] : []),
          ...numeric.map(item => ({ label: item.name, icon: `type-${item.type}`, keywords: item.name, checked: chart.valuePropertyId === item.id && chart.aggregation !== 'count', submenuWidth: 200,
            submenu: () => numberAggregations.map(operation => ({ label: operation === 'unique' ? t("고유 값 세기") : aggregateLabels[operation], checked: chart.valuePropertyId === item.id && chart.aggregation === operation, onSelect: () => set({ valuePropertyId: item.id, aggregation: operation }) })) } as MenuEntry)),
          ...(others.length ? [{ kind: 'separator' } as MenuEntry] : []),
          ...others.map(item => ({ label: item.name, icon: `type-${item.type}`, keywords: item.name, checked: chart.valuePropertyId === item.id && chart.aggregation === 'unique', onSelect: () => set({ valuePropertyId: item.id, aggregation: 'unique' }) } as MenuEntry)),
        ];
      }
      case 'decimals':
        return [null, 0, 1, 2, 3, 4, 5].map(value => ({ label: value == null ? t("기본") : String(value), checked: (chart.decimals ?? null) === value, onSelect: () => set({ decimals: value }) }));
      case 'stack':
        return [
          { label: t("없음"), checked: !chart.stackBy, onSelect: () => set({ stackBy: null }) },
          { kind: 'separator' },
          ...schema.filter(item => xTypes.includes(item.type) && item.id !== chart.groupBy).map(item => ({ label: item.name, icon: `type-${item.type}`, keywords: item.name, checked: chart.stackBy === item.id, onSelect: () => set({ stackBy: item.id }) })),
        ];
      case 'palette':
        return paletteOrder.flatMap((palette, index) => [
          ...(index === 2 ? [{ kind: 'separator' } as MenuEntry] : []),
          { label: paletteLabels[palette], checked: (chart.palette ?? 'auto') === palette, right: paletteSwatches(palette).length ? <span className="chart-swatches">{paletteSwatches(palette).map((color, i) => <span key={i} style={{ background: color }} />)}</span> : undefined, onSelect: () => set({ palette: palette as ChartPalette }) } as MenuEntry,
        ]);
      case 'format':
        return [
          { label: t("숫자 형식"), right: <span className="menu-item-value">{chart.numberFormat === 'percent' ? t("백분율") : chart.numberFormat === 'number' ? t("숫자") : t("상속")}</span>, submenuWidth: 180, submenu: () => ([[undefined, t("상속")], ['number', t("숫자")], ['percent', t("백분율")]] as const).map(([value, name]) => ({ label: name, checked: chart.numberFormat === value, onSelect: () => set({ numberFormat: value }) })) },
          { label: t("소수 자릿수"), right: <span className="menu-item-value">{chart.decimals ?? t("상속")}</span>, submenuWidth: 160, submenu: () => [null, 0, 1, 2, 3, 4, 5].map(value => ({ label: value == null ? t("상속") : String(value), checked: (chart.decimals ?? null) === value, onSelect: () => set({ decimals: value }) })) },
        ];
      case 'height':
        return (Object.keys(heightLabels) as Array<keyof typeof heightLabels>).map(height => ({ label: heightLabels[height], checked: (chart.height ?? 'medium') === height, onSelect: () => set({ height }) }));
      default:
        return [];
    }
  };
  const customMenu = menu && ['sort', 'range', 'reference', 'style', 'color'].includes(menu.kind);

  return (
    <>
      <div className="settings-section chart-settings">
        <div className="settings-subhead"><span>{t("차트 유형")}</span></div>
        <div className="chart-type-tiles" role="radiogroup" aria-label={t("차트 유형")}>
          {tiles.map(tile => (
            <button type="button" key={tile} role="radio" aria-checked={tile === type} aria-label={chartTypeLabels[tile]} title={chartTypeLabels[tile]} className={`chart-type-tile${tile === type ? ' active' : ''}`} onClick={() => set({ type: tile })}>
              <Icon name={tileIcons[tile]} size={22} />
            </button>
          ))}
        </div>
        {type === 'number' ? (
          <>
            <SwitchRow icon="font" label={t("차트 제목")} checked={chart.showTitle !== false} onChange={value => set({ showTitle: value })} />
            {chart.showTitle !== false ? <TextField value={chart.title ?? ''} placeholder={aggregateLabels[chart.aggregation] ?? t("모두 세기")} onChange={title => set({ title: title || null })} /> : null}
            <div className="settings-subhead"><span>{t("데이터")}</span></div>
            {row('data', 'hash', t("데이터"), valueProperty?.name ?? t("없음"))}
            {row('calc', 'digits', t("계산"), aggregateLabels[chart.aggregation] ?? t("모두 세기"), !valueProperty)}
            {row('format', 'sliders', t("형식"), chart.numberFormat || chart.decimals != null ? t("사용자 지정") : t("상속"))}
            <div className="settings-subhead"><span>{t("스타일")}</span></div>
            {row('color', 'palette', t("색"), numberColorNames.find(([id]) => id === (chart.color ?? 'default'))?.[1] ?? t("기본"))}
            {row('height', 'range', t("높이"), heightLabels[chart.height ?? 'medium'])}
          </>
        ) : type === 'donut' ? (
          <>
            <div className="settings-subhead"><span>{t("데이터")}</span></div>
            {row('x', 'pie', t("데이터"), xValue)}
            {row('y', 'slice', t("슬라이스 기준"), measure)}
            {row('sort', 'swap', t("정렬"), sortLabel(chart.sort))}
            <div className="settings-subhead"><span>{t("스타일")}</span></div>
            {row('palette', 'palette', t("색상"), paletteLabels[chart.palette ?? 'auto'])}
            {row('style', 'brush', t("기타 스타일 옵션"), '')}
          </>
        ) : (
          <>
            <div className="settings-subhead"><span>{t("X축")}</span></div>
            {row('x', 'axis-x', t("데이터"), xValue)}
            {row('sort', 'swap', t("정렬"), sortLabel(chart.sort))}
            <SwitchRow icon="eye-off" label={t("0 값 제외")} checked={!!chart.excludeZero} onChange={value => set({ excludeZero: value })} />
            <div className="settings-subhead"><span>{t("Y축")}</span></div>
            {row('y', 'axis-y', t("데이터"), measure)}
            {numericY ? row('decimals', 'decimals', t("소수 자릿수"), chart.decimals ?? t("기본")) : null}
            {row('stack', 'stack-split', t("그룹화"), stackProperty?.name ?? t("없음"))}
            {ordered ? <SwitchRow icon="cumulative" label={t("누적")} checked={!!chart.cumulative} onChange={value => set({ cumulative: value })} /> : null}
            {row('range', 'range', t("범위"), chart.range && (chart.range.min != null || chart.range.max != null) ? t("사용자 지정") : t("자동"))}
            {row('reference', 'grid-dots', t("기준선"), t("{0}개", [chart.referenceLines?.length ?? 0]))}
            <div className="settings-subhead"><span>{t("스타일")}</span></div>
            {row('palette', 'palette', t("색상"), paletteLabels[chart.palette ?? 'auto'])}
            {row('style', 'brush', t("기타 스타일 옵션"), '')}
          </>
        )}
      </div>
      {menu && !customMenu ? <Menu anchor={menu.anchor} placement="below-end" width={250} search={menu.kind === 'x' || menu.kind === 'stack' || menu.kind === 'data' || menu.kind === 'y' ? t("속성 검색…") : false} entries={entries()} onClose={() => setMenu(null)} /> : null}
      {menu?.kind === 'sort' ? <SortMenu anchor={menu.anchor} chart={chart} result={result} xProperty={xProperty} label={sortLabel} set={set} onClose={() => setMenu(null)} /> : null}
      {menu?.kind === 'range' ? <Popover anchor={menu.anchor} placement="below-end" offset={2} onClose={() => setMenu(null)} className="chart-card" style={{ width: 260 }} label={t("범위")}><RangeEditor chart={chart} onChange={range => set({ range })} /></Popover> : null}
      {menu?.kind === 'reference' ? <Popover anchor={menu.anchor} placement="below-end" offset={2} onClose={() => setMenu(null)} className="chart-card" style={{ width: 280 }} label={t("기준선")}><ReferenceEditor chart={chart} max={Math.max(0, ...(result.presentation.bars ?? []).map(bar => typeof bar.value === 'number' ? bar.value : 0))} onChange={referenceLines => set({ referenceLines })} /></Popover> : null}
      {menu?.kind === 'style' ? <Popover anchor={menu.anchor} placement="below-end" offset={2} onClose={() => setMenu(null)} className="chart-card chart-style-card" style={{ width: 280 }} label={t("기타 스타일 옵션")}><StyleOptions chart={chart} set={set} /></Popover> : null}
      {menu?.kind === 'color' ? <Popover anchor={menu.anchor} placement="below-end" offset={2} onClose={() => setMenu(null)} className="chart-card" style={{ width: 200 }} label={t("색")}><NumberColors chart={chart} set={set} /></Popover> : null}
    </>
  );
}

function TextField({ value, placeholder, onChange, multiline = false }: { value: string; placeholder: string; onChange: (value: string) => void; multiline?: boolean }) {
  const [draft, setDraft] = useState(value);
  const commit = () => { if (draft !== value) onChange(draft.trim()); };
  return (
    <div className="chart-text-field">
      {multiline
        ? <textarea className="text-input" rows={3} value={draft} placeholder={placeholder} aria-label={placeholder} onChange={event => setDraft(event.target.value)} onBlur={commit} />
        : <input className="text-input" value={draft} placeholder={placeholder} aria-label={placeholder} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) (event.target as HTMLInputElement).blur(); }} />}
    </div>
  );
}

// 정렬: 250 wide under the row — 수동 · <속성> 오름차순 · 내림차순 · 개수 작음 → 큼 · 큼 → 작음, a line, then
// "그룹" with "모두 숨기기" (blue) and each group as its tag with an eye (and a handle while the order is manual).
function SortMenu({ anchor, chart, result, xProperty, label, set, onClose }: { anchor: HTMLElement; chart: ChartConfig; result: QueryResult; xProperty?: PropertyEntity; label: (sort: ChartConfig['sort']) => string; set: (patch: Partial<ChartConfig>) => unknown; onClose: () => void }) {
  const bars = result.presentation.bars ?? [];
  const hidden = new Set(chart.hiddenGroups ?? []);
  const allHidden = bars.length > 0 && bars.every(bar => hidden.has(bar.key));
  const manual = (chart.sort ?? 'asc') === 'manual';
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: string; over: number } | null>(null);
  const startDrag = (event: React.PointerEvent, key: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('.chart-sort-group') ?? [])];
    let over = bars.findIndex(bar => bar.key === key);
    setDrag({ key, over });
    const move = (moveEvent: PointerEvent) => { const index = rows.findIndex(row => moveEvent.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2); over = index < 0 ? rows.length : index; setDrag({ key, over }); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDrag(null);
      const keys = bars.map(bar => bar.key), from = keys.indexOf(key), to = over > from ? over - 1 : over;
      if (from < 0 || to === from) return;
      keys.splice(from, 1); keys.splice(to, 0, key);
      set({ sort: 'manual', groupOrder: keys });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <Popover anchor={anchor} placement="below-end" offset={2} onClose={onClose} className="chart-sort-menu" style={{ width: 250 }} label={t("정렬")} role="menu">
      <div className="chart-sort-options">
        {(['manual', 'asc', 'desc', 'valueAsc', 'valueDesc'] as const).map(mode => (
          <button type="button" key={mode} role="menuitemradio" aria-checked={(chart.sort ?? 'asc') === mode} className="menu-item" onClick={() => set({ sort: mode, ...(mode === 'manual' && !chart.groupOrder?.length ? { groupOrder: bars.map(bar => bar.key) } : {}) })}>
            <span className="menu-item-label">{label(mode)}</span>{(chart.sort ?? 'asc') === mode ? <Icon name="check" size={16} /> : null}
          </button>
        ))}
      </div>
      {bars.length ? (
        <div className="chart-sort-groups" ref={list}>
          <div className="chart-group-head"><span>{t("그룹")}</span><button type="button" className="settings-link" onClick={() => set({ hiddenGroups: allHidden ? [] : bars.map(bar => bar.key) })}>{allHidden ? t("모두 표시") : t("모두 숨기기")}</button></div>
          {bars.map((bar, index) => (
            <div key={bar.key} className={`chart-sort-group${hidden.has(bar.key) ? ' is-hidden' : ''}${drag?.key === bar.key ? ' dragging' : ''}${drag && drag.over === index ? ' drop-before' : ''}`}>
              {manual ? <span className="settings-group-handle" aria-label={t("순서 바꾸기")} onPointerDown={event => startDrag(event, bar.key)}><Icon name="drag" size={16} /></span> : null}
              <span className="chart-sort-name">{chart.statusGrouping === 'group' || chart.dateGrouping ? groupLabel(xProperty, bar.group, chart) : <GroupTitle property={xProperty} group={{ key: bar.key, value: bar.group, rowIds: bar.rowIds }} />}</span>
              <button type="button" className="icon-button tiny" aria-label={hidden.has(bar.key) ? t("그룹 표시") : t("그룹 숨기기")} onClick={() => set({ hiddenGroups: hidden.has(bar.key) ? [...hidden].filter(key => key !== bar.key) : [...hidden, bar.key] })}><Icon name={hidden.has(bar.key) ? 'eye-off' : 'eye'} size={16} /></button>
            </div>
          ))}
        </div>
      ) : null}
    </Popover>
  );
}

// 범위: "사용자 지정 범위 설정" and two fields 최소 – 최대 (the first focused).
function RangeEditor({ chart, onChange }: { chart: ChartConfig; onChange: (range: ChartConfig['range']) => void }) {
  const [min, setMin] = useState(chart.range?.min != null ? String(chart.range.min) : '');
  const [max, setMax] = useState(chart.range?.max != null ? String(chart.range.max) : '');
  const commit = () => {
    const a = min.trim() === '' ? null : Number(min), b = max.trim() === '' ? null : Number(max);
    if ((a == null || Number.isFinite(a)) && (b == null || Number.isFinite(b))) onChange(a == null && b == null ? null : { min: a, max: b });
  };
  return (
    <div className="chart-range">
      <div className="chart-card-label">{t("사용자 지정 범위 설정")}</div>
      <div className="chart-range-inputs">
        <input className="text-input" autoFocus inputMode="decimal" value={min} placeholder={t("최소")} aria-label={t("최소")} onChange={event => setMin(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') commit(); }} />
        <span>–</span>
        <input className="text-input" inputMode="decimal" value={max} placeholder={t("최대")} aria-label={t("최대")} onChange={event => setMax(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') commit(); }} />
      </div>
    </div>
  );
}

// 기준선: without lines, a centred note and a blue "+ 기준선 추가"; each line is a grey card
// (값 + 휴지통 · 레이블 · 스타일 실선/점선 · 색 swatch grid), then a white "+ 기준선 추가". New lines start at
// the largest value, dashed, rgb(85,83,78).
function ReferenceEditor({ chart, max, onChange }: { chart: ChartConfig; max: number; onChange: (lines: NonNullable<ChartConfig['referenceLines']>) => void }) {
  const [lines, setLines] = useState(chart.referenceLines ?? []);
  const [menu, setMenu] = useState<{ kind: 'style' | 'color'; index: number; anchor: HTMLElement } | null>(null);
  const save = (next: typeof lines) => { setLines(next); onChange(next); };
  const add = () => save([...lines, { id: newId(), value: max, label: '', dashed: true, color: referenceColors[0][1] }]);
  if (!lines.length) return (
    <div className="chart-reference-empty">
      <p>{t("기준선을 추가해 목표를 정하고 기준값을 표시하면 차트를 더 알기 쉽게 볼 수 있습니다.")}</p>
      <button type="button" className="blue-button" onClick={add}><Icon name="plus" size={14} />{t("기준선 추가")}</button>
    </div>
  );
  return (
    <div className="chart-reference-editor">
      {lines.map((line, index) => (
        <div key={line.id} className="chart-reference-card">
          <div className="chart-card-label"><span>{t("값")}</span><button type="button" className="icon-button tiny" aria-label={t("기준선 삭제")} onClick={() => save(lines.filter((_, i) => i !== index))}><Icon name="trash" size={14} /></button></div>
          <input className="text-input" inputMode="decimal" aria-label={t("값")} defaultValue={String(line.value)} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== line.value) save(lines.map((item, i) => i === index ? { ...item, value } : item)); }} />
          <div className="chart-card-label"><span>{t("레이블")}</span></div>
          <input className="text-input" aria-label={t("레이블")} placeholder={t("레이블")} defaultValue={line.label ?? ''} onBlur={event => { if (event.target.value !== (line.label ?? '')) save(lines.map((item, i) => i === index ? { ...item, label: event.target.value } : item)); }} />
          <button type="button" className="chart-card-row" onClick={event => setMenu({ kind: 'style', index, anchor: event.currentTarget })}><span>{t("스타일")}</span><span className="chart-card-value">{line.dashed === false ? t("실선") : t("점선")}</span><Icon name="chevron-right" size={14} /></button>
          <button type="button" className="chart-card-row" onClick={event => setMenu({ kind: 'color', index, anchor: event.currentTarget })}><span>{t("색")}</span><span className="chart-card-value"><span className="chart-ref-swatch" style={{ background: line.color ?? referenceColors[0][1] }} />{referenceColors.find(([, color]) => color === (line.color ?? referenceColors[0][1]))?.[0] ?? t("검은색")}</span><Icon name="chevron-right" size={14} /></button>
        </div>
      ))}
      <button type="button" className="chart-reference-add" onClick={add}><Icon name="plus" size={14} />{t("기준선 추가")}</button>
      {menu?.kind === 'style' ? <Menu anchor={menu.anchor} placement="below-start" width={180} onClose={() => setMenu(null)} entries={[{ label: t("실선"), checked: lines[menu.index]?.dashed === false, onSelect: () => save(lines.map((item, i) => i === menu.index ? { ...item, dashed: false } : item)) }, { label: t("점선"), checked: lines[menu.index]?.dashed !== false, onSelect: () => save(lines.map((item, i) => i === menu.index ? { ...item, dashed: true } : item)) }]} /> : null}
      {menu?.kind === 'color' ? (
        <Popover anchor={menu.anchor} placement="below-start" offset={2} onClose={() => setMenu(null)} className="chart-swatch-grid" label={t("색")}>
          {referenceColors.map(([name, color]) => (
            <button type="button" key={color} className={`chart-swatch-cell${(lines[menu.index]?.color ?? referenceColors[0][1]) === color ? ' active' : ''}`} title={name} aria-label={name} style={{ background: color }} onClick={() => { save(lines.map((item, i) => i === menu.index ? { ...item, color } : item)); setMenu(null); }}>{(lines[menu.index]?.color ?? referenceColors[0][1]) === color ? <Icon name="check" size={12} /> : null}</button>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}

// 기타 스타일 옵션 (a card over the row): 높이 · 격자선 · 축 레이블 · [곡선 · 그라데이션 영역 · 범례] ·
// 데이터 레이블 · 캡션 (with a text box when on). A donut: 높이 · 값 표시 · 값 레이블 표시 (+ field "합계") ·
// 음수 값 숨기기 · 범례 · 데이터 레이블 (값 (%)) · 캡션.
function StyleOptions({ chart, set }: { chart: ChartConfig; set: (patch: Partial<ChartConfig>) => unknown }) {
  const type = chart.type ?? 'bar';
  const [menu, setMenu] = useState<{ kind: 'height' | 'grid' | 'axis' | 'legend' | 'labels'; anchor: HTMLElement } | null>(null);
  const item = (kind: 'height' | 'grid' | 'axis' | 'legend' | 'labels', icon: string, label: string, value: string) => (
    <button type="button" className={`chart-card-row${menu?.kind === kind ? ' open' : ''}`} onClick={event => setMenu({ kind, anchor: event.currentTarget })}><Icon name={icon} size={18} /><span>{label}</span><span className="chart-card-value">{value}</span><Icon name="chevron-right" size={14} /></button>
  );
  const toggle = (icon: string, label: string, checked: boolean, onChange: (value: boolean) => void) => (
    <label className="chart-card-row"><Icon name={icon} size={18} /><span>{label}</span><span className="spacer" /><Switch checked={checked} onChange={onChange} label={label} /></label>
  );
  const entries = (): MenuEntry[] => {
    if (menu?.kind === 'height') return (Object.keys(heightLabels) as Array<keyof typeof heightLabels>).map(height => ({ label: heightLabels[height], checked: (chart.height ?? 'medium') === height, onSelect: () => set({ height }) }));
    if (menu?.kind === 'grid') return (Object.keys(gridLabels) as Array<keyof typeof gridLabels>).map(grid => ({ label: gridLabels[grid], checked: (chart.gridLines ?? 'horizontal') === grid, onSelect: () => set({ gridLines: grid }) }));
    if (menu?.kind === 'axis') return (Object.keys(axisLabelNames) as Array<keyof typeof axisLabelNames>).map(axis => ({ label: axisLabelNames[axis], checked: (chart.axisLabels ?? 'none') === axis, onSelect: () => set({ axisLabels: axis }) }));
    if (menu?.kind === 'legend') return ([['bottom', t("아래")], ['none', t("숨기기")]] as const).map(([id, name]) => ({ label: name, checked: id === 'none' ? chart.showLegend === false : chart.showLegend !== false, onSelect: () => set({ showLegend: id !== 'none' }) }));
    return ([['both', t("값 (%)")], ['value', t("값")], ['percent', '%']] as const).map(([id, name]) => ({ label: name, checked: (chart.dataLabelFormat ?? 'both') === id, onSelect: () => set({ dataLabelFormat: id, dataLabels: true }) })).concat([{ label: t("없음"), checked: chart.dataLabels === false, onSelect: () => set({ dataLabels: false }) } as never]);
  };
  return (
    <div className="chart-style-options">
      {item('height', 'range', t("높이"), heightLabels[chart.height ?? 'medium'])}
      {type === 'donut' ? (
        <>
          {toggle('digits', t("값 표시"), chart.showValue !== false, value => set({ showValue: value }))}
          {toggle('caption', t("값 레이블 표시"), chart.showValueLabel !== false, value => set({ showValueLabel: value }))}
          {chart.showValueLabel !== false ? <TextField value={chart.valueLabel ?? ''} placeholder={t("합계")} onChange={valueLabel => set({ valueLabel: valueLabel || null })} /> : null}
          {toggle('minus-hash', t("음수 값 숨기기"), !!chart.hideNegative, value => set({ hideNegative: value }))}
          {chart.palette && !['auto', 'colorful'].includes(chart.palette) ? toggle('palette', t("값에 따라 색"), !!chart.colorByValue, value => set({ colorByValue: value })) : null}
          {item('legend', 'list', t("범례"), chart.showLegend === false ? t("숨기기") : t("아래"))}
          {item('labels', 'digits', t("데이터 레이블"), chart.dataLabels === false ? t("없음") : chart.dataLabelFormat === 'value' ? t("값") : chart.dataLabelFormat === 'percent' ? '%' : t("값 (%)"))}
        </>
      ) : (
        <>
          {(type === 'bar' || type === 'hbar') && chart.palette && !['auto', 'colorful'].includes(chart.palette) ? toggle('palette', t("값에 따라 색"), !!chart.colorByValue, value => set({ colorByValue: value })) : null}
          {item('grid', 'grid-dots', t("격자선"), gridLabels[chart.gridLines ?? 'horizontal'])}
          {item('axis', 'axis-labels', t("축 레이블"), axisLabelNames[chart.axisLabels ?? 'none'])}
          {type === 'line' ? toggle('curve', t("곡선"), !!chart.smooth, value => set({ smooth: value })) : null}
          {type === 'line' ? toggle('area', t("그라데이션 영역"), chart.gradient !== false, value => set({ gradient: value })) : null}
          {type === 'line' ? toggle('list', t("범례"), chart.showLegend !== false, value => set({ showLegend: value })) : null}
          {toggle('digits', t("데이터 레이블"), chart.dataLabels !== false, value => set({ dataLabels: value }))}
        </>
      )}
      {toggle('caption', t("캡션"), !!chart.showCaption, value => set({ showCaption: value }))}
      {chart.showCaption ? <TextField multiline value={chart.caption ?? ''} placeholder={t("캡션")} onChange={caption => set({ caption: caption || null })} /> : null}
      {menu ? <Menu anchor={menu.anchor} placement="right-start" width={180} entries={entries()} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

// 색 for a number: "동적 색" switch over a 5×2 grid of coloured "A" chips.
function NumberColors({ chart, set }: { chart: ChartConfig; set: (patch: Partial<ChartConfig>) => unknown }) {
  return (
    <div className="chart-number-colors">
      <label className="chart-card-row"><span>{t("동적 색")}</span><span className="spacer" /><Switch checked={!!chart.dynamicColor} onChange={value => set({ dynamicColor: value })} label={t("동적 색")} /></label>
      <div className="chart-a-grid">
        {numberColorNames.map(([id, name]) => <button type="button" key={id} title={name} aria-label={name} className={`chart-a-chip color-${id}${(chart.color ?? 'default') === id ? ' active' : ''}`} onClick={() => set({ color: id })}>A</button>)}
      </div>
    </div>
  );
}
