import { t } from '../i18n';
import type { Node as PMNode } from 'prosemirror-model';
import { workspace } from '../data/store';
import type { BlockEntity, Entity, Operation } from '../data/types';
import { createExtras, forgetExtras } from './extras';
import { desiredTree, runsEqual, normalizeRuns, type DesiredBlock } from './convert';

// Turns the edited document into typed commands: block.create / block.update /
// node.move / node.trash. Sources cannot be moved by the engine, so the order
// reconciliation keeps them fixed and moves the other items around them.

function serverChildren(parentId: string): Entity[] {
  return workspace.children(parentId).filter(child => child.kind === 'block' || child.kind === 'page' || child.kind === 'source' || child.kind === 'view');
}

// Every block (recursively), child page, source and view that the editor shows for this page.
function serverItems(pageId: string): Map<string, Entity> {
  const items = new Map<string, Entity>();
  const visit = (parentId: string, depth: number) => {
    if (depth > 60) return;
    for (const child of workspace.children(parentId)) {
      if (child.kind === 'block') {
        items.set(child.id, child);
        if ((child as BlockEntity).blockType !== 'synced_reference') visit(child.id, depth + 1);
      } else if (depth === 0 && ((child.kind === 'page' && !(child as { sourceId?: string }).sourceId) || child.kind === 'source' || child.kind === 'view')) {
        items.set(child.id, child);
      }
    }
  };
  visit(pageId, 0);
  return items;
}

// Longest increasing subsequence with weights so immovable items always stay.
function stableSet(indices: number[], weights: number[]): Set<number> {
  const n = indices.length;
  const best = new Array<number>(n).fill(0), previous = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    best[i] = weights[i];
    for (let j = 0; j < i; j++) if (indices[j] < indices[i] && best[j] + weights[i] > best[i]) { best[i] = best[j] + weights[i]; previous[i] = j; }
  }
  let end = -1;
  for (let i = 0; i < n; i++) if (end < 0 || best[i] > best[end]) end = i;
  const result = new Set<number>();
  while (end >= 0) { result.add(end); end = previous[end]; }
  return result;
}

export interface DiffResult { operations: Operation[]; createdIds: string[] }

