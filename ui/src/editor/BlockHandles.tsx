import { t } from '../i18n';
import { pressClosedMenu } from '../ui/overlay';
import { Fragment as ReactFragment, useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { Icon } from '../ui/Icon';
import { blockAt, isBlockNode, isFlat, newTextBlock, subtreeEnd, type BlockInfo } from './blocks';
import { blockSelectionKey, flatBlocks, triggerKey } from './plugins';
import { createDragGhost, edgeScroller, pastThreshold, useFadeList, type DragGhost } from '../ui/drag';

// Hover handles ("+" and "⋮⋮") at the left of the hovered block, drag to reorder.
// Drag handle 18×24 at block x−28, "+" 24×24 at x−52, centred on the first line.

interface Hover { info: BlockInfo; element: HTMLElement; left: number; top: number }

function blockElementAt(view: EditorView, x: number, y: number): HTMLElement | null {
  const root = view.dom.getBoundingClientRect();
  if (y < root.top - 4 || y > root.bottom + 4) return null;
  const probeX = Math.max(root.left + 8, Math.min(x, root.right - 8));
  let element = document.elementFromPoint(probeX, y) as HTMLElement | null;
  if (!element || !view.dom.contains(element)) {
    // between blocks: search nearest by rect
    let best: HTMLElement | null = null, distance = Infinity;
    view.dom.querySelectorAll<HTMLElement>(':scope > .block[data-block-id]').forEach(candidate => {
      if (candidate.classList.contains('block-hidden')) return;
      const rect = candidate.getBoundingClientRect();
      const d = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      if (d < distance && rect.height > 0) { distance = d; best = candidate; }
    });
    return distance < 24 ? best : null;
  }
  let block = element.closest<HTMLElement>('.block[data-block-id]');
  if (block?.classList.contains('block-columns') || (!block && element.closest('.block-column'))) {
    // In a column gap or below a short column: nearest block of the layout at this height.
    const layout = element.closest<HTMLElement>('.block-columns');
    if (!layout) return null;
    let best: HTMLElement | null = null, distance = Infinity;
    layout.querySelectorAll<HTMLElement>('.block-column > .block[data-block-id]').forEach(candidate => {
      const rect = candidate.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) return;
      const d = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      if (d < distance) { distance = d; best = candidate; }
    });
    block = best;
  }
  return block && view.dom.contains(block) ? block : null;
}

function infoForElement(view: EditorView, element: HTMLElement): BlockInfo | null {
  if (element.classList.contains('block-tabs')) {
    const entry = flatBlocks(view.state.doc).find(item => item.node.attrs.id === element.dataset.blockId && item.node.type.name === 'tabs');
    return entry ? blockAt(view.state.doc.resolve(entry.pos)) : null;
  }
  try {
    const pos = view.posAtDOM(element, 0);
    const $pos = view.state.doc.resolve(Math.max(0, Math.min(pos, view.state.doc.content.size)));
    const info = blockAt($pos);
    if (info && info.node.attrs.id === element.dataset.blockId) return info;
    // atoms: pos points before the node
    const node = view.state.doc.nodeAt(pos);
    if (node && isFlat(node) && node.attrs.id === element.dataset.blockId) return blockAt(view.state.doc.resolve(pos));
    const before = view.state.doc.nodeAt(pos - 1);
    if (before && isFlat(before) && before.attrs.id === element.dataset.blockId) return blockAt(view.state.doc.resolve(pos - 1));
    return info;
  } catch {
    return null;
  }
}

function firstLineTop(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const text = element.querySelector<HTMLElement>('.block-text, pre, .block-atom-body') ?? element;
  const style = getComputedStyle(text);
  const line = parseFloat(style.lineHeight) || 24;
  const textRect = text.getBoundingClientRect();
  if (element.classList.contains('block-atom')) return rect.top + 4;
  // A tabs block: the handle sits at the top of its frame (18×24).
  if (element.classList.contains('block-tabs')) return rect.top + 8;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  return textRect.top + paddingTop + (line - 24) / 2;
}

