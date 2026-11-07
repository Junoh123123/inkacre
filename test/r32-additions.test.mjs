import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r32 (coverage phase 7): link mentions keep their site and description, date mentions their time zone; custom emoji
// as reactions travel with a page; a dashboard filter shared by every widget; variables in buttons, in "edit pages"
// values and in webhook bodies.
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r32-'));
  const w = new Workspace(directory); let i = 0;
  const apply = (operations, actor = 'user') => w.execute({ id: `r32-${++i}`, actor, expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'home', title: '홈' },
    { type: 'page.create', id: 'db', title: '작업', parentId: 'home' },
    { type: 'source.create', id: 's', pageId: 'db', name: '작업', titlePropertyId: 'title' },
    { type: 'property.create', id: 'n', sourceId: 's', name: '점수', propertyType: 'number' },
    { type: 'property.create', id: 'note', sourceId: 's', name: '메모', propertyType: 'text' },
    { type: 'view.create', id: 'v', sourceId: 's', parentId: 'db', name: '표', viewType: 'table', config: {} },
    { type: 'page.create', id: 'a', title: '가', sourceId: 's' }, { type: 'value.set', pageId: 'a', propertyId: 'n', value: 3 },
    { type: 'page.create', id: 'b', title: '나', sourceId: 's' }, { type: 'value.set', pageId: 'b', propertyId: 'n', value: 9 },
    { type: 'page.create', id: 'db2', title: '기록', parentId: 'home' },
    { type: 'source.create', id: 's2', pageId: 'db2', name: '기록', titlePropertyId: 'title2' },
    { type: 'property.create', id: 'n2', sourceId: 's2', name: '점수', propertyType: 'number' },
    { type: 'view.create', id: 'v2', sourceId: 's2', parentId: 'db2', name: '표', viewType: 'table', config: {} },
  ]);
  return { w, apply, get: id => w.snapshot().objects.find(item => item.id === id), objects: () => w.snapshot().objects };
}
const upload = (w, name, commandId) => {
  const blob = w.putBlob(png);
  w.execute({ id: commandId, actor: 'user', expectedRevision: w.revision, operations: [{ type: 'attachment.register', id: `attachment:${commandId}`, name, mediaType: 'image/png', ...blob }] });
  return `attachment:${commandId}`;
};

test('a link mention keeps its site and description, a date mention its time zone', t => {
  const { apply, get } = fixture(t);
  apply([{ type: 'block.create', id: 'p', parentId: 'home', blockType: 'paragraph', richText: [
    { text: '예시', href: 'https://example.com', mention: true, linkSite: 'Example', linkDescription: '예시 사이트 설명' },
    { text: ' ' },
    { text: '11월 3일 9:00', date: '2026-11-03T09:00:00-05:00', dateZone: 'America/New_York' },
  ] }]);
  const runs = get('p').richText;
  assert.equal(runs[0].linkSite, 'Example');
  assert.equal(runs[0].linkDescription, '예시 사이트 설명');
  assert.equal(runs[2].dateZone, 'America/New_York');
  assert.throws(() => apply([{ type: 'block.update', id: 'p', richText: [{ text: 'x', linkDescription: 'y'.repeat(600) }] }]));
});

test('custom emoji reactions travel with the page and point at the copied picture', t => {
  const { w, apply } = fixture(t);
  const emoji = upload(w, 'party.png', 'emoji-upload');
  apply([{ type: 'emoji.set', name: 'party', attachmentId: emoji }]);
  apply([{ type: 'block.create', id: 'p', parentId: 'home', blockType: 'paragraph', richText: [{ text: '본문' }] },
    { type: 'comment.create', id: 'c', parentId: 'p', richText: [], reactions: [`attachment:${emoji}`, '👍'] }]);
  const bundle = w.export({ id: 'home', format: 'bundle' });
  const parsed = JSON.parse(bundle.text);
  assert.ok(parsed.objects.some(item => item.id === emoji && item.kind === 'attachment'));
  const plan = w.previewImport({ format: 'bundle', text: bundle.text, parentId: null, title: '' });
  w.execute({ id: 'import', actor: 'user', expectedRevision: w.revision, operations: plan.operations });
  const copies = w.snapshot().objects.filter(item => item.kind === 'comment' && item.id !== 'c' && item.reactions?.includes('👍'));
  assert.equal(copies.length, 1);
  const copied = copies[0].reactions.find(item => item.startsWith('attachment:'));
  assert.ok(copied && copied !== `attachment:${emoji}`);
  assert.equal(w.snapshot().objects.find(item => item.id === copied.slice(11))?.kind, 'attachment');
});

