import { t } from '../i18n';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChartBar, ChartConfig, PropertyEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { useSettings } from '../data/settings';
import { aggregateLabels } from '../data/format';
import type { ViewProps } from './TableView';
import { ChartDrill } from './ChartDrill';
import { areaColor, axisTicks, countLike, formatMeasure, groupColor, groupLabel, heightPx, lineColor, measureLabel, shownBars, textWidth } from './chartModel';

// Chart view (SVG, 400 high at "중간"):
// - bars: plot from y 20 to height−37, x from (widest value label + 18) to width−10; the value axis always has
//   four steps (see axisTicks); value labels end 8 left of the plot; dashed 1/3 grid lines rgb(230,229,227)
//   with a solid line at the bottom; 16-wide bars (top corners r2, white .5 edge) centred in equal bands;
//   value labels 12px #7d7a75 seven above the bar; category labels 12px #7d7a75 under the plot (turned −45° when
//   they do not fit). Axis titles (축 레이블) and the caption each take 30 more from the plot.
// - horizontal bars: categories at the left (labels end 8 before the plot), bars 16 high, values 4 after the end.
// - line: #2383e2 1.25 line, filled r4 points, area from rgb(94,159,232) .1 to 0, a legend under it.
// - donut: ring r = min(w/2−34, (h−46)/4), inner 85 %; the total 43.6/600 and "합계" 12px in the middle;
//   "N (x%)" 10px #a19e99 outside with rgb(230,229,227) leader lines; a legend under it.
// - number: the title 20/600 and the number 75/600, centred.
// Pointing shows a card (dot · group · value / "클릭해서 데이터 보기"); clicking opens the group's rows.
const GRID = 'rgb(230, 229, 227)';
const TOP = 20, BOTTOM = 37, RIGHT = 10, TITLE = 30, CAPTION = 29, LEGEND = 42;

type Tip = { x: number; y: number; color: string; label: string; value: string } | null;

