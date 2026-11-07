import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireThat } from './contracts.mjs';

// 여러 워크스페이스 (a workspace switcher, without accounts): the data folder the app starts on is the main
// workspace; others live in <main>/workspaces/<id>/ and are listed in <main>/workspaces.json as { id, port }. Each
// one runs as its own local server on its own port — its own browser storage, its own MCP address — in this process.
export class WorkspaceRegistry {
  constructor(mainDirectory, mainPort) {
    this.main = path.resolve(mainDirectory);
    this.mainPort = mainPort;
    this.file = path.join(this.main, 'workspaces.json');
    this.running = new Map(); // id → { workspace, server }
    this.notifiers = new Map(); // id → () => void (its open pages reload)
  }
  entries() {
    if (!existsSync(this.file)) return [];
    try { const list = JSON.parse(readFileSync(this.file, 'utf8')); return Array.isArray(list) ? list.filter(item => typeof item?.id === 'string' && /^[a-z0-9-]{1,64}$/.test(item.id)) : []; } catch { return []; }
  }
  save(list) {
    const next = `${this.file}.${process.pid}.tmp`;
    writeFileSync(next, JSON.stringify(list, null, 2), { mode: 0o600 });
    renameSync(next, this.file);
  }
  directory(id) { return id === 'main' ? this.main : path.join(this.main, 'workspaces', id); }
  register(id, workspace, server) { this.running.set(id, { workspace, server }); }
  setPort(id, port) { this.save(this.entries().map(item => item.id === id ? { ...item, port } : item)); }
  listen(id, notify) { this.notifiers.set(id, notify); }
  notify(id) { this.notifiers.get(id)?.(); }
  port(id) { return this.running.get(id)?.server.address()?.port ?? null; }
  url(id) { const port = this.port(id); return port ? `http://127.0.0.1:${port}` : null; }
  // Every workspace with its name and icon (kept in each workspace's own data).
  list(currentId) {
    return ['main', ...this.entries().map(item => item.id)].filter(id => this.running.has(id)).map(id => {
      const info = this.running.get(id).workspace.settingsInfo();
      return { id, name: info.name ?? null, icon: info.icon ?? null, url: this.url(id), current: id === currentId };
    });
  }
  // A new empty workspace; its port is the first free one after the main port's tens (4151, 4161 …), kept so its
  // address stays the same.
  create() {
    const list = this.entries();
    requireThat(list.length < 50, 'WORKSPACE_LIMIT', '워크스페이스는 50개까지 만들 수 있습니다.');
    // An id no workspace has and no folder uses; its folder is made new (never an existing one).
    let id = randomUUID().slice(0, 8);
    while (list.some(item => item.id === id) || existsSync(this.directory(id))) id = randomUUID().slice(0, 8);
    mkdirSync(path.join(this.main, 'workspaces'), { recursive: true, mode: 0o700 });
    mkdirSync(this.directory(id), { mode: 0o700 });
    const taken = new Set([this.mainPort, ...list.map(item => item.port)]);
    let port = 0;
    if (this.mainPort) { port = this.mainPort + 10; while (taken.has(port)) port += 10; }
    list.push({ id, port });
    this.save(list);
    return { id, port };
  }
}