export interface BlockHandlesProps {
  view: EditorView | null;
  scroller: HTMLElement | null;
  onMenu: (anchor: HTMLElement, info: BlockInfo) => void;
  onSideDrop?: (ids: string[], targetId: string, side: 'left' | 'right') => void;
  disabled?: boolean;
}

interface Box { left: number; top: number; width: number; height?: number }
interface Indicator { key: string; lines: Box[]; halo?: Box }

const listTypes = new Set(['bullet', 'numbered', 'todo', 'toggle']);
// Children start at the parent's text: +32 under list items and toggle headings, +30 under text.
function childIndent(node: PMNode) {
  const type = node.attrs.blockType as string | undefined;
  return listTypes.has(type ?? '') || (node.attrs.toggleable && /^heading/.test(type ?? '')) ? 32 : 30;
}

// The DOM of the dragged blocks and everything nested under them, top to bottom.
function draggedElements(view: EditorView, ids: string[]): HTMLElement[] {
  const wanted = new Set(ids);
  const out: HTMLElement[] = [];
  const { doc } = view.state;
  doc.descendants((node, pos) => {
    if (!isBlockNode(node) || !wanted.has(node.attrs.id)) return true;
    const info = blockAt(doc.resolve(pos + (node.isLeaf || node.type.name === 'tabs' ? 0 : 1)));
    if (!info) return false;
    const end = subtreeEnd(info).end;
    doc.nodesBetween(pos, end, (child, childPos) => {
      if (!isBlockNode(child)) return true;
      if (childPos >= pos && childPos < end) { const dom = view.nodeDOM(childPos); if (dom instanceof HTMLElement && !out.includes(dom)) out.push(dom); }
      return false;
    });
    return false;
  });
  return out;
}

