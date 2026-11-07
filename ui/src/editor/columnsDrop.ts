import { apply, newId } from '../data/commands';
import { workspace, report } from '../data/store';
import type { BlockEntity, Operation } from '../data/types';

// Dropping blocks at the left/right edge of another block puts them side by side: a
// top-level target becomes a two-column layout, a block inside a column
// gets a new column next to its own. Columns emptied by the move are removed, and a
// layout left with one column is unwrapped.

function cleanupOps(ids: string[], exclude: Set<string>): Operation[] {
  const ops: Operation[] = [];
  const moving = new Set(ids);
  const columns = new Set<string>();
  for (const id of ids) {
    const parent = workspace.get<BlockEntity>(workspace.get(id)?.parentId ?? '');
    if (parent?.blockType === 'column' && !exclude.has(parent.id)) columns.add(parent.id);
  }
  for (const columnId of columns) {
    const column = workspace.get<BlockEntity>(columnId)!;
    const remaining = workspace.children(columnId).filter(child => !moving.has(child.id));
    if (remaining.length) continue;
    const layout = workspace.get<BlockEntity>(column.parentId ?? '');
    const siblings = layout ? workspace.children(layout.id).filter(child => child.id !== columnId) : [];
    ops.push({ type: 'node.trash', id: columnId });
    if (layout && siblings.length === 1 && !exclude.has(layout.id)) {
      // One column left: move its blocks to where the layout was, then drop the layout.
      for (const child of workspace.children(siblings[0].id)) if (!moving.has(child.id)) ops.push({ type: 'node.move', id: child.id, parentId: layout.parentId ?? null, beforeId: layout.id });
      ops.push({ type: 'node.trash', id: layout.id });
    }
  }
  return ops;
}

export async function dropBesides(ids: string[], targetId: string, side: 'left' | 'right', flush: () => Promise<void>) {
  try {
    await flush();
    // Only the top-most dragged blocks move; their children travel with them.
    const chosen = new Set(ids);
    ids = ids.filter(id => { for (let parent = workspace.get(id)?.parentId; parent; parent = workspace.get(parent)?.parentId) if (chosen.has(parent)) return false; return !!workspace.get(id); });
    if (!ids.length) return;
    const target = workspace.get<BlockEntity>(targetId);
    if (!target) return;
    const parent = workspace.get<BlockEntity>(target.parentId ?? '');
    if (parent?.blockType === 'column') {
      // New column next to the target's column.
      const layoutId = parent.parentId!;
      const columns = workspace.children(layoutId);
      const index = columns.findIndex(column => column.id === parent.id);
      const beforeId = side === 'left' ? parent.id : columns[index + 1]?.id;
      const columnId = newId();
      await apply([
        { type: 'block.create', id: columnId, parentId: layoutId, blockType: 'column', ...(beforeId ? { beforeId } : {}) } as Operation,
        ...ids.map(id => ({ type: 'node.move', id, parentId: columnId } as Operation)),
        ...cleanupOps(ids, new Set([layoutId])),
      ]);
      return;
    }
    // Wrap the target and the dragged blocks in a new two-column layout.
    // Wrap the target and the dragged blocks in a new two-column layout (one command, one undo).
    const layoutId = newId(), first = newId(), second = newId();
    const [targetColumn, draggedColumn] = side === 'left' ? [second, first] : [first, second];
    await apply([
      { type: 'block.create', id: layoutId, parentId: target.parentId!, blockType: 'columns', columnIds: [first, second], beforeId: target.id } as Operation,
      { type: 'node.move', id: target.id, parentId: targetColumn },
      ...ids.map(id => ({ type: 'node.move', id, parentId: draggedColumn } as Operation)),
      ...cleanupOps(ids, new Set()),
    ]);
  } catch (error) { report(error); }
}
