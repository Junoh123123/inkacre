import { t } from '../i18n';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import { newBlockId } from './convert';

// Tabs block: "/탭" makes three tabs 탭1 · 탭2 · 탭3, the first shown.
// Which tab is shown is kept per browser (a local preference).

const selectedKey = (tabsId: string) => `pageyard-tab:${tabsId}`;

export function readSelectedTab(tabsId: string): string | null {
  try { return localStorage.getItem(selectedKey(tabsId)); } catch { return null; }
}

export function writeSelectedTab(tabsId: string, tabId: string) {
  try { localStorage.setItem(selectedKey(tabsId), tabId); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('tabs-select', { detail: { id: tabsId } }));
}

// The tab shown for a tabs node: the remembered one when it still exists, else the first.
export function activeTabId(tabs: PMNode): string {
  const wanted = readSelectedTab(tabs.attrs.id);
  let first = '', found = '';
  tabs.forEach(tab => { if (!first) first = tab.attrs.id; if (wanted && tab.attrs.id === wanted) found = wanted; });
  return found || first;
}

const emptyLine = () => schema.nodes.text_block.create({ id: newBlockId(), depth: 0, blockType: 'paragraph' });

export function newTab(title: string) {
  return schema.nodes.tab.create({ id: newBlockId(), title, icon: null }, [emptyLine()]);
}

export function newTabsNode(depth: number) {
  return schema.nodes.tabs.create({ id: newBlockId(), depth }, [1, 2, 3].map(n => newTab(t("탭{0}", [n]))));
}

export function findNode(doc: PMNode, id: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isInline && node.attrs.id === id) { found = { node, pos }; return false; }
    return !node.isTextblock && !node.isAtom;
  });
  return found;
}

// "+": a new tab at the end, named 탭N, shown and ready to rename.
export function addTab(view: EditorView, tabsId: string): string | null {
  const tabs = findNode(view.state.doc, tabsId);
  if (!tabs) return null;
  const tab = newTab(t("탭{0}", [tabs.node.childCount + 1]));
  view.dispatch(view.state.tr.insert(tabs.pos + tabs.node.nodeSize - 1, tab));
  writeSelectedTab(tabsId, tab.attrs.id);
  return tab.attrs.id;
}

export function updateTab(view: EditorView, tabId: string, attrs: { title?: string; icon?: string | null }) {
  const tab = findNode(view.state.doc, tabId);
  if (!tab || tab.node.type.name !== 'tab') return;
  const next = { ...tab.node.attrs, ...attrs };
  if (next.title === tab.node.attrs.title && next.icon === tab.node.attrs.icon) return;
  view.dispatch(view.state.tr.setNodeMarkup(tab.pos, undefined, next));
}

// 삭제: the tab and its content go; the neighbour at the same place (or the one before) is
// shown. Deleting the only tab deletes the whole block.
export function deleteTab(view: EditorView, tabsId: string, tabId: string) {
  const tabs = findNode(view.state.doc, tabsId);
  if (!tabs) return;
  if (tabs.node.childCount <= 1) {
    const tr = view.state.tr.delete(tabs.pos, tabs.pos + tabs.node.nodeSize);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tabs.pos, tr.doc.content.size)), 1));
    view.dispatch(tr.scrollIntoView());
    return;
  }
  let pos = tabs.pos + 1, index = -1, size = 0;
  const ids: string[] = [];
  tabs.node.forEach((tab, offset, i) => { ids.push(tab.attrs.id); if (tab.attrs.id === tabId) { index = i; pos = tabs.pos + 1 + offset; size = tab.nodeSize; } });
  if (index < 0) return;
  const showing = activeTabId(tabs.node);
  view.dispatch(view.state.tr.delete(pos, pos + size));
  if (showing === tabId) writeSelectedTab(tabsId, ids[index + 1] ?? ids[index - 1]);
}

// The tab that holds a document position, if any: [tabs id, tab id].
export function tabAround(state: EditorState, pos: number): Array<[string, string]> {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  const out: Array<[string, string]> = [];
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'tab' && d > 0) out.push([$pos.node(d - 1).attrs.id, node.attrs.id]);
  }
  return out;
}

// The caret (or a link) landing inside a tab that is not shown shows that tab.
export function revealTabsAt(state: EditorState, pos: number) {
  for (const [tabsId, tabId] of tabAround(state, pos)) {
    const tabs = findNode(state.doc, tabsId);
    if (tabs && activeTabId(tabs.node) !== tabId) writeSelectedTab(tabsId, tabId);
  }
}
