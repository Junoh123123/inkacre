import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';
import { instanceId } from '../src/app-info.mjs';

// r37 (36차): the downloadable app — `pageyard app` starts the app in the background (or finds this data folder's copy
// running) and keeps its port; the server says whether it was opened that way, and only then can it be quit.
const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const freePort = () => new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
async function serve(t, options) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r37-')), w = new Workspace(directory);
  const server = createLocalServer(w, options); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeEventStreams?.(); server.close(() => { w.close(); rmSync(directory, { recursive: true, force: true }); resolve(); }); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async route => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' }); return { status: response.status, body: await response.json() }; };
  return { base, post, directory };
}

test('the server reports its data folder id and whether it can be quit; quitting needs the app mode', async t => {
  const plain = await serve(t, {});
  assert.equal((await (await fetch(`${plain.base}/api/setup`)).json()).app, false);
  assert.equal((await (await fetch(`${plain.base}/api/health`)).json()).instance, instanceId(plain.directory));
  const refused = await plain.post('/api/quit');
  assert.equal(refused.body.error.code, 'QUIT_OFF');
  let quit = 0;
  const app = await serve(t, { quit: () => { quit++; } });
  assert.equal((await (await fetch(`${app.base}/api/setup`)).json()).app, true);
  assert.equal((await app.post('/api/quit')).status, 200);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(quit, 1);
  // Another site can't quit it.
  const foreign = await fetch(`${app.base}/api/quit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://example.com' }, body: '{}' });
  assert.equal(foreign.status, 403);
});

test('`pageyard app` starts it in the background, finds it again, keeps the port; quit stops it', async t => {
  const data = mkdtempSync(path.join(tmpdir(), 'pageyard-r37-app-'));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const port = await freePort(), env = { ...process.env, PAGEYARD_HEADLESS: '1', LOCAL_WORKSPACE_DATA: data };
  const open = () => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', cli, 'app', '--port', String(port)], { env, encoding: 'utf8', timeout: 60000 });
  const first = open();
  assert.equal(first.status, 0, first.stderr);
  const kept = JSON.parse(readFileSync(path.join(data, 'app.json'), 'utf8')).port, base = `http://127.0.0.1:${kept}`;
  assert.equal(kept, port);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.instance, instanceId(data));
  assert.equal(open().status, 0, 'found running');
  assert.equal((await (await fetch(`${base}/api/health`)).json()).instance, health.instance);
  await fetch(`${base}/api/quit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
  let stopped = false;
  for (let tries = 0; tries < 50 && !stopped; tries++) { await new Promise(resolve => setTimeout(resolve, 100)); stopped = await fetch(`${base}/api/health`).then(() => false, () => true); }
  assert.ok(stopped, 'stopped');
  assert.match(readFileSync(path.join(data, 'logs', 'pageyard.log'), 'utf8'), /running at/);
});
