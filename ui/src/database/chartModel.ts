import { intlLocale, t } from '../i18n';
import type { ChartBar, ChartConfig, ChartPalette, PropertyEntity } from '../data/types';
import { aggregateLabels, formatMonthDay, formatValue, formatYear, formatYearMonth, optionColor, statusGroupKeys, statusGroupName, type StatusGroupKey } from '../data/format';

// Chart colours. "자동" follows the option colours (blue rgb(94,159,232),
// pink (223,132,168), green (114,188,143); the empty group (241,241,239), a grey status option (199,198,196)).
// The palettes (색상 menu) are one base colour each, shown — and used for series — at 100/70/50/30/15 %.
const base: Record<string, [number, number, number]> = {
  gray: [98, 97, 93], blue: [94, 159, 232], yellow: [234, 194, 107], green: [114, 188, 143], purple: [191, 142, 218],
  teal: [79, 185, 201], orange: [222, 146, 85], pink: [223, 132, 168], red: [233, 115, 102], brown: [186, 139, 112],
};
const optionTint: Record<string, [number, number, number]> = { ...base, gray: [199, 198, 196], default: [241, 241, 239] };
// Dark theme: the accent colours the bars use keep their values, except red (233,115,102 → 229,100,88). The empty
// group and the grey option take the dark pair of the same light grey used elsewhere (241,241,239 → 85,85,83), the
// grey palette the light text grey's (98,97,93 → 188,186,182).
const darkPairs: Record<string, [number, number, number]> = {
  '233,115,102': [229, 100, 88], '241,241,239': [85, 85, 83], '199,198,196': [118, 117, 113], '98,97,93': [188, 186, 182],
};
const isDark = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
const rgb = (light: number[], alpha = 1) => {
  const color = (isDark() && darkPairs[light.join(',')]) || light;
  return alpha >= 1 ? `rgb(${color.join(', ')})` : `rgba(${color.join(', ')}, ${alpha})`;
};
// The empty group is a translucent white in the dark theme (rgba(255,255,255,.1)).
export const emptyColor = () => isDark() ? 'rgba(255, 255, 255, 0.1)' : rgb([241, 241, 239]);
const alphas = [1, 0.7, 0.5, 0.3, 0.15];
const colorfulOrder = ['blue', 'yellow', 'green', 'purple', 'orange', 'teal', 'pink', 'red', 'gray'];
export const paletteOrder: ChartPalette[] = ['auto', 'colorful', 'gray', 'blue', 'yellow', 'green', 'purple', 'teal', 'orange', 'pink', 'red'];
export const paletteLabels: Record<ChartPalette, string> = {
  auto: t("자동"), colorful: t("다채로운 색"), gray: t("회색"), blue: t("파란색"), yellow: t("노란색"), green: t("초록색"), purple: t("보라색"), teal: t("청록색"), orange: t("주황색"), pink: t("분홍색"), red: t("빨간색"),
};
/** The five swatches a palette row shows (none for 자동). */
export function paletteSwatches(palette: ChartPalette): string[] {
  if (palette === 'auto') return [];
  if (palette === 'colorful') return colorfulOrder.slice(0, 5).map(hue => rgb(base[hue]));
  return alphas.map(alpha => rgb(base[palette], alpha));
}

/** The colour of a group (or of the n-th stacked series): option colours under 자동, else the palette. */
export function groupColor(palette: ChartPalette | undefined, property: PropertyEntity | undefined, group: unknown, index: number, series = false): string {
  const empty = group == null || group === '' || (Array.isArray(group) && !group.length);
  const mode = palette ?? 'auto';
  if (mode === 'auto') {
    if (empty) return emptyColor();
    const option = property?.options?.find(item => item.id === group);
    if (option) return rgb(optionTint[optionColor(property, option)] ?? base.blue);
    if (property?.type === 'status' && typeof group === 'string') return rgb(group === 'complete' ? base.green : group === 'in_progress' ? base.blue : optionTint.gray);
    return series ? rgb(base[colorfulOrder[index % colorfulOrder.length]]) : rgb(base.blue);
  }
  if (mode === 'colorful') return rgb(base[colorfulOrder[index % colorfulOrder.length]]);
  return series ? rgb(base[mode], alphas[index % alphas.length]) : rgb(base[mode]);
}
/** The line chart's line (blue under 자동). */
export const lineColor = (palette: ChartPalette | undefined) => !palette || palette === 'auto' ? '#2383e2' : rgb(base[palette === 'colorful' ? 'blue' : palette]);
export const areaColor = (palette: ChartPalette | undefined) => rgb(base[!palette || palette === 'auto' || palette === 'colorful' ? 'blue' : palette]);

