import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { deflateRawSync, crc32 } from 'node:zlib';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';
import { findBrowser, planPdfExport } from '../src/pdf-export.mjs';

// r33 (31차, the last two offline gaps): PDF export planned page by page (with a headless browser when one is here),
// a large ZIP imported in pieces (documents as text, files streamed into the blob store with their size and CRC
// checked, one command at the end), table rows imported in one operation, and attachments served in byte ranges.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r33-'));
  const w = new Workspace(directory); let i = 0;
  const apply = (operations, actor = 'user') => w.execute({ id: `r33-${++i}`, actor, expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  return { w, apply, objects: () => w.snapshot().objects };
}
async function serve(t, w) {
  const server = createLocalServer(w); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeEventStreams?.(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const raw = async (route, bytes) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes }); return { status: response.status, body: await response.json() }; };
  return { base, post, raw };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('a PDF export lists each page beside its folder: subpages, database rows and the page’s own pictures', t => {
  const { w, apply } = fixture(t);
  const blob = w.putBlob(png);
  apply([
    { type: 'page.create', id: 'root', title: '보고서' },
    { type: 'attachment.register', id: 'img', name: '그림.png', mediaType: 'image/png', ...blob },
    { type: 'block.create', id: 'b1', parentId: 'root', blockType: 'image', attachmentId: 'img' },
    { type: 'page.create', id: 'sub', title: '부록', parentId: 'root' },
    { type: 'page.create', id: 'sub2', title: '부록', parentId: 'root' },
    { type: 'page.create', id: 'tpl', title: '틀', parentId: 'root', template: true },
    { type: 'page.create', id: 'db', title: '할 일', parentId: 'root' },
    { type: 'source.create', id: 'src', pageId: 'db', name: '작업', titlePropertyId: 'title' },
    { type: 'page.create', id: 'row', title: '첫/작업', sourceId: 'src' },
  ]);
  const plan = w.read(state => planPdfExport(state, { id: 'root', subpages: true, files: true }));
  assert.deepEqual(plan.pages.map(page => page.path), ['보고서.pdf', '보고서/부록.pdf', '보고서/부록 2.pdf', '보고서/할 일.pdf', '보고서/할 일/작업/첫 작업.pdf']);
  assert.deepEqual(plan.pages[0].assets, [{ id: 'img', folder: '보고서/' }]);
  assert.equal(plan.zip, true);
  const single = w.read(state => planPdfExport(state, { id: 'sub', files: true }));
  assert.deepEqual(single.pages.map(page => page.path), ['부록.pdf']);
  assert.equal(single.zip, false);
  assert.deepEqual(w.read(state => planPdfExport(state, { id: 'root', subpages: true, files: false })).pages[0].assets, []);
  assert.throws(() => w.read(state => planPdfExport(state, { id: 'img' })), /EXPORT_TARGET|페이지/);
  assert.equal(findBrowser({ PAGEYARD_BROWSER: '/nowhere/chrome' }), null);
  assert.equal(findBrowser({ PATH: '' }, 'linux'), null);
});

