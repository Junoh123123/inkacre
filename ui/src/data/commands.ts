import { t } from '../i18n';
import { inTimeMachine } from './timeMachine';
import { useSyncExternalStore } from 'react';
import { ApiError, api, readLocal, storeLocal } from './api';
import { refresh, setStatus, workspace } from './store';
import type { CommandResult, Operation } from './types';

// Command path shared with the MCP tools: unique command id + expectedRevision,
// replay of the same id after a lost response, explicit conflict handling.
// localStorage keys are the same as /classic's so pending saves and drafts
// carry over between the two.

export const pendingKey = 'pageyard-pending-v1';
export const valueDraftKey = (pageId: string, propertyId: string) => `pageyard-value-draft:${encodeURIComponent(pageId)}:${encodeURIComponent(propertyId)}`;
export const blockFieldKey = (id: string, field: string) => `pageyard-block-field:${encodeURIComponent(id)}:${field}`;
export const blockDraftKey = (id: string) => `pageyard-draft:${id}`;
export const titleDraftKey = (id: string) => `pageyard-title-draft:${id}`;

interface PendingEntry {
  route: string;
  command: { id: string; actor: string; expectedRevision: number; operations?: Operation[]; [key: string]: unknown };
  error?: { code: string; message: string };
}

type Listener = () => void;
const pending = new Map<string, PendingEntry>(readLocal<Array<[string, PendingEntry]>>(pendingKey, []));
let pendingVersion = 0;
const pendingListeners = new Set<Listener>();
function persistPending() {
  storeLocal(pendingKey, JSON.stringify([...pending]));
  pendingVersion++;
  for (const listener of pendingListeners) listener();
}
export function usePending() {
  useSyncExternalStore(listener => { pendingListeners.add(listener); return () => pendingListeners.delete(listener); }, () => pendingVersion);
  return [...pending.values()];
}
export const pendingCount = () => pending.size;

// ---------- own revision chain ----------
// expectedRevision -> resulting revision for commands sent by this tab. A draft based on
// revision R may be saved at R' when every step R..R' was this tab's own command; any
// foreign step (MCP, another tab, the scheduler) breaks the chain and the save conflicts.
const ownChain = new Map<number, number>();
export function advanceOwn(base: number): number {
  let current = base;
  const seen = new Set<number>();
  while (ownChain.has(current) && !seen.has(current)) { seen.add(current); current = ownChain.get(current)!; }
  return current;
}

// ---------- undo / redo of the user's own commands ----------
const undoStack: string[] = [];
const redoStack: string[] = [];
// Commands recorded with the same group are undone/redone together; origin tells the
// editor whether the newest entry is one of its own text saves.
interface UndoMeta { group?: string; origin?: string; at?: number }
const undoMeta = new Map<string, UndoMeta>();
export function lastUndoInfo(): { origin: string; at: number } | null { const top = undoStack.at(-1); if (!top) return null; const meta = undoMeta.get(top); return { origin: meta?.origin ?? 'app', at: meta?.at ?? 0 }; }
let historyVersion = 0;
const historyListeners = new Set<Listener>();
function historyChanged() { historyVersion++; for (const listener of historyListeners) listener(); }
export function useHistoryState() {
  useSyncExternalStore(listener => { historyListeners.add(listener); return () => historyListeners.delete(listener); }, () => historyVersion);
  return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}

function commandDrafts(operation: Operation): Array<[string, unknown]> {
  const drafts: Array<[string, unknown]> = [];
  if (operation.type === 'block.update') {
    if (operation.richText !== undefined) drafts.push([blockDraftKey(operation.id as string), operation.richText]);
    for (const field of ['url', 'language']) if (operation[field] !== undefined) drafts.push([blockFieldKey(operation.id as string, field), operation[field]]);
  }
  if (operation.type === 'value.set' || operation.type === 'relation.set') drafts.push([valueDraftKey(operation.pageId as string, operation.propertyId as string), operation.value ?? operation.targetIds ?? null]);
  if (operation.type === 'page.update' && operation.title !== undefined) drafts.push([titleDraftKey(operation.id as string), operation.title]);
  return drafts;
}

