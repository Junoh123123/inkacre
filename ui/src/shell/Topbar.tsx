import { intlLocale, t } from '../i18n';
import { useState } from 'react';
import { useRoute, navigate, hrefFor } from '../data/router';
import { useWorkspace, report, setStatus } from '../data/store';
import { usePending } from '../data/commands';
import { relativeTime } from '../data/format';
import { Icon } from '../ui/Icon';
import { EntityIcon } from '../page/EntityIcon';
import { PageMenu } from '../page/PageMenu';
import { openUpdatesPanel } from '../page/UpdatesPanel';
import { placeablePages, toggleFavorite } from '../page/actions';
import { openWorkspaceDialog } from '../dialogs/registry';
import type { Entity, PageEntity, ViewEntity } from '../data/types';
import { isDatabasePage, setDatabaseLock, unlockDatabaseForNow, useDatabaseLock } from '../database/shared';
import { Menu } from '../ui/Menu';

export function lastEdited(id: string, ws = useWorkspace()): string | null {
  const root = ws.get(id);
  if (!root) return null;
  let latest = root.updatedAt;
  const visit = (parentId: string, depth: number) => {
    if (depth > 20) return;
    for (const child of ws.children(parentId)) {
      if (child.kind === 'block' || child.kind === 'comment') {
        if (child.updatedAt > latest) latest = child.updatedAt;
        visit(child.id, depth + 1);
      }
    }
  };
  visit(id, 0);
  return latest;
}

export function Breadcrumbs({ id }: { id: string }) {
  const ws = useWorkspace();
  // A view is shown as its database ("… / 상위 페이지 / DB" for the full-page database's view; a
  // view on another page ends with that database's name).
  let chain = ws.ancestry(id).filter(item => item.kind !== 'source' || item.id === id);
  const last = chain[chain.length - 1];
  if (last?.kind === 'view') {
    const source = ws.get((last as Entity & { sourceId?: string }).sourceId ?? '');
    const host = ws.get(last.parentId ?? '');
    chain = chain.slice(0, -1);
    if (source && !(host?.kind === 'page' && host.id === source.parentId && isDatabasePage(host as PageEntity))) chain.push(source);
  }
  const shown: Array<Entity | null> = chain.length > 4 ? [chain[0], null, ...chain.slice(-2)] : chain;
  // A locked database shows "🔒 잠김" after its name, with 잠금 해제 / 모든 사용자 잠금 해제.
  const here = ws.get(id);
  const lockSource = here?.kind === 'view' ? (here as ViewEntity).sourceId : here?.kind === 'source' ? here.id : here?.kind === 'page' && isDatabasePage(here as PageEntity) ? ws.children(here.id).find(child => child.kind === 'source')?.id : undefined;
  const lock = useDatabaseLock(lockSource);
  const [lockMenu, setLockMenu] = useState<Element | null>(null);
  return (
    <nav className="breadcrumbs" aria-label={t("현재 위치")}>
      {shown.map((item, index) => (
        <span key={item?.id ?? `gap-${index}`} className="crumb-wrap">
          {index ? <span className="crumb-separator" aria-hidden="true">/</span> : null}
          {item ? (
            <a href={hrefFor(item.id)} className={`crumb${index === shown.length - 1 ? ' current' : ''}`} aria-current={index === shown.length - 1 ? 'page' : undefined}
              onClick={event => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); navigate(item.id); } }}>
              {item.kind === 'page' && (item as PageEntity).icon ? <EntityIcon item={item} size={18} className="crumb-icon" /> : null}
              <span className="crumb-text">{ws.title(item) || (item.kind === 'page' ? t("새 페이지") : t("제목 없음"))}</span>
            </a>
          ) : <span className="crumb ellipsis">…</span>}
        </span>
      ))}
      {here?.kind === 'page' && !here.parentId && placeablePages.has(here.id) ? <button type="button" className="crumb-place" title={t("페이지 위치 변경")} onClick={event => openWorkspaceDialog('move', { id: here.id, anchor: event.currentTarget, placement: 'below-start' })}><Icon name="lock" size={16} /><span>{t("개인 페이지")}</span><Icon name="chevron-down" size={11} /></button> : null}
      {lock.stored && lockSource ? <button type="button" className="crumb-lock" onClick={event => setLockMenu(event.currentTarget)}><Icon name={lock.locked ? 'lock' : 'unlock'} size={12} /><span>{lock.locked ? t("잠김") : t("잠금 해제됨")}</span></button> : null}
      {lockMenu && lockSource ? <Menu anchor={lockMenu} placement="below-start" width={180} onClose={() => setLockMenu(null)} entries={[
        lock.locked ? { label: t("잠금 해제"), icon: 'pencil', onSelect: () => unlockDatabaseForNow(lockSource) } : { label: t("다시 잠그기"), icon: 'lock', onSelect: () => unlockDatabaseForNow(lockSource, false) },
        { label: t("모든 사용자 잠금 해제"), icon: 'unlock', onSelect: () => setDatabaseLock(lockSource, false) },
      ]} /> : null}
    </nav>
  );
}

