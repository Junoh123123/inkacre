// @ts-ignore shared helpers (also used by the engine tests)
import { intlLocale, language, t, translateServerMessage } from '../i18n';
import { formatNumber as legacyFormatNumber } from '../../../web/view-layout.mjs';
import { workspace } from './store';
import { deviceTimeZone, displayTimeZone } from './settings';
import type { BlockType, NumberFormat, PropertyEntity, PropertyType, SelectOption, ViewType } from './types';

// Currencies use the narrow symbol (¥12,000, $5, €3, ₩1,000).
export function formatNumber(value: number, format?: NumberFormat): string {
  if (format?.style !== 'currency') return legacyFormatNumber(value, format, intlLocale);
  try {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency: format.currency ?? 'KRW', currencyDisplay: 'narrowSymbol', useGrouping: format.grouping ?? true,
      ...(format.digits === undefined ? {} : { minimumFractionDigits: format.digits, maximumFractionDigits: format.digits }) }).format(value);
  } catch { return legacyFormatNumber(value, format, intlLocale); }
}

// Korean product terms.
export const blockLabels: Record<BlockType, string> = {
  paragraph: t("텍스트"), heading1: t("제목1"), heading2: t("제목2"), heading3: t("제목3"), heading4: t("제목4"), bullet: t("글머리 기호 목록"), numbered: t("번호 매기기 목록"),
  todo: t("할 일 목록"), toggle: t("토글 목록"), quote: t("인용"), code: t("코드"), divider: t("구분선"), callout: t("콜아웃"), bookmark: t("웹 북마크"),
  image: t("이미지"), file: t("파일"), synced: t("동기화 블록"), synced_reference: t("동기화 참조"), button: t("버튼"), table: t("표"), columns: t("열"),
  column: t("열"), toc: t("목차"), math: t("수학 공식 블록"), video: t("동영상"), audio: t("오디오"), breadcrumb: t("이동 경로"), tabs: t("탭"), tab: t("탭"), html: t("block|HTML"), pdf: t("PDF"), embed: t("임베드"), link_to_page: t("페이지 링크"),
};

export const propertyLabels: Record<PropertyType, string> = {
  title: t("제목"), text: t("텍스트"), number: t("숫자"), checkbox: t("체크박스"), select: t("선택"), multi_select: t("다중 선택"), status: t("상태"), date: t("날짜"),
  url: 'URL', email: t("이메일"), phone: t("전화번호"), person: t("사람"), files: t("파일과 미디어"), relation: t("관계형"), formula: t("수식"), rollup: t("롤업"),
  place: t("위치"), created_time: t("생성 일시"), last_edited_time: t("최종 편집 일시"), created_by: t("생성자"), last_edited_by: t("최종 편집자"),
  unique_id: 'ID', button: t("버튼"),
};

export const viewLabels: Record<ViewType, string> = {
  table: t("표"), board: t("보드"), list: t("리스트"), gallery: t("갤러리"), calendar: t("캘린더"), timeline: t("타임라인"), feed: t("피드"), chart: t("차트"),
  map: t("지도"), form: t("양식"), dashboard: t("대시보드"),
};

export const aggregateLabels: Record<string, string> = {
  count: t("모두 세기"), count_nonempty: t("비어 있지 않은 값 세기"), count_empty: t("빈 값 세기"), sum: t("합계"), average: t("평균"), min: t("최소"), max: t("최대"),
  median: t("중앙값"), range: t("범위"), percent_empty: t("비어 있음 비율"), percent_not_empty: t("비어 있지 않음 비율"), checked: t("체크 표시됨"), unchecked: t("체크 표시 안 됨"),
  percent_checked: t("체크 표시 비율"), percent_unchecked: t("체크 표시 안 됨 비율"), earliest_date: t("가장 이른 날짜"), latest_date: t("가장 늦은 날짜"),
  date_range: t("날짜 범위"), values: t("값 표시"), unique: t("고유 값 세기"),
};

