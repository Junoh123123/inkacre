import { t } from '../i18n';
import { useState } from 'react';
import { apply } from '../data/commands';
import { plainText, relativeTime, avatarLetter } from '../data/format';
import { usePageDetail } from '../data/hooks';
import { report, useWorkspace } from '../data/store';
import type { CommentEntity, PropertyEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { ReactionGlyph } from '../editor/Discussions';

// 댓글 창 (the comments sidebar): every discussion on the page — on the page itself and on its blocks — as
// threads (the first comment and its replies), filtered to open or resolved ones. A click on a block discussion
// scrolls to its block; each thread can be answered, resolved or reopened here.

type Filter = 'open' | 'resolved' | 'all';

export function threadsOf(comments: CommentEntity[]) {
  const roots = comments.filter(comment => !comment.threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return roots.map(root => ({ root, replies: comments.filter(comment => comment.threadId === root.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }));
}
const who = (actor: string) => actor === 'user' ? t("나") : actor;

export function CommentsPane({ pageId }: { pageId: string }) {
  const ws = useWorkspace();
  const { detail } = usePageDetail(pageId);
  const [filter, setFilter] = useState<Filter>('open');
  const [replying, setReplying] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const comments = (detail?.entity.comments ?? []).filter(comment => comment.alive !== false);
  const threads = threadsOf(comments).filter(thread => filter === 'all' || (filter === 'resolved' ? !!thread.root.resolved : !thread.root.resolved));
  const target = (comment: CommentEntity) => comment.parentId === pageId ? null : ws.get(comment.parentId) as { richText?: Array<{ text: string }> } | undefined;
  const jump = (comment: CommentEntity) => {
    if (comment.propertyId) { const row = document.querySelector(`.property-row[data-property-id="${CSS.escape(comment.propertyId)}"]`); row?.scrollIntoView({ block: 'center', behavior: 'smooth' }); row?.classList.add('comment-flash'); window.setTimeout(() => row?.classList.remove('comment-flash'), 1200); return; }
    if (comment.parentId === pageId) { document.querySelector('.page-comments')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const element = document.querySelector(`[data-block-id="${CSS.escape(comment.parentId ?? '')}"]`);
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element?.classList.add('comment-flash');
    window.setTimeout(() => element?.classList.remove('comment-flash'), 1200);
  };
  const send = (root: CommentEntity) => {
    const text = draft.trim();
    if (!text) return;
    apply([{ type: 'comment.create', parentId: root.parentId!, threadId: root.id, richText: [{ text }] }]).then(() => { setDraft(''); setReplying(null); }).catch(report);
  };
  return (
    <div className="comments-pane">
      <div className="comments-pane-filters" role="tablist">
        {(['open', 'resolved', 'all'] as const).map(value => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={`filter-chip${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)}>
            {value === 'open' ? t("열린 댓글") : value === 'resolved' ? t("해결된 댓글") : t("모두")}
          </button>
        ))}
      </div>
      {!threads.length ? <div className="updates-empty">{filter === 'resolved' ? t("해결된 댓글이 없습니다") : t("댓글이 없습니다")}</div> : null}
      {threads.map(({ root, replies }) => {
        const on = target(root);
        return (
          <section key={root.id} className={`comments-thread${root.resolved ? ' resolved' : ''}`} data-thread-id={root.id}>
            <button type="button" className="comments-thread-target" onClick={() => jump(root)}>
              {root.propertyId ? <><Icon name="property-edit" size={14} /><span>{t("속성 댓글 · {0}", [ws.get<PropertyEntity>(root.propertyId)?.name ?? t("삭제된 속성")])}</span></>
                : <><Icon name={on ? 'text-block' : 'page'} size={14} /><span>{on ? (plainText(on.richText as never).slice(0, 60) || t("블록")) : t("페이지 댓글")}</span></>}
            </button>
            {[root, ...replies].map(comment => (
              <div key={comment.id} className="comments-item">
                <span className="avatar">{comment.createdBy === 'user' ? t("avatar|나") : avatarLetter(comment.createdBy)}</span>
                <div className="comments-item-body">
                  <div className="comment-meta"><strong>{who(comment.createdBy)}</strong><span>{relativeTime(comment.createdAt)}</span></div>
                  <div className="comment-text">{plainText(comment.richText) || (comment.reactions ?? []).map(emoji => <ReactionGlyph key={emoji} emoji={emoji} />)}</div>
                </div>
              </div>
            ))}
            <div className="comments-thread-actions">
              {replying === root.id ? (
                <div className="comments-reply">
                  <input className="comment-input" autoFocus placeholder={t("답글 달기…")} value={draft} onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); send(root); } else if (event.key === 'Escape') { setReplying(null); setDraft(''); } }} />
                  <button type="button" className="blue-button small" disabled={!draft.trim()} onClick={() => send(root)}>{t("보내기")}</button>
                </div>
              ) : <button type="button" className="text-button small" onClick={() => { setReplying(root.id); setDraft(''); }}>{t("답글")}</button>}
              <button type="button" className="text-button small" onClick={() => apply([{ type: 'comment.update', id: root.id, resolved: !root.resolved }]).catch(report)}>{root.resolved ? t("다시 열기") : t("해결")}</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
