import { t } from '../i18n';
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import { schema, atomTypes, textTypes } from './schema';
import { workspace } from '../data/store';
import type { BlockEntity, Entity, PageEntity, RichRun, RichText, ViewEntity } from '../data/types';

// ---------- rich text <-> ProseMirror inline content ----------

export function runsToInline(runs: RichText | undefined): PMNode[] {
  const nodes: PMNode[] = [];
  for (const run of runs ?? []) {
    if (!run.text) continue;
    const marks: Mark[] = [];
    if (run.bold) marks.push(schema.marks.bold.create());
    if (run.italic) marks.push(schema.marks.italic.create());
    if (run.underline) marks.push(schema.marks.underline.create());
    if (run.strike) marks.push(schema.marks.strike.create());
    if (run.code) marks.push(schema.marks.code.create());
    if (run.href) marks.push(schema.marks.link.create({ href: run.href }));
    if (run.color && run.color !== 'default') marks.push(schema.marks.color.create({ color: run.color }));
    if (run.background && run.background !== 'default') marks.push(schema.marks.background.create({ color: run.background }));
    for (const id of run.comments ?? []) marks.push(schema.marks.comment.create({ id }));
    if (run.equation) {
      const extra: Record<string, unknown> = { ...run };
      delete extra.text; delete extra.equation;
      nodes.push(schema.nodes.equation.create({ tex: run.text, marks: Object.keys(extra).length ? extra : null }));
      continue;
    }
    if (run.pageId) {
      const extra: Record<string, unknown> = { ...run };
      delete extra.text; delete extra.pageId;
      nodes.push(schema.nodes.mention.create({ pageId: run.pageId, text: run.text, marks: Object.keys(extra).length ? extra : null }));
      continue;
    }
    if (run.mention && run.href) {
      const extra: Record<string, unknown> = { ...run };
      for (const key of ['text', 'href', 'mention', 'iconAttachmentId', 'linkSite', 'linkDescription']) delete extra[key];
      nodes.push(schema.nodes.link_mention.create({ href: run.href, text: run.text, icon: run.iconAttachmentId ?? null, site: run.linkSite ?? null, description: run.linkDescription ?? null, marks: Object.keys(extra).length ? extra : null }));
      continue;
    }
    if (run.customEmoji) {
      const extra: Record<string, unknown> = { ...run };
      for (const key of ['text', 'customEmoji']) delete extra[key];
      nodes.push(schema.nodes.custom_emoji.create({ attachmentId: run.customEmoji, name: run.text.replace(/^:|:$/g, ''), marks: Object.keys(extra).length ? extra : null }));
      continue;
    }
    if (run.date) {
      const extra: Record<string, unknown> = { ...run };
      for (const key of ['text', 'date', 'dateFormat', 'remind', 'reminderId', 'dateZone']) delete extra[key];
      nodes.push(schema.nodes.date_mention.create({ date: run.date, text: run.text, format: run.dateFormat ?? null, remind: run.remind ?? null, reminderId: run.reminderId ?? null, zone: run.dateZone ?? null, marks: Object.keys(extra).length ? extra : null }));
      continue;
    }
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (index) nodes.push(schema.nodes.hard_break.create());
      if (part) nodes.push(schema.text(part, marks));
    });
  }
  return nodes;
}

function runFromMarks(text: string, marks: readonly Mark[]): RichRun {
  const run: RichRun = { text };
  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold': run.bold = true; break;
      case 'italic': run.italic = true; break;
      case 'underline': run.underline = true; break;
      case 'strike': run.strike = true; break;
      case 'code': run.code = true; break;
      case 'link': if (mark.attrs.href) run.href = mark.attrs.href; break;
      case 'color': if (mark.attrs.color && mark.attrs.color !== 'default') run.color = mark.attrs.color; break;
      case 'background': if (mark.attrs.color && mark.attrs.color !== 'default') run.background = mark.attrs.color; break;
      case 'comment': if (mark.attrs.id) (run.comments ??= []).push(mark.attrs.id); break;
    }
  }
  if (run.comments) run.comments = [...new Set(run.comments)].sort();
  return run;
}

