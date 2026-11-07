import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { navigate, openPeek, getPeekList, hrefFor } from '../data/router';
import { report, setStatus, useWorkspace } from '../data/store';
import type { PageEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { openLayerCount } from '../ui/overlay';
import { PageView } from './PageView';
import { PageMenu } from './PageMenu';
import { isFreshPage, toggleFavorite } from './actions';
import { EntityIcon } from './EntityIcon';
import { openWorkspaceDialog } from '../dialogs/registry';

// Side peek (half the window, right) and center peek (modal) for database rows.

export function Peek({ rowId, mode, closing = false }: { rowId: string; mode: 'side' | 'center'; closing?: boolean }) {
  const ws = useWorkspace();
  const page = ws.get<PageEntity>(rowId);
  const [modeMenu, setModeMenu] = useState<Element | null>(null);
  const [menu, setMenu] = useState<Element | null>(null);
  const list = getPeekList();
  const index = list.indexOf(rowId);
  const close = () => openPeek(null);

  // A press outside the side peek closes it (clicking the page beside it).
  // Menus opened from it close first; presses on another layer or toast don't count.
  useEffect(() => {
    if (closing || mode !== 'side') return;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || openLayerCount()) return;
      const target = event.target as Element | null;
      if (!target?.isConnected || target.closest('.peek, .overlay-layer, .toast, .drag-ghost-layer, .tooltip')) return;
      close();
    };
    // On window, so it runs before the layers' own handler on document has closed them.
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [closing, mode]);

  useEffect(() => {
    if (closing) return;
    const onKey = (event: KeyboardEvent) => {
      // Ctrl+Shift+K / J: the previous / next item of the list the peek was opened from.
      if (event.ctrlKey && event.shiftKey && !event.metaKey && (event.code === 'KeyK' || event.code === 'KeyJ') && mode === 'side') {
        const next = list[index + (event.code === 'KeyK' ? -1 : 1)];
        event.preventDefault();
        if (index >= 0 && next) openPeek(next, mode);
        return;
      }
      if (event.key !== 'Escape' || event.isComposing || openLayerCount()) return;
      const active = document.activeElement as HTMLElement | null;
      // Esc in the page title closes the peek; in the body it first selects the block.
      if (!active?.classList.contains('page-title') && active?.closest('.peek input, .peek textarea, .peek [contenteditable="true"]')) return;
      if (document.querySelector('.peek .has-block-selection')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closing, index, mode, list]);

  if (!page || !ws.visible(page.id)) {
    return (
      <aside className={`peek peek-${mode}`}>
        <div className="peek-header"><button type="button" className="icon-button small" aria-label={t("닫기")} onClick={close}><Icon name="double-chevron-right" /></button></div>
        <div className="peek-missing">{t("이 항목은 휴지통에 있거나 더 이상 존재하지 않습니다.")}</div>
      </aside>
    );
  }
  const fresh = isFreshPage(page.id);
  const parent = page.parentId ? ws.get(page.parentId) : null;
  const starred = ws.favorites().includes(page.id);
  const header = (
    <div className="peek-header">
      <div className="peek-header-left">
        {/* The centred window has only "open as full page" on the left (closed with Esc or a click
            outside); the side peek also has close, view mode and previous/next. */}
        {mode === 'side' ? <button type="button" className="icon-button small" aria-label={t("닫기")} title={t("닫기 (Esc)")} onClick={close}><Icon name="double-chevron-right" /></button> : null}
        <button type="button" className="icon-button small" aria-label={t("전체 페이지로 열기")} title={t("전체 페이지로 열기")} onClick={() => navigate(page.id)}><Icon name="expand" size={16} /></button>
        {/* Side peek: » and ⤢ always; the mode button and ↑ ↓, each behind a divider, show
            while the pointer is over the header. */}
        {mode === 'side' ? <span className="peek-divider peek-reveal" /> : null}
        {mode === 'side' ? <button type="button" className="icon-button small peek-reveal" aria-label={t("보기 방식")} title={t("보기 방식 변경")} onClick={event => setModeMenu(event.currentTarget)}><Icon name="peek-side" /></button> : null}
        {mode === 'side' || fresh ? <span className={`peek-divider${fresh ? '' : ' peek-reveal'}`} /> : null}
        {fresh ? (
          // A page just made from the sidebar shows where it was added (and lets that be changed).
          <button type="button" className="peek-add-to" onClick={event => openWorkspaceDialog('move', { id: page.id, anchor: event.currentTarget, placement: 'below-start' })}>
            <span className="peek-add-to-label">{t("추가 위치")}</span>
            {parent ? <EntityIcon item={parent} size={16} /> : null}
            <span className="peek-add-to-name">{parent ? ws.title(parent) || t("새 페이지") : t("개인 페이지")}</span>
            <Icon name="chevron-down" size={12} />
          </button>
        ) : mode === 'side' ? (
          <>
            <button type="button" className="icon-button small peek-reveal" aria-label={t("이전 항목")} title={t("이전 항목 (Ctrl+Shift+K)")} disabled={index <= 0} onClick={() => openPeek(list[index - 1], mode)}><Icon name="chevron-up" /></button>
            <button type="button" className="icon-button small peek-reveal" aria-label={t("다음 항목")} title={t("다음 항목 (Ctrl+Shift+J)")} disabled={index < 0 || index >= list.length - 1} onClick={() => openPeek(list[index + 1], mode)}><Icon name="chevron-down" /></button>
          </>
        ) : null}
      </div>
      <div className="peek-header-right">
        <button type="button" className="icon-button small" aria-label={t("링크 복사")} title={t("링크 복사")} onClick={() => navigator.clipboard.writeText(new URL(hrefFor(page.id), location.href).href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report)}><Icon name="link" /></button>
        <button type="button" className={`icon-button small${starred ? ' starred' : ''}`} aria-label={t("즐겨찾기")} onClick={() => toggleFavorite(page.id).catch(report)}><Icon name={starred ? 'star-filled' : 'star'} /></button>
        <button type="button" className="icon-button small" aria-label={t("페이지 메뉴")} onClick={event => setMenu(event.currentTarget)}><Icon name="more" /></button>
      </div>
    </div>
  );
  const body = <PageView key={page.id} page={page} variant={mode === 'side' ? 'peek' : 'center'} />;
  return (
    <>
      {mode === 'center' ? (
        <div className="peek-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
          <aside className="peek peek-center" role="dialog" aria-label={page.title || t("새 페이지")}>{header}{body}</aside>
        </div>
      ) : (
        <aside className={`peek peek-side${closing ? ' closing' : ''}`} role="dialog" aria-label={page.title || t("새 페이지")} aria-hidden={closing || undefined}>{header}{body}</aside>
      )}
      {modeMenu ? (
        <Menu anchor={modeMenu} width={240} onClose={() => setModeMenu(null)} entries={[
          { label: t("사이드 보기"), icon: 'peek-side', checked: mode === 'side', onSelect: () => openPeek(page.id, 'side') },
          { label: t("중앙에서 보기"), icon: 'peek-center', checked: mode === 'center', onSelect: () => openPeek(page.id, 'center') },
          { label: t("전체 페이지"), icon: 'peek-full', onSelect: () => navigate(page.id) },
        ]} />
      ) : null}
      {menu ? <PageMenu anchor={menu} item={page} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
