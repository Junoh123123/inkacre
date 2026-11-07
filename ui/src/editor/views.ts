import { t } from '../i18n';
import type { Node as PMNode } from 'prosemirror-model';
import type { Decoration, EditorView, NodeView } from 'prosemirror-view';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { setToggleOpen, isCollapsed, isToggleNode } from './plugins';
import { activeTabId } from './tabs';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from '../ui/Icon';

// Native node views for text and code blocks; React portals for atoms.

function applyIndent(element: HTMLElement, decorations: readonly Decoration[] | undefined, fallbackDepth: number) {
  const { spec } = specOf(decorations ?? []);
  const px = typeof spec.indent === 'number' ? spec.indent : fallbackDepth * 30;
  element.style.marginLeft = px ? `${px}px` : '';
  // Inside a synced block: how far the outline's left edge is from this block.
  if (typeof spec.syncedLeft === 'number') element.style.setProperty('--synced-left', `${spec.syncedLeft}px`);
  else element.style.removeProperty('--synced-left');
}

function specOf(decorations: readonly Decoration[]) {
  const spec: Record<string, unknown> = {};
  for (const decoration of decorations) Object.assign(spec, decoration.spec ?? {});
  return { spec };
}

// Replace our own classes without touching classes added by decorations.
function setOwnClasses(element: HTMLElement, previous: string[], next: string[]) {
  for (const name of previous) if (!next.includes(name)) element.classList.remove(name);
  for (const name of next) element.classList.add(name);
  return next;
}

export class TextBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private marker: HTMLElement;
  private node: PMNode;
  private ownClasses: string[] = [];

  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined, decorations: readonly Decoration[], private onCalloutIcon?: (anchor: Element, pos: number) => void) {
    this.node = node;
    this.dom = document.createElement('div');
    this.marker = document.createElement('div');
    this.marker.className = 'block-marker';
    this.marker.contentEditable = 'false';
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'block-text';
    const row = document.createElement('div');
    row.className = 'block-row';
    row.append(this.marker, this.contentDOM);
    this.dom.append(row);
    this.marker.addEventListener('mousedown', event => this.onMarker(event));
    this.render(node, decorations);
  }

  private onMarker(event: MouseEvent) {
    const type = this.node.attrs.blockType;
    const pos = this.getPos();
    if (pos === undefined) return;
    if (type === 'todo') {
      event.preventDefault();
      const node = this.view.state.doc.nodeAt(pos);
      if (!node) return;
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
    } else if (isToggleNode(this.node)) {
      event.preventDefault();
      setToggleOpen(this.view, this.node.attrs.id, isCollapsed(this.node.attrs.id));
    } else if (type === 'callout') {
      event.preventDefault();
      if (this.onCalloutIcon) this.onCalloutIcon(this.marker, pos);
      else this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1)));
    }
  }

  private render(node: PMNode, decorations: readonly Decoration[]) {
    const { spec } = specOf(decorations);
    const type = node.attrs.blockType as string;
    const depth = node.attrs.depth ?? 0;
    const toggleHeading = isToggleNode(node) && type !== 'toggle';
    const color = node.attrs.color as string | null;
    this.ownClasses = setOwnClasses(this.dom, this.ownClasses, ['block', `block-${type}`, ...(node.attrs.checked ? ['checked'] : []), ...(toggleHeading ? ['toggle-heading'] : []), ...(type === 'callout' && node.attrs.icon === '' ? ['no-icon'] : []),
      ...(color ? [color.endsWith('_background') ? `block-bg-${color.slice(0, -11)}` : `block-color-${color}`] : [])]);
    this.dom.dataset.blockId = node.attrs.id;
    this.dom.dataset.blockType = type;
    this.dom.dataset.depth = String(depth);
    // Text direction: the block's own choice, else from its text (Arabic, Hebrew… read right to left).
    this.contentDOM.dir = (node.attrs.direction as string | null) ?? 'auto';
    this.dom.classList.toggle('rtl', node.attrs.direction === 'rtl');
    applyIndent(this.dom, decorations, depth);
    if (spec.placeholder) this.contentDOM.dataset.placeholder = String(spec.placeholder); else delete this.contentDOM.dataset.placeholder;
    const markerKey = `${type}|${node.attrs.checked}|${spec.marker ?? ''}|${spec.open ?? ''}|${toggleHeading}|${node.attrs.icon === '' ? '(none)' : node.attrs.icon ?? ''}`;
    if (this.marker.dataset.key === markerKey) return;
    // Opening/closing a toggle keeps its button so the arrow turns (200ms).
    const sameButOpen = (key?: string) => key?.replace(/^([^|]*\|[^|]*\|[^|]*\|)[^|]*/, '$1');
    const existing = this.marker.querySelector<HTMLElement>('.toggle-button');
    if (existing && sameButOpen(this.marker.dataset.key) === sameButOpen(markerKey)) {
      this.marker.dataset.key = markerKey;
      existing.classList.toggle('open', !!spec.open);
      existing.setAttribute('aria-label', spec.open ? t("닫기") : t("열기"));
      return;
    }
    this.marker.dataset.key = markerKey;
    this.marker.replaceChildren();
    this.marker.hidden = !['bullet', 'numbered', 'todo', 'toggle', 'callout'].includes(type) && !toggleHeading;
    if (type === 'bullet') {
      const dot = document.createElement('span'); dot.className = 'bullet'; dot.textContent = String(spec.marker ?? '•'); this.marker.append(dot);
    } else if (type === 'numbered') {
      const number = document.createElement('span'); number.className = 'number'; number.textContent = String(spec.marker ?? '1.'); this.marker.append(number);
    } else if (type === 'todo') {
      const box = document.createElement('div');
      box.className = `checkbox${node.attrs.checked ? ' checked' : ''}`;
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', String(!!node.attrs.checked));
      box.innerHTML = node.attrs.checked ? '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="m2.5 7.2 3 3 6-6.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
      this.marker.append(box);
    } else if (type === 'toggle' || toggleHeading) {
      const button = document.createElement('div');
      button.className = `toggle-button${spec.open ? ' open' : ''}`;
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', spec.open ? t("닫기") : t("열기"));
      button.innerHTML = '<svg viewBox="0 0 13 13" width="13" height="13" aria-hidden="true"><path d="M2.1 2.4h8.8L6.5 10.7z" fill="currentColor"/></svg>';
      this.marker.append(button);
    } else if (type === 'callout') {
      // icon '' = removed: the text takes the space and a faint "add icon" shows on hover.
      const icon = document.createElement('span'); icon.className = `callout-icon${node.attrs.icon === '' ? ' empty' : ''}`; icon.setAttribute('role', 'button');
      icon.setAttribute('aria-label', node.attrs.icon === '' ? t("아이콘 추가") : t("아이콘 변경"));
      const value = node.attrs.icon as string | null;
      // An uploaded picture as the icon ("attachment:<id>").
      if (value?.startsWith('attachment:')) { const image = document.createElement('img'); image.src = `/api/attachments/${encodeURIComponent(value.slice(11))}`; image.alt = ''; image.className = 'callout-icon-image'; icon.append(image); }
      // A line icon from the picker's 아이콘 tab ("icon:<name>:<colour>").
      else if (value?.startsWith('icon:')) { const [, name, color = 'gray'] = value.split(':'); icon.classList.add('is-glyph', `color-${color}`); createRoot(icon).render(createElement(Icon, { name, size: 20 })); }
      else icon.textContent = value === '' ? '☺' : value || '💡';
      this.marker.append(icon);
    }
  }

  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render(node, decorations);
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
    if (mutation.type === 'selection') return false;
    return this.marker.contains(mutation.target) || (mutation.target === this.dom && mutation.type === 'attributes');
  }

  stopEvent(event: Event) {
    return this.marker.contains(event.target as Node);
  }
}