const sameStyle = (a: RichRun, b: RichRun) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete('text');
  for (const key of keys) {
    if (key === 'comments') { if ((a.comments ?? []).join(',') !== (b.comments ?? []).join(',')) return false; continue; }
    if ((a as unknown as Record<string, unknown>)[key] !== (b as unknown as Record<string, unknown>)[key]) return false;
  }
  return !a.pageId && !b.pageId && !a.equation && !b.equation && !a.mention && !b.mention && !a.date && !b.date && !a.customEmoji && !b.customEmoji;
};

export function inlineToRuns(node: PMNode | Fragment): RichText {
  const runs: RichText = [];
  const push = (run: RichRun) => {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, run)) last.text += run.text;
    else runs.push(run);
  };
  const content = node instanceof Fragment ? node : node.content;
  content.forEach(child => {
    if (child.isText) push(runFromMarks(child.text ?? '', child.marks));
    else if (child.type.name === 'hard_break') {
      const last = runs[runs.length - 1];
      if (last && !last.pageId && !last.equation && !last.mention && !last.date) last.text += '\n'; else runs.push({ text: '\n' });
    } else if (child.type.name === 'mention') {
      runs.push({ text: child.attrs.text || workspace.title(workspace.get(child.attrs.pageId)) || t("페이지"), ...(child.attrs.marks ?? {}), pageId: child.attrs.pageId });
    } else if (child.type.name === 'equation' && child.attrs.tex) {
      runs.push({ text: child.attrs.tex, ...(child.attrs.marks ?? {}), equation: true });
    } else if (child.type.name === 'link_mention' && child.attrs.href) {
      runs.push({ text: child.attrs.text || child.attrs.href, ...(child.attrs.marks ?? {}), href: child.attrs.href, mention: true, ...(child.attrs.icon ? { iconAttachmentId: child.attrs.icon } : {}),
        ...(child.attrs.site ? { linkSite: String(child.attrs.site).slice(0, 200) } : {}), ...(child.attrs.description ? { linkDescription: String(child.attrs.description).slice(0, 500) } : {}) });
    } else if (child.type.name === 'custom_emoji' && child.attrs.attachmentId) {
      runs.push({ text: `:${child.attrs.name || 'emoji'}:`, ...(child.attrs.marks ?? {}), customEmoji: child.attrs.attachmentId });
    } else if (child.type.name === 'date_mention' && child.attrs.date) {
      runs.push({ text: child.attrs.text || child.attrs.date, ...(child.attrs.marks ?? {}), date: child.attrs.date, ...(child.attrs.format ? { dateFormat: child.attrs.format } : {}),
        ...(child.attrs.remind !== null && child.attrs.remind !== undefined ? { remind: child.attrs.remind } : {}), ...(child.attrs.reminderId ? { reminderId: child.attrs.reminderId } : {}), ...(child.attrs.zone ? { dateZone: child.attrs.zone } : {}) });
    }
  });
  return runs.filter(run => run.text);
}

export const runsEqual = (a: RichText | undefined, b: RichText | undefined) => JSON.stringify(normalizeRuns(a ?? [])) === JSON.stringify(normalizeRuns(b ?? []));

export function normalizeRuns(runs: RichText): RichText {
  const result: RichText = [];
  for (const run of runs) {
    if (!run.text) continue;
    const clean: RichRun = { text: run.text };
    for (const key of ['bold', 'italic', 'underline', 'strike', 'code'] as const) if (run[key]) clean[key] = true;
    if (run.href) clean.href = run.href;
    if (run.pageId) clean.pageId = run.pageId;
    if (run.equation) clean.equation = true;
    if (run.mention) clean.mention = true;
    if (run.iconAttachmentId) clean.iconAttachmentId = run.iconAttachmentId;
    if (run.linkSite) clean.linkSite = run.linkSite;
    if (run.linkDescription) clean.linkDescription = run.linkDescription;
    if (run.dateZone) clean.dateZone = run.dateZone;
    if (run.date) clean.date = run.date;
    if (run.dateFormat) clean.dateFormat = run.dateFormat;
    if (run.remind !== undefined && run.remind !== null) clean.remind = run.remind;
    if (run.reminderId) clean.reminderId = run.reminderId;
    if (run.customEmoji) clean.customEmoji = run.customEmoji;
    if (run.color && run.color !== 'default') clean.color = run.color;
    if (run.background && run.background !== 'default') clean.background = run.background;
    if (run.comments?.length) clean.comments = [...new Set(run.comments)].sort();
    const last = result[result.length - 1];
    if (last && sameStyle(last, clean)) last.text += clean.text; else result.push(clean);
  }
  return result;
}

