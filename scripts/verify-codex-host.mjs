// Real Codex host -> configured stdio MCP -> HTTP -> SQLite. No model turn.
// Default: read-only fixture validation. --exercise: create/run a new synthetic lab once.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)), exercise = process.argv.includes('--exercise');
assert.ok(process.argv.slice(2).every(arg => arg === '--exercise'), 'Use --exercise or no arguments.');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const globalConfig = path.join(process.env.CODEX_HOME ?? path.join(process.env.HOME, '.codex'), 'config.toml'), globalBefore = hash(globalConfig);
const projectConfig = path.join(root, '.codex/config.toml'), reportPath = path.join(root, 'verification/codex-host-mcp.json');
const proc = spawn('codex', ['app-server'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map(), interactiveRequests = []; let sequence = 0;
const lines = createInterface({ input: proc.stdout });
const failPending = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
proc.on('error', failPending); proc.on('exit', code => failPending(new Error(`Codex host exited (${code}).`)));
proc.stderr.on('data', () => {}); // Do not publish unrelated host/plugin diagnostics.
lines.on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  const item = pending.get(message.id);
  if (item) {
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(`${item.method}: ${message.error.message}`)); else item.resolve(message.result);
  } else if (message.id !== undefined && message.method) {
    interactiveRequests.push(message.method);
    proc.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Connection verification does not handle interactive requests.' } }) + '\n');
  }
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 25000);
    pending.set(id, { method, resolve, reject, timer }); proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