export const codeLanguages = ['plain', 'javascript', 'typescript', 'python', 'json', 'sql', 'html', 'css', 'bash', 'markdown', 'java', 'go', 'rust', 'c', 'cpp', 'csharp', 'kotlin', 'swift', 'php', 'ruby', 'yaml', 'mermaid'];
export const languageLabels: Record<string, string> = { plain: t("일반 텍스트"), javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', json: 'JSON', sql: 'SQL', html: 'HTML', css: 'CSS', bash: 'Bash', markdown: 'Markdown', java: 'Java', go: 'Go', rust: 'Rust', c: 'C', cpp: 'C++', csharp: 'C#', kotlin: 'Kotlin', swift: 'Swift', php: 'PHP', ruby: 'Ruby', yaml: 'YAML', mermaid: 'Mermaid' };

const codeSvg = {
  chevron: '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="m2 6.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M10.5 3.6c0-.3-.3-.6-.6-.6H4c-.6 0-1 .4-1 1v5.9c0 .3.3.6.6.6" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m3.5 8.3 2.8 2.8 6.2-6.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wrap: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 4v4.5c0 .8-.7 1.5-1.5 1.5H3.5m0 0L6 7.5M3.5 10 6 12.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor"/></svg>',
  // Mermaid: show code / preview / both, expand, download (drawn for this app).
  modeCode: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m5.5 4.5-3 3.5 3 3.5m5-7 3 3.5-3 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  modePreview: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M5 6.5h6M5 9.5h3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  modeBoth: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M2.8 8h10.4M5 5.3h4M5 10.7h6" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  expand: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.3" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="m10.2 10.2 3.3 3.3M7 5v4M5 7h4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.8v7.4m0 0L5.2 7.4M8 10.2l2.8-2.8M3 13.2h10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
export type MermaidMode = 'code' | 'preview' | 'both';
const mermaidModeKey = (id: string) => `pageyard-mermaid-mode:${id}`;
export function readMermaidMode(id: string): MermaidMode { try { const value = localStorage.getItem(mermaidModeKey(id)); return value === 'code' || value === 'preview' ? value : 'both'; } catch { return 'both'; } }
export function writeMermaidMode(id: string, mode: MermaidMode) { try { if (mode === 'both') localStorage.removeItem(mermaidModeKey(id)); else localStorage.setItem(mermaidModeKey(id), mode); } catch { /* ignore */ } window.dispatchEvent(new CustomEvent('mermaid-mode', { detail: { id } })); }
const wrapKey = (id: string) => `pageyard-code-wrap:${id}`;
export function readWrap(id: string) { try { return localStorage.getItem(wrapKey(id)) === '1'; } catch { return false; } }
// Wrapping is kept per browser; open code blocks redraw when it changes.
export function setCodeWrap(id: string, wrap: boolean) {
  try { if (wrap) localStorage.setItem(wrapKey(id), '1'); else localStorage.removeItem(wrapKey(id)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('mermaid-mode', { detail: { id } }));
}

// Code block: box r10 bg #422303/0.03, text at 36/22; on hover a
// 172×28 toolbar pill (r6, ring #2a1c00/0.07) sits 4px inside the top-right corner with
// the language dropdown, copy, wrap and block-menu buttons.
export class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private header: HTMLElement;
  private language: HTMLButtonElement;
  private languageLabel: HTMLElement;
  private wrapButton: HTMLButtonElement;
  private modeButton: HTMLButtonElement;
  private expandButton: HTMLButtonElement;
  private downloadButton: HTMLButtonElement;
  private preview: HTMLElement;
  private caption: HTMLElement;
  private captionWrap: HTMLElement;
  private captionTimer = 0;
  private drawnCode = '\u0000';
  private drawnTheme = '';
  private drawTimer = 0;
  private diagramId = '';
  private onMode = (event: Event) => { if ((event as CustomEvent<{ id: string }>).detail.id === this.node.attrs.id) this.render(this.node); };
  private node: PMNode;
  private ownClasses: string[] = [];
  private decorations: readonly Decoration[] = [];
  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined, private onLanguage: (anchor: Element, pos: number, current: string) => void, decorations: readonly Decoration[] = [], private onMore?: (anchor: Element, pos: number) => void, private onMermaid?: (action: 'mode' | 'expand', anchor: Element, id: string) => void) {
    this.node = node;
    this.decorations = decorations;
    this.dom = document.createElement('div');
    this.header = document.createElement('div');
    this.header.className = 'code-toolbar';
    this.header.contentEditable = 'false';
    const button = (className: string, label: string, html: string) => {
      const element = document.createElement('button');
      element.type = 'button'; element.className = className; element.setAttribute('aria-label', label); element.title = label; element.innerHTML = html;
      return element;
    };
    this.language = button('code-language', t("언어 선택"), '');
    this.languageLabel = document.createElement('span');
    this.language.append(this.languageLabel);
    this.language.insertAdjacentHTML('beforeend', codeSvg.chevron);
    this.language.addEventListener('mousedown', event => { event.preventDefault(); const pos = this.getPos(); if (pos !== undefined) this.onLanguage(this.language, pos, this.node.attrs.language); });
    const separator = document.createElement('span');
    separator.className = 'code-toolbar-separator';
    const copy = button('code-tool', t("코드 복사"), codeSvg.copy);
    copy.addEventListener('mousedown', event => {
      event.preventDefault();
      navigator.clipboard.writeText(this.node.textContent).then(() => { copy.innerHTML = codeSvg.check; setTimeout(() => { copy.innerHTML = codeSvg.copy; }, 1200); }).catch(() => undefined);
    });
    this.wrapButton = button('code-tool', t("오른쪽 끝에서 줄바꿈"), codeSvg.wrap);
    this.wrapButton.addEventListener('mousedown', event => {
      event.preventDefault();
      setCodeWrap(this.node.attrs.id, !readWrap(this.node.attrs.id));
    });
    const more = button('code-tool', t("블록 메뉴 열기"), codeSvg.more);
    more.addEventListener('mousedown', event => { event.preventDefault(); const pos = this.getPos(); if (pos !== undefined) this.onMore?.(more, pos); });
    this.modeButton = button('code-tool code-mermaid', t("미리 보기 형식 고르기"), codeSvg.modeBoth);
    this.modeButton.addEventListener('mousedown', event => { event.preventDefault(); this.onMermaid?.('mode', this.modeButton, this.node.attrs.id); });
    this.expandButton = button('code-tool code-mermaid', t("다이어그램 펼치기"), codeSvg.expand);
    this.expandButton.addEventListener('mousedown', event => { event.preventDefault(); this.onMermaid?.('expand', this.preview, this.node.attrs.id); });
    this.downloadButton = button('code-tool code-mermaid', t("다이어그램을 JPEG로 다운로드"), codeSvg.download);
    this.downloadButton.addEventListener('mousedown', event => {
      event.preventDefault();
      const svg = this.preview.querySelector('svg');
      if (svg) void import('./mermaid').then(module => module.downloadDiagram(svg, 'diagram', isDarkTheme()));
    });
    this.header.append(this.language, separator, this.modeButton, this.expandButton, this.downloadButton, copy, this.wrapButton, more);
    const pre = document.createElement('pre');
    this.contentDOM = document.createElement('code');
    pre.append(this.contentDOM);
    this.preview = document.createElement('div');
    this.preview.className = 'mermaid-preview';
    this.preview.contentEditable = 'false';
    // Caption: a 14/19.6 line under the box, "캡션을 작성하세요…" while empty;
    // an empty caption goes away when the caret leaves it.
    this.caption = document.createElement('div');
    this.caption.className = 'block-caption';
    this.caption.contentEditable = 'plaintext-only';
    this.caption.setAttribute('role', 'textbox');
    this.caption.setAttribute('aria-label', t("캡션"));
    this.caption.dataset.placeholder = t("캡션을 작성하세요…");
    this.caption.addEventListener('input', () => { window.clearTimeout(this.captionTimer); this.captionTimer = window.setTimeout(() => this.saveCaption(false), 300); });
    this.caption.addEventListener('blur', () => { window.clearTimeout(this.captionTimer); this.saveCaption(true); });
    this.caption.addEventListener('keydown', event => {
      // Keys that finish a Korean/Japanese syllable belong to the IME.
      if (event.isComposing || event.keyCode === 229) return;
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') { event.preventDefault(); this.caption.blur(); this.view.focus(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectContents(this.caption); }
    });
    // Its own editing host: inside the page's editable root the line needs a non-editable wrapper.
    this.captionWrap = document.createElement('div');
    this.captionWrap.className = 'block-caption-wrap';
    this.captionWrap.contentEditable = 'false';
    this.captionWrap.append(this.caption);
    this.dom.append(this.header, pre, this.preview, this.captionWrap);
    window.addEventListener('mermaid-mode', this.onMode);
    window.addEventListener('caption-focus', this.onCaptionFocus);
    this.render(node);
  }
  private onCaptionFocus = (event: Event) => {
    if ((event as CustomEvent<{ id: string }>).detail.id !== this.node.attrs.id) return;
    this.caption.hidden = false;
    this.captionWrap.hidden = false;
    // After the menu that asked for it has closed and handed focus back.
    window.setTimeout(() => {
      this.caption.focus();
      const range = document.createRange(); range.selectNodeContents(this.caption); range.collapse(false);
      const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    }, 60);
  };
  private saveCaption(leaving: boolean) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const text = (this.caption.textContent ?? '').replace(/\n+/g, ' ');
    const value = text.trim() ? text : leaving ? null : '';
    const node = this.view.state.doc.nodeAt(pos);
    if (node?.type.name !== 'code_block' || node.attrs.caption === value) { if (leaving && value === null) { this.caption.hidden = true; this.captionWrap.hidden = true; } return; }
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, caption: value }));
  }
  // A Mermaid block draws its diagram under the code (or alone), redrawn shortly after the code changes.
  private drawMermaid(node: PMNode) {
    const code = node.textContent;
    const theme = isDarkTheme() ? 'dark' : 'light';
    if (code === this.drawnCode && theme === this.drawnTheme) return;
    window.clearTimeout(this.drawTimer);
    this.drawTimer = window.setTimeout(() => {
      this.drawnCode = code; this.drawnTheme = theme;
      if (!code.trim()) { this.preview.replaceChildren(); return; }
      void import('./mermaid').then(module => module.renderMermaid(code, theme === 'dark')).then(result => {
        if (this.drawnCode !== code) return;
        if (this.diagramId) void import('./mermaid').then(module => module.releaseStyles(this.diagramId));
        this.diagramId = result.id;
        this.preview.classList.toggle('mermaid-error', !result.svg);
        if (result.svg) this.preview.replaceChildren(result.svg);
        else { const message = document.createElement('div'); message.className = 'mermaid-message'; message.textContent = t("다이어그램을 그릴 수 없습니다. 코드를 확인하세요."); this.preview.replaceChildren(message); }
      }).catch(() => { const message = document.createElement('div'); message.className = 'mermaid-message'; message.textContent = t("Mermaid를 불러오지 못했습니다."); this.preview.replaceChildren(message); });
    }, this.drawnCode === '\u0000' ? 0 : 300);
  }
  private render(node: PMNode) {
    const wrap = readWrap(node.attrs.id);
    this.ownClasses = setOwnClasses(this.dom, this.ownClasses, ['block', 'block-code', ...(wrap ? ['code-wrap'] : [])]);
    this.wrapButton.classList.toggle('active', wrap);
    this.dom.dataset.blockId = node.attrs.id;
    this.dom.dataset.depth = String(node.attrs.depth ?? 0);
    applyIndent(this.dom, this.decorations, node.attrs.depth ?? 0);
    this.languageLabel.textContent = languageLabels[node.attrs.language] ?? node.attrs.language;
    const caption = node.attrs.caption as string | null;
    if (document.activeElement !== this.caption) {
      this.caption.hidden = caption === null;
      this.captionWrap.hidden = caption === null;
      if ((this.caption.textContent ?? '') !== (caption ?? '')) this.caption.textContent = caption ?? '';
    }
    const mermaid = node.attrs.language === 'mermaid';
    const mode = readMermaidMode(node.attrs.id);
    this.dom.classList.toggle('code-mermaid-block', mermaid);
    this.dom.classList.toggle('mermaid-code-only', mermaid && mode === 'code');
    this.dom.classList.toggle('mermaid-preview-only', mermaid && mode === 'preview');
    this.modeButton.innerHTML = mode === 'code' ? codeSvg.modeCode : mode === 'preview' ? codeSvg.modePreview : codeSvg.modeBoth;
    if (mermaid && mode !== 'code') this.drawMermaid(node);
    else if (!mermaid && this.drawnCode !== '\u0000') { this.preview.replaceChildren(); this.drawnCode = '\u0000'; }
  }
  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.decorations = decorations;
    this.render(node);
    return true;
  }
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
    if (this.captionWrap.contains(mutation.target)) return true;
    if (mutation.type === 'selection') return false;
    return this.header.contains(mutation.target) || this.preview.contains(mutation.target) || (mutation.type === 'attributes' && mutation.target === this.caption);
  }
  stopEvent(event: Event) { return this.header.contains(event.target as Node) || this.preview.contains(event.target as Node) || this.captionWrap.contains(event.target as Node); }
  destroy() {
    window.clearTimeout(this.drawTimer);
    window.clearTimeout(this.captionTimer);
    window.removeEventListener('mermaid-mode', this.onMode);
    window.removeEventListener('caption-focus', this.onCaptionFocus);
    if (this.diagramId) void import('./mermaid').then(module => module.releaseStyles(this.diagramId));
  }
}
const isDarkTheme = () => document.documentElement.dataset.theme === 'dark';
// ⌘A inside a line that edits on its own (caption) selects just that line.
export function selectContents(element: HTMLElement) {
  const range = document.createRange(); range.selectNodeContents(element);
  const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}

