import { intlLocale, t, tx } from '../i18n';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api, readLocal, storeLocal } from '../data/api';
import { apply, newId } from '../data/commands';
import { formatMonthDay, relativeTime, avatarLetter } from '../data/format';
import { useRoute } from '../data/router';
import { report, useWorkspace } from '../data/store';
import type { BlockType, PageEntity, PropertyEntity, RichText } from '../data/types';
import { propertyIcon, ValueView } from '../database/values';
import { openWorkspaceDialog } from '../dialogs/registry';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { CommentsPane } from './CommentsPane';

// 업데이트 및 분석 (page ⋯): a 385-wide panel down the right of the frame (white,
// 1px rgba(42,28,0,.07) on its left, the top bar running over it with "≫" at 9,10). Under the top bar a 53-high tab
// strip (padding 0 6, 1px line under it): 28-high r6 tabs (padding 0 8, 14px; the other tab rgb(142,139,134)) with a 2px
// line under the text of the chosen one. 업데이트 lists the page's edits — avatar 24 at 20,14, "회원님이 <페이지>
// 페이지를 편집했습니다" (14px, the name 600), "1일 전 · <경로>" (12px rgb(161,158,153)), a 24 clock button at the right
// (that version), then what changed: property names (icon + 12px gray) over their values, the title and added blocks
// in rgb(39,131,222) on rgba(0,124,215,.094) / rgba(35,131,226,.14), four blocks then "그 외 N개 더 보기"; a comment
// shows the commented text (rgba(255,203,0,.12), 2px rgba(255,203,0,.35) under it), the comment and "답글" (32 high,
// 1px rgba(28,19,1,.11), r6). Entries are split by 1px lines. 분석: 조회수 (총 N회) with a period button (24 high,
// r32, rgba(0,124,215,.13), blue), an area chart (views rgb(231,243,248) / rgb(39,131,222), unique viewers
// rgb(251,243,219) / rgba(215,150,9,.75)), 조회한 사람, and 작성자 / 최근 업데이트한 사람 with avatars 18.

type Tab = 'updates' | 'comments' | 'analytics';
let panel: { open: boolean; tab: Tab } = { open: false, tab: readLocal<Tab>('pageyard-updates-tab', 'updates') };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function openUpdatesPanel(tab?: Tab) { panel = { open: true, tab: tab ?? panel.tab }; emit(); }
export function closeUpdatesPanel() { if (panel.open) { panel = { ...panel, open: false }; emit(); } }
function setTab(tab: Tab) { panel = { ...panel, tab }; storeLocal('pageyard-updates-tab', JSON.stringify(tab)); emit(); }
export function useUpdatesPanel() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => panel);
}

// ---------- page views (this browser) ----------
const VIEWS_KEY = 'pageyard-page-views-v1';
type Views = Record<string, number[]>;
export const readViews = (): Views => readLocal<Views>(VIEWS_KEY, {});
export function recordPageView(pageId: string) {
  const views = readViews();
  const list = views[pageId] ?? [];
  // Opening the same page again within a few seconds (a re-render, a peek turning into the page) is one view.
  if (list.length && Date.now() - list[list.length - 1] < 5000) return;
  views[pageId] = [...list, Date.now()].slice(-1000);
  storeLocal(VIEWS_KEY, JSON.stringify(views));
}

// ---------- the engine's update list ----------
interface UpdateEntry {
  kind: 'edit' | 'create' | 'comment'; actor: string; at: string; since?: string; revision: number; firstRevision?: number;
  title?: { before: string; after: string } | null;
  properties?: Array<{ propertyId: string; before: unknown; after: unknown }>;
  blocks?: Array<{ id: string; change: 'added' | 'removed' | 'edited'; blockType: BlockType; checked: boolean | null; richText: RichText; beforeRichText: RichText | null }>;
  comment?: { id: string; threadId: string | null; parentId: string; richText: RichText; alive: boolean; resolved: boolean; edited: boolean; anchor: Array<{ text: string }> } | null;
}

const actorName = (actor: string) => actor === 'user' ? t("나") : actor === 'automation' ? t("자동화") : actor === 'scheduler' ? t("예약 실행") : actor;
const plain = (runs: RichText | null | undefined) => (runs ?? []).map(run => run.text).join('');

function Runs({ runs }: { runs: RichText }) {
  return <>{runs.map((run, index) => {
    const className = [run.bold && 'b', run.italic && 'i', run.underline && 'u', run.strike && 's', run.code && 'code', run.href && 'link', run.color && run.color !== 'default' && `text-${run.color}`].filter(Boolean).join(' ');
    return <span key={index} className={className || undefined}>{run.text}</span>;
  })}</>;
}