export function ChartView({ result, view, sourceId }: ViewProps) {
  useSettings(); // bar colours depend on the theme
  const config: ChartConfig | null | undefined = view?.config.chart;
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<Tip>(null);
  const [drill, setDrill] = useState<ChartBar | null>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => setWidth(Math.floor(box.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  if (!config) return <div className="chart-view" ref={boxRef}><p className="chart-empty">{t("보기 설정에서 차트에 표시할 데이터를 고르세요.")}</p></div>;
  const type = config.type ?? 'bar';
  const groupProperty = result.properties.find(property => property.id === config.groupBy);
  const valueProperty = result.properties.find(property => property.id === config.valuePropertyId);
  const stackProperty = result.properties.find(property => property.id === config.stackBy);
  const bars = shownBars(result.presentation.bars ?? [], config);
  const height = heightPx[config.height ?? 'medium'];
  const format = (value: unknown) => formatMeasure(value, config, valueProperty);
  const label = (group: unknown) => groupLabel(groupProperty, group, config);
  const hover = (event: React.MouseEvent, color: string, text: string, value: string) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (box) setTip({ x: event.clientX - box.left, y: event.clientY - box.top, color, label: text, value });
  };
  const common: ChartProps = { bars, config, width, height, groupProperty, stackProperty, format, label, open: bar => { setTip(null); setDrill(bar); }, hover, leave: () => setTip(null), valueProperty };
  let body: ReactNode;
  if (!width) body = null;
  else if (type === 'number') body = <NumberChart config={config} total={result.presentation.total} valueProperty={valueProperty} height={height} format={format} />;
  else if (!bars.length) body = <div className="chart-nodata" style={{ height }}>{t("표시할 데이터가 없습니다")}</div>;
  else if (type === 'donut') body = <DonutChart {...common} total={result.presentation.total} />;
  else if (type === 'hbar') body = <HorizontalBars {...common} />;
  else body = <VerticalChart {...common} line={type === 'line'} />;
  return (
    <div className={`chart-view chart-type-${type}`} ref={boxRef}>
      {body}
      {tip ? (
        <div className="chart-tooltip" style={{ left: Math.min(tip.x + 14, Math.max(0, width - 220)), top: Math.max(0, tip.y - 90) }}>
          <div className="chart-tooltip-row"><span className="chart-tooltip-dot" style={{ background: tip.color }} /><span className="chart-tooltip-label">{tip.label}</span><span className="chart-tooltip-value">{tip.value}</span></div>
          <div className="chart-tooltip-hint"><Icon name="list" size={14} /><span>{t("클릭해서 데이터 보기")}</span></div>
        </div>
      ) : null}
      {drill ? <ChartDrill bar={drill} title={label(drill.group)} view={view} sourceId={sourceId} property={groupProperty} onClose={() => setDrill(null)} /> : null}
    </div>
  );
}

interface ChartProps {
  bars: ChartBar[]; config: ChartConfig; width: number; height: number; groupProperty?: PropertyEntity; stackProperty?: PropertyEntity; valueProperty?: PropertyEntity;
  format: (value: unknown) => string; label: (group: unknown) => string; open: (bar: ChartBar) => void;
  hover: (event: React.MouseEvent, color: string, label: string, value: string) => void; leave: () => void;
}

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const xTitle = (config: ChartConfig) => config.axisLabels === 'x' || config.axisLabels === 'both';
const yTitle = (config: ChartConfig) => config.axisLabels === 'y' || config.axisLabels === 'both';

function seriesOf(bars: ChartBar[]) {
  const keys = new Map<string, unknown>();
  for (const bar of bars) for (const stack of bar.stacks ?? []) if (!keys.has(stack.key)) keys.set(stack.key, stack.group);
  return [...keys.entries()].map(([key, group], index) => ({ key, group, index }));
}

// "값에 따라 색" (color by value): with a one-hue palette, bigger values are drawn darker.
function valueShader(config: ChartConfig, bars: ChartBar[]): (value: number) => number | undefined {
  if (!config.colorByValue || !config.palette || ['auto', 'colorful'].includes(config.palette)) return () => undefined;
  const max = Math.max(0, ...bars.map(bar => typeof bar.value === 'number' ? Math.abs(bar.value) : 0));
  return value => (max ? 0.3 + 0.7 * Math.min(1, Math.abs(value) / max) : 1);
}

function truncate(text: string, max: number) {
  if (textWidth(text) <= max) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`) > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// The legend under a line, a donut or stacked bars (8px dots or a 15px line, 12px #7d7a75 labels,
// 16 apart, centred, wrapping into rows 19 high). Drawn in the SVG so a saved picture keeps it.
function Legend({ items, line, width, top }: { items: Array<{ key: string; label: string; color: string }>; line?: boolean; width: number; top: number }) {
  const sized = items.map(item => ({ ...item, w: (line ? 15 : 8) + 6 + textWidth(item.label) }));
  const rows: Array<typeof sized> = [[]];
  let used = 0;
  for (const item of sized) { if (rows[rows.length - 1].length && used + 16 + item.w > width - 24) { rows.push([]); used = 0; } used += (rows[rows.length - 1].length ? 16 : 0) + item.w; rows[rows.length - 1].push(item); }
  const start = top + (LEGEND - rows.length * 19) / 2 + 9.5;
  return (
    <g className="chart-legend">
      {rows.map((row, r) => {
        let x = (width - row.reduce((sum, item, i) => sum + item.w + (i ? 16 : 0), 0)) / 2;
        return row.map(item => {
          const at = x; x += item.w + 16;
          const y = start + r * 19;
          return (
            <g key={item.key}>
              {line ? <line x1={at} x2={at + 15} y1={y} y2={y} stroke={item.color} strokeWidth={1.25} /> : <circle cx={at + 4} cy={y} r={4} fill={item.color} />}
              <text x={at + (line ? 21 : 14)} y={y} dy="0.35em" className="chart-axis-text">{item.label}</text>
            </g>
          );
        });
      })}
    </g>
  );
}

function domain(config: ChartConfig, values: number[]) {
  const ticks = axisTicks(config.range?.max ?? Math.max(0, ...values), config.range?.min ?? Math.min(0, ...values), countLike(config) && !config.decimals);
  const lo = config.range?.min ?? ticks[0], hi = config.range?.max ?? ticks[ticks.length - 1];
  return { ticks: ticks.filter(tick => tick >= lo - 1e-9 && tick <= hi + 1e-9), lo, hi: hi === lo ? lo + 1 : hi };
}

function References({ config, x1, x2, y, vertical = false, top = 0, bottom = 0 }: { config: ChartConfig; x1: number; x2: number; y: (value: number) => number; vertical?: boolean; top?: number; bottom?: number }) {
  return <>{(config.referenceLines ?? []).map(reference => {
    const color = reference.color ?? 'rgb(85, 83, 78)', dash = reference.dashed === false ? undefined : '4 3';
    const at = y(reference.value);
    return vertical
      ? <g key={reference.id}><line x1={at} x2={at} y1={top} y2={bottom} stroke={color} strokeDasharray={dash} />{reference.label ? <text x={at + 4} y={top + 12} className="chart-axis-text">{reference.label}</text> : null}</g>
      : <g key={reference.id}><line x1={x1} x2={x2} y1={at} y2={at} stroke={color} strokeDasharray={dash} />{reference.label ? <text x={x1 + 10} y={at - 3.5} className="chart-axis-text">{reference.label}</text> : null}</g>;
  })}</>;
}

function Caption({ config, x, y }: { config: ChartConfig; x: number; y: number }) {
  return config.showCaption && config.caption ? <text x={x} y={y} textAnchor="middle" className="chart-axis-text">{config.caption}</text> : null;
}

function VerticalChart({ bars, config, width, height, groupProperty, stackProperty, valueProperty, format, label, open, hover, leave, line }: ChartProps & { line: boolean }) {
  const shade = valueShader(config, bars);
  const series = !line && config.stackBy ? seriesOf(bars) : [];
  const legend = line ? config.showLegend !== false : series.length > 0;
  const totals = bars.map(bar => series.length ? (bar.stacks ?? []).reduce((sum, stack) => sum + num(stack.value), 0) : num(bar.value));
  const { ticks, lo, hi } = domain(config, [...totals, ...(config.referenceLines ?? []).map(reference => reference.value)]);
  const tickLabels = ticks.map(tick => format(tick));
  const left = Math.ceil(Math.max(...tickLabels.map(text => textWidth(text)), 0) + 18) + (yTitle(config) ? TITLE : 0);
  const right = width - RIGHT;
  const band = (right - left) / bars.length;
  const names = bars.map(bar => label(bar.group));
  const rotate = names.some(name => textWidth(name) > band - 6);
  const labelRoom = rotate ? Math.min(90, Math.max(...names.map(name => textWidth(name))) * 0.72 + 10) - 21 : 0;
  const bottom = height - BOTTOM - labelRoom - (xTitle(config) ? TITLE : 0) - (config.showCaption && config.caption ? CAPTION : 0) - (legend ? LEGEND : 0);
  const y = (value: number) => bottom - ((Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo)) * (bottom - TOP);
  const cx = (index: number) => left + band * (index + 0.5);
  const grid = config.gridLines ?? 'horizontal';
  const stroke = lineColor(config.palette);
  const points = bars.map((bar, index) => ({ x: cx(index), y: y(num(bar.value)) }));
  const path = line ? (config.smooth ? smoothPath(points) : points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join('')) : '';
  const gradientId = `chart-area-${width}-${bars.length}-${height}`;
  const zero = y(Math.max(0, lo));
  return (
    <svg className="chart-svg" width={width} height={height} role="img" aria-label={t("차트")}>
      {line && config.gradient !== false ? <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={areaColor(config.palette)} stopOpacity={0.1} /><stop offset="1" stopColor={areaColor(config.palette)} stopOpacity={0} /></linearGradient></defs> : null}
      {grid === 'horizontal' || grid === 'both' ? ticks.map(tick => <line key={`h${tick}`} x1={left} x2={right} y1={Math.round(y(tick)) + 0.5} y2={Math.round(y(tick)) + 0.5} stroke={GRID} strokeDasharray="1 3" />) : null}
      {grid === 'vertical' || grid === 'both' ? bars.map((bar, index) => <line key={`v${bar.key}`} x1={Math.round(cx(index)) + 0.5} x2={Math.round(cx(index)) + 0.5} y1={TOP} y2={bottom} stroke={GRID} strokeDasharray="1 3" />) : null}
      <line x1={left} x2={right} y1={Math.round(zero) + 0.5} y2={Math.round(zero) + 0.5} stroke={GRID} />
      {ticks.map((tick, index) => <text key={`t${tick}`} x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end" className="chart-axis-text">{tickLabels[index]}</text>)}
      {line ? (
        <g>
          {config.gradient !== false ? <path d={`${path}L${points[points.length - 1].x},${zero}L${points[0].x},${zero}Z`} fill={`url(#${gradientId})`} /> : null}
          <path d={path} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
          {bars.map((bar, index) => (
            <g key={bar.key} className="chart-point" onMouseMove={event => hover(event, stroke, names[index], format(bar.value))} onMouseLeave={leave} onClick={() => open(bar)}>
              <circle cx={points[index].x} cy={points[index].y} r={11} fill="transparent" />
              <circle cx={points[index].x} cy={points[index].y} r={4} fill={stroke} />
              {config.dataLabels !== false && typeof bar.value === 'number' ? <text x={points[index].x} y={points[index].y - 10} textAnchor="middle" className="chart-value-text">{format(bar.value)}</text> : null}
            </g>
          ))}
        </g>
      ) : bars.map((bar, index) => {
        const x = cx(index) - 8;
        if (series.length) {
          let base = 0;
          return (
            <g key={bar.key} className="chart-bar" onClick={() => open(bar)}>
              {series.map(item => {
                const stack = bar.stacks?.find(entry => entry.key === item.key);
                const value = num(stack?.value);
                if (!value) return null;
                const y0 = y(base), y1 = y(base + value);
                base += value;
                const color = groupColor(config.palette, stackProperty, item.group, item.index, true);
                return <rect key={item.key} x={x} y={y1} width={16} height={Math.max(0, y0 - y1)} fill={color} stroke="#fff" strokeWidth={0.5} onMouseMove={event => hover(event, color, `${names[index]} · ${groupLabel(stackProperty, item.group)}`, format(value))} onMouseLeave={leave} />;
              })}
              {config.dataLabels !== false ? <text x={cx(index)} y={y(totals[index]) - 7} textAnchor="middle" className="chart-value-text">{format(totals[index])}</text> : null}
            </g>
          );
        }
        const value = num(bar.value);
        const y1 = y(value);
        const color = groupColor(config.palette, groupProperty, bar.group, index);
        return (
          <g key={bar.key} className="chart-bar" onMouseMove={event => hover(event, color, names[index], format(bar.value))} onMouseLeave={leave} onClick={() => open(bar)}>
            <rect x={cx(index) - band / 2} y={TOP} width={band} height={bottom - TOP} fill="transparent" />
            <path d={barPath(x, Math.min(zero, y1), 16, Math.abs(zero - y1), value < 0)} fill={color} fillOpacity={shade(value)} stroke="#fff" strokeWidth={0.5} />
            {config.dataLabels !== false && typeof bar.value === 'number' ? <text x={cx(index)} y={(value < 0 ? y1 + 17 : y1 - 7)} textAnchor="middle" className="chart-value-text">{format(bar.value)}</text> : null}
            {bar.errors.length || (bar.value && typeof bar.value === 'object') ? <text x={cx(index)} y={bottom - 6} textAnchor="middle" className="chart-error-text">{t("계산 불가")}</text> : null}
          </g>
        );
      })}
      <References config={config} x1={left} x2={right} y={y} />
      {names.map((name, index) => rotate
        ? <text key={`x${bars[index].key}`} x={cx(index)} y={bottom + 12} textAnchor="end" transform={`rotate(-45 ${cx(index)} ${bottom + 12})`} className="chart-axis-text">{truncate(name, 110)}</text>
        : <text key={`x${bars[index].key}`} x={cx(index)} y={bottom + 15.5} dy="0.35em" textAnchor="middle" className="chart-axis-text">{name}</text>)}
      {xTitle(config) ? <text x={(left + right) / 2} y={bottom + 37 + labelRoom + 14} textAnchor="middle" className="chart-axis-title">{groupProperty?.name ?? ''}</text> : null}
      {yTitle(config) ? <text x={20} y={(TOP + bottom) / 2} textAnchor="middle" dy="0.35em" transform={`rotate(270 20 ${(TOP + bottom) / 2})`} className="chart-axis-title">{measureLabel(config, valueProperty).replace(/ \(.*\)$/, '')}</text> : null}
      <Caption config={config} x={width / 2} y={height - (legend ? LEGEND : 0) - 17} />
      {legend ? (line
        ? <Legend line width={width} top={height - LEGEND} items={[{ key: 'line', label: groupProperty?.name ?? measureLabel(config, valueProperty), color: stroke }]} />
        : <Legend width={width} top={height - LEGEND} items={series.map(item => ({ key: item.key, label: groupLabel(stackProperty, item.group), color: groupColor(config.palette, stackProperty, item.group, item.index, true) }))} />) : null}
    </svg>
  );
}

