// Disposable synthetic data only; the normal workspace is never opened.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-task-ui-')), workspace = new Workspace(directory);
workspace.execute({ id: 'task-ui-fixture', actor: 'fixture', expectedRevision: 0, operations: [
  { type: 'page.create', id: 'task-root', title: '업무 구조 검증 · 격리 합성 자료' },
  { type: 'source.create', id: 'task-work', pageId: 'task-root', name: '합성 업무', titlePropertyId: 'task-name' },
  { type: 'property.create', id: 'task-date', sourceId: 'task-work', name: '일정', propertyType: 'date' },
  ...[['task-a', 'A 설계'], ['task-b', 'B 제작'], ['task-c', 'C 검증']].map(([id, title]) => ({ type: 'page.create', id, title, sourceId: 'task-work' })),
  ...[['task-a','19','20'], ['task-b','22','23'], ['task-c','26','27']].map(([pageId, start, end]) => ({ type: 'value.set', pageId, propertyId: 'task-date', value: { start: `2026-10-${start}`, end: `2026-10-${end}`, timeZone: 'Asia/Tokyo' } })),
  { type: 'block.create', id: 'task-body', parentId: 'task-b', richText: [{ text: '원문 유지: 제작 지침' }] },
  { type: 'view.create', id: 'task-tree', sourceId: 'task-work', parentId: 'task-root', name: '업무 계층', config: { visibleProperties: ['task-name', 'task-date'] } },
  { type: 'view.create', id: 'task-timeline', sourceId: 'task-work', parentId: 'task-root', name: '업무 일정', viewType: 'timeline', config: { datePropertyId: 'task-date' } },
  { type: 'view.create', id: 'task-gallery', sourceId: 'task-work', parentId: 'task-root', name: '업무 카드', viewType: 'gallery', config: { visibleProperties: ['task-name', 'task-date'] } },
] });
const server = createLocalServer(workspace);
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/?id=task-tree`, directory, revision: workspace.revision, synthetic: true })));
const stop = () => { server.closeEventStreams(); server.close(() => { workspace.close(); rmSync(directory, { recursive: true, force: true }); process.exit(0); }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
