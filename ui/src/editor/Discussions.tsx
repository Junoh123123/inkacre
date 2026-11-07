import { t } from '../i18n';
import { isSendKey } from '../data/settings';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';
import { useWorkspace, workspace, report, setStatus } from '../data/store';
import { apply } from '../data/commands';
import { relativeTime, avatarLetter } from '../data/format';
import type { CommentEntity, RichText } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { Popover } from '../ui/overlay';
import { confirmSmall } from '../ui/primitives';
import { EmojiPicker } from '../page/PageView';
import type { PageSync } from './sync';

// Discussions on blocks and on text:
// - the text a discussion is about is underlined in yellow (rgba(255,203,0,.12) fill, 2px
//   rgba(255,203,0,.35) underline; .24 / solid while the discussion is open or being written);
// - cards sit in the right margin 32px from the text column, 308 wide, top 13px above the
//   block, and slide 20px towards the text while open (white, shadow, reply field);
// - without room in the margin the block shows a count bubble that opens the same card.

type Pending = { blockId: string; from: number; to: number } | { blockId: string; from?: undefined; to?: undefined };
interface Meta { open?: Set<string>; blockThreads?: Map<string, string[]>; active?: string | null; pending?: Pending | null }
interface PluginState { open: Set<string>; blockThreads: Map<string, string[]>; active: string | null; pending: Pending | null; decorations: DecorationSet }

export const discussionKey = new PluginKey<PluginState>('discussions');

const isCommentMark = (mark: { type: unknown }) => mark.type === schema.marks.comment;

function blockOf(doc: PMNode, id: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs?.id === id) { found = { node, pos }; return false; }
    return !node.isTextblock;
  });
  return found;
}

function build(doc: PMNode, state: Omit<PluginState, 'decorations'>): DecorationSet {
  const decorations: Decoration[] = [];
  const cls = (ids: string[], pending = false) => `comment-highlight${pending || (state.active && ids.includes(state.active)) ? ' active' : ''}`;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const ids = state.blockThreads.get(node.attrs.id);
      if (ids?.length && node.content.size) decorations.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: cls(ids), 'data-thread': ids[0] }));
      return true;
    }
    if (node.isText) {
      const ids = node.marks.filter(mark => isCommentMark(mark) && state.open.has(mark.attrs.id)).map(mark => mark.attrs.id as string);
      if (ids.length) decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: cls(ids), 'data-thread': ids.find(id => id === state.active) ?? ids[0] }));
    }
    return true;
  });
  const pending = state.pending;
  if (pending) {
    if (pending.from !== undefined && pending.to > pending.from) decorations.push(Decoration.inline(pending.from, pending.to, { class: cls([], true) }));
    else {
      const block = blockOf(doc, pending.blockId);
      if (block && block.node.content.size) decorations.push(Decoration.inline(block.pos + 1, block.pos + block.node.nodeSize - 1, { class: cls([], true) }));
    }
  }
  return DecorationSet.create(doc, decorations);
}

type Listener = () => void;
const listeners = new WeakMap<EditorView, Set<Listener>>();
const starters = new WeakMap<EditorView, (target: Pending) => void>();
const clickers = new WeakMap<EditorView, (threadId: string | null) => void>();

export const discussionPlugin = new Plugin<PluginState>({
  key: discussionKey,
  state: {
    init: (_, editorState) => ({ open: new Set(), blockThreads: new Map(), active: null, pending: null, decorations: DecorationSet.create(editorState.doc, []) }),
    apply(tr: Transaction, value: PluginState, _old: EditorState, next: EditorState) {
      const meta = tr.getMeta(discussionKey) as Meta | undefined;
      if (!meta && !tr.docChanged) return value;
      let pending = meta && 'pending' in meta ? meta.pending ?? null : value.pending;
      if (pending?.from !== undefined && tr.docChanged && !(meta && 'pending' in meta)) {
        const from = tr.mapping.map(pending.from, 1), to = tr.mapping.map(pending.to, -1);
        pending = to > from ? { ...pending, from, to } : { blockId: pending.blockId };
      }
      const state = { open: meta?.open ?? value.open, blockThreads: meta?.blockThreads ?? value.blockThreads, active: meta && 'active' in meta ? meta.active ?? null : value.active, pending };
      return { ...state, decorations: build(next.doc, state) };
    },
  },
  props: {
    decorations: state => discussionKey.getState(state)?.decorations,
    handleDOMEvents: {
      mousedown(view, event) {
        const target = (event.target as HTMLElement).closest?.('[data-thread]') as HTMLElement | null;
        clickers.get(view)?.(target?.dataset.thread ?? null);
        return false;
      },
    },
  },
  view(editorView) {
    return { update: () => listeners.get(editorView)?.forEach(listener => listener()) };
  },
});

