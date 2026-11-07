import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model';
import { EditorState, NodeSelection, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { schema, textTypes, isToggleNode } from './schema';
import { newBlockId } from './convert';
import { extrasFromEntity, setCreateExtras } from './extras';

// Helpers for the flat block model (siblings with a depth attribute).

export const flatNames = new Set(['text_block', 'code_block', 'atom_block', 'page_link', 'database']);
export const isFlat = (node: PMNode | null | undefined) => !!node && flatNames.has(node.type.name);
// A tabs block is a block of its own (handle, menu, selection, depth) though it holds content.
export const isBlockNode = (node: PMNode | null | undefined) => isFlat(node) || node?.type.name === 'tabs';

export interface BlockInfo {
  node: PMNode;
  pos: number; // position before the block node
  end: number; // position after the block node
  depth: number; // resolved-pos depth of the block node
  container: PMNode;
  containerStart: number; // position of the first child inside the container
  index: number; // index inside the container
}

export function blockAt($pos: ResolvedPos): BlockInfo | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (isFlat(node)) {
      const pos = $pos.before(d);
      return { node, pos, end: pos + node.nodeSize, depth: d, container: $pos.node(d - 1), containerStart: $pos.start(d - 1), index: $pos.index(d - 1) };
    }
  }
  // Node selections sit just before an atom.
  const after = $pos.nodeAfter;
  if (isBlockNode(after)) {
    const d = $pos.depth;
    return { node: after!, pos: $pos.pos, end: $pos.pos + after!.nodeSize, depth: d + 1, container: $pos.node(d), containerStart: $pos.start(d), index: $pos.index(d) };
  }
  return null;
}

export function blockFromSelection(state: EditorState): BlockInfo | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && isBlockNode(selection.node)) return blockAt(state.doc.resolve(selection.from));
  return blockAt(selection.$from);
}

// Block plus its descendants (following siblings with greater depth).
export function subtreeEnd(info: BlockInfo): { end: number; lastIndex: number } {
  const depth = info.node.attrs.depth ?? 0;
  let end = info.end, lastIndex = info.index;
  for (let i = info.index + 1; i < info.container.childCount; i++) {
    const child = info.container.child(i);
    if (!isBlockNode(child) || (child.attrs.depth ?? 0) <= depth) break;
    end += child.nodeSize; lastIndex = i;
  }
  return { end, lastIndex };
}

export function childPositions(container: PMNode, containerStart: number) {
  const result: Array<{ node: PMNode; pos: number; index: number }> = [];
  let pos = containerStart;
  container.forEach((node, _offset, index) => { result.push({ node, pos, index }); pos += node.nodeSize; });
  return result;
}

export function previousBlock(state: EditorState, info: BlockInfo): BlockInfo | null {
  if (info.index === 0) return null;
  return blockAt(state.doc.resolve(info.pos - 1));
}

export function setDepth(tr: Transaction, pos: number, depth: number) {
  const node = tr.doc.nodeAt(pos);
  if (!node) return;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, depth: Math.max(0, depth) });
}

// Shift a block and its descendants by delta (indent/outdent).
export function shiftSubtree(state: EditorState, info: BlockInfo, delta: number, tr = state.tr): Transaction {
  const { lastIndex } = subtreeEnd(info);
  const positions = childPositions(info.container, info.containerStart);
  for (let i = info.index; i <= lastIndex; i++) {
    const { node, pos } = positions[i];
    if (!isBlockNode(node)) continue;
    tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, depth: Math.max(0, (node.attrs.depth ?? 0) + delta) });
  }
  return tr;
}

export function canIndent(state: EditorState, info: BlockInfo) {
  if (info.index === 0) return false;
  const prev = info.container.child(info.index - 1);
  if (!isFlat(prev) || prev.type.name === 'page_link' || prev.type.name === 'database') return false;
  if (prev.type.name === 'atom_block' && prev.attrs.blockType === 'synced_reference') return false;
  return (info.node.attrs.depth ?? 0) <= (prev.attrs.depth ?? 0);
}

