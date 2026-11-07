import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// Discussions in the rebuilt UI: a reply names the first comment of its thread, and the
// text a discussion is about carries the thread id on its rich-text runs.
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pageyard-comment-threads-'));
  const w = new Workspace(dir);
  let n = 0;
  t.after(() => { w.close(); rmSync(dir, { recursive: true, force: true }); });
  const apply = operations => w.execute({ id: `threads-${++n}`, actor: 'test', expectedRevision: w.revision, operations });
  apply([
    { type: 'page.create', id: 'root', title: '본문' },
    { type: 'block.create', id: 'a', parentId: 'root', richText: [{ text: '앞 ' }, { text: '논의할 부분', comments: ['c1'] }, { text: ' 뒤' }] },
    { type: 'block.create', id: 'b', parentId: 'root', richText: [{ text: '다른 블록' }] },
  ]);
  return { w, apply };
}

test('replies join the first comment of a thread on the same target', t => {
  const f = fixture(t);
  f.apply([{ type: 'comment.create', id: 'c1', parentId: 'a', richText: [{ text: '여기 확인' }] }]);
  f.apply([{ type: 'comment.create', id: 'c2', parentId: 'a', threadId: 'c1', richText: [{ text: '확인했습니다' }] }]);
  assert.equal(f.w.get('c2').entity.threadId, 'c1');
  assert.deepEqual(f.w.get('a').entity.richText[1].comments, ['c1']);
  // A reply can't hang off another target's comment or off a reply.
  assert.throws(() => f.apply([{ type: 'comment.create', parentId: 'b', threadId: 'c1', richText: [{ text: 'x' }] }]), { code: 'COMMENT_THREAD' });
  assert.throws(() => f.apply([{ type: 'comment.create', parentId: 'a', threadId: 'c2', richText: [{ text: 'x' }] }]), { code: 'COMMENT_THREAD' });
  f.apply([{ type: 'comment.update', id: 'c1', resolved: true }]);
  assert.equal(f.w.get('c1').entity.resolved, true);
});

test('duplicated blocks leave the discussion marks behind', t => {
  const f = fixture(t);
  f.apply([{ type: 'comment.create', id: 'c1', parentId: 'a', richText: [{ text: '여기 확인' }] }]);
  f.apply([{ type: 'block.duplicate', id: 'a' }]);
  const copies = f.w.snapshot().objects.filter(item => item.kind === 'block' && item.alive && item.id !== 'a' && item.richText?.[1]?.text === '논의할 부분');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].richText[1].comments, undefined);
  assert.deepEqual(f.w.get('a').entity.richText[1].comments, ['c1']);
});