export class ColumnsView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  constructor(node: PMNode, decorations: readonly Decoration[] = []) {
    this.dom = document.createElement('div');
    this.dom.className = 'block block-columns';
    this.dom.dataset.blockId = node.attrs.id;
    applyIndent(this.dom, decorations, node.attrs.depth ?? 0);
    this.contentDOM = this.dom;
  }
  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type.name !== 'columns') return false;
    this.dom.dataset.blockId = node.attrs.id;
    applyIndent(this.dom, decorations, node.attrs.depth ?? 0);
    return true;
  }
}

// A column: its width ratio is applied through the CSSOM (the page's CSP blocks style
// attributes), and style changes made while resizing are not treated as edits.
export class ColumnView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  constructor(node: PMNode) {
    this.dom = document.createElement('div');
    this.dom.className = 'block-column';
    this.contentDOM = this.dom;
    this.render(node);
  }
  private render(node: PMNode) {
    this.dom.dataset.blockId = node.attrs.id;
    this.dom.style.flexGrow = node.attrs.ratio ? String(node.attrs.ratio) : '';
  }
  update(node: PMNode) {
    if (node.type.name !== 'column') return false;
    this.render(node);
    return true;
  }
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
    return mutation.type === 'attributes' && mutation.target === this.dom;
  }
}

