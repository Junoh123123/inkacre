import { t } from '../i18n';
import { Plugin, PluginKey, TextSelection, NodeSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Node as PMNode, MarkType } from 'prosemirror-model';
import { schema } from './schema';
import { blockAt, isBlockNode, isFlat, registerSelectedBlocks, subtreeEnd, type BlockInfo, newTextBlock } from './blocks';
import { newBlockId } from './convert';

// ---------------- block selection (blue halo) ----------------

export interface BlockSelectionState { ids: string[]; anchor: string | null; head: string | null }
export const blockSelectionKey = new PluginKey<BlockSelectionState>('blockSelection');

export function flatBlocks(doc: PMNode): Array<{ node: PMNode; pos: number }> {
  const result: Array<{ node: PMNode; pos: number }> = [];
  doc.descendants((node, pos) => {
    if (isFlat(node)) { result.push({ node, pos }); return false; }
    if (node.type.name === 'columns' || node.type.name === 'tabs') { result.push({ node, pos }); return true; }
    return true;
  });
  return result;
}

export function selectedBlockInfos(state: EditorState): BlockInfo[] {
  const ids = new Set(blockSelectionKey.getState(state)?.ids ?? []);
  if (!ids.size) return [];
  const infos: BlockInfo[] = [];
  for (const { node, pos } of flatBlocks(state.doc)) {
    if (!ids.has(node.attrs.id) || !isBlockNode(node)) continue;
    const info = blockAt(state.doc.resolve(pos + (node.isLeaf || node.type.name === 'tabs' ? 0 : 1)));
    if (info) infos.push(info);
  }
  return infos;
}
registerSelectedBlocks(selectedBlockInfos);

export function setBlockSelection(view: EditorView, ids: string[], anchor: string | null = ids[0] ?? null, head: string | null = ids[ids.length - 1] ?? null) {
  const tr = view.state.tr.setMeta(blockSelectionKey, { ids, anchor, head });
  if (ids.length) {
    // Park the caret so typing does not change text while blocks are selected.
    const first = flatBlocks(view.state.doc).find(item => item.node.attrs.id === ids[0]);
    if (first && first.node.isTextblock) tr.setSelection(TextSelection.create(tr.doc, first.pos + 1));
    else if (first) tr.setSelection(NodeSelection.create(tr.doc, first.pos));
    tr.setMeta('keepBlockSelection', true);
  }
  view.dispatch(tr);
}

export const blockSelectionPlugin = new Plugin<BlockSelectionState>({
  key: blockSelectionKey,
  state: {
    init: () => ({ ids: [], anchor: null, head: null }),
    apply(tr, value, _old, state) {
      const meta = tr.getMeta(blockSelectionKey) as BlockSelectionState | undefined;
      if (meta) return meta;
      const copies = tr.getMeta('selectCopies') as string[] | undefined;
      if (copies?.length) return { ids: copies, anchor: copies[0], head: copies[copies.length - 1] };
      if (!value.ids.length) return value;
      if (tr.docChanged) {
        const present = new Set(flatBlocks(state.doc).map(item => item.node.attrs.id));
        const ids = value.ids.filter(id => present.has(id));
        if (ids.length !== value.ids.length) return { ids, anchor: ids[0] ?? null, head: ids[ids.length - 1] ?? null };
      }
      if (tr.selectionSet && !tr.getMeta('keepBlockSelection') && !tr.getMeta('sync')) return { ids: [], anchor: null, head: null };
      return value;
    },
  },
  props: {
    decorations(state) {
      const ids = new Set(blockSelectionKey.getState(state)?.ids ?? []);
      if (!ids.size) return null;
      const decorations: Decoration[] = [];
      for (const { node, pos } of flatBlocks(state.doc)) if (ids.has(node.attrs.id)) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'block-selected' }));
      return DecorationSet.create(state.doc, decorations);
    },
    attributes(state): Record<string, string> {
      return (blockSelectionKey.getState(state)?.ids.length ?? 0) ? { class: 'has-block-selection' } : {};
    },
  },
});

