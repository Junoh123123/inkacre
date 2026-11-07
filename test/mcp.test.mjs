import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';

test('MCP task graph schema, relation inverses, schedule cascade and atomic undo share HTTP state', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-task-mcp-')), workspace = new Workspace(directory), server = createLocalServer(workspace);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`, client = new Client({ name: 'task-verifier', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.mjs')], env: { ...process.env, LOCAL_WORKSPACE_URL: origin }, stderr: 'pipe' }));
  t.after(async () => { await client.close(); server.closeEventStreams(); await new Promise(resolve => server.close(resolve)); workspace.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = async (name, args = {}) => { const response = await client.callTool({ name, arguments: args }); return { isError: response.isError ?? false, ...response.structuredContent }; };
  const schema = await call('workspace_command_schema'); assert.equal(schema.isError, false); assert.match(JSON.stringify(schema), /source.configure_tasks/);
  const setup = await call('workspace_apply', { id: 'task-setup', expectedRevision: 0, operations: [
    { type: 'page.create', id: 'root', title: '합성 업무' }, { type: 'source.create', id: 'work', pageId: 'root', name: '업무', titlePropertyId: 'name' },
    { type: 'property.create', id: 'due', sourceId: 'work', name: '일정', propertyType: 'date' },
    { type: 'source.configure_tasks', id: 'work', subitems: { enabled: true }, dependencies: { enabled: true, datePropertyId: 'due', mode: 'preserve' } },
    ...['a','b','c'].map(id => ({ type: 'page.create', id, sourceId: 'work', title: id.toUpperCase() })),
    ...['19','22','26'].map((day, index) => ({ type: 'value.set', pageId: ['a','b','c'][index], propertyId: 'due', value: { start: `2026-10-${day}` } })),
    { type: 'block.create', id: 'body', parentId: 'b', richText: [{ text: '원문 그대로' }] },
  ] }); assert.equal(setup.isError, false);
  const config = (await call('workspace_get', { id: 'work' })).entity.tasks;
  const relations = await call('workspace_apply', { id: 'task-relations', expectedRevision: setup.revision, operations: [
    { type: 'relation.set', pageId: 'b', propertyId: config.subitems.parentPropertyId, targetIds: ['a'] },
    { type: 'relation.set', pageId: 'b', propertyId: config.dependencies.predecessorPropertyId, targetIds: ['a'] },
    { type: 'relation.set', pageId: 'c', propertyId: config.dependencies.predecessorPropertyId, targetIds: ['b'] },
  ] }); assert.equal(relations.isError, false);
  const command = { id: 'task-schedule', expectedRevision: relations.revision, operations: [{ type: 'value.set', pageId: 'a', propertyId: 'due', value: { start: '2026-10-22' } }] };
  const moved = await call('workspace_apply', command); assert.equal(moved.isError, false); assert.equal(moved.changes.length, 3);
  assert.equal((await call('workspace_apply', command)).replayed, true);
  const http = await fetch(`${origin}/api/objects/c`).then(response => response.json()); assert.equal(http.entity.values.due.start, '2026-10-29');
  assert.deepEqual((await call('workspace_get', { id: 'a' })).entity.task.children.map(item => item.id), ['b']);
  const cycle = await call('workspace_apply', { id: 'task-cycle', expectedRevision: moved.revision, operations: [{ type: 'relation.set', pageId: 'a', propertyId: config.dependencies.predecessorPropertyId, targetIds: ['c'] }] });
  assert.equal(cycle.error.code, 'TASK_DEPENDENCY_CYCLE'); assert.equal((await call('workspace_status')).revision, moved.revision);
  const undo = await call('workspace_undo', { id: 'task-undo', expectedRevision: moved.revision, targetCommandId: moved.commandId }); assert.equal(undo.isError, false);
  assert.equal((await call('workspace_get', { id: 'c' })).entity.values.due.start, '2026-10-26');
  assert.equal((await call('workspace_get', { id: 'body' })).entity.richText[0].text, '원문 그대로');
});