// ---------- tabs ----------
// The tabs block: a frame with the tab bar (React, through the atom registry) above the tabs'
// content; only the shown tab is displayed.
export class TabsView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private header: HTMLElement;
  private frame: HTMLElement;
  private key: number;
  private node: PMNode;
  constructor(node: PMNode, getPos: () => number | undefined, private registry: AtomRegistry, decorations: readonly Decoration[] = []) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'block block-tabs';
    this.frame = document.createElement('div');
    this.frame.className = 'tabs-frame';
    this.header = document.createElement('div');
    this.header.className = 'tabs-header';
    this.header.contentEditable = 'false';
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'tabs-panels';
    this.frame.append(this.header, this.contentDOM);
    this.dom.append(this.frame);
    this.apply(node, decorations);
    this.key = registry.add(this.header, node, getPos);
    window.addEventListener('tabs-select', this.onSelect);
    queueMicrotask(() => this.showActive());
  }
  private onSelect = (event: Event) => { if ((event as CustomEvent<{ id: string }>).detail.id === this.node.attrs.id) { this.showActive(); this.registry.update(this.key, { node: this.node }); } };
  private apply(node: PMNode, decorations: readonly Decoration[]) {
    this.dom.dataset.blockId = node.attrs.id;
    this.dom.dataset.depth = String(node.attrs.depth ?? 0);
    applyIndent(this.dom, decorations, node.attrs.depth ?? 0);
  }
  private showActive() {
    const active = activeTabId(this.node);
    for (const child of [...this.contentDOM.children] as HTMLElement[]) child.classList.toggle('tab-active', child.dataset.tabId === active);
  }
  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type.name !== 'tabs') return false;
    this.node = node;
    this.apply(node, decorations);
    this.registry.update(this.key, { node });
    this.showActive();
    // New tab panels are drawn after this update.
    queueMicrotask(() => this.showActive());
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(event: Event) { return this.header.contains(event.target as Node); }
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
    if (this.header.contains(mutation.target)) return true;
    if (mutation.type === 'selection') return false;
    return mutation.type === 'attributes' && (mutation.target === this.dom || mutation.target === this.frame);
  }
  destroy() { window.removeEventListener('tabs-select', this.onSelect); this.registry.remove(this.key); }
}