const uploadBytesKey = (id: string) => `/__pending_upload__/${encodeURIComponent(id)}`;
export async function uploadBytes(id: string, value?: string | null): Promise<string | undefined> {
  const cache = await caches.open('pageyard-uploads-v1');
  const key = uploadBytesKey(id);
  if (value === null) { await cache.delete(key); return; }
  if (value !== undefined) { await cache.put(key, new Response(value)); return; }
  const response = await cache.match(key);
  if (!response) throw new ApiError(t("보류한 파일 사본을 찾을 수 없습니다. 파일을 다시 선택하세요."), 'UPLOAD_BYTES_MISSING');
  return response.text();
}

export async function sendCommand(command: PendingEntry['command'], route = '/api/commands', { recordUndo = true, undoGroup, origin }: { recordUndo?: boolean; undoGroup?: string; origin?: string } = {}): Promise<CommandResult> {
  // The time machine is a look at the past: nothing is changed from it (its bar brings pages back to now).
  if (inTimeMachine()) throw new ApiError(t("타임머신에서는 고칠 수 없습니다. 위 막대의 \"지금으로 되살리기\"로 페이지를 가져오세요."), 'TIME_MACHINE');
  pending.set(command.id, { route, command });
  persistPending();
  try {
    const request = route === '/api/attachments'
      ? { commandId: command.id, ...Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'id')), base64: await uploadBytes(command.id) }
      : route === '/api/attachments/from-url' ? { commandId: command.id, ...Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'id')) }
      : command;
    const result = await api<CommandResult>(route, request);
    if (!(result as { replayed?: boolean }).replayed && typeof command.expectedRevision === 'number') ownChain.set(command.expectedRevision, result.revision);
    for (const operation of command.operations ?? []) for (const [key, value] of commandDrafts(operation)) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const draft = JSON.parse(raw);
      if (JSON.stringify(draft.richText ?? draft.value) === JSON.stringify(value)) localStorage.removeItem(key);
      else if (draft.baseRevision === command.expectedRevision) storeLocal(key, JSON.stringify({ ...draft, baseRevision: result.revision }));
    }
    pending.delete(command.id);
    persistPending();
    if (route === '/api/attachments') await uploadBytes(command.id, null).catch(() => undefined);
    if (recordUndo && route !== '/api/undo' && result.undoHandle) {
      undoStack.push(result.undoHandle);
      undoMeta.set(result.undoHandle, { group: undoGroup, origin, at: Date.now() });
      if (undoStack.length > 100) undoMeta.delete(undoStack.shift()!);
      redoStack.length = 0;
      historyChanged();
    }
    setStatus(t("저장됨 · {0}", [result.revision]));
    return result;
  } catch (error) {
    const failure = error instanceof ApiError ? error : new ApiError(error instanceof Error ? error.message : String(error));
    if (failure.code === 'REVISION_CONFLICT') failure.message = t("다른 변경이 저장됐습니다. 입력을 보존한 채 최신 상태를 확인하세요.");
    else if (!failure.code) failure.message = t("앱에 연결할 수 없습니다. 보류한 저장은 이 브라우저에 보존했습니다.");
    if (failure.code && failure.code !== 'REVISION_CONFLICT') {
      pending.delete(command.id);
      if (route === '/api/attachments') await uploadBytes(command.id, null).catch(() => undefined);
    } else {
      const entry = pending.get(command.id);
      if (entry) entry.error = { code: failure.code ?? 'CONNECTION', message: failure.message };
    }
    persistPending();
    throw failure;
  }
}

// Serialises saves so that one user's consecutive saves chain their revisions
// (no self-conflict) while a stale base revision is never silently rebased.
let chain: Promise<unknown> = Promise.resolve();
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

export interface ApplyOptions { revision?: number; freshCommand?: boolean; refreshAfter?: boolean; recordUndo?: boolean; undoGroup?: string; origin?: string }

export function apply(operations: Operation[], options: ApplyOptions = {}): Promise<CommandResult> {
  return enqueue(async () => {
    const previous = !options.freshCommand && [...pending.values()].find(item => item.route === '/api/commands' && JSON.stringify(item.command.operations) === JSON.stringify(operations));
    const command = previous ? previous.command : { id: crypto.randomUUID(), actor: 'user', expectedRevision: advanceOwn(options.revision ?? workspace.revision), operations };
    const result = await sendCommand(command, '/api/commands', { recordUndo: options.recordUndo ?? true, undoGroup: options.undoGroup, origin: options.origin });
    if (options.refreshAfter !== false) await refresh();
    return result;
  });
}