export function indent(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const blocks = selectedOrCurrentBlocks(state);
  if (!blocks.length || !canIndent(state, blocks[0])) return false;
  if (blocks.some(info => info.node.type.name === 'page_link' || info.node.type.name === 'database')) return false;
  if (dispatch) {
    const tr = state.tr;
    const roots = topLevelOf(blocks);
    for (const info of roots) shiftSubtree(state, info, 1, tr);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

export function outdent(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const blocks = selectedOrCurrentBlocks(state);
  if (!blocks.length || blocks.every(info => (info.node.attrs.depth ?? 0) === 0)) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const info of topLevelOf(blocks)) if ((info.node.attrs.depth ?? 0) > 0) {
      // Following siblings that were children of the same parent become children of this block.
      shiftSubtree(state, info, -1, tr);
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
}

function topLevelOf(blocks: BlockInfo[]) {
  const result: BlockInfo[] = [];
  let minDepth = Infinity;
  for (const info of blocks) minDepth = Math.min(minDepth, info.node.attrs.depth ?? 0);
  // Keep blocks that are not descendants of an earlier selected block.
  let coveredUntil = -1;
  for (const info of blocks) {
    if (info.pos < coveredUntil) continue;
    result.push(info);
    coveredUntil = subtreeEnd(info).end;
  }
  return result;
}

// Block selection (plugin state lives in selection.ts) or the caret's block.
let selectedBlocksGetter: (state: EditorState) => BlockInfo[] = () => [];
export function registerSelectedBlocks(getter: (state: EditorState) => BlockInfo[]) { selectedBlocksGetter = getter; }
export function selectedOrCurrentBlocks(state: EditorState): BlockInfo[] {
  const selected = selectedBlocksGetter(state);
  if (selected.length) return selected;
  const { from, to } = state.selection;
  const first = blockAt(state.doc.resolve(from));
  if (!first) return [];
  if (from === to) return [first];
  const result: BlockInfo[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (isFlat(node)) { result.push(blockAt(state.doc.resolve(pos + 1)) ?? first); return false; }
    return true;
  });
  return result.length ? result : [first];
}

export function newTextBlock(attrs: Record<string, unknown> = {}, content?: Fragment | PMNode[]) {
  return schema.nodes.text_block.create({ id: newBlockId(), depth: 0, blockType: 'paragraph', checked: false, ...attrs }, content);
}

// Enter: split into a new block of the same list type (or a paragraph).
export function splitBlock(state: EditorState, dispatch?: (tr: Transaction) => void, collapsed?: (id: string) => boolean): boolean {
  const { $from, $to } = state.selection;
  const info = blockAt($from);
  if (!info || info.node.type.name !== 'text_block') return false;
  if (!$from.sameParent($to)) return false;
  const node = info.node, type = node.attrs.blockType as string, depth = node.attrs.depth ?? 0;
  const empty = node.content.size === 0;
  if (empty && ['bullet', 'numbered', 'todo', 'toggle', 'quote', 'callout'].includes(type)) {
    if (dispatch) {
      const tr = state.tr;
      if (depth > 0 && type !== 'quote' && type !== 'callout') shiftSubtree(state, info, -1, tr);
      else tr.setNodeMarkup(info.pos, undefined, { ...node.attrs, blockType: 'paragraph', checked: false });
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  if (empty && depth > 0 && type === 'paragraph') {
    // Enter on an empty nested line moves it out one level.
    if (dispatch) dispatch(shiftSubtree(state, info, -1).scrollIntoView());
    return true;
  }
  if (dispatch) {
    const tr = state.tr;
    if (!state.selection.empty) tr.deleteSelection();
    const $pos = tr.selection.$from;
    const atStart = $pos.parentOffset === 0 && node.content.size > 0;
    const keepType = ['bullet', 'numbered', 'todo', 'toggle'].includes(type);
    let nextDepth = depth;
    const toggleLike = isToggleNode(node);
    const isOpenToggle = toggleLike && !collapsed?.(node.attrs.id);
    const hasChildren = info.index + 1 < info.container.childCount && (info.container.child(info.index + 1).attrs.depth ?? 0) > depth;
    if (isOpenToggle && hasChildren && !atStart) nextDepth = depth + 1;
    if (atStart) {
      // New empty block above, caret stays in the current one.
      const above = newTextBlock({ depth, blockType: keepType ? type : 'paragraph' });
      tr.insert(info.pos, above);
      dispatch(tr.scrollIntoView());
      return true;
    }
    const nextType = keepType ? type : 'paragraph';
    const rest = node.content.cut($pos.parentOffset);
    tr.delete($pos.pos, info.pos + 1 + node.content.size);
    let insertAt = tr.mapping.map(info.end);
    if (toggleLike && !isOpenToggle && hasChildren) {
      // Closed toggle: the new block goes after its hidden children.
      const mapped = blockAt(tr.doc.resolve(tr.mapping.map(info.pos) + 1));
      if (mapped) insertAt = subtreeEnd(mapped).end;
    }
    const next = newTextBlock({ depth: nextDepth, blockType: nextType }, rest);
    tr.insert(insertAt, next);
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// Backspace at the start of a block: convert to text, outdent, or merge upward.
export function joinBackward(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const info = blockAt($from);
  if (!info || info.node.type.name !== 'text_block' || $from.parentOffset !== 0) return false;
  const node = info.node, type = node.attrs.blockType as string, depth = node.attrs.depth ?? 0;
  if (type !== 'paragraph') {
    if (dispatch) dispatch(state.tr.setNodeMarkup(info.pos, undefined, { ...node.attrs, blockType: 'paragraph', checked: false }));
    return true;
  }
  if (depth > 0) {
    if (dispatch) dispatch(shiftSubtree(state, info, -1));
    return true;
  }
  if (info.index === 0) {
    // First block inside a column: merge columns away when it is the only content.
    return false;
  }
  const prev = info.container.child(info.index - 1);
  const prevPos = info.pos - prev.nodeSize;
  if (prev.type.name === 'text_block') {
    if (dispatch) {
      const tr = state.tr;
      const joinAt = prevPos + 1 + prev.content.size;
      tr.delete(info.pos, info.end);
      tr.insert(joinAt, node.content);
      tr.setSelection(TextSelection.create(tr.doc, joinAt));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  if (prev.type.name === 'code_block') {
    if (dispatch) {
      const tr = state.tr;
      const joinAt = prevPos + 1 + prev.content.size;
      tr.delete(info.pos, info.end);
      if (node.textContent) tr.insertText(node.textContent, joinAt);
      tr.setSelection(TextSelection.create(tr.doc, joinAt));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  // Previous block is an atom (divider, image, database…): select it; an empty line is removed.
  if (dispatch) {
    const tr = state.tr;
    if (node.content.size === 0) tr.delete(info.pos, info.end);
    tr.setSelection(NodeSelection.create(tr.doc, prevPos));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// Delete at the end of a text block pulls the next text block's content up.
export function joinForward(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const info = blockAt($from);
  if (!info || info.node.type.name !== 'text_block' || $from.parentOffset !== info.node.content.size) return false;
  if (info.index + 1 >= info.container.childCount) return false;
  const next = info.container.child(info.index + 1);
  const nextPos = info.end;
  if (dispatch) {
    const tr = state.tr;
    if (next.type.name === 'text_block' || next.type.name === 'code_block') {
      tr.delete(nextPos, nextPos + next.nodeSize);
      if (next.type.name === 'text_block') tr.insert(info.end - 1, next.content);
      else if (next.textContent) tr.insertText(next.textContent, info.end - 1);
      tr.setSelection(TextSelection.create(tr.doc, $from.pos));
    } else {
      tr.setSelection(NodeSelection.create(tr.doc, nextPos));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// ⌘⇧↑ / ⌘⇧↓: move the block (with its children) past the neighbouring sibling subtree.
export function moveBlock(direction: -1 | 1) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const blocks = selectedOrCurrentBlocks(state);
    if (!blocks.length) return false;
    const first = blocks[0], last = blocks[blocks.length - 1];
    const lastEnd = subtreeEnd(last).end;
    const container = first.container, start = first.containerStart;
    const positions = childPositions(container, start);
    const depth = first.node.attrs.depth ?? 0;
    if (direction < 0) {
      // find previous sibling at same or lower depth
      let i = first.index - 1;
      while (i >= 0 && isBlockNode(positions[i].node) && (positions[i].node.attrs.depth ?? 0) > depth) i--;
      if (i < 0) return false;
      if (dispatch) {
        const target = positions[i].pos;
        const slice = state.doc.slice(first.pos, lastEnd);
        const tr = state.tr.delete(first.pos, lastEnd).insert(target, slice.content);
        const offset = state.selection.from - first.pos;
        tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.doc.content.size, target + Math.max(1, offset)))));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    const nextIndex = positions.findIndex(item => item.pos >= lastEnd);
    if (nextIndex < 0) return false;
    const nextInfo = blockAt(state.doc.resolve(positions[nextIndex].pos + 1)) ?? { ...first, node: positions[nextIndex].node, pos: positions[nextIndex].pos, end: positions[nextIndex].pos + positions[nextIndex].node.nodeSize, index: nextIndex };
    const nextEnd = subtreeEnd(nextInfo as BlockInfo).end;
    if (dispatch) {
      const slice = state.doc.slice(first.pos, lastEnd);
      const size = lastEnd - first.pos;
      const tr = state.tr.insert(nextEnd, slice.content).delete(first.pos, lastEnd);
      const target = nextEnd - size;
      const offset = state.selection.from - first.pos;
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.doc.content.size, target + Math.max(1, offset)))));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// Copies get fresh ids so they become new blocks.
export function withFreshIds(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach(node => {
    // Copied text leaves its discussions behind.
    if (node.isText) { nodes.push(node.marks.some(mark => mark.type.name === 'comment') ? node.mark(node.marks.filter(mark => mark.type.name !== 'comment')) : node); return; }
    if (!('id' in node.attrs)) { nodes.push(node.isLeaf ? node : node.copy(withFreshIds(node.content))); return; }
    const content = node.isLeaf ? node.content : withFreshIds(node.content);
    if (node.type.name === 'page_link' || node.type.name === 'database') return; // pages and databases are not copied inline
    const id = newBlockId();
    if (node.type.name === 'atom_block') setCreateExtras(id, extrasFromEntity(node.attrs.id));
    nodes.push(node.type.create({ ...node.attrs, id, virtual: false }, content, node.marks));
  });
  return Fragment.from(nodes);
}

export function duplicateBlocks(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const blocks = selectedOrCurrentBlocks(state);
  if (!blocks.length) return false;
  const first = blocks[0];
  const end = subtreeEnd(blocks[blocks.length - 1]).end;
  if (dispatch) {
    const slice = state.doc.slice(first.pos, end);
    const copies = withFreshIds(slice.content);
    const tr = state.tr.insert(end, copies);
    // Keep the copies selected when blocks were selected.
    const ids: string[] = [];
    copies.forEach(node => { if (node.attrs?.id && (node.attrs.depth ?? 0) === (first.node.attrs.depth ?? 0)) ids.push(node.attrs.id); });
    if (selectedBlocksGetter(state).length) tr.setMeta('keepBlockSelection', true).setMeta('selectCopies', ids);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

export function setBlockType(blockType: string, extra: Record<string, unknown> = {}) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const blocks = selectedOrCurrentBlocks(state);
    if (!blocks.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const info of blocks) {
        const node = info.node;
        const pos = tr.mapping.map(info.pos);
        if ((textTypes as readonly string[]).includes(blockType)) {
          if (node.type.name === 'text_block') tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockType, checked: blockType === 'todo' ? !!node.attrs.checked : false, ...extra });
          else if (node.type.name === 'code_block') tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.text_block.create({ id: node.attrs.id, depth: node.attrs.depth, blockType, ...extra }, node.textContent ? schema.text(node.textContent) : undefined));
        } else if (blockType === 'code') {
          if (node.type.name === 'text_block') tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.code_block.create({ id: node.attrs.id, depth: node.attrs.depth }, node.textContent ? schema.text(node.textContent) : undefined));
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function insertBlockAfter(state: EditorState, info: BlockInfo, node: PMNode, tr = state.tr, { select = true } = {}) {
  const end = subtreeEnd(info).end;
  tr.insert(end, node);
  if (select) {
    if (node.isTextblock) tr.setSelection(TextSelection.create(tr.doc, end + 1));
    else tr.setSelection(NodeSelection.create(tr.doc, end));
  }
  return tr;
}

export function replaceBlock(state: EditorState, info: BlockInfo, node: PMNode, tr = state.tr) {
  tr.replaceWith(info.pos, info.end, node);
  return tr;
}

export function sliceFromNodes(nodes: PMNode[]) { return new Slice(Fragment.from(nodes), 0, 0); }
