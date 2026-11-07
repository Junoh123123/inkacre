import { t } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspace, workspace, setStatus, report } from '../data/store';
import { hrefFor } from '../data/router';
import type { BlockEntity, Entity, PageEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { PageEditor } from '../editor/PageEditor';
import { PageIconGlyph } from './PageView';

// Presentation mode (beta): the page shown as slides over the whole
// window — the title alone first, then the page cut at its top-level dividers. A slide is laid out
// 800 wide (padding 56) and scaled to fill the window when it fits (never below 1; a long slide
// scrolls). ← → / Space step, Esc ends and brings the page to where the slide starts. The control bar
// (‹ n/N › | 링크 · 전체 화면 · 종료) shows while the pointer moves and fades after a moment.

export const presentationEvent = 'presentation-open';
export function startPresentation(pageId: string, blockId?: string | null) {
  window.dispatchEvent(new CustomEvent(presentationEvent, { detail: { pageId, blockId: blockId ?? null } }));
}

// Top-level items of the page, cut at top-level dividers (empty slides are skipped).
export function slideGroups(pageId: string): string[][] {
  const groups: string[][] = [[]];
  for (const child of workspace.children(pageId)) {
    if (!workspace.visible(child.id)) continue;
    if (child.kind === 'block' && (child as BlockEntity).blockType === 'divider') { groups.push([]); continue; }
    if (child.kind === 'block' || (child.kind === 'page' && !(child as PageEntity).sourceId) || child.kind === 'source' || child.kind === 'view') groups[groups.length - 1].push(child.id);
  }
  return groups.filter(group => group.length);
}

// The slide (1-based; 0 is the title) that shows a block, through its top-level ancestor.
export function slideOf(pageId: string, blockId: string | null | undefined): number {
  if (!blockId) return 0;
  let item: Entity | undefined = workspace.get(blockId);
  const seen = new Set<string>();
  while (item && item.parentId !== pageId && !seen.has(item.id)) { seen.add(item.id); item = workspace.get(item.parentId ?? ''); }
  if (!item) return 0;
  const index = slideGroups(pageId).findIndex(group => group.includes(item!.id));
  return index < 0 ? 0 : index + 1;
}

function setPresentParam(index: number | null) {
  const url = new URL(location.href);
  if (index === null) url.searchParams.delete('present'); else url.searchParams.set('present', String(index));
  history.replaceState(history.state, '', url);
}

export function Presentation({ pageId, start, onClose }: { pageId: string; start: number; onClose: (firstId: string | null) => void }) {
  const ws = useWorkspace();
  const page = ws.get<PageEntity>(pageId);
  const groups = slideGroups(pageId);
  const total = groups.length + 1;
  const [index, setIndex] = useState(() => Math.max(0, Math.min(start, total - 1)));
  const current = Math.min(index, total - 1);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 160 });
  const [controls, setControls] = useState(true);
  const hideTimer = useRef<number | undefined>(undefined);
  const overBar = useRef(false);
  const [full, setFull] = useState(false);

  const go = useCallback((next: number) => setIndex(Math.max(0, Math.min(next, total - 1))), [total]);
  const close = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    onClose(current > 0 ? groups[current - 1]?.[0] ?? null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, onClose, groups.map(group => group[0]).join(',')]);

  useEffect(() => { setPresentParam(current); scroller?.scrollTo({ top: 0 }); }, [current, scroller]);
  // The page underneath keeps no caret while the slides are up.
  useEffect(() => { (document.activeElement as HTMLElement | null)?.blur?.(); }, []);
  useEffect(() => () => setPresentParam(null), []);

  // Fill the window: scale = min(window width / 800, window height / slide height), never below 1.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const w = box.offsetWidth, h = box.offsetHeight;
      const fit = Math.min(window.innerWidth / w, window.innerHeight / Math.max(1, h));
      setSize({ w, h });
      setScale(Math.max(1, fit));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [current]);

  // Keys: → / Space / PageDown next, ← / PageUp back, Home / End, Esc ends.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      const next = event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown';
      const back = event.key === 'ArrowLeft' || event.key === 'PageUp';
      if (next || back || event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); event.stopPropagation();
        go(event.key === 'Home' ? 0 : event.key === 'End' ? total - 1 : current + (next ? 1 : -1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [current, total, go, close]);

  // The control bar shows while the pointer moves and fades 2s after it stops (opacity 0.3s).
  const poke = () => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { if (!overBar.current) setControls(false); }, 2000);
  };
  useEffect(() => { poke(); return () => window.clearTimeout(hideTimer.current); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    const onFull = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFull);
    return () => document.removeEventListener('fullscreenchange', onFull);
  }, []);

  const copyLink = () => {
    const url = new URL(hrefFor(pageId), location.href);
    url.searchParams.set('present', String(current));
    navigator.clipboard.writeText(url.href).then(() => setStatus(t("슬라이드 링크를 복사했습니다."))).catch(report);
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen().catch(() => undefined);
  };

  const title = current === 0;
  return createPortal(
    <div className="presentation" role="dialog" aria-label={t("프레젠테이션")} ref={setScroller} onMouseMove={poke}>
      <div className={`presentation-stage${title ? ' title-slide' : ''}`} style={{ minHeight: '100%' }}>
        <div className="presentation-frame" style={{ width: size.w * scale, height: size.h * scale }}>
          <div ref={boxRef} className="presentation-slide" style={{ transform: `scale(${scale})` }}>
            {title ? (
              <div className="presentation-title">
                {page?.icon ? <div className="presentation-icon"><PageIconGlyph icon={page.icon} size={78} /></div> : null}
                <div className="presentation-title-text">{page?.title || t("제목 없음")}</div>
              </div>
            ) : (
              <PageEditor pageId={pageId} scroller={scroller} readOnly slide={groups[current - 1] ?? []} className="presentation-editor" />
            )}
          </div>
        </div>
      </div>
      <div className={`presentation-controls${controls ? ' shown' : ''}`} role="toolbar" aria-label={t("프레젠테이션 컨트롤")}
        onMouseEnter={() => { overBar.current = true; setControls(true); }} onMouseLeave={() => { overBar.current = false; poke(); }}>
        <button type="button" className="presentation-button" aria-label={t("이전 슬라이드")} title={t("이전 슬라이드")} disabled={current === 0} onClick={() => go(current - 1)}><Icon name="chevron-left" size={20} /></button>
        <span className="presentation-count">{current + 1}/{total}</span>
        <button type="button" className="presentation-button" aria-label={t("다음 슬라이드")} title={t("다음 슬라이드")} disabled={current >= total - 1} onClick={() => go(current + 1)}><Icon name="chevron-right" size={20} /></button>
        <span className="presentation-divider" />
        <button type="button" className="presentation-button" aria-label={t("슬라이드 링크 복사")} title={t("슬라이드 링크 복사")} onClick={copyLink}><Icon name="export" size={20} /></button>
        <button type="button" className="presentation-button" aria-label={full ? t("전체 화면 종료") : t("전체 화면으로 보기")} title={full ? t("전체 화면 종료") : t("전체 화면으로 보기")} onClick={toggleFull}><Icon name="expand" size={20} /></button>
        <button type="button" className="presentation-button" aria-label={t("프레젠테이션 종료")} title={t("프레젠테이션 종료")} onClick={close}><Icon name="close" size={20} /></button>
      </div>
    </div>,
    document.body,
  );
}