// known: ids the editor showed at the last synchronised state. Items created elsewhere
// in the meantime are not in it and must never be trashed by this diff.
export function diffPage(doc: PMNode, pageId: string, known?: Set<string>): DiffResult {
  const { blocks, order } = desiredTree(doc, pageId);
  const server = serverItems(pageId);
  const operations: Operation[] = [];
  const createdIds: string[] = [];

  const includeVirtual = (item: DesiredBlock) => !item.virtual || (item.richText?.length ?? 0) > 0 || !item.isLastTopLevel || item.blockType !== 'paragraph';
  const desiredIds = new Set([...blocks.values()].filter(includeVirtual).map(item => item.id));

  // 1. Content updates for existing blocks.
  for (const item of blocks.values()) {
    if (item.kind !== 'block' || !desiredIds.has(item.id)) continue;
    const entity = server.get(item.id) as BlockEntity | undefined;
    if (!entity) continue;
    if (item.blockType === 'column') {
      if ((item.ratio ?? null) !== (entity.ratio ?? null)) operations.push({ type: 'block.update', id: item.id, ratio: item.ratio ?? null });
      continue;
    }
    if (item.blockType === 'columns' || item.blockType === 'tabs') continue;
    const update: Operation = { type: 'block.update', id: item.id };
    let changed = false;
    if (item.blockType && item.blockType !== entity.blockType && !(entity.blockType === 'synced' && item.blockType === 'synced')) {
      update.blockType = item.blockType; changed = true;
    }
    if (item.richText !== undefined && !runsEqual(item.richText, entity.richText)) { update.richText = normalizeRuns(item.richText); changed = true; }
    if (item.blockType === 'todo' && !!item.checked !== !!entity.checked) { update.checked = !!item.checked; changed = true; }
    if (item.blockType === 'code' && item.language && item.language !== (entity.language ?? 'plain')) { update.language = item.language; changed = true; }
    if (item.blockType === 'code' && !runsEqual(item.caption ?? [], entity.caption ?? [])) { update.caption = item.caption?.length ? normalizeRuns(item.caption) : null; changed = true; }
    if (item.blockType === 'tab' && (item.icon ?? null) !== (entity.icon ?? null)) { update.icon = item.icon ?? null; changed = true; }
    if (item.node.type.name === 'text_block') {
      if ((item.icon ?? null) !== (entity.icon ?? null)) { update.icon = item.icon ?? null; changed = true; }
      if ((item.color ?? null) !== (entity.color ?? null)) { update.color = item.color ?? null; changed = true; }
      const toggleable = !!item.toggleable && /^heading[1-4]$/.test(item.blockType ?? '');
      if (toggleable !== !!entity.toggleable) { update.toggleable = toggleable; changed = true; }
      const listFormat = item.blockType === 'numbered' ? item.listFormat ?? null : null;
      if (listFormat !== (entity.listFormat ?? null)) { update.listFormat = listFormat; changed = true; }
      if ((item.direction ?? null) !== (entity.direction ?? null)) { update.direction = item.direction ?? null; changed = true; }
    }
    if (changed && entity.blockType !== 'synced_reference') operations.push(update);
  }

  // 2. Order / parent reconciliation, parents before children, each parent back to front.
  //    Creates and moves share one sequence so every beforeId already sits in its final place.
  const structure: Operation[] = [];
  const parents = [...order.keys()].sort((a, b) => depthOf(a, blocks) - depthOf(b, blocks));
  for (const parentId of parents) {
    const list = order.get(parentId)!.filter(id => desiredIds.has(id));
    const current = serverChildren(parentId).map(child => child.id);
    const position = new Map(current.map((id, index) => [id, index]));
    const present = list.map(id => ({ id, at: server.has(id) && server.get(id)!.parentId === parentId ? position.get(id) ?? -1 : -1 }));
    const candidates = present.filter(item => item.at >= 0);
    const keep = stableSet(candidates.map(item => item.at), candidates.map(item => server.get(item.id)?.kind === 'source' ? 1_000_000 : 1));
    const stable = new Set(candidates.filter((_, index) => keep.has(index)).map(item => item.id));
    for (let index = list.length - 1; index >= 0; index--) {
      const id = list[index];
      const next = list[index + 1];
      const item = blocks.get(id)!;
      if (!server.has(id)) {
        if (item.kind !== 'block') continue;
        // A new layout's columns are created by the engine with the ids we name.
        if (item.blockType === 'column' && !server.has(parentId)) { createdIds.push(id); continue; }
        const create: Operation = { type: 'block.create', id, parentId, blockType: item.blockType ?? 'paragraph', ...(item.blockType === 'columns' || item.blockType === 'column' ? {} : { richText: normalizeRuns(item.richText ?? []) }) };
        if (item.blockType === 'columns' && item.columnIds?.length) create.columnIds = item.columnIds.length >= 2 ? item.columnIds : [...item.columnIds, crypto.randomUUID()];
        if (item.icon != null) create.icon = item.icon;
        if (item.color) create.color = item.color;
        if (item.toggleable && /^heading[1-4]$/.test(item.blockType ?? '')) create.toggleable = true;
        if (item.blockType === 'numbered' && item.listFormat) create.listFormat = item.listFormat;
        if (item.direction) create.direction = item.direction;
        if (item.ratio) create.ratio = item.ratio;
        if (item.blockType === 'todo' && item.checked) create.checked = true;
        if (item.blockType === 'code' && item.language && item.language !== 'plain') create.language = item.language;
        if (item.blockType === 'code' && item.caption?.length) create.caption = normalizeRuns(item.caption);
        if (item.blockType === 'table') { create.cells = [[[], [], []], [[], [], []], [[], [], []]]; create.tableHeader = { row: false, column: false }; }
        if (item.blockType === 'button') create.button = { label: t("새 버튼"), confirmation: null, actions: [] };
        Object.assign(create, createExtras(id) ?? {});
        if (next) create.beforeId = next;
        structure.push(create);
        createdIds.push(id);
      } else if (forgetExtras(id), !stable.has(id)) {
        const entity = server.get(id)!;
        if (entity.kind === 'source') continue; // engine keeps sources in place
        const move: Operation = { type: 'node.move', id, parentId };
        if (next) move.beforeId = next;
        structure.push(move);
      }
    }
  }

  // 3. Removed items go to the trash last (after moving surviving children out).
  const trash: Operation[] = [];
  for (const [id, entity] of server) {
    if (desiredIds.has(id) || blocks.has(id)) continue;
    if (known && !known.has(id)) continue;
    // Children of removed blocks are trashed with their parent.
    const parent = workspace.get(entity.parentId);
    if (parent && parent.kind === 'block' && server.has(parent.id) && !desiredIds.has(parent.id)) continue;
    if (entity.kind === 'block' && (entity as BlockEntity).blockType === 'column') {
      const columns = workspace.get(entity.parentId);
      if (columns && !desiredIds.has(columns.id)) continue;
    }
    trash.push({ type: 'node.trash', id });
  }

  return { operations: [...structure, ...operations, ...trash], createdIds };
}

function depthOf(parentId: string, blocks: Map<string, DesiredBlock>): number {
  let depth = 0;
  let current = blocks.get(parentId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) { seen.add(current.id); depth++; current = blocks.get(current.parentId); }
  return depth;
}
