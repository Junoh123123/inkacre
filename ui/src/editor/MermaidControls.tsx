import { t } from '../i18n';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/Icon';
import { readMermaidMode, writeMermaidMode, type MermaidMode } from './views';

// "미리 보기 형식": a 94×28 r6 strip centred 8 under the button with three 24px
// choices — code only, preview only, code and preview (the current one on rgba(33,27,23,.05)).
export function MermaidModePicker({ anchor, id, onClose }: { anchor: Element; id: string; onClose: () => void }) {
  const current = readMermaidMode(id);
  const choices: Array<[MermaidMode, string, string]> = [
    ['code', 'code', t("코드만 보이고 미리 보기 숨기기")],
    ['preview', 'mermaid-preview', t("미리 보기만 보이고 코드 숨기기")],
    ['both', 'mermaid-both', t("코드와 미리 보기 보기")],
  ];
  return (
    <Popover anchor={anchor} placement="below-center" offset={8} onClose={onClose} className="mermaid-mode-picker" label={t("미리 보기 형식")}>
      <div className="mermaid-modes">
        {choices.map(([mode, icon, label]) => (
          <button key={mode} type="button" className={`mermaid-mode${mode === current ? ' active' : ''}`} aria-label={label} title={label} onClick={() => { writeMermaidMode(id, mode); onClose(); }}><Icon name={icon} size={16} /></button>
        ))}
      </div>
    </Popover>
  );
}

// "다이어그램 펼치기": the diagram alone over a dimmed page, as large as the window allows; Esc or a click closes.
export function MermaidViewer({ source, onClose }: { source: Element; onClose: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true, drawnId = '';
    const show = (svg: SVGSVGElement, clone: boolean) => {
      if (!holder.current) return;
      const copy = clone ? svg.cloneNode(true) as SVGSVGElement : svg;
      if (clone) {
        const sources = [svg, ...svg.querySelectorAll('*')];
        [copy, ...copy.querySelectorAll('*')].forEach((element, index) => { const css = (sources[index] as SVGElement | undefined)?.style?.cssText; if (css) (element as SVGElement).style.cssText = css; });
      }
      copy.style.maxWidth = 'none'; copy.removeAttribute('width'); copy.removeAttribute('height');
      copy.style.width = '100%'; copy.style.height = '100%';
      holder.current.replaceChildren(copy);
    };
    const svg = source.querySelector('svg');
    if (svg) show(svg, true);
    else {
      // "코드만" keeps no drawing under the code, so the viewer draws its own.
      const code = source.closest('.block-code')?.querySelector('code')?.textContent ?? '';
      if (code.trim()) void import('./mermaid').then(module => module.renderMermaid(code, document.documentElement.dataset.theme === 'dark').then(result => {
        drawnId = result.id;
        if (!live) { module.releaseStyles(result.id); return; }
        if (result.svg) show(result.svg, false);
      }));
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey, true);
      if (drawnId) void import('./mermaid').then(module => module.releaseStyles(drawnId));
    };
  }, [source, onClose]);
  return createPortal(
    <div className="mermaid-viewer" role="dialog" aria-label={t("다이어그램")} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mermaid-viewer-panel">
        <button type="button" className="icon-button mermaid-viewer-close" aria-label={t("닫기")} onClick={onClose}><Icon name="close" size={16} /></button>
        <div className="mermaid-viewer-diagram" ref={holder} />
      </div>
    </div>,
    document.body,
  );
}