function barPath(x: number, y: number, w: number, h: number, down: boolean) {
  const r = Math.min(2, w / 2, h);
  if (h <= 0) return '';
  return down
    ? `M${x},${y}h${w}v${h - r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - 2 * r)}a${r},${r} 0 0 1 ${-r},${-r}Z`
    : `M${x},${y + h}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}Z`;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join('');
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
    d += `C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  return d;
}

function HorizontalBars({ bars, config, width, height, groupProperty, valueProperty, format, label, open, hover, leave }: ChartProps) {
  const shade = valueShader(config, bars);
  const names = bars.map(bar => label(bar.group));
  const left = Math.min(Math.ceil(Math.max(...names.map(name => textWidth(name)))) + 18, Math.round(width * 0.35)) + (yTitle(config) ? TITLE : 0);
  const right = width - RIGHT, bottom = height - BOTTOM - (xTitle(config) ? TITLE : 0) - (config.showCaption && config.caption ? CAPTION : 0);
  const { ticks, lo, hi } = domain(config, [...bars.map(bar => num(bar.value)), ...(config.referenceLines ?? []).map(reference => reference.value)]);
  const x = (value: number) => left + ((Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo)) * (right - left);
  const band = (bottom - TOP) / bars.length;
  const cy = (index: number) => TOP + band * (index + 0.5);
  const grid = config.gridLines ?? 'horizontal';
  const zero = x(Math.max(0, lo));
  return (
    <svg className="chart-svg" width={width} height={height} role="img" aria-label={t("차트")}>
      {grid === 'horizontal' || grid === 'both' ? Array.from({ length: bars.length + 1 }, (_, i) => <line key={`h${i}`} x1={left} x2={right} y1={Math.round(TOP + band * i) + 0.5} y2={Math.round(TOP + band * i) + 0.5} stroke={GRID} strokeDasharray="1 3" />) : null}
      {grid === 'vertical' || grid === 'both' ? ticks.map(tick => <line key={`v${tick}`} x1={Math.round(x(tick)) + 0.5} x2={Math.round(x(tick)) + 0.5} y1={TOP} y2={bottom} stroke={GRID} strokeDasharray="1 3" />) : null}
      <line x1={left} x2={right} y1={Math.round(bottom) + 0.5} y2={Math.round(bottom) + 0.5} stroke={GRID} />
      {ticks.map(tick => <text key={`t${tick}`} x={x(tick)} y={bottom + 15.5} dy="0.35em" textAnchor="middle" className="chart-axis-text">{format(tick)}</text>)}
      {bars.map((bar, index) => {
        const value = num(bar.value), x1 = x(value);
        const color = groupColor(config.palette, groupProperty, bar.group, index);
        return (
          <g key={bar.key} className="chart-bar" onMouseMove={event => hover(event, color, names[index], format(bar.value))} onMouseLeave={leave} onClick={() => open(bar)}>
            <rect x={0} y={cy(index) - band / 2} width={width} height={band} fill="transparent" />
            <text x={left - 8} y={cy(index)} dy="0.35em" textAnchor="end" className="chart-axis-text">{truncate(names[index], left - 12 - (yTitle(config) ? TITLE : 0))}</text>
            <path d={hbarPath(Math.min(zero, x1), cy(index) - 8, Math.abs(x1 - zero), 16)} fill={color} fillOpacity={shade(value)} stroke="#fff" strokeWidth={0.5} />
            {config.dataLabels !== false && typeof bar.value === 'number' ? <text x={Math.max(zero, x1) + 4} y={cy(index)} dy="0.35em" className="chart-value-text">{format(bar.value)}</text> : null}
          </g>
        );
      })}
      <References config={config} x1={left} x2={right} y={x} vertical top={TOP} bottom={bottom} />
      {xTitle(config) ? <text x={(left + right) / 2} y={bottom + 51} textAnchor="middle" className="chart-axis-title">{measureLabel(config, valueProperty).replace(/ \(.*\)$/, '')}</text> : null}
      {yTitle(config) ? <text x={20} y={(TOP + bottom) / 2} textAnchor="middle" dy="0.35em" transform={`rotate(270 20 ${(TOP + bottom) / 2})`} className="chart-axis-title">{groupProperty?.name ?? ''}</text> : null}
      <Caption config={config} x={width / 2} y={height - 17} />
    </svg>
  );
}

function hbarPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(2, h / 2, w);
  if (w <= 0) return '';
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}Z`;
}

