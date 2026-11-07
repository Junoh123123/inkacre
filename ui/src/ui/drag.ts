import { useEffect, useRef, useState } from 'react';

// Shared pieces of dragging (blocks, board cards and sidebar rows):
// - nothing happens until the pointer has moved 7px;
// - what is dragged stays where it is, untouched; a see-through copy (40%) follows the pointer,
//   keeping the point where it was grabbed, with no shadow, tilt or lag;
// - drop lines (4px, blue at 43%) and drop highlights fade in and out over 200ms and jump between
//   places instead of sliding;
// - on release everything moves at once.

export const DRAG_THRESHOLD = 7;
export const pastThreshold = (dx: number, dy: number) => Math.hypot(dx, dy) >= DRAG_THRESHOLD;

export interface DragGhost { move: (x: number, y: number) => void; remove: () => void }

// Copy the source's inline styles through the CSSOM (inline style attributes are blocked by the
// app's content security policy) and drop ids/data attributes so the copy is never mistaken for
// the real thing.
function sanitize(source: Element, copy: Element) {
  if (copy instanceof HTMLElement && source instanceof HTMLElement) {
    if (source.hasAttribute('style')) { copy.removeAttribute('style'); copy.style.cssText = source.style.cssText; }
    if (copy.hasAttribute('contenteditable')) copy.setAttribute('contenteditable', 'false');
  }
  copy.removeAttribute('id');
  for (const name of copy.getAttributeNames()) if (name.startsWith('data-') || name.startsWith('aria-')) copy.removeAttribute(name);
  copy.removeAttribute('title');
  copy.removeAttribute('tabindex');
  const from = source.children, to = copy.children;
  for (let index = 0; index < from.length && index < to.length; index++) sanitize(from[index], to[index]);
}

export function createDragGhost(sources: HTMLElement[], startX: number, startY: number, { className = '', contextClass = '', copyClass = '' }: { className?: string; contextClass?: string; copyClass?: string } = {}): DragGhost {
  const shown = sources.filter(source => source.isConnected && source.getBoundingClientRect().height > 0).slice(0, 60);
  const layer = document.createElement('div');
  layer.className = `drag-ghost-layer${className ? ` ${className}` : ''}`;
  layer.setAttribute('aria-hidden', 'true');
  if (shown.length) {
    const first = shown[0].getBoundingClientRect();
    // Inherited text styles come from where the copies were taken.
    const parent = shown[0].parentElement;
    if (parent) {
      const style = getComputedStyle(parent);
      layer.style.fontFamily = style.fontFamily; layer.style.fontSize = style.fontSize; layer.style.lineHeight = style.lineHeight; layer.style.color = style.color;
    }
    layer.style.left = `${first.left}px`;
    layer.style.top = `${first.top}px`;
    layer.style.width = `${first.width}px`;
    const context = document.createElement('div');
    context.className = `drag-ghost-context${contextClass ? ` ${contextClass}` : ''}`;
    for (const source of shown) {
      const rect = source.getBoundingClientRect();
      const copy = source.cloneNode(true) as HTMLElement;
      sanitize(source, copy);
      if (copyClass) copy.classList.add(...copyClass.split(' '));
      copy.style.position = 'absolute';
      copy.style.margin = '0';
      copy.style.left = `${rect.left - first.left}px`;
      copy.style.top = `${rect.top - first.top}px`;
      copy.style.width = `${rect.width}px`;
      copy.style.height = `${rect.height}px`;
      context.append(copy);
    }
    layer.append(context);
  }
  document.body.append(layer);
  return {
    move: (x, y) => { layer.style.transform = `translate(${x - startX}px, ${y - startY}px)`; },
    remove: () => layer.remove(),
  };
}

// Keeps the previous drop indicator around while it fades out, so a line that moves fades out
// where it was and in where it goes (an indicator belongs to the row it marks).
export interface Fading<T> { id: number; key: string; item: T; leaving: boolean; until: number }

const sameItem = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function useFadeList<T>(item: T | null, keyOf: (item: T) => string, ms = 200): Array<Fading<T>> {
  const [list, setList] = useState<Array<Fading<T>>>([]);
  const sequence = useRef(0);
  const key = item ? keyOf(item) : null;
  useEffect(() => {
    setList(current => {
      const live = current.find(entry => !entry.leaving);
      if (live && key !== null && live.key === key) return sameItem(live.item, item) ? current : current.map(entry => (entry === live ? { ...entry, item: item as T } : entry));
      if (!live && key === null) return current;
      const now = performance.now();
      const next = current.map(entry => (entry.leaving ? entry : { ...entry, leaving: true, until: now + ms }));
      if (item && key !== null) next.push({ id: ++sequence.current, key, item, leaving: false, until: 0 });
      return next;
    });
  }, [key, item, ms]);
  const nextExpiry = list.reduce((soonest, entry) => (entry.leaving && entry.until < soonest ? entry.until : soonest), Infinity);
  useEffect(() => {
    if (nextExpiry === Infinity) return;
    const timer = window.setTimeout(() => setList(current => current.filter(entry => !entry.leaving || entry.until > performance.now() + 1)), Math.max(0, nextExpiry - performance.now()) + 16);
    return () => window.clearTimeout(timer);
  }, [nextExpiry]);
  return list;
}

// Holding a drag near the top or bottom edge of a scrolling area scrolls it, faster the closer the pointer gets
// (and at full speed past the edge); the drop target is worked out again after every step.
export function edgeScroller(element: HTMLElement | null, onScroll: () => void, axis: 'x' | 'y' = 'y') {
  const ZONE = 64, MAX = 22;
  let frame = 0;
  let point: { x: number; y: number } | null = null;
  const tick = () => {
    frame = 0;
    if (!element || !point) return;
    const rect = element.getBoundingClientRect();
    const at = axis === 'y' ? point.y : point.x, start = axis === 'y' ? rect.top : rect.left, end = axis === 'y' ? rect.bottom : rect.right;
    const delta = at < start + ZONE ? -MAX * Math.min(1, (start + ZONE - at) / ZONE) ** 2 : at > end - ZONE ? MAX * Math.min(1, (at - end + ZONE) / ZONE) ** 2 : 0;
    if (!delta) return;
    const before = axis === 'y' ? element.scrollTop : element.scrollLeft;
    if (axis === 'y') element.scrollTop = before + delta; else element.scrollLeft = before + delta;
    if ((axis === 'y' ? element.scrollTop : element.scrollLeft) !== before) onScroll();
    frame = requestAnimationFrame(tick);
  };
  return {
    update(x: number, y: number) { point = { x, y }; if (!frame) frame = requestAnimationFrame(tick); },
    stop() { point = null; if (frame) cancelAnimationFrame(frame); frame = 0; },
  };
}
