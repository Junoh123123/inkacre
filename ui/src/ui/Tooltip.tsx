import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Tooltips: a dark bubble (#2c2c2b, 12px #f0efed,
// padding 5px 8px, r6) 6px under the control, ~175ms after the pointer arrives, fading in and
// out over 50ms. A shortcut at the end of the text — "사이드바 열기 (⌘\)" — goes on a second
// line in #ada9a3. Every `title` in the app becomes one of these (the browser's own tooltip is
// slow and looks different).

const SHOW_DELAY = 150;
const shortcutPattern = /^(.*?)\s*\(((?:⌘|⇧|⌥|⌃|Ctrl|Alt|Shift|Esc|Del|Tab|Enter|↵|Space)[^()]*)\)$/;

interface Tip { label: string; shortcut?: string; rect: DOMRect }

function takeTitle(element: HTMLElement): string | null {
  const title = element.getAttribute('title');
  if (title) {
    element.dataset.tooltip = title;
    element.removeAttribute('title');
    if (!element.getAttribute('aria-label') && !element.textContent?.trim()) element.setAttribute('aria-label', title);
  }
  return element.dataset.tooltip ?? null;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [shown, setShown] = useState(false);
  const shownRef = useRef(false);
  shownRef.current = shown;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const current = useRef<HTMLElement | null>(null);
  const lastVisible = useRef(0);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      if (current.current && shownRef.current) lastVisible.current = performance.now();
      current.current = null;
      setShown(false);
      timer.current = window.setTimeout(() => setTip(null), 60);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = (event.target as Element | null)?.closest?.<HTMLElement>('[title], [data-tooltip]');
      if (!target || target === current.current) return;
      const text = takeTitle(target);
      if (!text) return;
      window.clearTimeout(timer.current);
      current.current = target;
      // Moving straight from one control to the next shows the next tooltip at once.
      const warm = shownRef.current || performance.now() - lastVisible.current < 400;
      timer.current = window.setTimeout(() => {
        if (current.current !== target || !target.isConnected) return;
        const match = shortcutPattern.exec(text);
        setTip({ label: match ? match[1] : text, shortcut: match?.[2], rect: target.getBoundingClientRect() });
        setPosition(null);
      }, warm ? 0 : SHOW_DELAY);
    };
    const out = (event: PointerEvent) => {
      const from = current.current;
      if (!from) return;
      const to = event.relatedTarget as Node | null;
      if (to && from.contains(to)) return;
      hide();
    };
    window.addEventListener('pointerover', over, true);
    window.addEventListener('pointerout', out, true);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerover', over, true);
      window.removeEventListener('pointerout', out, true);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.clearTimeout(timer.current);
    };
  }, []);

  // Place under the control (above when there is no room), kept 4px inside the window.
  useEffect(() => {
    const element = bubble.current;
    if (!tip || !element || position) return;
    const width = element.offsetWidth, height = element.offsetHeight;
    let top = tip.rect.bottom + 6;
    if (top + height > window.innerHeight - 4) top = tip.rect.top - 6 - height;
    const left = Math.max(4, Math.min(tip.rect.left + tip.rect.width / 2 - width / 2, window.innerWidth - width - 4));
    setPosition({ left, top });
    requestAnimationFrame(() => setShown(true));
  }, [tip, position]);

  if (!tip) return null;
  return createPortal(
    <div ref={bubble} className={`tooltip${shown && position ? ' shown' : ''}`} role="tooltip" style={position ?? { left: -9999, top: -9999 }}>
      <div>{tip.label}</div>
      {tip.shortcut ? <div className="tooltip-shortcut">{tip.shortcut}</div> : null}
    </div>,
    document.body,
  );
}