/** Opens the composer for a new discussion on a block or on the selected text of one block. */
export function startComment(view: EditorView, blockId: string, range?: { from: number; to: number }) {
  const start = starters.get(view);
  if (!start) return false;
  if (range && range.to > range.from) {
    // Keep to the first block of the selection.
    const block = blockOf(view.state.doc, blockId);
    const end = block ? block.pos + block.node.nodeSize - 1 : range.to;
    start({ blockId, from: range.from, to: Math.min(range.to, end) });
  } else start({ blockId });
  return true;
}

/** "고른 글에 반응": a thread on the selected text holding just the emoji. */
export async function reactToSelection(view: EditorView, blockId: string, range: { from: number; to: number }, emoji: string) {
  const host = view.dom.closest<HTMLElement>('[data-page-id]');
  await (host as unknown as { __sync?: PageSync } | null)?.__sync?.flush();
  const block = blockOf(view.state.doc, blockId);
  const to = block ? Math.min(range.to, block.pos + block.node.nodeSize - 1) : range.to;
  const id = crypto.randomUUID();
  await apply([{ type: 'comment.create', id, parentId: blockId, richText: [], reactions: [emoji] }]);
  if (to > range.from) view.dispatch(view.state.tr.addMark(range.from, to, schema.marks.comment.create({ id })).setMeta('addToHistory', false));
}

// ---------- reactions ----------

// A reaction: an emoji, or a custom emoji (사용자 지정 이모지, "attachment:<id>") as its picture.
export function ReactionGlyph({ emoji }: { emoji: string }) {
  if (!emoji.startsWith('attachment:')) return <>{emoji}</>;
  const name = Object.entries(workspace.customEmoji()).find(([, id]) => id === emoji.slice(11))?.[0];
  return <img className="custom-emoji-reaction" src={`/api/attachments/${encodeURIComponent(emoji.slice(11))}`} alt={name ? `:${name}:` : ''} width={16} height={16} />;
}

// A reaction pill: r100, padding 2 8, the emoji 16px then the count 12/500 in blue
// on rgba(0,124,215,.094) (yours). Pressing yours takes it back; a thread that was only that reaction goes.
function Reactions({ comment, lonely }: { comment: CommentEntity; lonely?: boolean }) {
  const list = comment.reactions ?? [];
  if (!list.length) return null;
  const toggle = (emoji: string) => {
    const next = list.filter(item => item !== emoji);
    const operation = !next.length && lonely && !plain(comment.richText).trim() ? { type: 'node.trash', id: comment.id } : { type: 'comment.update', id: comment.id, reactions: next };
    apply([operation as never]).catch(report);
  };
  return (
    <div className="reaction-row">
      {list.map(emoji => (
        <button key={emoji} type="button" className="reaction-chip mine" title={t("반응 취소")} onMouseDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); toggle(emoji); }}>
          <span className="reaction-emoji"><ReactionGlyph emoji={emoji} /></span><span className="reaction-count">1</span>
        </button>
      ))}
    </div>
  );
}

function AddReaction({ comment, className = 'discussion-tool' }: { comment: CommentEntity; className?: string }) {
  const [picker, setPicker] = useState<Element | null>(null);
  const add = (emoji: string) => {
    const list = comment.reactions ?? [];
    if (emoji.startsWith('icon:') || list.includes(emoji)) return;
    apply([{ type: 'comment.update', id: comment.id, reactions: [...list, emoji] }]).catch(report);
  };
  return (
    <>
      <button type="button" className={className} aria-label={t("반응 추가")} title={t("반응 추가")} onClick={event => { event.stopPropagation(); setPicker(event.currentTarget); }}><Icon name="emoji-add" size={16} /></button>
      {picker ? <EmojiPicker anchor={picker} emojiOnly customReactions onClose={() => setPicker(null)} onPick={emoji => { setPicker(null); add(emoji); }} /> : null}
    </>
  );
}