let threadId;
try {
  await rpc('initialize', { clientInfo: { name: 'pageyard_host_verifier', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  proc.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const config = (await rpc('config/read', { cwd: root, includeLayers: false })).config.mcp_servers['local-workspace'];
  assert.equal(config.command, path.join(root, 'app-local')); assert.deepEqual(config.args, ['mcp']);
  threadId = (await rpc('thread/start', { cwd: root, ephemeral: true })).thread.id;
  const inventory = await rpc('mcpServerStatus/list', { serverName: 'local-workspace', threadId, detail: 'toolsAndAuthOnly' });
  const server = inventory.data.find(item => item.name === 'local-workspace'); assert.ok(server); assert.equal(server.toolsError, null);
  const toolNames = Object.keys(server.tools).sort(); assert.ok(toolNames.includes('workspace_apply')); assert.ok(toolNames.includes('workspace_run_log'));
  const raw = (tool, args = {}) => rpc('mcpServer/tool/call', { threadId, server: 'local-workspace', tool, arguments: args });
  const call = async (tool, args = {}) => { const result = await raw(tool, args); assert.ok(!result.isError, JSON.stringify(result.structuredContent)); return result.structuredContent; };
  const initial = await call('workspace_status');
  let transitions = null;
  if (exercise) {
    assert.ok(!initial.objects.some(item => item.id === 'host-lab'), 'Host lab already exists. Run without --exercise to read it.');
    const setup = await call('workspace_apply', { id: 'codex-host-lab-setup-7381', expectedRevision: initial.revision, operations: [
      { type: 'page.create', id: 'host-lab', parentId: 'lab-root', title: '에이전트 연결 검증 · 합성 자료' },
      { type: 'block.create', id: 'host-body', parentId: 'host-lab', richText: [{ text: '원문 보존용 합성 본문' }] },
      { type: 'source.create', id: 'host-items', pageId: 'host-lab', name: '업무 연결 검증', titlePropertyId: 'host-name' },
      { type: 'property.create', id: 'host-state', sourceId: 'host-items', name: '상태', propertyType: 'status', options: [{ id: 'host-open', name: '진행' }, { id: 'host-done', name: '완료' }] },
      { type: 'property.create', id: 'host-related', sourceId: 'host-items', name: '관련 항목', propertyType: 'relation', targetSourceId: 'host-items', inverse: { id: 'host-inverse', name: '참조한 업무' } },
      { type: 'page.create', id: 'host-task', sourceId: 'host-items', title: '준비 작업' },
      { type: 'page.create', id: 'host-decision', sourceId: 'host-items', title: '결정 기록' },
      { type: 'value.set', pageId: 'host-task', propertyId: 'host-state', value: 'host-open' },
      { type: 'value.set', pageId: 'host-decision', propertyId: 'host-state', value: 'host-done' },
      { type: 'relation.set', pageId: 'host-task', propertyId: 'host-related', targetIds: ['host-decision'] },
      { type: 'view.create', id: 'host-active', sourceId: 'host-items', parentId: 'host-lab', name: '진행 중', config: { filter: { propertyId: 'host-state', op: 'neq', value: 'host-done' }, visibleProperties: ['host-name', 'host-state', 'host-related'] } },
    ] });
    const command = { id: 'codex-host-manage-7381', expectedRevision: setup.revision, operations: [
      { type: 'value.set', pageId: 'host-task', propertyId: 'host-state', value: 'host-done' },
      { type: 'relation.set', pageId: 'host-task', propertyId: 'host-related', targetIds: [] },
      { type: 'view.update', id: 'host-active', name: '다음 작업', config: { visibleProperties: ['host-name', 'host-state'] } },
      { type: 'page.create', id: 'host-followup', sourceId: 'host-items', title: '후속 작업' },
      { type: 'value.set', pageId: 'host-followup', propertyId: 'host-state', value: 'host-open' },
      { type: 'relation.set', pageId: 'host-followup', propertyId: 'host-related', targetIds: ['host-decision'] },
    ] };
    const applied = await call('workspace_apply', command);
    assert.equal((await call('workspace_apply', command)).replayed, true);
    const conflict = await raw('workspace_apply', { ...command, id: 'codex-host-stale-7381' });
    assert.equal(conflict.isError, true); assert.equal(conflict.structuredContent.error.code, 'REVISION_CONFLICT');
    await call('workspace_run_log', { id: 'host-explanation', runId: 'host-verification', message: 'HOST7381 처리 설명: 상태·관계·보기를 갱신했습니다.', changedIds: applied.changes.map(change => change.id) });
    const undone = await call('workspace_undo', { id: 'codex-host-undo-7381', expectedRevision: applied.revision, targetCommandId: applied.commandId });
    const restored = await call('workspace_query', { viewId: 'host-active' }); assert.deepEqual(restored.rows.map(row => row.id), ['host-task']); assert.equal(restored.visibleProperties.length, 3);
    const redone = await call('workspace_undo', { id: 'codex-host-redo-7381', expectedRevision: undone.revision, targetCommandId: undone.commandId });
    transitions = { before: initial.revision, setup: setup.revision, applied: applied.revision, undo: undone.revision, redo: redone.revision, commandId: applied.commandId, replayMatched: true, staleWriteRejected: true, undoRestoredTaskAndView: true };
  }
  const view = await call('workspace_query', { viewId: 'host-active' }), task = (await call('workspace_get', { id: 'host-task' })).entity, decision = (await call('workspace_get', { id: 'host-decision' })).entity;
  assert.deepEqual(view.rows.map(row => row.id), ['host-followup']); assert.deepEqual(view.visibleProperties, ['host-name', 'host-state']); assert.equal(view.view.name, '다음 작업');
  assert.equal(task.values['host-state'], 'host-done'); assert.deepEqual(task.values['host-related'], []); assert.equal(decision.alive, true); assert.deepEqual(decision.values['host-inverse'], ['host-followup']);
  assert.deepEqual((await call('workspace_get', { id: 'host-body' })).entity.richText, [{ text: '원문 보존용 합성 본문' }]);
  assert.equal((await call('workspace_search', { query: 'HOST7381 처리 설명' })).total, 0);
  assert.equal((await call('workspace_run_read', { runId: 'host-verification' })).logs.length, 1);
  const direct = await fetch('http://127.0.0.1:4141/api/objects/host-task').then(response => response.json()); assert.equal(direct.entity.computed['host-state'], 'host-done'); assert.equal(direct.revision, view.revision);
  const globalAfter = hash(globalConfig); assert.equal(globalAfter, globalBefore); assert.deepEqual(interactiveRequests, []);
  let previous; try { previous = JSON.parse(readFileSync(reportPath, 'utf8')); } catch {}
  const report = { recordedAt: new Date().toISOString(), cliVersion: spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout.trim(), projectConfig: '.codex/config.toml', projectConfigSha256: hash(projectConfig), globalConfigUnchanged: true,
    server: { name: server.name, runtimeStatus: server.runtimeStatus, serverInfo: server.serverInfo, tools: toolNames }, thread: { ephemeral: true, modelTurnStarted: false },
    exercisedThrough: 'Codex app-server mcpServer/tool/call -> project-configured stdio MCP -> HTTP -> SQLite', transitions: transitions ?? previous?.transitions ?? null,
    readback: { revision: view.revision, activeRows: view.rows.map(row => row.id), visibleProperties: view.visibleProperties, completedTaskState: task.values['host-state'], unlinkedTargetPreserved: decision.alive, inverseTargets: decision.values['host-inverse'], originalBodyUnchanged: true, explanationSearchTotal: 0, separateRunCount: 1, independentHttpMatched: true },
    modifiedByVerifier: exercise, naturalLanguageModelPlanningTested: false, nativeImeTested: false, browserUploadTested: false, interactiveRequests };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cliVersion: report.cliVersion, projectConfig: report.projectConfig, globalConfigUnchanged: true, tools: toolNames.length, ...report.readback, transitions: report.transitions, modelTurnStarted: false, modifiedByVerifier: exercise }, null, 2));
} finally {
  lines.close(); failPending(new Error('Verification closed.')); proc.stdin.end(); proc.kill('SIGTERM');
}
