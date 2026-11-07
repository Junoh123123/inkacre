import { t } from '../i18n';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/Icon';
import { workspace } from '../data/store';
import { recentIds } from '../data/router';
import { EntityIcon } from '../page/EntityIcon';
import { displayDate, formatHour } from '../data/format';
import type { PageEntity } from '../data/types';
import type { KeyTarget } from './SlashMenu';
import { parseRemind, parseTypedDate } from './inlinePopovers';

export type MentionChoice =
  | { kind: 'page'; pageId: string; title: string }
  | { kind: 'date'; date: string; text: string }
  | { kind: 'reminder'; at: string; date: string; text: string }
  | { kind: 'new-page'; title: string }
  | { kind: 'new-page-at'; title: string };

function localDate(offsetDays: number, hour?: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  if (hour !== undefined) date.setHours(hour, 0, 0, 0);
  return date;
}
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// links: the "+" / "[[" menu — pages and new pages only, no dates.
export interface MentionMenuProps { anchor: { x: number; y: number; height: number }; query: string; links?: boolean; onChoose: (choice: MentionChoice) => void; onClose: () => void }

// The @ menu: a 330-wide panel (r10, at most 331 high) under the caret with sections split by
// lines — 날짜 (오늘 · 리마인드 — 내일 오전 9시), 페이지에 링크하기
// (five pages, 45-high rows with the page's location in 12px under the name, then "결과 N개 더
// 보기"), and 새 페이지 (새 하위 페이지 추가 · 위치를 선택해 새 페이지 추가, naming the typed text
// when there is one). A typed query keeps only the matching rows.
const pageLimit = 5;

