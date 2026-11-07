// Disposable synthetic workspace with an "Items" database and five views; never opens the main data folder.
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const appRoot = path.resolve(process.argv[2]);
const { Workspace } = await import(pathToFileURL(path.join(appRoot, 'src/workspace.mjs')));
const { createLocalServer } = await import(pathToFileURL(path.join(appRoot, 'src/server.mjs')));
const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-items-')), workspace = new Workspace(directory);
workspace.execute({ id: 'items-fixture', actor: 'fixture', expectedRevision: 0, operations: [
  { type: 'page.create', id: 'items-root', title: '분석 실험 모음 2026-10-19' },
  { type: 'page.create', id: 'items-doc-a', parentId: 'items-root', title: 'Doc A — 편집 검증' },
  { type: 'source.create', id: 'items-db', pageId: 'items-doc-a', name: 'Items', titlePropertyId: 'items-name' },
  { type: 'property.create', id: 'items-amount', sourceId: 'items-db', name: 'Amount', propertyType: 'number' },
  { type: 'property.create', id: 'items-state', sourceId: 'items-db', name: 'State', propertyType: 'status', options: [{ id: 'todo', name: '未着手', group: '할 일' }, { id: 'doing', name: '進行中', group: '진행 중', color: 'blue' }, { id: 'done', name: '完了', group: '완료', color: 'green' }] },
  { type: 'property.create', id: 'items-due', sourceId: 'items-db', name: 'Due', propertyType: 'date' },
  { type: 'page.create', id: 'items-a1', sourceId: 'items-db', title: 'A1' }, { type: 'page.create', id: 'items-a2', sourceId: 'items-db', title: 'A2' }, { type: 'page.create', id: 'items-a3', sourceId: 'items-db', title: 'A3' },
  { type: 'value.set', pageId: 'items-a1', propertyId: 'items-amount', value: 10 }, { type: 'value.set', pageId: 'items-a2', propertyId: 'items-amount', value: 25 }, { type: 'value.set', pageId: 'items-a3', propertyId: 'items-amount', value: 5 },
  { type: 'value.set', pageId: 'items-a1', propertyId: 'items-state', value: 'done' }, { type: 'value.set', pageId: 'items-a2', propertyId: 'items-state', value: 'doing' }, { type: 'value.set', pageId: 'items-a3', propertyId: 'items-state', value: 'todo' },
  { type: 'value.set', pageId: 'items-a1', propertyId: 'items-due', value: { start: '2026-10-19', end: '2026-10-21', timeZone: 'Asia/Tokyo' } }, { type: 'value.set', pageId: 'items-a2', propertyId: 'items-due', value: { start: '2026-10-20', timeZone: 'Asia/Tokyo' } },
  { type: 'view.create', id: 'items-table', sourceId: 'items-db', parentId: 'items-doc-a', name: 'テーブルビュー', config: { visibleProperties: ['items-name', 'items-amount', 'items-state', 'items-due'] } },
  { type: 'view.create', id: 'items-board', sourceId: 'items-db', parentId: 'items-doc-a', name: 'Board', viewType: 'board', config: { groupBy: 'items-state', visibleProperties: ['items-name'] } },
  { type: 'view.create', id: 'items-gallery', sourceId: 'items-db', parentId: 'items-doc-a', name: 'Gallery', viewType: 'gallery', config: { visibleProperties: ['items-name'] } },
  { type: 'view.create', id: 'items-calendar', sourceId: 'items-db', parentId: 'items-doc-a', name: 'Calendar', viewType: 'calendar', config: { datePropertyId: 'items-due' } },
  { type: 'view.create', id: 'items-timeline', sourceId: 'items-db', parentId: 'items-doc-a', name: 'Timeline', viewType: 'timeline', config: { datePropertyId: 'items-due' } },
] });
const server = createLocalServer(workspace);
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}`, appRoot, directory, synthetic: true })));
const stop = () => { server.closeEventStreams(); server.close(() => { workspace.close(); rmSync(directory, { recursive: true, force: true }); process.exit(0); }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
