// Captions: code blocks keep theirs in `caption`, media blocks in their richText. "캡션 ⌘⌥M" asks
// the block's view to show its caption line and put the caret in it.
export const captionTypes = new Set(['image', 'video', 'audio', 'file', 'bookmark', 'html', 'pdf', 'embed']);
export function requestCaption(id: string) { window.dispatchEvent(new CustomEvent('caption-focus', { detail: { id } })); }
