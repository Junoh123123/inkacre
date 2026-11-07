import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r21: final audit — what the engine needs for the database page's "복제" submenu.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r21-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r21-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  return { w, apply };
}

test('page.duplicate withoutRows copies a database with its properties, views and templates but no rows', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'db', title: 'Tasks' }, { type: 'source.create', id: 'src', pageId: 'db', name: 'Tasks', titlePropertyId: 'name' },
    { type: 'property.create', id: 'done', sourceId: 'src', name: 'Done', propertyType: 'checkbox' },
    { type: 'view.create', id: 'v', sourceId: 'src', parentId: 'db', name: 'Table', viewType: 'table', config: {} },
    { type: 'page.create', id: 'r1', sourceId: 'src', title: 'Row 1' }, { type: 'page.create', id: 'r2', sourceId: 'src', title: 'Row 2' },
    { type: 'page.create', id: 'tpl', sourceId: 'src', title: 'Template', template: true }]);
  f.apply([{ type: 'page.duplicate', id: 'db', newId: 'empty', withoutRows: true }, { type: 'page.duplicate', id: 'db', newId: 'full' }]);
  const kids = (w, id) => w.snapshot().objects.filter(entity => entity.parentId === id && entity.alive !== false);
  for (const [id, rows] of [['empty', 0], ['full', 2]]) {
    const [source] = kids(f.w, id).filter(entity => entity.kind === 'source');
    assert.ok(source, `${id} has a source`);
    const pages = kids(f.w, source.id).filter(entity => entity.kind === 'page');
    assert.equal(pages.filter(page => !page.template).length, rows, `${id} rows`);
    assert.equal(pages.filter(page => page.template).length, 1, `${id} keeps the template`);
    assert.equal(kids(f.w, source.id).filter(entity => entity.kind === 'property').length, 2, `${id} properties`);
    assert.equal(kids(f.w, id).filter(entity => entity.kind === 'view').length, 1, `${id} views`);
  }
});

test('a view can show status properties as checkboxes (checkboxStatus)', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'db', title: 'Tasks' }, { type: 'source.create', id: 'src', pageId: 'db', name: 'Tasks', titlePropertyId: 'name' },
    { type: 'property.create', id: 'st', sourceId: 'src', name: 'Status', propertyType: 'status' },
    { type: 'view.create', id: 'v', sourceId: 'src', parentId: 'db', name: 'Table', viewType: 'table', config: { checkboxStatus: ['st'] } }]);
  assert.deepEqual(f.w.get('v').entity.config.checkboxStatus, ['st']);
});
