// Read-only cross-check of the graph copied and converted through the browser UI.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const reportFile = 'verification/ui-copy-conversion.json', report = JSON.parse(readFileSync(reportFile, 'utf8')), ids = report.idMap;
const client = new Client({ name: 'copy-conversion-reader', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'],
  env: { ...process.env, LOCAL_WORKSPACE_URL: process.env.LOCAL_WORKSPACE_URL ?? 'http://127.0.0.1:4141' }, stderr: 'pipe' }));
try {
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.structuredContent)); return result.structuredContent;
  };
  const status = await call('workspace_status'), get = async id => (await call('workspace_get', { id })).entity;
  const original = await get('lab-a1'), copied = await get(ids['lab-a1']);
  assert.equal(original.computed['lab-amount'], 40); assert.equal(original.computed['lab-double'], 80);
  assert.equal(copied.computed[ids['lab-amount']], 41); assert.equal(copied.computed[ids['lab-double']], 82);
  assert.equal((await get(ids['lab-amount'])).type, 'number'); assert.equal((await get(ids['lab-notes'])).type, 'text');
  assert.equal((await get(ids['lab-doc'])).parentId, report.rootId);
  assert.equal(copied.sourceId, ids['lab-items']);
  assert.deepEqual(copied.values[ids['lab-related']], [ids['lab-a2']]);
  assert.equal((await get(ids['lab-reference'])).sourceBlockId, ids['lab-synced']);
  assert.deepEqual((await get(ids['lab-body'])).richText, (await get('lab-body')).richText);
  const linked = await call('workspace_query', { viewId: ids['lab-linked'] });
  assert.deepEqual(linked.rows.map(row => row.id), [ids['lab-a2']]);
  assert.equal(linked.view.config.sorts[0].propertyId, ids['lab-amount']);
  const originalNoteCount = (await get('lab-a2')).comments.length, copiedNoteCount = (await get(ids['lab-a2'])).comments.length;
  assert.equal(originalNoteCount, 1); assert.equal(copiedNoteCount, 0);
  const preview = await call('workspace_preview_property_conversion', { type: 'property.convert', id: ids['lab-amount'], propertyType: 'text' });
  assert.equal(preview.allowed, true); assert.equal((await call('workspace_status')).revision, status.revision);
  assert.ok(preview.effects.some(effect => effect.propertyId === ids['lab-double'] && effect.after.error.code === 'FORMULA_TYPE'));
  const history = await call('workspace_history');
  assert.ok(history.commands.some(command => command.revision === report.conversionAppliedRevision));
  assert.ok(history.commands.some(command => command.revision === report.conversionUndoRevision && command.kind === 'undo'));
  report.mcpReadback = { recordedAt: new Date().toISOString(), revision: status.revision, originalAmount: 40, originalDouble: 80,
    copiedAmount: 41, copiedDouble: 82, copiedSourceId: copied.sourceId, copiedObjects: Object.keys(ids).length,
    copiedLinkedRows: linked.rows.map(row => row.id), copiedReferencesRemapped: true, originalNotesRetained: originalNoteCount,
    notesNotDuplicated: copiedNoteCount === 0, readOnlyPreviewDidNotWrite: true, modifiedByVerifier: false };
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.mcpReadback, null, 2));
} finally { await client.close(); }
