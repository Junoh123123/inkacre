import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer, startLocalServer } from '../src/server.mjs';

// r31 (coverage phase 6: workspace and settings): the workspace's own name and icon, comments by agents in the
// inbox, and several workspaces on one computer — listed, created, a page copied or moved between them, and MCP
// pointed at another one.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r31-'));
  const w = new Workspace(directory); let i = 0;
  const apply = (operations, actor = 'user') => w.execute({ id: `r31-${++i}`, actor, expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  return { w, apply, get: id => w.snapshot().objects.find(item => item.id === id), objects: () => w.snapshot().objects };
}

test('the workspace keeps its own name and icon, and both can be cleared', t => {
  const { w, apply, get } = fixture(t);
  assert.deepEqual(w.settingsInfo(), {});
  apply([{ type: 'workspace.update', name: '집', icon: '🏠' }]);
  assert.deepEqual(w.settingsInfo(), { name: '집', icon: '🏠' });
  assert.equal(get('workspace-settings').kind, 'settings');
  const cleared = apply([{ type: 'workspace.update', icon: null }]);
  assert.deepEqual(w.settingsInfo(), { name: '집', icon: null });
  assert.throws(() => apply([{ type: 'workspace.update' }]));
  assert.throws(() => apply([{ type: 'workspace.update', icon: 'attachment:nothing' }]), /ATTACHMENT_REF|아이콘/);
  w.undo({ id: 'undo-1', actor: 'test', expectedRevision: w.revision, targetCommandId: cleared.commandId });
  assert.equal(w.settingsInfo().icon, '🏠');
});

test('a comment written by an agent lands in the inbox; the person’s own does not', t => {
  const { apply, objects } = fixture(t);
  apply([{ type: 'page.create', id: 'p', title: '문서' }, { type: 'block.create', id: 'b', parentId: 'p', blockType: 'paragraph', richText: [{ text: '본문' }] }]);
  apply([{ type: 'comment.create', id: 'c1', parentId: 'b', richText: [{ text: '내가 남긴 말' }] }]);
  assert.equal(objects().filter(item => item.kind === 'notification').length, 0);
  apply([{ type: 'comment.create', id: 'c2', parentId: 'b', richText: [{ text: '검토했습니다' }] }], 'mcp:claude');
  const notes = objects().filter(item => item.kind === 'notification');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].source, 'comment');
  assert.equal(notes[0].parentId, 'p');
  assert.match(notes[0].message, /검토했습니다/);
});

test('several workspaces: listed, created on their own port, and a page copied or moved between them', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r31-multi-'));
  const { server, workspace, registry } = startLocalServer({ directory, port: 0 });
  await once(server, 'listening');
  t.after(async () => {
    for (const { server: each, workspace: data } of registry.running.values()) { each.closeEventStreams?.(); await new Promise(resolve => each.close(resolve)); data.close(); }
    rmSync(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (base, route, body) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  workspace.execute({ id: 'seed', actor: 'user', expectedRevision: workspace.revision, operations: [
    { type: 'workspace.update', name: '회사' },
    { type: 'page.create', id: 'doc', title: '옮길 문서' },
    { type: 'page.create', id: 'child', parentId: 'doc', title: '하위' },
  ] });
  let list = (await (await fetch(`${origin}/api/workspaces`)).json()).workspaces;
  assert.deepEqual(list.map(item => [item.id, item.name, item.current]), [['main', '회사', true]]);

  const created = await post(origin, '/api/workspaces/create', { name: '개인', icon: '🌱' });
  assert.equal(created.status, 200);
  assert.ok(created.body.url.startsWith('http://127.0.0.1:'));
  assert.notEqual(created.body.url, origin);
  assert.ok(existsSync(path.join(directory, 'workspaces', created.body.id)));
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'workspaces.json'), 'utf8')).map(item => item.id), [created.body.id]);
  list = (await (await fetch(`${created.body.url}/api/workspaces`)).json()).workspaces;
  assert.deepEqual(list.map(item => [item.name, item.icon, item.current]), [['회사', null, false], ['개인', '🌱', true]]);

  const copied = await post(origin, '/api/workspaces/copy', { pageId: 'doc', targetId: created.body.id });
  assert.equal(copied.status, 200);
  const target = registry.running.get(created.body.id).workspace;
  const titles = () => target.snapshot().objects.filter(item => item.kind === 'page' && item.alive !== false).map(item => item.title).sort();
  assert.deepEqual(titles(), ['옮길 문서', '하위']);
  assert.ok(copied.body.url.includes(`?id=${copied.body.pageId}`));
  assert.notEqual(workspace.snapshot().objects.find(item => item.id === 'doc').alive, false);

  const moved = await post(origin, '/api/workspaces/copy', { pageId: 'doc', targetId: created.body.id, move: true });
  assert.equal(moved.status, 200);
  assert.equal(titles().length, 4);
  const original = workspace.snapshot().objects.find(item => item.id === 'doc');
  assert.ok(original.trashed || original.alive === false || original.inTrash);

  const self = await post(origin, '/api/workspaces/copy', { pageId: 'child', targetId: 'main' });
  assert.equal(self.status >= 400, true);
  const nameless = await post(origin, '/api/workspaces/create', { name: '' });
  assert.equal(nameless.status >= 400, true);
});

test('a workspace started alone lists only itself and cannot create others', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r31-alone-'));
  const workspace = new Workspace(directory), server = createLocalServer(workspace);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeEventStreams(); await new Promise(resolve => server.close(resolve)); workspace.close(); rmSync(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const list = (await (await fetch(`${origin}/api/workspaces`)).json()).workspaces;
  assert.equal(list.length, 1);
  assert.equal(list[0].current, true);
  const response = await fetch(`${origin}/api/workspaces/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '새 곳' }) });
  assert.equal(response.status >= 400, true);
});

test('MCP lists the workspaces and switches the session to another one', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r31-mcp-'));
  const { server, workspace, registry } = startLocalServer({ directory, port: 0 });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const created = await (await fetch(`${origin}/api/workspaces/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '두 번째' }) })).json();
  const client = new Client({ name: 'r31-workspaces', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.mjs')], env: { ...process.env, LOCAL_WORKSPACE_URL: origin }, stderr: 'pipe' }));
  t.after(async () => {
    await client.close();
    for (const { server: each, workspace: data } of registry.running.values()) { each.closeEventStreams?.(); await new Promise(resolve => each.close(resolve)); data.close(); }
    rmSync(directory, { recursive: true, force: true });
  });
  const call = async (name, args = {}) => { const response = await client.callTool({ name, arguments: args }); return { isError: response.isError ?? false, ...response.structuredContent }; };
  const listed = await call('workspace_list');
  assert.deepEqual(listed.workspaces.map(item => [item.id, item.current]), [['main', true], [created.id, false]]);
  const used = await call('workspace_use', { workspaceId: created.id });
  assert.equal(used.name, '두 번째');
  const again = await call('workspace_list');
  assert.equal(again.workspaces.find(item => item.id === created.id).current, true);
  const missing = await call('workspace_use', { workspaceId: 'nope' });
  assert.equal(missing.isError, true);
  void workspace;
});
