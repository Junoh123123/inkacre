import type { Filter } from '../data/types';

// The library's filters run in the browser over a few computed values per page: text (페이지 이름),
// dates as { start } (생성 · 최종 편집 · 최종 열람 일시) and people as ['me'] (만든 사람 · 최종 편집자 —
// one person in this app). Same rules as the database filters: a rule without a value hides nothing.
export type LibraryValue = string | { start: string } | string[] | null;

const pad = (value: number) => String(value).padStart(2, '0');
export const localDay = (iso: string) => { const date = new Date(iso); return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : iso.slice(0, 10); };
const dayOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const isEmpty = (value: LibraryValue | undefined) => value == null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !value.start);
const text = (value: unknown) => String(value ?? '').normalize('NFKC').toLocaleLowerCase();

function relativeRange(rule: { period: string; amount?: number; unit?: string; weekStart?: number }, now = new Date()): [string, string] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end = new Date(start);
  const period = rule.period;
  const shift = (date: Date, count: number) => { if (rule.unit === 'day') date.setDate(date.getDate() + count); else if (rule.unit === 'week') date.setDate(date.getDate() + 7 * count); else if (rule.unit === 'month') date.setMonth(date.getMonth() + count); else date.setFullYear(date.getFullYear() + count); };
  if (period === 'this') {
    if (rule.unit === 'week') start.setDate(start.getDate() - (rule.weekStart === 1 ? (start.getDay() + 6) % 7 : start.getDay()));
    else if (rule.unit === 'month') start.setDate(1);
    else if (rule.unit === 'year') start.setMonth(0, 1);
    end = new Date(start); shift(end, 1);
  } else if (period === 'past') { end.setDate(end.getDate() + 1); shift(start, -Math.max(1, Number(rule.amount ?? 1))); }
  else if (period === 'next') { shift(end, Math.max(1, Number(rule.amount ?? 1))); end.setDate(end.getDate() + 1); }
  else if (period.includes('week')) {
    const monday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - monday + (period === 'last_week' ? -7 : period === 'next_week' ? 7 : 0));
    end = new Date(start); end.setDate(end.getDate() + 7);
  } else if (period.includes('month')) {
    start.setDate(1); start.setMonth(start.getMonth() + (period === 'last_month' ? -1 : period === 'next_month' ? 1 : 0));
    end = new Date(start); end.setMonth(end.getMonth() + 1);
  } else if (period.endsWith('days')) {
    const amount = Math.max(1, Number(rule.amount ?? 7));
    if (period === 'past_days') start.setDate(start.getDate() - amount + 1);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (period === 'next_days' ? amount : 1));
  } else {
    start.setDate(start.getDate() + (period === 'yesterday' ? -1 : period === 'tomorrow' ? 1 : 0));
    end = new Date(start); end.setDate(end.getDate() + 1);
  }
  return [dayOf(start), dayOf(end)];
}

export function matchesLibraryFilter(filter: Filter | null | undefined, values: Record<string, LibraryValue>): boolean {
  if (!filter) return true;
  if ('all' in filter) return filter.all.every(child => matchesLibraryFilter(child, values));
  if ('any' in filter) return filter.any.some(child => matchesLibraryFilter(child, values));
  if ('not' in filter) return !matchesLibraryFilter(filter.not, values);
  const { propertyId, op, value: expected } = filter as { propertyId: string; op: string; value?: unknown };
  const current = values[propertyId];
  if (!['empty', 'not_empty'].includes(op) && (expected === undefined || expected === null || expected === '' || (Array.isArray(expected) && !expected.length))) return true;
  if (op === 'empty') return isEmpty(current);
  if (op === 'not_empty') return !isEmpty(current);
  const date = current && typeof current === 'object' && !Array.isArray(current) ? localDay(current.start) : null;
  if (date !== null || (current === null && ['eq', 'before', 'after', 'lte', 'gte', 'within', 'relative'].includes(op))) {
    if (!date) return false;
    if (op === 'relative') { const [from, to] = relativeRange(expected as { period: string; amount?: number }); return date >= from && date < to; }
    if (op === 'within') { const range = expected as { start?: string; end?: string }; if (!range.start && !range.end) return true; return (!range.start || date >= range.start.slice(0, 10)) && (!range.end || date <= range.end.slice(0, 10)); }
    const want = String(expected).slice(0, 10);
    if (op === 'eq') return date === want;
    if (op === 'neq') return date !== want;
    if (op === 'before') return date < want;
    if (op === 'after') return date > want;
    if (op === 'lte') return date <= want;
    if (op === 'gte') return date >= want;
    return false;
  }
  if (Array.isArray(current)) {
    const wanted = Array.isArray(expected) ? expected.map(String) : [String(expected)];
    const has = current.some(item => wanted.includes(item));
    if (op === 'contains' || op === 'eq' || op === 'in') return has;
    if (op === 'not_contains' || op === 'neq' || op === 'not_in') return !has;
    return false;
  }
  const have = text(current), want = text(expected);
  switch (op) {
    case 'eq': return have === want;
    case 'neq': return have !== want;
    case 'contains': return have.includes(want);
    case 'not_contains': return !have.includes(want);
    case 'starts_with': return have.startsWith(want);
    case 'ends_with': return have.endsWith(want);
  }
  return false;
}

export function compareLibraryValues(a: LibraryValue | undefined, b: LibraryValue | undefined): number {
  const empty = (value: LibraryValue | undefined) => isEmpty(value);
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  const scalar = (value: LibraryValue | undefined) => Array.isArray(value) ? value.join(',') : typeof value === 'object' && value ? value.start : String(value ?? '');
  const x = scalar(a), y = scalar(b);
  if (typeof a === 'object' && !Array.isArray(a)) return Date.parse(x) - Date.parse(y);
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
}
