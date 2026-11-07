import { t } from '../i18n';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { apply } from '../data/commands';
import { navigate } from '../data/router';
import { report, useWorkspace, workspace } from '../data/store';
import { formatShortDate, formatTime, menuDate } from '../data/format';
import type { NotificationEntity, PageEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { openLayerCount } from '../ui/overlay';
import { EntityIcon } from '../page/EntityIcon';
import { readLocal, storeLocal } from '../data/api';

// "받은 알림": not a dialog but a 390-wide white
// panel against the sidebar's right edge, full height, menu shadow, sliding out from behind the
// sidebar (translateX(-390px) → 0, opacity .7 → 1, about 250ms). Header 44 high: the title 14/500
// at 12,12, then 28×28 buttons 고정 / 닫기 (≪) / 필터 / 더 보기. Groups are headed 12/500 #91918e;
// a row is 366 wide with an avatar (24) and 14/21 text, the date 12px #a19e99 on the right, and
// action buttons on hover. The sidebar's inbox button opens and closes it.

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function setInboxOpen(value: boolean) { if (open !== value) { open = value; emit(); } }
export function toggleInbox() { setInboxOpen(!open); }
function useInboxOpen() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => open); }

const pinKey = 'pageyard-inbox-pinned';
const filterKey = 'pageyard-inbox-filter';
const typeKey = 'pageyard-inbox-type';

// What sent a notification: a reminder, an automation's "알림 보내기", or an automation that failed.
// comment: an agent (or another app) commented on a page or answered a discussion.
type NoteType = 'reminder' | 'automation' | 'error' | 'comment';
// A notice's words, with pages an automation named (@) as links: [[page:<id>]] in the stored message.
export function noteText(message: string) { return message.replace(/\[\[page:([^\]]+)\]\]/g, (_, id) => workspace.title(workspace.get(id)) || t("페이지")); }
export function NoteMessage({ message }: { message: string }) {
  const parts = message.split(/(\[\[page:[^\]]+\]\])/);
  return <>{parts.map((part, index) => {
    const id = /^\[\[page:([^\]]+)\]\]$/.exec(part)?.[1];
    if (!id) return part;
    const page = workspace.get<PageEntity>(id);
    return <a key={index} className="inbox-page-link" href={`?id=${encodeURIComponent(id)}`} onClick={event => { event.preventDefault(); event.stopPropagation(); navigate(id); }}>{page ? <EntityIcon item={page} size={14} /> : null}{workspace.title(page) || t("페이지")}</a>;
  })}</>;
}
export function noteType(note: NotificationEntity): NoteType {
  return note.source ?? (note.id.startsWith('notification:') ? 'reminder' : /^자동화 ".*"을\(를\) 실행하지 못했습니다/.test(note.message) ? 'error' : 'automation');
}
const typeLabels: Record<NoteType, string> = { reminder: t("리마인더"), automation: t("자동화"), error: t("자동화 오류"), comment: t("댓글") };
const typeIcons: Record<NoteType, string> = { reminder: 'bell', automation: 'lightning', error: 'warning', comment: 'comment' };

function owningPage(id: string | null | undefined): PageEntity | undefined {
  let current = workspace.get(id ?? '');
  while (current && current.kind !== 'page') current = workspace.get(current.parentId);
  return current as PageEntity | undefined;
}

function bucket(iso: string) {
  const date = new Date(iso), now = new Date();
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86400000);
  if (diff <= 0) return t("오늘");
  if (diff < 7) return t("지난 7일");
  return t("older|이전");
}

function shortDate(iso: string) {
  const date = new Date(iso), now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(date);
  return formatShortDate(date);
}

