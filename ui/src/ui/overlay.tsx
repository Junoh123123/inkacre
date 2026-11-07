import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Anchored layers (menus, pickers, popovers). Escape and outside clicks close the
// top-most layer first.

export type Anchor = Element | DOMRect | { x: number; y: number; width?: number; height?: number };
export type Placement = 'below-start' | 'below-end' | 'below-center' | 'above-start' | 'left-center' | 'right-start' | 'cover' | 'point' | 'center' | 'pointer' | 'below-cover' | 'side-center' | 'side-middle';
// How a layer appears: menus scale and fade in (default); context menus and pickers only fade;
// value editors appear at once.
export type Motion = 'scale' | 'fade' | 'none';

interface Layer { id: number; close: () => void; panel: () => HTMLElement | null; anchor?: Element; modal: boolean }
const layers: Layer[] = [];
let nextLayerId = 1;

export const openLayerCount = () => layers.length;

function topLayerFor(target: Node) {
  for (let index = layers.length - 1; index >= 0; index--) if (layers[index].panel()?.contains(target)) return index;
  return -1;
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !layers.length || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  layers[layers.length - 1].close();
}, true);

// Pressing the button that opened a menu closes it again (the workspace switcher,
// "…" buttons and the like), so that button's own click must not reopen it.
function isToggleAnchor(anchor: Element) {
  if (anchor.closest('.popover-panel, input, textarea')) return false;
  // Inside editable text (but not a non-editable island such as a database block in a page).
  if (anchor.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true') return false;
  return anchor.matches('button, [role="button"], [role="tab"], a, summary');
}
// The press that just closed a menu this way, for handles that open their menu on release
// rather than on click (e.g. a table row's ⋮⋮).
let anchorClose: { anchor: Element; event: Event } | null = null;
export function pressClosedMenu(event: Event, anchor: Element) { return anchorClose?.event === event && anchorClose.anchor === anchor; }
function swallowNextClick(anchor: Element) {
  const swallow = (event: MouseEvent) => {
    if (!anchor.contains(event.target as Node)) return;
    event.stopPropagation(); event.preventDefault();
    window.removeEventListener('click', swallow, true);
  };
  window.addEventListener('click', swallow, true);
  window.setTimeout(() => window.removeEventListener('click', swallow, true), 700);
}

document.addEventListener('pointerdown', event => {
  if (!layers.length) return;
  const target = event.target as Node;
  const index = topLayerFor(target);
  // Close every layer above the one that contains the click (or all of them).
  for (let i = layers.length - 1; i > index; i--) {
    const layer = layers[i];
    if (layer.anchor?.contains(target)) {
      if (event.button === 0 && isToggleAnchor(layer.anchor)) { layer.close(); swallowNextClick(layer.anchor); anchorClose = { anchor: layer.anchor, event }; }
      continue;
    }
    layer.close();
  }
}, true);

export function rectOf(anchor: Anchor): DOMRect {
  if (anchor instanceof Element) return anchor.getBoundingClientRect();
  if (anchor instanceof DOMRect) return anchor;
  return new DOMRect(anchor.x, anchor.y, anchor.width ?? 0, anchor.height ?? 0);
}

const margin = 12;
function place(anchor: Anchor, placement: Placement, panel: HTMLElement, offset: number) {
  const rect = rectOf(anchor);
  const width = panel.offsetWidth, height = panel.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = rect.left, top = rect.bottom + offset;
  switch (placement) {
    case 'below-end': left = rect.right - width; break;
    case 'below-center': left = rect.left + rect.width / 2 - width / 2; break;
    case 'above-start': top = rect.top - height - offset; break;
    case 'left-center': left = rect.left - width - offset; top = rect.top + rect.height / 2 - height / 2; break;
    case 'right-start': left = rect.right + offset; top = rect.top - 4; if (left + width > vw - margin) left = rect.left - width - offset; break;
    // Page-menu submenus: beside the item, centred on it (touching the item,
    // opening to the left when there is no room on the right).
    case 'side-center':
      left = rect.right + offset; top = rect.top + rect.height / 2 - height / 2 - 2;
      if (left + width > vw - margin) left = rect.left - width - offset;
      break;
    // Column-menu submenus: touching the item and centred exactly on it.
    case 'side-middle':
      left = rect.right + offset; top = rect.top + rect.height / 2 - height / 2;
      if (left + width > vw - margin) left = rect.left - width - offset;
      break;
    case 'cover': left = rect.left - 1; top = rect.top - 1; break;
    case 'point': left = rect.left; top = rect.top; break;
    case 'center': left = vw / 2 - width / 2; top = Math.max(72, vh * 0.12); break;
    // Right-click menus: top-left corner 1px under the pointer; without room below, the bottom
    // edge sits on the pointer instead, and without room on the right it opens to the left.
    case 'pointer':
      top = rect.top + 1;
      if (top + height > vh - margin) top = rect.top - height;
      if (left + width > vw - margin) left = rect.left - width;
      break;
    // Property value pickers (date…): over the value's bottom edge; without room below they grow
    // upwards from that same edge, covering the value.
    case 'below-cover':
      left = rect.left - 1; top = rect.bottom - 1;
      if (top + height > vh - margin) top = rect.bottom - 1 - height;
      break;
  }
  if ((placement === 'below-start' || placement === 'below-end' || placement === 'below-center') && top + height > vh - margin) {
    const above = rect.top - height - offset;
    top = above >= margin ? above : Math.max(margin, vh - margin - height);
  }
  left = Math.max(margin, Math.min(left, vw - width - margin));
  top = Math.max(margin, Math.min(top, vh - height - margin));
  return { left, top };
}

export interface PopoverProps {
  anchor: Anchor;
  /** The button that opened it, when it is placed at a point: pressing it again closes the layer. */
  owner?: Element | null;
  placement?: Placement;
  offset?: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  modal?: boolean;
  autoFocus?: boolean;
  role?: string;
  label?: string;
  motion?: Motion;
}

export function Popover({ anchor, owner, placement = 'below-start', offset = 4, onClose, children, className, style, modal = false, role = 'dialog', label, motion = 'scale' }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const layer: Layer = { id: nextLayerId++, close: () => closeRef.current(), panel: () => panelRef.current, anchor: owner ?? (anchor instanceof Element ? anchor : undefined), modal };
    layers.push(layer);
    return () => { const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const update = () => setPosition(place(anchor, placement, panel, offset));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [anchor, placement, offset]);
  return createPortal(
    <div className={`overlay-layer${modal ? ' modal' : ''}`}>
      {modal ? <div className="overlay-backdrop" onPointerDown={() => closeRef.current()} /> : null}
      <div
        ref={panelRef}
        role={role}
        aria-label={label}
        className={`popover-panel${motion !== 'scale' ? ` motion-${motion}` : ''}${className ? ` ${className}` : ''}${position ? ' shown' : ''}`}
        style={{ ...style, left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// Panels drawn in place rather than as a popover (the view settings panel…) join the same stack:
// a press outside them, or Escape, closes them like any menu; pressing the button that opened
// them closes them too.
export function useLayer(panel: { current: HTMLElement | null }, onClose: () => void, anchor?: () => Element | null | undefined) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const layer: Layer = { id: nextLayerId++, close: () => closeRef.current(), panel: () => panel.current, modal: false };
    Object.defineProperty(layer, 'anchor', { get: () => anchor?.() ?? undefined });
    layers.push(layer);
    return () => { const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Imperative helper for hooks/components that toggle one popover.
export function usePopover<T = undefined>() {
  const [state, setState] = useState<{ anchor: Anchor; data: T } | null>(null);
  return {
    state,
    open: (anchor: Anchor, data?: T) => setState({ anchor, data: data as T }),
    close: () => setState(null),
    toggle: (anchor: Anchor, data?: T) => setState(current => current ? null : { anchor, data: data as T }),
  };
}
