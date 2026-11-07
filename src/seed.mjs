import { pathToFileURL } from 'node:url';

export function demoOperations() {
  const sourceId = 'lab-items', parentId = 'lab-root';
  return [
    { type: 'page.create', id: parentId, title: '기능 검증 · 합성 자료' },
    { type: 'page.create', id: 'lab-doc', parentId, title: '문서 · 편집 및 공유 참조' },
    { type: 'block.create', id: 'lab-intro', parentId: 'lab-doc', blockType: 'heading2', richText: [{ text: '편집·저장·관계 검증' }] },
    { type: 'block.create', id: 'lab-body', parentId: 'lab-doc', richText: [{ text: '확인한 동작을 로컬 데이터로 검증합니다. ' }, { text: '이 문단은 합성 자료입니다.', bold: true }] },
    { type: 'source.create', id: sourceId, pageId: parentId, name: 'Lab Items', titlePropertyId: 'lab-name' },
    { type: 'property.create', id: 'lab-amount', sourceId, name: 'Amount', propertyType: 'number' },
    { type: 'property.create', id: 'lab-double', sourceId, name: 'Double', propertyType: 'formula', formula: 'prop("Amount") * 2' },
    { type: 'property.create', id: 'lab-state', sourceId, name: 'State', propertyType: 'status', options: [{ id: 'lab-todo', name: '대기', group: 'todo' }, { id: 'lab-progress', name: '진행', group: 'progress' }, { id: 'lab-done', name: '완료', group: 'complete' }] },
    { type: 'property.create', id: 'lab-due', sourceId, name: 'Due', propertyType: 'date' },
    { type: 'property.create', id: 'lab-notes', sourceId, name: 'Notes', propertyType: 'text' },
    { type: 'property.create', id: 'lab-files', sourceId, name: 'Files', propertyType: 'files' },
    { type: 'property.create', id: 'lab-done-check', sourceId, name: 'Done', propertyType: 'checkbox' },
    { type: 'property.create', id: 'lab-tags', sourceId, name: 'Tags', propertyType: 'multi_select', options: [{ id: 'lab-red', name: 'red' }, { id: 'lab-blue', name: 'blue' }] },
    { type: 'property.create', id: 'lab-link', sourceId, name: 'Link', propertyType: 'url' },
    { type: 'property.create', id: 'lab-place', sourceId, name: 'Place', propertyType: 'place' },
    { type: 'property.create', id: 'lab-related', sourceId, name: 'Related', propertyType: 'relation', targetSourceId: sourceId, inverse: { id: 'lab-backlinks', name: 'Backlinks' } },
    { type: 'property.create', id: 'lab-total', sourceId, name: 'RelatedAmount', propertyType: 'rollup', rollup: { relationPropertyId: 'lab-related', targetPropertyId: 'lab-amount', aggregation: 'sum' } },
    ...[1, 2, 3].map(index => ({ type: 'page.create', id: `lab-a${index}`, sourceId, title: `A${index}` })),
    ...[11, 25, 5].map((value, index) => ({ type: 'value.set', pageId: `lab-a${index + 1}`, propertyId: 'lab-amount', value })),
    ...['lab-done', 'lab-progress', 'lab-todo'].map((value, index) => ({ type: 'value.set', pageId: `lab-a${index + 1}`, propertyId: 'lab-state', value })),
    { type: 'value.set', pageId: 'lab-a1', propertyId: 'lab-due', value: { start: '2026-10-19', end: '2026-10-21', timeZone: 'Asia/Tokyo' } },
    { type: 'value.set', pageId: 'lab-a2', propertyId: 'lab-due', value: { start: '2026-10-20', timeZone: 'Asia/Tokyo' } },
    { type: 'value.set', pageId: 'lab-a1', propertyId: 'lab-tags', value: ['lab-red', 'lab-blue'] },
    { type: 'value.set', pageId: 'lab-a1', propertyId: 'lab-notes', value: 'NOTE-A1 동작 비교용 합성 메모' },
    { type: 'value.set', pageId: 'lab-a1', propertyId: 'lab-done-check', value: true },
    { type: 'value.set', pageId: 'lab-a1', propertyId: 'lab-link', value: 'https://example.com/lab' },
    { type: 'value.set', pageId: 'lab-a1', propertyId: 'lab-place', value: { name: '도쿄역', latitude: 35.681236, longitude: 139.767125 } },
    { type: 'relation.set', pageId: 'lab-a1', propertyId: 'lab-related', targetIds: ['lab-a2', 'lab-a3'] },
    ...['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed', 'chart', 'map', 'form', 'dashboard'].map(viewType => ({ type: 'view.create', id: `lab-${viewType}`, sourceId, parentId, name: viewType, viewType,
      config: { ...(viewType === 'board' ? { groupBy: 'lab-state' } : {}), ...(viewType === 'chart' ? { chart: { groupBy: 'lab-state', valuePropertyId: 'lab-amount', aggregation: 'sum' } } : {}), ...(['calendar', 'timeline'].includes(viewType) ? { datePropertyId: 'lab-due' } : {}), ...(viewType === 'map' ? { placePropertyId: 'lab-place' } : {}), ...(viewType === 'dashboard' ? { widgets: ['lab-board', 'lab-chart'] } : {}) } })),
    { type: 'view.create', id: 'lab-active', sourceId, parentId, name: '진행 중', config: { filter: { propertyId: 'lab-state', op: 'neq', value: 'lab-done' }, sorts: [{ propertyId: 'lab-amount', direction: 'asc' }, { propertyId: 'lab-name', direction: 'asc' }] } },
    { type: 'view.create', id: 'lab-linked', sourceId, parentId: 'lab-doc', name: '연결 보기', config: { visibleProperties: ['lab-name', 'lab-state'] } },
    { type: 'page.create', id: 'lab-template', sourceId, title: '기본 템플릿', template: true },
    { type: 'block.create', id: 'lab-template-body', parentId: 'lab-template', richText: [{ text: 'TEMPLATE7381 고정 본문' }] },
    { type: 'block.create', id: 'lab-synced', parentId: 'lab-doc', blockType: 'synced' },
    { type: 'block.create', id: 'lab-shared-text', parentId: 'lab-synced', richText: [{ text: 'SYNC7381 공유 본문' }] },
    { type: 'block.create', id: 'lab-reference', parentId: 'lab-a1', blockType: 'synced_reference', sourceBlockId: 'lab-synced' },
  ];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.LOCAL_WORKSPACE_URL ?? 'http://127.0.0.1:4141';
  const state = await fetch(`${base}/api/state`).then(response => response.json());
  if (state.objects.some(object => object.id === 'lab-root')) console.log('합성 검증 자료가 이미 있습니다. 기존 자료를 변경하지 않았습니다.');
  else {
    const response = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'synthetic-lab-seed-v1', actor: 'fixture', expectedRevision: state.revision, operations: demoOperations() }) });
    const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result));
    console.log(JSON.stringify({ revision: result.revision, changed: result.changes.length, open: `${base}/?id=lab-table` }));
  }
}
