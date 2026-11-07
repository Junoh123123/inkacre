import { t } from '../i18n';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspace, report, workspace } from '../data/store';
import { hrefFor, navigate } from '../data/router';
import { plainText } from '../data/format';
import type { AttachmentEntity, BlockEntity, MaskShape, PageEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/overlay';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Dialog } from '../ui/primitives';
import { EntityIcon } from '../page/EntityIcon';
import { openWorkspaceDialog } from '../dialogs/registry';
import { loadPdf } from '../dialogs/importConverters';
import { AttachmentPicker, EmptyMedia, Pending, selectSelf, useBlock } from './mediaParts';
import type { AtomProps } from './atoms';
import type { PageSync } from './sync';

// Media blocks (24차: image · PDF · embed · link to page). Images: drag the side handles to resize, place
// them left / centre / right, crop and mask (circle, rounded, star, heart, triangle, hexagon), link to a web
// address or a page, alternative text, full screen, download, replace. PDFs show their pages in the page
// (pdf.js, already in /vendor). Embeds show a web address in a frame that can be resized and opened. A link to a
// page is a block of its own (and shows under the page in the sidebar).

export const attachmentUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;
const masks: Record<MaskShape, string> = {
  circle: 'circle(50% at 50% 50%)', rounded: 'inset(0 round 14%)', triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
  hexagon: 'polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)',
  star: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  heart: 'polygon(50% 92%, 13% 58%, 3% 38%, 6% 20%, 18% 8%, 33% 6%, 45% 14%, 50% 22%, 55% 14%, 67% 6%, 82% 8%, 94% 20%, 97% 38%, 87% 58%)',
};
const maskLabels: Record<MaskShape, string> = { circle: t("원"), rounded: t("둥근 사각형"), star: t("별"), heart: t("하트"), triangle: t("삼각형"), hexagon: t("육각형") };
const alignLabels = { left: t("왼쪽 정렬"), center: t("가운데 정렬"), right: t("오른쪽 정렬") } as const;

// The picture as it shows: the crop window over it (the frame takes the cropped proportions) and the mask shape.
function CroppedImage({ src, alt, crop, mask, natural, onNatural, draggable = false }: { src: string; alt: string; crop?: BlockEntity['crop']; mask?: MaskShape | null; natural: { w: number; h: number } | null; onNatural: (size: { w: number; h: number }) => void; draggable?: boolean }) {
  const shape: CSSProperties = mask ? { clipPath: masks[mask] } : {};
  if (crop && natural) {
    const frame: CSSProperties = { position: 'relative', overflow: 'hidden', width: '100%', aspectRatio: `${natural.w * crop.w} / ${natural.h * crop.h}`, ...shape };
    const image: CSSProperties = { position: 'absolute', width: `${100 / crop.w}%`, maxWidth: 'none', left: `${-(crop.x / crop.w) * 100}%`, top: `${-(crop.y / crop.h) * 100}%` };
    return <div className="image-crop" style={frame}><img src={src} alt={alt} style={image} draggable={draggable} onLoad={event => onNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} /></div>;
  }
  return <img src={src} alt={alt} style={{ ...shape, width: '100%', ...(mask === 'circle' || mask === 'star' || mask === 'heart' || mask === 'hexagon' ? { aspectRatio: '1 / 1', objectFit: 'cover' } : {}) }} loading="lazy" draggable={draggable}
    onLoad={event => onNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} />;
}

// 전체 화면: the picture over everything; Esc or a click outside closes it.
function Lightbox({ src, alt, name, onClose }: { src: string; alt: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-label={alt || name} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="lightbox-bar">
        <span className="lightbox-name">{name}</span>
        <a className="lightbox-button" href={src} download={name} aria-label={t("다운로드")} title={t("다운로드")}><Icon name="download" size={18} /></a>
        <button type="button" className="lightbox-button" aria-label={t("닫기")} title={t("닫기")} onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <img src={src} alt={alt} className="lightbox-image" />
    </div>, document.body);
}

// 자르기: a rectangle over the picture, moved and resized by dragging (corners and edges), and a mask shape.
function CropDialog({ src, initial, mask, onSave, onClose }: { src: string; initial: BlockEntity['crop']; mask: MaskShape | null; onSave: (crop: BlockEntity['crop'], mask: MaskShape | null) => void; onClose: () => void }) {
  const [crop, setCrop] = useState(initial ?? { x: 0, y: 0, w: 1, h: 1 });
  const [shape, setShape] = useState<MaskShape | null>(mask);
  const box = useRef<HTMLDivElement>(null);
  const start = (event: ReactPointerEvent, handle: string) => {
    event.preventDefault(); event.stopPropagation();
    const rect = box.current!.getBoundingClientRect(), from = { ...crop }, x0 = event.clientX, y0 = event.clientY;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - x0) / rect.width, dy = (e.clientY - y0) / rect.height;
      let { x, y, w, h } = from;
      if (handle === 'move') { x = Math.min(1 - w, Math.max(0, x + dx)); y = Math.min(1 - h, Math.max(0, y + dy)); }
      if (handle.includes('w')) { const nx = Math.min(x + w - 0.05, Math.max(0, x + dx)); w += x - nx; x = nx; }
      if (handle.includes('e')) w = Math.min(1 - x, Math.max(0.05, w + dx));
      if (handle.includes('n')) { const ny = Math.min(y + h - 0.05, Math.max(0, y + dy)); h += y - ny; y = ny; }
      if (handle.includes('s')) h = Math.min(1 - y, Math.max(0.05, h + dy));
      setCrop({ x, y, w, h });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const full = crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
  return (
    <Dialog title={t("이미지 자르기")} width={720} onClose={onClose} submitLabel={t("적용")} onSubmit={() => onSave(full ? null : { x: round(crop.x), y: round(crop.y), w: round(crop.w), h: round(crop.h) }, shape)}
      footer={<button type="button" className="outline-button crop-reset" onClick={() => { setCrop({ x: 0, y: 0, w: 1, h: 1 }); setShape(null); }}>{t("원래대로")}</button>}>
      <div className="crop-stage">
        <div ref={box} className="crop-box">
          <img src={src} alt="" draggable={false} />
          <div className="crop-window" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`, ...(shape ? { ['--crop-mask' as string]: masks[shape] } : {}) }} onPointerDown={event => start(event, 'move')}>
            {shape ? <div className="crop-mask-preview" style={{ clipPath: masks[shape] }} /> : null}
            {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(handle => <span key={handle} className={`crop-handle h-${handle}`} onPointerDown={event => start(event, handle)} />)}
          </div>
        </div>
      </div>
      <div className="crop-masks" role="radiogroup" aria-label={t("마스크")}>
        <button type="button" role="radio" aria-checked={!shape} className={`crop-mask${!shape ? ' on' : ''}`} onClick={() => setShape(null)}><span className="mask-swatch none" />{t("없음")}</button>
        {(Object.keys(masks) as MaskShape[]).map(name => (
          <button key={name} type="button" role="radio" aria-checked={shape === name} className={`crop-mask${shape === name ? ' on' : ''}`} onClick={() => setShape(name)}><span className="mask-swatch" style={{ clipPath: masks[name] }} />{maskLabels[name]}</button>
        ))}
      </div>
    </Dialog>
  );
}
const round = (value: number) => Math.round(value * 10000) / 10000;

// A link on a picture: a web address, or a page picked from the workspace ("?id=<page>").
function LinkPopover({ anchor, value, onSave, onClose }: { anchor: Element; value: string; onSave: (href: string | null) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const valid = /^https?:\/\//i.test(text.trim()) || /^mailto:/i.test(text.trim());
  return (
    <Popover anchor={anchor} placement="below-center" onClose={onClose} className="embed-popover" style={{ width: 320 }} label={t("링크")}>
      <form className="embed-body" onSubmit={event => { event.preventDefault(); if (valid) { onSave(text.trim()); onClose(); } }}>
        <input className="text-input" autoFocus placeholder={t("링크를 붙여넣거나 페이지를 고르세요")} value={text} onChange={event => setText(event.target.value)} />
        <button type="submit" className="blue-button" disabled={!valid}>{t("링크 걸기")}</button>
        <button type="button" className="outline-button" onClick={() => { onClose(); openWorkspaceDialog('pick-page', { title: t("링크할 페이지"), placeholder: t("링크할 페이지 검색…"), onPick: (page: PageEntity | null) => { if (page) onSave(`?id=${encodeURIComponent(page.id)}`); } }); }}>{t("페이지에 링크…")}</button>
        {value ? <button type="button" className="text-button danger" onClick={() => { onSave(null); onClose(); }}>{t("링크 제거")}</button> : null}
      </form>
    </Popover>
  );
}
export function openMediaLink(href: string) {
  if (href.startsWith('?id=')) navigate(decodeURIComponent(href.slice(4)));
  else window.open(href, '_blank', 'noopener,noreferrer');
}

function AltPopover({ anchor, value, onSave, onClose }: { anchor: Element; value: string; onSave: (alt: string | null) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  return (
    <Popover anchor={anchor} placement="below-center" onClose={() => { onSave(text.trim() || null); onClose(); }} className="embed-popover" style={{ width: 320 }} label={t("대체 텍스트")}>
      <form className="embed-body" onSubmit={event => { event.preventDefault(); onSave(text.trim() || null); onClose(); }}>
        <textarea className="text-input alt-input" autoFocus rows={3} placeholder={t("이미지를 설명하는 글 (화면 읽기 프로그램용)")} value={text} onChange={event => setText(event.target.value)} />
        <button type="submit" className="blue-button">{t("저장")}</button>
      </form>
    </Popover>
  );
}

// A video sized and placed like a picture: the side handles set its width (kept on the block), 정렬 places it left,
// centre or right. The actions (given the 정렬 button) show over it on hover.
export function ResizableMedia({ block, sync, editable, actions, children, className = '' }: { block: BlockEntity; sync: PageSync; editable: boolean; actions?: (align: ReactNode) => ReactNode; children: ReactNode | ((align: ReactNode) => ReactNode); className?: string }) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [alignMenu, setAlignMenu] = useState<Element | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const align = block.align ?? 'center';
  const width = dragWidth ?? block.width ?? null;
  const startResize = (event: ReactPointerEvent, side: 'left' | 'right') => {
    if (!editable) return;
    event.preventDefault(); event.stopPropagation();
    const column = frame.current?.parentElement?.clientWidth ?? 708, startW = frame.current?.offsetWidth ?? column, x0 = event.clientX;
    let next = startW;
    const factor = align === 'center' ? 2 : 1;
    const move = (e: PointerEvent) => { next = Math.round(Math.max(120, Math.min(column, startW + (side === 'right' ? 1 : -1) * (e.clientX - x0) * factor))); setDragWidth(next); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (next !== startW) sync.command([{ type: 'block.update', id: block.id, width: next >= column ? null : next }]).catch(report).finally(() => setDragWidth(null));
      else setDragWidth(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const alignButton = editable ? <button type="button" className="media-action icon" aria-label={t("정렬")} title={t("정렬")} onClick={event => setAlignMenu(event.currentTarget)}><Icon name={`align-${align}`} size={16} /></button> : null;
  return (
    <>
      <figure className={`image-figure media-figure align-${align}${className ? ` ${className}` : ''}`}>
        <div ref={frame} className={`image-frame media-frame${dragWidth !== null ? ' resizing' : ''}`} style={{ width: width ?? '100%' }}>
          {typeof children === 'function' ? children(alignButton) : children}
          {editable ? <>
            <span className="image-handle left" aria-label={t("크기 조절")} onPointerDown={event => startResize(event, 'left')} />
            <span className="image-handle right" aria-label={t("크기 조절")} onPointerDown={event => startResize(event, 'right')} />
          </> : null}
          {actions?.(alignButton)}
        </div>
      </figure>
      {alignMenu ? <Menu anchor={alignMenu} placement="below-start" width={200} onClose={() => setAlignMenu(null)} entries={(['left', 'center', 'right'] as const).map(value => ({ label: alignLabels[value], icon: `align-${value}`, checked: align === value, onSelect: () => { sync.command([{ type: 'block.update', id: block.id, align: value === 'center' ? null : value }]).catch(report); } } as MenuEntry))} /> : null}
    </>
  );
}

export function ImageAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [picker, setPicker] = useState<Element | null>(null);
  const [menu, setMenu] = useState<{ kind: 'align' | 'link' | 'alt'; anchor: Element } | null>(null);
  const [cropping, setCropping] = useState(false);
  const [full, setFull] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  if (!block) return <Pending label={t("이미지")} />;
  const editable = props.view.editable;
  const update = (patch: Record<string, unknown>) => props.sync.command([{ type: 'block.update', id: block.id, ...patch }]).catch(report);
  if (!block.attachmentId) {
    return (
      <>
        <EmptyMedia icon="image" label={t("이미지 추가")} onClick={setPicker} blockId={block.id} />
        {picker ? <AttachmentPicker anchor={picker} block={block} kind="image" onClose={() => setPicker(null)} sync={props.sync} /> : null}
      </>
    );
  }
  const src = attachmentUrl(block.attachmentId);
  const attachment = workspace.get<AttachmentEntity>(block.attachmentId);
  const caption = plainText(block.richText);
  const alt = block.alt || caption || attachment?.name || t("이미지");
  const align = block.align ?? 'center';
  // A cropped picture has no width of its own: it starts at the cropped part's size.
  const width = dragWidth ?? block.width ?? (block.crop && natural ? Math.round(natural.w * block.crop.w) : null);
  // The side handles: the width follows the pointer (twice the move when centred), kept on release.
  const startResize = (event: ReactPointerEvent, side: 'left' | 'right') => {
    if (!editable) return;
    event.preventDefault(); event.stopPropagation();
    const column = frame.current?.parentElement?.clientWidth ?? 708, startW = frame.current?.offsetWidth ?? column, x0 = event.clientX;
    let next = startW;
    const factor = align === 'center' ? 2 : 1;
    const move = (e: PointerEvent) => { next = Math.round(Math.max(40, Math.min(column, startW + (side === 'right' ? 1 : -1) * (e.clientX - x0) * factor))); setDragWidth(next); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (next !== startW) props.sync.command([{ type: 'block.update', id: block.id, width: next >= column ? null : next }]).catch(report).finally(() => setDragWidth(null));
      else setDragWidth(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <>
      <figure className={`image-figure align-${align}`} onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); selectSelf(props); } }}>
        <div ref={frame} className={`image-frame${dragWidth !== null ? ' resizing' : ''}${block.href ? ' linked' : ''}`} style={width ? { width } : undefined}
          onMouseDown={event => { if ((event.target as HTMLElement).tagName === 'IMG') { event.preventDefault(); selectSelf(props); } }}
          onClick={event => { if (block.href && (!editable || event.metaKey || event.ctrlKey) && (event.target as HTMLElement).tagName === 'IMG') openMediaLink(block.href); }}>
          <CroppedImage src={src} alt={alt} crop={block.crop} mask={block.mask} natural={natural} onNatural={setNatural} />
          {editable ? <>
            <span className="image-handle left" aria-label={t("크기 조절")} onPointerDown={event => startResize(event, 'left')} />
            <span className="image-handle right" aria-label={t("크기 조절")} onPointerDown={event => startResize(event, 'right')} />
          </> : null}
          {block.href ? <button type="button" className="image-link-badge" title={block.href} onMouseDown={event => event.preventDefault()} onClick={() => openMediaLink(block.href!)}><Icon name="link" size={12} /><span>{block.href.startsWith('?id=') ? workspace.title(workspace.get(decodeURIComponent(block.href.slice(4)))) || t("페이지") : (() => { try { return new URL(block.href).hostname; } catch { return block.href; } })()}</span></button> : null}
          <div className="media-actions" onMouseDown={event => event.preventDefault()}>
            {editable ? <>
              <button type="button" className="media-action icon" aria-label={t("정렬")} title={t("정렬")} onClick={event => setMenu({ kind: 'align', anchor: event.currentTarget })}><Icon name={`align-${align}`} size={16} /></button>
              <button type="button" className="media-action icon" aria-label={t("자르기")} title={t("자르기")} onClick={() => setCropping(true)}><Icon name="crop" size={16} /></button>
              <button type="button" className={`media-action icon${block.href ? ' on' : ''}`} aria-label={t("링크")} title={t("링크")} onClick={event => setMenu({ kind: 'link', anchor: event.currentTarget })}><Icon name="link" size={16} /></button>
              <button type="button" className={`media-action${block.alt ? ' on' : ''}`} aria-label={t("대체 텍스트")} title={t("대체 텍스트")} onClick={event => setMenu({ kind: 'alt', anchor: event.currentTarget })}>ALT</button>
            </> : null}
            <button type="button" className="media-action icon" aria-label={t("전체 화면")} title={t("전체 화면")} onClick={() => setFull(true)}><Icon name="expand" size={16} /></button>
            <a className="media-action icon" href={src} download={attachment?.name ?? 'image'} aria-label={t("다운로드")} title={t("다운로드")}><Icon name="download" size={16} /></a>
            {editable ? <button type="button" className="media-action" onClick={event => setPicker(event.currentTarget)}>{t("바꾸기")}</button> : null}
            <a className="media-action" href={src} target="_blank" rel="noopener noreferrer">{t("원본")}</a>
          </div>
        </div>
      </figure>
      {picker ? <AttachmentPicker anchor={picker} block={block} kind="image" onClose={() => setPicker(null)} sync={props.sync} /> : null}
      {menu?.kind === 'align' ? <Menu anchor={menu.anchor} placement="below-start" width={200} onClose={() => setMenu(null)} entries={(['left', 'center', 'right'] as const).map(value => ({ label: alignLabels[value], icon: `align-${value}`, checked: align === value, onSelect: () => update({ align: value === 'center' ? null : value }) } as MenuEntry))} /> : null}
      {menu?.kind === 'link' ? <LinkPopover anchor={menu.anchor} value={block.href ?? ''} onSave={href => update({ href })} onClose={() => setMenu(null)} /> : null}
      {menu?.kind === 'alt' ? <AltPopover anchor={menu.anchor} value={block.alt ?? ''} onSave={value => { if ((value ?? null) !== (block.alt ?? null)) update({ alt: value }); }} onClose={() => setMenu(null)} /> : null}
      {cropping ? <CropDialog src={src} initial={block.crop ?? null} mask={block.mask ?? null} onClose={() => setCropping(false)} onSave={(crop, mask) => update({ crop, mask })} /> : null}
      {full ? <Lightbox src={src} alt={alt} name={attachment?.name ?? t("이미지")} onClose={() => setFull(false)} /> : null}
    </>
  );
}

// ---------- PDF ----------

interface PdfPage { getViewport(options: { scale: number }): { width: number; height: number }; render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> } }
interface PdfDocument { numPages: number; getPage(n: number): Promise<PdfPage>; destroy?(): void }

function PdfPages({ src, height, onPages }: { src: string; height: number; onPages: (count: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, documentRef: PdfDocument | null = null;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { const canvas = entry.target as HTMLCanvasElement; observer.unobserve(canvas); draw(canvas).catch(() => undefined); }
    }, { root: host.current, rootMargin: '400px' });
    const draw = async (canvas: HTMLCanvasElement) => {
      if (!documentRef || cancelled) return;
      const page = await documentRef.getPage(Number(canvas.dataset.page));
      const width = host.current?.clientWidth ?? 700, base = page.getViewport({ scale: 1 }), scale = (width - 24) / base.width, ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      canvas.width = viewport.width; canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / ratio}px`; canvas.style.height = `${viewport.height / ratio}px`;
      const context = canvas.getContext('2d');
      if (context) await page.render({ canvasContext: context, viewport }).promise;
    };
    (async () => {
      const pdf = await loadPdf();
      const data = new Uint8Array(await (await fetch(src)).arrayBuffer());
      const loaded = await (pdf.getDocument({ data, cMapUrl: '/vendor/pdfjs-cmaps/', cMapPacked: true, isEvalSupported: false }).promise as unknown as Promise<PdfDocument>);
      if (cancelled) { loaded.destroy?.(); return; }
      documentRef = loaded;
      onPages(loaded.numPages);
      const width = host.current?.clientWidth ?? 700;
      const first = await loaded.getPage(1), base = first.getViewport({ scale: 1 }), placeholder = Math.round((width - 24) * base.height / base.width);
      for (let n = 1; n <= loaded.numPages && host.current; n++) {
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page'; canvas.dataset.page = String(n);
        canvas.style.height = `${placeholder}px`; canvas.style.width = `${width - 24}px`;
        host.current.append(canvas);
        observer.observe(canvas);
      }
    })().catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { cancelled = true; observer.disconnect(); documentRef?.destroy?.(); host.current?.replaceChildren(); };
  }, [src]);
  return <div ref={host} className="pdf-pages" style={{ height }}>{error ? <p className="error-text">{t("PDF를 표시하지 못했습니다: {0}", [error])}</p> : null}</div>;
}

