// Blocks just made from the / menu whose editor opens at once: the upload
// picker of image / video / audio / file blocks, the equation editor and the button's settings.
const pending = new Set<string>();
export const autoOpenTypes = new Set(['image', 'video', 'audio', 'file', 'math', 'button', 'html', 'pdf']);
export function markAutoOpen(id: string) { pending.add(id); }
export function takeAutoOpen(id: string) { return pending.delete(id); }
