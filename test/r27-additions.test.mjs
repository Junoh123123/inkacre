import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { Workspace } from '../src/workspace.mjs';

// r27 (coverage phase 2): readable exports — Markdown & CSV or HTML, subpages in folders or
// flat, a full-page database as its CSV (current or default view) with its rows beside it, files left in or out,
// comments in HTML, the whole workspace at once — and HTML imports that use pictures uploaded beforehand.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r27-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r27-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  const blob = w.putBlob(Buffer.from('PNGDATA'));
  apply([
    { type: 'page.create', id: 'root', title: '노트' },
    { type: 'block.create', id: 'b1', parentId: 'root', blockType: 'paragraph', richText: [{ text: '보기: ' }, { text: '하위', pageId: 'sub' }] },
    { type: 'attachment.register', id: 'attachment:pic', name: '그림.png', mediaType: 'image/png', ...blob },
    { type: 'block.create', id: 'b2', parentId: 'root', blockType: 'image', richText: [], attachmentId: 'attachment:pic' },
    { type: 'block.create', id: 'b3', parentId: 'root', blockType: 'callout', icon: '💡', richText: [{ text: '알림' }] },
    { type: 'page.create', id: 'sub', title: '하위', parentId: 'root' },
    { type: 'page.create', id: 'dbp', title: '작업', parentId: 'root' },
    { type: 'source.create', id: 's', pageId: 'dbp', name: '작업', titlePropertyId: 's-t' },
    { type: 'property.create', id: 's-n', sourceId: 's', name: '점수', propertyType: 'number' },
    { type: 'view.create', id: 'v', sourceId: 's', parentId: 'dbp', name: '높음', viewType: 'table', config: { filter: { propertyId: 's-n', op: 'gt', value: 5 } } },
    { type: 'page.create', id: 'r1', title: '가', sourceId: 's' }, { type: 'page.create', id: 'r2', title: '나', sourceId: 's' },
    { type: 'value.set', pageId: 'r1', propertyId: 's-n', value: 3 }, { type: 'value.set', pageId: 'r2', propertyId: 's-n', value: 9 },
    { type: 'comment.create', id: 'c1', parentId: 'b1', richText: [{ text: '좋은 생각' }] },
    { type: 'page.create', id: 'other', title: '다른 페이지' },
  ]);
  return { w, apply };
}
const unzip = result => Object.fromEntries(Object.entries(unzipSync(Buffer.from(result.text, 'base64'))).map(([name, bytes]) => [name, name.startsWith('files/') ? bytes : strFromU8(bytes)]));

test('one page alone is one Markdown file; links to pages left out keep their words', t => {
  const { w } = fixture(t);
  const result = w.export({ id: 'sub', format: 'markdown', subpages: false, files: true });
  assert.equal(result.filename, '하위.md');
  const root = w.export({ id: 'root', format: 'markdown', subpages: false, files: false });
  assert.equal(root.format, 'markdown');
  assert.match(root.text, /보기: 하위\n/);
  assert.doesNotMatch(root.text, /attachment-/);
});

test('subpages in folders, a full-page database as its CSV with rows beside it, files in files/', t => {
  const { w } = fixture(t);
  const files = unzip(w.export({ id: 'root', format: 'markdown', subpages: true, folders: true, files: true }));
  assert.deepEqual(Object.keys(files).sort(), ['files/그림.png', '노트.md', '노트/작업.csv', '노트/작업/가.md', '노트/작업/나.md', '노트/하위.md'].sort());
  assert.match(files['노트.md'], /\[하위\]\(%EB%85%B8%ED%8A%B8\/%ED%95%98%EC%9C%84\.md\)/);
  assert.match(files['노트.md'], /!\[[^\]]*\]\(files\/%EA%B7%B8%EB%A6%BC\.png\)/);
  assert.match(files['노트/작업/나.md'], /점수: 9/);
  assert.match(files['노트/작업.csv'], /"가","3"/);
  const flat = unzip(w.export({ id: 'root', format: 'markdown', subpages: true, folders: false, files: false }));
  assert.deepEqual(Object.keys(flat).sort(), ['가.md', '나.md', '노트.md', '작업.csv', '하위.md'].sort());
});

test('a database exports the current view (its filter) or every row', t => {
  const { w } = fixture(t);
  const current = unzip(w.export({ id: 's', format: 'markdown', viewId: 'v', files: true }));
  assert.match(current['작업.csv'], /"나","9"/);
  assert.doesNotMatch(current['작업.csv'], /"가"/);
  assert.ok(!('작업/가.md' in current));
  const all = unzip(w.export({ id: 's', format: 'markdown', files: true }));
  assert.match(all['작업.csv'], /"가","3"/);
});

test('HTML has styles, callouts, relative pictures and, when asked, comments', t => {
  const { w } = fixture(t);
  const files = unzip(w.export({ id: 'root', format: 'html', subpages: true, files: true, comments: true }));
  const html = files['노트.html'];
  assert.match(html, /<style>/);
  assert.match(html, /<aside class="callout">💡 알림<\/aside>/);
  assert.match(html, /<img src="files\/%EA%B7%B8%EB%A6%BC\.png"/);
  assert.match(html, /class="comments".*좋은 생각/s);
  const plain = unzip(w.export({ id: 'root', format: 'html', subpages: true, files: false }));
  assert.doesNotMatch(plain['노트.html'], /<img|class="comments"/);
});

test('the whole workspace ("*") exports every top-level page', t => {
  const { w } = fixture(t);
  const files = unzip(w.export({ id: '*', format: 'markdown', files: true }));
  assert.ok('노트.md' in files && '다른 페이지.md' in files && '노트/하위.md' in files);
  assert.throws(() => w.export({ id: '*', format: 'bundle' }), /EXPORT_FORMAT|Markdown/);
});

test('an HTML import uses pictures already uploaded (/api/attachments/<id>)', t => {
  const { w } = fixture(t);
  const plan = w.previewImport({ format: 'html', title: '워드 문서', text: '<h1>제목</h1><p>본문</p><p><img src="/api/attachments/attachment%3Apic" alt="그림"></p>' });
  const image = plan.operations.find(operation => operation.blockType === 'image');
  assert.equal(image?.attachmentId, 'attachment:pic');
});
