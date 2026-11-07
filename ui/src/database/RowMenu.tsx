import { t } from '../i18n';
import { useState } from 'react';
import { apply } from '../data/commands';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import { currentRoute, hrefFor, openPeek } from '../data/router';
import { menuDate, plainText, wordCount, avatarLetter } from '../data/format';
import type { BlockEntity, PageEntity, PropertyEntity, ViewEntity } from '../data/types';
import { Menu, type MenuEntry } from '../ui/Menu';
import type { Anchor, Placement } from '../ui/overlay';
import { openWorkspaceDialog } from '../dialogs/registry';
import { duplicatePage, toggleFavorite, trashNode } from '../page/actions';
import { EmojiPicker } from '../page/PageView';
import { openRow } from './shared';
import { ValueEditor, shownValue } from './values';

// The menu a database row or card opens on right-click (and from a card's "…" button):
// search, the "페이지" actions and who last edited it. Opened at the pointer it only fades in.

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

export function RowMenu({ anchor, rowId, view, orderedIds, onClose, placement = 'pointer', cellComment }: { anchor: Anchor; rowId: string; view: ViewEntity | null; orderedIds?: string[]; onClose: () => void; placement?: Placement; cellComment?: { name: string; open: () => void } }) {
  const ws = useWorkspace();
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<PropertyEntity | null>(null);
  const page = ws.get<PageEntity>(rowId);
  if (!page) return null;
  if (picker) {
    return <EmojiPicker anchor={anchor} upload onClose={onClose} onPick={value => apply([{ type: 'page.update', id: page.id, icon: value }]).catch(report)} onRemove={page.icon ? () => apply([{ type: 'page.update', id: page.id, icon: null }]).catch(report) : undefined} />;
  }
  if (editing) {
    const raw = editing.type === 'title' ? page.title : page.values?.[editing.id];
    return <ValueEditor anchor={anchor} pageId={page.id} property={editing} value={shownValue(page.id, editing, raw).value} placement={placement === 'pointer' ? 'pointer' : 'below-start'} onClose={onClose} />;
  }
  const starred = ws.favorites().includes(page.id);
  const counts = wordCount(`${page.title} ${bodyText(page.id)}`);
  const properties = page.sourceId ? ws.children(page.sourceId).filter(item => item.kind === 'property' && ws.visible(item.id)) as PropertyEntity[] : [];
  // 속성 편집 lists what can be changed from the row in the view's column order (the title first): values, and
  // formulas / rollups, which open their definition (수식 opens "수식 편집"); IDs, the
  // created / edited stamps and buttons are left out.
  const order = view?.config.visibleProperties ?? [];
  const rank = (property: PropertyEntity) => property.type === 'title' ? -1 : order.includes(property.id) ? order.indexOf(property.id) : order.length + properties.indexOf(property);
  const editable = properties.filter(property => !['created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id', 'button'].includes(property.type)).sort((a, b) => rank(a) - rank(b));
  // Table row right-click: search, "페이지": 즐겨찾기 · 아이콘 편집 · 속성 편집 ›
  // | 표시 형식: › (새 탭 ⌘⇧↵ · 사이드 피크 ⌥Click) · 댓글 ⌘⇧M | 링크 복사 · 복제 · 옮기기 · 휴지통
  // | 최종 업데이트. Submenus sit beside the item, centred on it.
  const entries: MenuEntry[] = [
    { kind: 'section', label: t("페이지") },
    { label: starred ? t("즐겨찾기에서 제거") : t("즐겨찾기에 추가"), icon: starred ? 'star-filled' : 'star', onSelect: () => toggleFavorite(page.id).catch(report) },
    { label: t("아이콘 편집"), icon: 'emoji', keepOpen: true, onSelect: () => setPicker(true) },
    ...(editable.length ? [{ label: t("row-menu|속성 편집"), icon: 'list', submenuWidth: 220, submenu: () => editable.map(property => (['formula', 'rollup'].includes(property.type)
      ? { label: property.name, icon: `type-${property.type}`, onSelect: () => openWorkspaceDialog('property', { sourceId: property.sourceId, propertyId: property.id }) }
      : { label: property.name, icon: `type-${property.type}`, keepOpen: true, onSelect: () => setEditing(property) }) as MenuEntry) } as MenuEntry] : []),
    { kind: 'separator' },
    { label: t("표시 형식:"), icon: 'arrow-up-right', submenuWidth: 240, submenu: () => [
      { label: t("새 탭"), icon: 'arrow-up-right', shortcut: '⌘⇧↵', onSelect: () => { window.open(hrefFor(page.id), '_blank'); } },
      { label: t("사이드 피크"), icon: 'peek-side', shortcut: '⌥Click', onSelect: () => openRow(view ? { ...view, config: { ...view.config, openMode: 'side' } } : null, page.id, orderedIds) },
    ] },
    { label: t("댓글"), icon: 'comment', shortcut: '⌘⇧M', onSelect: () => openWorkspaceDialog('comment', { parentId: page.id }) },
    // Right-clicked on a cell: a comment on that property's value (속성 값 댓글).
    ...(cellComment ? [{ label: t("{0}에 댓글 달기", [cellComment.name]), icon: 'comment', onSelect: cellComment.open } as MenuEntry] : []),
    { kind: 'separator' },
    { label: t("링크 복사"), icon: 'link', onSelect: () => navigator.clipboard.writeText(new URL(hrefFor(page.id), location.href).href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report) },
    { label: t("복제"), icon: 'duplicate', shortcut: '⌘D', onSelect: () => duplicatePage(page).catch(report) },
    { label: t("다른 페이지로 옮기기"), icon: 'move', shortcut: '⌘⇧P', onSelect: () => openWorkspaceDialog('move', { id: page.id, anchor, placement: placement === 'pointer' ? 'pointer' : 'below-start' }) },
    { label: t("휴지통으로 이동"), icon: 'trash', shortcut: 'Del', onSelect: async () => {
      await trashNode(page.id);
      if (currentRoute().peek === page.id) openPeek(null);
      setStatus(t("휴지통으로 옮겼습니다."));
    } },
  ];
  const editor = page.updatedBy === 'user' || !page.updatedBy ? t("나") : page.updatedBy;
  const footer = (
    <div className="menu-meta page-menu-meta">
      <div className="menu-meta-title">{t("최종 업데이트")}</div>
      <div className="menu-meta-user"><span className="avatar tiny">{avatarLetter(editor)}</span>{editor}</div>
      <div>{menuDate(page.updatedAt)}</div>
      <div>{t("{0}단어, {1}자", [counts.words, counts.characters])}</div>
    </div>
  );
  return <Menu anchor={anchor} placement={placement} motion={placement === 'pointer' ? 'fade' : undefined} width={265} entries={entries} search={t("작업 검색…")} footer={footer} onClose={onClose} label={t("행 메뉴")} submenuPlacement="side-center" />;
}
