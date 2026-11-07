import { DatabaseFrame } from './DatabaseFrame';

// Inline database inside a page (a source on the page, or linked views of another source).
export function DatabaseBlock({ sourceId, viewIds, pageId, linked, inline = true }: { sourceId: string; viewIds: string[]; pageId: string; linked: boolean; inline?: boolean }) {
  return <DatabaseFrame sourceId={sourceId} viewIds={viewIds} pageId={pageId} linked={linked} inline={inline} />;
}