// ---------------- toggles, numbering, placeholders ----------------

export const collapsedKey = new PluginKey<Set<string>>('collapsed');
const storageKey = 'pageyard-toggle-open-v2';
function loadOpen(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]')); } catch { return new Set(); } }
// Toggles are closed unless the user opened them.
export const openToggles = loadOpen();
export function setToggleOpen(view: EditorView, id: string, open: boolean) {
  if (open) openToggles.add(id); else openToggles.delete(id);
  try { localStorage.setItem(storageKey, JSON.stringify([...openToggles].slice(-5000))); } catch { /* ignore */ }
  view.dispatch(view.state.tr.setMeta(collapsedKey, 'changed'));
}
export const isCollapsed = (id: string) => !openToggles.has(id);
// ⌘⌥T: open every toggle on the page, or close them all when none is closed.
export function toggleAll(view: EditorView) {
  const ids: string[] = [];
  view.state.doc.descendants(node => { if (isToggleNode(node) && node.attrs.id) ids.push(node.attrs.id); return true; });
  if (!ids.length) return;
  const open = ids.some(isCollapsed);
  for (const id of ids) if (open) openToggles.add(id); else openToggles.delete(id);
  try { localStorage.setItem(storageKey, JSON.stringify([...openToggles].slice(-5000))); } catch { /* ignore */ }
  view.dispatch(view.state.tr.setMeta(collapsedKey, 'changed'));
}
export { isToggleNode } from './schema';
import { isToggleNode } from './schema';

const listTypeNames = new Set(['bullet', 'numbered', 'todo', 'toggle']);
const roman = (value: number) => { const map: Array<[number, string]> = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let out = ''; for (const [n, s] of map) while (value >= n) { out += s; value -= n; } return out; };
const letters = (value: number) => { let out = ''; while (value > 0) { value--; out = String.fromCharCode(97 + (value % 26)) + out; value = Math.floor(value / 26); } return out; };
export function listMarker(depth: number, number: number, format?: string | null) {
  if (format === 'numbers') return `${number}.`;
  if (format === 'letters') return `${letters(number)}.`;
  if (format === 'roman') return `${roman(number)}.`;
  const level = depth % 3;
  return level === 0 ? `${number}.` : level === 1 ? `${letters(number)}.` : `${roman(number)}.`;
}

export const placeholders: Record<string, string> = {
  paragraph: t("명령어 사용 시 '/' 입력"), heading1: t("제목1"), heading2: t("제목2"), heading3: t("제목3"), heading4: t("제목4"), bullet: t("리스트"), numbered: t("리스트"), todo: t("할 일"),
  toggle: t("토글"), quote: t("빈 인용"), callout: t("내용을 입력하세요"),
};