test('MCP body media uses atomic references and inline images; bookmark/mention edits share the writer', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-media-mcp-')), workspace = new Workspace(directory), server = createLocalServer(workspace);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`, client = new Client({ name: 'body-media-verifier', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.mjs')], env: { ...process.env, LOCAL_WORKSPACE_URL: origin }, stderr: 'pipe' }));
  t.after(async () => { await client.close(); server.closeEventStreams(); await new Promise(resolve => server.close(resolve)); workspace.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = async (name, args = {}) => { const result = await client.callTool({ name, arguments: args }); return { isError: result.isError ?? false, ...result.structuredContent }; };
  const setup = await call('workspace_apply', { id: 'media-setup', expectedRevision: 0, operations: [
    { type: 'page.create', id: 'doc', title: '합성 본문 편집 검증' }, { type: 'page.create', id: 'target', title: '멘션 대상' },
    { type: 'block.create', id: 'text', parentId: 'doc', richText: [{ text: '멘션', bold: true, pageId: 'target' }, { text: ' 및 링크', href: 'https://example.com' }] },
    { type: 'block.create', id: 'bookmark', parentId: 'doc', blockType: 'bookmark', url: 'https://example.com/reference' },
  ] });
  assert.equal(setup.isError, false);
  // Bytes are generated here, not read from user files or a browser upload target.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64');
  const upload = { commandId: 'generated-body-image', expectedRevision: setup.revision, name: 'generated.png', mediaType: 'image/png', base64: bytes.toString('base64'), reference: { parentId: 'doc', blockId: 'image', blockType: 'image', beforeId: 'bookmark' } };
  const attached = await call('workspace_attachment_put', upload); assert.equal(attached.isError, false);
  assert.equal((await call('workspace_get', { id: 'image' })).entity.attachmentId, attached.attachmentId);
  assert.equal((await call('workspace_attachment_put', upload)).replayed, true);
  const response = await fetch(`${origin}/api/attachments/${encodeURIComponent(attached.attachmentId)}`);
  assert.equal(response.headers.get('content-type'), 'image/png'); assert.match(response.headers.get('content-disposition'), /^inline;/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const invalid = await call('workspace_attachment_put', { ...upload, commandId: 'not-an-image', expectedRevision: attached.revision, mediaType: 'text/plain', reference: { blockId: 'image' } });
  assert.equal(invalid.isError, true); assert.equal(invalid.error.code, 'IMAGE_MEDIA_TYPE');
  assert.equal((await call('workspace_status')).revision, attached.revision);
  const undone = await call('workspace_undo', { id: 'undo-body-media', expectedRevision: attached.revision, targetCommandId: attached.commandId });
  assert.equal(undone.isError, false); assert.equal((await call('workspace_get', { id: 'image' })).isError, true);
  const redone = await call('workspace_undo', { id: 'redo-body-media', expectedRevision: undone.revision, targetCommandId: undone.commandId }); assert.equal(redone.isError, false);
  assert.deepEqual((await call('workspace_get', { id: 'target' })).entity.backlinks.map(item => item.id), ['doc']);
  assert.equal((await call('workspace_get', { id: 'bookmark' })).entity.url, 'https://example.com/reference');
  const module = await fetch(`${origin}/rich-text.mjs`); assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
});

test('real stdio MCP -> HTTP -> shared SQLite: structured changes, replay, conflict, undo and separate prose', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-mcp-'));
  let workspace = new Workspace(directory), server = createLocalServer(workspace);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: 'functional-verification-agent', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.mjs')], env: { ...process.env, LOCAL_WORKSPACE_URL: origin }, stderr: 'pipe' });
  t.after(async () => { await client.close(); server.closeEventStreams(); await new Promise(resolve => server.close(resolve)); workspace.close(); rmSync(directory, { recursive: true, force: true }); });
  await client.connect(transport);
  assert.match(client.getInstructions(), /workspace_status\/get\/query/);
  assert.match(client.getInstructions(), /expectedRevision/);
  assert.match(client.getInstructions(), /workspace_run_log/);
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'workspace_apply'));
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    return { error: response.isError ?? false, ...response.structuredContent };
  };
  let revision = (await call('workspace_status')).revision;
  const setup = await call('workspace_apply', { id: 'meeting-setup', expectedRevision: revision, operations: [
    { type: 'page.create', id: 'meeting', title: '회의 원문' },
    { type: 'block.create', id: 'minutes', parentId: 'meeting', richText: [{ text: 'MEETING7381 원문: 시연 준비와 견적 결정을 기록함.' }] },
    { type: 'source.create', id: 'work', pageId: 'meeting', name: '업무', titlePropertyId: 'title' },
    { type: 'property.create', id: 'status', sourceId: 'work', name: '상태', propertyType: 'status', options: [{ id: 'open', name: '진행' }, { id: 'closed', name: '완료' }] },
    { type: 'property.create', id: 'links', sourceId: 'work', name: '관련 업무', propertyType: 'relation', targetSourceId: 'work', inverse: { id: 'inverse', name: '연결됨' } },
    { type: 'property.create', id: 'done-number', sourceId: 'work', name: '완료수', propertyType: 'formula', formula: 'if(prop("상태") == "완료", 1, 0)' },
    { type: 'property.create', id: 'done-rollup', sourceId: 'work', name: '완료합', propertyType: 'rollup', rollup: { relationPropertyId: 'inverse', targetPropertyId: 'done-number', aggregation: 'sum' } },
    { type: 'property.create', id: 'files', sourceId: 'work', name: '파일', propertyType: 'files' },
    { type: 'page.create', id: 'task', sourceId: 'work', title: '시연 준비' },
    { type: 'page.create', id: 'decision', sourceId: 'work', title: '견적 승인 결정' },
    { type: 'value.set', pageId: 'task', propertyId: 'status', value: 'open' },
    { type: 'relation.set', pageId: 'task', propertyId: 'links', targetIds: ['decision'] },
    { type: 'view.create', id: 'work-view', sourceId: 'work', parentId: 'meeting', name: '남은 업무', config: { filter: { propertyId: 'status', op: 'eq', value: 'open' } } },
  ] });
  assert.equal(setup.error, false); revision = setup.revision;
  const query = await call('workspace_query', { viewId: 'work-view' }); assert.deepEqual(query.rows.map(row => row.id), ['task']);
  assert.deepEqual((await call('workspace_get', { id: 'decision' })).entity.values.inverse, ['task']);
  const request = { id: 'agent-complete', expectedRevision: revision, operations: [{ type: 'value.set', pageId: 'task', propertyId: 'status', value: 'closed' }] };
  const complete = await call('workspace_apply', request);
  assert.equal(complete.error, false); assert.equal(complete.changes[0].id, 'task');
  assert.equal((await call('workspace_apply', request)).replayed, true);
  assert.equal((await call('workspace_query', { viewId: 'work-view' })).total, 0);
  assert.equal((await call('workspace_get', { id: 'decision' })).entity.computed['done-rollup'], 1);
  assert.deepEqual((await call('workspace_query', { sourceId: 'work', filter: { propertyId: 'done-rollup', op: 'gt', value: 0 } })).rows.map(row => row.id), ['decision']);
  const fromUi = await fetch(`${origin}/api/objects/task`).then(response => response.json());
  assert.equal(fromUi.entity.computed.status, 'closed'); assert.equal(fromUi.revision, complete.revision);
  const stale = await call('workspace_apply', { ...request, id: 'stale-writer' });
  assert.equal(stale.error.code, 'REVISION_CONFLICT');
  await call('workspace_run_log', { runId: 'meeting-run', message: '업무와 관계 및 보기를 갱신했습니다.', changedIds: ['task', 'decision', 'work-view'] });
  assert.equal((await call('workspace_get', { id: 'minutes' })).entity.richText[0].text, 'MEETING7381 원문: 시연 준비와 견적 결정을 기록함.');
  assert.equal((await call('workspace_search', { query: '보기를 갱신했습니다' })).total, 0);
  const undone = await call('workspace_undo', { id: 'undo-complete', expectedRevision: complete.revision, targetCommandId: complete.commandId });
  assert.equal(undone.error, false); assert.equal((await call('workspace_query', { viewId: 'work-view' })).total, 1);
  assert.equal((await call('workspace_get', { id: 'decision' })).entity.computed['done-rollup'], 0);
  const bytes = Buffer.alloc(92, 0x52); // Generated test bytes; no user file or browser upload.
  const attachment = await call('workspace_attachment_put', { commandId: 'upload-92', expectedRevision: undone.revision, name: 'attachment-7381.txt', mediaType: 'text/plain', base64: bytes.toString('base64') });
  assert.equal(attachment.error, false);
  const linked = await call('workspace_apply', { id: 'attach-reference', expectedRevision: attachment.revision, operations: [{ type: 'value.set', pageId: 'task', propertyId: 'files', value: [attachment.attachmentId] }] });
  assert.equal(linked.error, false);
  const reopened = Buffer.from(await fetch(`${origin}/api/attachments/${encodeURIComponent(attachment.attachmentId)}`).then(response => response.arrayBuffer()));
  assert.deepEqual(reopened, bytes);
  const denied = await fetch(`${origin}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: JSON.stringify({}) });
  assert.equal(denied.status, 403);
  const views = await call('workspace_apply', { id: 'prepare-views', expectedRevision: linked.revision, operations: [
    { type: 'property.create', id: 'due', sourceId: 'work', name: '날짜', propertyType: 'date' },
    { type: 'view.create', id: 'board', sourceId: 'work', parentId: 'meeting', name: '보드', viewType: 'board', config: { groupBy: 'status' } },
    { type: 'view.create', id: 'calendar', sourceId: 'work', parentId: 'meeting', name: '달력', viewType: 'calendar', config: { datePropertyId: 'due' } },
    { type: 'view.create', id: 'linked-view', sourceId: 'work', parentId: 'meeting', name: '연결 보기', config: { visibleProperties: ['status', 'title'],
      filter: { all: [{ propertyId: 'status', op: 'neq', value: 'closed' }, { any: [{ propertyId: 'title', op: 'contains', value: '시연' }, { propertyId: 'files', op: 'not_empty' }] }] },
      sorts: [{ propertyId: 'status', direction: 'desc' }, { propertyId: 'title', direction: 'asc' }, { propertyId: 'due', direction: 'desc' }], openMode: 'side' } },
  ] });
  assert.equal(views.error, false);
  const uiRequest = { id: 'ui-group-and-date', actor: 'user', expectedRevision: views.revision, operations: [
    { type: 'value.set', pageId: 'task', propertyId: 'status', value: 'closed' },
    { type: 'value.set', pageId: 'task', propertyId: 'due', value: { start: '2026-10-22', end: '2026-10-24', timeZone: 'Asia/Tokyo' } },
    { type: 'comment.create', id: 'annotation', parentId: 'task', richText: [{ text: '검증용 개인 주석' }] },
  ] };
  const changed = await fetch(`${origin}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(uiRequest) }).then(response => response.json());
  assert.equal((await call('workspace_get', { id: 'task' })).entity.computed.status, 'closed');
  assert.equal((await call('workspace_query', { viewId: 'board' })).presentation.groups.find(group => group.value === 'closed').rowIds[0], 'task');
  assert.equal((await call('workspace_query', { viewId: 'calendar' })).presentation.items[0].end, '2026-10-24');
  assert.equal((await call('workspace_query', { viewId: 'linked-view' })).total, 0);
  assert.deepEqual((await call('workspace_query', { viewId: 'linked-view' })).visibleProperties, ['status', 'title']);
  const prior = await call('workspace_page_version', { pageId: 'task', revision: views.revision });
  assert.equal(prior.entity.values.status, 'open');
  assert.ok((await call('workspace_history', { pageId: 'task' })).commands.some(command => command.id === uiRequest.id));
  // Keep the same MCP process while the actual HTTP writer and SQLite connection restart.
  const port = server.address().port;
  server.closeEventStreams(); await new Promise(resolve => server.close(resolve)); workspace.close();
  workspace = new Workspace(directory); server = createLocalServer(workspace); server.listen(port, '127.0.0.1'); await once(server, 'listening');
  assert.equal((await call('workspace_get', { id: 'task' })).entity.computed.due.end, '2026-10-24');
  assert.equal((await call('workspace_get', { id: 'decision' })).entity.computed['done-rollup'], 1);
  const restored = await call('workspace_apply', { id: 'restore-task-version', expectedRevision: changed.revision, operations: [{ type: 'page.restore_version', id: 'task', revision: views.revision }] });
  assert.equal(restored.error, false);
  const task = await call('workspace_get', { id: 'task' });
  assert.equal(task.entity.computed.status, 'open'); assert.equal(task.entity.comments[0].id, 'annotation');
  assert.equal((await call('workspace_query', { viewId: 'linked-view' })).total, 1);
  assert.equal((await call('workspace_get', { id: 'minutes' })).entity.richText[0].text, 'MEETING7381 원문: 시연 준비와 견적 결정을 기록함.');
  const atomicUpload = { commandId: 'upload-and-reference', expectedRevision: restored.revision, name: 'atomic.txt', mediaType: 'text/plain', base64: bytes.toString('base64'),
    reference: { pageId: 'task', propertyId: 'files', attachmentIds: [attachment.attachmentId] } };
  const attached = await call('workspace_attachment_put', atomicUpload);
  assert.equal(attached.error, false);
  assert.deepEqual((await call('workspace_get', { id: 'task' })).entity.values.files, [attachment.attachmentId, attached.attachmentId]);
  assert.equal((await call('workspace_attachment_put', atomicUpload)).replayed, true);
  const invalidUpload = await call('workspace_attachment_put', { ...atomicUpload, commandId: 'invalid-file-target', expectedRevision: attached.revision, reference: { pageId: 'task', propertyId: 'status', attachmentIds: [] } });
  assert.equal(invalidUpload.error.code, 'ATTACHMENT_PROPERTY');
  assert.equal((await call('workspace_status')).revision, attached.revision);
  const undoAttachment = await call('workspace_undo', { id: 'undo-atomic-attachment', expectedRevision: attached.revision, targetCommandId: attached.commandId });
  assert.equal(undoAttachment.error, false);
  assert.deepEqual((await call('workspace_get', { id: 'task' })).entity.values.files, [attachment.attachmentId]);
  const plan = await call('workspace_preview_property_conversion', { type: 'property.convert', id: 'status', propertyType: 'text' });
  assert.equal(plan.allowed, true);
  assert.equal((await call('workspace_status')).revision, undoAttachment.revision);
  const converted = await call('workspace_apply', { id: 'convert-status', expectedRevision: plan.revision, operations: [plan.operation] });
  assert.equal(converted.error, false);
  assert.equal((await call('workspace_get', { id: 'task' })).entity.values.status, '진행');
  assert.equal((await call('workspace_query', { viewId: 'work-view' })).total, 1);
  const conversionUndo = await call('workspace_undo', { id: 'undo-status-conversion', expectedRevision: converted.revision, targetCommandId: converted.commandId });
  const copied = await call('workspace_apply', { id: 'copy-meeting', expectedRevision: conversionUndo.revision, operations: [{ type: 'page.duplicate', id: 'meeting', newId: 'meeting-copy' }] });
  assert.equal(copied.error, false);
  const ids = copied.copies[0].idMap;
  assert.notEqual(ids.work, 'work');
  assert.equal((await call('workspace_get', { id: ids.task })).entity.sourceId, ids.work);
  assert.equal((await call('workspace_query', { viewId: ids['linked-view'] })).total, 1);
  assert.deepEqual((await call('workspace_get', { id: ids.task })).entity.values[ids.links], [ids.decision]);
});