export class TabView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  constructor(node: PMNode) {
    this.dom = document.createElement('div');
    this.dom.className = 'tab-panel';
    this.dom.setAttribute('role', 'tabpanel');
    this.dom.dataset.tabId = node.attrs.id;
    this.contentDOM = this.dom;
  }
  update(node: PMNode) {
    if (node.type.name !== 'tab') return false;
    this.dom.dataset.tabId = node.attrs.id;
    return true;
  }
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
    return mutation.type === 'attributes' && mutation.target === this.dom;
  }
}

// ---------- React atoms ----------

export interface AtomEntry { key: number; dom: HTMLElement; node: PMNode; getPos: () => number | undefined; selected: boolean }

export class AtomRegistry {
  private entries = new Map<number, AtomEntry>();
  private listeners = new Set<() => void>();
  private version = 0;
  private nextKey = 1;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getVersion = () => this.version;
  list() { return [...this.entries.values()]; }
  private emit() { this.version++; for (const listener of this.listeners) listener(); }
  add(dom: HTMLElement, node: PMNode, getPos: () => number | undefined) {
    const key = this.nextKey++;
    this.entries.set(key, { key, dom, node, getPos, selected: false });
    this.emit();
    return key;
  }
  update(key: number, patch: Partial<AtomEntry>) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.set(key, { ...entry, ...patch });
    this.emit();
  }
  remove(key: number) { this.entries.delete(key); this.emit(); }
}

