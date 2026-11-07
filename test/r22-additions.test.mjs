import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r22: more page, block and database features.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r22-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r22-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  return { w, apply };
}

test('an inline equation is a rich-text run (equation: true, the text is its TeX) and exports as $…$', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'root', title: 'Math' }, { type: 'block.create', id: 'b', parentId: 'root', blockType: 'paragraph', richText: [{ text: 'Area ' }, { text: '\\pi r^2', equation: true }] }]);
  assert.deepEqual(f.w.get('b').entity.richText, [{ text: 'Area ' }, { text: '\\pi r^2', equation: true }]);
  assert.match(f.w.export({ id: 'root', format: 'markdown' }).text, /Area \$\\pi r\^2\$/);
});

test('a tabs block holds tab blocks (name = richText, icon), each with its own content', t => {
  const f = fixture(t);
  f.apply([
    { type: 'page.create', id: 'root', title: 'Tabs' },
    { type: 'block.create', id: 'tabs', parentId: 'root', blockType: 'tabs' },
    { type: 'block.create', id: 't1', parentId: 'tabs', blockType: 'tab', richText: [{ text: 'Plan' }], icon: '📌' },
    { type: 'block.create', id: 't2', parentId: 'tabs', blockType: 'tab', richText: [{ text: 'Notes' }] },
    { type: 'block.create', id: 'c1', parentId: 't1', blockType: 'paragraph', richText: [{ text: 'first tab body' }] },
    { type: 'block.create', id: 'c2', parentId: 't2', blockType: 'bullet', richText: [{ text: 'second' }] },
  ]);
  assert.equal(f.w.get('t1').entity.icon, '📌');
  assert.deepEqual(f.w.get('t2').entity.richText, [{ text: 'Notes' }]);
  const markdown = f.w.export({ id: 'root', format: 'markdown' }).text;
  assert.match(markdown, /\*\*Plan\*\*[\s\S]*first tab body[\s\S]*\*\*Notes\*\*[\s\S]*- second/);
  // Only tabs go in a tabs block, and a tab only in a tabs block.
  assert.throws(() => f.apply([{ type: 'block.create', parentId: 'tabs', blockType: 'paragraph', richText: [{ text: 'stray' }] }]), /TAB_CHILD|탭 블록 안에는/);
  assert.throws(() => f.apply([{ type: 'block.create', parentId: 'root', blockType: 'tab', richText: [{ text: 'loose' }] }]), /TAB_PARENT|탭은 탭 블록/);
  // Renaming and moving a tab keep its content; duplicating the block copies every tab.
  f.apply([{ type: 'block.update', id: 't2', richText: [{ text: 'Log' }] }, { type: 'node.move', id: 't2', parentId: 'tabs', beforeId: 't1' }]);
  assert.deepEqual(f.w.get('tabs').entity.children.map(child => child.id), ['t2', 't1']);
  f.apply([{ type: 'block.duplicate', id: 'tabs', newId: 'tabs-copy' }]);
  assert.deepEqual(f.w.get('tabs-copy').entity.children.map(child => child.richText[0].text), ['Log', 'Plan']);
});

test('a code block keeps a caption apart from its code (null removes it) and exports it under the fence', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'root', title: 'Code' }, { type: 'block.create', id: 'c', parentId: 'root', blockType: 'code', language: 'javascript', richText: [{ text: 'let a = 1;' }], caption: [{ text: '예제 코드' }] }]);
  assert.deepEqual(f.w.get('c').entity.caption, [{ text: '예제 코드' }]);
  assert.match(f.w.export({ id: 'root', format: 'markdown' }).text, /```javascript\nlet a = 1;\n```\n\*예제 코드\*/);
  f.apply([{ type: 'block.update', id: 'c', caption: null }]);
  assert.equal(f.w.get('c').entity.caption, undefined);
  assert.throws(() => f.apply([{ type: 'block.update', id: 'c', caption: [{ text: 'x', href: 'javascript:alert(1)' }] }]), /UNSAFE_LINK|링크/);
});