function decorateContainer(container: PMNode, start: number, state: EditorState, decorations: Decoration[], focusId: string | null) {
  const counters: number[] = [];
  const formats: (string | null)[] = [];
  const lastType: Array<string | null> = [];
  // Horizontal offset per depth: children start at the parent's text (+32 under list items, +30 under text).
  const indents: number[] = [0];
  const ownerType: string[] = [];
  let previousList = false;
  let hiddenUntilDepth = Infinity;
  let syncedDepth = Infinity;
  let syncedRoot = '';
  // A callout's nested blocks sit inside its box (callouts hold blocks).
  let calloutDepth = Infinity;
  let calloutColor = '';
  let calloutIndent = 0;
  let syncedIndent = 0;
  // Synced blocks: which root each block belongs to, and the roots the caret is in (their
  // outline shows while the caret is inside).
  const focusedRoots = new Set<string>();
  {
    let rootDepth = Infinity, root = '';
    container.forEach(node => {
      if (node.type.name === 'columns' || node.type.name === 'tabs') { rootDepth = Infinity; root = ''; return; }
      const depth = node.attrs.depth ?? 0;
      if (depth <= rootDepth) { rootDepth = Infinity; root = ''; }
      if (node.type.name === 'atom_block' && node.attrs.blockType === 'synced') { rootDepth = depth; root = node.attrs.id; }
      if (root && node.attrs.id === focusId) focusedRoots.add(root);
    });
  }
  let pos = start;
  container.forEach((node, _offset, index) => {
    const end = pos + node.nodeSize;
    if (node.type.name === 'columns') {
      let columnPos = pos + 1;
      node.forEach(column => { decorateContainer(column, columnPos + 1, state, decorations, focusId); columnPos += column.nodeSize; });
      hiddenUntilDepth = Infinity;
      pos = end;
      return;
    }
    if (node.type.name === 'tabs') {
      // The tabs block is indented like any block; each tab is its own container. A tab whose only
      // content is an empty line not being edited shows "빈 탭입니다…" in its place.
      const depth = node.attrs.depth ?? 0;
      if (depth <= hiddenUntilDepth - 1) hiddenUntilDepth = Infinity;
      const indentPx = depth === 0 ? 0 : (indents[depth - 1] ?? 0) + (listTypeNames.has(ownerType[depth - 1] ?? '') || ownerType[depth - 1] === 'toggle-heading' ? 32 : 30);
      decorations.push(Decoration.node(pos, end, depth >= hiddenUntilDepth ? { class: 'block-hidden' } : {}, { indent: indentPx }));
      let tabPos = pos + 1;
      node.forEach(tab => {
        const only = tab.childCount === 1 ? tab.firstChild : null;
        if (only && only.type.name === 'text_block' && only.attrs.blockType === 'paragraph' && only.content.size === 0 && only.attrs.id !== focusId) {
          decorations.push(Decoration.node(tabPos + 1, tabPos + 1 + only.nodeSize, { class: 'tab-empty-line' }));
          decorations.push(Decoration.widget(tabPos + 1, () => {
            const hint = document.createElement('div');
            hint.className = 'tab-empty-hint';
            hint.contentEditable = 'false';
            hint.setAttribute('role', 'button');
            hint.dataset.tabLine = only.attrs.id;
            hint.textContent = t("빈 탭입니다. 클릭하여 편집하거나 블록을 끌어다 놓으세요.");
            return hint;
          }, { side: -1, key: `tab-hint-${only.attrs.id}`, ignoreSelection: true }));
        } else decorateContainer(tab, tabPos + 1, state, decorations, focusId);
        tabPos += tab.nodeSize;
      });
      previousList = false;
      pos = end;
      return;
    }
    const depth = node.attrs.depth ?? 0;
    // A synced block's content lines up with the block itself (inside its outline).
    const indentPx = depth === 0 ? 0 : (indents[depth - 1] ?? 0) + (ownerType[depth - 1] === 'synced' ? 0 : listTypeNames.has(ownerType[depth - 1] ?? '') || ownerType[depth - 1] === 'toggle-heading' ? 32 : 30);
    indents[depth] = indentPx; indents.length = depth + 1;
    const ownType = isToggleNode(node) && node.attrs.blockType !== 'toggle' ? 'toggle-heading' : node.type.name === 'text_block' ? node.attrs.blockType as string : node.type.name === 'atom_block' && node.attrs.blockType === 'synced' ? 'synced' : node.type.name;
    ownerType[depth] = ownType; ownerType.length = depth + 1;
    if (depth <= hiddenUntilDepth - 1) hiddenUntilDepth = Infinity;
    if (depth <= syncedDepth) syncedDepth = Infinity;
    if (depth <= calloutDepth) calloutDepth = Infinity;
    counters.length = depth + 1; lastType.length = depth + 1;
    const classes: string[] = [];
    const spec: Record<string, unknown> = {};
    spec.indent = indentPx;
    const isList = listTypeNames.has(ownType);
    if (isList) {
      if (!previousList) classes.push('list-start');
      const next = container.maybeChild(index + 1);
      const nextList = !!next && next.type.name === 'text_block' && listTypeNames.has(next.attrs.blockType);
      if (!nextList) classes.push('list-end');
    }
    previousList = isList;
    if (depth >= hiddenUntilDepth) classes.push('block-hidden');
    const attrs: Record<string, string> = {};
    if (depth > syncedDepth) {
      classes.push('in-synced');
      spec.syncedLeft = indentPx - syncedIndent;
      const next = container.maybeChild(index + 1);
      if (!next || next.type.name === 'columns' || next.type.name === 'tabs' || (next.attrs.depth ?? 0) <= syncedDepth) classes.push('synced-last');
      attrs['data-synced'] = syncedRoot;
      if (focusedRoots.has(syncedRoot)) classes.push('synced-on');
    }
    if (depth > calloutDepth) {
      classes.push('in-callout');
      attrs.style = `--callout-left:${calloutIndent}px`;
      if (calloutColor) attrs['data-callout-color'] = calloutColor;
      const next = container.maybeChild(index + 1);
      if (!next || next.type.name === 'columns' || next.type.name === 'tabs' || (next.attrs.depth ?? 0) <= calloutDepth) classes.push('callout-last');
    }
    if (node.type.name === 'text_block' && node.attrs.blockType === 'callout' && calloutDepth === Infinity) {
      const next = container.maybeChild(index + 1);
      if (next && isBlockNode(next) && (next.attrs.depth ?? 0) > depth) { classes.push('callout-open'); calloutDepth = depth; calloutColor = node.attrs.color ?? ''; calloutIndent = indentPx; }
    }
    if (node.type.name === 'text_block') {
      const type = node.attrs.blockType as string;
      if (type === 'numbered') {
        counters[depth] = lastType[depth] === 'numbered' ? (counters[depth] ?? 0) + 1 : 1;
        // A list keeps the format of its first item (a run at one depth is one list).
        if (counters[depth] === 1) formats[depth] = node.attrs.listFormat ?? null;
        spec.marker = listMarker(depth, counters[depth], formats[depth]);
      }
      if (type === 'bullet') spec.marker = ['•', '◦', '▪'][depth % 3];
      if (node.content.size === 0) {
        if (type !== 'paragraph' || node.attrs.id === focusId) { classes.push('is-empty'); spec.placeholder = placeholders[type] ?? ''; }
      }
      if (isToggleNode(node)) {
        const collapsed = isCollapsed(node.attrs.id);
        classes.push(collapsed ? 'toggle-closed' : 'toggle-open');
        spec.open = !collapsed;
        if (collapsed && depth < hiddenUntilDepth) hiddenUntilDepth = depth + 1;
        const next = container.maybeChild(index + 1);
        const hasChildren = !!next && isBlockNode(next) && (next.attrs.depth ?? 0) > depth;
        if (!collapsed && !hasChildren) decorations.push(Decoration.widget(end, () => {
          const hint = document.createElement('div');
          hint.className = 'toggle-empty-hint';
          hint.style.marginLeft = `${indentPx + 32 + 8}px`;
          hint.contentEditable = 'false';
          hint.dataset.toggleId = node.attrs.id;
          hint.textContent = t("빈 토글입니다. 클릭하거나 블록을 여기로 드래그하세요.");
          return hint;
        }, { side: -1, key: `toggle-hint-${node.attrs.id}`, ignoreSelection: true }));
      }
      lastType[depth] = type;
    } else {
      lastType[depth] = null;
      if (node.type.name === 'atom_block' && node.attrs.blockType === 'synced') {
        syncedDepth = depth; syncedRoot = node.attrs.id; syncedIndent = indentPx;
        classes.push('synced-root');
        attrs['data-synced'] = node.attrs.id;
        if (focusedRoots.has(node.attrs.id)) classes.push('synced-on');
      }
    }
    decorations.push(Decoration.node(pos, end, classes.length ? { class: classes.join(' '), ...attrs } : attrs, spec));
    pos = end;
  });
}