// ---------- store -> document ----------

export interface DraftLookup { (blockId: string): RichText | undefined }

function blockNode(block: BlockEntity, depth: number, draft?: DraftLookup): PMNode {
  const runs = draft?.(block.id) ?? block.richText;
  if ((textTypes as readonly string[]).includes(block.blockType)) {
    return schema.nodes.text_block.create({ id: block.id, depth, blockType: block.blockType, checked: !!block.checked, icon: block.icon ?? null, color: block.color ?? null, toggleable: !!block.toggleable, listFormat: block.listFormat ?? null, direction: block.direction ?? null }, runsToInline(runs));
  }
  if (block.blockType === 'code') {
    const text = (runs ?? []).map(run => run.text).join('');
    const caption = block.caption?.length ? block.caption.map(run => run.text).join('') : null;
    return schema.nodes.code_block.create({ id: block.id, depth, language: block.language ?? 'plain', caption }, text ? schema.text(text) : undefined);
  }
  return schema.nodes.atom_block.create({ id: block.id, depth, blockType: atomTypes.has(block.blockType) ? block.blockType : 'divider' });
}

function emitBlocks(parentId: string, depth: number, out: PMNode[], draft?: DraftLookup, guard = new Set<string>()) {
  if (guard.has(parentId) || depth > 40) return;
  guard.add(parentId);
  for (const child of workspace.children(parentId)) {
    if (child.kind !== 'block') continue;
    const block = child as BlockEntity;
    if (block.blockType === 'columns') {
      out.push(columnsNode(block, depth, draft, guard));
      continue;
    }
    if (block.blockType === 'tabs') {
      out.push(tabsNode(block, depth, draft, guard));
      continue;
    }
    if (block.blockType === 'column' || block.blockType === 'tab') {
      // A stray column (or tab) outside its layout: show its contents in place.
      emitBlocks(block.id, depth, out, draft, guard);
      continue;
    }
    out.push(blockNode(block, depth, draft));
    if (block.blockType !== 'synced_reference') emitBlocks(block.id, depth + 1, out, draft, guard);
  }
}

function columnsNode(block: BlockEntity, depth: number, draft: DraftLookup | undefined, guard: Set<string>): PMNode {
  const columns = workspace.children(block.id).filter(child => child.kind === 'block' && (child as BlockEntity).blockType === 'column');
  const columnNodes = columns.map(column => {
    const inner: PMNode[] = [];
    emitBlocks(column.id, 0, inner, draft, guard);
    if (!inner.length) inner.push(schema.nodes.text_block.create({ id: newBlockId(), depth: 0, blockType: 'paragraph', virtual: true }));
    return schema.nodes.column.create({ id: column.id, ratio: (column as BlockEntity).ratio ?? null }, inner);
  });
  if (!columnNodes.length) columnNodes.push(schema.nodes.column.create({ id: newBlockId() }, [schema.nodes.text_block.create({ id: newBlockId(), virtual: true })]));
  return schema.nodes.columns.create({ id: block.id, depth }, columnNodes);
}

// Tabs: each tab holds its own flat block list (an empty tab shows one empty line).
function tabsNode(block: BlockEntity, depth: number, draft: DraftLookup | undefined, guard: Set<string>): PMNode {
  const tabs = workspace.children(block.id).filter(child => child.kind === 'block' && (child as BlockEntity).blockType === 'tab') as BlockEntity[];
  const emptyLine = () => schema.nodes.text_block.create({ id: newBlockId(), depth: 0, blockType: 'paragraph', virtual: true });
  const tabNodes = tabs.map(tab => {
    const inner: PMNode[] = [];
    emitBlocks(tab.id, 0, inner, draft, guard);
    if (!inner.length) inner.push(emptyLine());
    return schema.nodes.tab.create({ id: tab.id, title: (tab.richText ?? []).map(run => run.text).join(''), icon: tab.icon ?? null }, inner);
  });
  if (!tabNodes.length) tabNodes.push(schema.nodes.tab.create({ id: newBlockId(), title: t("탭{0}", [1]) }, [emptyLine()]));
  return schema.nodes.tabs.create({ id: block.id, depth }, tabNodes);
}