export class ReactAtomView implements NodeView {
  dom: HTMLElement;
  private key: number;
  private node: PMNode;
  private ownClasses: string[] = [];
  constructor(node: PMNode, private view: EditorView, getPos: () => number | undefined, private registry: AtomRegistry, private decorations: readonly Decoration[] = []) {
    this.node = node;
    this.dom = document.createElement('div');
    this.apply(node);
    this.key = registry.add(this.dom, node, getPos);
  }
  private apply(node: PMNode) {
    const type = node.type.name === 'atom_block' ? node.attrs.blockType : node.type.name === 'page_link' ? 'page' : node.type.name;
    this.ownClasses = setOwnClasses(this.dom, this.ownClasses, ['block', `block-${type}`, 'block-atom']);
    this.dom.dataset.blockId = node.attrs.id;
    this.dom.dataset.blockType = type;
    this.dom.dataset.depth = String(node.attrs.depth ?? 0);
    applyIndent(this.dom, this.decorations, node.attrs.depth ?? 0);
    this.dom.contentEditable = 'false';
  }
  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type || node.attrs.blockType !== this.node.attrs.blockType || node.attrs.id !== this.node.attrs.id) return false;
    this.node = node;
    this.decorations = decorations;
    this.apply(node);
    this.registry.update(this.key, { node });
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); this.registry.update(this.key, { selected: true }); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); this.registry.update(this.key, { selected: false }); }
  stopEvent(event: Event) {
    const target = event.target as HTMLElement;
    // Let ProseMirror select the atom on a plain mousedown on its frame; everything interactive inside is ours.
    if (event.type === 'mousedown' && target === this.dom) return false;
    return true;
  }
  ignoreMutation() { return true; }
  destroy() { this.registry.remove(this.key); }
}

export function selectAtom(view: EditorView, pos: number) {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
}

// Page mention: icon + live title, opens the page on click.
import { workspace } from '../data/store';
import { navigate } from '../data/router';

const pageGlyph = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5.5 3h6.2L15 6.3V16a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M11.5 3v3.5H15" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>';

export class MentionView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  private unsubscribe: () => void;
  private last = '';
  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement('span');
    this.dom.className = 'mention';
    this.dom.contentEditable = 'false';
    this.dom.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.shiftKey) return;
      event.preventDefault();
      const id = this.node.attrs.pageId as string;
      if (id && workspace.get(id)) navigate(id);
    });
    this.render();
    this.unsubscribe = workspace.subscribe(() => this.render());
  }
  private render() {
    const page = workspace.get(this.node.attrs.pageId) as { kind: string; title?: string; icon?: string | null; alive?: boolean } | undefined;
    const title = page ? (page.title || t("새 페이지")) : this.node.attrs.text || t("알 수 없는 페이지");
    const icon = page?.icon ?? '';
    const key = `${title}|${icon}|${!!page}|${page?.alive}`;
    if (key === this.last) return;
    this.last = key;
    this.dom.dataset.mention = this.node.attrs.pageId;
    this.dom.classList.toggle('mention-missing', !page || page.alive === false);
    this.dom.replaceChildren();
    const iconEl = document.createElement('span');
    iconEl.className = 'mention-icon';
    if (icon) iconEl.textContent = icon; else iconEl.innerHTML = pageGlyph;
    const label = document.createElement('span');
    label.className = 'mention-title';
    label.textContent = title;
    this.dom.append(iconEl, label);
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.last = '';
    this.render();
    return true;
  }
  ignoreMutation() { return true; }
  stopEvent(event: Event) { return event.type === 'mousedown'; }
  destroy() { this.unsubscribe(); }
}

