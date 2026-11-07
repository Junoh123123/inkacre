import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';

// Page body model: blocks are kept flat with a `depth` attribute (children are
// the following blocks with a larger depth). Columns are the exception: a
// `columns` node holds `column` nodes, each with its own flat block list. Tabs work the
// same way: a `tabs` node (a block with its own handle) holds `tab` nodes (name + icon).
// Every block node carries the engine block id so edits map 1:1 to commands.

const blockAttrs = {
  id: { default: '' },
  depth: { default: 0 },
};

export const textTypes = ['paragraph', 'heading1', 'heading2', 'heading3', 'heading4', 'bullet', 'numbered', 'todo', 'toggle', 'quote', 'callout'] as const;
export type TextType = typeof textTypes[number];

const nodes: Record<string, NodeSpec> = {
  doc: { content: '(flat | columns | tabs)+' },
  text_block: {
    group: 'flat',
    content: 'inline*',
    attrs: { ...blockAttrs, blockType: { default: 'paragraph' }, checked: { default: false }, virtual: { default: false }, icon: { default: null as string | null }, color: { default: null as string | null }, toggleable: { default: false }, listFormat: { default: null as string | null }, direction: { default: null as string | null } },
    defining: true,
    parseDOM: [
      { tag: 'p', getAttrs: () => ({ blockType: 'paragraph' }) },
      { tag: 'h1', getAttrs: () => ({ blockType: 'heading1' }) },
      { tag: 'h2', getAttrs: () => ({ blockType: 'heading2' }) },
      { tag: 'h3', getAttrs: () => ({ blockType: 'heading3' }) },
      { tag: 'h4', getAttrs: () => ({ blockType: 'heading4' }) },
      { tag: 'blockquote', getAttrs: () => ({ blockType: 'quote' }) },
      { tag: 'div[data-block-type]', getAttrs: dom => ({ blockType: (dom as HTMLElement).dataset.blockType ?? 'paragraph', id: (dom as HTMLElement).dataset.blockId ?? '' }) },
    ],
    toDOM: node => ['div', { class: `block block-${node.attrs.blockType}`, 'data-block-type': node.attrs.blockType, 'data-block-id': node.attrs.id }, ['div', { class: 'block-text' }, 0]],
  },
  code_block: {
    group: 'flat',
    content: 'text*',
    marks: '',
    code: true,
    // caption: null = none, '' = being added (shown while focused).
    attrs: { ...blockAttrs, language: { default: 'plain' }, caption: { default: null as string | null } },
    defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: node => ['div', { class: 'block block-code', 'data-block-id': node.attrs.id }, ['pre', ['code', 0]]],
  },
  // Atom blocks rendered by React node views (image, file, bookmark, table, …).
  atom_block: {
    group: 'flat',
    atom: true,
    selectable: true,
    draggable: false,
    attrs: { ...blockAttrs, blockType: { default: 'divider' } },
    parseDOM: [{ tag: 'hr', getAttrs: () => ({ blockType: 'divider' }) }],
    toDOM: node => ['div', { class: `block block-${node.attrs.blockType}`, 'data-block-id': node.attrs.id }],
  },
  // Child page link (a page whose parent is this page).
  page_link: {
    group: 'flat',
    atom: true,
    selectable: true,
    attrs: { ...blockAttrs },
    toDOM: node => ['div', { class: 'block block-page', 'data-block-id': node.attrs.id }],
  },
  // Inline database (a source on this page, or linked views of another source).
  database: {
    group: 'flat',
    atom: true,
    selectable: true,
    attrs: { ...blockAttrs, sourceId: { default: '' }, viewIds: { default: [] as string[] }, linked: { default: false } },
    toDOM: node => ['div', { class: 'block block-database', 'data-block-id': node.attrs.id }],
  },
  columns: {
    content: 'column+',
    attrs: { ...blockAttrs },
    isolating: true,
    toDOM: node => ['div', { class: 'block block-columns', 'data-block-id': node.attrs.id }, 0],
  },
  column: {
    content: '(flat | tabs)+',
    attrs: { id: { default: '' }, ratio: { default: null as number | null } },
    isolating: true,
    toDOM: node => ['div', { class: 'block-column', 'data-block-id': node.attrs.id }, 0],
  },
  tabs: {
    content: 'tab+',
    attrs: { ...blockAttrs },
    isolating: true,
    selectable: true,
    toDOM: node => ['div', { class: 'block block-tabs', 'data-block-id': node.attrs.id }, ['div', { class: 'tabs-panels' }, 0]],
  },
  tab: {
    content: '(flat | columns | tabs)+',
    attrs: { id: { default: '' }, title: { default: '' }, icon: { default: null as string | null } },
    isolating: true,
    toDOM: node => ['div', { class: 'tab-panel', 'data-tab-id': node.attrs.id }, 0],
  },
  text: { group: 'inline' },
  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },
  mention: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { pageId: { default: '' }, text: { default: '' }, marks: { default: null as Record<string, unknown> | null } },
    parseDOM: [{ tag: 'span[data-mention]', getAttrs: dom => ({ pageId: (dom as HTMLElement).dataset.mention, text: (dom as HTMLElement).textContent ?? '' }) }],
    toDOM: node => ['span', { class: 'mention', 'data-mention': node.attrs.pageId }, node.attrs.text],
  },
  // A web link mention (링크 멘션): the site's icon (attachment) and the page title, opening the address.
  link_mention: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { href: { default: '' }, text: { default: '' }, icon: { default: null as string | null }, site: { default: null as string | null }, description: { default: null as string | null }, marks: { default: null as Record<string, unknown> | null } },
    parseDOM: [{ tag: 'a[data-link-mention]', getAttrs: dom => ({ href: (dom as HTMLElement).getAttribute('href') ?? '', text: (dom as HTMLElement).textContent ?? '' }) }],
    toDOM: node => ['a', { class: 'link-mention', 'data-link-mention': '', href: node.attrs.href }, node.attrs.text],
  },
  // A custom emoji (사용자 지정 이모지) in the text: its picture, written as :name:.
  custom_emoji: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { attachmentId: { default: '' }, name: { default: '' }, marks: { default: null as Record<string, unknown> | null } },
    parseDOM: [{ tag: 'img[data-custom-emoji]', getAttrs: dom => ({ attachmentId: (dom as HTMLElement).dataset.customEmoji ?? '', name: ((dom as HTMLImageElement).alt ?? '').replace(/^:|:$/g, '') }) }],
    toDOM: node => ['img', { class: 'custom-emoji', 'data-custom-emoji': node.attrs.attachmentId, alt: `:${node.attrs.name}:`, title: `:${node.attrs.name}:`, src: `/api/attachments/${encodeURIComponent(node.attrs.attachmentId)}`, draggable: 'false' }],
  },
  // A date mention (@날짜): the day (and time), how it reads (relative by default), and an optional reminder.
  date_mention: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { date: { default: '' }, text: { default: '' }, format: { default: null as string | null }, remind: { default: null as number | null }, reminderId: { default: null as string | null }, zone: { default: null as string | null }, marks: { default: null as Record<string, unknown> | null } },
    parseDOM: [{ tag: 'span[data-date-mention]', getAttrs: dom => ({ date: (dom as HTMLElement).dataset.dateMention ?? '', text: (dom as HTMLElement).textContent ?? '' }) }],
    toDOM: node => ['span', { class: 'date-mention', 'data-date-mention': node.attrs.date }, node.attrs.text],
  },
  // Inline equation: an atom holding its TeX; other run styles ride along in marks.
  equation: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { tex: { default: '' }, marks: { default: null as Record<string, unknown> | null } },
    parseDOM: [{ tag: 'span[data-equation]', getAttrs: dom => ({ tex: (dom as HTMLElement).dataset.equation ?? '' }) }],
    toDOM: node => ['span', { class: 'inline-equation', 'data-equation': node.attrs.tex }, node.attrs.tex],
  },
};