export const blockDecorationsPlugin = new Plugin({
  key: collapsedKey as unknown as PluginKey,
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];
      const { $from } = state.selection;
      const focus = blockAt($from);
      decorateContainer(state.doc, 0, state, decorations, state.selection.empty ? focus?.node.attrs.id ?? null : null);
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

// ---------------- "/" and "@" triggers ----------------

// "/" opens the block menu, "@" the mention menu, and "+" or "[[" the page-link menu (link to a
// page or make a new one; listed under 명령어 in the keyboard shortcuts window).
// ":" starts an emoji search (its picker shows once a letter follows, or at once from /emoji).
export interface TriggerState { kind: 'slash' | 'mention' | 'link' | 'emoji' | null; from: number; query: string; misses: number; token?: string; full?: boolean }
export const triggerKey = new PluginKey<TriggerState>('trigger');
const closed: TriggerState = { kind: null, from: 0, query: '', misses: 0 };

export const triggerPlugin = new Plugin<TriggerState>({
  key: triggerKey,
  state: {
    init: () => closed,
    apply(tr, value, _old, state) {
      const meta = tr.getMeta(triggerKey) as Partial<TriggerState> | 'close' | undefined;
      if (meta === 'close') return closed;
      let next = value;
      if (meta && meta.kind) next = { kind: meta.kind, from: meta.from ?? 0, query: '', misses: 0, token: meta.token ?? (meta.kind === 'slash' ? '/' : meta.kind === 'mention' ? '@' : meta.kind === 'emoji' ? ':' : '+'), full: !!meta.full };
      if (!next.kind) return next;
      const from = tr.mapping.map(next.from, -1);
      const head = state.selection.head;
      if (!state.selection.empty || head <= from || head > state.doc.content.size) return closed;
      const $from = state.doc.resolve(from + 1), $head = state.doc.resolve(head);
      if (!$from.sameParent($head)) return closed;
      const token = next.token ?? (next.kind === 'slash' ? '/' : next.kind === 'mention' ? '@' : next.kind === 'emoji' ? ':' : '+');
      if (head < from + token.length || state.doc.textBetween(from, from + token.length) !== token) return closed;
      const query = state.doc.textBetween(from + token.length, head, '\n');
      if (query.includes('\n') || query.length > 48 || (next.kind !== 'slash' && /\s{2}/.test(query))) return closed;
      if (next.kind === 'link' && token === '+' && /^\s/.test(query)) return closed; // "+ " starts a bullet instead
      if (next.kind === 'emoji' && (/\s/.test(query) || query.length > 30)) return closed;
      return { ...next, from, query, misses: meta && typeof meta === 'object' && 'misses' in meta ? meta.misses ?? next.misses : next.misses };
    },
  },
  props: {
    decorations(state) {
      const value = triggerKey.getState(state);
      if (!value?.kind) return null;
      const head = state.selection.head;
      const decorations = [Decoration.inline(value.from, head, { class: 'trigger-query' })];
      // The hint shows only at the end of a block: before existing text a widget would pull the caret past it.
      const $head = state.selection.$head;
      if (!value.query && value.kind === 'slash' && $head.parentOffset === $head.parent.content.size) decorations.push(Decoration.widget(head, () => {
        const span = document.createElement('span');
        span.className = 'trigger-placeholder';
        span.textContent = t("입력하여 필터링…");
        return span;
      }, { side: 1 }));
      return DecorationSet.create(state.doc, decorations);
    },
    handleTextInput(view, from, to, text) {
      if (text !== '/' && text !== '@' && text !== '+' && text !== '[' && text !== ':') return false;
      const $from = view.state.doc.resolve(from);
      if (!$from.parent.isTextblock || $from.parent.type.name === 'code_block') return false;
      // The menus open only at the start of a block or after a space (typing
      // "10/24", "a/b" or "1+1" stays plain text). "[[" opens the link menu on its second bracket.
      const offset = $from.parentOffset;
      if (text === '[') {
        const prev = $from.parent.textBetween(Math.max(0, offset - 1), offset);
        const before = $from.parent.textBetween(Math.max(0, offset - 2), Math.max(0, offset - 1));
        if (prev !== '[' || (offset > 1 && !/\s/.test(before))) return false;
        const tr = view.state.tr.insertText(text, from, to);
        tr.setSelection(TextSelection.create(tr.doc, from + text.length));
        tr.setMeta(triggerKey, { kind: 'link', from: from - 1, token: '[[' });
        view.dispatch(tr);
        return true;
      }
      const before = $from.parent.textBetween(Math.max(0, offset - 1), offset);
      if (before && !/\s/.test(before)) return false;
      // The caret goes right after the typed character: the state's selection may not have caught up with a caret
      // just moved (Home, a click), and mapping it would leave the caret where it was.
      const tr = view.state.tr.insertText(text, from, to);
      tr.setSelection(TextSelection.create(tr.doc, from + text.length));
      tr.setMeta(triggerKey, { kind: text === '/' ? 'slash' : text === '@' ? 'mention' : text === ':' ? 'emoji' : 'link', from, token: text });
      view.dispatch(tr);
      return true;
    },
  },
});

export function closeTrigger(view: EditorView, { removeText = false } = {}) {
  const value = triggerKey.getState(view.state);
  if (!value?.kind) return;
  const tr = view.state.tr.setMeta(triggerKey, 'close');
  if (removeText) tr.delete(value.from, view.state.selection.head);
  view.dispatch(tr);
}

// ---------------- Markdown-style shortcuts ----------------

function blockRule(pattern: RegExp, apply: (match: RegExpMatchArray) => { blockType: string; checked?: boolean; listFormat?: string } | 'divider' | 'code') {
  return new InputRule(pattern, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    const info = blockAt($start);
    if (!info || info.node.type.name !== 'text_block' || $start.parentOffset !== 0) return null;
    if (info.node.attrs.blockType !== 'paragraph' && !(info.node.attrs.blockType === 'bullet' && /^\[/.test(match[0]))) return null;
    const result = apply(match);
    const tr = state.tr.delete(start, end);
    if (result === 'divider') {
      const node = tr.doc.nodeAt(info.pos)!;
      const divider = schema.nodes.atom_block.create({ id: newBlockId(), depth: node.attrs.depth, blockType: 'divider' });
      if (node.content.size === 0) {
        tr.replaceWith(info.pos, info.pos + node.nodeSize, [divider, newTextBlock({ depth: node.attrs.depth })]);
        tr.setSelection(TextSelection.create(tr.doc, info.pos + divider.nodeSize + 1));
      } else {
        tr.insert(info.pos, divider);
      }
      return tr;
    }
    if (result === 'code') {
      const node = tr.doc.nodeAt(info.pos)!;
      tr.replaceWith(info.pos, info.pos + node.nodeSize, schema.nodes.code_block.create({ id: node.attrs.id, depth: node.attrs.depth }, node.textContent ? schema.text(node.textContent) : undefined));
      tr.setSelection(TextSelection.create(tr.doc, info.pos + 1));
      return tr;
    }
    tr.setNodeMarkup(info.pos, undefined, { ...info.node.attrs, blockType: result.blockType, checked: !!result.checked, listFormat: result.listFormat ?? null });
    return tr;
  });
}

function markRule(pattern: RegExp, markType: MarkType) {
  return new InputRule(pattern, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type.name === 'code_block') return null;
    const full = match[0], inner = match[1];
    const textStart = start + full.indexOf(inner);
    const textEnd = textStart + inner.length;
    const tr = state.tr;
    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > start) tr.delete(start, textStart);
    const markEnd = start + inner.length;
    tr.addMark(start, markEnd, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

export const markdownRules = inputRules({
  rules: [
    blockRule(/^#\s$/, () => ({ blockType: 'heading1' })),
    blockRule(/^##\s$/, () => ({ blockType: 'heading2' })),
    blockRule(/^####\s$/, () => ({ blockType: 'heading4' })),
    blockRule(/^###\s$/, () => ({ blockType: 'heading3' })),
    blockRule(/^[-*+•]\s$/, () => ({ blockType: 'bullet' })),
    blockRule(/^1[.)]\s$/, () => ({ blockType: 'numbered' })),
    // A lettered or roman list also starts from "a. " / "i. ".
    blockRule(/^[aA][.)]\s$/, () => ({ blockType: 'numbered', listFormat: 'letters' })),
    blockRule(/^[iI][.)]\s$/, () => ({ blockType: 'numbered', listFormat: 'roman' })),
    blockRule(/^(?:\[\]|\[ \])\s$/, () => ({ blockType: 'todo' })),
    blockRule(/^\[[xX]\]\s$/, () => ({ blockType: 'todo', checked: true })),
    blockRule(/^>\s$/, () => ({ blockType: 'toggle' })),
    blockRule(/^["“”]\s$/, () => ({ blockType: 'quote' })),
    blockRule(/^---$/, () => 'divider'),
    blockRule(/^```$/, () => 'code'),
    markRule(/\*\*([^*\s][^*]*[^*\s]|[^*\s])\*\*$/, schema.marks.bold),
    markRule(/(?<![*\w])\*([^*\s][^*]*[^*\s]|[^*\s])\*$/, schema.marks.italic),
    markRule(/(?<![_\w])_([^_\s][^_]*[^_\s]|[^_\s])_$/, schema.marks.italic),
    markRule(/`([^`]+)`$/, schema.marks.code),
    markRule(/~~([^~]+)~~$/, schema.marks.strike),
    // "$$E=mc^2$$" becomes an inline equation.
    new InputRule(/\$\$([^$]+)\$\$$/, (state, match, start, end) => {
      if (state.doc.resolve(start).parent.type.name === 'code_block') return null;
      return state.tr.replaceWith(start, end, schema.nodes.equation.create({ tex: match[1].trim() }));
    }),
    markRule(/(?<![~\w])~([^~\s][^~]*[^~\s]|[^~\s])~$/, schema.marks.strike),
  ],
});

// ---------------- helpers ----------------

export function blockRangeOf(state: EditorState, id: string): { from: number; to: number; node: PMNode } | null {
  for (const { node, pos } of flatBlocks(state.doc)) if (node.attrs.id === id) return { from: pos, to: pos + node.nodeSize, node };
  return null;
}

export function deleteBlocks(state: EditorState, infos: BlockInfo[], dispatch: (tr: Transaction) => void) {
  if (!infos.length) return false;
  const tr = state.tr;
  // Merge nested/overlapping subtrees, then delete back to front.
  const sorted = infos.map(info => ({ from: info.pos, to: subtreeEnd(info).end })).sort((a, b) => a.from - b.from);
  const ranges: Array<{ from: number; to: number }> = [];
  for (const range of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && range.from < last.to) last.to = Math.max(last.to, range.to);
    else ranges.push({ ...range });
  }
  for (const range of [...ranges].reverse()) tr.delete(range.from, range.to);
  if (tr.doc.childCount === 0) tr.insert(0, newTextBlock({ virtual: true }));
  tr.setMeta(blockSelectionKey, { ids: [], anchor: null, head: null });
  const at = Math.min(ranges[0].from, tr.doc.content.size);
  const $at = tr.doc.resolve(at);
  tr.setSelection(TextSelection.near($at, -1));
  dispatch(tr);
  return true;
}

// ---------------- unique block ids ----------------
// ProseMirror splits and pastes copy node attributes; every block must keep its own id.
export const uniqueIdsPlugin = new Plugin({
  appendTransaction(transactions, _old, state) {
    if (!transactions.some(tr => tr.docChanged)) return null;
    const seen = new Set<string>();
    let tr: Transaction | null = null;
    state.doc.descendants((node, pos) => {
      if (!('id' in node.attrs) || node.isInline) return true;
      const id = node.attrs.id as string;
      if (!id || seen.has(id)) {
        tr ??= state.tr;
        const fresh = newBlockId();
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh, ...(node.attrs.virtual ? { virtual: false } : {}) });
        seen.add(fresh);
      } else seen.add(id);
      return node.type.name === 'columns' || node.type.name === 'column' || node.type.name === 'tabs' || node.type.name === 'tab';
    });
    if (tr) (tr as Transaction).setMeta('addToHistory', true);
    return tr;
  },
});