export function UpdatesPanel() {
  const state = useUpdatesPanel();
  const route = useRoute();
  const ws = useWorkspace();
  const pageId = route.id && ws.get(route.id)?.kind === 'page' ? route.id : null;
  useEffect(() => { closeUpdatesPanel(); }, [route.id]);
  if (!state.open || !pageId) return null;
  return (
    <aside className="updates-panel" aria-label={t("업데이트 및 분석")}>
      <button type="button" className="icon-button updates-close" aria-label={t("닫기")} title={t("닫기")} onClick={closeUpdatesPanel}><Icon name="double-chevron-right" size={16} /></button>
      <div className="updates-tabs" role="tablist">
        {(['updates', 'comments', 'analytics'] as const).map(tab => (
          <button type="button" key={tab} role="tab" aria-selected={state.tab === tab} className={`updates-tab${state.tab === tab ? ' active' : ''}`} onClick={() => setTab(tab)}>
            <span>{tab === 'updates' ? t("업데이트") : tab === 'comments' ? t("댓글") : t("분석")}</span>
          </button>
        ))}
      </div>
      <div className="updates-body">
        {state.tab === 'updates' ? <UpdatesList pageId={pageId} /> : state.tab === 'comments' ? <CommentsPane pageId={pageId} /> : <Analytics pageId={pageId} />}
      </div>
    </aside>
  );
}

function UpdatesList({ pageId }: { pageId: string }) {
  const ws = useWorkspace();
  const [entries, setEntries] = useState<UpdateEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => api<{ entries: UpdateEntry[] }>(`/api/updates?pageId=${encodeURIComponent(pageId)}&limit=40`).then(data => { if (live) setEntries(data.entries); }).catch(report), entries ? 300 : 0);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, ws.version]);
  if (!entries) return null;
  if (!entries.length) return <div className="updates-empty">{t("아직 업데이트가 없습니다")}</div>;
  return <>{entries.map(entry => <UpdateItem key={`${entry.kind}-${entry.revision}-${entry.comment?.id ?? ''}`} pageId={pageId} entry={entry} />)}</>;
}

