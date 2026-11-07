import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { textBlocks } from '../web/paste-blocks.mjs';

// Additive block fields used by the rebuilt UI: heading 4, collapsible headings, callout
// icons, block colours, named columns for a new layout and column width ratios.
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pageyard-block-extras-'));
  const w = new Workspace(dir);
  let n = 0;
  t.after(() => { w.close(); rmSync(dir, { recursive: true, force: true }); });
  const apply = operations => w.execute({ id: `extras-${++n}`, actor: 'test', expectedRevision: w.revision, operations });
  const undo = result => w.undo({ id: `undo-${++n}`, actor: 'test', expectedRevision: w.revision, targetCommandId: result.commandId });
  apply([{ type: 'page.create', id: 'root', title: '본문' }]);
  return { w, apply, undo };
}

test('heading 4, toggle headings, callout icons and block colours are stored, updated and cleared', t => {
  const f = fixture(t);
  f.apply([
    { type: 'block.create', id: 'h4', parentId: 'root', blockType: 'heading4', richText: [{ text: '제목 4' }] },
    { type: 'block.create', id: 'th', parentId: 'root', blockType: 'heading2', toggleable: true, richText: [{ text: '토글 제목' }] },
    { type: 'block.create', id: 'inside', parentId: 'th', richText: [{ text: '접힌 내용' }] },
    { type: 'block.create', id: 'call', parentId: 'root', blockType: 'callout', icon: '🚀', color: 'blue_background', richText: [{ text: '알림' }] },
  ]);
  assert.equal(f.w.get('h4').entity.blockType, 'heading4');
  assert.equal(f.w.get('th').entity.toggleable, true);
  assert.equal(f.w.get('th').entity.children[0].id, 'inside');
  assert.equal(f.w.get('call').entity.icon, '🚀');
  assert.equal(f.w.get('call').entity.color, 'blue_background');
  f.apply([{ type: 'block.update', id: 'call', icon: null, color: 'red' }]);
  assert.equal(f.w.get('call').entity.icon, undefined);
  assert.equal(f.w.get('call').entity.color, 'red');
  // Turning a toggle heading into text drops the collapsible flag but keeps its children.
  f.apply([{ type: 'block.update', id: 'th', blockType: 'paragraph' }]);
  assert.equal(f.w.get('th').entity.toggleable, undefined);
  assert.equal(f.w.get('th').entity.children[0].id, 'inside');
  assert.throws(() => f.apply([{ type: 'block.update', id: 'call', color: 'neon' }]));
  const markdown = f.w.export({ id: 'root', format: 'markdown' }).text;
  assert.match(markdown, /^#### 제목 4$/m);
  assert.equal(textBlocks('#### 붙인 제목')[0].blockType, 'heading4');
});

test('a new layout can name its columns so blocks move in with one command and one undo', t => {
  const f = fixture(t);
  f.apply([
    { type: 'block.create', id: 'a', parentId: 'root', richText: [{ text: 'A' }] },
    { type: 'block.create', id: 'b', parentId: 'root', richText: [{ text: 'B' }] },
  ]);
  const shape = () => f.w.snapshot().objects.filter(item => item.alive).map(item => [item.id, item.parentId, item.position]).sort().join('|');
  const before = shape();
  const result = f.apply([
    { type: 'block.create', id: 'layout', parentId: 'root', blockType: 'columns', columnIds: ['left', 'right'], beforeId: 'a' },
    { type: 'node.move', id: 'a', parentId: 'left' },
    { type: 'node.move', id: 'b', parentId: 'right' },
    { type: 'block.update', id: 'left', ratio: 0.6 },
    { type: 'block.update', id: 'right', ratio: 0.4 },
  ]);
  const layout = f.w.get('layout').entity;
  assert.deepEqual(layout.children.map(child => child.id), ['left', 'right']);
  assert.equal(f.w.get('left').entity.ratio, 0.6);
  assert.equal(f.w.get('right').entity.children[0].id, 'b');
  f.undo(result);
  assert.equal(shape(), before);
  assert.throws(() => f.apply([{ type: 'block.create', id: 'x', parentId: 'root', blockType: 'paragraph', columnIds: ['p', 'q'] }]), { code: 'COLUMN_IDS' });
  assert.throws(() => f.apply([{ type: 'block.create', id: 'y', parentId: 'root', blockType: 'columns', columnIds: ['a', 'z'] }]), { code: 'ID_EXISTS' });
  // Without names the engine still creates two columns itself.
  f.apply([{ type: 'block.create', id: 'plain', parentId: 'root', blockType: 'columns' }]);
  assert.equal(f.w.get('plain').entity.children.length, 2);
});

test('simple tables keep column widths and row/column colours; a callout can drop its icon', t => {
  const f = fixture(t);
  f.apply([
    { type: 'block.create', id: 'tbl', parentId: 'root', blockType: 'table', cells: [[[{ text: 'a' }], [{ text: 'b' }]], [[], []]], columnWidths: [120, 240], rowColors: ['blue_background', null], columnColors: [null, 'red'] },
    { type: 'block.create', id: 'call', parentId: 'root', blockType: 'callout', icon: '', richText: [{ text: '아이콘 없음' }] },
  ]);
  const table = f.w.get('tbl').entity;
  assert.deepEqual(table.columnWidths, [120, 240]);
  assert.deepEqual(table.rowColors, ['blue_background', null]);
  assert.deepEqual(table.columnColors, [null, 'red']);
  assert.equal(f.w.get('call').entity.icon, '');
  f.apply([{ type: 'block.update', id: 'tbl', columnWidths: [354, 354], rowColors: null }]);
  assert.deepEqual(f.w.get('tbl').entity.columnWidths, [354, 354]);
  assert.equal(f.w.get('tbl').entity.rowColors, undefined);
  assert.throws(() => f.apply([{ type: 'block.update', id: 'tbl', columnWidths: [10] }]));
  assert.throws(() => f.apply([{ type: 'block.update', id: 'tbl', columnColors: ['neon'] }]));
});
