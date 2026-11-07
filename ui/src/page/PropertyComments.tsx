import { t } from '../i18n';
import { useState } from 'react';
import { apply } from '../data/commands';
import { plainText, relativeTime, avatarLetter } from '../data/format';
import { report } from '../data/store';
import type { CommentEntity, PropertyEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/overlay';
import { threadsOf } from './CommentsPane';

// 속성 값 댓글 (comments on a property): a discussion about one property's value on a database page — open
// threads with their replies, a box for a new comment, and resolve / reopen. Stored as page comments that name the
// property (comment.propertyId).

export const propertyThreads = (comments: CommentEntity[], propertyId: string) => comments.filter(comment => comment.propertyId === propertyId && comment.alive !== false);

export function PropertyComments({ anchor, pageId, property, comments, onClose }: { anchor: Element; pageId: string; property: PropertyEntity; comments: CommentEntity[]; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const threads = threadsOf(propertyThreads(comments, property.id));
  const shown = threads.filter(thread => showResolved || !thread.root.resolved);
  const resolvedCount = threads.filter(thread => thread.root.resolved).length;
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    apply([{ type: 'comment.create', parentId: pageId, propertyId: property.id, ...(replyTo ? { threadId: replyTo } : {}), richText: [{ text }] }])
      .then(() => { setDraft(''); setReplyTo(null); }).catch(report);
  };
  return (
    <Popover anchor={anchor} placement="below-start" onClose={onClose} className="property-comments" style={{ width: 340 }} label={t("{0} 댓글", [property.name])}>
      <div className="property-comments-head"><Icon name="comment" size={14} /><span>{t("{0} 댓글", [property.name])}</span>
        {resolvedCount ? <button type="button" className="text-button small" onClick={() => setShowResolved(!showResolved)}>{showResolved ? t("해결된 댓글 숨기기") : t("해결된 댓글 {0}개 보기", [resolvedCount])}</button> : null}
      </div>
      {shown.map(({ root, replies }) => (
        <div key={root.id} className={`property-comment-thread${root.resolved ? ' resolved' : ''}`}>
          {[root, ...replies].map(comment => (
            <div key={comment.id} className={`comments-item${comment.threadId ? ' reply' : ''}`}>
              <span className="avatar">{comment.createdBy === 'user' ? t("avatar|나") : avatarLetter(comment.createdBy)}</span>
              <div className="comments-item-body">
                <div className="comment-meta"><strong>{comment.createdBy === 'user' ? t("나") : comment.createdBy}</strong><span>{relativeTime(comment.createdAt)}</span></div>
                <div className="comment-text">{plainText(comment.richText)}</div>
              </div>
            </div>
          ))}
          <div className="comments-thread-actions">
            <button type="button" className="text-button small" onClick={() => setReplyTo(replyTo === root.id ? null : root.id)}>{replyTo === root.id ? t("취소") : t("답글")}</button>
            <button type="button" className="text-button small" onClick={() => apply([{ type: 'comment.update', id: root.id, resolved: !root.resolved }]).catch(report)}>{root.resolved ? t("다시 열기") : t("해결")}</button>
          </div>
        </div>
      ))}
      <div className="property-comment-new">
        <input className="comment-input" autoFocus value={draft} placeholder={replyTo ? t("답글 달기…") : t("이 값에 댓글 달기…")} aria-label={t("댓글")}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); send(); } }} />
        <button type="button" className="blue-button small" disabled={!draft.trim()} onClick={send}>{t("보내기")}</button>
      </div>
    </Popover>
  );
}