export const MentionMenu = forwardRef<KeyTarget, MentionMenuProps>(function MentionMenu({ anchor, query, links = false, onChoose, onClose }, ref) {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const typed = query.trim();
  const sections = useMemo(() => {
    const dates: Array<{ label: string; choice: MentionChoice; icon: string; hint?: string }> = [];
    const today = localDate(0), tomorrow = localDate(1), remind = localDate(1, 9);
    // A day typed after @ ("2026-11-03", "11/3", "11월 3일") is offered as a date too.
    const typedDay = parseTypedDate(query);
    const dateOptions = [
      { words: t("오늘 today now date 날짜"), label: t("오늘"), icon: 'clock', choice: { kind: 'date', date: isoDay(today), text: displayDate(isoDay(today)) } as MentionChoice },
      ...(needle ? [{ words: t("내일 tomorrow"), label: t("내일"), icon: 'clock', choice: { kind: 'date', date: isoDay(tomorrow), text: displayDate(isoDay(tomorrow)) } as MentionChoice }] : []),
      { words: t("리마인드 remind reminder 알림 내일"), label: t("리마인드"), hint: t("내일 {0}", [formatHour(9)]), icon: 'alarm', choice: { kind: 'reminder', at: remind.toISOString(), date: `${isoDay(remind)}T09:00`, text: t("⏰ {0} 오전 9:00", [displayDate(isoDay(remind))]) } as MentionChoice },
    ];
    if (!links && typedDay) dates.push({ label: displayDate(typedDay), icon: 'calendar', choice: { kind: 'date', date: typedDay, text: displayDate(typedDay) } });
    // "@remind 7pm", "@리마인드 내일 오후 3시": a reminder at the day and time typed.
    const typedRemind = links ? null : parseRemind(query);
    if (typedRemind) {
      const [year, month, date] = typedRemind.day.split('-').map(Number), [hour, minute] = typedRemind.time.split(':').map(Number);
      const at = new Date(year, month - 1, date, hour, minute), stamp = `${typedRemind.day}T${typedRemind.time}`;
      dates.push({ label: t("리마인드: {0}", [displayDate(stamp)]), icon: 'alarm', choice: { kind: 'reminder', at: at.toISOString(), date: stamp, text: `⏰ ${displayDate(stamp)}` } as MentionChoice });
    }
    if (!links) for (const option of dateOptions) if (!needle || option.words.includes(needle) || option.label.includes(needle)) dates.push(option);
    const seen = new Set<string>();
    const pages = [...recentIds(), ...workspace.snapshot.objects.filter(item => item.kind === 'page').map(item => item.id)]
      .filter(id => { if (seen.has(id)) return false; seen.add(id); const page = workspace.get<PageEntity>(id); return !!page && page.kind === 'page' && !page.template && workspace.visible(id) && (!needle || (page.title || '').toLocaleLowerCase().includes(needle)); })
      .map(id => workspace.get<PageEntity>(id)!);
    return { dates, pages };
  }, [needle, links]);
  const shownPages = expanded ? sections.pages : sections.pages.slice(0, pageLimit);
  const morePages = sections.pages.length - shownPages.length;
  // One list for the keyboard, in the order the rows show.
  const actions: Array<() => void> = [
    ...sections.dates.map(item => () => onChoose(item.choice)),
    ...shownPages.map(page => () => onChoose({ kind: 'page', pageId: page.id, title: page.title || t("새 페이지") })),
    ...(morePages > 0 ? [() => setExpanded(true)] : []),
    () => onChoose({ kind: 'new-page', title: typed }),
    () => onChoose({ kind: 'new-page-at', title: typed }),
  ];
  useEffect(() => { setActive(0); setExpanded(false); }, [needle]);
  // A space after text that matches nothing ends the menu, so "+1 좋아요" or "@ 3시" stay plain text.
  const nothing = !sections.dates.length && !sections.pages.length;
  useEffect(() => { if (nothing && /\S\s$/.test(query)) onClose(); }, [nothing, query]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  useImperativeHandle(ref, () => ({
    onKey(event) {
      if (event.key === 'ArrowDown') { setActive(index => (index + 1) % actions.length); return true; }
      if (event.key === 'ArrowUp') { setActive(index => (index - 1 + actions.length) % actions.length); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { actions[active]?.(); return true; }
      return false;
    },
  }), [actions, active]);
  let index = -1;
  const row = (key: string, icon: React.ReactNode, label: React.ReactNode, { hint, path }: { hint?: string; path?: string } = {}) => {
    index++;
    const myIndex = index;
    return (
      <div key={key} data-index={myIndex} role="option" aria-selected={myIndex === active} className={`slash-item mention-item${myIndex === active ? ' active' : ''}${path ? ' with-path' : ''}`} onPointerMove={() => setActive(myIndex)} onMouseDown={event => { event.preventDefault(); actions[myIndex]?.(); }}>
        <span className="slash-item-icon">{icon}</span>
        {path ? <span className="mention-text"><span className="slash-item-label">{label}</span><span className="mention-path">{path}</span></span> : <span className="slash-item-label">{label}{hint ? <span className="mention-hint"> — {hint}</span> : null}</span>}
      </div>
    );
  };
  const pathOf = (page: PageEntity) => {
    const names = workspace.ancestry(page.id).filter(entry => entry.id !== page.id && (entry.kind === 'page' || entry.kind === 'source')).map(entry => workspace.title(entry) || t("새 페이지"));
    if (!names.length) return t("개인 페이지");
    return names.length > 2 ? `${names[0]} / … / ${names[names.length - 1]}` : names.join(' / ');
  };
  const groups: React.ReactNode[] = [];
  if (sections.dates.length) groups.push(
    <div key="dates" className="slash-group"><div className="menu-heading slash-heading">{t("날짜")}</div>
      {sections.dates.map(item => row(`date-${item.label}`, <Icon name={item.icon} />, item.label, { hint: item.hint }))}
    </div>);
  if (shownPages.length) groups.push(
    <div key="pages" className="slash-group"><div className="menu-heading slash-heading">{t("페이지에 링크하기")}</div>
      {shownPages.map(page => row(`page-${page.id}`, <EntityIcon item={page} size={18} />, page.title || t("새 페이지"), { path: pathOf(page) }))}
      {morePages > 0 ? row('more', <Icon name="more" />, <span className="mention-more">{t("결과 {0}개 더 보기", [morePages])}</span>) : null}
    </div>);
  groups.push(
    <div key="new" className="slash-group"><div className="menu-heading slash-heading">{t("새 페이지")}</div>
      {row('new-page', <Icon name="plus" />, typed ? t("\"{0}\" 하위 페이지 새로 만들기", [typed]) : t("새 하위 페이지 추가"))}
      {row('new-page-at', <Icon name="arrow-up-right" />, typed ? t("위치를 선택해 \"{0}\" 페이지 새로 만들기", [typed]) : t("위치를 선택해 새 페이지 추가"))}
    </div>);
  return (
    <Popover anchor={{ x: anchor.x, y: anchor.y, width: 0, height: anchor.height }} placement="below-start" offset={8} onClose={onClose} className="slash-menu mention-menu" style={{ width: 330 }} label={links ? t("페이지 링크") : t("멘션")}>
      <div className="slash-scroller" ref={listRef} role="listbox">
        {groups.flatMap((group, i) => i ? [<div key={`sep-${i}`} className="mention-sep" />, group] : [group])}
      </div>
    </Popover>
  );
});
