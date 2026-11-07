import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'live-functional-verifier', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'], env: { ...process.env, LOCAL_WORKSPACE_URL: process.env.LOCAL_WORKSPACE_URL ?? 'http://127.0.0.1:4141' }, stderr: 'pipe' });
await client.connect(transport);
try {
  async function call(name, args = {}) {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response.structuredContent)); return response.structuredContent;
  }
  const before = await call('workspace_get', { id: 'lab-a1' });
  const originalBody = await call('workspace_get', { id: 'lab-body' });
  const amount = before.entity.computed['lab-amount'] + 1, commandId = `live-functional-${randomUUID()}`;
  const request = { id: commandId, expectedRevision: before.revision, operations: [
    { type: 'value.set', pageId: 'lab-a1', propertyId: 'lab-amount', value: amount },
    { type: 'relation.set', pageId: 'lab-a1', propertyId: 'lab-related', targetIds: ['lab-a2'] },
    { type: 'view.update', id: 'lab-linked', config: { visibleProperties: ['lab-name', 'lab-amount', 'lab-double', 'lab-state', 'lab-related', 'lab-total'] } },
  ] };
  const changed = await call('workspace_apply', request);
  const repeated = await call('workspace_apply', request); assert.equal(repeated.replayed, true);
  await call('workspace_run_log', { runId: commandId, message: 'MCP7381 처리 설명: 값·관계·보기 변경을 마침.', changedIds: changed.changes.map(change => change.id) });
  const after = await call('workspace_get', { id: 'lab-a1' });
  const view = await call('workspace_query', { viewId: 'lab-linked' });
  const bodyAfter = await call('workspace_get', { id: 'lab-body' });
  assert.deepEqual(bodyAfter.entity.richText, originalBody.entity.richText);
  assert.equal(after.entity.computed['lab-amount'], amount); assert.equal(after.entity.computed['lab-double'], amount * 2);
  assert.equal(after.entity.computed['lab-total'], 25);
  assert.equal((await call('workspace_search', { query: 'MCP7381 처리 설명' })).total, 0);
  const report = { recordedAt: new Date().toISOString(), method: 'Real SDK stdio client -> local HTTP service -> SQLite; synthetic fixtures only', commandId, before: { revision: before.revision, amount: before.entity.computed['lab-amount'], related: before.entity.values['lab-related'] }, after: { revision: after.revision, amount, double: amount * 2, related: after.entity.values['lab-related'], rollup: 25 }, changed: changed.changes, repeatedCommandReplayed: repeated.replayed, linkedVisibleProperties: view.visibleProperties, originalBusinessBodyUnchanged: true, executionProseAbsentFromBusinessSearch: true, browserConfirmation: 'to be recorded after observing the open app' };
  mkdirSync('verification', { recursive: true }); writeFileSync('verification/live-mcp.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
