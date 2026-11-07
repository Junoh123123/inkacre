// Isolated synthetic workspace and transport faults for browser verification.
// No fault controls are installed in the product server.
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';
import { demoOperations } from '../src/seed.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-browser-fault-'));
const workspace = new Workspace(directory);
workspace.execute({ id: 'isolated-fixture', actor: 'fixture', expectedRevision: 0, operations: demoOperations() });
const backend = createLocalServer(workspace);
backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
let disconnected = false, dropNext = false;
const events = [], sockets = new Set();
const proxy = http.createServer(async (request, response) => {
  if (request.url.startsWith('/_verification/')) {
    if (request.url === '/_verification/mode' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk;
      const mode = JSON.parse(text).mode;
      disconnected = mode === 'disconnect'; dropNext = mode === 'drop-next-command';
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ mode }));
      if (disconnected) for (const socket of sockets) if (socket !== request.socket) socket.destroy();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ events, revision: workspace.revision, entity: workspace.get('lab-a1').entity,
      commandCount: workspace.db.prepare('SELECT count(*) AS count FROM commands').get().count }));
  }
  if (disconnected) { request.socket.destroy(); return; }
  const command = ['/api/commands', '/api/attachments'].includes(request.url) && request.method === 'POST', dropped = command && dropNext;
  if (dropped) dropNext = false;
  const upstream = http.request({ hostname: '127.0.0.1', port: backend.address().port, method: request.method, path: request.url, headers: request.headers }, incoming => {
    const chunks = [];
    if (command) incoming.on('data', chunk => chunks.push(chunk));
    if (!dropped) { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); }
    else incoming.resume();
    incoming.on('end', () => {
      if (command) {
        const result = JSON.parse(Buffer.concat(chunks).toString());
        events.push({ commandId: result.commandId, revision: result.revision, replayed: result.replayed, dropped, status: incoming.statusCode });
        writeFileSync('verification/transport-events.json', JSON.stringify(events, null, 2) + '\n');
      }
      if (dropped) response.destroy();
    });
    response.on('close', () => incoming.destroy());
  });
  upstream.on('error', () => response.destroy()); request.pipe(upstream);
});
proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const session = { pid: process.pid, browserUrl: `http://127.0.0.1:${proxy.address().port}/?id=lab-table`,
  controlUrl: `http://127.0.0.1:${proxy.address().port}/_verification`, backendUrl: `http://127.0.0.1:${backend.address().port}`, directory };
writeFileSync('verification/transport-session.json', JSON.stringify(session, null, 2) + '\n');
console.log(JSON.stringify(session));
const stop = async () => {
  backend.closeEventStreams(); for (const socket of sockets) socket.destroy();
  await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => backend.close(resolve))]);
  workspace.close(); rmSync(directory, { recursive: true, force: true }); process.exit(0);
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);