// ---------- threads ----------

interface Thread { root: CommentEntity; replies: CommentEntity[]; blockId: string }

function threadsFor(blockIds: string[]): Thread[] {
  const result: Thread[] = [];
  for (const blockId of blockIds) {
    const comments = workspace.children(blockId).filter(item => item.kind === 'comment' && item.alive !== false) as CommentEntity[];
    if (!comments.length) continue;
    const roots = comments.filter(comment => !comment.threadId || !comments.some(other => other.id === comment.threadId));
    for (const root of roots) {
      result.push({ root, blockId, replies: comments.filter(comment => comment.threadId === root.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) });
    }
  }
  return result;
}

// A thread made from a reaction on text: no words, just the emoji pills in the margin.
const reactionOnly = (thread: Thread) => !thread.replies.length && !(thread.root.richText ?? []).some(run => run.text.trim()) && !!thread.root.reactions?.length;
const author = (comment: CommentEntity) => (!comment.createdBy || comment.createdBy === 'user' ? t("나") : comment.createdBy);
const plain = (runs: RichText | undefined) => (runs ?? []).map(run => run.text).join('');

// ---------- pieces ----------

function Composer({ placeholder, onSubmit, onCancel, autoFocus = true, boxed = false }: { placeholder: string; onSubmit: (text: string) => Promise<void>; onCancel?: () => void; autoFocus?: boolean; boxed?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = '0px';
    area.style.height = `${Math.min(240, area.scrollHeight)}px`;
  }, [text]);
  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    onSubmit(value).then(() => setText('')).catch(report).finally(() => setBusy(false));
  };
  return (
    <div className={`discussion-composer${boxed ? ' boxed' : ''}`}>
      <textarea ref={ref} rows={1} autoFocus={autoFocus} placeholder={placeholder} value={text} onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (isSendKey(event)) { event.preventDefault(); submit(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel?.(); }
        }} />
      <button type="button" className={`discussion-send${text.trim() ? ' ready' : ''}`} aria-label={t("보내기")} title={t("보내기")} disabled={!text.trim() || busy} onMouseDown={event => event.preventDefault()} onClick={submit}><Icon name="arrow-up" size={14} /></button>
    </div>
  );
}

function CommentRow({ comment, isRoot, onResolve, onDelete }: { comment: CommentEntity; isRoot: boolean; onResolve?: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  return (
    <div className={`discussion-comment${menu ? ' menu-open' : ''}`} data-comment-id={comment.id}>
      <span className="avatar discussion-avatar">{avatarLetter(author(comment))}</span>
      <div className="discussion-comment-main">
        <div className="discussion-meta"><span className="discussion-author">{author(comment)}</span><span className="discussion-time">{relativeTime(comment.createdAt ?? '')}</span></div>
        {editing ? (
          <div className="discussion-edit">
            <textarea className="text-input" rows={2} autoFocus value={text} onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false); }
                if (isSendKey(event)) {
                  event.preventDefault();
                  if (text.trim() && text.trim() !== plain(comment.richText)) apply([{ type: 'comment.update', id: comment.id, richText: [{ text: text.trim() }] }]).catch(report);
                  setEditing(false);
                }
              }} />
          </div>
        ) : <div className="discussion-text">{comment.richText.map((run, index) => <span key={index} className={run.italic ? 'italic' : undefined}>{run.text}</span>)}</div>}
        <Reactions comment={comment} />
      </div>
      <div className="discussion-tools" onMouseDown={event => event.preventDefault()}>
        <AddReaction comment={comment} />
        {isRoot && onResolve ? <button type="button" className="discussion-tool" aria-label={t("해결")} title={t("해결")} onClick={onResolve}><Icon name="check" size={16} /></button> : null}
        <button type="button" className="discussion-tool" aria-label={t("더 보기")} title={t("더 보기")} onClick={event => setMenu(event.currentTarget)}><Icon name="more" size={16} /></button>
      </div>
      {menu ? (
        <Menu anchor={menu} placement="below-end" width={220} label={t("댓글 메뉴")} onClose={() => setMenu(null)}
          entries={[
            { label: t("편집"), icon: 'pencil', onSelect: () => { setText(plain(comment.richText)); setEditing(true); } },
            { label: t("링크 복사"), icon: 'link', onSelect: () => { const url = new URL(location.href); url.hash = comment.parentId ?? ''; navigator.clipboard.writeText(url.href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report); } },
            { kind: 'separator' },
            { label: t("삭제"), icon: 'trash', onSelect: onDelete },
          ]} />
      ) : null}
    </div>
  );
}

