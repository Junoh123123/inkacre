import type { EditorView } from 'prosemirror-view';
import { NodeSelection } from 'prosemirror-state';
import { schema } from './schema';

// Inline equations: ⌘⇧E / "√x" turn the selected text into an equation (its TeX); with
// nothing selected — or from "/" — an empty one is inserted and its editor opens.
export function openEquationEditor(view: EditorView, pos: number) {
  view.dom.dispatchEvent(new CustomEvent('equation-edit', { detail: { pos } }));
}

export function insertEquation(view: EditorView, tex = '', open = true) {
  const { from, to } = view.state.selection;
  const node = schema.nodes.equation.create({ tex });
  const tr = view.state.tr.replaceWith(from, to, node);
  tr.setSelection(NodeSelection.create(tr.doc, from));
  view.dispatch(tr.scrollIntoView());
  if (open) requestAnimationFrame(() => openEquationEditor(view, from));
  return true;
}

export function convertToEquation(view: EditorView) {
  const { from, to, empty, $from, $to } = view.state.selection;
  if (empty || !$from.sameParent($to) || !$from.parent.isTextblock || $from.parent.type.name === 'code_block') return insertEquation(view);
  const tex = view.state.doc.textBetween(from, to, ' ', node => node.type.name === 'equation' ? node.attrs.tex : '');
  if (!tex.trim()) return insertEquation(view);
  const tr = view.state.tr.replaceWith(from, to, schema.nodes.equation.create({ tex: tex.trim() }));
  view.dispatch(tr);
  view.focus();
  return true;
}