const chromium = process.env.PAGEYARD_BROWSER ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
test('with a browser on this computer, the PDFs are made in the background and fetched once done', { skip: !existsSync(chromium) && 'no Chromium here' }, async t => {
  process.env.PAGEYARD_BROWSER = chromium;
  t.after(() => { delete process.env.PAGEYARD_BROWSER; });
  const { w, apply } = fixture(t);
  apply([{ type: 'page.create', id: 'root', title: '보고서' }, { type: 'block.create', id: 'b', parentId: 'root', blockType: 'paragraph', richText: [{ text: '본문' }] }, { type: 'page.create', id: 'sub', title: '부록', parentId: 'root' }]);
  const { base, post } = await serve(t, w);
  assert.equal((await (await fetch(`${base}/api/export/pdf`)).json()).available, true);
  let job = (await post('/api/export/pdf', { id: 'root', subpages: true, prefs: { 'pageyard-language': 'ko', 'other-key': 'x' } })).body;
  assert.equal(job.total, 2);
  while (job.status === 'running') { await new Promise(resolve => setTimeout(resolve, 200)); job = await (await fetch(`${base}/api/export/pdf/${job.id}`)).json(); }
  assert.equal(job.status, 'done', JSON.stringify(job.error));
  assert.equal(job.filename, '보고서.zip');
  const files = unzipSync(new Uint8Array(await (await fetch(`${base}/api/export/pdf/${job.id}/file`)).arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['보고서.pdf', '보고서/부록.pdf']);
  assert.equal(Buffer.from(files['보고서.pdf'].subarray(0, 5)).toString(), '%PDF-');
  assert.equal((await post('/api/export/pdf', { id: 'nothing' })).body.error.code, 'EXPORT_TARGET');
});

test('a ZIP imported in pieces: documents as text, files streamed and checked, one command for the pages', async t => {
  const { w, objects } = fixture(t);
  const { post, raw } = await serve(t, w);
  const start = await post('/api/import/archive', { title: '자료' });
  assert.equal(start.status, 201);
  const id = start.body.id;
  const id32 = '0123456789abcdef0123456789abcdef';
  assert.equal((await post(`/api/import/archive/${id}/documents`, { documents: [
    { path: `보고서 ${id32}.md`, text: `# 보고서\n\n![그림](${encodeURIComponent(`보고서 ${id32}`)}/${encodeURIComponent('그림.png')})\n` },
    { path: '표/점수.csv', text: '이름,점수\n가,1\n나,2\n' },
  ] })).status, 200);
  // A deflated picture, a stored text file in a folder with no document of its name.
  const deflated = deflateRawSync(png);
  const sent = await raw(`/api/import/archive/${id}/file?${new URLSearchParams({ path: `보고서 ${id32}/그림.png`, method: '8', size: String(png.length), crc: String(crc32(png)), type: 'image/png' })}`, deflated);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const text = Buffer.from('메모 내용');
  assert.equal((await raw(`/api/import/archive/${id}/file?${new URLSearchParams({ path: '기타/메모.bin', method: '0', size: String(text.length), crc: String(crc32(text)) })}`, text)).status, 201);
  // Refused: a wrong CRC, more bytes than declared, the same path twice, a path out of the archive, a non-document as text.
  const wrongCrc = await raw(`/api/import/archive/${id}/file?${new URLSearchParams({ path: 'a.bin', method: '0', size: '3', crc: '1' })}`, Buffer.from('abc'));
  assert.equal(wrongCrc.body.error.code, 'ZIP_DATA');
  const swollen = await raw(`/api/import/archive/${id}/file?${new URLSearchParams({ path: 'b.bin', method: '8', size: '10' })}`, deflateRawSync(Buffer.alloc(5000)));
  assert.equal(swollen.body.error.code, 'ZIP_DATA');
  assert.equal((await post(`/api/import/archive/${id}/documents`, { documents: [{ path: '표/점수.csv', text: 'x' }] })).body.error.code, 'ZIP_PATH');
  assert.equal((await post(`/api/import/archive/${id}/documents`, { documents: [{ path: '../밖.md', text: 'x' }] })).body.error.code, 'ZIP_PATH');
  assert.equal((await post(`/api/import/archive/${id}/documents`, { documents: [{ path: '그림.png', text: 'x' }] })).body.error.code, 'IMPORT_FORMAT');
  const before = w.revision;
  const preview = await post(`/api/import/archive/${id}/preview`, {});
  assert.equal(preview.status, 200);
  assert.equal(w.revision, before);
  assert.equal(preview.body.rows, 2);
  assert.equal(preview.body.attachments, 2);
  assert.ok(preview.body.changes.some(change => change.title === '보고서'));
  const committed = await post(`/api/import/archive/${id}/commit`, { commandId: 'zip-1', actor: 'user', expectedRevision: w.revision });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(w.revision, before + 1);
  const all = objects(), root = all.find(item => item.id === committed.body.pageId);
  assert.equal(root.title, '자료');
  const report = all.find(item => item.kind === 'page' && item.title === '보고서');
  const picture = all.find(item => item.kind === 'block' && item.parentId === report.id && item.blockType === 'image');
  assert.equal(all.find(item => item.id === picture.attachmentId).bytes, png.length);
  const folder = all.find(item => item.kind === 'page' && item.title === '기타' && item.parentId === root.id);
  const memo = all.find(item => item.kind === 'block' && item.parentId === folder.id && item.blockType === 'file');
  assert.equal(all.find(item => item.id === memo.attachmentId).name, '메모.bin');
  const table = all.find(item => item.kind === 'page' && item.title === '점수');
  const source = all.find(item => item.kind === 'source' && item.parentId === table.id);
  assert.deepEqual(all.filter(item => item.kind === 'page' && item.sourceId === source.id).map(item => item.title).sort(), ['가', '나']);
  // The session is gone; the import undoes as one command.
  assert.equal((await post(`/api/import/archive/${id}/preview`, {})).status, 404);
  w.undo({ id: 'undo-zip', actor: 'user', expectedRevision: w.revision, targetCommandId: 'zip-1' });
  assert.equal(objects().filter(item => item.kind === 'page' && item.alive !== false && item.title === '보고서').length, 0);
});

test('a bundle may name a blob already in the store instead of carrying its bytes; not one that is missing', t => {
  const { w, apply, objects } = fixture(t);
  const blob = w.putBlob(png);
  assert.equal(w.hasBlob(blob.sha256, blob.bytes), true);
  assert.equal(w.hasBlob(blob.sha256, blob.bytes + 1), false);
  assert.equal(w.hasBlob('../escape', 1), false);
  const bundle = { format: 'pageyard-bundle', version: 1, rootId: 'p', objects: [{ id: 'p', kind: 'page', title: '그림', parentId: null, sourceId: null, values: {}, template: false }, { id: 'a', kind: 'attachment', name: 'x.png', mediaType: 'image/png', sha256: blob.sha256, bytes: blob.bytes }], blobs: {} };
  apply([{ type: 'content.import_bundle', bundle, idMap: { p: 'p2', a: 'a2' } }]);
  assert.equal(objects().find(item => item.id === 'a2').sha256, blob.sha256);
  const missing = structuredClone(bundle); missing.objects[1].sha256 = 'f'.repeat(64);
  assert.throws(() => apply([{ type: 'content.import_bundle', bundle: missing, idMap: { p: 'p3', a: 'a3' } }]), /IMPORT_ATTACHMENT|첨부/);
});

test('table rows import in one operation: a new database of 1,000 rows, and 600 rows merged into one', t => {
  const { w, apply, objects } = fixture(t);
  const csv = ['이름,점수', ...Array.from({ length: 1000 }, (_, i) => `행 ${i},${i}`)].join('\n');
  const plan = w.previewImport({ format: 'csv', text: csv, title: '큰 표' });
  assert.ok(plan.operations.length < 10);
  apply(plan.operations);
  const source = objects().find(item => item.kind === 'source' && item.name === '큰 표');
  assert.equal(objects().filter(item => item.kind === 'page' && item.sourceId === source.id).length, 1000);
  const merged = w.previewImport({ format: 'csv', text: ['이름,점수', ...Array.from({ length: 600 }, (_, i) => `추가 ${i},${i}`)].join('\n'), sourceId: source.id });
  apply(merged.operations);
  assert.equal(objects().filter(item => item.kind === 'page' && item.sourceId === source.id).length, 1600);
  assert.throws(() => apply([{ type: 'source.import_rows', sourceId: 'nowhere', rows: [{ id: 'x', title: 'x', values: {} }] }]));
});

test('a ZIP of the old kind (in one piece) puts files no page shows on their folder’s page', t => {
  const { w, apply, objects } = fixture(t);
  const zip = Buffer.from(zipSync({ '사진/여행/바다.png': png, '사진/설명.md': strToU8('# 설명') })).toString('base64');
  const plan = w.previewImport({ format: 'zip', text: zip, title: '앨범' });
  apply(plan.operations);
  const all = objects(), trip = all.find(item => item.kind === 'page' && item.title === '여행'), photos = all.find(item => item.kind === 'page' && item.title === '사진');
  assert.equal(trip.parentId, photos.id);
  assert.ok(all.some(item => item.kind === 'block' && item.parentId === trip.id && item.blockType === 'image'));
});

test('attachments answer byte ranges (players seek in large videos)', async t => {
  const { w, apply } = fixture(t);
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  const blob = w.putBlob(bytes);
  apply([{ type: 'attachment.register', id: 'f', name: 'clip.bin', mediaType: 'video/mp4', ...blob }]);
  const { base } = await serve(t, w);
  const part = await fetch(`${base}/api/attachments/f`, { headers: { Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], Array.from({ length: 10 }, (_, i) => i + 10));
  const tail = await fetch(`${base}/api/attachments/f`, { headers: { Range: 'bytes=-5' } });
  assert.equal(tail.headers.get('content-range'), 'bytes 995-999/1000');
  assert.equal((await fetch(`${base}/api/attachments/f`, { headers: { Range: 'bytes=2000-' } })).status, 416);
  const whole = await fetch(`${base}/api/attachments/f`);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
});
