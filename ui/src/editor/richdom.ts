import type { RichRun, RichText } from '../data/types';
import { normalizeRuns } from './convert';

// DOM <-> rich text runs (used for table cells and pasted HTML).

const colorNames = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export function readRich(root: Node): RichText {
  const runs: RichText = [];
  const walk = (node: Node, style: Omit<RichRun, 'text'>) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/ /g, ' ');
      if (text) runs.push({ ...style, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const tag = element.tagName;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(tag)) return;
    if (tag === 'BR') { runs.push({ ...style, text: '\n' }); return; }
    const next: Omit<RichRun, 'text'> = { ...style };
    const css = element.style;
    if (tag === 'B' || tag === 'STRONG' || Number(css.fontWeight) >= 600 || css.fontWeight === 'bold') next.bold = true;
    if (tag === 'I' || tag === 'EM' || css.fontStyle === 'italic') next.italic = true;
    if (tag === 'U' || css.textDecoration.includes('underline')) next.underline = true;
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE' || css.textDecoration.includes('line-through')) next.strike = true;
    if (tag === 'CODE') next.code = true;
    if (tag === 'A' && element.getAttribute('href')) next.href = element.getAttribute('href')!;
    if (element.dataset.mention) { runs.push({ ...next, text: element.textContent ?? '', pageId: element.dataset.mention }); return; }
    if (element.dataset.equation !== undefined) { if (element.dataset.equation) runs.push({ ...next, text: element.dataset.equation, equation: true }); return; }
    const color = element.dataset.color ?? [...element.classList].find(name => name.startsWith('color-'))?.slice(6);
    if (color && (colorNames.includes(color) || /^#[0-9a-f]{6}$/i.test(color))) next.color = color;
    const background = element.dataset.background ?? [...element.classList].find(name => name.startsWith('bg-'))?.slice(3);
    if (background && (colorNames.includes(background) || /^#[0-9a-f]{6}$/i.test(background))) next.background = background;
    element.childNodes.forEach(child => walk(child, next));
    if (['P', 'DIV', 'LI'].includes(tag) && element.nextSibling) runs.push({ ...style, text: '\n' });
  };
  root.childNodes.forEach(child => walk(child, {}));
  const result = normalizeRuns(runs);
  // Trim a trailing newline produced by block elements.
  const last = result[result.length - 1];
  if (last && last.text.endsWith('\n')) { last.text = last.text.replace(/\n+$/, ''); if (!last.text) result.pop(); }
  return result;
}

export function richToFragment(runs: RichText | undefined, doc = document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const run of runs ?? []) {
    let node: Node;
    if (run.equation) {
      const span = doc.createElement('span');
      span.className = 'inline-equation';
      span.dataset.equation = run.text;
      span.textContent = run.text;
      node = span;
    } else if (run.pageId) {
      const span = doc.createElement('span');
      span.className = 'mention';
      span.dataset.mention = run.pageId;
      span.textContent = run.text;
      node = span;
    } else {
      const parts = run.text.split('\n');
      const holder = doc.createDocumentFragment();
      parts.forEach((part, index) => { if (index) holder.append(doc.createElement('br')); if (part) holder.append(doc.createTextNode(part)); });
      node = holder;
    }
    const wrap = (tag: string, attrs: Record<string, string> = {}) => {
      const element = doc.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      element.append(node);
      node = element;
    };
    if (run.code) wrap('code', { class: 'inline-code' });
    if (run.bold) wrap('strong');
    if (run.italic) wrap('em');
    if (run.underline) wrap('u');
    if (run.strike) wrap('s');
    if (run.color && run.color !== 'default') wrap('span', run.color.startsWith('#') ? { 'data-color': run.color, style: `color:${run.color}` } : { 'data-color': run.color, class: `color-${run.color}` });
    if (run.background && run.background !== 'default') wrap('span', run.background.startsWith('#') ? { 'data-background': run.background, style: `background:${run.background}` } : { 'data-background': run.background, class: `bg-${run.background}` });
    if (run.href) wrap('a', { href: run.href, class: 'inline-link', target: '_blank', rel: 'noopener noreferrer' });
    fragment.append(node);
  }
  return fragment;
}
