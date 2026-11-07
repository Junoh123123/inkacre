import { t } from '../i18n';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { apply, blockDraftKey, advanceOwn } from '../data/commands';
import { ApiError, readLocal, storeLocal } from '../data/api';
import { workspace, report, setStatus } from '../data/store';
import type { RichText } from '../data/types';
import { buildDoc, desiredTree, inlineToRuns, runsEqual } from './convert';
import { diffPage } from './diff';
import { flatBlocks } from './plugins';
import { schema } from './schema';

// Keeps one page document in step with the command engine.
//  - local edits are saved as typed commands (debounced for typing);
//  - consecutive saves chain their revisions (no self-conflict);
//  - a stale base revision is never rebased silently: a conflict is shown and
//    the user chooses to apply their input on the latest state or discard it.

export interface SyncStatus { state: 'idle' | 'dirty' | 'saving' | 'conflict' | 'offline' | 'remote'; message?: string }

interface FlatEntry { id: string; key: string; parent: string; index: number; node: PMNode }

function flatEntries(doc: PMNode): Map<string, FlatEntry> {
  const result = new Map<string, FlatEntry>();
  const walk = (container: PMNode, parent: string) => {
    let index = 0;
    container.forEach(node => {
      if (node.type.name === 'columns') {
        result.set(node.attrs.id, { id: node.attrs.id, key: `columns:${node.attrs.depth}`, parent, index: index++, node });
        node.forEach(column => { result.set(column.attrs.id, { id: column.attrs.id, key: 'column', parent: node.attrs.id, index: 0, node: column }); walk(column, column.attrs.id); });
        return;
      }
      if (node.type.name === 'tabs') {
        result.set(node.attrs.id, { id: node.attrs.id, key: `tabs:${node.attrs.depth}`, parent, index: index++, node });
        let tabIndex = 0;
        node.forEach(tab => { result.set(tab.attrs.id, { id: tab.attrs.id, key: `tab|${tab.attrs.title}|${tab.attrs.icon ?? ''}`, parent: node.attrs.id, index: tabIndex++, node: tab }); walk(tab, tab.attrs.id); });
        return;
      }
      const runs = node.type.name === 'text_block' ? JSON.stringify(inlineToRuns(node)) : node.type.name === 'code_block' ? `${node.textContent}${node.attrs.caption ? `\u0000${node.attrs.caption}` : ''}` : '';
      const key = `${node.type.name}|${node.attrs.blockType ?? ''}|${node.attrs.depth}|${node.attrs.checked ?? ''}|${node.attrs.language ?? ''}|${runs}`;
      result.set(node.attrs.id, { id: node.attrs.id, key, parent, index: index++, node });
    });
  };
  walk(doc, 'root');
  // The trailing empty line is not content.
  const last = doc.lastChild;
  if (last && last.type.name === 'text_block' && last.attrs.virtual && last.content.size === 0) result.delete(last.attrs.id);
  return result;
}

export function docKey(doc: PMNode) {
  return [...flatEntries(doc).values()].map(entry => `${entry.id}:${entry.parent}:${entry.key}`).join('\n');
}

export class PageSync {
  private timer = 0;
  private saving = false;
  private again = false;
  private syncedKey = '';
  private syncedDoc: PMNode | null = null;
  baseRevision: number | null = null;
  status: SyncStatus = { state: 'idle' };
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  private lastStoreVersion = workspace.version;
  private blocked = false;

  constructor(private pageId: string, private getView: () => EditorView | null) {
    this.unsubscribe = workspace.subscribe(() => this.onStore());
  }