test('a dashboard filter shared by every widget is checked, copied and imported', t => {
  const { w, apply, get } = fixture(t);
  apply([{ type: 'view.create', id: 'dash', sourceId: 's', parentId: 'db', name: '대시보드', viewType: 'dashboard', config: { widgets: ['v', 'v2'], dashboardShared: { sourceId: 's', filter: { propertyId: 'n', op: 'gt', value: 5 } } } }]);
  assert.equal(get('dash').config.dashboardShared.sourceId, 's');
  assert.throws(() => apply([{ type: 'view.update', id: 'dash', config: { ...get('dash').config, dashboardShared: { sourceId: 's', filter: { propertyId: 'n2', op: 'gt', value: 5 } } } }]), /DASHBOARD_FILTER|대시보드/);
  apply([{ type: 'view.update', id: 'dash', config: { ...get('dash').config, dashboardShared: null } }]);
  assert.equal(get('dash').config.dashboardShared ?? null, null);
  apply([{ type: 'view.update', id: 'dash', config: { ...get('dash').config, dashboardShared: { sourceId: 's', filter: { all: [{ propertyId: 'n', op: 'gt', value: 5 }] } }, dashboardFilters: { s2: { propertyId: 'n2', op: 'lt', value: 4 } }, dashboardRows: [['v'], ['v2']] } }]);
  const bundle = w.export({ id: 'home', format: 'bundle' });
  const plan = w.previewImport({ format: 'bundle', text: bundle.text, parentId: null, title: '' });
  w.execute({ id: 'import', actor: 'user', expectedRevision: w.revision, operations: plan.operations });
  const copy = w.snapshot().objects.find(item => item.kind === 'view' && item.viewType === 'dashboard' && item.id !== 'dash');
  assert.ok(copy);
  assert.notEqual(copy.config.dashboardShared.sourceId, 's');
  assert.notEqual(copy.config.dashboardShared.filter.all[0].propertyId, 'n');
  assert.deepEqual(copy.config.dashboardRows.flat().sort(), [...copy.config.widgets].sort());
  assert.equal(Object.keys(copy.config.dashboardFilters).length, 1);
  assert.notEqual(Object.keys(copy.config.dashboardFilters)[0], 's2');
});

test('variables reach button actions, "edit pages" values and webhook bodies', t => {
  const { w, apply, get, objects } = fixture(t);
  apply([{ type: 'block.create', id: 'btn', parentId: 'home', blockType: 'button', button: { label: '실행', actions: [
    { action: 'define_variables', variables: [{ id: 'x', name: '기준', mode: 'formula', value: '4 + 3' }, { id: 'msg', name: '문구', mode: 'text', value: '점검' }] },
    { action: 'edit_pages', sourceId: 's', filter: { propertyId: 'n', op: 'gt', value: 0 }, propertyId: 'note', value: { $formula: 'prop("기준") * 2' } },
    { action: 'edit_pages', sourceId: 's', filter: { propertyId: 'n', op: 'gt', value: 5 }, propertyId: 'n', value: { $variable: 'x' } },
    { action: 'send_webhook', url: 'https://example.com/hook', body: { text: '{{var:msg}} 완료', nested: ['{{var:x}}'] } },
  ] } }]);
  apply([{ type: 'button.run', id: 'btn', confirmed: true }]);
  assert.equal(get('a').values.note, '14');
  assert.equal(get('b').values.note, '14');
  assert.equal(get('b').values.n, 7);
  assert.equal(get('a').values.n, 3);
  const delivery = objects().find(item => item.kind === 'delivery');
  assert.equal(delivery.body.text, '점검 완료');
  assert.deepEqual(delivery.body.nested, ['7']);
  void w;
});

test('"edit pages" can take its pages from a variable or a formula (a relation, say)', t => {
  const { apply, get } = fixture(t);
  apply([
    { type: 'property.create', id: 'rel', sourceId: 's2', name: '작업', propertyType: 'relation', targetSourceId: 's' },
    { type: 'page.create', id: 'log', title: '기록 1', sourceId: 's2' },
    { type: 'relation.set', pageId: 'log', propertyId: 'rel', targetIds: ['b'] },
    { type: 'property.create', id: 'btnprop', sourceId: 's2', name: '실행', propertyType: 'button', button: { label: '표시', actions: [
      { action: 'define_variables', variables: [{ id: 'linked', name: '연결', mode: 'formula', value: 'prop("작업")' }] },
      { action: 'edit_pages', sourceId: 's', filter: { all: [] }, propertyId: 'note', value: '연결됨', pages: { $variable: 'linked' } },
      { action: 'edit_pages', sourceId: 's', filter: { all: [] }, propertyId: 'n', value: 1, pages: { $formula: 'prop("작업")' } },
    ] } },
  ]);
  apply([{ type: 'button.run', id: 'btnprop', pageId: 'log', confirmed: true }]);
  assert.equal(get('b').values.note, '연결됨');
  assert.equal(get('b').values.n, 1);
  assert.equal(get('a').values.note ?? null, null);
  assert.equal(get('a').values.n, 3);
});

