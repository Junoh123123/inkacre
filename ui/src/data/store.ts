import { t, translateServerMessage } from '../i18n';
import { inTimeMachine } from './timeMachine';
import { useSyncExternalStore } from 'react';
import { api, ApiError, isConnected, storeLocal } from './api';
import type { Entity, PageEntity, PropertyEntity, Snapshot, SourceEntity, ViewEntity } from './types';

// One snapshot of the workspace (GET /api/state) plus derived indexes. Every
// mutation goes through commands.ts; this module only reads.

type Listener = () => void;

const snapshotKey = 'pageyard-last-state-v1';

class WorkspaceStore {
  snapshot: Snapshot = { revision: 0, objects: [] };
  objects = new Map<string, Entity>();
  private childIndex = new Map<string | null, Entity[]>();
  private schemaIndex = new Map<string, PropertyEntity[]>();
  private visibleCache = new Map<string, boolean>();
  private listeners = new Set<Listener>();
  version = 0;
  loaded = false;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = () => this.version;

  set(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.objects = new Map(snapshot.objects.map(item => [item.id, item]));
    this.childIndex = new Map();
    this.schemaIndex = new Map();
    this.visibleCache = new Map();
    for (const item of snapshot.objects) {
      if (!item.alive) continue;
      const list = this.childIndex.get(item.parentId ?? null);
      if (list) list.push(item); else this.childIndex.set(item.parentId ?? null, [item]);
      if (item.kind === 'property') {
        const sourceId = (item as PropertyEntity).sourceId;
        const schema = this.schemaIndex.get(sourceId);
        if (schema) schema.push(item as PropertyEntity); else this.schemaIndex.set(sourceId, [item as PropertyEntity]);
      }
    }
    for (const list of this.childIndex.values()) list.sort((a, b) => a.position - b.position);
    for (const list of this.schemaIndex.values()) list.sort((a, b) => a.position - b.position);
    this.loaded = true;
    this.version++;
    for (const listener of this.listeners) listener();
  }

  get revision() { return this.snapshot.revision; }

  get<T extends Entity = Entity>(id: string | null | undefined): T | undefined {
    return id ? this.objects.get(id) as T | undefined : undefined;
  }

  children(parentId: string | null): Entity[] {
    return this.childIndex.get(parentId) ?? [];
  }

  schema(sourceId: string | null | undefined): PropertyEntity[] {
    return sourceId ? this.schemaIndex.get(sourceId) ?? [] : [];
  }

  // Same rule as the previous UI: alive, every ancestor visible, and (for task
  // sub-items) the parent task visible.
  visible(id: string | null | undefined, seen = new Set<string>()): boolean {
    if (!id) return false;
    const cached = this.visibleCache.get(id);
    if (cached !== undefined && !seen.size) return cached;
    const item = this.objects.get(id);
    if (!item?.alive || seen.has(id)) return false;
    seen.add(id);
    const source = (item as PageEntity).sourceId ? this.objects.get((item as PageEntity).sourceId!) as SourceEntity | undefined : undefined;
    const config = source?.tasks?.subitems;
    const parentTask = config?.enabled && config.parentPropertyId ? ((item as PageEntity).values?.[config.parentPropertyId] as string[] | undefined)?.[0] : undefined;
    const result = (item.parentId == null || this.visible(item.parentId, new Set(seen))) && (!parentTask || this.visible(parentTask, new Set(seen)));
    if (seen.size === 1) this.visibleCache.set(id, result);
    return result;
  }

  sources(): SourceEntity[] {
    return this.snapshot.objects.filter(item => item.kind === 'source' && this.visible(item.id)) as SourceEntity[];
  }

  viewsOf(sourceId: string, parentId?: string | null): ViewEntity[] {
    return this.snapshot.objects.filter(item => item.kind === 'view' && item.alive && (item as ViewEntity).sourceId === sourceId && (parentId === undefined || item.parentId === parentId) && this.visible(item.id))
      .sort((a, b) => a.position - b.position) as ViewEntity[];
  }

  // 사용자 지정 이모지: name → attachment id.
  customEmoji(): Record<string, string> {
    return (this.objects.get('workspace-emoji') as { emoji?: Record<string, string> } | undefined)?.emoji ?? {};
  }

