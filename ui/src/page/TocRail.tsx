import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';

// The table-of-contents rail at the right edge of a page ("목차" in 외관 및 레이아웃): one 28×2 row per heading every 14px,
// fixed 130px below the top bar and 51px from the window's right edge; the dash is right-aligned, 16/12/8/4 wide for
// heading 1–4, rgba(28,19,1,.11), and the section being read is rgb(50,48,44). Hovering it shows the headings in a
// card (232 wide, r14, menu shadow) whose right edge sits 2px inside the rail: 13px text, 25px rows, 12px more indent
// per level, the current one blue; clicking scrolls to it.
interface Heading { id: string; level: number; text: string }


export function TocRail({ scroller }: { scroller: HTMLElement | null }) {
  const [items, setItems] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);

  useEffect(() => {
    if (!scroller) return;
    let frame = 0;
    const headings = () => [...scroller.querySelectorAll<HTMLElement>('.page-editor .block[data-block-type^="heading"]')];
    const findActive = () => {
      const list = headings();
      const view = scroller.getBoundingClientRect();
      const line = view.top + scroller.clientHeight * 0.4;
      let current: string | null = list[0]?.dataset.blockId ?? null;
      for (const element of list) { if (element.getBoundingClientRect().top <= line) current = element.dataset.blockId ?? current; else break; }
      setActive(current);
    };
    const measure = () => {
      frame = 0;
      const list = headings().map(element => ({ id: element.dataset.blockId ?? '', level: Number(element.dataset.blockType?.slice(-1)) || 1, text: element.querySelector('.block-text')?.textContent?.trim() ?? '' }));
      setItems(previous => (JSON.stringify(previous) === JSON.stringify(list) ? previous : list));
      const view = scroller.getBoundingClientRect();
      setBox(previous => {
        const next = { left: Math.round(view.right - 51), top: Math.round(view.top + 130) };
        return previous && previous.left === next.left && previous.top === next.top ? previous : next;
      });
      findActive();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(schedule);
    observer.observe(scroller, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-block-type'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(scroller);
    scroller.addEventListener('scroll', findActive, { passive: true });
    measure();
    return () => { observer.disconnect(); resize.disconnect(); scroller.removeEventListener('scroll', findActive); if (frame) cancelAnimationFrame(frame); };
  }, [scroller]);

  useEffect(() => {
    const rail = railRef.current, card = cardRef.current;
    if (!box) return;
    if (rail) { rail.style.left = `${box.left}px`; rail.style.top = `${box.top}px`; }
    // The card's right edge is 2px inside the rail's (CSS shifts it left by its own width).
    if (card) { card.style.left = `${box.left + 26}px`; card.style.top = `${box.top - 10}px`; }
  }, [box, open, items.length]);

  if (!scroller || items.length < 2 || !box || scroller.clientWidth < 760) return null;
  const show = () => { window.clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setOpen(false), 120); };
  const jump = (id: string) => {
    const target = scroller.querySelector<HTMLElement>(`.page-editor .block[data-block-id="${CSS.escape(id)}"]`);
    if (!target) return;
    const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 80;
    scroller.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
  };
  return (
    <>
      <div ref={railRef} className="toc-rail" aria-hidden="true" onPointerEnter={show} onPointerLeave={hide}>
        {items.map(item => (
          <div key={item.id} className="toc-rail-row"><span className={`toc-rail-dash${item.id === active ? ' active' : ''}`} data-level={Math.min(4, item.level)} /></div>
        ))}
      </div>
      <div ref={cardRef} className={`toc-card-wrap${open ? ' shown' : ''}`} onPointerEnter={show} onPointerLeave={hide}>
        <nav className="toc-card" aria-label={t("목차")}>
          <div className="toc-card-list">
            {items.map(item => (
              <a key={item.id} href={`#${item.id}`} className={`toc-card-row${item.id === active ? ' active' : ''}`} data-level={Math.min(4, item.level)}
                onClick={event => { event.preventDefault(); jump(item.id); }}>
                <span className="toc-card-text">{item.text || t("제목")}</span>
              </a>
            ))}
          </div>
        </nav>
      </div>
    </>
  );
}