function DonutChart({ bars, config, width, height, groupProperty, format, label, open, hover, leave, total }: ChartProps & { total: unknown }) {
  const shade = valueShader(config, bars);
  const legend = config.showLegend !== false;
  const values = bars.map(bar => Math.max(0, num(bar.value)));
  const sum = values.reduce((a, b) => a + b, 0);
  const radius = Math.max(30, Math.min(width / 2 - 34, (height - 46) / 4));
  const inner = radius * 0.85;
  const cx = width / 2, cy = height / 2 - (config.showCaption && config.caption ? 14 : 0);
  let angle = -Math.PI / 2;
  const slices = bars.map((bar, index) => {
    const sweep = sum ? (values[index] / sum) * Math.PI * 2 : 0;
    const start = angle; angle += sweep;
    return { bar, index, start, end: angle, sweep, color: groupColor(config.palette, groupProperty, bar.group, index, true) };
  });
  const point = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  const arc = (start: number, end: number) => {
    if (end - start >= Math.PI * 2 - 1e-6) return `M${point(radius, start)}A${radius},${radius} 0 1 1 ${point(radius, start + Math.PI)}A${radius},${radius} 0 1 1 ${point(radius, start)}M${point(inner, start)}A${inner},${inner} 0 1 0 ${point(inner, start + Math.PI)}A${inner},${inner} 0 1 0 ${point(inner, start)}Z`;
    const large = end - start > Math.PI ? 1 : 0;
    return `M${point(radius, start)}A${radius},${radius} 0 ${large} 1 ${point(radius, end)}L${point(inner, end)}A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`;
  };
  const dataLabel = (value: unknown, share: number) => {
    const percent = `${Math.round(share * 100)}%`;
    return config.dataLabelFormat === 'value' ? format(value) : config.dataLabelFormat === 'percent' ? percent : `${format(value)} (${percent})`;
  };
  const centre = typeof total === 'number' ? total : sum;
  return (
    <svg className="chart-svg" width={width} height={height} role="img" aria-label={t("차트")}>
      {slices.map(slice => slice.sweep > 0 ? (
        <path key={slice.bar.key} className="chart-slice" d={arc(slice.start, slice.end)} fill={slice.color} fillOpacity={shade(values[slice.index])} fillRule="evenodd" stroke="#fff" strokeWidth={1}
          onMouseMove={event => hover(event, slice.color, label(slice.bar.group), `${format(slice.bar.value)} (${Math.round((values[slice.index] / sum) * 100)}%)`)} onMouseLeave={leave} onClick={() => open(slice.bar)} />
      ) : null)}
      {config.dataLabels !== false ? slices.map(slice => {
        if (!slice.sweep) return null;
        const mid = (slice.start + slice.end) / 2, cos = Math.cos(mid), sin = Math.sin(mid);
        const elbow = { x: cx + (radius + 18) * cos, y: cy + (radius + 18) * sin };
        const end = { x: elbow.x + (cos >= 0 ? 10 : -10), y: elbow.y };
        return (
          <g key={`l${slice.bar.key}`}>
            <path d={`M${point(radius + 2, mid)}L${elbow.x},${elbow.y}L${end.x},${end.y}`} fill="none" stroke={GRID} />
            <text x={end.x + (cos >= 0 ? 3 : -3)} y={end.y} dy="0.35em" textAnchor={cos >= 0 ? 'start' : 'end'} className="chart-slice-label">{dataLabel(slice.bar.value, values[slice.index] / sum)}</text>
          </g>
        );
      }) : null}
      {config.showValue !== false ? <text x={cx} y={cy - (config.showValueLabel !== false ? 6 : 0)} dy="0.35em" textAnchor="middle" className="chart-donut-number">{format(centre)}</text> : null}
      {config.showValueLabel !== false ? <text x={cx} y={cy + (config.showValue !== false ? 30 : 0)} dy="0.35em" textAnchor="middle" className="chart-axis-text">{config.valueLabel || t("합계")}</text> : null}
      <Caption config={config} x={width / 2} y={height - (legend ? LEGEND : 0) - 17} />
      {legend ? <Legend width={width} top={height - LEGEND} items={slices.map(slice => ({ key: slice.bar.key, label: label(slice.bar.group), color: slice.color }))} /> : null}
    </svg>
  );
}