function UpdateItem({ pageId, entry }: { pageId: string; entry: UpdateEntry }) {
  const ws = useWorkspace();
  const page = ws.get<PageEntity>(pageId);
  const [more, setMore] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const trail = ws.ancestry(pageId).slice(0, -1).map(item => (item as { title?: string; name?: string }).title || (item as { name?: string }).name || t("새 페이지"));
  const path = trail.length > 2 ? [trail[0], '…', trail[trail.length - 1]] : trail;
  const title = page?.title || t("새 페이지");
  const name = <b>{title}</b>;
  const head = entry.actor === 'user'
    ? (entry.kind === 'comment' ? tx("회원님이 {0} 페이지에 댓글을 남겼습니다", [name]) : entry.kind === 'create' ? tx("회원님이 {0} 페이지를 만들었습니다", [name]) : tx("회원님이 {0} 페이지를 편집했습니다", [name]))
    : (entry.kind === 'comment' ? tx("{0}이(가) {1} 페이지에 댓글을 남겼습니다", [actorName(entry.actor), name]) : entry.kind === 'create' ? tx("{0}이(가) {1} 페이지를 만들었습니다", [actorName(entry.actor), name]) : tx("{0}이(가) {1} 페이지를 편집했습니다", [actorName(entry.actor), name]));
  const schema = page?.sourceId ? ws.schema(page.sourceId) : [];
  const created = entry.kind === 'create';
  const blocks = entry.blocks ?? [];
  const shownBlocks = more ? blocks : blocks.slice(0, 4);
  const sendReply = () => {
    const text = reply?.trim();
    if (!text || !entry.comment) return;
    apply([{ type: 'comment.create', id: newId(), parentId: entry.comment.parentId, threadId: entry.comment.threadId ?? entry.comment.id, richText: [{ text }] }]).then(() => setReply(null)).catch(report);
  };
  return (
    <section className="update-item">
      <span className="avatar update-avatar">{avatarLetter(actorName(entry.actor))}</span>
      <div className="update-main">
        <div className="update-head">{head}</div>
        <div className="update-meta" title={new Date(entry.at).toLocaleString(intlLocale)}>{relativeTime(entry.at)}{path.length ? <> · {path.join(' / ')}</> : null}</div>
        {entry.kind !== 'comment' ? <button type="button" className="icon-button update-version" aria-label={t("이 버전 보기")} title={t("이 버전 보기")} onClick={() => openWorkspaceDialog('versions', { pageId, revision: entry.revision })}><Icon name="clock" size={16} /></button> : null}
        <div className="update-changes">
          {entry.comment ? (
            <>
              {entry.comment.anchor.length ? <div className="update-anchor"><span>{entry.comment.anchor.map(run => run.text).join('')}</span></div> : null}
              <div className="update-comment">
                <div className="update-comment-author">{entry.actor === 'user' ? t("나") : entry.actor}</div>
                <div className="update-comment-text"><Runs runs={entry.comment.richText} />{entry.comment.edited ? <span className="update-edited">{" "}{t("(편집됨)")}</span> : null}</div>
              </div>
              {reply === null ? <button type="button" className="update-reply" onClick={() => setReply('')}>{t("답글")}</button> : (
                <div className="update-reply-box">
                  <input className="text-input" autoFocus value={reply} placeholder={t("답글 추가…")} aria-label={t("답글")} onChange={event => setReply(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); sendReply(); } else if (event.key === 'Escape') setReply(null); }} />
                  <button type="button" className="blue-button small" disabled={!reply.trim()} onClick={sendReply}>{t("보내기")}</button>
                </div>
              )}
            </>
          ) : null}
          {entry.title ? (
            <div className="update-property">
              <div className="update-property-name"><Icon name="type-title" size={16} /><span>{t("제목")}</span></div>
              <div className="update-property-value">
                {entry.title.before && !created ? <span className="update-removed">{entry.title.before}</span> : null}
                {entry.title.after ? <span className="update-added">{entry.title.after}</span> : null}
              </div>
            </div>
          ) : null}
          {(entry.properties ?? []).map(change => {
            const property = schema.find(item => item.id === change.propertyId);
            if (!property) return null;
            const raw = { ...property, numberFormat: undefined } as PropertyEntity;
            const empty = (value: unknown) => value == null || value === '' || (Array.isArray(value) && !value.length);
            return (
              <div key={change.propertyId} className="update-property">
                <div className="update-property-name"><Icon name={propertyIcon(property.type)} size={16} /><span>{property.name}</span></div>
                <div className="update-property-value">
                  {!created ? <>{empty(change.before) ? <span className="update-empty">{t("비어 있음")}</span> : <ValueView property={raw} value={change.before} mode="card" />}<Icon name="chevron-right" size={14} className="update-arrow" /></> : null}
                  {empty(change.after) ? <span className="update-empty">{t("비어 있음")}</span> : <ValueView property={raw} value={change.after} mode="card" />}
                </div>
              </div>
            );
          })}
          {shownBlocks.map(block => (
            <div key={block.id} className={`update-block type-${block.blockType} ${block.change}`}>
              {block.blockType === 'todo' ? <span className={`update-check${block.checked ? ' on' : ''}`} /> : null}
              {block.blockType === 'bullet' ? <span className="update-bullet">•</span> : null}
              {block.blockType === 'divider' ? <hr /> : null}
              {block.change === 'edited' ? <><span className="update-removed">{plain(block.beforeRichText)}</span> <Runs runs={block.richText} /></> : <Runs runs={block.richText} />}
              {!plain(block.richText) && block.blockType !== 'divider' ? <span className="update-blank">{block.blockType === 'image' ? t("이미지") : block.blockType === 'file' ? t("파일") : t("빈 블록")}</span> : null}
            </div>
          ))}
          {blocks.length > 4 && !more ? <button type="button" className="update-more" onClick={() => setMore(true)}>{t("그 외 {0}개 더 보기", [blocks.length - 4])}</button> : null}
        </div>
      </div>
    </section>
  );
}

// ---------- 분석 ----------
type Period = 7 | 28 | 90 | 0;
const periodLabel = (period: Period) => period ? t("지난 {0}일", [period]) : t("전체 기간");
const DAY = 86400000;
const dayStart = (time: number) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };

