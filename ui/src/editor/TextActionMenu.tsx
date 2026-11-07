import { t } from '../i18n';
import { useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { MarkType } from 'prosemirror-model';
import { toggleMark } from 'prosemirror-commands';
import { Popover } from '../ui/overlay';
import { Menu } from '../ui/Menu';
import { Icon, blockIcon } from '../ui/Icon';
import { blockLabels } from '../data/format';
import { schema } from './schema';
import { reactToSelection, startComment } from './Discussions';
import { EmojiPicker } from '../page/PageView';
import { report } from '../data/store';
import { blockAt } from './blocks';
import { colorEntries, turnIntoEntries } from './BlockMenu';
import { convertToEquation } from './equation';

function markActive(view: EditorView, type: MarkType) {
  const { from, to, empty, $from } = view.state.selection;
  if (empty) return !!type.isInSet(view.state.storedMarks ?? $from.marks());
  return view.state.doc.rangeHasMark(from, to, type);
}

export function applyColor(view: EditorView, kind: 'color' | 'background', color: string) {
  const { from, to } = view.state.selection;
  const type = kind === 'color' ? schema.marks.color : schema.marks.background;
  const tr = view.state.tr.removeMark(from, to, type);
  if (color !== 'default') tr.addMark(from, to, type.create({ color }));
  try { localStorage.setItem('pageyard-last-color', JSON.stringify({ kind, color })); } catch { /* ignore */ }
  view.dispatch(tr);
}

export function clearFormatting(view: EditorView) {
  const { from, to } = view.state.selection;
  let tr = view.state.tr;
  for (const mark of Object.values(schema.marks)) tr = tr.removeMark(from, to, mark);
  view.dispatch(tr);
}

export interface TextActionMenuProps { view: EditorView; anchor: { x: number; y: number }; onClose: () => void; onLink: () => void; onBlockMenu: (anchor: Element) => void }

export function TextActionMenu({ view, anchor, onClose, onLink, onBlockMenu }: TextActionMenuProps) {
  const [react, setReact] = useState<{ anchor: Element; blockId: string; from: number; to: number } | null>(null);
  const [sub, setSub] = useState<{ kind: 'turn' | 'color'; anchor: Element } | null>(null);
  const info = blockAt(view.state.selection.$from);
  const type = info?.node.type.name === 'text_block' ? info.node.attrs.blockType : info?.node.type.name === 'code_block' ? 'code' : 'paragraph';
  const button = (name: string, label: string, run: () => void, active = false) => (
    <button type="button" className={`tam-button${active ? ' active' : ''}`} aria-label={label} title={label} onMouseDown={event => { event.preventDefault(); run(); }}>
      <Icon name={name} size={16} />
    </button>
  );
  const mark = (type: MarkType) => () => { toggleMark(type)(view.state, view.dispatch); };
  return (
    <Popover anchor={{ x: anchor.x, y: anchor.y }} placement="point" onClose={onClose} className="text-action-menu" style={{ width: 192 }} label={t("텍스트 서식")}>
      <div className="tam" onMouseDown={event => event.preventDefault()}>
        <button type="button" className="tam-row" onMouseDown={event => { event.preventDefault(); setSub({ kind: 'turn', anchor: event.currentTarget }); }}>
          <Icon name={blockIcon[type] ?? 'text-block'} size={20} /><span className="tam-row-label">{(blockLabels as Record<string, string>)[type] ?? t("텍스트")}</span><Icon name="chevron-right" size={16} className="tam-chevron" />
        </button>
        <div className="tam-separator" />
        <div className="tam-grid">
          <button type="button" className="tam-button" aria-label={t("색")} title={t("텍스트 색")} onMouseDown={event => { event.preventDefault(); setSub({ kind: 'color', anchor: event.currentTarget }); }}><span className="tam-color">A</span></button>
          {button('bold', t("굵게 ⌘B"), mark(schema.marks.bold), markActive(view, schema.marks.bold))}
          {button('italic', t("기울임꼴 ⌘I"), mark(schema.marks.italic), markActive(view, schema.marks.italic))}
          {button('underline', t("밑줄 ⌘U"), mark(schema.marks.underline), markActive(view, schema.marks.underline))}
          {button('clear-format', t("서식 지우기"), () => clearFormatting(view))}
          {button('link', t("링크 ⌘K"), onLink, markActive(view, schema.marks.link))}
          {button('strike', t("취소선 ⌘⇧S"), mark(schema.marks.strike), markActive(view, schema.marks.strike))}
          {button('code', t("코드 ⌘E"), mark(schema.marks.code), markActive(view, schema.marks.code))}
          {button('math', t("수식으로 변환 ⌘⇧E"), () => { onClose(); convertToEquation(view); })}
          <button type="button" className="tam-button" aria-label={t("더 보기")} title={t("블록 메뉴")} onMouseDown={event => { event.preventDefault(); onBlockMenu(event.currentTarget); }}><Icon name="more" size={16} /></button>
        </div>
        <div className="tam-separator" />
        {/* 댓글 · 반응 (댓글 108×28, then the reaction button). */}
        <div className="tam-comment-row">
          <button type="button" className="tam-row tam-comment" onMouseDown={event => {
            event.preventDefault();
            const id = info?.node.attrs.id;
            if (id) startComment(view, id, { from: view.state.selection.from, to: view.state.selection.to });
            onClose();
          }}><Icon name="comment" size={20} /><span className="tam-row-label">{t("댓글")}</span></button>
          <button type="button" className="tam-button tam-react" aria-label={t("고른 글에 반응 달기")} title={t("고른 글에 반응 달기")} onMouseDown={event => {
            event.preventDefault();
            const id = info?.node.attrs.id;
            if (id) setReact({ anchor: event.currentTarget, blockId: id, from: view.state.selection.from, to: view.state.selection.to });
          }}><Icon name="emoji-add" size={20} /></button>
        </div>
      </div>
      {react ? <EmojiPicker anchor={react.anchor} emojiOnly customReactions onClose={() => { setReact(null); onClose(); }} onPick={emoji => {
        const target = react; setReact(null); onClose();
        if (!emoji.startsWith('icon:')) reactToSelection(view, target.blockId, { from: target.from, to: target.to }, emoji).catch(report);
      }} /> : null}
      {sub?.kind === 'turn' ? <Menu anchor={sub.anchor} placement="right-start" width={220} entries={turnIntoEntries(view, type)} onClose={() => setSub(null)} onCloseAll={() => { setSub(null); onClose(); }} /> : null}
      {sub?.kind === 'color' ? <Menu anchor={sub.anchor} placement="right-start" width={220} entries={colorEntries((kind, color) => applyColor(view, kind, color))} onClose={() => setSub(null)} onCloseAll={() => { setSub(null); onClose(); }} /> : null}
    </Popover>
  );
}
