import { t } from '../i18n';
import { api, readLocal } from '../data/api';
import { openUpdatesPanel } from './UpdatesPanel';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import { navigate, hrefFor, currentRoute, openPeek, openAppPage } from '../data/router';
import { menuDate, plainText, wordCount, avatarLetter } from '../data/format';
import type { BlockEntity, Entity, PageEntity } from '../data/types';
import { Menu, type MenuEntry } from '../ui/Menu';
import type { Anchor } from '../ui/overlay';
import { Switch } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { startPresentation } from './Presentation';
import { openWorkspaceDialog } from '../dialogs/registry';
import { duplicatePage, trashNode, toggleFavorite } from './actions';
import { getPageStyle, setPageStyle, pageLockStored, setPageLock } from './PageView';
import { apply } from '../data/commands';
import { copyToWorkspace, defaultWorkspaceName, useWorkspaceList } from '../data/workspaces';
import { isDatabasePage, setDatabaseLock, useDatabaseLock } from '../database/shared';
import { openPageLayoutEditor } from '../database/PageLayoutEditor';

function bodyText(pageId: string): string {
  const parts: string[] = [];
  const walk = (parentId: string, depth: number) => {
    if (depth > 30) return;
    for (const child of workspace.children(parentId)) {
      if (child.kind !== 'block') continue;
      parts.push(plainText((child as BlockEntity).richText));
      walk(child.id, depth + 1);
    }
  };
  walk(pageId, 0);
  return parts.join(' ');
}

