import { t } from '../i18n';
import { Component, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EditorState, NodeSelection, Plugin, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { DOMSerializer, Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { ReplaceStep } from 'prosemirror-transform';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { lastUndoInfo, undoLast } from '../data/commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { textBlocks, htmlBlocks } from '../../../web/paste-blocks.mjs';
import { report, workspace } from '../data/store';
import { uploadFile } from '../data/commands';
import { navigate } from '../data/router';
import type { BlockEntity, Operation, PageEntity, RichText, SourceEntity } from '../data/types';
import { plainText } from '../data/format';
import { Menu } from '../ui/Menu';
import { schema } from './schema';
import { runsToInline, newBlockId } from './convert';
import { blockAt, duplicateBlocks, indent, isBlockNode, isFlat, joinBackward, joinForward, moveBlock, newTextBlock, outdent, selectedOrCurrentBlocks, setBlockType, splitBlock, subtreeEnd, withFreshIds, type BlockInfo } from './blocks';
import {
  blockDecorationsPlugin, blockSelectionKey, blockSelectionPlugin, closeTrigger, deleteBlocks, flatBlocks, isCollapsed, markdownRules,
  selectedBlockInfos, setBlockSelection, setToggleOpen, isToggleNode, triggerKey, triggerPlugin, uniqueIdsPlugin,
  toggleAll,
} from './plugins';
import { codeHighlightPlugin } from './highlight';
import { EmojiPicker, usePageStyle } from '../page/PageView';

// Right-clicking page text opened the block menu in an earlier build; now it is left to the browser.
const rightClickBlockMenu = false;
import { dropBesides } from './columnsDrop';
import { ColumnResizer } from './ColumnResizer';
import { AtomRegistry, CodeBlockView, ColumnView, ColumnsView, DateMentionView, EquationView, LinkMentionView, MentionView, ReactAtomView, TabView, TabsView, TextBlockView, codeLanguages, dateMentionEvent, equationViewFor, languageLabels } from './views';
import { findNode, revealTabsAt, writeSelectedTab } from './tabs';
import { captionTypes, requestCaption } from './caption';
import { openHtmlFullscreen } from './HtmlBlock';
import { convertToEquation } from './equation';
import { MermaidModePicker, MermaidViewer } from './MermaidControls';
import { PageSync, type SyncStatus } from './sync';
import { readRich } from './richdom';
import { InlineEquationEditor, renderAtom } from './atoms';
import { BlockHandles } from './BlockHandles';
import { BlockMenu, colorBlocks, lastUsedColor } from './BlockMenu';
import { SlashMenu, type KeyTarget } from './SlashMenu';
import { MentionMenu, type MentionChoice } from './MentionMenu';
import { EmojiMenu } from './EmojiMenu';
import { TextActionMenu, applyColor, clearFormatting } from './TextActionMenu';
import { LinkPopover } from './LinkPopover';
import { LinkHover } from './LinkHover';
import { Discussions, discussionPlugin, startComment } from './Discussions';
import { noteSlashUse, type SlashItem } from './slashItems';
import { setCreateExtras } from './extras';
import { openWorkspaceDialog } from '../dialogs/registry';
import { createPage } from '../page/actions';
import { apply, newId } from '../data/commands';
import { DateMentionEditor, PasteUrlMenu, bookmarkFor, linkMention, type DateAttrs, type PasteChoice } from './inlinePopovers';
import { dateMentionDue, zonedMentionLabel } from './views';

export interface PageEditorHandle {
  view: () => EditorView | null;
  sync: () => PageSync | null;
  flush: () => Promise<void>;
  focusStart: (createIfFilled?: boolean) => void;
  focusEnd: () => void;
}

// slide: in presentation mode, the page's top-level items shown (the rest is hidden).
export interface PageEditorProps { pageId: string; scroller: HTMLElement | null; readOnly?: boolean; onExitTop?: () => void; className?: string; slide?: string[] | null }

// Presentation slides: every top-level item (with what is nested under it) outside the slide is hidden.
function slideDecorations(doc: PMNode, shown: Set<string> | null): DecorationSet | null {
  if (!shown) return null;
  const decorations: Decoration[] = [];
  let visible = false;
  doc.forEach((node, offset) => {
    if ((node.attrs.depth ?? 0) === 0 || !visible) {
      const id = String(node.attrs.id ?? '');
      visible = shown.has(id) || (node.type.name === 'database' && (node.attrs.viewIds as string[]).some(viewId => shown.has(viewId)));
    }
    if (!visible) decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'slide-hidden' }));
  });
  return DecorationSet.create(doc, decorations);
}

class AtomBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? <div className="atom-error">{t("이 블록을 표시하지 못했습니다. {0}", [this.state.error.message])}</div> : this.props.children; }
}

// ---------- clipboard (blocks keep their data when copied inside the app) ----------
let copied: { text: string; slice: Slice } | null = null;
const sliceText = (slice: Slice) => slice.content.textBetween(0, slice.content.size, '\n\n', node => node.type.name === 'mention' || node.type.name === 'link_mention' || node.type.name === 'date_mention' ? node.attrs.text : node.type.name === 'equation' ? node.attrs.tex : '');

function blocksMarkdown(nodes: PMNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const pad = '  '.repeat(node.attrs.depth ?? 0);
    if (node.type.name === 'code_block') { lines.push(`${pad}\`\`\`${node.attrs.language === 'plain' ? '' : node.attrs.language}`, node.textContent, `${pad}\`\`\``); continue; }
    if (node.type.name !== 'text_block') { if (node.attrs.blockType === 'divider') lines.push('---'); continue; }
    const text = node.textContent;
    const prefix: Record<string, string> = { heading1: '# ', heading2: '## ', heading3: '### ', bullet: '- ', numbered: '1. ', todo: node.attrs.checked ? '- [x] ' : '- [ ] ', quote: '> ', toggle: '- ' };
    lines.push(`${pad}${prefix[node.attrs.blockType] ?? ''}${text}`);
  }
  return lines.join('\n');
}

interface Descriptor { blockType: string; richText?: RichText; checked?: boolean; language?: string; cells?: unknown; tableHeader?: unknown; children?: Descriptor[] }
function descriptorNodes(descriptors: Descriptor[], depth: number, out: PMNode[] = []): PMNode[] {
  for (const item of descriptors) {
    const id = newBlockId();
    if (item.blockType === 'code') out.push(schema.nodes.code_block.create({ id, depth, language: item.language || 'plain' }, item.richText?.map(run => run.text).join('') ? schema.text(item.richText.map(run => run.text).join('')) : undefined));
    else if (item.blockType === 'divider') out.push(schema.nodes.atom_block.create({ id, depth, blockType: 'divider' }));
    else if (item.blockType === 'table') { setCreateExtras(id, { cells: item.cells, tableHeader: item.tableHeader }); out.push(schema.nodes.atom_block.create({ id, depth, blockType: 'table' })); }
    else out.push(schema.nodes.text_block.create({ id, depth, blockType: item.blockType, checked: !!item.checked }, runsToInline(item.richText ?? [])));
    if (item.children?.length) descriptorNodes(item.children, depth + 1, out);
  }
  return out;
}

function shiftDepth(nodes: PMNode[], base: number): PMNode[] {
  const flat = nodes.filter(node => 'depth' in node.attrs);
  const min = flat.length ? Math.min(...flat.map(node => node.attrs.depth ?? 0)) : 0;
  return nodes.map(node => 'depth' in node.attrs ? node.type.create({ ...node.attrs, depth: (node.attrs.depth ?? 0) - min + base }, node.content, node.marks) : node);
}

// Insert block nodes at the caret: first/last text blocks merge with the split line.
function insertBlocks(view: EditorView, nodes: PMNode[]) {
  if (!nodes.length) return;
  const { state } = view;
  const info = blockAt(state.selection.$from);
  const depth = info?.node.attrs.depth ?? 0;
  const placed = shiftDepth(nodes, depth);
  const tr = state.tr;
  if (info && info.node.type.name === 'text_block' && info.node.content.size === 0 && state.selection.empty) {
    tr.replaceWith(info.pos, info.end, placed);
    const end = info.pos + placed.reduce((sum, node) => sum + node.nodeSize, 0);
    tr.setSelection(Selection.near(tr.doc.resolve(end), -1));
  } else if (info && info.node.type.name === 'text_block') {
    const openStart = placed[0].type.name === 'text_block' ? 1 : 0;
    const openEnd = placed[placed.length - 1].type.name === 'text_block' ? 1 : 0;
    tr.replaceSelection(new Slice(Fragment.from(placed), openStart, openEnd));
  } else {
    const at = info ? subtreeEnd(info).end : state.doc.content.size;
    tr.insert(at, placed);
    tr.setSelection(Selection.near(tr.doc.resolve(at + placed.reduce((sum, node) => sum + node.nodeSize, 0)), -1));
  }
  view.dispatch(tr.scrollIntoView());
}

