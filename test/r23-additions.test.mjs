import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';

// r23: the HTML block: an uploaded .html file in a sandboxed frame.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r23-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r23-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  const attach = (name, mediaType, text) => {
    const blob = w.putBlob(Buffer.from(text));
    const id = `attachment:${name}`;
    apply([{ type: 'attachment.register', id, name, mediaType, ...blob }]);
    return id;
  };
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  return { w, apply, attach };
}

test('an HTML block takes only an HTML file and keeps its frame height', t => {
  const f = fixture(t);
  const html = f.attach('page.html', 'text/html', '<h1>Hi</h1>');
  const png = f.attach('dot.png', 'image/png', 'not really a png');
  f.apply([{ type: 'page.create', id: 'root', title: 'HTML' }, { type: 'block.create', id: 'h', parentId: 'root', blockType: 'html' }]);
  f.apply([{ type: 'block.update', id: 'h', attachmentId: html, height: 320 }]);
  assert.equal(f.w.get('h').entity.attachmentId, html);
  assert.equal(f.w.get('h').entity.height, 320);
  assert.throws(() => f.apply([{ type: 'block.update', id: 'h', attachmentId: png }]), /HTML_MEDIA_TYPE|HTML 파일/);
  f.apply([{ type: 'block.update', id: 'h', height: null }]);
  assert.equal(f.w.get('h').entity.height, undefined);
  f.apply([{ type: 'block.update', id: 'h', width: 480 }]);
  assert.equal(f.w.get('h').entity.width, 480);
  f.apply([{ type: 'block.update', id: 'h', width: null }]);
  assert.equal(f.w.get('h').entity.width, undefined);
  // Turned into a file block it keeps the attachment (전환 › 파일).
  f.apply([{ type: 'block.update', id: 'h', blockType: 'file' }]);
  assert.equal(f.w.get('h').entity.attachmentId, html);
});

test('the HTML file is served in its own sandbox; other files are not', async t => {
  const f = fixture(t);
  const html = f.attach('page.html', 'text/html', '<script>document.title="x"</script><p>ok</p>');
  const text = f.attach('note.txt', 'text/plain', 'plain');
  const server = createLocalServer(f.w);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/html/${encodeURIComponent(html)}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  const policy = response.headers.get('content-security-policy');
  assert.match(policy, /^sandbox allow-scripts/);
  assert.doesNotMatch(policy, /allow-same-origin/);
  assert.match(policy, /frame-ancestors 'self'/);
  assert.equal(await response.text(), '<script>document.title="x"</script><p>ok</p>');
  assert.equal((await fetch(`${base}/api/html/${encodeURIComponent(text)}`)).status, 404);
  // What the frame sends carries Origin: null and is refused.
  const post = await fetch(`${base}/api/commands`, { method: 'POST', headers: { origin: 'null', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(post.status, 403);
});

test('a comment can carry emoji reactions; a reaction alone makes a thread (고른 글에 반응)', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'root', title: 'R' }, { type: 'block.create', id: 'b', parentId: 'root', blockType: 'paragraph', richText: [{ text: 'hello', comments: ['c1'] }] }]);
  f.apply([{ type: 'comment.create', id: 'c1', parentId: 'b', richText: [], reactions: ['😀'] }]);
  assert.deepEqual(f.w.get('c1').entity.reactions, ['😀']);
  f.apply([{ type: 'comment.update', id: 'c1', reactions: ['😀', '👍'] }]);
  assert.deepEqual(f.w.get('c1').entity.reactions, ['😀', '👍']);
  assert.throws(() => f.apply([{ type: 'comment.update', id: 'c1', reactions: ['👍', '👍'] }]), /REACTION_DUPLICATE|같은 반응/);
  // Neither words nor a reaction: refused.
  assert.throws(() => f.apply([{ type: 'comment.create', parentId: 'b', richText: [] }]), /COMMENT_EMPTY|반응이 필요/);
});