export function PdfAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [picker, setPicker] = useState<Element | null>(null);
  const [pages, setPages] = useState(0);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  if (!block) return <Pending label="PDF" />;
  const attachment = block.attachmentId ? workspace.get<AttachmentEntity>(block.attachmentId) : undefined;
  if (!attachment) {
    return (
      <>
        <EmptyMedia icon="pdf" label={t("PDF 업로드 또는 링크로 넣기")} onClick={setPicker} blockId={block.id} />
        {picker ? <AttachmentPicker anchor={picker} block={block} kind="pdf" onClose={() => setPicker(null)} sync={props.sync} /> : null}
      </>
    );
  }
  const src = attachmentUrl(attachment.id), height = dragHeight ?? block.height ?? 640;
  const startResize = (event: ReactPointerEvent) => {
    if (!props.view.editable) return;
    event.preventDefault(); event.stopPropagation();
    const y0 = event.clientY, start = height;
    let next = start;
    const move = (e: PointerEvent) => { next = Math.round(Math.max(200, Math.min(4000, start + e.clientY - y0))); setDragHeight(next); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (next !== start) props.sync.command([{ type: 'block.update', id: block.id, height: next === 640 ? null : next }]).catch(report).finally(() => setDragHeight(null)); else setDragHeight(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <ResizableMedia block={block} sync={props.sync} editable={props.view.editable} className="pdf-figure">{align => (
    <div className="pdf-block" contentEditable={false}>
      <div className="pdf-head">
        <Icon name="pdf" size={16} /><span className="pdf-name">{attachment.name}</span>{pages ? <span className="pdf-count">{t("{0}쪽", [pages])}</span> : null}
        <span className="pdf-actions">
          {align}
          <a className="media-action icon" href={src} target="_blank" rel="noopener noreferrer" aria-label={t("새 탭에서 열기")} title={t("새 탭에서 열기")}><Icon name="arrow-up-right" size={16} /></a>
          <a className="media-action icon" href={src} download={attachment.name} aria-label={t("다운로드")} title={t("다운로드")}><Icon name="download" size={16} /></a>
          {props.view.editable ? <button type="button" className="media-action" onClick={event => setPicker(event.currentTarget)}>{t("바꾸기")}</button> : null}
        </span>
      </div>
      <PdfPages src={src} height={height} onPages={setPages} />
      {props.view.editable ? <div className="html-resize" role="separator" aria-orientation="horizontal" aria-label={t("높이 조절")} onPointerDown={startResize}><span className="html-resize-bar" /></div> : null}
      {picker ? <AttachmentPicker anchor={picker} block={block} kind="pdf" onClose={() => setPicker(null)} sync={props.sync} /> : null}
    </div>
    )}</ResizableMedia>
  );
}

// ---------- embed ----------

// Addresses that have a player of their own are shown through it; the rest load as they are.
export function embedSource(raw: string): string | null {
  try {
    const url = new URL(raw);
    // Only https pages are framed (the app's content policy): a plain-http address would be blocked anyway.
    if (url.protocol !== 'https:' || url.host === location.host) return null;
    if (['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'].includes(url.hostname)) {
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') ?? url.pathname.split('/').at(-1);
      if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname) && /^\/\d+$/.test(url.pathname)) return `https://player.vimeo.com/video${url.pathname}`;
    if (url.hostname === 'www.google.com' && url.pathname.startsWith('/maps') && !url.searchParams.has('output')) { url.searchParams.set('output', 'embed'); return url.href; }
    return url.href;
  } catch { return null; }
}