export function InboxPanel() {
  const shown = useInboxOpen();
  const ws = useWorkspace();
  const [pinned, setPinned] = useState(() => readLocal<boolean>(pinKey, false) === true);
  // Read state (모든 알림 · 읽지 않은 알림 · 보관된 알림) and type; both kept per browser.
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>(() => { const value = readLocal<string>(filterKey, 'all'); return value === 'unread' || value === 'archived' ? value : 'all'; });
  const [type, setType] = useState<NoteType | 'all'>(() => { const value = readLocal<string>(typeKey, 'all'); return value in typeLabels ? value as NoteType : 'all'; });
  const [menu, setMenu] = useState<{ kind: 'filter' | 'more'; anchor: Element } | null>(null);
  const [entered, setEntered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Slide in from behind the sidebar on open.
  useEffect(() => {
    if (!shown) { setEntered(false); return; }
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(frame);
  }, [shown]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!shown || !panel) return;
    const sidebar = document.querySelector('.sidebar:not(.closed)');
    panel.style.left = `${sidebar ? Math.round(sidebar.getBoundingClientRect().right) : 0}px`;
  });
  // A click elsewhere (or Esc) closes it unless it is pinned.
  useEffect(() => {
    if (!shown) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (pinned || panelRef.current?.contains(target) || target.closest('[data-inbox-toggle], .overlay-layer')) return;
      setInboxOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !openLayerCount() && !pinned) setInboxOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [shown, pinned]);

  if (!shown) return null;
  const allNotes = ws.snapshot.objects.filter(item => item.kind === 'notification' && ws.visible(item.id)) as NotificationEntity[];
  const notes = allNotes
    .filter(note => filter === 'archived' ? !!note.archived : !note.archived && (filter === 'all' || !note.read))
    .filter(note => type === 'all' || noteType(note) === type)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups: Array<{ label: string; items: NotificationEntity[] }> = [];
  for (const note of notes) {
    const label = bucket(note.createdAt);
    const group = groups.find(entry => entry.label === label) ?? (groups.push({ label, items: [] }), groups[groups.length - 1]);
    group.items.push(note);
  }
  const unread = notes.filter(note => !note.read);
  const markRead = (items: NotificationEntity[], read: boolean) => { if (items.length) apply(items.map(note => ({ type: 'notification.read', id: note.id, read }))).catch(report); };
  const archive = (items: NotificationEntity[], archived: boolean) => { if (items.length) apply(items.map(note => ({ type: 'notification.archive', id: note.id, archived }))).catch(report); };
  const live = allNotes.filter(note => !note.archived);
  const openNote = (note: NotificationEntity) => {
    const page = owningPage(note.parentId);
    if (!note.read) markRead([note], true);
    if (!page) return;
    if (!pinned) setInboxOpen(false);
    navigate(page.id);
    setTimeout(() => document.querySelector(`[data-block-id="${CSS.escape(note.parentId ?? '')}"]`)?.scrollIntoView({ block: 'center' }), 200);
  };

  return (
    <div ref={panelRef} className={`inbox-panel${entered ? ' entered' : ''}`} role="dialog" aria-label={t("받은 알림")}>
      <div className="inbox-panel-head">
        <h2 className="inbox-panel-title">{t("받은 알림")}</h2>
        <button type="button" className={`icon-button${pinned ? ' active' : ''}`} aria-pressed={pinned} aria-label={pinned ? t("inbox-pin|고정 해제") : t("고정 표시")} title={pinned ? t("inbox-pin|고정 해제") : t("고정 표시")} onClick={() => { setPinned(!pinned); storeLocal(pinKey, JSON.stringify(!pinned)); }}><Icon name="pin" size={20} /></button>
        <button type="button" className="icon-button" aria-label={t("닫기")} title={t("닫기")} onClick={() => setInboxOpen(false)}><Icon name="double-chevron-left" size={20} /></button>
        <button type="button" className={`icon-button${filter !== 'all' || type !== 'all' ? ' active' : ''}`} aria-label={t("알림 필터")} title={t("알림 필터")} onClick={event => setMenu({ kind: 'filter', anchor: event.currentTarget })}><Icon name="filter" size={20} /></button>
        <button type="button" className="icon-button" aria-label={t("기타 작업")} title={t("기타 작업")} onClick={event => setMenu({ kind: 'more', anchor: event.currentTarget })}><Icon name="more" size={20} /></button>
      </div>
      <div className="inbox-panel-list">
        {groups.map(group => (
          <section key={group.label} className="inbox-group">
            <div className="inbox-group-label">{group.label}</div>
            {group.items.map(note => {
              const page = owningPage(note.parentId);
              return (
                <div key={note.id} className={`inbox-row${note.read ? ' read' : ''}`} role="button" tabIndex={0} onClick={() => openNote(note)} onKeyDown={event => { if (event.key === 'Enter') openNote(note); }}>
                  <span className={`inbox-avatar type-${noteType(note)}`} aria-hidden="true"><Icon name={typeIcons[noteType(note)]} size={14} /></span>
                  <div className="inbox-row-body">
                    <div className="inbox-row-text"><strong>{typeLabels[noteType(note)]}</strong> <NoteMessage message={note.message} /></div>
                    {page ? <div className="inbox-row-page"><EntityIcon item={page} size={14} /><span>{page.title || t("새 페이지")}</span></div> : null}
                  </div>
                  <div className="inbox-row-date">{shortDate(note.createdAt)}</div>
                  {!note.read ? <span className="inbox-unread-dot" aria-label={t("읽지 않음")} /> : null}
                  <div className="inbox-row-actions" onClick={event => event.stopPropagation()}>
                    {!note.archived ? <button type="button" className="icon-button tiny" aria-label={note.read ? t("읽지 않음으로 표시") : t("읽음으로 표시")} title={note.read ? t("읽지 않음으로 표시") : t("읽음으로 표시")} onClick={() => markRead([note], !note.read)}><Icon name={note.read ? 'eye-off' : 'check'} size={16} /></button> : null}
                    <button type="button" className="icon-button tiny inbox-archive" aria-label={note.archived ? t("보관 취소") : t("보관")} title={note.archived ? t("보관 취소") : t("보관")} onClick={() => archive([note], !note.archived)}><Icon name={note.archived ? 'undo' : 'library'} size={16} /></button>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
        {!notes.length ? <div className="inbox-empty"><Icon name="inbox" size={32} /><p>{filter === 'unread' ? t("읽지 않은 알림이 없습니다.") : filter === 'archived' ? t("보관된 알림이 없습니다.") : t("받은 알림이 없습니다.")}</p></div> : null}
      </div>
      {menu?.kind === 'filter' ? (
        <Menu anchor={menu.anchor} placement="below-start" width={220} onClose={() => setMenu(null)} entries={[
          { kind: 'section', label: t("상태") },
          ...(['all', 'unread', 'archived'] as const).map(value => ({ label: { all: t("모든 알림"), unread: t("읽지 않은 알림"), archived: t("보관된 알림") }[value], checked: filter === value, onSelect: () => { setFilter(value); storeLocal(filterKey, JSON.stringify(value)); } })),
          { kind: 'separator' },
          { kind: 'section', label: t("유형") },
          { label: t("모든 유형"), checked: type === 'all', onSelect: () => { setType('all'); storeLocal(typeKey, JSON.stringify('all')); } },
          ...(Object.keys(typeLabels) as NoteType[]).map(value => ({ label: typeLabels[value], icon: typeIcons[value], checked: type === value, onSelect: () => { setType(value); storeLocal(typeKey, JSON.stringify(value)); } })),
        ]} />
      ) : null}
      {menu?.kind === 'more' ? (
        <Menu anchor={menu.anchor} placement="below-start" width={240} onClose={() => setMenu(null)} entries={[
          { label: t("모두 읽음으로 표시"), icon: 'check', disabled: !unread.length, onSelect: () => markRead(unread, true) },
          { label: t("읽은 알림 모두 보관"), icon: 'library', disabled: !live.some(note => note.read), onSelect: () => archive(live.filter(note => note.read), true) },
          { label: t("모두 보관"), icon: 'library', disabled: !live.length, onSelect: () => archive(live, true) },
        ]} />
      ) : null}
    </div>
  );
}
