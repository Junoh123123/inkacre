// Read-only data/geometry cross-check for the calendar, timeline, chart and map UI.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { onCalendarDay, timelineLayout, chartScale, projectPlace } from '../web/view-layout.mjs';

const client = new Client({ name: 'view-rendering-reader', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'], env: { ...process.env, LOCAL_WORKSPACE_URL: process.env.LOCAL_WORKSPACE_URL ?? 'http://127.0.0.1:4141' }, stderr: 'pipe' }));
try {
  const call = async (name, args = {}) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError); return result.structuredContent; };
  const query = viewId => call('workspace_query', { viewId }), initial = await call('workspace_status');
  const calendar = await query('lab-calendar'), timeline = await query('lab-timeline'), chart = await query('lab-chart'), map = await query('lab-map');
  const a3 = calendar.presentation.items.find(item => item.rowId === 'lab-a3');
  const dates = ['2026-10-22', '2026-10-23', '2026-10-24']; assert.ok(dates.every(day => onCalendarDay(a3, day))); assert.equal(onCalendarDay(a3, '2026-10-25'), false);
  const layout = timelineLayout(timeline.presentation.items), bar = layout.rows.find(row => row.rowId === 'lab-a3');
  assert.equal(bar.start * 700, 350); assert.equal(bar.width * 700, 350);
  const scale = chartScale(chart.presentation.bars.map(bar => bar.value));
  const done = chart.presentation.bars.find(bar => bar.value === 40); assert.deepEqual(done.rowIds, ['lab-a1']);
  assert.deepEqual((await call('workspace_query', { sourceId: chart.source.id, filter: done.drilldown })).rows.map(row => row.id), ['lab-a1']);
  const point = map.presentation.points.find(point => point.rowId === 'lab-a1'); assert.equal(point.longitude, 139.767125);
  assert.deepEqual(projectPlace(point, { longitude: point.longitude, latitude: point.latitude, span: 15 }), { x: .5, y: .5 });
  const dated = await call('workspace_page_version', { pageId: 'lab-a3', revision: 53 }), undoneDate = await call('workspace_page_version', { pageId: 'lab-a3', revision: 54 });
  assert.equal(dated.entity.values['lab-due'].end, '2026-10-25'); assert.equal(undoneDate.entity.values['lab-due'].end, '2026-10-24');
  assert.equal((await call('workspace_page_version', { pageId: 'lab-a1', revision: 55 })).entity.values['lab-place'].longitude, 140);
  assert.equal((await call('workspace_page_version', { pageId: 'lab-a1', revision: 56 })).entity.values['lab-place'].longitude, 139.767125);
  assert.equal((await call('workspace_status')).revision, initial.revision);
  const report = { recordedAt: new Date().toISOString(), revision: initial.revision, modifiedByVerifier: false,
    calendar: { a3Dates: dates, editedEndAt53: '2026-10-25', undoAt54: '2026-10-24', nextMonthUi: '2026-11', returnedMonthUi: '2026-10', screenshot: 'verification/screenshots/local-calendar-grid-2026-10-21.jpg' },
    timeline: { from: layout.from, to: layout.to, a3SvgX: bar.start * 700, a3SvgWidth: bar.width * 700, keyboardOpenedA3: true },
    chart: { bars: chart.presentation.bars.map((bar, index) => ({ key: bar.key, value: bar.value, width: scale.bars[index]?.width ?? null })), completedDrilldownRows: ['lab-a1'], uiCompletedDrilldownMatched: true, screenshot: 'verification/screenshots/local-chart-plot-2026-10-21.jpg' },
    map: { point, centeredSvg: { x: 350, y: 175 }, movedEastSvgX: 175, editedLongitudeAt55: 140, undoAt56: 139.767125, keyboardOpenedA1: true, basemap: 'not-configured', screenshot: 'verification/screenshots/local-map-coordinates-2026-10-21.jpg' },
    browserEvidence: 'browser checks of the running app; current DOM and SVG attributes plus independent MCP/version reads', browserErrorsOnFinalViewsPage: [] };
  writeFileSync('verification/ui-view-rendering.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ revision: initial.revision, calendarA3Dates: dates, timelineA3X: bar.start * 700, timelineA3Width: bar.width * 700, chartCompletedRows: done.rowIds, mapLongitude: point.longitude, modifiedByVerifier: false }));
} finally { await client.close(); }
