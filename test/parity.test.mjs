import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { compileFormula, evaluateFormula, formatFormula } from '../src/formula.mjs';
import { blockOrdinal, markdownBlock } from '../web/rich-text.mjs';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-regression-'));
  let workspace = new Workspace(directory), sequence = 0;
  const apply = operations => workspace.execute({ id: `regression-${++sequence}`, actor: 'test', expectedRevision: workspace.revision, operations });
  t.after(() => { workspace.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([{ type: 'page.create', id: 'root', title: '합성 검사' }, { type: 'source.create', id: 'tasks', pageId: 'root', name: '할 일', titlePropertyId: 'title' },
    { type: 'property.create', id: 'amount', sourceId: 'tasks', name: '금액', propertyType: 'number' },
    { type: 'property.create', id: 'state', sourceId: 'tasks', name: '상태', propertyType: 'status', options: [{ id: 'z-ready', name: '대기' }, { id: 'a-done', name: '완료' }] },
    { type: 'property.create', id: 'tags', sourceId: 'tasks', name: '태그', propertyType: 'multi_select', options: [{ id: 'z-design', name: '기획' }, { id: 'a-build', name: '개발' }] },
    { type: 'property.create', id: 'peers', sourceId: 'tasks', name: '관련 작업', propertyType: 'relation', targetSourceId: 'tasks' },
    ...['a', 'b', 'c'].map(id => ({ type: 'page.create', id, sourceId: 'tasks', title: id }))]);
  return { get workspace() { return workspace; }, apply, reopen() { workspace.close(); workspace = new Workspace(directory); } };
}
const calculate = expression => evaluateFormula(compileFormula(expression, () => null), () => null);

test('formula literals, lazy branches and lexical variables preserve meaning through formatting', () => {
  for (const [expression, expected] of [
    ['empty(0)', true], ['empty("")', true], ['empty([0])', false],
    ['contains("Pageyard", "ge")', true], ['includes(["기획", "개발"], "개발")', true],
    ['lower("PAGEYARD") + upper("app")', 'pageyardAPP'], ['substring("Pageyard", 2)', 'geyard'],
    ['join(split("a,b", ","), " / ")', 'a / b'], ['concat([1, 2], [3])', [1, 2, 3]],
    ['true ? 1 : 1 / 0', 1], ['ifs(false, 1 / 0, true, 2, 1 / 0)', 2],
    ['lets(x, 2, y, x + 1, let(x, 10, x) + x * y)', 16],
  ]) {
    const ast = compileFormula(expression, () => null);
    assert.deepEqual(evaluateFormula(ast, () => null), expected, expression);
    assert.deepEqual(calculate(formatFormula(ast)), expected, `format: ${expression}`);
  }
  assert.throws(() => calculate('let(x, x + 1, x)'), { code: 'FORMULA_VARIABLE' });
  assert.throws(() => calculate('let(x, 1, x) + x'), { code: 'FORMULA_VARIABLE' });
  assert.throws(() => calculate('lets(x, 1)'), { code: 'FORMULA_ARITY' });
});

test('ISO date functions keep floating dates, zoned instants and invalid inputs distinct', () => {
  assert.equal(calculate('dateBetween(parseDate("2026-10-22"), parseDate("2026-10-19"), "days")'), 3);
  assert.equal(calculate('dateBetween(parseDate("2026-10-22T00:00:00+09:00"), parseDate("2026-10-21T15:00:00Z"), "minutes")'), 0);
  assert.equal(calculate('formatDate(parseDate("2024-02-29"), "YYYY-MM-DD")'), '2024-02-29');
  assert.throws(() => calculate('parseDate("2026-02-30")'), { code: 'FORMULA_DATE' });
  assert.equal(calculate('formatDate(parseDate("2026-10-22"), "MMMM")'), 'October');
  assert.throws(() => calculate('formatDate(parseDate("2026-10-22"), "unsupported")'), { code: 'FORMULA_DATE_FORMAT' });
  const ast = compileFormula('formatDate(dateEnd(prop("date")), "YYYY-MM-DD HH:mm")', value => value);
  assert.equal(evaluateFormula(ast, () => ({ start: '2026-10-19T15:00:00Z', end: '2026-10-21T15:00:00Z', timeZone: 'Asia/Tokyo' })), '2026-10-22 00:00');
  assert.equal(evaluateFormula(compileFormula('now()', () => null), () => null, { now: '2026-10-22T01:02:03Z' }).start, '2026-10-22T01:02:03Z');
});

test('selection labels feed formula -> rollup -> filter while stored IDs survive rename, undo and restart', t => {
  const f = fixture(t);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'state', value: 'a-done' }, { type: 'value.set', pageId: 'a', propertyId: 'tags', value: ['z-design', 'a-build'] },
    { type: 'property.create', id: 'done', sourceId: 'tasks', name: '완료수', propertyType: 'formula', formula: 'if(prop("상태") == "완료", 1, 0)' },
    { type: 'property.create', id: 'tag-names', sourceId: 'tasks', name: '태그명', propertyType: 'formula', formula: 'join(prop("태그"), ",")' },
    { type: 'property.create', id: 'completed', sourceId: 'tasks', name: '완료합', propertyType: 'rollup', rollup: { relationPropertyId: 'peers', targetPropertyId: 'done', aggregation: 'sum' } },
    { type: 'relation.set', pageId: 'b', propertyId: 'peers', targetIds: ['a'] }]);
  f.reopen();
  assert.equal(f.workspace.get('b').entity.computed.completed, 1);
  assert.equal(f.workspace.get('a').entity.computed['tag-names'], '기획,개발');
  assert.deepEqual(f.workspace.query({ sourceId: 'tasks', filter: { propertyId: 'completed', op: 'gt', value: 0 } }).rows.map(row => row.id), ['b']);
  const changed = f.apply([{ type: 'property.update', id: 'state', name: '진행 상태', options: [{ id: 'z-ready', name: '대기' }, { id: 'a-done', name: '종료' }] }]);
  assert.equal(f.workspace.get('b').entity.computed.completed, 0);
  assert.equal(f.workspace.get('a').entity.values.state, 'a-done');
  f.workspace.undo({ id: 'undo-label', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: changed.commandId });
  assert.equal(f.workspace.get('b').entity.computed.completed, 1);
});

