import { useEffect, useState } from 'react';
import type { EditorView } from 'prosemirror-view';

// Column widths: hovering the gap between two columns shows a resize bar; dragging it
// shares the pair's width between them. Widths are stored as ratios on the column blocks.

interface Gap { layout: HTMLElement; index: number; left: number; top: number; height: number }

const MIN_WIDTH = 60;

function gapAt(view: EditorView, x: number, y: number): Gap | null {
  for (const layout of view.dom.querySelectorAll<HTMLElement>('.block-columns')) {
    const box = layout.getBoundingClientRect();
    if (y < box.top || y > box.bottom || x < box.left || x > box.right) continue;
    const columns = [...layout.querySelectorAll<HTMLElement>(':scope > .block-column')];
    for (let i = 0; i < columns.length - 1; i++) {
      const a = columns[i].getBoundingClientRect(), b = columns[i + 1].getBoundingClientRect();
      if (x >= a.right - 4 && x <= b.left + 4) return { layout, index: i, left: (a.right + b.left) / 2, top: box.top, height: box.height };
    }
  }
  return null;
}

export function ColumnResizer({ view, scroller, disabled }: { view: EditorView | null; scroller: HTMLElement | null; disabled?: boolean }) {
  const [gap, setGap] = useState<Gap | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!view || !scroller || disabled) return;
    const onMove = (event: MouseEvent) => { if (!dragging) setGap(gapAt(view, event.clientX, event.clientY)); };
    const onLeave = () => { if (!dragging) setGap(null); };
    scroller.addEventListener('mousemove', onMove);
    scroller.addEventListener('mouseleave', onLeave);
    scroller.addEventListener('scroll', onLeave, { passive: true });
    return () => { scroller.removeEventListener('mousemove', onMove); scroller.removeEventListener('mouseleave', onLeave); scroller.removeEventListener('scroll', onLeave); };
  }, [view, scroller, disabled, dragging]);

  if (!view || !gap || disabled) return null;

  const start = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const columns = [...gap.layout.querySelectorAll<HTMLElement>(':scope > .block-column')];
    // Positions first; the live preview only sets flex-grow (ignored by ColumnView as an edit).
    const positions = columns.map(column => { try { return view.posAtDOM(column, 0) - 1; } catch { return -1; } });
    const widths = columns.map(column => column.getBoundingClientRect().width);
    const pairStart = columns[gap.index].getBoundingClientRect().left;
    const pairWidth = widths[gap.index] + widths[gap.index + 1];
    const gapWidth = columns[gap.index + 1].getBoundingClientRect().left - columns[gap.index].getBoundingClientRect().right;
    setDragging(true);
    document.body.classList.add('resizing-columns');
    const next = [...widths];
    const ratios = () => { const average = next.reduce((sum, width) => sum + width, 0) / next.length; return next.map(width => width / average); };
    const move = (moveEvent: PointerEvent) => {
      const left = Math.max(MIN_WIDTH, Math.min(pairWidth - MIN_WIDTH, moveEvent.clientX - pairStart - gapWidth / 2));
      next[gap.index] = left; next[gap.index + 1] = pairWidth - left;
      const values = ratios();
      columns.forEach((column, i) => { column.style.flexGrow = String(values[i]); });
      setGap(current => (current ? { ...current, left: pairStart + left + gapWidth / 2 } : current));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-columns');
      setDragging(false);
      const values = ratios();
      const tr = view.state.tr;
      positions.forEach((pos, i) => {
        const node = pos >= 0 ? tr.doc.nodeAt(pos) : null;
        if (node?.type.name !== 'column') return;
        const ratio = Math.round(values[i] * 1000) / 1000;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ratio: Math.abs(ratio - 1) < 0.005 ? null : ratio });
      });
      if (tr.docChanged) view.dispatch(tr);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return <div className={`column-resizer${dragging ? ' active' : ''}`} style={{ left: gap.left - 6, top: gap.top, height: gap.height }} onPointerDown={start} onMouseLeave={() => { if (!dragging) setGap(null); }} />;
}