export function PageMenu({ anchor, item, onClose }: { anchor: Anchor; item: Entity; onClose: () => void }) {
  const ws = useWorkspace();
  const page = item.kind === 'page' ? item as PageEntity : undefined;
  const style = page ? getPageStyle(page.id) : null;
  const starred = ws.favorites().includes(item.id);
  const counts = page ? wordCount(`${page.title} ${bodyText(page.id)}`) : null;
  const isRow = !!page?.sourceId;
  // A full-page database has its own "…" menu: 복제 › (with or without its rows),
  // CSV 가져오기, 레이아웃 사용자 지정 and 데이터베이스 잠금 in place of the page's content, style and lock items.
  const databaseSource = page && !isRow && isDatabasePage(page)
    ? ws.children(page.id).filter(child => child.kind === 'source' && ws.visible(child.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null
    : null;
  const lock = useDatabaseLock(databaseSource);

  const fontTiles: MenuEntry = {
    kind: 'custom',
    keywords: t("font style 글꼴 스타일"),
    render: () => (
      <div className="font-tiles">
        {(['default', 'serif', 'mono'] as const).map(font => (
          <button type="button" key={font} role="menuitemradio" aria-checked={style?.font === font} className={`font-tile${style?.font === font ? ' active' : ''}`} onClick={() => page && setPageStyle(page.id, { font })}>
            <span className={`font-sample font-${font}`}>Ag</span>
            <span className="font-name">{font === 'default' ? t("기본") : font === 'serif' ? 'Serif' : 'Mono'}</span>
          </button>
        ))}
      </div>
    ),
  };
  const switchRow = (label: string, icon: string, checked: boolean, onChange: (value: boolean) => void): MenuEntry => ({
    label, icon, keepOpen: true, right: <Switch checked={checked} onChange={onChange} label={label} />, onSelect: () => onChange(!checked),
  });

  // The page "…" menu (256 wide, search on top): link / content / duplicate / move / version history |
  // 외관 및 레이아웃 › | lock / trash | 더 보기 › and "최종 업데이트" at the bottom.
  const appearance = (): MenuEntry[] => !page ? [] : [
    ...(page.sourceId ? [] : [{ kind: 'section', label: t("글꼴 스타일") } as MenuEntry, fontTiles, { kind: 'separator' } as MenuEntry]),
    { kind: 'section', label: t("외관") },
    switchRow(t("작은 텍스트"), 'type-title', !!style?.small, value => setPageStyle(page.id, { small: value })),
    switchRow(t("전체 너비"), 'fit-width', !!page.fullWidth, value => { apply([{ type: 'page.update', id: page.id, fullWidth: value }]).catch(report); }),
    switchRow(t("목차"), 'toc', style?.toc !== false, value => setPageStyle(page.id, { toc: value })),
    switchRow(t("댓글(상단)"), 'comment', style?.topComments !== false, value => setPageStyle(page.id, { topComments: value })),
    { label: t("댓글(페이지 내)"), icon: 'comment', submenuWidth: 240, submenu: () => (['default', 'minimal'] as const).map(mode => ({ label: { default: t("항상 표시"), minimal: t("최소화") }[mode], checked: (style?.inlineComments ?? 'default') === mode, onSelect: () => setPageStyle(page.id, { inlineComments: mode }) })) },
  ];
  const copyLink: MenuEntry = { label: t("링크 복사"), icon: 'link', shortcut: '⌘⌥L', onSelect: () => navigator.clipboard.writeText(new URL(hrefFor(item.id), location.href).href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report) };
  const moveTo: MenuEntry = { label: t("다른 페이지로 옮기기"), icon: 'move', shortcut: '⌘⇧P', onSelect: () => page && openWorkspaceDialog('move', { id: page.id, anchor, placement: 'below-end' }) };
  // 다른 워크스페이스로: a copy of the page (and what is under it) in another workspace on this computer, or moved there.
  const workspaces = useWorkspaceList(true);
  const others = (workspaces ?? []).filter(item => !item.current);
  const toWorkspace = (move: boolean): MenuEntry => ({ label: move ? t("다른 워크스페이스로 옮기기") : t("다른 워크스페이스로 복제"), icon: move ? 'move' : 'duplicate', submenuWidth: 240, submenu: () => others.map(target => ({
    label: target.name || defaultWorkspaceName(), onSelect: () => { if (page) copyToWorkspace(page.id, target.id, move).then(result => { setStatus(move ? t("{0}(으)로 옮겼습니다.", [target.name || defaultWorkspaceName()]) : t("{0}에 복제했습니다.", [target.name || defaultWorkspaceName()])); if (move) window.open(result.url, '_blank', 'noopener'); }).catch(report); },
  }) as MenuEntry) });
  const workspaceEntries: MenuEntry[] = others.length && page && !page.sourceId && !page.template ? [toWorkspace(false), toWorkspace(true)] : [];
  const history: MenuEntry[] = [
    { label: t("연결 지도에서 보기"), icon: 'graph', onSelect: () => page && openAppPage('graph', { focus: page.id }) },
    { label: t("버전 기록"), icon: 'history', onSelect: () => page && openWorkspaceDialog('version-history', { pageId: page.id, sourceId: databaseSource ?? undefined }) },
    { label: t("업데이트 및 분석"), icon: 'clock', onSelect: () => openUpdatesPanel() },
  ];
  // 보관 (archive): kept but out of search, database views and the sidebar; the link keeps working.
  const archiveEntry = (target: PageEntity): MenuEntry => target.archived
    ? { label: t("보관 해제"), icon: 'library', onSelect: () => { apply([{ type: 'page.update', id: target.id, archived: false }]).then(() => setStatus(t("보관을 해제했습니다."))).catch(report); } }
    : { label: t("보관"), icon: 'library', hint: t("검색·보기에서 숨김"), onSelect: () => { apply([{ type: 'page.update', id: target.id, archived: true }]).then(() => setStatus(t("페이지를 보관했습니다. 검색의 콘텐츠 상태 필터로 찾을 수 있습니다."))).catch(report); } };
  // 위키로 전환: the page shows 홈 · 모든 페이지 · 내 페이지 over its content.
  const wikiEntry = (target: PageEntity): MenuEntry => ({ label: target.wiki ? t("위키 해제") : t("위키로 전환"), icon: 'library',
    onSelect: () => { apply([{ type: 'page.update', id: target.id, wiki: !target.wiki }]).then(() => setStatus(target.wiki ? t("위키를 일반 페이지로 바꿨습니다.") : t("위키로 전환했습니다."))).catch(report); } });
  const toTrash: MenuEntry = { label: t("휴지통으로 이동"), icon: 'trash', onSelect: async () => {
    if (!page) return;
    await trashNode(page.id);
    const route = currentRoute();
    if (route.peek === page.id) openPeek(null);
    else if (route.id === page.id || workspace.ancestry(route.id ?? '').some(entry => entry.id === page.id)) navigate(page.parentId && workspace.visible(page.parentId) && workspace.get(page.parentId)?.kind === 'page' ? page.parentId : null);
    setStatus(t("휴지통으로 옮겼습니다."));
  } };
  const more: MenuEntry = { label: t("page-menu|더 보기"), icon: 'more', submenuWidth: 280, submenu: () => [
    // 프레젠테이션 (beta): the page as slides, cut at its dividers.
    ...(page && !page.template ? [{ label: t("프레젠테이션"), icon: 'presentation', badge: t("베타"), shortcut: '⌘⌥P', onSelect: () => startPresentation(page.id) } as MenuEntry] : []),
    { label: t("가져오기"), icon: 'import', onSelect: () => page && openWorkspaceDialog('import', { parentId: page.sourceId ? null : page.id }) },
    { label: t("내보내기"), icon: 'export', onSelect: () => page && openWorkspaceDialog('export', { id: page.id, ...(databaseSource ? { viewId: shownView(page.id, databaseSource) } : {}) }) },
  ] };
  const databaseEntries = (page: PageEntity, sourceId: string): MenuEntry[] => [
    copyLink,
    { label: t("복제"), icon: 'duplicate', submenuWidth: 275, submenu: () => [
      { label: t("데이터와 함께 복제"), shortcut: '⌘D', onSelect: () => duplicatePage(page).catch(report) },
      { label: t("데이터 없이 복제"), shortcut: '⌘⇧D', onSelect: () => duplicatePage(page, { withoutRows: true }).catch(report) },
    ] },
    moveTo, ...workspaceEntries,
    { label: t("CSV 가져오기"), icon: 'import', onSelect: () => openWorkspaceDialog('import', { sourceId }) },
    // 인라인으로 전환: the page stays, an ordinary page with the database inside it.
    { label: t("인라인으로 전환"), icon: 'turn-into', onSelect: () => { apply([{ type: 'page.update', id: page.id, databasePage: false }]).then(() => setStatus(t("인라인 데이터베이스로 전환했습니다."))).catch(report); } },
    ...history,
    { kind: 'separator' },
    { label: t("레이아웃 사용자 지정"), icon: 'page-layout', onSelect: () => openPageLayoutEditor(sourceId) },
    { kind: 'separator' },
    switchRow(t("데이터베이스 잠금"), 'lock', lock.stored, value => { setDatabaseLock(sourceId, value); }),
    archiveEntry(page),
    toTrash,
    { kind: 'separator' },
    more,
  ];
  const entries: MenuEntry[] = page && databaseSource ? databaseEntries(page, databaseSource) : page ? [
    copyLink,
    { label: t("페이지 콘텐츠 복사"), icon: 'copy', onSelect: async () => {
      const data = await api<{ text: string }>('/api/export', { id: page.id, format: 'markdown' });
      await navigator.clipboard.writeText(data.text);
      setStatus(t("페이지 콘텐츠를 복사했습니다."));
    } },
    { label: t("복제"), icon: 'duplicate', shortcut: '⌘D', onSelect: () => duplicatePage(page).catch(report) },
    moveTo, ...workspaceEntries,
    ...(!page.sourceId && !page.template ? [wikiEntry(page)] : []),
    ...history,
    { kind: 'separator' },
    { label: t("외관 및 레이아웃"), icon: 'font', submenu: appearance, submenuWidth: 300 },
    { kind: 'separator' },
    switchRow(t("페이지 잠금"), 'lock', pageLockStored(page), value => { setPageLock(page, value); }),
    ...(!page.template ? [archiveEntry(page)] : []),
    ...(isRow ? [
      { label: t("하위 항목과 종속성"), icon: 'tasks', onSelect: () => openWorkspaceDialog('task-settings', { sourceId: page.sourceId }) } as MenuEntry,
      { label: t("템플릿"), icon: 'template', onSelect: () => openWorkspaceDialog('templates', { sourceId: page.sourceId }) } as MenuEntry,
    ] : []),
    ...(page.template ? [{ label: t("반복 설정"), icon: 'repeat', onSelect: () => openWorkspaceDialog('recurrence', { templateId: page.id }) } as MenuEntry] : []),
    toTrash,
    { kind: 'separator' },
    more,
  ] : [
    { label: starred ? t("즐겨찾기에서 제거") : t("즐겨찾기에 추가"), icon: starred ? 'star-filled' : 'star', onSelect: () => toggleFavorite(item.id).catch(report) },
    { label: t("링크 복사"), icon: 'link', onSelect: () => navigator.clipboard.writeText(new URL(hrefFor(item.id), location.href).href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report) },
    { label: t("내보내기"), icon: 'export', onSelect: () => openWorkspaceDialog('export', { id: item.kind === 'view' ? (item as { sourceId: string }).sourceId : item.id, ...(item.kind === 'view' ? { viewId: item.id } : {}) }) },
  ];

  const editor = page?.updatedBy && page.updatedBy !== 'user' ? page.updatedBy : t("나");
  const footer = page ? (
    <div className="menu-meta page-menu-meta">
      <div className="menu-meta-title">{t("최종 업데이트")}</div>
      <div className="menu-meta-user"><span className="avatar tiny">{avatarLetter(editor)}</span>{editor}</div>
      <div>{menuDate(page.updatedAt)}</div>
      {databaseSource ? null : <div className="page-menu-count">{t("{0}단어, {1}자", [counts?.words ?? 0, counts?.characters ?? 0])}</div>}
    </div>
  ) : null;

  return <Menu anchor={anchor} placement="below-end" offset={8} width={256} entries={entries.filter((entry, index, list) => !(entry.kind === 'separator' && (index === 0 || list[index - 1]?.kind === 'separator')))} search={t("작업 검색…")} searchIcon footer={footer} onClose={onClose} label={t("페이지 메뉴")} submenuPlacement="side-center" />;
}

export { Icon };

// The view a database page shows now: the one in the address, else the tab last picked there (DatabaseFrame keeps it).
function shownView(pageId: string, sourceId: string): string | null {
  const routed = currentRoute().id ? workspace.get(currentRoute().id!) : undefined;
  if (routed?.kind === 'view' && (routed as { sourceId?: string }).sourceId === sourceId) return routed.id;
  const stored = readLocal<string | null>(`pageyard-active-view:${pageId}:${sourceId}`, null);
  if (stored && workspace.visible(stored) && (workspace.get(stored) as { sourceId?: string } | undefined)?.sourceId === sourceId) return stored;
  return workspace.children(pageId).find(child => child.kind === 'view' && workspace.visible(child.id) && (child as { sourceId?: string }).sourceId === sourceId)?.id ?? null;
}
