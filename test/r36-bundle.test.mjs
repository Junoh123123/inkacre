import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { Workspace } from '../src/workspace.mjs';

// Bundles retain the Pageyard format and ZIP marker. Standalone exports use an Inkacre filename.
// Both filenames are recognized in ZIPs, and imported content survives reopening the workspace.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r36-'));
  let w = new Workspace(directory), i = 0;
  const apply = operations => w.execute({ id: `r36-${++i}`, actor: 'user', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  const reopen = () => { w.close(); w = new Workspace(directory); return w; };
  return { get w() { return w; }, apply, reopen, titles: () => w.snapshot().objects.filter(item => item.kind === 'page' && item.alive !== false).map(item => item.title).sort() };
}

test('exports carry the bundle format and file name, and come back in alone or inside their ZIP', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'root', title: '보고서' }]);
  const bundle = f.w.export({ id: 'root', format: 'bundle' });
  assert.equal(bundle.filename, '보고서.inkacre.json');
  assert.equal(JSON.parse(bundle.text).format, 'pageyard-bundle');
  const zip = unzipSync(new Uint8Array(Buffer.from(f.w.export({ id: 'root', format: 'zip' }).text, 'base64')));
  assert.ok('workspace.pageyard.json' in zip);
  f.apply(f.w.previewImport({ format: 'bundle', text: bundle.text }).operations);
  f.apply(f.w.previewImport({ format: 'zip', text: f.w.export({ id: 'root', format: 'zip' }).text }).operations);
  const standaloneZip = Buffer.from(zipSync({ [bundle.filename]: strToU8(bundle.text) })).toString('base64');
  f.apply(f.w.previewImport({ format: 'zip', text: standaloneZip }).operations);
  assert.deepEqual(f.titles(), ['보고서', '보고서', '보고서', '보고서']);
});

test('a ZIP of documents imports; another bundle format is refused; imports stay after reopening', t => {
  const f = fixture(t);
  const plain = Buffer.from(zipSync({ '메모.md': strToU8('# 메모\n\n본문') })).toString('base64');
  f.apply(f.w.previewImport({ format: 'zip', text: plain, title: '압축' }).operations);
  f.apply([{ type: 'content.import_bundle', bundle: { format: 'pageyard-bundle', version: 1, rootId: 'p', objects: [{ id: 'p', kind: 'page', title: '묶음', parentId: null, sourceId: null, values: {}, template: false }], blobs: {} }, idMap: { p: 'from-bundle' } }]);
  const before = f.titles();
  assert.ok(before.includes('메모') && before.includes('묶음'));
  f.reopen();
  assert.deepEqual(f.titles(), before);
  const other = { format: 'other-bundle', version: 1, rootId: 'p', objects: [], blobs: {} };
  assert.throws(() => f.w.previewImport({ format: 'bundle', text: JSON.stringify(other) }), error => error.code === 'IMPORT_BUNDLE');
  assert.throws(() => f.w.previewImport({ format: 'notes_zip', text: plain }));
});
