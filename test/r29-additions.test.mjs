import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { sniffType } from '../src/public-content.mjs';

// r29 (coverage phase 4: editor and media): picture size, place, crop, mask, link and alt text; PDF, embed and
// link-to-page blocks; link mentions, date mentions and custom emoji in text; table cell colours and merges; text
// direction; unsyncing synced blocks; and the structure-preserving bundle keeping all of it.
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r29-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r29-${++i}`, actor: 'user', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  const picture = w.putBlob(png), pdf = w.putBlob(Buffer.from('%PDF-1.4\n%%EOF'));
  apply([
    { type: 'page.create', id: 'p', title: '미디어' },
    { type: 'page.create', id: 'other', title: '다른 페이지' },
    { type: 'attachment.register', id: 'attachment:pic', name: 'pic.png', mediaType: 'image/png', ...picture },
    { type: 'attachment.register', id: 'attachment:doc', name: 'doc.pdf', mediaType: 'application/pdf', ...pdf },
  ]);
  return { w, apply };
}

test('pictures keep their width, place, crop, mask, link and alternative text', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'block.create', id: 'img', parentId: 'p', blockType: 'image', attachmentId: 'attachment:pic', richText: [] }]);
  apply([{ type: 'block.update', id: 'img', width: 320, align: 'right', crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, mask: 'circle', href: '?id=other', alt: '설명' }]);
  const image = w.get('img').entity;
  assert.deepEqual([image.width, image.align, image.mask, image.href, image.alt], [320, 'right', 'circle', '?id=other', '설명']);
  assert.deepEqual(image.crop, { x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
  assert.throws(() => apply([{ type: 'block.update', id: 'img', href: 'javascript:alert(1)' }]), /링크/);
  apply([{ type: 'block.update', id: 'img', crop: null, mask: null, href: null, align: null }]);
  assert.equal(w.get('img').entity.crop, undefined);
});

test('PDF, embed and link-to-page blocks check what they hold', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'block.create', id: 'pdf', parentId: 'p', blockType: 'pdf', attachmentId: 'attachment:doc', richText: [] }]);
  assert.throws(() => apply([{ type: 'block.create', parentId: 'p', blockType: 'pdf', attachmentId: 'attachment:pic', richText: [] }]), /PDF/);
  apply([{ type: 'block.create', id: 'embed', parentId: 'p', blockType: 'embed', url: 'https://example.com/map', richText: [] }]);
  assert.throws(() => apply([{ type: 'block.update', id: 'embed', url: 'file:///etc/passwd' }]), /링크/);
  apply([{ type: 'block.create', id: 'link', parentId: 'p', blockType: 'link_to_page', richText: [{ text: '다른 페이지', pageId: 'other' }] }]);
  assert.throws(() => apply([{ type: 'block.create', parentId: 'p', blockType: 'link_to_page', richText: [{ text: '없음' }] }]), /페이지/);
  const markdown = w.export({ id: 'p', format: 'markdown' }).text;
  assert.match(markdown, /\[https:\/\/example.com\/map\]\(https:\/\/example.com\/map\)/);
  assert.match(markdown, /\[다른 페이지\]\(page-other\.md\)/);
});

test('link mentions, date mentions and custom emoji live in the text', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'emoji.set', name: 'party', attachmentId: 'attachment:pic' }]);
  assert.deepEqual(w.snapshot().objects.find(item => item.id === 'workspace-emoji').emoji, { party: 'attachment:pic' });
  assert.throws(() => apply([{ type: 'emoji.set', name: 'Bad Name', attachmentId: 'attachment:pic' }]));
  assert.throws(() => apply([{ type: 'emoji.set', name: 'doc', attachmentId: 'attachment:doc' }]), /이모지/);
  apply([{ type: 'block.create', id: 'b', parentId: 'p', blockType: 'paragraph', richText: [
    { text: '예시 사이트', href: 'https://example.com', mention: true, iconAttachmentId: 'attachment:pic' },
    { text: ' 회의 ' }, { text: '2026년 11월 3일', date: '2026-11-03T15:00', dateFormat: 'relative', remind: 30, reminderId: 'rem-1' },
    { text: ':party:', customEmoji: 'attachment:pic' },
  ] }]);
  const runs = w.get('b').entity.richText;
  assert.equal(runs[0].mention, true);
  assert.equal(runs[2].remind, 30);
  assert.throws(() => apply([{ type: 'block.update', id: 'b', richText: [{ text: 'x', mention: true }] }]), /주소/);
  assert.throws(() => apply([{ type: 'block.update', id: 'b', richText: [{ text: 'x', customEmoji: 'attachment:doc' }] }]), /이미지/);
  apply([{ type: 'emoji.set', name: 'party', attachmentId: null }]);
  assert.deepEqual(w.snapshot().objects.find(item => item.id === 'workspace-emoji').emoji, {});
});

test('tables keep single cell colours and merged ranges; blocks keep their text direction', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'block.create', id: 'tbl', parentId: 'p', blockType: 'table', cells: [[[{ text: 'a' }], [{ text: 'b' }]], [[{ text: 'c' }], [{ text: 'd' }]]] }]);
  apply([{ type: 'block.update', id: 'tbl', cellColors: { '0:1': 'red_background' }, merges: [{ row: 0, column: 0, rows: 2, columns: 1 }] }]);
  assert.deepEqual(w.get('tbl').entity.cellColors, { '0:1': 'red_background' });
  assert.equal(w.get('tbl').entity.merges.length, 1);
  assert.throws(() => apply([{ type: 'block.update', id: 'tbl', cellColors: { 'x': 'red' } }]));
  apply([{ type: 'block.create', id: 'arabic', parentId: 'p', blockType: 'paragraph', direction: 'rtl', richText: [{ text: 'مرحبا' }] }]);
  assert.equal(w.get('arabic').entity.direction, 'rtl');
});

test('unsyncing a copy leaves ordinary blocks; unsyncing the original frees every copy', t => {
  const { w, apply } = fixture(t);
  apply([
    { type: 'block.create', id: 'sync', parentId: 'p', blockType: 'synced', richText: [] },
    { type: 'block.create', id: 's1', parentId: 'sync', blockType: 'paragraph', richText: [{ text: '공유 내용' }] },
    { type: 'block.create', id: 'after', parentId: 'other', blockType: 'paragraph', richText: [{ text: '끝' }] },
    { type: 'block.create', id: 'ref1', parentId: 'other', blockType: 'synced_reference', sourceBlockId: 'sync', richText: [], beforeId: 'after' },
    { type: 'page.create', id: 'third', title: '세 번째' },
    { type: 'block.create', id: 'ref2', parentId: 'third', blockType: 'synced_reference', sourceBlockId: 'sync', richText: [] },
  ]);
  apply([{ type: 'block.unsync', id: 'ref1' }]);
  const otherBlocks = w.snapshot().objects.filter(item => item.kind === 'block' && item.parentId === 'other' && item.alive).sort((a, b) => a.position - b.position);
  assert.deepEqual(otherBlocks.map(item => item.richText[0]?.text), ['공유 내용', '끝']);
  assert.equal(w.snapshot().objects.find(item => item.id === 'ref1').alive, false);
  apply([{ type: 'block.unsync', id: 'sync' }]);
  const pageBlocks = w.snapshot().objects.filter(item => item.kind === 'block' && item.parentId === 'p' && item.alive);
  assert.ok(pageBlocks.some(item => item.id === 's1'));
  assert.equal(w.snapshot().objects.find(item => item.id === 'sync').alive, false);
  assert.ok(w.snapshot().objects.some(item => item.kind === 'block' && item.parentId === 'third' && item.alive && item.richText[0]?.text === '공유 내용'));
  assert.throws(() => apply([{ type: 'block.unsync', id: 's1' }]), /동기화/);
});

test('the bundle keeps block extras, comment replies, text attachments and picture links', t => {
  const { w, apply } = fixture(t);
  apply([
    { type: 'block.create', id: 'call', parentId: 'p', blockType: 'callout', icon: '💡', color: 'red_background', richText: [{ text: '알림 ' }, { text: ':party:', customEmoji: 'attachment:pic' }] },
    { type: 'block.create', id: 'img', parentId: 'p', blockType: 'image', attachmentId: 'attachment:pic', richText: [], width: 200, href: '?id=p', mask: 'rounded' },
    { type: 'block.create', id: 'bm', parentId: 'p', blockType: 'bookmark', url: 'https://example.com', richText: [], bookmark: { url: 'https://example.com', title: '예시', description: '', siteName: 'example.com', imageAttachmentId: 'attachment:pic' } },
    { type: 'comment.create', id: 'c1', parentId: 'call', richText: [{ text: '질문' }] },
    { type: 'comment.create', id: 'c2', parentId: 'call', threadId: 'c1', richText: [{ text: '답' }] },
    { type: 'version.name', pageId: 'p', revision: 1, name: '처음' },
  ]);
  const bundle = w.export({ id: 'p', format: 'bundle' });
  const plan = w.previewImport({ format: 'bundle', text: bundle.text });
  apply(plan.operations);
  const objects = w.snapshot().objects;
  const copies = objects.filter(item => item.kind === 'page' && item.title === '미디어');
  assert.equal(copies.length, 2);
  const copy = copies.find(item => item.id !== 'p');
  assert.equal(copy.versionNames, undefined);
  const callout = objects.find(item => item.kind === 'block' && item.parentId === copy.id && item.blockType === 'callout');
  assert.equal(callout.icon, '💡');
  assert.equal(callout.color, 'red_background');
  const emojiRun = callout.richText.find(run => run.customEmoji);
  assert.ok(emojiRun && objects.find(item => item.id === emojiRun.customEmoji)?.kind === 'attachment');
  const image = objects.find(item => item.kind === 'block' && item.parentId === copy.id && item.blockType === 'image');
  assert.equal(image.href, `?id=${encodeURIComponent(copy.id)}`);
  assert.equal(image.mask, 'rounded');
  const reply = objects.find(item => item.kind === 'comment' && item.richText[0]?.text === '답' && item.id !== 'c2');
  assert.ok(reply && objects.find(item => item.id === reply.threadId)?.richText[0].text === '질문');
});

test('downloaded files are recognised by their first bytes when the server says little', () => {
  assert.equal(sniffType(png, 'application/octet-stream'), 'image/png');
  assert.equal(sniffType(Buffer.from('%PDF-1.7'), ''), 'application/pdf');
  assert.equal(sniffType(Buffer.from('plain text'), 'text/plain; charset=utf-8'), 'text/plain');
});