export const colorNames: Record<string, string> = {
  default: t("기본"), gray: t("회색"), brown: t("갈색"), orange: t("주황색"), yellow: t("노란색"), green: t("초록색"), blue: t("파란색"), purple: t("보라색"), pink: t("분홍색"), red: t("빨간색"),
};
// A block colour's name in the colour menus, whole (languages name text and background colours differently).
const textColorLabels: Record<string, string> = {
  default: t("기본 텍스트"), gray: t("회색 텍스트"), brown: t("갈색 텍스트"), orange: t("주황색 텍스트"), yellow: t("노란색 텍스트"), green: t("초록색 텍스트"), blue: t("파란색 텍스트"), purple: t("보라색 텍스트"), pink: t("분홍색 텍스트"), red: t("빨간색 텍스트"),
};
const backgroundColorLabels: Record<string, string> = {
  default: t("기본 배경"), gray: t("회색 배경"), brown: t("갈색 배경"), orange: t("주황색 배경"), yellow: t("노란색 배경"), green: t("초록색 배경"), blue: t("파란색 배경"), purple: t("보라색 배경"), pink: t("분홍색 배경"), red: t("빨간색 배경"),
};
export const colorLabel = (kind: 'color' | 'background', color: string) => (kind === 'color' ? textColorLabels : backgroundColorLabels)[color] ?? color;
export const tagColors = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export function optionColor(property: PropertyEntity | undefined, option: SelectOption | undefined): string {
  if (option?.color && tagColors.includes(option.color)) return option.color;
  if (property?.type !== 'status') return 'default';
  const key = statusGroupKey(option?.group);
  return key === 'complete' ? 'green' : key === 'in_progress' ? 'blue' : 'gray';
}

// Status groups shown as sections in the status picker / board headers. New options store a language-neutral key
// (todo · in_progress · complete); older ones may hold a group name in any language, which is recognised too.
export type StatusGroupKey = 'todo' | 'in_progress' | 'complete';
export const statusGroupKeys: StatusGroupKey[] = ['todo', 'in_progress', 'complete'];
export function statusGroupKey(group: string | null | undefined): StatusGroupKey | null {
  const key = `${group ?? ''}`.trim().toLowerCase();
  if (!key) return 'todo';
  if (/complete|done|완료|完了|已完成|完成|termin|abgeschlossen|erledigt|conclu|complet|hecho|fait/.test(key)) return 'complete';
  if (/progress|doing|진행|進行|进行|進行中|curso|cours|bearbeitung|andamento/.test(key)) return 'in_progress';
  if (/todo|to[ -_]?do|할 일|대기|시작|未着手|やること|待办|待辦|未开始|未開始|pendiente|à faire|zu erledigen|a fazer|not started/.test(key)) return 'todo';
  return null;
}
// A status shown as a checkbox: ticked in the complete group; ticking picks the first
// complete option, unticking the first to-do one.
export function statusChecked(property: PropertyEntity, value: unknown): boolean {
  const option = property.options?.find(item => item.id === value);
  return !!option && statusGroupKey(option.group) === 'complete';
}
export function statusToggleValue(property: PropertyEntity, value: unknown): string | null {
  const options = property.options ?? [];
  const target = statusChecked(property, value) ? 'todo' : 'complete';
  return options.find(option => statusGroupKey(option.group) === target)?.id ?? null;
}
export function statusGroupName(key: StatusGroupKey): string {
  return key === 'complete' ? t("status-group|완료") : key === 'in_progress' ? t("status-group|진행 중") : t("status-group|할 일");
}
export function statusGroupLabel(option: SelectOption): string {
  const key = statusGroupKey(option.group);
  return key ? statusGroupName(key) : `${option.group ?? ''}`.trim();
}

