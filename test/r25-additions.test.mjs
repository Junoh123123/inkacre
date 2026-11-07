import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r25: page layouts as the public help describes them — properties pinned in the heading (up to 15), backlinks
// always / on hover / off, no relations in the side panel, and 탭 구조 tabs showing another database's view narrowed
// to rows whose relation points at the open page.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r25-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r25-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'projects', title: '프로젝트' },
    { type: 'source.create', id: 'p', pageId: 'projects', name: '프로젝트', titlePropertyId: 'p-t' },
    { type: 'property.create', id: 'p-status', sourceId: 'p', name: '상태', propertyType: 'select', options: [{ id: 'o1', name: '진행' }] },
    { type: 'page.create', id: 'tasks', title: '할 일' },
    { type: 'source.create', id: 'k', pageId: 'tasks', name: '할 일', titlePropertyId: 'k-t' },
    { type: 'property.create', id: 'k-project', sourceId: 'k', name: '프로젝트', propertyType: 'relation', targetSourceId: 'p', inverse: { id: 'p-tasks', name: '할 일' } },
    { type: 'view.create', id: 'k-table', sourceId: 'k', parentId: 'tasks', name: '표', viewType: 'table', config: {} },
    { type: 'page.create', id: 'alpha', title: '알파', sourceId: 'p' },
    { type: 'page.create', id: 'beta', title: '베타', sourceId: 'p' },
    { type: 'page.create', id: 't1', title: '알파 일', sourceId: 'k' },
    { type: 'page.create', id: 't2', title: '베타 일', sourceId: 'k' },
    { type: 'relation.set', pageId: 't1', propertyId: 'k-project', targetIds: ['alpha'] },
    { type: 'relation.set', pageId: 't2', propertyId: 'k-project', targetIds: ['beta'] },
  ]);
  return { w, apply };
}

test('pinned properties and backlink display are stored with the layout; pins belong to the database', t => {
  const f = fixture(t);
  f.apply([{ type: 'source.update', id: 'p', pageLayout: { pinned: ['p-status'], backlinks: 'hover' } }]);
  assert.deepEqual(f.w.get('p').entity.pageLayout, { pinned: ['p-status'], backlinks: 'hover' });
  assert.throws(() => f.apply([{ type: 'source.update', id: 'p', pageLayout: { pinned: ['k-project'] } }]), /LAYOUT_PROPERTY|속성만/);
  assert.throws(() => f.apply([{ type: 'source.update', id: 'p', pageLayout: { pinned: Array.from({ length: 16 }, () => 'p-status') } }]));
  assert.throws(() => f.apply([{ type: 'source.update', id: 'p', pageLayout: { backlinks: 'sometimes' } }]));
});

test('relations stay out of the side panel', t => {
  const f = fixture(t);
  assert.throws(() => f.apply([{ type: 'source.update', id: 'p', pageLayout: { panel: ['p-tasks'] } }]), /LAYOUT_PANEL|패널/);
  f.apply([{ type: 'source.update', id: 'p', pageLayout: { panel: ['p-status'] } }]);
  assert.deepEqual(f.w.get('p').entity.pageLayout.panel, ['p-status']);
});

test('a tab shows another database view narrowed by a relation that points back at this database', t => {
  const f = fixture(t);
  f.apply([{ type: 'source.update', id: 'p', pageLayout: { structure: 'tabs', tabs: [{ id: 'tab1', name: '관련 할 일', viewId: 'k-table', relationPropertyId: 'k-project' }] } }]);
  assert.equal(f.w.get('p').entity.pageLayout.tabs[0].viewId, 'k-table');
  // The tab's rows: the view's own filter plus "프로젝트 contains <open page>".
  const rows = f.w.query({ viewId: 'k-table', filter: { propertyId: 'k-project', op: 'contains', value: 'alpha' } }).rows.map(row => row.title);
  assert.deepEqual(rows, ['알파 일']);
  assert.throws(() => f.apply([{ type: 'source.update', id: 'p', pageLayout: { tabs: [{ id: 'x', name: '잘못', viewId: 'k-table', relationPropertyId: 'p-status' }] } }]), /LAYOUT_TAB|관계형/);
  assert.throws(() => f.apply([{ type: 'source.update', id: 'p', pageLayout: { tabs: [{ id: 'x', name: '없는 보기', viewId: 'nope' }] } }]), /LAYOUT_TAB|보기/);
  assert.throws(() => f.apply([{ type: 'source.update', id: 'p', pageLayout: { tabs: [{ id: 'x', name: 'a', viewId: 'k-table' }, { id: 'x', name: 'b', viewId: 'k-table' }] } }]), /LAYOUT_TAB|겹칩/);
});