// Inline equation: KaTeX inline in the text (1.21em); empty, a grey chip
// "√x 새 수식" (r4, padding 0 4, rgb(240,239,237) / rgb(125,122,117)). Pressing it selects it and
// asks the editor to open the one-line TeX editor under it ('equation-edit' on the editor DOM).
import { renderTex } from './katex';

const texGlyph = '<svg viewBox="0 0 20 20" width="17.6" height="17.6" aria-hidden="true"><path d="M2.5 11.2h2l2.2 5.3L10.4 3.5H18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="m11.6 8.6 4.6 5.4m0-5.4-4.6 5.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

const equationViews = new WeakMap<Element, EquationView>();
export const equationViewFor = (element: Element | null | undefined) => element ? equationViews.get(element) : undefined;

export class EquationView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  private shown = '\u0000';
  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.node = node;
    this.dom = document.createElement('span');
    this.dom.className = 'inline-equation';
    this.dom.contentEditable = 'false';
    equationViews.set(this.dom, this);
    this.dom.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      this.view.dom.dispatchEvent(new CustomEvent('equation-edit', { detail: { pos } }));
    });
    this.render();
  }
  private render() {
    const tex = this.node.attrs.tex as string;
    if (tex === this.shown) return;
    this.shown = tex;
    this.dom.dataset.equation = tex;
    this.dom.classList.toggle('empty', !tex);
    this.dom.replaceChildren();
    if (!tex) {
      const icon = document.createElement('span');
      icon.className = 'inline-equation-icon';
      icon.innerHTML = texGlyph;
      const label = document.createElement('span');
      label.textContent = t("새 수식");
      this.dom.append(icon, label);
      return;
    }
    const target = document.createElement('span');
    target.textContent = tex;
    this.dom.append(target);
    void renderTex(target, tex, false);
  }
  /** While its editor is open the equation shows a draft and the editing highlight. */
  preview(tex: string | null) {
    this.dom.classList.toggle('editing', tex !== null);
    if (tex === null) { this.shown = '\u0000'; this.render(); return; }
    this.shown = '\u0000';
    const saved = this.node;
    this.node = saved.type.create({ ...saved.attrs, tex }, undefined, saved.marks);
    this.render();
    this.node = saved;
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('selected'); }
  deselectNode() { this.dom.classList.remove('selected'); }
  ignoreMutation() { return true; }
  stopEvent(event: Event) { return event.type === 'mousedown'; }
}

// ---------- 24차: web link mention and date mention ----------
import { displayDate, formatTime } from '../data/format';

const globeGlyph = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M3.5 10h13M10 3.5c2 2 2.8 4.2 2.8 6.5s-.8 4.5-2.8 6.5c-2-2-2.8-4.2-2.8-6.5s.8-4.5 2.8-6.5Z" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>';