function isStructural(tr: Transaction) {
  return tr.steps.some((step, index) => {
    if (!(step instanceof ReplaceStep)) return !(step.constructor.name.includes('Mark'));
    const doc = tr.docs[index];
    const { from, to, slice } = step as unknown as { from: number; to: number; slice: Slice };
    const $from = doc.resolve(from), $to = doc.resolve(to);
    if (!$from.parent.isTextblock || !$from.sameParent($to) || slice.openStart || slice.openEnd) return true;
    let inline = true;
    slice.content.forEach(node => { if (!node.isInline) inline = false; });
    return !inline;
  });
}

function blockIdsBetween(doc: PMNode, from: number, to: number) {
  const ids: string[] = [];
  for (const { node, pos } of flatBlocks(doc)) {
    if (!isFlat(node)) continue;
    if (pos + node.nodeSize > from && pos < to) ids.push(node.attrs.id);
  }
  return ids;
}

const turnShortcuts: Record<string, string> = { '0': 'paragraph', '1': 'heading1', '2': 'heading2', '3': 'heading3', '4': 'todo', '5': 'bullet', '6': 'numbered', '7': 'toggle', '8': 'code' };

interface TriggerUi { kind: 'slash' | 'mention' | 'link' | 'emoji'; query: string; x: number; y: number; height: number; from: number; full?: boolean }