async function replayStack(from: string[], to: string[], message: string) {
  const first = from.pop();
  historyChanged();
  if (!first) return;
  const meta = undoMeta.get(first) ?? {};
  const targets = [first];
  while (meta.group && from.length && undoMeta.get(from.at(-1)!)?.group === meta.group) targets.push(from.pop()!);
  const done: string[] = [];
  try {
    for (const target of targets) {
      const result = await enqueue(() => sendCommand({ id: crypto.randomUUID(), actor: 'user', expectedRevision: workspace.revision, targetCommandId: target }, '/api/undo'));
      const handle = (result as { commandId?: string }).commandId ?? '';
      const targetMeta = undoMeta.get(target) ?? meta;
      await refresh();
      undoMeta.set(handle, targetMeta);
      done.push(handle);
    }
    // The last one undone is replayed first by the opposite action.
    to.push(...done);
    historyChanged();
    setStatus(message);
  } catch (error) {
    from.push(...targets.slice(done.length).reverse());
    to.push(...done);
    historyChanged();
    throw error;
  }
}

export async function undoLast(): Promise<void> { await replayStack(undoStack, redoStack, t("되돌렸습니다.")); }
export async function redoLast(): Promise<void> { await replayStack(redoStack, undoStack, t("다시 실행했습니다.")); }

// Drops a command from the undo history (e.g. after it was taken back some other way).
export function forgetUndo(handle: string) {
  for (const stack of [undoStack, redoStack]) { const index = stack.indexOf(handle); if (index >= 0) stack.splice(index, 1); }
  undoMeta.delete(handle);
  historyChanged();
}

export async function undoCommand(commandId: string, expectedRevision = workspace.revision) {
  const result = await enqueue(() => sendCommand({ id: crypto.randomUUID(), actor: 'user', expectedRevision, targetCommandId: commandId }, '/api/undo', { recordUndo: false }));
  await refresh();
  return result;
}

export async function retryPending(id: string) {
  const entry = pending.get(id);
  if (!entry) return;
  delete entry.error;
  persistPending();
  await enqueue(() => sendCommand(entry.command, entry.route));
  await refresh();
}

export function discardPending(id: string) {
  const entry = pending.get(id);
  if (!entry) return;
  for (const operation of entry.command.operations ?? []) for (const [key] of commandDrafts(operation)) localStorage.removeItem(key);
  pending.delete(id);
  persistPending();
  if (entry.route === '/api/attachments') uploadBytes(id, null).catch(() => undefined);
}

// Re-send a conflicted command on top of the latest revision. Only called after
// the user explicitly chose to keep their input.
export async function resendOnLatest(id: string) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  persistPending();
  await apply(entry.command.operations ?? [], { freshCommand: true });
}

export async function uploadFile(file: File, expectedRevision: number, reference?: unknown): Promise<CommandResult & { attachmentId: string }> {
  if (file.size > 16 * 1024 * 1024) throw new ApiError(t("16 MiB 이하 파일을 선택하세요."));
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  const id = crypto.randomUUID();
  await uploadBytes(id, btoa(binary));
  const result = await enqueue(() => sendCommand({ id, actor: 'user', expectedRevision, name: file.name, mediaType: file.type || 'application/octet-stream', ...(reference ? { reference } : {}) }, '/api/attachments'));
  await refresh();
  return result as CommandResult & { attachmentId: string };
}

// A file at a web address, downloaded once by the local server and kept as an attachment (이미지 · 파일 · PDF ·
// 표지 링크, 북마크 그림, 사이트 아이콘). reference places it like an upload's.
export type RemoteKind = 'image' | 'icon' | 'video' | 'audio' | 'pdf' | 'file';
export async function attachFromUrl(url: string, kind: RemoteKind, reference?: unknown): Promise<CommandResult & { attachmentId: string; name: string; mediaType: string }> {
  const result = await enqueue(() => sendCommand({ id: crypto.randomUUID(), actor: 'user', expectedRevision: advanceOwn(workspace.revision), url, kind, ...(reference ? { reference } : {}) }, '/api/attachments/from-url'));
  await refresh();
  return result as CommandResult & { attachmentId: string; name: string; mediaType: string };
}

export const newId = () => crypto.randomUUID();
