import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { aggregate } from '../src/aggregation.mjs';
import { compileFormula, evaluateFormula } from '../src/formula.mjs';

// r26 (coverage phase 1): number range, trim(), a unique ID's prefix (search finds "TASK-2"), lettered and roman
// list formats, a duplicated template staying a template, a button that opens a URL, timeline zoom levels and
// load limit, view tab display, number bars and rings, form icon / cover / submit words, chart colour by value.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r26-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r26-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'tasks', title: '할 일' },
    { type: 'source.create', id: 's', pageId: 'tasks', name: '할 일', titlePropertyId: 's-t' },
    { type: 'property.create', id: 's-n', sourceId: 's', name: '점수', propertyType: 'number' },
    { type: 'property.create', id: 's-id', sourceId: 's', name: 'ID', propertyType: 'unique_id' },
    { type: 'view.create', id: 'v', sourceId: 's', parentId: 'tasks', name: '표', viewType: 'table', config: {} },
    { type: 'page.create', id: 'r1', title: '첫째', sourceId: 's' },
    { type: 'page.create', id: 'r2', title: '둘째', sourceId: 's' },
    { type: 'value.set', pageId: 'r1', propertyId: 's-n', value: 3 },
    { type: 'value.set', pageId: 'r2', propertyId: 's-n', value: 10 },
  ]);
  return { w, apply };
}

test('range aggregates max − min in column calculations; trim() strips spaces', t => {
  const f = fixture(t);
  assert.equal(aggregate([3, 10, null], 'range'), 7);
  f.apply([{ type: 'view.update', id: 'v', config: { columnAggregations: { 's-n': 'range' } } }]);
  assert.equal(f.w.query({ viewId: 'v' }).presentation.columnAggregations['s-n'], 7);
  assert.equal(evaluateFormula(compileFormula('trim("  가 나 ")', () => null), () => null), '가 나');
});

test('a unique ID prefix is stored on the property, searchable as PREFIX-n, and only on ID properties', t => {
  const f = fixture(t);
  f.apply([{ type: 'property.update', id: 's-id', idPrefix: 'TASK' }]);
  assert.equal(f.w.get('s-id').entity.idPrefix, 'TASK');
  const found = f.w.search({ query: 'task-2', titleOnly: true });
  assert.deepEqual(found.results.map(result => result.id), ['r2']);
  assert.throws(() => f.apply([{ type: 'property.update', id: 's-n', idPrefix: 'X' }]), /PROPERTY_TYPE|ID 속성/);
  assert.throws(() => f.apply([{ type: 'property.update', id: 's-id', idPrefix: 'TA SK' }]));
  f.apply([{ type: 'property.update', id: 's-id', idPrefix: null }]);
  assert.equal(f.w.get('s-id').entity.idPrefix, undefined);
});

test('numbered lists keep a letters or roman format; other blocks drop it', t => {
  const f = fixture(t);
  f.apply([{ type: 'block.create', id: 'b1', parentId: 'tasks', blockType: 'numbered', richText: [{ text: '가' }], listFormat: 'letters' }]);
  assert.equal(f.w.get('b1').entity.listFormat, 'letters');
  f.apply([{ type: 'block.update', id: 'b1', listFormat: 'roman' }]);
  assert.equal(f.w.get('b1').entity.listFormat, 'roman');
  f.apply([{ type: 'block.update', id: 'b1', blockType: 'bullet' }]);
  assert.equal(f.w.get('b1').entity.listFormat, undefined);
});

test('a template duplicated with keepTemplate stays a template; a plain duplicate does not', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'tpl', title: '양식', sourceId: 's', template: true }]);
  f.apply([{ type: 'page.duplicate', id: 'tpl', newId: 'tpl2', keepTemplate: true }]);
  assert.equal(f.w.get('tpl2').entity.template, true);
  f.apply([{ type: 'page.duplicate', id: 'tpl', newId: 'row3' }]);
  assert.equal(f.w.get('row3').entity.template, false);
});

test('a button can open a URL: the run returns it, only http(s) is accepted', t => {
  const f = fixture(t);
  f.apply([{ type: 'block.create', id: 'btn', parentId: 'tasks', blockType: 'button', button: { label: '열기', actions: [{ action: 'open_url', url: 'https://example.com/a' }] } }]);
  const result = f.apply([{ type: 'button.run', id: 'btn', confirmed: true }]);
  assert.deepEqual(result.openUrls, ['https://example.com/a']);
  assert.throws(() => f.apply([{ type: 'block.update', id: 'btn', button: { label: '열기', actions: [{ action: 'open_url', url: 'javascript:alert(1)' }] } }]));
});

test('view, number and form settings added in r26 pass the contract', t => {
  const f = fixture(t);
  f.apply([{ type: 'view.update', id: 'v', config: { tabDisplay: 'icon', timelineZoom: 'quarter', loadLimit: 25 } }]);
  assert.equal(f.w.get('v').entity.config.tabDisplay, 'icon');
  assert.throws(() => f.apply([{ type: 'view.update', id: 'v', config: { tabDisplay: 'emoji' } }]));
  for (const zoom of ['biweek', 'quarter', 'year']) f.apply([{ type: 'view.update', id: 'v', config: { timelineZoom: zoom } }]);
  f.apply([{ type: 'property.update', id: 's-n', numberFormat: { style: 'number', display: 'ring', color: 'blue', divideBy: 10, showNumber: false } }]);
  assert.equal(f.w.get('s-n').entity.numberFormat.display, 'ring');
  f.apply([{ type: 'view.create', id: 'form', sourceId: 's', parentId: 'tasks', name: '양식', viewType: 'form', config: { form: { title: '신청', icon: '📝', submitLabel: '보내기', confirmation: '고마워요', questions: [{ propertyId: 's-t' }] } } }]);
  assert.equal(f.w.get('form').entity.config.form.submitLabel, '보내기');
  f.apply([{ type: 'view.create', id: 'chart', sourceId: 's', parentId: 'tasks', name: '차트', viewType: 'chart', config: { chart: { groupBy: 's-t', valuePropertyId: 's-n', aggregation: 'range', palette: 'blue', colorByValue: true } } }]);
  assert.equal(f.w.get('chart').entity.config.chart.colorByValue, true);
});
