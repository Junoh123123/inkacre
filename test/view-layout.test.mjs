import test from 'node:test';
import assert from 'node:assert/strict';
import { displayDay, monthDays, shiftMonth, onCalendarDay, timelineLayout, chartScale, projectPlace, moveMap } from '../web/view-layout.mjs';

test('calendar spans month/year/leap boundaries and projects zoned instants without shifting floating dates', () => {
  assert.equal(displayDay('2026-10-21T23:30:00Z', 'Asia/Tokyo'), '2026-10-22');
  assert.equal(displayDay('2026-10-21', 'America/Los_Angeles'), '2026-10-21');
  assert.equal(displayDay('2026-10-21T23:30:00', 'Asia/Tokyo'), '2026-10-21');
  assert.ok(monthDays('2024-02').includes('2024-02-29')); assert.equal(monthDays('2024-02').length, 42);
  assert.equal(shiftMonth('2026-12', 1), '2027-01'); assert.equal(shiftMonth('2026-01', -1), '2025-12');
  const range = { start: '2026-10-31', end: '2026-11-02' };
  assert.equal(onCalendarDay(range, '2026-11-01'), true); assert.equal(onCalendarDay(range, '2026-11-03'), false);
});

test('timeline uses actual inclusive date ranges and stable day widths across DST boundaries', () => {
  const layout = timelineLayout([{ rowId: 'one', start: '2026-10-31', end: '2026-11-02' }, { rowId: 'two', start: '2026-11-03' }]);
  assert.equal(layout.from, '2026-10-31'); assert.equal(layout.to, '2026-11-03');
  assert.equal(layout.rows[0].start, 0); assert.equal(layout.rows[0].width, .75);
  assert.equal(layout.rows[1].start, .75); assert.equal(layout.rows[1].width, .25);
  assert.deepEqual(timelineLayout([]).rows, []);
});

test('charts separate negative, zero, empty and typed errors instead of drawing invalid zero bars', () => {
  const scale = chartScale([-10, 0, 20, null, { error: { code: 'CHART_TYPE' } }]);
  assert.equal(scale.zero, 1 / 3); assert.equal(scale.bars[0].start, 0); assert.equal(scale.bars[0].width, 1 / 3);
  assert.equal(scale.bars[1].width, 0); assert.equal(scale.bars[2].start, 1 / 3);
  assert.equal(scale.bars[3], null); assert.equal(scale.bars[4], null);
});

test('coordinate map handles 0, missing coordinates, zoom, pan and longitude wrapping', () => {
  assert.deepEqual(projectPlace({ longitude: 0, latitude: 0 }), { x: .5, y: .5 });
  assert.equal(projectPlace({ longitude: 0 }), null);
  const zoom = moveMap({ longitude: 170, latitude: 0, span: 360 }, 0, 0, .25);
  assert.ok(projectPlace({ longitude: -175, latitude: 0 }, zoom));
  assert.equal(projectPlace({ longitude: 0, latitude: 0 }, zoom), null);
  const moved = moveMap(zoom, 30, 100); assert.equal(moved.longitude, -160); assert.equal(moved.latitude, 67.5);
});