  destroy() {
    this.unsubscribe();
    window.clearTimeout(this.timer);
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getStatus = () => this.status;
  private setStatusState(status: SyncStatus) { this.status = status; for (const listener of this.listeners) listener(); }

  // Drafts saved by this browser for blocks of the page (same keys as the previous UI).
  draftLookup = (blockId: string): RichText | undefined => {
    const draft = readLocal<{ richText?: RichText; baseRevision?: number } | null>(blockDraftKey(blockId), null);
    if (!draft?.richText) return undefined;
    const block = workspace.get(blockId) as { richText?: RichText } | undefined;
    if (block && runsEqual(block.richText, draft.richText)) { localStorage.removeItem(blockDraftKey(blockId)); return undefined; }
    if (draft.baseRevision !== undefined) this.baseRevision = Math.min(this.baseRevision ?? Infinity, draft.baseRevision);
    return draft.richText;
  };

  initialDoc(): PMNode {
    this.baseRevision = null;
    const withDrafts = buildDoc(this.pageId, this.draftLookup);
    const clean = buildDoc(this.pageId);
    this.markSynced(clean);
    if (docKey(withDrafts) !== this.syncedKey) {
      this.setStatusState({ state: 'dirty', message: t("이 브라우저에 보존한 입력을 저장합니다.") });
      window.setTimeout(() => this.schedule(300), 0);
    }
    return withDrafts;
  }

  private known = new Set<string>();
  private markSynced(doc: PMNode) {
    this.syncedDoc = doc;
    this.syncedKey = docKey(doc);
    this.known = new Set(desiredTree(doc, this.pageId).blocks.keys());
  }

  // After our own save: show anything the server has that the editor does not (pages
  // created from the sidebar, blocks added by tools) once there is no unsaved input.
  private reconcile() {
    const view = this.getView();
    if (!view || this.isDirty() || this.blocked) return;
    const fresh = buildDoc(this.pageId);
    if (docKey(fresh) !== docKey(view.state.doc)) this.replaceDoc(fresh);
  }

  isDirty() {
    const view = this.getView();
    return !!view && docKey(view.state.doc) !== this.syncedKey;
  }

  // A command for something the editor shows (atom content, etc.) after pending text is saved.
  async command(operations: import('../data/types').Operation[]) {
    await this.flush();
    return apply(operations);
  }

  // Called for every user transaction that changed the document.
  onLocalChange(structural: boolean) {
    if (this.blocked) { this.persistDrafts(); return; }
    if (this.baseRevision === null) this.baseRevision = workspace.revision;
    this.persistDrafts();
    if (this.status.state !== 'saving') this.setStatusState({ state: 'dirty' });
    this.schedule(structural ? 40 : 700);
  }

  private persistDrafts() {
    const view = this.getView();
    if (!view || !this.syncedDoc) return;
    const before = flatEntries(this.syncedDoc);
    for (const { node } of flatBlocks(view.state.doc)) {
      if (node.type.name !== 'text_block' && node.type.name !== 'code_block') continue;
      const id = node.attrs.id as string;
      const old = before.get(id);
      if (!old || !workspace.get(id)) continue;
      const runs = node.type.name === 'text_block' ? inlineToRuns(node) : node.textContent ? [{ text: node.textContent }] : [];
      const server = (workspace.get(id) as { richText?: RichText }).richText;
      if (runsEqual(runs, server)) { localStorage.removeItem(blockDraftKey(id)); continue; }
      storeLocal(blockDraftKey(id), JSON.stringify({ richText: runs, baseRevision: this.baseRevision ?? workspace.revision }));
    }
  }

  schedule(delay: number) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.flush().catch(report); }, delay);
  }

  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (this.blocked) return;
    if (this.saving) { this.again = true; return; }
    const view = this.getView();
    if (!view) return;
    const doc = view.state.doc;
    const { operations, createdIds } = diffPage(doc, this.pageId, this.known);
    if (!operations.length) {
      this.markSynced(doc);
      this.baseRevision = null;
      this.setStatusState({ state: 'idle' });
      return;
    }
    this.saving = true;
    this.setStatusState({ state: 'saving' });
    const expected = advanceOwn(this.baseRevision ?? workspace.revision);
    try {
      const result = await apply(operations, { revision: expected, freshCommand: true, origin: 'editor' });
      this.markSynced(doc);
      this.clearVirtual(createdIds);
      const current = this.getView();
      const stillDirty = !!current && docKey(current.state.doc) !== this.syncedKey;
      // Chain the next save on our own result; if someone else wrote in between, the
      // next save will conflict and the user decides.
      this.baseRevision = stillDirty ? result.revision : null;
      this.setStatusState({ state: stillDirty ? 'dirty' : 'idle' });
      if (stillDirty) this.again = true;
    } catch (error) {
      const failure = error as ApiError;
      if (failure.code === 'REVISION_CONFLICT') {
        this.blocked = true;
        this.setStatusState({ state: 'conflict', message: t("다른 곳에서 이 페이지가 바뀌었습니다. 입력은 이 브라우저에 보존했습니다.") });
      } else if (!failure.code) {
        this.blocked = true;
        this.setStatusState({ state: 'offline', message: t("앱에 연결할 수 없습니다. 입력은 이 브라우저에 보존했습니다.") });
      } else {
        report(failure);
        this.setStatusState({ state: 'dirty', message: failure.message });
      }
    } finally {
      this.saving = false;
      this.lastStoreVersion = workspace.version;
      if (this.again && !this.blocked) { this.again = false; this.schedule(10); }
      else if (!this.blocked) this.reconcile();
    }
  }

  private clearVirtual(ids: string[]) {
    const view = this.getView();
    if (!view || !ids.length) return;
    const wanted = new Set(ids);
    const tr = view.state.tr;
    for (const { node, pos } of flatBlocks(view.state.doc)) if (wanted.has(node.attrs.id) && node.attrs.virtual) tr.setNodeMarkup(pos, undefined, { ...node.attrs, virtual: false });
    if (tr.docChanged) { tr.setMeta('addToHistory', false).setMeta('sync', true); view.dispatch(tr); }
  }

  private onStore() {
    if (workspace.version === this.lastStoreVersion) return;
    this.lastStoreVersion = workspace.version;
    if (this.saving) return;
    const view = this.getView();
    if (!view) return;
    const fresh = buildDoc(this.pageId);
    if (docKey(fresh) === this.syncedKey) return; // nothing that the editor shows changed
    if (!this.isDirty()) { this.replaceDoc(fresh); return; }
    if (this.status.state !== 'conflict' && this.status.state !== 'saving') this.setStatusState({ state: 'remote', message: t("새 변경을 받았습니다. 입력을 저장한 뒤 반영합니다.") });
  }

  // Replace the document with the server version, keeping the caret in the same block.
  replaceDoc(next: PMNode) {
    const view = this.getView();
    if (!view) return;
    const { head } = view.state.selection;
    const $head = view.state.doc.resolve(head);
    let anchorId: string | null = null, offset = 0;
    for (let d = $head.depth; d > 0; d--) { const node = $head.node(d); if (node.attrs?.id) { anchorId = node.attrs.id; offset = $head.pos - $head.start(d); break; } }
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, next.content);
    tr.setMeta('addToHistory', false).setMeta('sync', true);
    if (anchorId) {
      const entry = flatBlocks(tr.doc).find(item => item.node.attrs.id === anchorId);
      if (entry && entry.node.isTextblock) {
        const pos = Math.min(entry.pos + 1 + offset, entry.pos + 1 + entry.node.content.size);
        try { tr.setSelection(TextSelection.create(tr.doc, pos)); } catch { /* keep default */ }
      }
    }
    view.dispatch(tr);
    this.markSynced(view.state.doc);
    this.baseRevision = null;
    this.setStatusState({ state: 'idle' });
  }

  // Offline: try the save again with the same base revision.
  async retry() {
    this.blocked = false;
    await this.flush();
  }

  // Conflict: discard local input and show the latest content.
  discardLocal() {
    const view = this.getView();
    for (const { node } of view ? flatBlocks(view.state.doc) : []) localStorage.removeItem(blockDraftKey(node.attrs.id));
    this.blocked = false;
    this.replaceDoc(buildDoc(this.pageId));
    setStatus(t("최신 내용으로 바꿨습니다."));
  }

  // Conflict: apply my input on top of the latest state (explicit user choice).
  async keepLocal() {
    const view = this.getView();
    if (!view || !this.syncedDoc) return;
    const merged = mergeLocal(this.syncedDoc, view.state.doc, buildDoc(this.pageId));
    this.blocked = false;
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, merged.content);
    tr.setMeta('addToHistory', false).setMeta('sync', true);
    view.dispatch(tr);
    this.markSynced(buildDoc(this.pageId));
    this.baseRevision = workspace.revision;
    await this.flush();
  }
}