  favorites(): string[] {
    return ((this.objects.get('workspace-navigation') as { favorites?: string[] } | undefined)?.favorites ?? []).filter(id => this.visible(id));
  }

  // Page that owns an object (blocks, comments, reminders are nested under pages).
  pageOf(id: string | null | undefined): PageEntity | undefined {
    let item = this.get(id);
    while (item && item.kind !== 'page') item = this.get(item.parentId);
    return item as PageEntity | undefined;
  }

  ancestry(id: string): Entity[] {
    const chain: Entity[] = [];
    let item = this.get(id);
    const seen = new Set<string>();
    while (item && !seen.has(item.id)) {
      seen.add(item.id);
      if (['page', 'source', 'view'].includes(item.kind)) chain.unshift(item);
      // A database row's parent is its source; the source's parent is the page holding it.
      item = this.get(item.parentId);
    }
    return chain;
  }

  title(item: Entity | undefined): string {
    if (!item) return '';
    if (item.kind === 'page') return (item as PageEntity).title || '';
    if (item.kind === 'source' || item.kind === 'view' || item.kind === 'property') return (item as { name: string }).name || '';
    return '';
  }
}

export const workspace = new WorkspaceStore();

export function useWorkspace() {
  useSyncExternalStore(workspace.subscribe, workspace.getVersion);
  return workspace;
}

// ---------- status line / toast ----------
export interface StatusState { text: string; error: boolean; connected: boolean; at: number; sync?: boolean; toast?: boolean }
let status: StatusState = { text: '', error: false, connected: true, at: 0 };
const statusListeners = new Set<Listener>();
/** `sync` marks saving and connection trouble (the toast then offers the pending saves), whatever the language. */
export function setStatus(text: string, error = false, sync = false) {
  status = { text, error, connected: isConnected(), at: Date.now(), sync };
  for (const listener of statusListeners) listener();
}
/** A short note at the bottom of the window (a toast, e.g. "삭제된 보기" after deleting a view). */
export function showToast(text: string) {
  status = { text, error: false, connected: isConnected(), at: Date.now(), toast: true };
  for (const listener of statusListeners) listener();
}
export function report(error: unknown) {
  const message = translateServerMessage(error instanceof Error ? error.message : String(error));
  console.error(error);
  setStatus(message, true, error instanceof ApiError && (!error.code || error.code === 'REVISION_CONFLICT'));
}
export function useStatus() {
  return useSyncExternalStore(listener => { statusListeners.add(listener); return () => statusListeners.delete(listener); }, () => status);
}

// ---------- loading & live updates ----------
let refreshing: Promise<void> | null = null;
let queuedRefresh = false;
export async function refresh(): Promise<void> {
  if (refreshing) { queuedRefresh = true; return refreshing; }
  refreshing = (async () => {
    try {
      const snapshot = await api<Snapshot>('/api/state');
      workspace.set(snapshot);
      if (!inTimeMachine()) storeLocal(snapshotKey, JSON.stringify(snapshot));
      if (!isConnected()) setStatus(t("연결 끊김 · 마지막 확인 {0} · 새 입력은 이 브라우저에 보존합니다.", [snapshot.revision]), true, true);
    } finally {
      refreshing = null;
    }
  })();
  await refreshing;
  if (queuedRefresh) { queuedRefresh = false; await refresh(); }
}

export function startLiveUpdates() {
  // The time machine shows one past moment: no saved copy of today, no live updates.
  if (inTimeMachine()) { refresh().catch(report); return () => undefined; }
  try {
    const cached = localStorage.getItem(snapshotKey);
    if (cached && !workspace.loaded) workspace.set(JSON.parse(cached));
  } catch { /* ignore broken cache */ }
  refresh().catch(report);
  let source: EventSource | null = null;
  const connect = () => {
    source = new EventSource('/api/events');
    source.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as { revision: number };
        if (data.revision !== workspace.revision) refresh().catch(report);
      } catch { /* heartbeat */ }
    };
    source.onerror = () => {
      setStatus(t("앱 연결을 다시 확인하는 중입니다."), true, true);
    };
    source.onopen = () => { if (status.error && (status.sync || /연결/.test(status.text))) setStatus(t("연결됨 · {0}", [workspace.revision])); };
  };
  connect();
  return () => source?.close();
}