// Dates and times in the interface language's own format (ko "2026년 10월 23일 오후 5:18", en "October 23, 2026
// 5:18 PM", ja "2026年10月23日 17:18").
const dateFormat = new Intl.DateTimeFormat(intlLocale, { year: 'numeric', month: 'long', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(intlLocale, { hour: 'numeric', minute: '2-digit' });
const monthDayFormat = new Intl.DateTimeFormat(intlLocale, { month: 'long', day: 'numeric' });
export const formatDay = (date: Date) => dateFormat.format(date);
export const formatTime = (date: Date) => timeFormat.format(date);
export const formatMonthDay = (date: Date) => monthDayFormat.format(date);
const yearFormat = new Intl.DateTimeFormat(intlLocale, { year: 'numeric' });
const yearMonthFormat = new Intl.DateTimeFormat(intlLocale, { year: 'numeric', month: 'long' });
const monthFormat = new Intl.DateTimeFormat(intlLocale, { month: 'long' });
const hourFormat = new Intl.DateTimeFormat(intlLocale, { hour: 'numeric' });
export const formatYear = (date: Date) => yearFormat.format(date);
export const formatYearMonth = (date: Date) => yearMonthFormat.format(date);
export const formatMonth = (date: Date) => monthFormat.format(date);
/** An hour of the day: ko "오후 3시", en "3 PM". */
export const formatHour = (hour: number) => hourFormat.format(new Date(2023, 0, 1, hour));
/** This year: "10월 23일"; another year: "2026년 10월 23일". */
export const formatShortDate = (date: Date) => date.getFullYear() === new Date().getFullYear() ? formatMonthDay(date) : formatDay(date);

// An instant as the wall time in the chosen time zone (설정 › 시간대), as a local Date to format.
export function inDisplayZone(date: Date, zone = displayTimeZone()): Date {
  if (zone === deviceTimeZone() || !Number.isFinite(date.getTime())) return date;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
    return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  } catch { return date; }
}
export function displayDate(text: string | undefined | null, { withTime = true } = {}): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text ?? '');
  if (!match) return text ?? '';
  const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!match[4] || !withTime) return formatDay(local);
  // Stored date-times may be UTC instants; show them in the chosen (or this device's) time zone.
  if (/Z|[+-]\d\d:\d\d$/.test(text ?? '')) { const date = inDisplayZone(new Date(text!)); return `${formatDay(date)} ${formatTime(date)}`; }
  return `${formatDay(local)} ${formatTime(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])))}`;
}

// "오늘 오후 2:04" / "어제 오후 2:04", otherwise the full date — as in the page menu's footer.
export function menuDate(iso: string | undefined | null): string {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return displayDate(iso);
  const date = new Date(at), now = new Date();
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86400000);
  const time = formatTime(date);
  if (days === 0) return t("오늘 {0}", [time]);
  if (days === 1) return t("어제 {0}", [time]);
  return displayDate(iso);
}

