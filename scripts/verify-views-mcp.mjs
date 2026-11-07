// Read-only verification of the synthetic fixture edited through the actual UI.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'ui-state-reader', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'],
  env: { ...process.env, LOCAL_WORKSPACE_URL: process.env.LOCAL_WORKSPACE_URL ?? 'http://127.0.0.1:4141' }, stderr: 'pipe' }));
try {
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.structuredContent)); return result.structuredContent;
  };
  const status = await call('workspace_status'), a2 = (await call('workspace_get', { id: 'lab-a2' })).entity;
  const a3 = (await call('workspace_get', { id: 'lab-a3' })).entity;
  const board = await call('workspace_query', { viewId: 'lab-board' });
  const calendar = await call('workspace_query', { viewId: 'lab-calendar' });
  const linked = await call('workspace_query', { viewId: 'lab-linked' });
  const table = await call('workspace_query', { viewId: 'lab-table' });
  const copyId = status.objects.find(item => item.name === 'UI 연결 보기 검증')?.id;
  assert.ok(copyId);
  const copiedView = await call('workspace_query', { viewId: copyId });
  assert.equal(a3.computed['lab-state'], 'lab-progress');
  assert.deepEqual(a3.computed['lab-due'], { start: '2026-10-22', end: '2026-10-24', timeZone: 'Asia/Tokyo' });
  assert.ok(board.presentation.groups.find(group => group.value === 'lab-progress').rowIds.includes('lab-a3'));
  assert.equal(calendar.presentation.items.find(item => item.rowId === 'lab-a3').end, '2026-10-24');
  assert.deepEqual(linked.rows.map(row => row.id), ['lab-a2']);
  assert.deepEqual(linked.visibleProperties, ['lab-total', 'lab-name', 'lab-amount', 'lab-double', 'lab-state', 'lab-related']);
  assert.equal(linked.view.config.sorts.length, 3); assert.equal(linked.view.config.openMode, 'side');
  assert.equal(table.visibleProperties.length, 14);
  assert.equal(a2.title, 'A2');
  assert.ok(a2.comments.some(note => note.richText[0]?.text === 'NOTE7381 개인 주석 검증'));
  const original = (await call('workspace_get', { id: 'lab-body' })).entity;
  const copied = (await call('workspace_get', { id: 'da1fd27a-6ed8-4e98-a044-23487abd8eb3' })).entity;
  assert.equal(original.parentId, 'lab-doc'); assert.equal(copied.parentId, 'lab-a3');
  assert.deepEqual(copied.richText, original.richText); assert.notEqual(copied.id, original.id);
  assert.notEqual(copiedView.view.id, linked.view.id); assert.equal(copiedView.view.viewType, 'list');
  assert.deepEqual(copiedView.view.config, linked.view.config);
  const prior = await call('workspace_page_version', { pageId: 'lab-a2', revision: 20 });
  assert.equal(prior.entity.title, 'A2 복원검증');
  const history = await call('workspace_history', { pageId: 'lab-a2' });
  assert.ok(history.commands.some(command => command.revision === 21));
  const report = { recordedAt: new Date().toISOString(), method: 'Read-only actual SDK stdio MCP -> HTTP -> SQLite, after browser UI edits and service restart',
    revision: status.revision, a3: { id: a3.id, state: a3.computed['lab-state'], due: a3.computed['lab-due'] },
    a2: { title: a2.title, commentIds: a2.comments.map(note => note.id), historicTitleAt20: prior.entity.title },
    linked: { id: linked.view.id, rows: linked.rows.map(row => row.id), config: linked.view.config },
    originalTableColumns: table.visibleProperties, copiedViewId: copyId, copiedViewType: copiedView.view.viewType,
    copiedBlock: { id: copied.id, parentId: copied.parentId, richTextEqualsOriginal: true }, productDataModifiedByVerifier: false };
  writeFileSync('verification/ui-views-mcp.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