test('dashboard widget sizes and form button settings are kept, checked and copied', t => {
  const { w, apply, get } = fixture(t);
  apply([{ type: 'view.create', id: 'dash', sourceId: 's', parentId: 'db', name: '대시보드', viewType: 'dashboard', config: { widgets: ['v', 'v2'], dashboardSizes: { v: { width: 2, height: 400 }, v2: { width: 1 } } } },
    { type: 'view.create', id: 'form', sourceId: 's', parentId: 'db', name: '양식', viewType: 'form', config: { form: { title: '신청', submitLabel: '보내기', submitColor: 'green', confirmationTitle: '고맙습니다', confirmation: '곧 연락드릴게요', questions: [] } } }]);
  assert.equal(get('dash').config.dashboardSizes.v.width, 2);
  assert.equal(get('form').config.form.submitColor, 'green');
  assert.throws(() => apply([{ type: 'view.update', id: 'dash', config: { ...get('dash').config, dashboardSizes: { nope: { width: 1 } } } }]), /DASHBOARD_LAYOUT|대시보드/);
  assert.throws(() => apply([{ type: 'view.update', id: 'form', config: { form: { ...get('form').config.form, submitColor: 'neon' } } }]));
  const bundle = w.export({ id: 'home', format: 'bundle' });
  const plan = w.previewImport({ format: 'bundle', text: bundle.text, parentId: null, title: '' });
  w.execute({ id: 'import', actor: 'user', expectedRevision: w.revision, operations: plan.operations });
  const copy = w.snapshot().objects.find(item => item.kind === 'view' && item.viewType === 'dashboard' && item.id !== 'dash');
  assert.deepEqual(Object.keys(copy.config.dashboardSizes).sort(), [...copy.config.widgets].sort());
});

test('a ZIP whose pages point at pictures the import window uploaded shows them as pictures', async t => {
  const { w } = fixture(t);
  const picture = upload(w, 'photo.png', 'zip-picture');
  const { zipSync, strToU8 } = await import('fflate');
  const zip = Buffer.from(zipSync({ '보고서.html': strToU8(`<h1>보고서</h1><p>본문</p><img src="/api/attachments/${encodeURIComponent(picture)}" alt="사진">`) })).toString('base64');
  const plan = w.previewImport({ format: 'zip', text: zip, parentId: null, title: '압축' });
  w.execute({ id: 'zip-import', actor: 'user', expectedRevision: w.revision, operations: plan.operations });
  const image = w.snapshot().objects.find(item => item.kind === 'block' && item.blockType === 'image' && item.attachmentId === picture);
  assert.ok(image);
});

test('text in actions can name any page, a chosen date and a formula', t => {
  const { apply, objects } = fixture(t);
  apply([{ type: 'block.create', id: 'btn2', parentId: 'home', blockType: 'button', button: { label: '알림', actions: [
    { action: 'notify', message: '{{page:db}} · {{date:2026-11-03}} · {{=2 * 21}}' },
  ] } }]);
  apply([{ type: 'button.run', id: 'btn2', confirmed: true }]);
  const note = objects().find(item => item.kind === 'notification');
  assert.equal(note.message, '[[page:db]] · 2026-11-03 · 42');
});

test('a text value set by an action can carry @ mentions and formulas', t => {
  const { apply, get } = fixture(t);
  apply([{ type: 'automation.create', id: 'auto', sourceId: 's', name: '메모 채우기', triggers: [{ type: 'property_edited', propertyId: 'n' }], actions: [
    { action: 'set_property', propertyId: 'note', value: '점수 {{n}} · {{=prop("점수") * 10}} · {{page:db}}' },
  ] }]);
  apply([{ type: 'value.set', pageId: 'a', propertyId: 'n', value: 4 }]);
  assert.deepEqual(get('a').values.note, [{ text: '점수 4 · 40 · ' }, { text: '작업', pageId: 'db' }]);
});