// A date property's own display (속성 › 날짜 형식 · 시간 형식): full, short, month/day/year, day/month/year,
// year/month/day or relative (오늘 · 내일 · 어제); time in 12 or 24 hours, or hidden. Without settings: as before.
export interface DateDisplay { dateFormat?: string | null; timeFormat?: string | null; timeZone?: string }
const pad2 = (n: number) => String(n).padStart(2, '0');
const shortDateFormat = new Intl.DateTimeFormat(intlLocale, { year: 'numeric', month: 'numeric', day: 'numeric' });
function dayWith(date: Date, format: string | null | undefined): string {
  switch (format) {
    case 'short': return shortDateFormat.format(date);
    case 'mdy': return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${date.getFullYear()}`;
    case 'dmy': return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
    case 'ymd': return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
    case 'relative': {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const day = new Date(date); day.setHours(0, 0, 0, 0);
      const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
      return diff === 0 ? t("오늘") : diff === 1 ? t("내일") : diff === -1 ? t("어제") : formatDay(date);
    }
    default: return formatDay(date);
  }
}
export function displayDateWith(text: string | undefined | null, display: DateDisplay | undefined): string {
  if (!display?.dateFormat && !display?.timeFormat && !display?.timeZone) return displayDate(text);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text ?? '');
  if (!match) return text ?? '';
  const timed = !!match[4];
  let date = timed && /Z|[+-]\d\d:\d\d$/.test(text ?? '') ? new Date(text!) : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
  // The wall time in the value's own zone (or the chosen one), as a local date to format.
  if (timed && /Z|[+-]\d\d:\d\d$/.test(text ?? '')) date = inDisplayZone(date, display.timeZone ?? displayTimeZone());
  const day = dayWith(date, display.dateFormat);
  if (!timed || display.timeFormat === 'hidden') return day;
  const time = display.timeFormat ? new Intl.DateTimeFormat(intlLocale, { hour: 'numeric', minute: '2-digit', hour12: display.timeFormat === '12' }).format(date) : formatTime(date);
  return `${day} ${time}`;
}
export function displayDateRange(value: { start?: string; end?: string } | null | undefined, display?: DateDisplay): string {
  if (!value?.start) return '';
  return `${displayDateWith(value.start, display)}${value.end && value.end !== value.start ? ` → ${displayDateWith(value.end, display)}` : ''}`;
}

export function displayDateTime(iso: string): string {
  return displayDate(iso);
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return t("방금");
  if (minutes < 60) return t("{0}분 전", [minutes]);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{0}시간 전", [hours]);
  const days = Math.round(hours / 24);
  if (days < 7) return t("{0}일 전", [days]);
  return formatMonthDay(new Date(iso));
}

export function formatValue(value: unknown, property?: PropertyEntity): string {
  if (value && typeof value === 'object' && (value as { type?: string }).type === 'formatted_text') return ((value as { richText: Array<{ text: string }> }).richText ?? []).map(run => run.text).join('');
  if (value && typeof value === 'object' && (value as { error?: { code: string; message: string } }).error) {
    const error = (value as { error: { code: string; message: string } }).error;
    return `${error.code}: ${translateServerMessage(error.message)}`;
  }
  if (value == null) return '';
  if (typeof value === 'number' && property?.numberFormat) return formatNumber(value, property.numberFormat);
  if (property?.type === 'relation') return (Array.isArray(value) ? value : [value]).map(id => workspace.title(workspace.get(String(id))) || t("삭제된 항목")).join(', ');
  if (property && ['select', 'status', 'multi_select'].includes(property.type)) return (Array.isArray(value) ? value : [value]).map(id => property.options?.find(option => option.id === id)?.name ?? String(id)).join(', ');
  if (property?.type === 'date' || (typeof value === 'object' && value && 'start' in (value as object))) return displayDateRange(value as { start?: string; end?: string });
  if (property?.type === 'place') return (value as { name?: string }).name ?? '';
  if (property?.type === 'unique_id' && property.idPrefix) return `${property.idPrefix}-${String(value)}`;
  if (property && ['created_time', 'last_edited_time'].includes(property.type) && typeof value === 'string') return displayDate(value);
  if (typeof value === 'boolean') return value ? t("예") : t("아니요");
  if (Array.isArray(value)) return value.map(item => formatValue(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatAggregate(value: unknown, operation: string, property?: PropertyEntity): string {
  if (value && typeof value === 'object' && (value as { error?: unknown }).error) return formatValue(value, property);
  if (typeof value === 'number' && operation.startsWith('percent_')) return formatNumber(value, { style: 'percent', digits: 1 });
  if (['count', 'count_nonempty', 'count_empty', 'checked', 'unchecked'].includes(operation)) return String(value ?? 0);
  if (operation === 'unique' && Array.isArray(value)) return String(value.length);
  if (operation === 'values' && Array.isArray(value)) return value.map(item => formatValue(item, property)).filter(Boolean).join(', ');
  if (['earliest_date', 'latest_date', 'date_range'].includes(operation) && value && typeof value === 'object') return displayDateRange(value as { start?: string; end?: string });
  if (typeof value === 'number' && !property?.numberFormat) return Number.isInteger(value) ? String(value) : formatNumber(value, { style: 'number', digits: 2 });
  return formatValue(value, property);
}

export function isEmptyValue(value: unknown) {
  return value == null || value === '' || (Array.isArray(value) && !value.length);
}

export function plainText(runs: Array<{ text: string }> | undefined) {
  return (runs ?? []).map(run => run.text).join('');
}

export function wordCount(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { words, characters: text.replace(/\s/g, '').length };
}

/** A new data source's title column is named in the interface language (the engine's own default is Korean). */
export const titleNameField = (): { titleName?: string } => (language === 'ko' ? {} : { titleName: t("이름") });

// The letter in a person's round avatar: the first character of the name, and for the local user a
// one-character stand-in for "나" in each language.
export const avatarLetter = (name: string) => name === t("나") ? t("avatar|나") : (Array.from(name)[0] ?? '');
