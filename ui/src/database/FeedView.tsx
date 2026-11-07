import { t } from '../i18n';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { apply, newId } from '../data/commands';
import { report, useWorkspace, workspace } from '../data/store';
import { formatShortDate, plainText } from '../data/format';
import type { BlockEntity, CommentEntity, PageEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { EntityIcon } from '../page/EntityIcon';
import { EmojiPicker } from '../page/PageView';
import { ValueView } from './values';
import { openRow, shownProperties } from './shared';
import { RowMenu } from './RowMenu';
import type { ViewProps } from './TableView';
import { richToFragment } from '../editor/richdom';
import { readViews } from '../page/UpdatesPanel';
import { ReactionGlyph } from '../editor/Discussions';
const attachmentUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;

// Feed: cards at most 752 wide in the middle, 24 apart; r12, shadow
// 0 12px 32px rgba(0,0,0,.02) + a 1px rgba(0,0,0,.05) ring, padding 16. A 24px avatar at (16,18), the
// author 14/500 at (48,20) with the time 12px #a19e99 ("1일 (편집됨)"); the title 26/600 at (48,46); the
// page's text; a reaction button and "댓글 추가…" with a 24px avatar. No properties until chosen.
const me = t("나");

function shortAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("방금");
  if (minutes < 60) return t("{0}분", [minutes]);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{0}시간", [hours]);
  const days = Math.floor(hours / 24);
  if (days < 7) return t("{0}일", [days]);
  const date = new Date(iso);
  return formatShortDate(date);
}

// The post's content as it reads (the feed shows the whole page): text with its formatting, headings, lists,
// to-dos, quotes, callouts, code and pictures; other blocks by name. A long post folds under "더 보기".
function Rich({ runs }: { runs: BlockEntity['richText'] }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { ref.current?.replaceChildren(richToFragment(runs)); }, [JSON.stringify(runs)]);
  return <span ref={ref} />;
}
function FeedBlocks({ parentId, depth = 0, budget }: { parentId: string; depth?: number; budget: { left: number } }): ReactNode {
  if (depth > 6) return null;
  const blocks = workspace.children(parentId).filter(child => child.kind === 'block') as BlockEntity[];
  let number = 0;
  return blocks.map(block => {
    if (budget.left-- <= 0) return null;
    number = block.blockType === 'numbered' ? number + 1 : 0;
    const kids = workspace.children(block.id).some(child => child.kind === 'block') ? <FeedBlocks parentId={block.id} depth={depth + 1} budget={budget} /> : null;
    const text = <Rich runs={block.richText} />;
    let body: ReactNode;
    switch (block.blockType) {
      case 'heading1': case 'heading2': case 'heading3': case 'heading4': body = <div className={`feed-h feed-${block.blockType}`}>{text}</div>; break;
      case 'bullet': body = <div className="feed-li"><span className="feed-marker">•</span>{text}</div>; break;
      case 'numbered': body = <div className="feed-li"><span className="feed-marker">{number}.</span>{text}</div>; break;
      case 'todo': body = <div className={`feed-li${block.checked ? ' done' : ''}`}><span className="feed-marker">{block.checked ? '☑' : '☐'}</span>{text}</div>; break;
      case 'toggle': body = <div className="feed-li"><span className="feed-marker">▸</span>{text}</div>; break;
      case 'quote': body = <blockquote className="feed-quote">{text}</blockquote>; break;
      case 'callout': body = <div className={`feed-callout${block.color ? ` cc-${String(block.color).replace(/_background$/, '')}` : ''}`}><span>{block.icon && !block.icon.includes(':') ? block.icon : '💡'}</span><div>{text}{kids}</div></div>; return <div key={block.id} className="feed-block">{body}</div>;
      case 'code': body = <pre className="feed-code">{plainText(block.richText)}</pre>; break;
      case 'divider': body = <hr className="feed-divider" />; break;
      case 'image': body = block.attachmentId ? <img className="feed-image" src={attachmentUrl(block.attachmentId)} alt={block.alt || plainText(block.richText)} loading="lazy" draggable={false} /> : null; break;
      case 'paragraph': body = plainText(block.richText) ? <p>{text}</p> : null; break;
      default: body = <div className="feed-other">{plainText(block.richText) || ''}</div>;
    }
    return <div key={block.id} className="feed-block" style={depth ? { paddingLeft: 20 } : undefined}>{body}{kids}</div>;
  });
}
function FeedBody({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const element = ref.current; if (element) setTall(element.scrollHeight > 340); });
  if (!workspace.children(pageId).some(child => child.kind === 'block')) return null;
  return (
    <>
      <div ref={ref} className={`feed-text${tall && !open ? ' folded' : ''}`}><FeedBlocks parentId={pageId} budget={{ left: 200 }} /></div>
      {tall ? <button type="button" className="feed-read-more" onClick={() => setOpen(!open)}>{open ? t("접기") : t("더 보기")}</button> : null}
    </>
  );
}