const numberColors: Record<string, string> = { default: 'var(--text)', gray: 'rgb(120, 119, 116)', brown: 'rgb(159, 107, 83)', yellow: 'rgb(203, 145, 47)', orange: 'rgb(217, 115, 13)', green: 'rgb(68, 131, 97)', blue: 'rgb(51, 126, 169)', purple: 'rgb(144, 101, 176)', pink: 'rgb(193, 76, 138)', red: 'rgb(212, 76, 71)' };
function NumberChart({ config, total, valueProperty, height, format }: { config: ChartConfig; total: unknown; valueProperty?: PropertyEntity; height: number; format: (value: unknown) => string }) {
  const title = config.title || (aggregateLabels[config.aggregation] ?? aggregateLabels.count);
  const error = total && typeof total === 'object' && 'error' in (total as object);
  const color = config.dynamicColor && typeof total === 'number' ? (total > 0 ? numberColors.green : total < 0 ? numberColors.red : numberColors.default) : numberColors[config.color ?? 'default'];
  return (
    <div className="chart-number" style={{ height }} aria-label={valueProperty?.name}>
      {config.showTitle !== false ? <div className="chart-number-title">{title}</div> : null}
      <div className="chart-number-value" style={{ color }}>{error ? <span className="chart-error-text">{t("계산 불가")}</span> : format(total)}</div>
    </div>
  );
}