test('MCP automation and exchange preserve typed values, pause copied schedules and keep preview read-only', async t => {
  const directory=mkdtempSync(path.join(tmpdir(),'pageyard-automation-mcp-')),workspace=new Workspace(directory),server=createLocalServer(workspace);
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`,client=new Client({name:'automation-exchange-verifier',version:'1.0.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('src/mcp.mjs')],env:{...process.env,LOCAL_WORKSPACE_URL:origin},stderr:'pipe'}));
  t.after(async()=>{await client.close();server.closeEventStreams();await new Promise(resolve=>server.close(resolve));workspace.close();rmSync(directory,{recursive:true,force:true})});
  const call=async(name,args={})=>{const response=await client.callTool({name,arguments:args});return {isError:response.isError??false,...response.structuredContent}};
  assert.equal((await client.listTools()).tools.length,21);
  const setup=await call('workspace_apply',{id:'automation-setup',expectedRevision:0,operations:[
    {type:'page.create',id:'root',title:'합성 자동화'},
    {type:'source.create',id:'work',pageId:'root',name:'업무',titlePropertyId:'title'},
    {type:'property.create',id:'n',sourceId:'work',name:'수치',propertyType:'number'},
    {type:'property.create',id:'button',sourceId:'work',name:'실행',propertyType:'button',button:{label:'0으로',actions:[{action:'set_property',propertyId:'n',value:0},{action:'notify',message:'업무 본문 밖의 알림'}]}},
    {type:'page.create',id:'template',sourceId:'work',template:true,title:'기본'},
    {type:'block.create',id:'original',parentId:'template',richText:[{text:'원문',underline:true,color:'blue'}]},
    {type:'source.configure_templates',id:'work',defaultTemplateId:'template'},
    {type:'template.configure',id:'template',recurrence:{enabled:true,frequency:'month',interval:1,start:'2030-01-31T09:00',timeZone:'Asia/Tokyo'}},
    {type:'page.create',id:'a',sourceId:'work',title:'A'},
    {type:'value.set',pageId:'a',propertyId:'n',value:10},
  ]});assert.equal(setup.isError,false);
  const command={id:'automation-button',expectedRevision:setup.revision,operations:[{type:'button.run',id:'button',pageId:'a'}]},changed=await call('workspace_apply',command);assert.equal(changed.isError,false);assert.equal((await call('workspace_apply',command)).replayed,true);
  assert.equal((await call('workspace_get',{id:'a'})).entity.values.n,0);assert.equal((await call('workspace_search',{query:'업무 본문 밖의 알림'})).total,0);
  const exported=await call('workspace_export',{id:'root',format:'bundle'});assert.equal(exported.isError,false);
  const preview=await call('workspace_import_preview',{format:'bundle',text:exported.text,title:'복원'});assert.equal(preview.isError,false);assert.equal((await call('workspace_status')).revision,changed.revision);
  const imported=await call('workspace_apply',{id:'automation-import',expectedRevision:preview.revision,operations:preview.operations});assert.equal(imported.isError,false);const map=imported.copies[0].idMap;
  assert.equal((await call('workspace_get',{id:map.template})).entity.recurrence.enabled,false);assert.equal((await call('workspace_get',{id:map.work})).entity.defaultTemplateId,map.template);assert.equal((await call('workspace_get',{id:map.a})).entity.values[map.n],0);
  const recovered=await call('workspace_undo',{id:'undo-automation-import',expectedRevision:imported.revision,targetCommandId:imported.commandId});assert.equal(recovered.isError,false);
  const tick=await call('workspace_apply',{id:'automation-tick',expectedRevision:recovered.revision,operations:[{type:'scheduler.tick',at:'2030-03-31T01:00:00Z'}]});assert.equal(tick.isError,false);assert.equal((await call('workspace_get',{id:'template'})).entity.recurrence.index,3);
  const current=await fetch(origin+'/api/state').then(r=>r.json());assert.equal(current.revision,tick.revision);assert.equal(current.objects.filter(x=>x.kind==='page'&&x.sourceId==='work'&&!x.template&&x.alive).length,4);
});

test('MCP HTML table and ZIP exchange use the real writer and expose expanded formula and delivery contracts',async t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'pageyard-recovery-mcp-')),workspace=new Workspace(directory),server=createLocalServer(workspace);server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`,client=new Client({name:'recovery-integration',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('src/mcp.mjs')],env:{...process.env,LOCAL_WORKSPACE_URL:origin},stderr:'pipe'}));t.after(async()=>{await client.close();server.closeEventStreams();await new Promise(resolve=>server.close(resolve));workspace.close();rmSync(directory,{recursive:true,force:true})});
 const call=async(name,args={})=>{const response=await client.callTool({name,arguments:args});assert.equal(response.isError??false,false,JSON.stringify(response.structuredContent?.error));return response.structuredContent};const schema=await call('workspace_command_schema');assert.match(JSON.stringify(schema),/send_webhook/);assert.match(JSON.stringify(schema),/send_email/);
 const preview=await call('workspace_import_preview',{format:'html',title:'SDK 표',text:'<table><tr><th>이름</th><th>값</th></tr><tr><td><strong>원문 보존</strong></td><td>25</td></tr></table>'});assert.equal((await call('workspace_status')).revision,0);const pageId=preview.operations[0].id,created=await call('workspace_apply',{id:'recovery-import',expectedRevision:preview.revision,operations:preview.operations});assert.match((await call('workspace_export',{id:pageId,format:'markdown'})).text,/\*\*원문 보존\*\*.*25/);const archive=await call('workspace_export',{id:pageId,format:'zip'}),restored=await call('workspace_import_preview',{format:'zip',text:archive.text,title:'복원'});assert.equal((await call('workspace_status')).revision,created.revision);const imported=await call('workspace_apply',{id:'recovery-zip',expectedRevision:created.revision,operations:restored.operations});assert.equal(imported.copies.length,1);const original=(await call('workspace_get',{id:pageId})).entity,copy=(await call('workspace_get',{id:imported.copies[0].copyId})).entity;assert.deepEqual(copy.children[0].cells,original.children[0].cells);await call('workspace_undo',{id:'recovery-undo',expectedRevision:imported.revision,targetCommandId:imported.commandId});assert.equal((await call('workspace_get',{id:pageId})).entity.children[0].cells[1][1][0].text,'25');
});
