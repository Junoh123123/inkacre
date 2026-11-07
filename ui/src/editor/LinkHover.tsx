import { t, tx } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { createPortal } from 'react-dom';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/Icon';
import { workspace, setStatus, report } from '../data/store';
import { EntityIcon } from '../page/EntityIcon';
import type { PageEntity } from '../data/types';
import { schema } from './schema';

// Hovering a link shows a small card under it (left-aligned with the
// link, 6px below, r10, URL 12px #7d7a75, copy 24×24 and "편집"); "편집" opens a 330-wide form
// centred under the link with the target, the link text and "링크 삭제".

export interface LinkTarget { from: number; to: number; href: string; rect: DOMRect }

export function linkTargetAt(view: EditorView, anchor: HTMLAnchorElement): LinkTarget | null {
  try {
    const from = view.posAtDOM(anchor, 0);
    const to = view.posAtDOM(anchor, anchor.childNodes.length);
    if (to <= from) return null;
    return { from, to, href: anchor.getAttribute('href') ?? '', rect: anchor.getBoundingClientRect() };
  } catch { return null; }
}

const internalId = (href: string) => href.match(/[?&]id=([^&#]+)/)?.[1];

function LinkHoverCard({ target, onEdit, onEnter, onLeave }: { target: LinkTarget; onEdit?: () => void; onEnter: () => void; onLeave: () => void }) {
  const pageId = internalId(target.href);
  const page = pageId ? workspace.get<PageEntity>(decodeURIComponent(pageId)) : undefined;
  const full = target.href.startsWith('/') ? new URL(target.href, location.href).href : target.href;
  return createPortal(
    <div className="link-hover-card" style={{ left: target.rect.left, top: target.rect.bottom + 6 }} onMouseEnter={onEnter} onMouseLeave={onLeave} onMouseDown={event => event.preventDefault()}>
      <span className="link-hover-icon">{page ? <EntityIcon item={page} size={14} /> : <Icon name="globe" size={12} />}</span>
      <span className="link-hover-url" title={full}>{page ? page.title || t("새 페이지") : target.href}</span>
      <button type="button" className="link-hover-button" aria-label={t("링크 복사")} title={t("링크 복사")} onClick={() => navigator.clipboard.writeText(full).then(() => setStatus(t("링크를 복사했습니다."))).catch(report)}><Icon name="copy" size={14} /></button>
      {onEdit ? <button type="button" className="link-hover-button text" onClick={onEdit}>{t("편집")}</button> : null}
    </div>,
    document.body,
  );
}

function LinkEditPopover({ view, target, onClose }: { view: EditorView; target: LinkTarget; onClose: () => void }) {
  const initialText = view.state.doc.textBetween(target.from, target.to);
  const [href, setHref] = useState(target.href);
  const [text, setText] = useState(initialText);
  const [active, setActive] = useState(0);
  const done = useRef(false);
  const pages = useMemo(() => {
    const needle = href.trim().toLocaleLowerCase();
    if (!needle || needle === target.href.toLocaleLowerCase() || /^https?:|^mailto:|^www\.|^\//.test(needle)) return [];
    return workspace.snapshot.objects.filter(item => item.kind === 'page' && !(item as PageEntity).template && workspace.visible(item.id) && ((item as PageEntity).title || '').toLocaleLowerCase().includes(needle)).slice(0, 6) as PageEntity[];
  }, [href, target.href]);
  const normalized = (value: string) => { const trimmed = value.trim(); return !trimmed ? '' : /^[a-z][\w+.-]*:|^\//i.test(trimmed) ? trimmed : `https://${trimmed}`; };
  const commit = (nextHref = normalized(href)) => {
    if (done.current) return;
    done.current = true;
    const { from, to } = target;
    const current = view.state.doc.textBetween(from, to);
    const tr = view.state.tr;
    let end = to;
    if (text && text !== current) {
      const marks = view.state.doc.resolve(from + 1).marks().filter(mark => mark.type !== schema.marks.link);
      tr.replaceWith(from, to, schema.text(text, marks));
      end = from + text.length;
    }
    tr.removeMark(from, end, schema.marks.link);
    if (nextHref) tr.addMark(from, end, schema.marks.link.create({ href: nextHref }));
    if (tr.docChanged) view.dispatch(tr);
    onClose();
    view.focus();
  };
  const linkPage = (page: PageEntity) => commit(`/?id=${encodeURIComponent(page.id)}`);
  useEffect(() => () => { done.current = true; }, []);
  return (
    <Popover anchor={target.rect} placement="below-center" offset={8} onClose={() => commit()} className="link-edit-popover" style={{ width: 330 }} label={t("링크 편집")}>
      <div className="link-edit">
        <label className="link-edit-label" htmlFor="link-edit-href">{tx("페이지 또는 URL{0}", [<span title={t("웹 주소를 붙여넣거나 이 작업 공간의 페이지를 검색하세요")}><Icon name="info" size={15} /></span>])}</label>
        <div className="link-edit-field">
          <input id="link-edit-href" value={href} onChange={event => { setHref(event.target.value); setActive(0); }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter') { event.preventDefault(); if (pages[active]) linkPage(pages[active]); else commit(); }
              if (event.key === 'ArrowDown' && pages.length) { event.preventDefault(); setActive(index => Math.min(pages.length - 1, index + 1)); }
              if (event.key === 'ArrowUp' && pages.length) { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
            }} />
        </div>
        {pages.length ? (
          <div className="link-results">
            {pages.map((page, index) => (
              <div key={page.id} className={`menu-item${index === active ? ' active' : ''}`} onPointerMove={() => setActive(index)} onMouseDown={event => { event.preventDefault(); linkPage(page); }}>
                <span className="menu-item-icon"><EntityIcon item={page} /></span><span className="menu-item-label">{page.title || t("새 페이지")}</span>
              </div>
            ))}
          </div>
        ) : null}
        <label className="link-edit-label" htmlFor="link-edit-text">{t("링크 제목")}</label>
        <div className="link-edit-field">
          <input id="link-edit-text" autoFocus value={text} onChange={event => setText(event.target.value)}
            onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
        </div>
      </div>
      <div className="link-edit-footer">
        <div className="menu-item" role="button" onMouseDown={event => { event.preventDefault(); commit(''); }}>
          <span className="menu-item-icon"><Icon name="trash" /></span><span className="menu-item-label">{t("링크 삭제")}</span>
        </div>
      </div>
    </Popover>
  );
}

// Hover wiring: the card shows after a short rest on a link, stays while the pointer moves
// onto it, and goes away on typing, clicks elsewhere or scrolling.
const SHOW_DELAY = 400, HIDE_DELAY = 200;

export function LinkHover({ view, scroller, readOnly }: { view: EditorView | null; scroller: HTMLElement | null; readOnly?: boolean }) {
  const [hover, setHover] = useState<LinkTarget | null>(null);
  const [editing, setEditing] = useState<LinkTarget | null>(null);
  const timers = useRef<{ show?: number; hide?: number }>({});
  const hide = (delay = HIDE_DELAY) => {
    window.clearTimeout(timers.current.show);
    window.clearTimeout(timers.current.hide);
    timers.current.hide = window.setTimeout(() => setHover(null), delay);
  };
  const keep = () => window.clearTimeout(timers.current.hide);
  useEffect(() => {
    if (!view) return;
    const dom = view.dom;
    let pressed = false;
    const linkOf = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLAnchorElement>('a.inline-link') : null);
    const over = (event: MouseEvent) => {
      const link = linkOf(event.target);
      if (!link || !dom.contains(link) || pressed) return;
      keep();
      window.clearTimeout(timers.current.show);
      timers.current.show = window.setTimeout(() => {
        if (pressed || !link.isConnected) return;
        const target = linkTargetAt(view, link);
        if (target) setHover(target);
      }, SHOW_DELAY);
    };
    const out = (event: MouseEvent) => {
      const link = linkOf(event.target);
      if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return;
      hide();
    };
    const down = () => { pressed = true; hide(0); };
    const up = () => { pressed = false; };
    const quiet = () => hide(0);
    dom.addEventListener('mouseover', over);
    dom.addEventListener('mouseout', out);
    dom.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    dom.addEventListener('keydown', quiet);
    scroller?.addEventListener('scroll', quiet, { passive: true });
    return () => {
      dom.removeEventListener('mouseover', over);
      dom.removeEventListener('mouseout', out);
      dom.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      dom.removeEventListener('keydown', quiet);
      scroller?.removeEventListener('scroll', quiet);
      window.clearTimeout(timers.current.show);
      window.clearTimeout(timers.current.hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scroller]);
  if (!view) return null;
  return (
    <>
      {hover && !editing ? (
        <LinkHoverCard target={hover} onEnter={keep} onLeave={() => hide()}
          onEdit={readOnly ? undefined : () => {
            // Re-read the range in case the document moved since the card opened.
            const link = view.dom.querySelectorAll<HTMLAnchorElement>('a.inline-link');
            const fresh = [...link].map(anchor => linkTargetAt(view, anchor)).find(item => item && item.from === hover.from) ?? hover;
            setHover(null);
            setEditing(fresh);
          }} />
      ) : null}
      {editing ? <LinkEditPopover view={view} target={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
