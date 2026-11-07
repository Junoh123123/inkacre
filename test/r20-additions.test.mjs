import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r20: interface languages — what the engine needs so other languages work the same.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r20-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r20-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  return { w, apply };
}

test('source.create names the title column as asked (titleName), Korean "이름" otherwise', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'root', title: 'Root' }, { type: 'source.create', id: 'en', pageId: 'root', name: 'Tasks', titlePropertyId: 'en-title', titleName: 'Name' }, { type: 'source.create', id: 'ko', pageId: 'root', name: '업무', titlePropertyId: 'ko-title' }]);
  assert.equal(f.w.get('en-title').entity.name, 'Name');
  assert.equal(f.w.get('ko-title').entity.name, '이름');
});

test('a variable formula may name trigger values by token ($now, $actor …) as well as by their Korean names', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'root', title: 'Root' }, { type: 'source.create', id: 'work', pageId: 'root', name: 'Work', titlePropertyId: 'name' },
    { type: 'property.create', id: 'done', sourceId: 'work', name: 'Done', propertyType: 'checkbox' }, { type: 'property.create', id: 'who', sourceId: 'work', name: 'Who', propertyType: 'text' },
    { type: 'page.create', id: 'a', sourceId: 'work', title: 'A' }]);
  f.apply([{ type: 'automation.create', id: 'auto', sourceId: 'work', triggers: [{ type: 'property_edited', propertyId: 'done' }], actions: [
    { action: 'define_variables', variables: [{ id: 'v1', name: 'Actor', mode: 'formula', value: 'prop("$actor")' }, { id: 'v2', name: '사람', mode: 'formula', value: 'prop("트리거한 사용자")' }] },
    { action: 'set_property', propertyId: 'who', value: { $formula: 'prop("Actor") + "/" + prop("사람")' } },
  ] }]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'done', value: true }]);
  assert.equal(f.w.get('a').entity.values.who, 'test/test');
});
