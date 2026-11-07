import { t } from '../i18n';
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { report, useWorkspace, workspace } from '../data/store';
import { uploadFile } from '../data/commands';
import type { AttachmentEntity, BlockEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/overlay';
import { takeAutoOpen } from './autoOpen';
import type { AtomProps } from './atoms';

// The HTML block ("HTML · 임베드", 신규). Empty, it is the media bar
// (49 high) that opens a 540-wide panel: one tab "추가" (underlined) over a dashed drop area
// ("</> HTML 파일 업로드" / "또는 여기로 끌어다 놓기"). With a file: a 28 high header (file name 13/500,
// on hover ↗ 전체 화면 · ⋯), then the page in a frame 500 high inside a 1px #e6e5e3 r6 box (16 side
// padding) with a bar at the bottom to change the height. The file runs in its own sandbox
// (`/api/html/<id>`: scripts and forms, no access to the app).

export const htmlFullscreenEvent = 'html-fullscreen';
export function openHtmlFullscreen(blockId: string) { window.dispatchEvent(new CustomEvent(htmlFullscreenEvent, { detail: { blockId } })); }
export function requestHtmlReplace(blockId: string) { window.dispatchEvent(new CustomEvent('html-replace', { detail: { blockId } })); }
export const htmlSource = (attachmentId: string) => `/api/html/${encodeURIComponent(attachmentId)}`;
const DEFAULT_HEIGHT = 500;

const htmlFile = (file: File) => /\.html?$/i.test(file.name) || file.type === 'text/html';
async function uploadHtml(file: File, block: BlockEntity, flush: () => Promise<void>) {
  if (!htmlFile(file)) throw new Error(t("HTML 파일(.html)을 선택하세요."));
  await flush();
  const typed = file.type === 'text/html' ? file : new File([file], file.name, { type: 'text/html' });
  await uploadFile(typed, workspace.revision, { blockId: block.id });
}

function HtmlPicker({ anchor, block, onClose, flush }: { anchor: Element; block: BlockEntity; onClose: () => void; flush: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (file: File | undefined) => { if (!file) return; onClose(); uploadHtml(file, block, flush).catch(report); };
  const drop = (event: ReactDragEvent) => { event.preventDefault(); setOver(false); take(event.dataTransfer.files?.[0]); };
  return (
    <Popover anchor={anchor} placement="below-center" onClose={onClose} className="html-picker" style={{ width: 540 }} label={t("HTML 추가")}>
      <div className="html-picker-tabs"><button type="button" className="html-picker-tab active">{t("html|추가")}</button></div>
      <div className="html-picker-body">
        <button type="button" className={`html-drop${over ? ' over' : ''}`} onClick={() => input.current?.click()}
          onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <svg className="html-drop-outline" aria-hidden="true"><rect className="html-drop-rect" /></svg>
          <span className="html-drop-title"><Icon name="code-brackets" size={22} />{t("HTML 파일 업로드")}</span>
          <span className="html-drop-note">{t("또는 여기로 끌어다 놓기")}</span>
        </button>
        <input ref={input} type="file" accept=".html,.htm,text/html" hidden onChange={event => take(event.target.files?.[0])} />
      </div>
    </Popover>
  );
}

// The empty bar; made from the / menu just now, its panel opens at once.
function HtmlEmpty({ buttonRef, blockId, onOpen }: { buttonRef: { current: HTMLButtonElement | null }; blockId: string; onOpen: (anchor: Element) => void }) {
  useEffect(() => { if (takeAutoOpen(blockId) && buttonRef.current) onOpen(buttonRef.current); }, []);
  return (
    <button ref={element => { buttonRef.current = element; }} type="button" className="media-empty" onClick={event => onOpen(event.currentTarget)}>
      <Icon name="html" size={24} /><span>{t("HTML 파일 업로드")}</span>
    </button>
  );
}

export function HtmlAtom(props: AtomProps) {
  const ws = useWorkspace();
  const block = ws.get<BlockEntity>(props.entry.node.attrs.id);
  const [picker, setPicker] = useState<Element | null>(null);
  const emptyRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const id = props.entry.node.attrs.id as string;
  const flush = () => props.sync.flush();

  useEffect(() => {
    const onReplace = (event: Event) => {
      if ((event as CustomEvent<{ blockId: string }>).detail.blockId !== id) return;
      const anchor = boxRef.current ?? emptyRef.current;
      if (anchor) setPicker(anchor);
    };
    window.addEventListener('html-replace', onReplace);
    return () => window.removeEventListener('html-replace', onReplace);
  }, [id]);

  if (!block) return <div className="atom-pending">{t("{0} 저장 중…", [t("block|HTML")])}</div>;
  const attachment = block.attachmentId ? ws.get<AttachmentEntity>(block.attachmentId) : undefined;
  const height = dragHeight ?? block.height ?? DEFAULT_HEIGHT;
  const width = dragWidth ?? block.width ?? null;

  // The bar under the frame changes its height (kept on the block; the frame ignores the pointer meanwhile).
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!props.view.editable) return;
    event.preventDefault(); event.stopPropagation();
    const startY = event.clientY, start = height;
    let next = start;
    const move = (e: PointerEvent) => { next = Math.round(Math.max(80, Math.min(4000, start + e.clientY - startY))); setDragHeight(next); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (next !== start) props.sync.command([{ type: 'block.update', id, height: next === DEFAULT_HEIGHT ? null : next }]).catch(report).finally(() => setDragHeight(null));
      else setDragHeight(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // The corners change the width (kept centred: the pointer's sideways move is the
  // change in width) and the height together.
  const startCorner = (event: ReactPointerEvent<HTMLDivElement>, corner: 'left' | 'right') => {
    if (!props.view.editable) return;
    event.preventDefault(); event.stopPropagation();
    const full = blockRef.current?.parentElement?.clientWidth ?? 708;
    const startX = event.clientX, startY = event.clientY, startW = blockRef.current?.offsetWidth ?? full, startH = height;
    let nextW = startW, nextH = startH;
    const move = (e: PointerEvent) => {
      nextW = Math.round(Math.max(160, Math.min(full, startW + (corner === 'right' ? 1 : -1) * (e.clientX - startX))));
      nextH = Math.round(Math.max(80, Math.min(4000, startH + e.clientY - startY)));
      setDragWidth(nextW); setDragHeight(nextH);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (nextW !== startW || nextH !== startH) {
        props.sync.command([{ type: 'block.update', id, width: nextW >= full ? null : nextW, height: nextH === DEFAULT_HEIGHT ? null : nextH }]).catch(report).finally(() => { setDragWidth(null); setDragHeight(null); });
      } else { setDragWidth(null); setDragHeight(null); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const openMenu = (x: number, y: number) => window.dispatchEvent(new CustomEvent('atom-block-menu', { detail: { view: props.view, id, x, y } }));

  if (!attachment) {
    return (
      <>
        <HtmlEmpty buttonRef={emptyRef} blockId={id} onOpen={setPicker} />
        {picker ? <HtmlPicker anchor={picker} block={block} onClose={() => setPicker(null)} flush={flush} /> : null}
      </>
    );
  }
  return (
    <div ref={blockRef} className={`html-block${dragHeight !== null ? ' resizing' : ''}${width ? ' narrow' : ''}`} style={width ? { width, marginLeft: 'auto', marginRight: 'auto' } : undefined}>
      <div className="html-head" contentEditable={false}>
        <span className="html-name">{attachment.name}</span>
        <span className="html-actions">
          <button type="button" className="html-action" aria-label={t("전체 화면으로 열기")} title={t("전체 화면으로 열기")} onMouseDown={event => event.preventDefault()} onClick={() => openHtmlFullscreen(id)}><Icon name="expand" size={16} /></button>
          <button type="button" className="html-action" aria-label={t("더 보기")} title={t("더 보기")} onMouseDown={event => event.preventDefault()} onClick={event => openMenu(event.clientX, event.clientY)}><Icon name="more" size={16} /></button>
        </span>
      </div>
      <div ref={boxRef} className="html-box" style={{ height: height + 2 }}>
        <div className="html-frame-wrap">
          <iframe className="html-frame" src={htmlSource(attachment.id)} title={attachment.name} loading="lazy" referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" />
        </div>
        {props.view.editable ? <div className="html-resize" role="separator" aria-orientation="horizontal" aria-label={t("높이 조절")} onPointerDown={startResize}><span className="html-resize-bar" /></div> : null}
        {props.view.editable ? <>
          <div className="html-corner left" aria-label={t("크기 조절")} onPointerDown={event => startCorner(event, 'left')} />
          <div className="html-corner right" aria-label={t("크기 조절")} onPointerDown={event => startCorner(event, 'right')} />
        </> : null}
      </div>
      {picker ? <HtmlPicker anchor={picker} block={block} onClose={() => setPicker(null)} flush={flush} /> : null}
    </div>
  );
}

// 전체 화면 (Space / ↗): over the page area (the sidebar stays), a 48 high bar with
// 다운로드 and ✕ (1px #f0efed under it), the page filling the rest. Esc closes.
export function HtmlFullscreen() {
  const ws = useWorkspace();
  const [blockId, setBlockId] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const open = (event: Event) => {
      const sidebar = document.querySelector('.sidebar:not(.closed)');
      setLeft(sidebar ? Math.round(sidebar.getBoundingClientRect().right) : 0);
      setBlockId((event as CustomEvent<{ blockId: string }>).detail.blockId);
    };
    window.addEventListener(htmlFullscreenEvent, open);
    return () => window.removeEventListener(htmlFullscreenEvent, open);
  }, []);
  useEffect(() => {
    if (!blockId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setBlockId(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [blockId]);
  const block = blockId ? ws.get<BlockEntity>(blockId) : undefined;
  const attachment = block?.attachmentId ? ws.get<AttachmentEntity>(block.attachmentId) : undefined;
  if (!blockId || !attachment) return null;
  return createPortal(
    <div className="html-fullscreen" role="dialog" aria-label={attachment.name} style={{ left }}>
      <div className="html-fullscreen-bar">
        <a className="html-fullscreen-button" href={`/api/attachments/${encodeURIComponent(attachment.id)}`} download={attachment.name}><Icon name="download" size={16} />{t("다운로드")}</a>
        <button type="button" className="html-fullscreen-close" aria-label={t("닫기")} title={t("닫기")} onClick={() => setBlockId(null)}><Icon name="close" size={16} /></button>
      </div>
      <iframe className="html-fullscreen-frame" src={htmlSource(attachment.id)} title={attachment.name} referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" />
    </div>,
    document.body,
  );
}
