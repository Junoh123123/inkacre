// Real SDK MCP -> HTTP -> SQLite verification, restricted to the disposable fixture.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [origin, output] = process.argv.slice(2);
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && output, 'Usage: ./app-local scripts/verify-task-graph-mcp.mjs http://127.0.0.1:PORT output.json');
const get = route => fetch(`${origin}${route}`).then(response => response.json());
const initial = await get('/api/state');
assert.equal(initial.objects.find(item => item.id === 'task-root')?.title, '업무 구조 검증 · 격리 합성 자료');
assert.ok(initial.objects.find(item => item.id === 'task-work')?.tasks?.dependencies.enabled, 'Enable dependencies through the fixture UI first.');
const client = new Client({ name: 'task-graph-evidence', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.mjs')], env: { ...process.env, LOCAL_WORKSPACE_URL: origin }, stderr: 'pipe' }));
const evidence = { recordedAt: new Date().toISOString(), origin, synthetic: true, initial, calls: [] };
const prefix = `task-mcp-${randomUUID()}`;
const call = async (name, args = {}) => { const result = await client.callTool({ name, arguments: args }); const data = { isError: result.isError ?? false, ...result.structuredContent }; evidence.calls.push({ name, args, result: data }); return data; };
try {
  const schema = await call('workspace_command_schema'); assert.equal(schema.isError, false);
  const config = (await call('workspace_get', { id: 'task-work' })).entity.tasks;
  const request = { id: `${prefix}-move`, expectedRevision: initial.revision, runId: 'task-graph-run', operations: [{ type: 'value.set', pageId: 'task-a', propertyId: 'task-date', value: { start: '2026-10-22', end: '2026-10-23', timeZone: 'Asia/Tokyo' } }] };
  const moved = await call('workspace_apply', request); assert.equal(moved.isError, false); assert.equal(moved.changes.length, 3);
  assert.equal((await call('workspace_apply', request)).replayed, true);
  const c = await call('workspace_get', { id: 'task-c' }); assert.equal(c.entity.values['task-date'].start, '2026-10-29');
  evidence.httpAfterMove = await get('/api/objects/task-c'); const { isError, ...mcpRead } = c; assert.deepEqual(evidence.httpAfterMove, mcpRead);
  const bad = await call('workspace_apply', { id: `${prefix}-cycle`, expectedRevision: moved.revision, operations: [{ type: 'relation.set', pageId: 'task-a', propertyId: config.dependencies.predecessorPropertyId, targetIds: ['task-c'] }] }); assert.equal(bad.error.code, 'TASK_DEPENDENCY_CYCLE');
  const stale = await call('workspace_apply', { ...request, id: `${prefix}-stale` }); assert.equal(stale.error.code, 'REVISION_CONFLICT');
  const undone = await call('workspace_undo', { id: `${prefix}-undo`, expectedRevision: moved.revision, targetCommandId: moved.commandId }); assert.equal(undone.isError, false);
  assert.equal((await call('workspace_get', { id: 'task-c' })).entity.values['task-date'].start, '2026-10-26');
  const redone = await call('workspace_undo', { id: `${prefix}-redo`, expectedRevision: undone.revision, targetCommandId: undone.commandId }); assert.equal(redone.isError, false);
  await call('workspace_run_log', { runId: 'task-graph-run', id: `${prefix}-summary`, message: '선행 일정과 두 후행 일정을 같은 명령으로 변경했습니다.', changedIds: ['task-a','task-b','task-c'] });
  assert.equal((await call('workspace_get', { id: 'task-body' })).entity.richText[0].text, '원문 유지: 제작 지침');
  assert.equal((await call('workspace_search', { query: '같은 명령으로 변경했습니다' })).total, 0);
  evidence.query = await call('workspace_query', { viewId: 'task-tree', filter: { propertyId: 'task-name', op: 'eq', value: 'C 검증' } });
  assert.equal(evidence.query.total, 1); assert.deepEqual(evidence.query.rows.map(row => [row.id, !!row.contextOnly]), [['task-a',true],['task-b',true],['task-c',false]]);
  evidence.final = await get('/api/state'); evidence.passed = true;
} finally { await client.close(); writeFileSync(output, JSON.stringify(evidence, null, 2)+'\n'); }
console.log(JSON.stringify({ passed: evidence.passed, revision: evidence.final.revision, output }));