export const PageEditor = forwardRef<PageEditorHandle, PageEditorProps>(function PageEditor({ pageId, scroller, readOnly = false, onExitTop, className, slide = null }, ref) {
  const slideRef = useRef<Set<string> | null>(slide ? new Set(slide) : null);
  // 댓글(페이지 내): the page's own choice, else its database's page layout (최소화 → bubbles).
  const layoutComments = (() => { const sourceId = workspace.get<PageEntity>(pageId)?.sourceId; return sourceId ? workspace.get<SourceEntity>(sourceId)?.pageLayout?.comments : undefined; })();
  const inlineComments = usePageStyle(pageId).inlineComments ?? (layoutComments === 'minimal' ? 'minimal' : 'default');
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncRef = useRef<PageSync | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [registry] = useState(() => new AtomRegistry());
  const [trigger, setTrigger] = useState<TriggerUi | null>(null);
  const [textMenu, setTextMenu] = useState<{ x: number; y: number } | null>(null);
  const [linkAt, setLinkAt] = useState<{ x: number; y: number } | null>(null);
  const lastLocalEdit = useRef(0);
  const [blockMenu, setBlockMenu] = useState<{ anchor: DOMRect | { x: number; y: number }; placement: 'left-center' | 'point' | 'below-start' | 'below-end' } | null>(null);
  const [language, setLanguage] = useState<{ anchor: DOMRect; pos: number; current: string } | null>(null);
  const [calloutIcon, setCalloutIcon] = useState<{ anchor: DOMRect; pos: number } | null>(null);
  const [mermaid, setMermaid] = useState<{ action: 'mode' | 'expand'; anchor: Element; id: string } | null>(null);
  const [equation, setEquation] = useState<{ pos: number; anchor: { x: number; y: number; width: number; height: number }; initial: string } | null>(null);
  // A date mention being edited, and the menu after a pasted web address (링크 · 멘션 · 북마크 · 임베드).
  const [dateEdit, setDateEdit] = useState<{ pos: number; rect: DOMRect } | null>(null);
  const [urlPaste, setUrlPaste] = useState<{ from: number; to: number; url: string; x: number; y: number } | null>(null);
  const [status, setStatusState] = useState<SyncStatus>({ state: 'idle' });
  const keyTarget = useRef<KeyTarget | null>(null);
  const pointerDown = useRef(false);
  const exitTop = useRef(onExitTop);
  exitTop.current = onExitTop;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  useSyncExternalStore(registry.subscribe, registry.getVersion);

  const refreshOverlays = useCallback((editor: EditorView) => {
    const value = triggerKey.getState(editor.state);
    if (value?.kind) {
      try {
        const coords = editor.coordsAtPos(value.from);
        setTrigger(current => current && current.kind === value.kind && current.query === value.query && current.from === value.from ? current : { kind: value.kind!, query: value.query, from: value.from, full: value.full, x: coords.left, y: coords.top, height: coords.bottom - coords.top });
      } catch { setTrigger(null); }
    } else setTrigger(current => current ? null : current);
    const { selection } = editor.state;
    if (selection.empty || !(selection instanceof TextSelection) || (blockSelectionKey.getState(editor.state)?.ids.length ?? 0) > 0) setTextMenu(current => current ? null : current);
  }, []);

  const showTextMenu = useCallback((editor: EditorView, point?: { x: number; y: number }) => {
    const { selection } = editor.state;
    if (readOnlyRef.current || selection.empty || !(selection instanceof TextSelection) || triggerKey.getState(editor.state)?.kind) return;
    if ((blockSelectionKey.getState(editor.state)?.ids.length ?? 0) > 0) return;
    if (!selection.$from.parent.isTextblock) return;
    if (!editor.state.doc.textBetween(selection.from, selection.to).trim()) return;
    if (point) { setTextMenu({ x: point.x + 16, y: point.y + 16 }); return; }
    const coords = editor.coordsAtPos(selection.head);
    setTextMenu({ x: coords.left + 16, y: coords.bottom + 16 });
  }, []);

  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const sync = new PageSync(pageId, () => viewRef.current);
    syncRef.current = sync;
    const host = mount.closest<HTMLElement>('[data-page-id]');
    if (host) (host as unknown as { __sync?: PageSync }).__sync = sync;
    const unsubscribeStatus = sync.subscribe(() => setStatusState({ ...sync.status }));

    const withEditor = (run: (editor: EditorView) => boolean) => (_state: EditorState, _dispatch?: unknown, editor?: EditorView) => !!editor && run(editor);
    const textKeys = keymap({
      Enter: (state, dispatch) => splitBlock(state, dispatch, isCollapsed),
      'Shift-Enter': (state, dispatch) => {
        const { $from } = state.selection;
        if ($from.parent.type.name === 'code_block') { dispatch?.(state.tr.insertText('\n').scrollIntoView()); return true; }
        if (!$from.parent.isTextblock) return false;
        dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
        return true;
      },
      Backspace: chainCommands(joinBackward, baseKeymap.Backspace),
      Delete: chainCommands(joinForward, baseKeymap.Delete),
      'Mod-Backspace': baseKeymap['Mod-Backspace'] ?? (() => false),
      Tab: (state, dispatch) => {
        if (state.selection.$from.parent.type.name === 'code_block') { dispatch?.(state.tr.insertText('  ')); return true; }
        indent(state, dispatch); return true;
      },
      'Shift-Tab': (state, dispatch) => { outdent(state, dispatch); return true; },
      'Mod-b': toggleMark(schema.marks.bold),
      'Mod-i': toggleMark(schema.marks.italic),
      'Mod-u': toggleMark(schema.marks.underline),
      'Mod-Shift-s': toggleMark(schema.marks.strike),
      'Mod-Shift-x': toggleMark(schema.marks.strike),
      'Mod-e': toggleMark(schema.marks.code),
      'Mod-Shift-e': withEditor(editor => convertToEquation(editor)),
      // ⌘⌥M: the caption of the code or media block the caret (or block selection) is on.
      // Space on a selected HTML block: 전체 화면.
      Space: withEditor(editor => {
        const selection = editor.state.selection as NodeSelection;
        if (selection.node?.type.name === 'atom_block' && selection.node.attrs.blockType === 'html' && workspace.get<BlockEntity>(selection.node.attrs.id)?.attachmentId) { openHtmlFullscreen(selection.node.attrs.id); return true; }
        return false;
      }),
      'Mod-Alt-m': withEditor(editor => {
        const info = selectedOrCurrentBlocks(editor.state)[0];
        const node = info?.node;
        if (node && (node.type.name === 'code_block' || (node.type.name === 'atom_block' && captionTypes.has(node.attrs.blockType)))) { requestCaption(node.attrs.id); return true; }
        // Elsewhere ⌘⌥M keeps starting a comment (its older shortcut; ⌘⇧M is the listed one).
        const caret = blockAt(editor.state.selection.$from); const { from, to } = editor.state.selection;
        if (caret) startComment(editor, caret.node.attrs.id, { from, to });
        return true;
      }),
      'Mod-k': withEditor(editor => {
        if (editor.state.selection.empty) return false;
        const coords = editor.coordsAtPos(editor.state.selection.to);
        setTextMenu(null);
        setLinkAt({ x: coords.left, y: coords.bottom + 8 });
        return true;
      }),
      'Mod-d': (state, dispatch) => duplicateBlocks(state, dispatch),
      'Mod-Shift-ArrowUp': moveBlock(-1),
      'Mod-Shift-ArrowDown': moveBlock(1),
      'Mod-Shift-h': withEditor(editor => {
        const last = lastUsedColor();
        if (!last) return true;
        if (editor.state.selection.empty) colorBlocks(editor, selectedOrCurrentBlocks(editor.state), last.kind, last.color);
        else applyColor(editor, last.kind, last.color);
        return true;
      }),
      'Mod-Enter': withEditor(editor => {
        const info = blockAt(editor.state.selection.$from);
        if (!info || info.node.type.name !== 'text_block') return false;
        if (info.node.attrs.blockType === 'todo') { editor.dispatch(editor.state.tr.setNodeMarkup(info.pos, undefined, { ...info.node.attrs, checked: !info.node.attrs.checked })); return true; }
        if (isToggleNode(info.node)) { setToggleOpen(editor, info.node.attrs.id, isCollapsed(info.node.attrs.id)); return true; }
        return false;
      }),
      'Mod-Alt-t': withEditor(editor => { toggleAll(editor); return true; }),
      'Mod-Alt-\\': withEditor(editor => { if (editor.state.selection.empty) return false; clearFormatting(editor); return true; }),
      'Mod-Alt-9': withEditor(editor => { openWorkspaceDialog('turn-into-page', { view: editor }); return true; }),
      'Mod-Shift-m': withEditor(editor => { const info = blockAt(editor.state.selection.$from); const { from, to } = editor.state.selection; if (info) startComment(editor, info.node.attrs.id, { from, to }); return true; }),
      'Mod-/': withEditor(editor => { openMenuForCaret(editor); return true; }),
      // Local text history first; structural changes made by commands (column layouts,
      // database blocks…) fall back to the workspace undo stack.
      'Mod-z': (state, dispatch) => {
        const last = lastUndoInfo();
        const structural = last && last.origin !== 'editor' ? last : null;
        if (structural && structural.at > lastLocalEdit.current) { sync?.flush().then(() => undoLast()).catch(report); return true; }
        if (undo(state, dispatch)) return true;
        if (!structural) return false;
        sync?.flush().then(() => undoLast()).catch(report);
        return true;
      },
      'Mod-Shift-z': redo,
      'Mod-y': redo,
      'Mod-a': withEditor(editor => {
        const { state } = editor;
        const info = blockAt(state.selection.$from);
        if (!info || !info.node.isTextblock) return false;
        const start = info.pos + 1, end = info.pos + 1 + info.node.content.size;
        if (info.node.content.size && !(state.selection.from === start && state.selection.to === end)) {
          editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
          return true;
        }
        setBlockSelection(editor, flatBlocks(state.doc).filter(item => isBlockNode(item.node)).map(item => item.node.attrs.id));
        return true;
      }),
      Escape: withEditor(editor => {
        const infos = selectedOrCurrentBlocks(editor.state);
        if (!infos.length) return false;
        setBlockSelection(editor, infos.map(info => info.node.attrs.id));
        (editor.dom as HTMLElement).blur();
        editor.dom.focus({ preventScroll: true });
        return true;
      }),
      ArrowUp: withEditor(editor => {
        const { state } = editor;
        const info = blockAt(state.selection.$from);
        if (!info || !state.selection.empty) return false;
        const first = flatBlocks(state.doc).find(item => isFlat(item.node));
        if (first && first.node.attrs.id === info.node.attrs.id && editor.endOfTextblock('up') && exitTop.current) { exitTop.current(); return true; }
        return false;
      }),
      ...Object.fromEntries(Object.entries(turnShortcuts).map(([key, type]) => [`Mod-Alt-${key}`, (state: EditorState, dispatch?: (tr: Transaction) => void) => setBlockType(type)(state, dispatch)])),
    });

    const openMenuForCaret = (editor: EditorView) => {
      const infos = selectedOrCurrentBlocks(editor.state);
      if (!infos.length) return;
      setBlockSelection(editor, infos.map(info => info.node.attrs.id));
      const element = editor.nodeDOM(infos[0].pos) as HTMLElement | null;
      const rect = element?.getBoundingClientRect();
      setBlockMenu({ anchor: rect ? { x: rect.left, y: rect.top + 4 } : { x: 200, y: 200 }, placement: 'point' });
    };

    // Keys while blocks are selected (blue halo).
    const handleBlockSelectionKey = (editor: EditorView, event: KeyboardEvent): boolean => {
      const selection = blockSelectionKey.getState(editor.state);
      if (!selection?.ids.length) return false;
      // Blocks of a tab that is not shown are skipped like the content of a closed toggle.
      const all = flatBlocks(editor.state.doc).filter(item => { if (!isBlockNode(item.node)) return false; const dom = editor.nodeDOM(item.pos) as HTMLElement | null; return !!dom && !dom.classList.contains('block-hidden') && !dom.closest('.tab-panel:not(.tab-active)'); });
      const ids = all.map(item => item.node.attrs.id as string);
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape') { editor.dispatch(editor.state.tr.setMeta(blockSelectionKey, { ids: [], anchor: null, head: null })); return true; }
      if (event.key === 'Backspace' || event.key === 'Delete') { if (!readOnlyRef.current) deleteBlocks(editor.state, selectedBlockInfos(editor.state), editor.dispatch); return true; }
      if (event.key === 'Enter' && !mod) {
        const last = all.find(item => item.node.attrs.id === selection.ids[selection.ids.length - 1]);
        if (last) {
          const pos = last.node.isTextblock ? last.pos + 1 + last.node.content.size : last.pos;
          const tr = editor.state.tr.setMeta(blockSelectionKey, { ids: [], anchor: null, head: null });
          tr.setSelection(last.node.isTextblock ? TextSelection.create(tr.doc, pos) : NodeSelection.create(tr.doc, pos));
          editor.dispatch(tr);
        }
        return true;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const delta = event.key === 'ArrowUp' ? -1 : 1;
        if (mod && event.shiftKey) { moveBlock(delta as -1 | 1)(editor.state, tr => editor.dispatch(tr.setMeta(blockSelectionKey, selection).setMeta('keepBlockSelection', true))); return true; }
        const head = ids.indexOf(selection.head ?? selection.ids[selection.ids.length - 1]);
        const next = Math.max(0, Math.min(ids.length - 1, head + delta));
        if (event.shiftKey) {
          const anchorIndex = ids.indexOf(selection.anchor ?? selection.ids[0]);
          const [a, b] = anchorIndex <= next ? [anchorIndex, next] : [next, anchorIndex];
          editor.dispatch(editor.state.tr.setMeta(blockSelectionKey, { ids: ids.slice(a, b + 1), anchor: ids[anchorIndex], head: ids[next] }).setMeta('keepBlockSelection', true));
        } else {
          editor.dispatch(editor.state.tr.setMeta(blockSelectionKey, { ids: [ids[next]], anchor: ids[next], head: ids[next] }).setMeta('keepBlockSelection', true));
        }
        (editor.nodeDOM(all[next].pos) as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
        return true;
      }
      if (readOnlyRef.current) return mod && event.key.toLowerCase() === 'c' ? false : true;
      if (event.key === 'Tab') { (event.shiftKey ? outdent : indent)(editor.state, tr => editor.dispatch(tr.setMeta(blockSelectionKey, selection).setMeta('keepBlockSelection', true))); return true; }
      if (mod && event.key.toLowerCase() === 'd') { duplicateBlocks(editor.state, editor.dispatch); return true; }
      if (mod && event.key.toLowerCase() === 'a') { setBlockSelection(editor, ids); return true; }
      if (mod && event.key === '/') { openMenuForCaret(editor); return true; }
      if (mod && event.altKey && turnShortcuts[event.code.replace('Digit', '')]) { setBlockType(turnShortcuts[event.code.replace('Digit', '')])(editor.state, tr => editor.dispatch(tr.setMeta(blockSelectionKey, selection).setMeta('keepBlockSelection', true))); return true; }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'h') { const last = lastUsedColor(); if (last) colorBlocks(editor, selectedBlockInfos(editor.state), last.kind, last.color); return true; }
      if (mod && (event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'x' || event.key.toLowerCase() === 'v' || event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) return false;
      if (event.key.length === 1 && !mod) return true; // typing does not replace selected blocks
      return false;
    };

    const state = EditorState.create({
      schema,
      doc: sync.initialDoc(),
      plugins: [
        triggerPlugin,
        textKeys,
        keymap(baseKeymap),
        history({ newGroupDelay: 600 }),
        markdownRules,
        blockSelectionPlugin,
        blockDecorationsPlugin,
        uniqueIdsPlugin,
        codeHighlightPlugin,
        discussionPlugin,
        dropCursor({ color: '#2383e2', width: 3 }),
        gapCursor(),
        new Plugin({ props: { decorations: editorState => slideDecorations(editorState.doc, slideRef.current) } }),
      ],
    });

    let hoveredSynced = '';
    const editor: EditorView = new EditorView(mount, {
      state,
      editable: () => !readOnlyRef.current,
      // Typing near the window edge keeps the caret's block ~64px clear of it (a new block
      // made at the bottom ends 51–64px above the edge); the default 5px felt cramped.
      scrollThreshold: { top: 50, bottom: 50, left: 0, right: 0 },
      scrollMargin: { top: 64, bottom: 64, left: 0, right: 0 },
      attributes: { class: 'page-editor', spellcheck: 'true', 'aria-label': t("페이지 본문") },
      nodeViews: {
        text_block: (node, v, getPos, decorations) => new TextBlockView(node, v, getPos, decorations, (anchor, pos) => setCalloutIcon({ anchor: anchor.getBoundingClientRect(), pos })),
        code_block: (node, v, getPos, decorations) => new CodeBlockView(node, v, getPos, (anchor, pos, current) => setLanguage({ anchor: anchor.getBoundingClientRect(), pos, current }), decorations, (anchor, pos) => {
          const target = v.state.doc.nodeAt(pos);
          if (!target) return;
          setBlockSelection(v, [target.attrs.id]);
          setBlockMenu({ anchor: anchor.getBoundingClientRect(), placement: 'below-end' });
        }, (action, anchor, id) => setMermaid({ action, anchor, id })),
        atom_block: (node, v, getPos, decorations) => new ReactAtomView(node, v, getPos, registry, decorations),
        page_link: (node, v, getPos, decorations) => new ReactAtomView(node, v, getPos, registry, decorations),
        database: (node, v, getPos, decorations) => new ReactAtomView(node, v, getPos, registry, decorations),
        columns: (node, _v, _getPos, decorations) => new ColumnsView(node, decorations),
        column: node => new ColumnView(node),
        tabs: (node, _v, getPos, decorations) => new TabsView(node, getPos, registry, decorations),
        tab: node => new TabView(node),
        mention: node => new MentionView(node),
        link_mention: node => new LinkMentionView(node),
        date_mention: (node, v, getPos) => new DateMentionView(node, v, getPos),
        equation: (node, v, getPos) => new EquationView(node, v, getPos),
      },
      dispatchTransaction(tr) {
        const current = viewRef.current;
        if (!current) return;
        const before = current.state;
        current.updateState(before.apply(tr));
        if (tr.docChanged && !tr.getMeta('sync')) { sync.onLocalChange(isStructural(tr)); if (tr.getMeta('addToHistory') !== false) lastLocalEdit.current = Date.now(); }
        // The caret landing in a tab that is not shown (arrows, undo, search) shows that tab.
        if (tr.selectionSet) revealTabsAt(current.state, current.state.selection.from);
        // A text selection across blocks stays partial text while it runs through text blocks side by side (to
        // select, cut, copy and paste partial text across paragraphs); reaching a picture, table, database, page link
        // or another column makes it a block selection.
        const { selection } = current.state;
        if (tr.selectionSet && !tr.getMeta(blockSelectionKey) && selection instanceof TextSelection && !selection.empty) {
          const a = blockAt(selection.$from), b = blockAt(selection.$to);
          const textual = !!a && !!b && a.containerStart === b.containerStart && a.depth === b.depth
            && flatBlocks(current.state.doc).filter(({ node, pos }) => isFlat(node) && pos + node.nodeSize > a.pos && pos < b.end).every(({ node }) => node.type.name === 'text_block');
          if (a && b && a.node.attrs.id !== b.node.attrs.id && !textual) {
            const ids = blockIdsBetween(current.state.doc, a.pos, b.end);
            const anchorInfo = blockAt(selection.$anchor), headInfo = blockAt(selection.$head);
            current.updateState(current.state.apply(current.state.tr.setMeta(blockSelectionKey, { ids, anchor: anchorInfo?.node.attrs.id ?? ids[0], head: headInfo?.node.attrs.id ?? ids[ids.length - 1] }).setMeta('keepBlockSelection', true)));
          }
        }
        refreshOverlays(current);
      },
      handleKeyDown(v, event) {
        if (event.isComposing || event.keyCode === 229) return false;
        const value = triggerKey.getState(v.state);
        if (value?.kind && keyTarget.current && (['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key) || (value.kind === 'emoji' && ['ArrowLeft', 'ArrowRight'].includes(event.key))) && !event.shiftKey) {
          if (keyTarget.current.onKey(event)) { event.preventDefault(); return true; }
        }
        if (handleBlockSelectionKey(v, event)) { event.preventDefault(); return true; }
        return false;
      },
      handleTextInput(v) {
        return (blockSelectionKey.getState(v.state)?.ids.length ?? 0) > 0;
      },
      handleDOMEvents: {
        // A synced block's outline shows while the pointer is over any of its lines.
        mouseover(v, event) {
          const root = (event.target as HTMLElement).closest<HTMLElement>('[data-synced]')?.dataset.synced ?? '';
          if (root === hoveredSynced) return false;
          hoveredSynced = root;
          v.dom.querySelectorAll('.synced-hover').forEach(element => element.classList.remove('synced-hover'));
          if (root) v.dom.querySelectorAll(`[data-synced="${CSS.escape(root)}"]`).forEach(element => element.classList.add('synced-hover'));
          return false;
        },
        mouseleave(v) {
          hoveredSynced = '';
          v.dom.querySelectorAll('.synced-hover').forEach(element => element.classList.remove('synced-hover'));
          return false;
        },
        mousedown(v, event) {
          const target = event.target as HTMLElement;
          const hint = target.closest<HTMLElement>('.toggle-empty-hint');
          if (hint && !readOnlyRef.current) {
            event.preventDefault();
            const entry = flatBlocks(v.state.doc).find(item => item.node.attrs.id === hint.dataset.toggleId);
            if (entry) {
              const child = newTextBlock({ depth: (entry.node.attrs.depth ?? 0) + 1 });
              const at = entry.pos + entry.node.nodeSize;
              const tr = v.state.tr.insert(at, child);
              tr.setSelection(TextSelection.create(tr.doc, at + 1));
              v.dispatch(tr);
              v.focus();
            }
            return true;
          }
          // "빈 탭입니다…": edit the tab's (hidden) empty line.
          const tabHint = target.closest<HTMLElement>('.tab-empty-hint');
          if (tabHint && !readOnlyRef.current) {
            event.preventDefault();
            const entry = flatBlocks(v.state.doc).find(item => item.node.attrs.id === tabHint.dataset.tabLine);
            if (entry) { v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, entry.pos + 1))); v.focus(); }
            return true;
          }
          const link = target.closest<HTMLAnchorElement>('a.inline-link');
          if (link && event.button === 0 && !event.shiftKey && (event.metaKey || event.ctrlKey || readOnlyRef.current || v.state.selection.empty)) {
            // Click opens the link; drag/shift-click still selects text.
            const href = link.getAttribute('href') ?? '';
            const internal = href.match(/[?&]id=([^&#]+)/);
            if (internal && href.startsWith('/')) { event.preventDefault(); navigate(decodeURIComponent(internal[1])); return true; }
            window.open(href, '_blank', 'noopener');
            event.preventDefault();
            return true;
          }
          // ⌘⇧-click (Mac) or Alt⇧-click selects a whole block, or takes it out of the selection — with or without a
          // block selection already.
          const selection = blockSelectionKey.getState(v.state);
          if (event.shiftKey && (event.metaKey || event.altKey) && !event.ctrlKey && event.button === 0) {
            const blockEl = target.closest<HTMLElement>('.block[data-block-id]');
            const id = blockEl?.dataset.blockId;
            if (id) {
              event.preventDefault();
              const current = selection?.ids ?? [];
              const ids = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
              const order = flatBlocks(v.state.doc).map(item => item.node.attrs.id as string);
              ids.sort((x, y) => order.indexOf(x) - order.indexOf(y));
              v.dispatch(v.state.tr.setMeta(blockSelectionKey, { ids, anchor: selection?.anchor ?? ids[0] ?? null, head: id }).setMeta('keepBlockSelection', true));
              return true;
            }
          }
          // Shift-click extends a block selection.
          if (event.shiftKey && selection?.ids.length) {
            const blockEl = target.closest<HTMLElement>('.block[data-block-id]');
            if (blockEl) {
              const ids = flatBlocks(v.state.doc).filter(item => isFlat(item.node)).map(item => item.node.attrs.id as string);
              const a = ids.indexOf(selection.anchor ?? selection.ids[0]), b = ids.indexOf(blockEl.dataset.blockId ?? '');
              if (a >= 0 && b >= 0) {
                event.preventDefault();
                v.dispatch(v.state.tr.setMeta(blockSelectionKey, { ids: ids.slice(Math.min(a, b), Math.max(a, b) + 1), anchor: ids[a], head: ids[b] }).setMeta('keepBlockSelection', true));
                return true;
              }
            }
          }
          // ⌘/Ctrl-click adds a block to the block selection, or takes it out.
          if (selection?.ids.length && (event.metaKey || event.ctrlKey) && !event.shiftKey && event.button === 0) {
            const blockEl = target.closest<HTMLElement>('.block[data-block-id]');
            const id = blockEl?.dataset.blockId;
            if (id && !target.closest('a')) {
              event.preventDefault();
              const ids = selection.ids.includes(id) ? selection.ids.filter(item => item !== id) : [...selection.ids, id];
              const order = flatBlocks(v.state.doc).map(item => item.node.attrs.id as string);
              ids.sort((x, y) => order.indexOf(x) - order.indexOf(y));
              v.dispatch(v.state.tr.setMeta(blockSelectionKey, { ids, anchor: selection.anchor ?? ids[0] ?? null, head: id }).setMeta('keepBlockSelection', true));
              return true;
            }
          }
          if (!selection?.ids.length && event.button === 0 && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.detail === 1 && target.closest('.block-text, pre')) {
            // Take the caret from the click right away. The editor normally waits for the
            // browser's selectionchange, which never comes when the DOM caret already sits where
            // the click lands (e.g. after the document was replaced while unfocused).
            const at = v.posAtCoords({ left: event.clientX, top: event.clientY });
            if (at) { try { v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(at.pos)))); } catch { /* keep */ } }
          }
          if (selection?.ids.length && !event.shiftKey) {
            // Clear the block selection and put the caret where the click lands in the same step:
            // a selection-less dispatch here would push the old caret back into the DOM and the
            // editor would then keep typing at the previous position.
            const tr = v.state.tr.setMeta(blockSelectionKey, { ids: [], anchor: null, head: null });
            const at = v.posAtCoords({ left: event.clientX, top: event.clientY });
            if (at) { try { tr.setSelection(TextSelection.near(tr.doc.resolve(at.pos))); } catch { /* keep */ } }
            v.dispatch(tr);
          }
          pointerDown.current = true;
          setTextMenu(null);
          return false;
        },
        contextmenu(v, event) {
          // A right-click anywhere in the page text — selected blocks
          // included — gets the browser's own menu; only the ⋮⋮ handle opens the block menu.
          if (!rightClickBlockMenu) return false;
          if (readOnlyRef.current) return false;
          const target = event.target as HTMLElement;
          if (target.closest('input, textarea, [contenteditable="true"]:not(.page-editor), .block-atom a')) return false;
          const blockEl = target.closest<HTMLElement>('.block[data-block-id]');
          if (!blockEl || blockEl.classList.contains('block-columns')) return false;
          const { selection } = v.state;
          // Right-click inside a text selection keeps the native menu (copy, spelling).
          if (!selection.empty && selection instanceof TextSelection && !(blockSelectionKey.getState(v.state)?.ids.length)) return false;
          event.preventDefault();
          const current = blockSelectionKey.getState(v.state)?.ids ?? [];
          const id = blockEl.dataset.blockId!;
          if (!current.includes(id)) v.dispatch(v.state.tr.setMeta(blockSelectionKey, { ids: [id], anchor: id, head: id }).setMeta('keepBlockSelection', true));
          setBlockMenu({ anchor: { x: event.clientX, y: event.clientY }, placement: 'point' });
          return true;
        },
        copy(v, event) { return copyBlocks(v, event as ClipboardEvent, false); },
        cut(v, event) { return copyBlocks(v, event as ClipboardEvent, true); },
        focus(v) { refreshOverlays(v); return false; },
      },
      transformCopied(slice) {
        copied = { text: sliceText(slice), slice };
        return slice;
      },
      transformPasted(slice) {
        return new Slice(withFreshIds(slice.content), slice.openStart, slice.openEnd);
      },
      handlePaste(v, event, slice) {
        if (readOnlyRef.current) return true;
        const data = event.clipboardData;
        if (!data) return false;
        const $from = v.state.selection.$from;
        if ($from.parent.type.name === 'code_block') return false;
        const files = [...data.files];
        if (files.length) { insertFiles(v, files).catch(report); return true; }
        const text = data.getData('text/plain');
        const html = data.getData('text/html');
        if (copied && text && sliceText(copied.slice) === text) {
          const fresh = new Slice(withFreshIds(copied.slice.content), copied.slice.openStart, copied.slice.openEnd);
          const nodes: PMNode[] = [];
          fresh.content.forEach(node => nodes.push(node));
          if (nodes.length && nodes.every(node => isFlat(node) || node.type.name === 'columns' || node.type.name === 'tabs') && (nodes.length > 1 || !nodes[0].isTextblock || fresh.openStart === 0)) {
            insertBlocks(v, nodes);
            return true;
          }
          v.dispatch(v.state.tr.replaceSelection(fresh).scrollIntoView());
          return true;
        }
        const url = text.trim();
        if (/^https?:\/\/\S+$/.test(url) && !v.state.selection.empty) {
          const { from, to } = v.state.selection;
          v.dispatch(v.state.tr.addMark(from, to, schema.marks.link.create({ href: url })));
          return true;
        }
        // A bare web address: pasted as a link, then a menu offers a mention, a bookmark or an embed instead.
        if (/^https?:\/\/\S+$/.test(url) && v.state.selection.empty && $from.parent.isTextblock && !html.includes('<img')) {
          const from = v.state.selection.from;
          const tr = v.state.tr.insertText(url, from);
          tr.addMark(from, from + url.length, schema.marks.link.create({ href: url })).removeStoredMark(schema.marks.link);
          v.dispatch(tr.scrollIntoView());
          try { const coords = v.coordsAtPos(from + url.length); setUrlPaste({ from, to: from + url.length, url, x: coords.left, y: coords.bottom + 4 }); } catch { /* off screen */ }
          return true;
        }
        try {
          if (html && !html.includes('data-pm-slice')) {
            const root = new DOMParser().parseFromString(html, 'text/html').body;
            const descriptors = htmlBlocks(root, readRich) as Descriptor[];
            if (descriptors.length > 1 || (descriptors[0] && (descriptors[0].blockType !== 'paragraph' || descriptors[0].children?.length))) {
              insertBlocks(v, descriptorNodes(descriptors, 0));
              return true;
            }
            return false;
          }
          if (!html && text.includes('\n')) {
            const descriptors = textBlocks(text) as Descriptor[];
            if (descriptors.length) { insertBlocks(v, descriptorNodes(descriptors, 0)); return true; }
          }
          if (!html && /^(#{1,3} |[-*+] |\d+\. |> |```)/.test(text)) {
            const descriptors = textBlocks(text) as Descriptor[];
            if (descriptors.length && (descriptors.length > 1 || descriptors[0].blockType !== 'paragraph')) { insertBlocks(v, descriptorNodes(descriptors, 0)); return true; }
          }
        } catch (error) { report(error); return true; }
        void slice;
        return false;
      },
      handleDrop(v, event, _slice, moved) {
        if (readOnlyRef.current) return true;
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length || moved) return false;
        const pos = v.posAtCoords({ left: event.clientX, top: event.clientY });
        if (pos) v.dispatch(v.state.tr.setSelection(Selection.near(v.state.doc.resolve(pos.pos))));
        insertFiles(v, files).catch(report);
        return true;
      },
    });

    const copyBlocks = (v: EditorView, event: ClipboardEvent, cut: boolean) => {
      const infos = selectedBlockInfos(v.state);
      if (!infos.length || !event.clipboardData) return false;
      const nodes: PMNode[] = [];
      let covered = -1;
      for (const info of infos) {
        if (info.pos < covered) continue;
        const end = subtreeEnd(info).end;
        v.state.doc.slice(info.pos, end).content.forEach(node => nodes.push(node));
        covered = end;
      }
      const slice = new Slice(Fragment.from(nodes), 0, 0);
      const serializer = DOMSerializer.fromSchema(schema);
      const holder = document.createElement('div');
      holder.append(serializer.serializeFragment(slice.content));
      const text = blocksMarkdown(nodes);
      event.preventDefault();
      event.clipboardData.clearData();
      event.clipboardData.setData('text/html', holder.innerHTML);
      event.clipboardData.setData('text/plain', text);
      copied = { text, slice };
      if (cut && !readOnlyRef.current) deleteBlocks(v.state, infos, v.dispatch);
      return true;
    };

    const insertFiles = async (v: EditorView, files: File[]) => {
      for (const file of files) {
        const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
        const id = newBlockId();
        const node = schema.nodes.atom_block.create({ id, blockType: kind });
        insertBlocks(v, [node]);
        await sync.flush();
        if (!workspace.get(id)) throw new Error(t("파일 블록을 만들지 못했습니다."));
        if (kind === 'video' || kind === 'audio') {
          const result = await uploadFile(file, workspace.revision);
          await apply([{ type: 'block.update', id, attachmentId: result.attachmentId }]);
        } else await uploadFile(file, workspace.revision, { blockId: id });
      }
    };

    viewRef.current = editor;
    setView(editor);
    setStatusState({ ...sync.status });
    // The formatting menu waits for the selection to settle (~220ms).
    let textMenuTimer = 0;
    const showTextMenuSoon = (point?: { x: number; y: number }) => {
      window.clearTimeout(textMenuTimer);
      textMenuTimer = window.setTimeout(() => { if (viewRef.current) showTextMenu(viewRef.current, point); }, 220);
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      showTextMenuSoon({ x: event.clientX, y: event.clientY });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.shiftKey || !viewRef.current || !viewRef.current.hasFocus()) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) showTextMenuSoon();
    };
    const flushOnHide = () => { if (document.visibilityState === 'hidden') sync.flush().catch(() => undefined); };
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('visibilitychange', flushOnHide);
    window.addEventListener('pagehide', flushOnHide);
    // Scroll to a block named in the URL hash (block links).
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash) window.setTimeout(() => {
      // A tab's link: show that tab and bring its block into view.
      const tab = findNode(editor.state.doc, hash);
      if (tab?.node.type.name === 'tab') {
        const tabs = editor.state.doc.resolve(tab.pos).parent;
        writeSelectedTab(tabs.attrs.id, hash);
        mount.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(tabs.attrs.id)}"]`)?.scrollIntoView({ block: 'center' });
        return;
      }
      const target = findNode(editor.state.doc, hash);
      if (target) revealTabsAt(editor.state, target.pos + 1);
      const element = mount.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(hash)}"]`);
      if (element) { element.scrollIntoView({ block: 'center' }); setBlockSelection(editor, [hash]); }
    }, 50);
    return () => {
      window.clearTimeout(textMenuTimer);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', flushOnHide);
      window.removeEventListener('pagehide', flushOnHide);
      unsubscribeStatus();
      sync.flush().catch(() => undefined).finally(() => sync.destroy());
      viewRef.current = null;
      syncRef.current = null;
      editor.destroy();
      setView(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  useEffect(() => { view?.setProps({ editable: () => !readOnly }); }, [readOnly, view]);
  // An atom's own ⋯ (the HTML block header) opens the block menu at the pointer, the block selected.
  useEffect(() => {
    if (!view) return;
    const onMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ view: EditorView; id: string; x: number; y: number }>).detail;
      if (detail.view !== view || readOnly) return;
      setBlockSelection(view, [detail.id]);
      setBlockMenu({ anchor: { x: detail.x, y: detail.y }, placement: 'point' });
    };
    window.addEventListener('atom-block-menu', onMenu);
    return () => window.removeEventListener('atom-block-menu', onMenu);
  }, [view, readOnly]);
  const slideKey = slide ? slide.join(',') : null;
  useEffect(() => {
    slideRef.current = slide ? new Set(slide) : null;
    if (view) view.dispatch(view.state.tr.setMeta('slide', true).setMeta('addToHistory', false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideKey, view]);

  // An inline equation asks for its editor (pressed, or just inserted): open it under the equation.
  useEffect(() => {
    if (!view) return;
    const onEdit = (event: Event) => {
      if (readOnlyRef.current) return;
      const pos = (event as CustomEvent<{ pos: number }>).detail.pos;
      const node = view.state.doc.nodeAt(pos);
      const element = view.nodeDOM(pos) as HTMLElement | null;
      if (node?.type.name !== 'equation' || !element) return;
      const rect = element.getBoundingClientRect();
      setEquation({ pos, anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, initial: node.attrs.tex });
      equationViewFor(element)?.preview(node.attrs.tex);
    };
    view.dom.addEventListener('equation-edit', onEdit);
    return () => view.dom.removeEventListener('equation-edit', onEdit);
  }, [view]);

  // Marquee selection from the page margins.
  useEffect(() => {
    if (!view || !scroller || readOnly) return;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (view.dom.contains(target) || target.closest('button, a, input, textarea, [contenteditable="true"], .overlay-layer, .page-header, .block-handles, .database-block, .peek, .no-marquee')) return;
      if (!target.closest('.page-body')) return;
      const startX = event.clientX, startY = event.clientY + scroller.scrollTop;
      let box: HTMLDivElement | null = null;
      const move = (moveEvent: PointerEvent) => {
        const y = moveEvent.clientY + scroller.scrollTop;
        if (!box && Math.hypot(moveEvent.clientX - startX, y - startY) < 5) return;
        if (!box) { box = document.createElement('div'); box.className = 'marquee'; document.body.append(box); view.dom.blur(); }
        const top = Math.min(startY, y) - scroller.scrollTop, bottom = Math.max(startY, y) - scroller.scrollTop;
        const left = Math.min(startX, moveEvent.clientX), right = Math.max(startX, moveEvent.clientX);
        Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        const ids: string[] = [];
        for (const { node, pos } of flatBlocks(view.state.doc)) {
          if (!isFlat(node)) continue;
          const element = view.nodeDOM(pos) as HTMLElement | null;
          if (!element || element.classList.contains('block-hidden')) continue;
          const rect = element.getBoundingClientRect();
          if (rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right) ids.push(node.attrs.id);
        }
        view.dispatch(view.state.tr.setMeta(blockSelectionKey, { ids, anchor: ids[0] ?? null, head: ids[ids.length - 1] ?? null }).setMeta('keepBlockSelection', true));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (box) { box.remove(); view.dom.focus({ preventScroll: true }); }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    scroller.addEventListener('pointerdown', onDown);
    return () => scroller.removeEventListener('pointerdown', onDown);
  }, [view, scroller, readOnly]);

  useImperativeHandle(ref, () => ({
    view: () => viewRef.current,
    sync: () => syncRef.current,
    flush: () => syncRef.current?.flush() ?? Promise.resolve(),
    focusStart(createIfFilled = false) {
      const editor = viewRef.current;
      if (!editor) return;
      const first = flatBlocks(editor.state.doc).find(item => isFlat(item.node));
      const tr = editor.state.tr;
      if (!first || (createIfFilled && !(first.node.type.name === 'text_block' && first.node.content.size === 0))) {
        tr.insert(first?.pos ?? 0, newTextBlock());
        tr.setSelection(TextSelection.create(tr.doc, (first?.pos ?? 0) + 1));
      } else tr.setSelection(Selection.near(tr.doc.resolve(first.pos + (first.node.isTextblock ? 1 : 0))));
      editor.dispatch(tr.scrollIntoView());
      editor.focus();
    },
    focusEnd: () => focusEnd(viewRef.current),
  }), []);

  const sync = syncRef.current;
  const closeTriggerMenu = (removeText = false) => { if (view) closeTrigger(view, { removeText }); };

  const chooseSlash = (item: SlashItem) => {
    if (!view || !sync) return;
    const value = triggerKey.getState(view.state);
    if (!value?.kind) return;
    const tr = view.state.tr.delete(value.from, view.state.selection.head).setMeta(triggerKey, 'close');
    view.dispatch(tr);
    const info = blockAt(view.state.selection.$from);
    if (!info) return;
    noteSlashUse(item.id.replace(/^recent-/, ''));
    Promise.resolve(item.run({ view, pageId, sync, info, openDialog: (name, args) => openWorkspaceDialog(name, { ...args, view, pageId, sync }) })).catch(report);
    view.focus();
  };

  const chooseEmoji = (emoji: string) => {
    if (!view) return;
    const value = triggerKey.getState(view.state);
    if (!value?.kind) return;
    const custom = emoji.startsWith('custom:') ? emoji.slice(7) : null;
    const attachmentId = custom ? workspace.customEmoji()[custom] : null;
    if (custom && attachmentId) view.dispatch(view.state.tr.replaceWith(value.from, view.state.selection.head, schema.nodes.custom_emoji.create({ attachmentId, name: custom })).setMeta(triggerKey, 'close'));
    else view.dispatch(view.state.tr.insertText(emoji, value.from, view.state.selection.head).setMeta(triggerKey, 'close'));
    view.focus();
  };

  const chooseMention = (choice: MentionChoice) => {
    if (!view || !sync) return;
    const value = triggerKey.getState(view.state);
    if (!value?.kind) return;
    const from = value.from, to = view.state.selection.head;
    const finish = (node: PMNode | string) => {
      const tr = view.state.tr.setMeta(triggerKey, 'close');
      const mappedTo = Math.min(to, tr.doc.content.size);
      if (typeof node === 'string') tr.insertText(node, from, mappedTo);
      else tr.replaceWith(from, mappedTo, [node, schema.text(' ')]);
      view.dispatch(tr);
      view.focus();
    };
    if (choice.kind === 'page') finish(schema.nodes.mention.create({ pageId: choice.pageId, text: choice.title }));
    else if (choice.kind === 'date') finish(schema.nodes.date_mention.create({ date: choice.date, text: choice.text }));
    else if (choice.kind === 'reminder') {
      // "@리마인드": a date mention with a reminder at that time (the reminder itself is kept on the block).
      const reminderId = newId();
      finish(schema.nodes.date_mention.create({ date: choice.date, text: choice.text, remind: 0, reminderId }));
      const info = blockAt(view.state.selection.$from);
      if (info) sync.flush().then(() => workspace.get(info.node.attrs.id) ? apply([{ type: 'reminder.set', id: reminderId, parentId: info.node.attrs.id, at: choice.at, offsetMinutes: 0, message: plainMessage(info.node) }]) : undefined).catch(report);
    } else if (choice.kind === 'new-page' || choice.kind === 'new-page-at') {
      view.dispatch(view.state.tr.delete(from, to).setMeta(triggerKey, 'close'));
      const createAt = (parentId: string | null) => sync.flush().then(async () => {
        const id = await createPage({ parentId, title: choice.title, open: false });
        if (id) {
          const pos = Math.min(from, view.state.doc.content.size);
          view.dispatch(view.state.tr.insert(pos, [schema.nodes.mention.create({ pageId: id, text: choice.title || t("새 페이지") }), schema.text(' ')]));
          view.focus();
        }
      });
      // "위치를 선택해 새 페이지 추가": pick where the new page lives (개인 페이지 at the top), then mention it.
      if (choice.kind === 'new-page-at') openWorkspaceDialog('pick-page', { title: t("새 페이지 위치"), placeholder: t("페이지에 추가…"), allowRoot: true, onPick: (page: { id: string } | null) => createAt(page?.id ?? null) });
      else createAt(pageId).catch(report);
    }
  };

  useEffect(() => {
    if (!view) return;
    const onDate = (event: Event) => { if (!readOnlyRef.current) setDateEdit((event as CustomEvent<{ pos: number; rect: DOMRect }>).detail); };
    view.dom.addEventListener(dateMentionEvent, onDate);
    return () => view.dom.removeEventListener(dateMentionEvent, onDate);
  }, [view]);

  // A date mention's new day, format or reminder. The reminder is a reminder on the block; a changed one replaces it.
  const updateDate = (pos: number, next: DateAttrs) => {
    if (!view || !sync) return;
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== 'date_mention') return;
    const info = blockAt(view.state.doc.resolve(pos));
    let reminderId = node.attrs.reminderId as string | null;
    const operations: Operation[] = [];
    if (reminderId && (next.remind === null || next.date !== node.attrs.date || next.remind !== node.attrs.remind)) {
      if (workspace.get(reminderId)?.alive) operations.push({ type: 'node.trash', id: reminderId });
      reminderId = null;
    }
    const due = dateMentionDue(next.date, next.remind);
    if (due && !reminderId && info) {
      reminderId = newId();
      operations.push({ type: 'reminder.set', id: reminderId, parentId: info.node.attrs.id, at: due.toISOString(), offsetMinutes: 0, message: plainMessage(info.node) });
    }
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, date: next.date, format: next.format, remind: next.remind, reminderId, zone: next.zone, text: zonedMentionLabel(next.date, next.format, next.zone) }));
    if (operations.length) sync.flush().then(() => apply(operations)).catch(report);
  };
  const removeDate = (pos: number) => {
    if (!view) return;
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== 'date_mention') return;
    if (node.attrs.reminderId && workspace.get(node.attrs.reminderId)?.alive) sync?.flush().then(() => apply([{ type: 'node.trash', id: node.attrs.reminderId }])).catch(report);
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
    view.focus();
  };

  // After a pasted address: keep the link, or turn it into a mention, a bookmark or an embed.
  const chooseUrlPaste = async (choice: PasteChoice) => {
    const paste = urlPaste;
    setUrlPaste(null);
    if (!view || !sync || !paste || choice === 'link') return;
    const intact = () => paste.to <= view.state.doc.content.size && view.state.doc.textBetween(paste.from, paste.to) === paste.url;
    if (!intact()) return;
    if (choice === 'mention') {
      const { title, icon, site, description } = await linkMention(paste.url);
      if (!intact()) return;
      view.dispatch(view.state.tr.replaceWith(paste.from, paste.to, schema.nodes.link_mention.create({ href: paste.url, text: title, icon, site, description })));
      view.focus();
      return;
    }
    const info = blockAt(view.state.doc.resolve(paste.from));
    view.dispatch(view.state.tr.delete(paste.from, paste.to));
    if (!info) return;
    await sync.flush();
    const id = info.node.attrs.id as string, current = workspace.get<BlockEntity>(id);
    if (!current) return;
    const empty = !plainText(current.richText).trim();
    let target = id;
    if (empty) await sync.command([{ type: 'block.update', id, blockType: choice, url: paste.url, richText: [] }]);
    else {
      target = newId();
      const siblings = workspace.children(current.parentId), next = siblings[siblings.findIndex(item => item.id === id) + 1];
      await sync.command([{ type: 'block.create', id: target, parentId: current.parentId!, blockType: choice, url: paste.url, richText: [], ...(next ? { beforeId: next.id } : {}) }]);
    }
    if (choice === 'bookmark') bookmarkFor(paste.url).then(bookmark => sync.command([{ type: 'block.update', id: target, bookmark }])).catch(report);
  };

  const atoms = registry.list();

  return (
    <div className={`page-editor-wrap${className ? ` ${className}` : ''}`} data-page-id={pageId}>
      {status.state === 'conflict' || status.state === 'offline' ? (
        <div className={`sync-banner sync-${status.state}`} role="status">
          <span>{status.message}</span>
          {status.state === 'conflict' ? (
            <span className="sync-actions">
              <button type="button" className="text-button" onClick={() => sync?.keepLocal().catch(report)}>{t("내 입력을 최신 내용에 적용")}</button>
              <button type="button" className="text-button" onClick={() => sync?.discardLocal()}>{t("최신 내용 보기")}</button>
            </span>
          ) : status.state === 'offline' ? (
            <span className="sync-actions"><button type="button" className="text-button" onClick={() => sync?.retry().catch(report)}>{t("다시 저장")}</button></span>
          ) : null}
        </div>
      ) : null}
      <div ref={mountRef} className="page-editor-mount" />
      <div className="page-editor-tail no-marquee" onMouseDown={event => { if (readOnly) return; event.preventDefault(); focusEnd(view); }} />
      {view && sync ? atoms.map(entry => createPortal(<AtomBoundary>{renderAtom({ entry, view, pageId, sync })}</AtomBoundary>, entry.dom, `atom-${entry.key}`)) : null}
      <ColumnResizer view={view} scroller={scroller} disabled={readOnly} />
      <LinkHover view={view} scroller={scroller} readOnly={readOnly} />
      <Discussions view={view} scroller={scroller} readOnly={readOnly} mode={inlineComments} flush={() => sync?.flush() ?? Promise.resolve()} />
      <BlockHandles view={view} scroller={scroller} disabled={readOnly || !!blockMenu} onMenu={(anchor, _info) => setBlockMenu({ anchor: anchor.getBoundingClientRect(), placement: 'left-center' })}
        onSideDrop={(ids, targetId, side) => { dropBesides(ids, targetId, side, () => sync?.flush() ?? Promise.resolve()); }} />
      {view && trigger?.kind === 'slash' ? (
        <SlashMenu ref={keyTarget} anchor={{ x: trigger.x, y: trigger.y, height: trigger.height }} query={trigger.query} onChoose={chooseSlash}
          onClose={() => closeTriggerMenu(false)}
          onMiss={count => { if (count && trigger.query.length > 3 && /\s$/.test(trigger.query)) closeTriggerMenu(false); }} />
      ) : null}
      {view && trigger?.kind === 'emoji' && (trigger.query || trigger.full) ? (
        <EmojiMenu ref={keyTarget} anchor={{ x: trigger.x, y: trigger.y, height: trigger.height }} query={trigger.query} onChoose={chooseEmoji} onClose={() => closeTriggerMenu(false)} />
      ) : null}
      {view && (trigger?.kind === 'mention' || trigger?.kind === 'link') ? (
        <MentionMenu ref={keyTarget} anchor={{ x: trigger.x, y: trigger.y, height: trigger.height }} query={trigger.query} links={trigger.kind === 'link'} onChoose={chooseMention} onClose={() => closeTriggerMenu(false)} />
      ) : null}
      {view && textMenu ? (
        <TextActionMenu view={view} anchor={textMenu} onClose={() => setTextMenu(null)}
          onLink={() => { const coords = view.coordsAtPos(view.state.selection.to); setTextMenu(null); setLinkAt({ x: coords.left, y: coords.bottom + 8 }); }}
          onBlockMenu={anchor => { const infos = selectedOrCurrentBlocks(view.state); setTextMenu(null); setBlockSelection(view, infos.map(info => info.node.attrs.id)); setBlockMenu({ anchor: anchor.getBoundingClientRect(), placement: 'below-start' }); }} />
      ) : null}
      {view && linkAt ? <LinkPopover view={view} anchor={linkAt} onClose={() => setLinkAt(null)} /> : null}
      {view && blockMenu && sync ? (
        <BlockMenu view={view} pageId={pageId} anchor={blockMenu.anchor} placement={blockMenu.placement} flush={() => sync.flush()} command={operations => sync.command(operations)}
          onClose={() => { setBlockMenu(null); }} />
      ) : null}
      {view && calloutIcon ? (
        <EmojiPicker anchor={calloutIcon.anchor} upload onClose={() => setCalloutIcon(null)}
          onPick={emoji => { const node = view.state.doc.nodeAt(calloutIcon.pos); if (node?.type.name === 'text_block') view.dispatch(view.state.tr.setNodeMarkup(calloutIcon.pos, undefined, { ...node.attrs, icon: emoji })); }}
          onRemove={() => { const node = view.state.doc.nodeAt(calloutIcon.pos); if (node?.type.name === 'text_block') view.dispatch(view.state.tr.setNodeMarkup(calloutIcon.pos, undefined, { ...node.attrs, icon: '' })); }} />
      ) : null}
      {mermaid?.action === 'mode' ? <MermaidModePicker anchor={mermaid.anchor} id={mermaid.id} onClose={() => setMermaid(null)} /> : null}
      {mermaid?.action === 'expand' ? <MermaidViewer source={mermaid.anchor} onClose={() => setMermaid(null)} /> : null}
      {view && equation ? (
        <InlineEquationEditor anchor={equation.anchor} initial={equation.initial}
          onDraft={tex => equationViewFor(view.nodeDOM(equation.pos) as Element | null)?.preview(tex)}
          onClose={tex => {
            const { pos } = equation;
            equationViewFor(view.nodeDOM(pos) as Element | null)?.preview(null);
            setEquation(null);
            const node = view.state.doc.nodeAt(pos);
            if (node?.type.name !== 'equation') return;
            const value = tex.trim();
            const tr = value ? (value === node.attrs.tex ? view.state.tr : view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, tex: value })) : view.state.tr.delete(pos, pos + node.nodeSize);
            tr.setSelection(TextSelection.create(tr.doc, value ? pos + 1 : pos));
            view.dispatch(tr);
            view.focus();
          }} />
      ) : null}
      {view && dateEdit ? (() => {
        const node = view.state.doc.nodeAt(dateEdit.pos);
        if (node?.type.name !== 'date_mention') return null;
        return <DateMentionEditor anchor={dateEdit.rect} attrs={{ date: node.attrs.date, format: node.attrs.format, remind: node.attrs.remind, zone: node.attrs.zone ?? null }} onChange={next => updateDate(dateEdit.pos, next)} onRemove={() => removeDate(dateEdit.pos)} onClose={() => setDateEdit(null)} />;
      })() : null}
      {view && urlPaste ? <PasteUrlMenu anchor={{ x: urlPaste.x, y: urlPaste.y }} onChoose={choice => { chooseUrlPaste(choice).catch(report); }} onClose={() => setUrlPaste(null)} /> : null}
      {view && language ? (
        <Menu anchor={language.anchor} width={220} search={t("언어 검색…")} maxHeight={360} label={t("코드 언어")} onClose={() => setLanguage(null)}
          entries={codeLanguages.map(code => ({ label: languageLabels[code] ?? code, keywords: code, checked: code === language.current, onSelect: () => {
            const node = view.state.doc.nodeAt(language.pos);
            if (node?.type.name === 'code_block') view.dispatch(view.state.tr.setNodeMarkup(language.pos, undefined, { ...node.attrs, language: code }));
          } }))} />
      ) : null}
    </div>
  );
});

// Click below the content: continue in an empty line at the end (created when needed).
function focusEnd(editor: EditorView | null) {
  if (!editor) return;
  const last = editor.state.doc.lastChild;
  const tr = editor.state.tr;
  if (!last || !(last.type.name === 'text_block' && last.content.size === 0 && last.attrs.blockType === 'paragraph' && (last.attrs.depth ?? 0) === 0)) tr.insert(editor.state.doc.content.size, newTextBlock());
  tr.setSelection(Selection.atEnd(tr.doc));
  tr.setMeta(blockSelectionKey, { ids: [], anchor: null, head: null });
  editor.dispatch(tr.scrollIntoView());
  editor.focus();
}

function plainMessage(node: PMNode) {
  return node.textContent.trim().slice(0, 200) || t("reminder|알림");
}

export type { BlockInfo };