// 링크 멘션: the site's icon and the page's title; a click opens the address in a new tab. Resting the pointer on it
// shows a card with the title, the site, the description kept when it was made, and the address.
let linkCard: HTMLElement | null = null;
let linkCardTimer = 0;
function hideLinkCard() { window.clearTimeout(linkCardTimer); linkCard?.remove(); linkCard = null; }
function showLinkCard(anchor: HTMLElement, attrs: { href: string; text: string; icon: string | null; site: string | null; description: string | null }) {
  hideLinkCard();
  const card = document.createElement('div');
  card.className = 'link-mention-card';
  card.setAttribute('role', 'tooltip');
  let host = attrs.href;
  try { host = new URL(attrs.href).hostname.replace(/^www\./, ''); } catch { /* keep */ }
  const head = document.createElement('div'); head.className = 'link-mention-card-site';
  const glyph = document.createElement('span'); glyph.className = 'link-mention-icon';
  if (attrs.icon) { const image = document.createElement('img'); image.src = `/api/attachments/${encodeURIComponent(attrs.icon)}`; image.alt = ''; image.width = 14; image.height = 14; glyph.append(image); } else glyph.innerHTML = globeGlyph;
  const site = document.createElement('span'); site.textContent = attrs.site || host;
  head.append(glyph, site);
  const title = document.createElement('div'); title.className = 'link-mention-card-title'; title.textContent = attrs.text || host;
  card.append(head, title);
  if (attrs.description) { const text = document.createElement('div'); text.className = 'link-mention-card-text'; text.textContent = attrs.description; card.append(text); }
  const url = document.createElement('div'); url.className = 'link-mention-card-url'; url.textContent = attrs.href; card.append(url);
  card.addEventListener('mouseenter', () => window.clearTimeout(linkCardTimer));
  card.addEventListener('mouseleave', () => { linkCardTimer = window.setTimeout(hideLinkCard, 150); });
  document.body.append(card);
  const box = anchor.getBoundingClientRect(), width = card.offsetWidth;
  card.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.left))}px`;
  const below = box.bottom + 6, above = box.top - 6 - card.offsetHeight;
  card.style.top = `${below + card.offsetHeight > window.innerHeight - 8 && above > 8 ? above : below}px`;
  linkCard = card;
}
export class LinkMentionView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement('a');
    this.dom.className = 'link-mention';
    this.dom.contentEditable = 'false';
    this.dom.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.shiftKey) return;
      event.preventDefault();
      hideLinkCard();
      const href = this.node.attrs.href as string;
      if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    });
    this.dom.addEventListener('mouseenter', () => { window.clearTimeout(linkCardTimer); linkCardTimer = window.setTimeout(() => { if (this.dom.isConnected) showLinkCard(this.dom, this.node.attrs as never); }, 450); });
    this.dom.addEventListener('mouseleave', () => { window.clearTimeout(linkCardTimer); linkCardTimer = window.setTimeout(hideLinkCard, 150); });
    this.render();
  }
  destroy() { hideLinkCard(); }
  private render() {
    const { href, text, icon } = this.node.attrs as { href: string; text: string; icon: string | null };
    (this.dom as HTMLAnchorElement).href = href;
    this.dom.removeAttribute('title');
    this.dom.replaceChildren();
    const iconEl = document.createElement('span');
    iconEl.className = 'link-mention-icon';
    if (icon) { const image = document.createElement('img'); image.src = `/api/attachments/${encodeURIComponent(icon)}`; image.alt = ''; image.width = 14; image.height = 14; iconEl.append(image); }
    else iconEl.innerHTML = globeGlyph;
    const label = document.createElement('span');
    label.className = 'link-mention-title';
    let host = href;
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { /* keep */ }
    label.textContent = text || host;
    this.dom.append(iconEl, label);
  }
  update(node: PMNode) { if (node.type !== this.node.type) return false; this.node = node; this.render(); return true; }
  ignoreMutation() { return true; }
  stopEvent(event: Event) { return event.type === 'mousedown'; }
}

// How a date mention reads: 오늘 · 내일 · 어제 (relative, the default), the full date, a short date, or YYYY-MM-DD;
// with the time when it has one.
export function dateMentionLabel(date: string, format: string | null | undefined, now = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(date);
  if (!match) return date;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const withTime = !!match[4];
  const at = withTime ? (/Z|[+-]\d\d:\d\d$/.test(date) ? new Date(date) : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))) : day;
  const time = withTime ? ` ${formatTime(at)}` : '';
  if (format === 'iso') return `${match[1]}-${match[2]}-${match[3]}${withTime ? ` ${match[4]}:${match[5]}` : ''}`;
  if (format === 'short') return `${new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' }).format(at)}${time}`;
  if (format === 'full') return `${displayDate(date, { withTime: false })}${time}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - today.getTime()) / 86400000);
  const word = diff === 0 ? t("오늘") : diff === 1 ? t("내일") : diff === -1 ? t("어제") : null;
  return `${word ?? displayDate(date, { withTime: false })}${time}`;
}
// A mention whose time was chosen in another zone reads in that zone, with its name.
export function zonedMentionLabel(date: string, format: string | null | undefined, zone: string | null | undefined): string {
  if (!zone || !/T\d{2}:\d{2}.*([+-]\d\d:\d\d|Z)$/.test(date)) return dateMentionLabel(date, format);
  return `${dateMentionLabel(date.slice(0, 16), format)} ${zone.split('/').at(-1)!.replace(/_/g, ' ')}`;
}
// When the reminder of a date mention is due (its time, less the lead time).
export function dateMentionDue(date: string, remind: number | null | undefined): Date | null {
  if (remind === null || remind === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(date);
  if (!match) return null;
  const at = match[4] ? (/Z|[+-]\d\d:\d\d$/.test(date) ? new Date(date) : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))) : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0);
  return new Date(at.getTime() - remind * 60000);
}
export const dateMentionEvent = 'date-mention-edit';

export class DateMentionView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  private timer = 0;
  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.node = node;
    this.dom = document.createElement('span');
    this.dom.className = 'date-mention';
    this.dom.contentEditable = 'false';
    this.dom.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.shiftKey) return;
      event.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      this.view.dom.dispatchEvent(new CustomEvent(dateMentionEvent, { detail: { pos, rect: this.dom.getBoundingClientRect() } }));
    });
    this.render();
    // Relative words and the due state change with time.
    this.timer = window.setInterval(() => this.render(), 60000);
  }
  private render() {
    const { date, format, remind, zone } = this.node.attrs as { date: string; format: string | null; remind: number | null; zone: string | null };
    const due = dateMentionDue(date, remind);
    this.dom.classList.toggle('reminder', remind !== null && remind !== undefined);
    this.dom.classList.toggle('due', !!due && due.getTime() <= Date.now());
    this.dom.dataset.dateMention = date;
    this.dom.textContent = `${remind !== null && remind !== undefined ? '⏰ ' : '@'}${zonedMentionLabel(date, format, zone)}`;
  }
  update(node: PMNode) { if (node.type !== this.node.type) return false; this.node = node; this.render(); return true; }
  ignoreMutation() { return true; }
  stopEvent(event: Event) { return event.type === 'mousedown'; }
  destroy() { window.clearInterval(this.timer); }
}