export const newBlockId = () => crypto.randomUUID();

export function pageNodes(pageId: string, draft?: DraftLookup): PMNode[] {
  const out: PMNode[] = [];
  const guard = new Set<string>();
  guard.add(pageId);
  const sourcesHere = new Set(workspace.children(pageId).filter(child => child.kind === 'source').map(child => child.id));
  const linkedSeen = new Set<string>();
  for (const child of workspace.children(pageId)) {
    if (child.kind === 'block') {
      const block = child as BlockEntity;
      if (block.blockType === 'columns') out.push(columnsNode(block, 0, draft, guard));
      else if (block.blockType === 'tabs') out.push(tabsNode(block, 0, draft, guard));
      else if (block.blockType === 'column' || block.blockType === 'tab') emitBlocks(block.id, 0, out, draft, guard);
      else {
        out.push(blockNode(block, 0, draft));
        if (block.blockType !== 'synced_reference') emitBlocks(block.id, 1, out, draft, guard);
      }
    } else if (child.kind === 'page' && !(child as PageEntity).sourceId && workspace.visible(child.id)) {
      out.push(schema.nodes.page_link.create({ id: child.id, depth: 0 }));
    } else if (child.kind === 'source' && workspace.visible(child.id)) {
      const views = workspace.viewsOf(child.id, pageId).map(view => view.id);
      out.push(schema.nodes.database.create({ id: child.id, depth: 0, sourceId: child.id, viewIds: views, linked: false }));
    } else if (child.kind === 'view' && workspace.visible(child.id)) {
      const view = child as ViewEntity;
      if (sourcesHere.has(view.sourceId) || linkedSeen.has(view.sourceId)) continue;
      linkedSeen.add(view.sourceId);
      const views = workspace.viewsOf(view.sourceId, pageId).map(item => item.id);
      out.push(schema.nodes.database.create({ id: `linked:${view.id}`, depth: 0, sourceId: view.sourceId, viewIds: views, linked: true }));
    }
  }
  return out;
}

export function buildDoc(pageId: string, draft?: DraftLookup): PMNode {
  const nodes = pageNodes(pageId, draft);
  const last = nodes[nodes.length - 1];
  // An empty line to type into always follows non-text content.
  if (!last || last.type.name !== 'text_block' || last.attrs.depth !== 0) nodes.push(schema.nodes.text_block.create({ id: newBlockId(), depth: 0, blockType: 'paragraph', virtual: true }));
  return schema.nodes.doc.create(null, nodes);
}

// ---------- document -> desired tree ----------

export interface DesiredBlock {
  id: string;
  parentId: string;
  kind: 'block' | 'page' | 'source' | 'view-group';
  node: PMNode;
  blockType?: string;
  richText?: RichText;
  checked?: boolean;
  language?: string;
  virtual?: boolean;
  icon?: string | null;
  color?: string | null;
  toggleable?: boolean;
  listFormat?: string | null;
  direction?: string | null;
  ratio?: number | null;
  columnIds?: string[];
  isLastTopLevel?: boolean;
  caption?: RichText | null;
}

