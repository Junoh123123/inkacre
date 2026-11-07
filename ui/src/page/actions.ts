import { titleNameField } from '../data/format';
import { language, t } from '../i18n';
import { apply, forgetUndo, newId, titleDraftKey, undoCommand } from '../data/commands';
import { currentRoute, navigate, openPeek } from '../data/router';
import { workspace } from '../data/store';
import type { Operation, PageEntity, SourceEntity } from '../data/types';

// A page made with the sidebar's new-page button shows where it lives ("🔒 개인 페이지 ⌄") beside its name in the top
// bar until the app is reloaded, so it can be moved somewhere else straight away.
export const placeablePages = new Set<string>();

export async function createPage({ parentId, title = '', open = true, beforeId, placeable = false }: { parentId: string | null; title?: string; open?: boolean | 'center'; beforeId?: string; placeable?: boolean }) {
  const id = newId();
  if (placeable) placeablePages.add(id);
  const operations: Operation[] = [{ type: 'page.create', id, title, parentId }];
  if (beforeId && parentId) operations.push({ type: 'node.move', id, parentId, beforeId });
  const result = await apply(operations);
  if (open === 'center') {
    // "+" on a sidebar row: the new page shows up in the tree at once and
    // opens in a centred window over the current page, caret in the title. Closed while still
    // empty, it is dropped again as if it had never been made.
    freshPages.set(id, { handle: result.undoHandle });
    openPeek(id, 'center');
  } else if (open) navigate(id);
  return id;
}

// A row added with a table row's "+" and left without a title is dropped again when its title
// editor closes (Esc on the empty new row removes it). Only when nothing else changed
// since it was made — otherwise the undo is refused and the row stays.
const createdRows = new Map<string, string>();
export function discardEmptyRow(id: string) {
  const handle = createdRows.get(id);
  createdRows.delete(id);
  const page = workspace.get<PageEntity>(id);
  if (!handle || !page || page.title || workspace.children(id).length) return;
  const draft = localStorage.getItem(titleDraftKey(id));
  if (draft && (JSON.parse(draft) as { value?: string }).value) return;
  undoCommand(handle).then(() => forgetUndo(handle)).catch(() => undefined);
}

const freshPages = new Map<string, { handle?: string }>();
export const isFreshPage = (id: string) => freshPages.has(id);

function isEmptyPage(id: string) {
  const page = workspace.get<PageEntity>(id);
  if (!page || !workspace.visible(id)) return false;
  if (page.title || page.icon || page.coverAttachmentId) return false;
  const draft = localStorage.getItem(titleDraftKey(id));
  if (draft && (JSON.parse(draft) as { value?: string }).value) return false;
  return !workspace.children(id).length;
}

// Called when a fresh page's window closes; keeps the page if anything was put in it or it was
// opened as a full page.
export function settleFreshPage(id: string) {
  const fresh = freshPages.get(id);
  if (!fresh) return;
  freshPages.delete(id);
  window.setTimeout(() => {
    if (currentRoute().id === id || currentRoute().peek === id || !isEmptyPage(id)) return;
    const discard = fresh.handle
      ? undoCommand(fresh.handle).then(() => forgetUndo(fresh.handle!)).catch(() => (isEmptyPage(id) ? apply([{ type: 'node.trash', id }], { recordUndo: false }) : undefined))
      : apply([{ type: 'node.trash', id }], { recordUndo: false });
    discard.catch(() => undefined);
  }, 800);
}

// New database row; applies the source's default template like the engine does.
export async function createRow(sourceId: string, { values = {}, title = '', open = 'side', parentTaskId, beforeId }: { values?: Record<string, unknown>; title?: string; open?: 'side' | 'center' | 'page' | false; parentTaskId?: string; beforeId?: string } = {}) {
  const id = newId();
  const source = workspace.get<SourceEntity>(sourceId);
  // 페이지 레이아웃 › 데이터베이스 템플릿 off: new pages start empty instead of from the default template.
  const operations: Operation[] = [{ type: 'page.create', id, title, sourceId, ...(source?.pageLayout?.templates === false ? { templateId: null } : {}) }];
  if (beforeId) operations.push({ type: 'node.move', id, parentId: sourceId, beforeId });
  if (parentTaskId && source?.tasks?.subitems?.parentPropertyId) operations.push({ type: 'relation.set', pageId: id, propertyId: source.tasks.subitems.parentPropertyId, targetIds: [parentTaskId] });
  for (const [propertyId, value] of Object.entries(values)) if (value !== undefined) operations.push({ type: 'value.set', pageId: id, propertyId, value });
  const result = await apply(operations);
  if (result.undoHandle) { createdRows.set(id, result.undoHandle); if (createdRows.size > 50) createdRows.delete(createdRows.keys().next().value!); }
  if (open === 'page') navigate(id);
  else if (open) openPeek(id, open);
  return id;
}

export async function createTemplate(sourceId: string) {
  const id = newId();
  await apply([{ type: 'page.create', id, title: '', sourceId, template: true }]);
  navigate(id);
  return id;
}

export async function createDatabase(pageId: string, { name = t("새 데이터베이스"), viewType = 'table', open = false }: { name?: string; viewType?: string; open?: boolean } = {}) {
  const sourceId = newId(), viewId = newId();
  const statusId = newId();
  await apply([
    { type: 'source.create', id: sourceId, pageId, name, titlePropertyId: newId(), ...titleNameField() },
    { type: 'property.create', id: statusId, sourceId, name: t("상태"), propertyType: 'status', options: [
      { id: newId(), name: t("시작 전"), group: 'todo', color: 'gray' },
      { id: newId(), name: t("진행 중"), group: 'in_progress', color: 'blue' },
      { id: newId(), name: t("완료"), group: 'complete', color: 'green' },
    ] },
    { type: 'view.create', id: viewId, sourceId, parentId: pageId, name: viewType === 'table' ? t("표") : name, viewType, config: viewType === 'board' ? { groupBy: statusId } : {} },
  ]);
  if (open) navigate(viewId);
  return { sourceId, viewId };
}

// "Full page" database: a page whose content is the database.
export async function createDatabasePage(parentId: string | null, viewType = 'table') {
  const pageId = newId();
  await apply([{ type: 'page.create', id: pageId, title: t("새 데이터베이스"), parentId }, { type: 'page.update', id: pageId, databasePage: true }]);
  const { viewId } = await createDatabase(pageId, { name: t("새 데이터베이스"), viewType });
  navigate(pageId);
  return { pageId, viewId };
}

export async function duplicatePage(page: PageEntity, options: { withoutRows?: boolean } = {}) {
  const id = newId();
  // The engine names the copy "<title> 사본"; other languages pass their own wording. A template stays a template.
  await apply([{ type: 'page.duplicate', id: page.id, newId: id, ...(language === 'ko' ? {} : { title: t("{0} 사본", [page.title]) }), ...(options.withoutRows ? { withoutRows: true } : {}), ...(page.template ? { keepTemplate: true } : {}) }]);
  if (!page.sourceId) navigate(id);
  return id;
}

export async function trashNode(id: string) {
  await apply([{ type: 'node.trash', id }]);
}

export async function toggleFavorite(id: string) {
  const favorites = workspace.favorites();
  const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id];
  await apply([{ type: 'navigation.set', favorites: next }]);
}

export async function renamePage(page: PageEntity, title: string, revision?: number) {
  if (title === page.title) return;
  await apply([{ type: 'page.update', id: page.id, title }], { revision });
}