export function BlockHandles({ view, scroller, onMenu, onSideDrop, disabled }: BlockHandlesProps) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [dragging, setDragging] = useState(false);
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const fading = useFadeList(indicator, item => item.key);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; info: BlockInfo; active: boolean; target: { pos: number; depth: number; replace?: string } | null; side: { targetId: string; side: 'left' | 'right' } | null; ids: string[] } | null>(null);

  useEffect(() => {
    if (!view || !scroller || disabled) return;
    const onMove = (event: MouseEvent) => {
      if (dragState.current?.active) return;
      if (handleRef.current?.contains(event.target as Node)) return;
      const element = blockElementAt(view, event.clientX, event.clientY);
      if (!element) { setHover(null); return; }
      const info = infoForElement(view, element);
      if (!info) { setHover(null); return; }
      const rect = element.getBoundingClientRect();
      // A narrowed HTML block: the handles follow its left edge.
      const narrow = element.querySelector<HTMLElement>('.html-block.narrow');
      let left = rect.left;
      if (narrow?.parentElement) left = rect.left + narrow.getBoundingClientRect().left - narrow.parentElement.getBoundingClientRect().left - parseFloat(getComputedStyle(narrow.parentElement).paddingLeft || '0');
      setHover({ info, element, left, top: firstLineTop(element) });
    };
    const onLeave = (event: MouseEvent) => { if (!handleRef.current?.contains(event.relatedTarget as Node)) setHover(null); };
    scroller.addEventListener('mousemove', onMove);
    scroller.addEventListener('mouseleave', onLeave);
    const onScroll = () => setHover(null);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller.removeEventListener('mousemove', onMove); scroller.removeEventListener('mouseleave', onLeave); scroller.removeEventListener('scroll', onScroll); };
  }, [view, scroller, disabled]);

  useEffect(() => { setHover(null); }, [view?.state.doc]);

  if (!view || disabled) return null;

  const insertBelow = (info: BlockInfo, above: boolean) => {
    const { state } = view;
    const depth = info.node.attrs.depth ?? 0;
    const empty = info.node.type.name === 'text_block' && info.node.content.size === 0;
    const tr = state.tr;
    let caret: number;
    if (empty && !above) caret = info.pos + 1;
    else {
      const at = above ? info.pos : subtreeEnd(info).end;
      tr.insert(at, newTextBlock({ depth }));
      caret = at + 1;
    }
    tr.insertText('/', caret);
    tr.setSelection(TextSelection.create(tr.doc, caret + 1));
    tr.setMeta(triggerKey, { kind: 'slash', from: caret });
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };

  // Where a drop at this point would go, and how to show it: a 4px line
  // across the whole block at the gap; past the start of the block's text in its lower half the
  // dragged blocks go inside it, shown by a light fill on the block and the line also drawn from
  // where its children start.
  const dropAt = (current: NonNullable<typeof dragState.current>, x: number, y: number): Indicator | null => {
    current.target = null;
    current.side = null;
    // Over "빈 탭입니다…": the blocks go into that tab, in place of its empty line.
    const hint = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.tab-empty-hint');
    if (hint && view.dom.contains(hint)) {
      const entry = flatBlocks(view.state.doc).find(item => item.node.attrs.id === hint.dataset.tabLine);
      const draggedStart = current.info.pos, draggedEnd = subtreeEnd(current.info).end;
      if (!entry || (entry.pos > draggedStart && entry.pos < draggedEnd)) return null;
      current.target = { pos: entry.pos, depth: 0, replace: entry.node.attrs.id };
      const box = hint.getBoundingClientRect();
      return { key: `tab:${entry.pos}`, lines: [], halo: { left: box.left, top: box.top, width: box.width, height: box.height } };
    }
    const target = blockElementAt(view, x, y);
    if (!target) return null;
    if (target.classList.contains('block-columns')) {
      const rect = target.getBoundingClientRect();
      const after = y > rect.top + rect.height / 2;
      const before = view.posAtDOM(target, 0) - 1;
      const node = view.state.doc.nodeAt(before);
      if (node?.type.name !== 'columns') return null;
      current.target = { pos: after ? before + node.nodeSize : before, depth: 0 };
      return { key: `columns:${current.target.pos}`, lines: [{ left: rect.left, top: after ? rect.bottom : rect.top, width: rect.width }] };
    }
    const targetInfo = infoForElement(view, target);
    if (!targetInfo || current.ids.includes(targetInfo.node.attrs.id)) return null;
    const rect = target.getBoundingClientRect();
    // Side drop: pointer in the gutter left of the block or past its right edge (makes columns).
    const sideable = onSideDrop && (targetInfo.node.attrs.depth ?? 0) === 0 && targetInfo.node.type.name !== 'columns';
    const side = !sideable ? null : x < rect.left ? 'left' : x > rect.right ? 'right' : null;
    if (side) {
      current.side = { targetId: targetInfo.node.attrs.id, side };
      return { key: `side:${targetInfo.node.attrs.id}:${side}`, lines: [{ left: side === 'left' ? rect.left - 2 : rect.right - 2, top: rect.top + 4, width: 4, height: rect.height - 8 }] };
    }
    const after = y > rect.top + rect.height / 2;
    const depth = targetInfo.node.attrs.depth ?? 0;
    const indentBy = childIndent(targetInfo.node);
    const nest = after && x > rect.left + indentBy && targetInfo.node.type.name === 'text_block';
    const subtree = subtreeEnd(targetInfo).end;
    const pos = after ? (nest ? targetInfo.end : subtree) : targetInfo.pos;
    const newDepth = nest ? depth + 1 : depth;
    const draggedStart = current.info.pos, draggedEnd = subtreeEnd(current.info).end;
    if (pos > draggedStart && pos < draggedEnd) return null;
    // No line just above the block that follows the dragged ones (nothing would
    // move), but the line under the block before them is still shown.
    if (!after && pos === draggedEnd && newDepth === (current.info.node.attrs.depth ?? 0)) return null;
    current.target = { pos, depth: newDepth };
    if (nest) {
      return {
        key: `nest:${pos}`,
        lines: [{ left: rect.left, top: rect.bottom, width: rect.width }, { left: rect.left + indentBy, top: rect.bottom - 1, width: rect.width - indentBy }],
        halo: { left: rect.left + 2, top: rect.top + 2, width: rect.width - 4, height: rect.height - 4 },
      };
    }
    // After a block with children the drop goes below the last of them.
    let bottom = rect.bottom;
    if (after && subtree !== targetInfo.end) {
      const last = draggedElements(view, [targetInfo.node.attrs.id]).at(-1);
      if (last) bottom = last.getBoundingClientRect().bottom;
    }
    return { key: `at:${pos}:${newDepth}`, lines: [{ left: rect.left, top: after ? bottom : rect.top, width: rect.width }] };
  };

  const startDrag = (event: React.PointerEvent, info: BlockInfo) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const selected = blockSelectionKey.getState(view.state)?.ids ?? [];
    const ids = selected.includes(info.node.attrs.id) ? selected : [info.node.attrs.id];
    dragState.current = { startX: event.clientX, startY: event.clientY, info, active: false, target: null, side: null, ids };
    // Pressing ⋮⋮ while its menu is open only closes the menu.
    const menuWasOpen = pressClosedMenu(event.nativeEvent, event.currentTarget as Element);
    let ghost: DragGhost | null = null;
    let last = { x: event.clientX, y: event.clientY };
    // Near the top or bottom of the page the page scrolls along (the drop line follows).
    const auto = edgeScroller(view.dom.closest<HTMLElement>('.frame-scroller'), () => { const current = dragState.current; if (current?.active) setIndicator(dropAt(current, last.x, last.y)); });
    const move = (moveEvent: PointerEvent) => {
      const current = dragState.current;
      if (!current) return;
      if (!current.active && !pastThreshold(moveEvent.clientX - current.startX, moveEvent.clientY - current.startY)) return;
      if (!current.active) {
        current.active = true;
        document.body.classList.add('dragging-blocks');
        setDragging(true);
        ghost = createDragGhost(draggedElements(view, current.ids), current.startX, current.startY, { contextClass: 'page-editor' });
      }
      last = { x: moveEvent.clientX, y: moveEvent.clientY };
      ghost?.move(moveEvent.clientX, moveEvent.clientY);
      setIndicator(dropAt(current, moveEvent.clientX, moveEvent.clientY));
      auto.update(moveEvent.clientX, moveEvent.clientY);
    };
    const up = () => {
      auto.stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-blocks');
      ghost?.remove();
      setDragging(false);
      setIndicator(null);
      const current = dragState.current;
      dragState.current = null;
      if (!current) return;
      if (!current.active) {
        if (menuWasOpen) return;
        // Click: select the block and open the block menu.
        view.dispatch(view.state.tr.setMeta(blockSelectionKey, { ids: current.ids, anchor: current.ids[0], head: current.ids.at(-1) }).setMeta('keepBlockSelection', true));
        if (handleRef.current) onMenu(handleRef.current.querySelector<HTMLElement>('.block-drag-handle') ?? handleRef.current, current.info);
        return;
      }
      // The moved blocks end up selected (moveBlocksTo), fading in.
      if (current.side) onSideDrop?.(current.ids, current.side.targetId, current.side.side);
      else if (current.target) moveBlocksTo(view, current.ids, current.target.pos, current.target.depth, current.target.replace);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      {hover && !dragging ? (
        <div ref={handleRef} className="block-handles" style={{ left: hover.left - 52, top: hover.top }} onMouseLeave={event => { if (!hover.element.contains(event.relatedTarget as Node)) setHover(null); }}>
          <button type="button" className="block-add-button" aria-label={t("클릭하여 아래에 블록 추가, Option-클릭하여 위에 추가")} title={t("클릭하여 아래에 추가\nOption-클릭하여 위에 추가")} onMouseDown={event => event.preventDefault()} onClick={event => insertBelow(hover.info, event.altKey)}>
            <Icon name="plus" size={20} />
          </button>
          <div className="block-drag-handle" role="button" aria-label={t("드래그하여 옮기기, 클릭하여 메뉴 열기")} title={t("드래그하여 옮기기\n클릭하여 메뉴 열기")} onPointerDown={event => startDrag(event, hover.info)}
            onContextMenu={event => { event.preventDefault(); view.dispatch(view.state.tr.setMeta(blockSelectionKey, { ids: [hover.info.node.attrs.id], anchor: hover.info.node.attrs.id, head: hover.info.node.attrs.id }).setMeta('keepBlockSelection', true)); onMenu(event.currentTarget, hover.info); }}>
            <Icon name="drag" size={20} />
          </div>
        </div>
      ) : null}
      {fading.map(entry => (
        <ReactFragment key={entry.id}>
          {entry.item.halo ? <div className={`drop-halo drop-fade${entry.leaving ? ' leaving' : ''}`} style={{ left: entry.item.halo.left, top: entry.item.halo.top, width: entry.item.halo.width, height: entry.item.halo.height }} /> : null}
          {entry.item.lines.map((line, index) => <div key={index} className={`drop-indicator drop-fade${entry.leaving ? ' leaving' : ''}`} style={{ left: line.left, top: line.top, width: line.width, ...(line.height ? { height: line.height } : {}) }} />)}
        </ReactFragment>
      ))}
    </>
  );
}

