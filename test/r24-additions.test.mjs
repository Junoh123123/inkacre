import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilter } from '../src/query.mjs';
import { relativeDateRange } from '../src/relative-date.mjs';
import { filterSchema } from '../src/contracts.mjs';

// r24: date rules — 당일 또는 이전/이후 by day, 기간 내 (from–to),
// 종료일 instead of the start, and "오늘 기준 상대 날짜" as 이번 · 지난 N · 다음 N + 일/주/월/년.
const now = '2026-10-26T03:00:00Z'; // a Monday

test('relative "this / past N / next N" ranges, with the week starting Sunday or Monday', () => {
  assert.deepEqual([relativeDateRange({ period: 'this', unit: 'week', weekStart: 0, timeZone: 'Asia/Tokyo' }, now).from, relativeDateRange({ period: 'this', unit: 'week', weekStart: 0, timeZone: 'Asia/Tokyo' }, now).to], ['2026-10-25', '2026-11-01']);
  assert.equal(relativeDateRange({ period: 'this', unit: 'week', timeZone: 'Asia/Tokyo' }, now).from, '2026-10-26');
  assert.deepEqual((r => [r.from, r.to])(relativeDateRange({ period: 'past', unit: 'week', amount: 1, timeZone: 'Asia/Tokyo' }, now)), ['2026-10-19', '2026-10-27']);
  assert.deepEqual((r => [r.from, r.to])(relativeDateRange({ period: 'next', unit: 'day', amount: 3, timeZone: 'Asia/Tokyo' }, now)), ['2026-10-26', '2026-10-30']);
  assert.deepEqual((r => [r.from, r.to])(relativeDateRange({ period: 'this', unit: 'month', timeZone: 'Asia/Tokyo' }, now)), ['2026-10-01', '2026-11-01']);
  assert.deepEqual((r => [r.from, r.to])(relativeDateRange({ period: 'this', unit: 'year', timeZone: 'Asia/Tokyo' }, now)), ['2026-01-01', '2027-01-01']);
  assert.throws(() => relativeDateRange({ period: 'past', unit: 'week', timeZone: 'UTC' }, now), { code: 'FILTER_RELATIVE' });
  assert.throws(() => relativeDateRange({ period: 'this', unit: 'decade', timeZone: 'UTC' }, now), { code: 'FILTER_RELATIVE' });
  const values = { d: { start: '2026-10-20' } };
  assert.equal(matchesFilter({ propertyId: 'd', op: 'relative', value: { period: 'past', unit: 'week', amount: 1, timeZone: 'Asia/Tokyo' } }, values, now), true);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'relative', value: { period: 'this', unit: 'week', weekStart: 0, timeZone: 'Asia/Tokyo' } }, values, now), false);
});

test('day rules (on or before / after), within a range and the end date', () => {
  const values = { d: { start: '2026-10-20T15:00:00+09:00', end: '2026-10-24' } };
  assert.equal(matchesFilter({ propertyId: 'd', op: 'lte', value: '2026-10-20' }, values), true);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'before', value: '2026-10-20' }, values), false);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'gte', value: '2026-10-21' }, values), false);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'gte', value: '2026-10-21', end: true }, values), true);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'eq', value: '2026-10-24', end: true }, values), true);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'within', value: { start: '2026-10-19', end: '2026-10-21' } }, values), true);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'within', value: { start: '2026-10-21', end: '2026-10-30' } }, values), false);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'within', value: { start: '2026-10-21' } }, values), false);
  assert.equal(matchesFilter({ propertyId: 'd', op: 'within', value: {} }, values), true, 'no range yet: nothing hidden');
  assert.equal(matchesFilter({ propertyId: 'd', op: 'within', value: { start: '2026-10-01' } }, { d: null }), false);
  assert.doesNotThrow(() => filterSchema.parse({ all: [{ propertyId: 'd', op: 'within', value: { start: '2026-10-01', end: '2026-10-31' }, end: true }] }));
  assert.throws(() => filterSchema.parse({ propertyId: 'd', op: 'during' }));
});
