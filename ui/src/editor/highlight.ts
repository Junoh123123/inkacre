import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import yaml from 'highlight.js/lib/languages/yaml';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

// Syntax colouring for code blocks as inline decorations (the stored text stays plain).
// Token colours come from the palette in editor.css ("syntax colours").

for (const [name, language] of Object.entries({ javascript, typescript, python, json, sql, xml, css, bash, markdown, java, go, rust, c, cpp, csharp, kotlin, swift, php, ruby, yaml })) hljs.registerLanguage(name, language);
// Mermaid: diagram and statement words as keywords (graph, flowchart, subgraph …), %% comments, strings;
// arrows get the operator colour like other plain stretches.
hljs.registerLanguage('mermaid', h => ({
  name: 'Mermaid',
  keywords: { keyword: 'graph flowchart subgraph end direction sequenceDiagram classDiagram stateDiagram stateDiagram-v2 erDiagram journey gantt pie gitGraph mindmap timeline quadrantChart requirementDiagram sankey-beta xychart-beta block-beta participant actor loop alt else opt par and critical break rect note over title section class state click style linkStyle classDef dateFormat axisFormat' },
  contains: [h.COMMENT('%%', '$'), h.QUOTE_STRING_MODE],
}));
const aliases: Record<string, string> = { html: 'xml', js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', md: 'markdown', yml: 'yaml' };

const scopeClass: Record<string, string> = {
  keyword: 'keyword', built_in: 'builtin', type: 'class', literal: 'literal', number: 'number', string: 'string', comment: 'comment', doctag: 'comment', meta: 'meta',
  title: 'function', 'title.function': 'function', 'title.class': 'class', 'title.class.inherited': 'class', attr: 'property', attribute: 'attr-name',
  variable: 'variable', 'variable.language': 'keyword', 'variable.constant': 'number', regexp: 'regex', symbol: 'symbol', tag: 'punctuation', name: 'tag',
  'selector-tag': 'selector', 'selector-class': 'selector', 'selector-id': 'selector', 'selector-attr': 'attr-name', 'selector-pseudo': 'selector',
  property: 'property', operator: 'operator', punctuation: 'punctuation', section: 'keyword', bullet: 'punctuation', code: 'string', link: 'string',
  quote: 'comment', addition: 'inserted', deletion: 'deleted', 'template-variable': 'variable', 'template-tag': 'keyword', subst: '',
};

function classFor(element: Element): string | null {
  const names = [...element.classList];
  const head = names.find(name => name.startsWith('hljs-'));
  if (!head) return null;
  const parts = [head.slice(5), ...names.filter(name => name.endsWith('_')).map(name => name.replace(/_+$/, ''))];
  for (let length = parts.length; length > 0; length--) {
    const base = scopeClass[parts.slice(0, length).join('.')];
    if (base !== undefined) return base || null;
  }
  return null;
}

type Token = [from: number, to: number, cls: string];
const cache = new WeakMap<PMNode, Token[]>();

// Plain stretches get operator / punctuation colours.
function splitPlain(text: string, offset: number, out: Token[]) {
  const pattern = /([=+\-*/%<>!&|^~?:]+)|([{}[\]();,.])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) out.push([offset + match.index, offset + match.index + match[0].length, match[1] ? 'operator' : 'punctuation']);
}

export function tokenize(text: string, language: string): Token[] {
  const lang = aliases[language] ?? language;
  if (!text || !lang || lang === 'plain' || !hljs.getLanguage(lang)) return [];
  let html: string;
  try { html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value; } catch { return []; }
  const template = document.createElement('template');
  template.innerHTML = html;
  const out: Token[] = [];
  let offset = 0;
  const walk = (node: Node, cls: string | null) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const value = child.nodeValue ?? '';
        if (cls) out.push([offset, offset + value.length, cls]);
        else splitPlain(value, offset, out);
        offset += value.length;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child, classFor(child as Element) ?? cls);
      }
    }
  };
  walk(template.content, null);
  return out;
}

function tokensFor(node: PMNode): Token[] {
  let tokens = cache.get(node);
  if (!tokens) { tokens = tokenize(node.textContent, node.attrs.language ?? 'plain'); cache.set(node, tokens); }
  return tokens;
}

function build(doc: PMNode) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') {
      for (const [from, to, cls] of tokensFor(node)) if (to > from) decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: `tok-${cls}` }));
      return false;
    }
    return node.type.name === 'doc' || node.type.name === 'columns' || node.type.name === 'column' || node.type.name === 'tabs' || node.type.name === 'tab';
  });
  return DecorationSet.create(doc, decorations);
}

export const codeHighlightKey = new PluginKey<DecorationSet>('codeHighlight');
export const codeHighlightPlugin = new Plugin<DecorationSet>({
  key: codeHighlightKey,
  state: {
    init: (_config, state) => build(state.doc),
    apply: (tr, previous) => (tr.docChanged ? build(tr.doc) : previous),
  },
  props: { decorations: state => codeHighlightKey.getState(state) },
});
