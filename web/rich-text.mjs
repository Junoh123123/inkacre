export function splitRuns(runs, offset) {
  const left = [], right = []; let consumed = 0;
  for (const run of runs) {
    const split = Math.max(0, Math.min(run.text.length, offset - consumed));
    if (split) left.push({ ...run, text: run.text.slice(0, split) });
    if (split < run.text.length) right.push({ ...run, text: run.text.slice(split) });
    consumed += run.text.length;
  }
  return [left, right];
}
export const runsText = runs => runs.map(run => run.text).join('');
export function blockOrdinal(siblings, id) {
  let number = 0;
  for (const sibling of siblings) {
    number = sibling.blockType === 'numbered' ? number + 1 : 0;
    if (sibling.id === id) return number;
  }
  return 0;
}
export function markdownBlock(text) {
  if (/^#{1,3}$/.test(text)) return { blockType: `heading${text.length}` };
  if (['*', '-', '+'].includes(text)) return { blockType: 'bullet' };
  if (/^\d+\.$/.test(text)) return { blockType: 'numbered' };
  if (['[]', '[ ]', '[x]', '[X]'].includes(text)) return { blockType: 'todo', checked: /x/i.test(text) };
  if (text === '>') return { blockType: 'toggle' };
  if (text === '"') return { blockType: 'quote' };
  if (text === '---') return { blockType: 'divider' };
  return null;
}
export function selectedRuns(runs, start, end) { return splitRuns(splitRuns(runs, start)[1], end - start)[0]; }
export function replaceRuns(runs, start, end, replacement) {
  return [...splitRuns(runs, start)[0], ...replacement, ...splitRuns(runs, end)[1]].filter(run => run.text);
}
export function patchRuns(runs, start, end, patch) {
  const replacement = selectedRuns(runs, start, end).map(run => {
    const changed = { ...run };
    for (const [key, value] of Object.entries(patch)) { if (value == null) delete changed[key]; else changed[key] = value; }
    return changed;
  });
  return replaceRuns(runs, start, end, replacement);
}
export function toggleMark(runs, start, end, mark) {
  const selected = selectedRuns(runs, start, end);
  return patchRuns(runs, start, end, { [mark]: selected.length && selected.every(run => run[mark]) ? null : true });
}