const relativeLabels: Record<string, string> = { today: t("오늘"), yesterday: t("어제"), tomorrow: t("내일"), past_7: t("지난 7일"), next_7: t("다음 7일"), past_30: t("지난 30일"), next_30: t("다음 30일") };
export function groupLabel(property: PropertyEntity | undefined, group: unknown, config?: ChartConfig | null): string {
  if (group == null || group === '' || (Array.isArray(group) && !group.length)) return property ? t("{0} 없음", [property.name]) : t("없음");
  if (property?.type === 'status' && config?.statusGrouping === 'group' && typeof group === 'string') return statusGroupKeys.includes(group as StatusGroupKey) ? statusGroupName(group as StatusGroupKey) : group;
  if (config?.dateGrouping && typeof group === 'string') {
    if (relativeLabels[group]) return relativeLabels[group];
    const [y, m, d] = group.split('-');
    if (config.dateGrouping === 'year' || !m) return formatYear(new Date(Number(y), 0, 1));
    if (!d) return formatYearMonth(new Date(Number(y), Number(m) - 1, 1));
    return config.dateGrouping === 'week' ? t("{0} 주", [formatMonthDay(new Date(Number(y), Number(m) - 1, Number(d)))]) : formatMonthDay(new Date(Number(y), Number(m) - 1, Number(d)));
  }
  const option = property?.options?.find(item => item.id === group);
  if (option) return option.name;
  if (typeof group === 'boolean') return group ? t("체크됨") : t("체크 안 됨");
  return formatValue(group, property) || String(group);
}

const countLike = (config: ChartConfig) => ['count', 'count_nonempty', 'count_empty', 'unique'].includes(config.aggregation);
/** Chart numbers: no thousands separators, compact from 10,000 (1.2만), the
 *  property's currency symbol, and the chosen number of decimals. */
export function formatMeasure(value: unknown, config: ChartConfig, valueProperty?: PropertyEntity): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (config.aggregation.startsWith('percent_') || config.numberFormat === 'percent') return `${Math.round(value * (config.aggregation.startsWith('percent_') ? 100 : 1) * 10) / 10}%`;
  const format = valueProperty?.numberFormat && !countLike(config) ? valueProperty.numberFormat : undefined;
  const digits = config.decimals ?? format?.digits;
  const options: Intl.NumberFormatOptions = Math.abs(value) >= 10000
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { useGrouping: false, maximumFractionDigits: digits ?? 2, ...(digits != null ? { minimumFractionDigits: digits } : {}) };
  if (format?.style === 'currency') Object.assign(options, { style: 'currency', currency: format.currency ?? 'KRW', currencyDisplay: 'narrowSymbol' });
  try { return new Intl.NumberFormat(intlLocale, options).format(value); } catch { return String(value); }
}

export function measureLabel(config: ChartConfig, valueProperty?: PropertyEntity): string {
  if (config.aggregation === 'count' || !valueProperty) return t("개수");
  return `${valueProperty.name} (${aggregateLabels[config.aggregation] ?? ''})`;
}

/** Bars actually drawn: hidden groups and (optionally) zero values left out. */
export function shownBars(bars: ChartBar[], config: ChartConfig): ChartBar[] {
  return bars.filter(bar => !bar.hidden && !(config.excludeZero && (bar.value === 0 || bar.value == null)) && !(config.hideNegative && typeof bar.value === 'number' && bar.value < 0));
}

/** The value axis: always four steps from 0, the step the smallest of 1·2·4·5 × 10ⁿ that reaches
 *  the largest value (counts step at least 1) — a largest count of 2 gives 0…4, 12,000 gives 0…16,000. */
export function axisTicks(maxValue: number, minValue = 0, integer = true): number[] {
  const lo = Math.min(minValue, 0), hi = Math.max(maxValue, 0);
  const raw = ((hi - lo) || 1) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 4, 5, 10].map(m => m * power).find(candidate => candidate >= raw - 1e-9) ?? power * 10;
  if (integer) step = Math.max(1, Math.ceil(step));
  const start = Math.floor(lo / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let value = start; ticks.length < 5 || value <= hi + 1e-9; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  return ticks;
}

const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
export function textWidth(text: string, font = '12px ui-sans-serif, -apple-system, "Segoe UI", sans-serif'): number {
  const context = canvas?.getContext('2d');
  if (!context) return text.length * 7;
  context.font = font;
  return context.measureText(text).width;
}

export const heightPx = { small: 300, medium: 400, large: 600, xlarge: 800 } as const;
export const heightLabels = { small: t("작게"), medium: t("중간"), large: t("크게"), xlarge: t("매우 크게") } as const;
export const chartTypeLabels = { bar: t("세로 막대형"), hbar: t("가로 막대형"), line: t("꺾은선형"), donut: t("도넛형"), number: t("숫자") } as const;
export { countLike };