export function Topbar({ sidebarOpen, onOpenSidebar, onFloatHover }: { sidebarOpen: boolean; onOpenSidebar: () => void; onFloatHover?: (inside: boolean) => void }) {
  const ws = useWorkspace();
  const route = useRoute();
  const pending = usePending();
  const [menu, setMenu] = useState<Element | null>(null);
  const current = route.id ? ws.get(route.id) : undefined;
  const page = current?.kind === 'page' ? current as PageEntity : current?.kind === 'view' || current?.kind === 'source' ? ws.get<PageEntity>(current.kind === 'view' ? ws.get(current.parentId)?.kind === 'page' ? current.parentId : undefined : current.parentId) : undefined;
  const edited = current ? lastEdited(current.id, ws) : null;
  const starred = current ? ws.favorites().includes(current.id) : false;
  const conflicted = pending.filter(item => item.error);
  return (
    <header className="topbar">
      {!sidebarOpen ? <button type="button" className="icon-button small sidebar-open" aria-label={t("사이드바 열기")} title={t("사이드바 고정 (⌘\\)")} onClick={onOpenSidebar} onPointerEnter={() => onFloatHover?.(true)} onPointerLeave={() => onFloatHover?.(false)}><Icon name="sidebar-open" /></button> : null}
      {current && ws.visible(current.id) ? <Breadcrumbs id={current.id} /> : <nav className="breadcrumbs"><span className="crumb current"><span className="crumb-text">{current ? t("찾을 수 없는 페이지") : route.library ? t("라이브러리") : route.app === 'tasks' ? t("내 작업") : route.app === 'graph' ? t("연결 지도") : t("홈")}</span></span></nav>}
      <div className="topbar-right">
        {pending.length ? (
          <button type="button" className={`topbar-pending${conflicted.length ? ' conflict' : ''}`} onClick={() => openWorkspaceDialog('pending')}>
            <Icon name="warning" size={16} />{conflicted.length ? t("저장 충돌 {0}", [conflicted.length]) : t("저장 대기 {0}", [pending.length])}
          </button>
        ) : null}
        {current && edited ? <span className="topbar-edited" title={new Date(edited).toLocaleString(intlLocale)}>{t("edited-ago|{0} 편집", [relativeTime(edited)])}</span> : null}
        {current ? (
          <>
            {current.kind === 'page' ? <button type="button" className="icon-button topbar-comments" aria-label={t("댓글 창")} title={t("모든 댓글 보기")} onClick={() => openUpdatesPanel('comments')}><Icon name="comment" /></button> : null}
            <button type="button" className="icon-button topbar-link" aria-label={t("링크 복사")} title={t("링크 복사")} onClick={() => navigator.clipboard.writeText(new URL(hrefFor(current.id), location.href).href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report)}><Icon name="link" /></button>
            <button type="button" className={`icon-button${starred ? ' starred' : ''}`} aria-label={starred ? t("즐겨찾기에서 제거") : t("즐겨찾기에 추가")} title={starred ? t("즐겨찾기에서 제거") : t("즐겨찾기에 추가")} onClick={() => toggleFavorite(current.id).catch(report)}><Icon name={starred ? 'star-filled' : 'star'} /></button>
            <button type="button" className="icon-button" aria-label={t("페이지 메뉴")} title={t("스타일, 내보내기 등")} aria-haspopup="menu" onClick={event => setMenu(event.currentTarget)}><Icon name="more" /></button>
          </>
        ) : null}
      </div>
      {menu && current ? <PageMenu anchor={menu} item={page ?? current} onClose={() => setMenu(null)} /> : null}
    </header>
  );
}