const marks: Record<string, MarkSpec> = {
  bold: { parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: dom => (dom as HTMLElement).style.fontWeight !== 'normal' && null }, { style: 'font-weight=600' }, { style: 'font-weight=700' }, { style: 'font-weight=bold' }], toDOM: () => ['strong', 0] },
  italic: { parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
  underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
  strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
  code: { excludes: '', parseDOM: [{ tag: 'code' }], toDOM: () => ['code', { class: 'inline-code' }, 0] },
  link: {
    attrs: { href: { default: '' } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: dom => ({ href: (dom as HTMLAnchorElement).getAttribute('href') }) }],
    toDOM: mark => ['a', { href: mark.attrs.href, class: 'inline-link', rel: 'noopener noreferrer', target: '_blank' }, 0],
  },
  // Text a discussion is about. Several threads can cover the same text.
  comment: {
    attrs: { id: { default: '' } },
    excludes: '',
    inclusive: false,
    parseDOM: [{ tag: 'span[data-comment]', getAttrs: dom => ({ id: (dom as HTMLElement).dataset.comment }) }],
    toDOM: mark => ['span', { class: 'comment-mark', 'data-comment': mark.attrs.id }, 0],
  },
  color: {
    attrs: { color: { default: 'default' } },
    parseDOM: [{ tag: 'span[data-color]', getAttrs: dom => ({ color: (dom as HTMLElement).dataset.color }) }],
    toDOM: mark => {
      const value = mark.attrs.color as string;
      return value.startsWith('#') ? ['span', { 'data-color': value, style: `color:${value}` }, 0] : ['span', { 'data-color': value, class: `color-${value}` }, 0];
    },
  },
  background: {
    attrs: { color: { default: 'default' } },
    parseDOM: [{ tag: 'span[data-background]', getAttrs: dom => ({ color: (dom as HTMLElement).dataset.background }) }],
    toDOM: mark => {
      const value = mark.attrs.color as string;
      return value.startsWith('#') ? ['span', { 'data-background': value, style: `background:${value}` }, 0] : ['span', { 'data-background': value, class: `bg-${value}` }, 0];
    },
  },
};

export const schema = new Schema({ nodes, marks });

export const atomTypes = new Set(['divider', 'image', 'file', 'bookmark', 'button', 'table', 'toc', 'math', 'video', 'audio', 'breadcrumb', 'synced', 'synced_reference', 'html', 'pdf', 'embed', 'link_to_page']);
export const listTypes = new Set(['bullet', 'numbered', 'todo', 'toggle']);
// Toggle lists and collapsible headings fold their children the same way.
export function isToggleNode(node: import('prosemirror-model').Node) {
  return node.type.name === 'text_block' && (node.attrs.blockType === 'toggle' || (!!node.attrs.toggleable && /^heading[1-4]$/.test(node.attrs.blockType)));
}