// Move blocks (with their children) to a document position, adjusting depth.
export function moveBlocksTo(view: EditorView, ids: string[], targetPos: number, targetDepth: number, replaceLine?: string) {
  const { state } = view;
  const ranges: Array<{ from: number; to: number; nodes: PMNode[]; baseDepth: number }> = [];
  const wanted = new Set(ids);
  state.doc.descendants((node, pos) => {
    if (!isBlockNode(node) || !wanted.has(node.attrs.id)) return true;
    const info = blockAt(state.doc.resolve(pos + (node.isLeaf || node.type.name === 'tabs' ? 0 : 1)));
    if (!info) return false;
    const end = subtreeEnd(info).end;
    if (ranges.some(range => pos >= range.from && pos < range.to)) return false;
    const nodes: PMNode[] = [];
    state.doc.slice(pos, end).content.forEach(child => nodes.push(child));
    // Moving everything out of a column removes the column itself.
    const $at = state.doc.resolve(pos);
    const whole = $at.parent.type.name === 'column' && pos === $at.start() && end === $at.end();
    ranges.push({ from: whole ? $at.before() : pos, to: whole ? $at.after() : end, nodes, baseDepth: node.attrs.depth ?? 0 });
    return false;
  });
  if (!ranges.length) return;
  const moved: PMNode[] = [];
  for (const range of ranges) for (const node of range.nodes) moved.push(node.type.create({ ...node.attrs, depth: Math.max(0, (node.attrs.depth ?? 0) - range.baseDepth + targetDepth) }, node.content, node.marks));
  const tr = state.tr;
  let insertAt = targetPos;
  for (const range of [...ranges].sort((a, b) => b.from - a.from)) {
    tr.delete(range.from, range.to);
    if (range.to <= targetPos) insertAt -= range.to - range.from;
  }
  insertAt = Math.max(0, Math.min(insertAt, tr.doc.content.size));
  tr.insert(insertAt, Fragment.from(moved));
  // Dropped on an empty tab: its empty line gives way to the blocks.
  if (replaceLine) tr.doc.descendants((node, pos) => {
    if (node.attrs.id === replaceLine && node.type.name === 'text_block' && node.content.size === 0) { tr.delete(pos, pos + node.nodeSize); return false; }
    return !node.isTextblock;
  });
  // A layout left with one column (or none) is unwrapped.
  const layouts: Array<{ pos: number; node: PMNode }> = [];
  tr.doc.forEach((child, offset) => { if (child.type.name === 'columns' && child.childCount <= 1) layouts.push({ pos: offset, node: child }); });
  for (const { pos, node } of layouts.reverse()) {
    const content = node.childCount ? node.child(0).content : Fragment.empty;
    tr.replaceWith(pos, pos + node.nodeSize, content);
  }
  tr.setMeta(blockSelectionKey, { ids, anchor: ids[0], head: ids.at(-1) ?? null }).setMeta('keepBlockSelection', true);
  view.dispatch(tr.scrollIntoView());
}