function ThreadCard({ thread, active, onActivate, onClose }: { thread: Thread; active: boolean; onActivate: () => void; onClose: () => void }) {
  const resolve = () => apply([{ type: 'comment.update', id: thread.root.id, resolved: true }]).then(() => { setStatus(t("토론을 해결했습니다.")); onClose(); }).catch(report);
  const removeThread = () => confirmSmall(thread.replies.length ? t("이 토론을 삭제할까요?") : t("이 댓글을 삭제할까요?")).then(async ok => { if (ok) { await apply([thread.root, ...thread.replies].map(comment => ({ type: 'node.trash', id: comment.id }))); onClose(); } }).catch(report);
  if (reactionOnly(thread)) {
    return (
      <div className="discussion-thread reactions-only">
        <div className="reaction-line">
          <Reactions comment={thread.root} lonely />
          <span className="reaction-tools" onMouseDown={event => event.preventDefault()}>
            <AddReaction comment={thread.root} className="reaction-tool" />
            <button type="button" className="reaction-tool" aria-label={t("해결")} title={t("해결")} onClick={resolve}><Icon name="check" size={16} /></button>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="discussion-thread" onMouseDown={event => { if (!active && !(event.target as HTMLElement).closest('button, textarea')) { event.preventDefault(); onActivate(); } }}>
      {[thread.root, ...thread.replies].map((comment, index) => (
        <CommentRow key={comment.id} comment={comment} isRoot={index === 0} onResolve={resolve}
          onDelete={index === 0 ? removeThread : () => { confirmSmall(t("이 댓글을 삭제할까요?")).then(async ok => { if (ok) await apply([{ type: 'node.trash', id: comment.id }]); }).catch(report); }} />
      ))}
      {active ? (
        <div className="discussion-reply">
          <span className="avatar discussion-avatar">{t("avatar|나")}</span>
          <Composer boxed placeholder={t("답글…")} onCancel={onClose}
            onSubmit={async text => { await apply([{ type: 'comment.create', parentId: thread.blockId, threadId: thread.root.id, richText: [{ text }] }]); }} />
        </div>
      ) : null}
    </div>
  );
}

// ---------- layer ----------

const CARD_GAP = 8, MARGIN = 32, CARD_WIDTH = 308;
// Right margin the cards need (~382px beside the 720px column) and the least
// left margin the shifted page keeps.
const NEEDED_MARGIN = 382, MIN_LEFT = 96;

interface Placed { key: string; thread?: Thread; top: number; anchor: number }

export function Discussions({ view, scroller, readOnly, flush, mode = 'default' }: { view: EditorView | null; scroller: HTMLElement | null; readOnly?: boolean; flush: () => Promise<void>; mode?: 'default' | 'minimal' | 'off' }) {
  const ws = useWorkspace();
  const [, setTick] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [bubble, setBubble] = useState<{ anchor: DOMRect; key: string } | null>(null);
  const heights = useRef(new Map<string, number>());
  const layerRef = useRef<HTMLDivElement>(null);
  const relayout = useCallback(() => setTick(tick => tick + 1), []);
  // The page slides left when the margin needs room for the cards (the whole
  // layout moves, cover included, with a 0.2s transition).
  const shift = useRef({ applied: 0, wanted: 0, page: null as HTMLElement | null });
  useLayoutEffect(() => {
    const current = shift.current;
    if (!current.page || current.applied === current.wanted) return;
    current.applied = current.wanted;
    current.page.classList.add('discussion-shift');
    current.page.style.left = current.wanted ? `${-current.wanted}px` : '';
  });
  useEffect(() => () => { const page = shift.current.page; if (page) { page.style.left = ''; page.classList.remove('discussion-shift'); } }, []);

  useEffect(() => {
    if (!view) return;
    const set = listeners.get(view) ?? new Set<Listener>();
    listeners.set(view, set);
    set.add(relayout);
    starters.set(view, target => { setActive(null); setPending(target); setBubble(null); });
    clickers.set(view, threadId => { setActive(threadId); if (threadId) setPending(null); });
    const observer = new ResizeObserver(relayout);
    observer.observe(view.dom);
    window.addEventListener('resize', relayout);
    return () => { set.delete(relayout); starters.delete(view); clickers.delete(view); observer.disconnect(); window.removeEventListener('resize', relayout); };
  }, [view, relayout]);

  // Threads on this page's blocks.
  const blockIds: string[] = [];
  view?.state.doc.descendants(node => { if (node.attrs?.id) blockIds.push(node.attrs.id); return !node.isTextblock; });
  const blockKey = blockIds.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const threads = useMemo(() => threadsFor(blockIds), [blockKey, ws.version]);
  const open = threads.filter(thread => !thread.root.resolved);

  // Which threads are anchored to text (a comment mark) and which to the whole block.
  const marked = new Map<string, { from: number; to: number }>();
  view?.state.doc.descendants((node, pos) => {
    if (node.isText) for (const mark of node.marks) if (isCommentMark(mark)) { const range = marked.get(mark.attrs.id); marked.set(mark.attrs.id, range ? { from: Math.min(range.from, pos), to: Math.max(range.to, pos + node.nodeSize) } : { from: pos, to: pos + node.nodeSize }); }
    return true;
  });
  const openIds = new Set(open.map(thread => thread.root.id));
  const blockThreads = new Map<string, string[]>();
  for (const thread of open) if (!marked.has(thread.root.id)) blockThreads.set(thread.blockId, [...(blockThreads.get(thread.blockId) ?? []), thread.root.id]);
  const stateKey = `${[...openIds].join(',')}#${[...blockThreads].map(([id, list]) => `${id}:${list.join(',')}`).join(';')}#${active}#${pending ? `${pending.blockId}:${pending.from ?? ''}-${pending.to ?? ''}` : ''}`;

  useEffect(() => {
    if (!view) return;
    view.dispatch(view.state.tr.setMeta(discussionKey, { open: openIds, blockThreads, active, pending }).setMeta('addToHistory', false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, stateKey]);

  // Close the open card or an empty composer on clicks elsewhere.
  useEffect(() => {
    if (!active && !pending) return;
    const down = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.discussion-card, .discussion-popover, .popover-panel, [data-thread]')) return;
      setActive(null);
      if (pending && !layerRef.current?.querySelector('.discussion-card.composing textarea')?.matches(':not(:placeholder-shown)')) setPending(null);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [active, pending]);

  if (!view || !scroller) return null;
  const wrap = view.dom.parentElement?.parentElement;
  if (!wrap) return null;
  const wrapBox = wrap.getBoundingClientRect();
  const content = view.dom.getBoundingClientRect();

  const anchorTop = (blockId: string, from?: number) => {
    const block = blockOf(view.state.doc, blockId);
    const dom = block ? view.nodeDOM(block.pos) as HTMLElement | null : null;
    const blockTop = dom?.getBoundingClientRect().top ?? 0;
    if (from === undefined) return blockTop;
    try {
      const top = view.coordsAtPos(from, 1).top;
      return top - blockTop < 20 ? blockTop : top - 6;
    } catch { return blockTop; }
  };

  const items: Placed[] = open.map(thread => ({ key: thread.root.id, thread, anchor: anchorTop(thread.blockId, marked.get(thread.root.id)?.from), top: 0 }));
  if (pending && !readOnly) items.push({ key: 'new', anchor: anchorTop(pending.blockId, pending.from), top: 0 });
  items.sort((a, b) => a.anchor - b.anchor);
  // Room in the right margin, measured as if the page were not shifted.
  const page = wrap.closest<HTMLElement>('.page');
  if (shift.current.page !== page) shift.current = { applied: 0, wanted: 0, page };
  const scrollerBox = scroller.getBoundingClientRect();
  const applied = shift.current.applied;
  const rightMargin = scrollerBox.left + scroller.clientWidth - (content.right + applied);
  const leftMargin = content.left + applied - scrollerBox.left;
  // "최소화" keeps the threads as bubbles at the block's edge; "숨기기" shows only a comment being written.
  let room = mode === 'default', wanted = 0;
  if (mode === 'off') { const keep = items.filter(item => item.key === 'new'); items.splice(0, items.length, ...keep); }
  if (room && rightMargin < NEEDED_MARGIN) {
    const extra = Math.ceil(NEEDED_MARGIN - rightMargin);
    if (extra <= leftMargin - MIN_LEFT) wanted = extra; else room = false;
  }
  shift.current.wanted = items.length && room ? wanted : 0;
  const focus = items.findIndex(item => item.key === (pending ? 'new' : active));
  const height = (key: string) => heights.current.get(key) ?? 74;
  const desired = (item: Placed) => item.anchor - wrapBox.top - 13;
  if (focus >= 0) {
    items[focus].top = desired(items[focus]);
    for (let i = focus - 1; i >= 0; i--) items[i].top = Math.min(desired(items[i]), items[i + 1].top - height(items[i].key) - CARD_GAP);
    for (let i = focus + 1; i < items.length; i++) items[i].top = Math.max(desired(items[i]), items[i - 1].top + height(items[i - 1].key) + CARD_GAP);
  } else items.forEach((item, i) => { item.top = i ? Math.max(desired(item), items[i - 1].top + height(items[i - 1].key) + CARD_GAP) : desired(item); });

  const closeAll = () => { setActive(null); setPending(null); setBubble(null); view.focus(); };
  const createThread = async (text: string) => {
    if (!pending) return;
    const id = crypto.randomUUID();
    await flush();
    await apply([{ type: 'comment.create', id, parentId: pending.blockId, richText: [{ text }] }]);
    const mapped = discussionKey.getState(view.state)?.pending;
    const tr = view.state.tr.setMeta(discussionKey, { pending: null }).setMeta('addToHistory', false);
    if (mapped?.from !== undefined && mapped.to > mapped.from) tr.addMark(mapped.from, mapped.to, schema.marks.comment.create({ id }));
    view.dispatch(tr);
    setPending(null);
  };
  const left = content.right - wrapBox.left + MARGIN;

  const card = (item: Placed) => {
    if (!item.thread) {
      return <Composer placeholder={t("댓글 추가…")} onCancel={closeAll} onSubmit={createThread} />;
    }
    return <ThreadCard thread={item.thread} active={active === item.key} onActivate={() => { setActive(item.key); setPending(null); }} onClose={closeAll} />;
  };

  if (!room) {
    const bubbleItem = bubble ? items.find(item => item.key === bubble.key) : undefined;
    // Count bubbles at the block's right edge; the card opens in a popover.
    const byAnchor = new Map<number, Placed[]>();
    for (const item of items) byAnchor.set(Math.round(item.anchor), [...(byAnchor.get(Math.round(item.anchor)) ?? []), item]);
    return (
      <div className="discussion-layer" ref={layerRef}>
        {[...byAnchor.values()].map(group => {
          const first = group[0];
          const count = group.reduce((sum, item) => sum + (item.thread ? 1 + item.thread.replies.length : 0), 0);
          return (
            <button key={first.key} type="button" className={`discussion-bubble${group.some(item => item.key === active || item.key === bubble?.key) ? ' active' : ''}`} style={{ left: content.right - wrapBox.left + 6, top: first.anchor - wrapBox.top + 2 }}
              aria-label={t("댓글 {0}개", [count])} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setBubble({ anchor: rect, key: first.key }); if (first.thread) setActive(first.key); }}>
              <Icon name="comment" size={16} />{count ? <span>{count}</span> : null}
            </button>
          );
        })}
        {(bubbleItem || pending) ? (
          <Popover anchor={bubble?.anchor ?? new DOMRect(content.right - 320, (pending ? items.find(item => item.key === 'new')?.anchor ?? 0 : 0) + 28, 320, 0)} placement="below-end" offset={6} onClose={closeAll} className="discussion-popover" style={{ width: CARD_WIDTH }}>
            {pending ? card(items.find(item => item.key === 'new')!) : bubbleItem ? card(bubbleItem) : null}
          </Popover>
        ) : null}
      </div>
    );
  }

  return (
    <div className="discussion-layer" ref={layerRef}>
      {items.map(item => (
        <div key={item.key} className={`discussion-card${item.key === active ? ' active' : ''}${item.thread ? '' : ' composing'}${item.thread && reactionOnly(item.thread) ? ' reactions-only' : ''}`} style={{ left, top: item.top }}
          ref={element => {
            if (!element) return;
            const measured = element.offsetHeight;
            if (measured && heights.current.get(item.key) !== measured) { heights.current.set(item.key, measured); requestAnimationFrame(relayout); }
          }}>
          {card(item)}
        </div>
      ))}
    </div>
  );
}