function Analytics({ pageId }: { pageId: string }) {
  const ws = useWorkspace();
  const page = ws.get<PageEntity>(pageId);
  const [period, setPeriod] = useState<Period>(() => readLocal<Period>('pageyard-analytics-period', 28));
  const [menu, setMenu] = useState<Element | null>(null);
  const views = useMemo(() => readViews()[pageId] ?? [], [pageId, ws.version]);
  const today = dayStart(Date.now());
  const from = Math.max(period ? today - (period - 1) * DAY : 0, dayStart(Date.parse(page?.createdAt ?? '') || today), views.length ? Math.min(dayStart(views[0]), today) : today);
  const days: number[] = [];
  for (let day = from; day <= today; day += DAY) days.push(day);
  const counts = days.map(day => views.filter(time => time >= day && time < day + DAY).length);
  const inPeriod = views.filter(time => time >= from).length;
  const last = views.length ? views[views.length - 1] : null;
  const creator = page?.createdBy === 'user' || !page?.createdBy ? t("나") : page.createdBy;
  const editor = page?.updatedBy === 'user' || !page?.updatedBy ? t("나") : page.updatedBy;
  return (
    <div className="analytics">
      <div className="analytics-head">
        <div className="analytics-title"><span>{t("조회수")}</span><span className="analytics-total">{t("(총 {0}회)", [inPeriod])}</span></div>
        <button type="button" className="analytics-period" onClick={event => setMenu(event.currentTarget)}><Icon name="calendar" size={14} /><span>{periodLabel(period)}</span><Icon name="chevron-down" size={10} /></button>
      </div>
      <ViewsChart days={days} counts={counts} />
      <div className="analytics-section">{t("조회한 사람")}</div>
      {last ? <div className="analytics-person"><span className="avatar">{t("avatar|나")}</span><span className="analytics-name">{t("나")}</span><span className="analytics-when">{relativeTime(new Date(last).toISOString())}</span></div> : <div className="analytics-none">{t("아직 조회 기록이 없습니다")}</div>}
      <div className="analytics-section">{t("업데이트한 사람")}</div>
      <div className="analytics-label">{t("작성자:")}</div>
      <div className="analytics-person"><span className="avatar">{avatarLetter(creator)}</span><span className="analytics-name">{creator}</span><span className="analytics-when">{page ? relativeTime(page.createdAt) : ''}</span></div>
      <div className="analytics-label">{t("최근 업데이트한 사람")}</div>
      <div className="analytics-person"><span className="avatar">{avatarLetter(editor)}</span><span className="analytics-name">{editor}</span><span className="analytics-when">{page ? relativeTime(page.updatedAt) : ''}</span></div>
      {menu ? <Menu anchor={menu} placement="below-end" width={125} onClose={() => setMenu(null)} entries={([7, 28, 90, 0] as Period[]).map(value => ({ label: periodLabel(value), checked: value === period, onSelect: () => { setPeriod(value); storeLocal('pageyard-analytics-period', JSON.stringify(value)); } }))} /> : null}
    </div>
  );
}

// 353×175: the plot runs from 26 to the right edge less 24, 8 down to 25 above the bottom; ticks 10 long, labels 12px.
function ViewsChart({ days, counts }: { days: number[]; counts: number[] }) {
  const width = 353, height = 175, left = 26, right = 24, top = 8, bottom = 25;
  const plotW = width - left - right, plotH = height - top - bottom;
  const max = Math.max(1, ...counts);
  const step = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5 / 5) * 5;
  const ceiling = Math.ceil(max / step) * step;
  const ticks: number[] = []; for (let value = step; value <= ceiling; value += step) ticks.push(value);
  const x = (index: number) => left + (days.length <= 1 ? plotW : index * plotW / (days.length - 1));
  const y = (value: number) => top + plotH - value / ceiling * plotH;
  const series = (values: number[]) => {
    const points = days.length <= 1 ? [[left, y(values[0] ?? 0)], [left + plotW, y(values[0] ?? 0)]] : values.map((value, index) => [x(index), y(value)]);
    const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    return { line, area: `${line}L${points[points.length - 1][0].toFixed(1)},${top + plotH}L${points[0][0].toFixed(1)},${top + plotH}Z` };
  };
  const total = series(counts), unique = series(counts.map(count => count ? 1 : 0));
  const label = (time: number) => formatMonthDay(new Date(time));
  return (
    <svg className="analytics-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("조회수 차트")}>
      <path className="series-views" d={total.area} />
      <path className="series-unique" d={unique.area} />
      {ticks.map(value => <g key={value}><line className="tick" x1={left - 10} x2={left} y1={y(value)} y2={y(value)} /><text x={left - 12} y={y(value) + 4} textAnchor="end">{value}</text></g>)}
      <line className="axis" x1={left} x2={left} y1={top} y2={top + plotH} />
      <line className="axis" x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} />
      <line className="tick" x1={left} x2={left} y1={top + plotH} y2={top + plotH + 10} />
      <text x={left} y={height - 2} textAnchor="middle">{label(days[0] ?? Date.now())}</text>
      {days.length > 1 ? <><line className="tick" x1={left + plotW} x2={left + plotW} y1={top + plotH} y2={top + plotH + 10} /><text x={left + plotW} y={height - 2} textAnchor="middle">{label(days[days.length - 1])}</text></> : null}
    </svg>
  );
}