test('formula empty zero does not erase zero from numeric filters or rollups', t => {
  const f = fixture(t);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'amount', value: 0 },
    { type: 'property.create', id: 'empty-number', sourceId: 'tasks', name: '빈 숫자', propertyType: 'formula', formula: 'empty(prop("금액"))' },
    { type: 'property.create', id: 'present', sourceId: 'tasks', name: '값 건수', propertyType: 'rollup', rollup: { relationPropertyId: 'peers', targetPropertyId: 'amount', aggregation: 'count_nonempty' } },
    { type: 'relation.set', pageId: 'b', propertyId: 'peers', targetIds: ['a'] }]);
  assert.equal(f.workspace.get('a').entity.computed['empty-number'], true);
  assert.equal(f.workspace.get('b').entity.computed.present, 1);
  assert.deepEqual(f.workspace.query({ sourceId: 'tasks', filter: { propertyId: 'amount', op: 'not_empty' } }).rows.map(row => row.id), ['a']);
});

test('option order drives both sort directions and multiple-selection ties after option edits', t => {
  const f = fixture(t);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'state', value: 'a-done' }, { type: 'value.set', pageId: 'b', propertyId: 'state', value: 'z-ready' },
    { type: 'value.set', pageId: 'a', propertyId: 'tags', value: ['a-build'] }, { type: 'value.set', pageId: 'b', propertyId: 'tags', value: ['z-design'] }, { type: 'value.set', pageId: 'c', propertyId: 'tags', value: ['a-build', 'z-design'] },
    { type: 'view.create', id: 'sorted', sourceId: 'tasks', parentId: 'root', name: '정렬', config: { sorts: [{ propertyId: 'state', direction: 'asc' }] } }]);
  const ids = () => f.workspace.query({ viewId: 'sorted' }).rows.map(row => row.id);
  assert.deepEqual(ids(), ['b', 'a', 'c']);
  f.apply([{ type: 'view.update', id: 'sorted', config: { sorts: [{ propertyId: 'state', direction: 'desc' }] } }]);
  assert.deepEqual(ids(), ['a', 'b', 'c']);
  f.apply([{ type: 'property.update', id: 'state', options: [{ id: 'a-done', name: '완료' }, { id: 'z-ready', name: '대기' }] }]);
  assert.deepEqual(ids(), ['b', 'a', 'c']);
  f.apply([{ type: 'view.update', id: 'sorted', config: { sorts: [{ propertyId: 'tags', direction: 'asc' }] } }]);
  assert.deepEqual(ids(), ['b', 'c', 'a']);
});

test('single-property self relations unlink symmetrically, preserve targets and recover after restart', t => {
  const f = fixture(t);
  f.apply([{ type: 'relation.set', pageId: 'a', propertyId: 'peers', targetIds: ['a', 'b'] }]);
  assert.deepEqual(f.workspace.get('b').entity.computed.peers, ['a']);
  f.reopen();
  const unlink = f.apply([{ type: 'relation.set', pageId: 'b', propertyId: 'peers', targetIds: [] }]);
  assert.deepEqual(f.workspace.get('a').entity.computed.peers, ['a']);
  assert.equal(f.workspace.get('a').entity.alive, true);
  f.workspace.undo({ id: 'undo-self-unlink', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: unlink.commandId });
  assert.deepEqual(f.workspace.get('b').entity.computed.peers, ['a']);
  f.apply([{ type: 'page.duplicate', id: 'a', newId: 'copy' }]);
  assert.ok(f.workspace.get('b').entity.computed.peers.includes('copy'));
  f.apply([{ type: 'property.create', id: 'names', sourceId: 'tasks', name: '이름 관계', propertyType: 'text' }, { type: 'value.set', pageId: 'a', propertyId: 'names', value: 'b' }, { type: 'property.convert', id: 'names', propertyType: 'relation', targetSourceId: 'tasks' }]);
  assert.deepEqual(f.workspace.get('b').entity.computed.names, ['a']);
});

test('Markdown prefixes are exact and numbered runs restart independently after interruption', () => {
  assert.deepEqual(markdownBlock('#'), { blockType: 'heading1' });
  assert.deepEqual(markdownBlock('[x]'), { blockType: 'todo', checked: true });
  assert.deepEqual(markdownBlock('>'), { blockType: 'toggle' });
  assert.equal(markdownBlock('본문 #'), null);
  const siblings = [{ id: 'one', blockType: 'numbered' }, { id: 'two', blockType: 'numbered' }, { id: 'break', blockType: 'paragraph' }, { id: 'three', blockType: 'numbered' }];
  assert.deepEqual(['one', 'two', 'three'].map(id => blockOrdinal(siblings, id)), [1, 2, 1]);
});