// Three-way merge on block ids: start from the latest server document and re-apply the
// blocks I changed, created or removed since the last synchronised document.
function mergeLocal(base: PMNode, local: PMNode, latest: PMNode): PMNode {
  const baseEntries = flatEntries(base), localEntries = flatEntries(local);
  const changed = new Map<string, PMNode>();
  const created: Array<{ node: PMNode; after: string | null }> = [];
  const removed = new Set<string>();
  let previous: string | null = null;
  for (const { node } of flatBlocks(local)) {
    if (node.type.name === 'columns' || node.type.name === 'tabs') { previous = node.attrs.id; continue; }
    const id = node.attrs.id as string;
    const old = baseEntries.get(id);
    const mine = localEntries.get(id);
    if (!old && mine) created.push({ node, after: previous });
    else if (old && mine && old.key !== mine.key) changed.set(id, node);
    previous = id;
  }
  for (const id of baseEntries.keys()) if (!localEntries.has(id)) removed.add(id);
  const out: PMNode[] = [];
  const inserted = new Set<string>();
  const insertAfter = (id: string | null) => {
    for (const item of created) if (item.after === id && !inserted.has(item.node.attrs.id)) { inserted.add(item.node.attrs.id); out.push(item.node); insertAfter(item.node.attrs.id); }
  };
  insertAfter(null);
  latest.forEach(node => {
    const id = node.attrs.id as string;
    if (removed.has(id)) return;
    out.push(changed.get(id) ?? node);
    insertAfter(id);
  });
  for (const item of created) if (!inserted.has(item.node.attrs.id)) out.push(item.node);
  return schema.nodes.doc.create(null, Fragment.from(out));
}