export function EmbedAtom(props: AtomProps) {
  const block = useBlock(props.entry.node.attrs.id);
  const [text, setText] = useState(() => block?.url ?? '');
  const [replace, setReplace] = useState<Element | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  if (!block) return <Pending label={t("임베드")} />;
  const update = (patch: Record<string, unknown>) => props.sync.command([{ type: 'block.update', id: block.id, ...patch }]).catch(report);
  const source = block.url ? embedSource(block.url) : null;
  if (!block.url || !source) {
    const valid = !!embedSource(text.trim());
    return (
      <form className="bookmark-input embed-input" contentEditable={false} onSubmit={event => { event.preventDefault(); if (valid) update({ url: text.trim() }); }}>
        <Icon name="embed" size={20} />
        <input className="text-input" placeholder={t("임베드할 웹 주소를 붙여넣으세요")} value={text} onChange={event => setText(event.target.value)} autoFocus={!block.url} />
        <button type="submit" className="blue-button" disabled={!valid}>{t("링크 임베드")}</button>
        {/^http:\/\//i.test(text.trim()) ? <span className="embed-input-note">{t("https 주소만 임베드할 수 있습니다.")}</span> : null}
      </form>
    );
  }
  const height = dragHeight ?? block.height ?? 400, width = dragWidth ?? block.width ?? null;
  const startCorner = (event: ReactPointerEvent, side: 'left' | 'right') => {
    if (!props.view.editable) return;
    event.preventDefault(); event.stopPropagation();
    const column = wrap.current?.parentElement?.clientWidth ?? 708, x0 = event.clientX, y0 = event.clientY, w0 = wrap.current?.offsetWidth ?? column, h0 = height;
    let w = w0, h = h0;
    const move = (e: PointerEvent) => { w = Math.round(Math.max(160, Math.min(column, w0 + (side === 'right' ? 1 : -1) * (e.clientX - x0) * 2))); h = Math.round(Math.max(120, Math.min(4000, h0 + e.clientY - y0))); setDragWidth(w); setDragHeight(h); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (w !== w0 || h !== h0) props.sync.command([{ type: 'block.update', id: block.id, width: w >= column ? null : w, height: h === 400 ? null : h }]).catch(report).finally(() => { setDragWidth(null); setDragHeight(null); });
      else { setDragWidth(null); setDragHeight(null); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  let host = block.url;
  try { host = new URL(block.url).hostname; } catch { /* keep */ }
  return (
    <div ref={wrap} className={`embed-block${dragHeight !== null ? ' resizing' : ''}`} style={width ? { width, marginLeft: 'auto', marginRight: 'auto' } : undefined} contentEditable={false}>
      <div className="html-head">
        <span className="html-name"><Icon name="embed" size={14} /> {host}</span>
        <span className="html-actions">
          <a className="html-action" href={block.url} target="_blank" rel="noopener noreferrer" aria-label={t("원본 보기")} title={t("원본 보기")}><Icon name="arrow-up-right" size={16} /></a>
          {props.view.editable ? <button type="button" className="html-action" aria-label={t("바꾸기")} title={t("바꾸기")} onMouseDown={event => event.preventDefault()} onClick={event => setReplace(event.currentTarget)}><Icon name="replace" size={16} /></button> : null}
        </span>
      </div>
      <div className="html-box" style={{ height: height + 2 }}>
        <div className="html-frame-wrap">
          <iframe className="html-frame" src={source} title={host} loading="lazy" referrerPolicy="no-referrer" allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation" />
        </div>
        {props.view.editable ? <>
          <div className="html-corner left" aria-label={t("크기 조절")} onPointerDown={event => startCorner(event, 'left')} />
          <div className="html-corner right" aria-label={t("크기 조절")} onPointerDown={event => startCorner(event, 'right')} />
        </> : null}
      </div>
      {replace ? <ReplaceUrl anchor={replace} value={block.url} onSave={url => update({ url })} onClose={() => setReplace(null)} /> : null}
    </div>
  );
}

function ReplaceUrl({ anchor, value, onSave, onClose }: { anchor: Element; value: string; onSave: (url: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const valid = !!embedSource(text.trim());
  return (
    <Popover anchor={anchor} placement="below-end" onClose={onClose} className="embed-popover" style={{ width: 340 }} label={t("바꾸기")}>
      <form className="embed-body" onSubmit={event => { event.preventDefault(); if (valid) { onSave(text.trim()); onClose(); } }}>
        <input className="text-input" autoFocus value={text} onChange={event => setText(event.target.value)} />
        <button type="submit" className="blue-button" disabled={!valid}>{t("링크 임베드")}</button>
      </form>
    </Popover>
  );
}

// ---------- link to page ----------

export function LinkToPageAtom(props: AtomProps) {
  const ws = useWorkspace();
  const block = useBlock(props.entry.node.attrs.id);
  if (!block) return <Pending label={t("페이지 링크")} />;
  const pageId = block.richText?.[0]?.pageId;
  const page = pageId ? ws.get<PageEntity>(pageId) : undefined;
  const gone = !page || !ws.visible(page.id);
  return (
    <a className={`page-link link-to-page${gone ? ' missing' : ''}`} href={pageId ? hrefFor(pageId) : undefined}
      onClick={event => { if (!pageId || event.metaKey || event.ctrlKey) return; event.preventDefault(); navigate(pageId); }}>
      <span className="page-link-icon"><EntityIcon item={page} size={20} /><span className="link-arrow" aria-hidden="true"><Icon name="arrow-up-right" size={10} /></span></span>
      <span className="page-link-title">{page ? (page.title || t("새 페이지")) : (block.richText?.[0]?.text || t("알 수 없는 페이지"))}</span>
      {gone ? <span className="muted small">{t("(휴지통에 있거나 지워짐)")}</span> : null}
    </a>
  );
}