export function desiredTree(doc: PMNode, pageId: string): { blocks: Map<string, DesiredBlock>; order: Map<string, string[]> } {
  const blocks = new Map<string, DesiredBlock>();
  const order = new Map<string, string[]>();
  const push = (parentId: string, id: string) => { const list = order.get(parentId); if (list) list.push(id); else order.set(parentId, [id]); };

  const walkFlat = (container: PMNode, rootParent: string, topLevel: boolean) => {
    const stack: string[] = [];
    let previousDepth = -1;
    container.forEach((node, _offset, index) => {
      if (node.type.name === 'columns') {
        const depth = Math.min(node.attrs.depth ?? 0, previousDepth + 1, stack.length);
        stack.length = depth;
        const parentId = depth === 0 ? rootParent : stack[depth - 1];
        const columnIds: string[] = [];
        node.forEach(column => columnIds.push(column.attrs.id));
        blocks.set(node.attrs.id, { id: node.attrs.id, parentId, kind: 'block', node, blockType: 'columns', richText: [], columnIds });
        push(parentId, node.attrs.id);
        node.forEach(column => {
          blocks.set(column.attrs.id, { id: column.attrs.id, parentId: node.attrs.id, kind: 'block', node: column, blockType: 'column', richText: [], ratio: column.attrs.ratio ?? null });
          push(node.attrs.id, column.attrs.id);
          walkFlat(column, column.attrs.id, false);
        });
        stack[depth] = node.attrs.id;
        stack.length = depth; // columns cannot hold flat children
        previousDepth = depth - 1;
        return;
      }
      if (node.type.name === 'tabs') {
        const depth = Math.min(node.attrs.depth ?? 0, previousDepth + 1, stack.length);
        stack.length = depth;
        const parentId = depth === 0 ? rootParent : stack[depth - 1];
        blocks.set(node.attrs.id, { id: node.attrs.id, parentId, kind: 'block', node, blockType: 'tabs', richText: [] });
        push(parentId, node.attrs.id);
        node.forEach(tab => {
          blocks.set(tab.attrs.id, { id: tab.attrs.id, parentId: node.attrs.id, kind: 'block', node: tab, blockType: 'tab', richText: tab.attrs.title ? [{ text: tab.attrs.title }] : [], icon: tab.attrs.icon ?? null });
          push(node.attrs.id, tab.attrs.id);
          walkFlat(tab, tab.attrs.id, false);
        });
        stack.length = depth; // a tabs block holds tabs only
        previousDepth = depth - 1;
        return;
      }
      let depth = Math.max(0, node.attrs.depth ?? 0);
      depth = Math.min(depth, previousDepth + 1, stack.length);
      stack.length = depth;
      const parentId = depth === 0 ? rootParent : stack[depth - 1];
      const id: string = node.attrs.id;
      if (node.type.name === 'page_link') {
        blocks.set(id, { id, parentId: pageId, kind: 'page', node });
        push(pageId, id);
      } else if (node.type.name === 'database') {
        if (node.attrs.linked) {
          for (const viewId of node.attrs.viewIds as string[]) { blocks.set(viewId, { id: viewId, parentId: pageId, kind: 'view-group', node }); push(pageId, viewId); }
        } else {
          blocks.set(id, { id, parentId: pageId, kind: 'source', node });
          push(pageId, id);
          // The source's views on this page stay where they are (not reordered, never trashed by the editor).
          for (const viewId of node.attrs.viewIds as string[]) blocks.set(viewId, { id: viewId, parentId: pageId, kind: 'view-group', node });
        }
      } else if (node.type.name === 'text_block') {
        blocks.set(id, { id, parentId, kind: 'block', node, blockType: node.attrs.blockType, richText: inlineToRuns(node), checked: node.attrs.checked, virtual: node.attrs.virtual, isLastTopLevel: index === container.childCount - 1,
          icon: node.attrs.icon ?? null, color: node.attrs.color ?? null, toggleable: !!node.attrs.toggleable, listFormat: node.attrs.listFormat ?? null, direction: node.attrs.direction ?? null });
        push(parentId, id);
      } else if (node.type.name === 'code_block') {
        blocks.set(id, { id, parentId, kind: 'block', node, blockType: 'code', richText: node.textContent ? [{ text: node.textContent }] : [], language: node.attrs.language, caption: node.attrs.caption ? [{ text: node.attrs.caption }] : null });
        push(parentId, id);
      } else {
        blocks.set(id, { id, parentId, kind: 'block', node, blockType: node.attrs.blockType });
        push(parentId, id);
      }
      stack[depth] = id;
      previousDepth = depth;
    });
  };
  walkFlat(doc, pageId, true);
  return { blocks, order };
}

export function isEntityInPage(entity: Entity, pageId: string): boolean {
  let item: Entity | undefined = entity;
  const seen = new Set<string>();
  while (item && !seen.has(item.id)) {
    seen.add(item.id);
    if (item.parentId === pageId) return true;
    item = workspace.get(item.parentId);
    if (item && item.kind !== 'block') return false;
  }
  return false;
}