export function FeedView({ result, view }: ViewProps) {
  const ws = useWorkspace();
  const config = view?.config ?? {};
  const [limit, setLimit] = useState(config.loadLimit ?? 10);
  const properties = shownProperties(result).filter(property => property.type !== 'title');
  const rows = result.rows.slice(0, limit);
  const [menu, setMenu] = useState<{ anchor: Element; rowId: string } | null>(null);
  const ordered = result.rows.map(row => row.id);
  return (
    <div className="feed-view">
      {rows.map(row => {
        const page = ws.get<PageEntity>(row.id);
        if (!page) return null;
        const edited = Date.parse(page.updatedAt) - Date.parse(page.createdAt) > 60000;
        return (
          <article key={row.id} className="feed-card" onClick={event => { if ((event.target as Element).closest('button, input, a, .feed-comment-box')) return; openRow(view, row.id, ordered, { side: event.altKey }); }}>
            {config.showAuthor !== false ? (
              <div className="feed-card-head">
                <span className="avatar feed-avatar">{t("avatar|나")}</span>
                <span className="feed-author">{page.createdBy && page.createdBy !== 'user' ? page.createdBy : me}</span>
                <span className="feed-time">{shortAgo(page.createdAt)}</span>{edited ? <span className="feed-time">{t("(편집됨)")}</span> : null}
                {/* 조회 (this browser's page views, the same count as 업데이트 › 분석). */}
                {(readViews()[row.id]?.length ?? 0) > 0 ? <span className="feed-time feed-views"><Icon name="eye" size={12} />{t("조회 {0}회", [readViews()[row.id].length])}</span> : null}
              </div>
            ) : null}
            <div className="feed-card-actions">
              <ReactButton page={page} className="feed-action" />
              <button type="button" className="feed-action" aria-label={t("더 보기")} title={t("더 보기")} onClick={event => { event.stopPropagation(); setMenu({ anchor: event.currentTarget, rowId: row.id }); }}><Icon name="more" size={16} /></button>
            </div>
            <div className="feed-card-body">
              <h3 className="feed-title">{config.showPageIcon !== false && page.icon ? <span className="feed-title-icon"><EntityIcon item={page} size={26} /></span> : null}<span>{row.title || t("제목 없음")}</span></h3>
              {properties.length ? (
                <div className={`feed-fields${config.wrapProperties ? ' wrap' : ''}`}>
                  {properties.map(property => { const value = row.values[property.id]; return value == null || value === '' || (Array.isArray(value) && !value.length) ? null : <span key={property.id} className="feed-field"><ValueView property={property} value={value} row={row} mode="card" /></span>; })}
                </div>
              ) : null}
              <FeedBody pageId={row.id} />
              <Reactions page={page} />
              <Comments pageId={page.id} />
            </div>
          </article>
        );
      })}
      {result.rows.length > limit ? <button type="button" className="feed-more" onClick={() => setLimit(limit + (config.loadLimit ?? 10))}>{t("더 불러오기")}</button> : null}
      {!result.rows.length ? <div className="feed-empty">{t("게시물이 없습니다")}</div> : null}
      {menu ? <RowMenu anchor={menu.anchor} rowId={menu.rowId} view={view} orderedIds={ordered} placement="below-end" onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

// The smiley-with-plus button: an emoji picker that adds a reaction (the card's pill and its hover toolbar).
function ReactButton({ page, className }: { page: PageEntity; className: string }) {
  const [picker, setPicker] = useState<Element | null>(null);
  const reactions = page.reactions ?? [];
  return (
    <>
      <button type="button" className={className} aria-label={t("반응 추가")} title={t("반응 추가")} onClick={event => { event.stopPropagation(); setPicker(event.currentTarget); }}><Icon name="emoji-add" size={20} /></button>
      {picker ? <EmojiPicker anchor={picker} onClose={() => setPicker(null)} onPick={emoji => { setPicker(null); if (!emoji.startsWith('icon:') && !reactions.includes(emoji)) apply([{ type: 'page.update', id: page.id, reactions: [...reactions, emoji] }]).catch(report); }} /> : null}
    </>
  );
}

function Reactions({ page }: { page: PageEntity }) {
  const reactions = page.reactions ?? [];
  const toggle = (emoji: string) => apply([{ type: 'page.update', id: page.id, reactions: reactions.includes(emoji) ? reactions.filter(item => item !== emoji) : [...reactions, emoji] }]).catch(report);
  return (
    <div className="feed-reactions">
      {reactions.map(emoji => <button type="button" key={emoji} className="feed-reaction mine" onClick={() => toggle(emoji)} title={t("반응 취소")}><span><ReactionGlyph emoji={emoji} /></span><span>1</span></button>)}
      <ReactButton page={page} className="feed-react" />
    </div>
  );
}

function Comments({ pageId }: { pageId: string }) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<string | null>(null);
  const comments = ws.snapshot.objects.filter(item => item.kind === 'comment' && item.parentId === pageId && item.alive) as CommentEntity[];
  const send = () => {
    const text = (draft ?? '').trim();
    if (!text) { setDraft(null); return; }
    apply([{ type: 'comment.create', id: newId(), parentId: pageId, richText: [{ text }] }]).then(() => setDraft(null)).catch(report);
  };
  return (
    <div className="feed-comments">
      {comments.slice(-2).map(comment => (
        <div key={comment.id} className="feed-comment">
          <span className="avatar feed-avatar">{t("avatar|나")}</span>
          <div><span className="feed-author small">{comment.createdBy && comment.createdBy !== 'user' ? comment.createdBy : me}</span><span className="feed-time">{shortAgo(comment.createdAt)}</span><div className="feed-comment-text">{plainText(comment.richText)}</div></div>
        </div>
      ))}
      <div className="feed-comment-box" onClick={() => { if (draft === null) setDraft(''); }}>
        <span className="avatar feed-avatar">{t("avatar|나")}</span>
        {draft === null ? <span className="feed-comment-placeholder">{t("댓글 추가…")}</span> : (
          <input autoFocus className="feed-comment-input" value={draft} placeholder={t("댓글 추가…")} aria-label={t("댓글 추가")}
            onChange={event => setDraft(event.target.value)} onBlur={() => { if (!draft) setDraft(null); }}
            onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); send(); } if (event.key === 'Escape') setDraft(null); }} />
        )}
        {draft ? <button type="button" className="feed-comment-send" aria-label={t("보내기")} onClick={send}><Icon name="arrow-up" size={14} /></button> : null}
      </div>
    </div>
  );
}
