import { workspace } from '../data/store';
import type { BlockEntity } from '../data/types';

// Extra block.create fields for blocks the editor creates from copies or pastes
// (attachments, table cells, bookmarks, buttons). The diff reads them when it creates the block.

const extras = new Map<string, Record<string, unknown>>();

export function setCreateExtras(id: string, data: Record<string, unknown>) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null));
  if (Object.keys(clean).length) extras.set(id, clean);
}
export const createExtras = (id: string) => extras.get(id);
export const forgetExtras = (id: string) => { extras.delete(id); };

export function extrasFromEntity(id: string): Record<string, unknown> {
  const entity = workspace.get<BlockEntity>(id);
  if (!entity || entity.kind !== 'block') return extras.get(id) ?? {};
  const data: Record<string, unknown> = {};
  const source = entity as BlockEntity & Record<string, unknown>;
  for (const key of ['attachmentId', 'url', 'bookmark', 'cells', 'tableHeader', 'button']) if (source[key] !== undefined && source[key] !== null) data[key] = structuredClone(source[key]);
  if (entity.blockType === 'synced_reference' && source.sourceBlockId) data.sourceBlockId = source.sourceBlockId;
  return data;
}
