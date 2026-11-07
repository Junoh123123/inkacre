import test from 'node:test';
import assert from 'node:assert/strict';
import { runsText, selectedRuns, replaceRuns, patchRuns, toggleMark } from '../web/rich-text.mjs';

test('partial rich text edits preserve unselected text, Unicode, links and independent marks', () => {
  const original = [{ text: '한글 🙂\n' }, { text: 'first', bold: true, href: 'https://example.com' }, { text: ' second', italic: true }, { text: ' 끝' }];
  const start = '한글 🙂\nfi'.length, end = runsText(original).indexOf('ond') + 3;
  const selected = runsText(selectedRuns(original, start, end));
  const bold = toggleMark(original, start, end, 'bold');
  assert.equal(runsText(bold), runsText(original));
  assert.ok(selectedRuns(bold, start, end).every(run => run.bold));
  assert.equal(selectedRuns(bold, start, end)[0].href, 'https://example.com');
  assert.equal(bold.at(-1).text, ' 끝');
  const plain = toggleMark(bold, start, end, 'bold');
  assert.ok(selectedRuns(plain, start, end).every(run => !run.bold));
  assert.equal(runsText(plain).slice(start, end), selected);
  assert.equal(selectedRuns(plain, start, end).at(-1).italic, true);
  assert.deepEqual(original[1], { text: 'first', bold: true, href: 'https://example.com' });
});

test('link to mention conversion and unlink retain formatting; insertion does not consume neighbours', () => {
  const runs = [{ text: 'before ' }, { text: 'target', bold: true, href: 'https://example.com' }, { text: ' after' }];
  const mention = patchRuns(runs, 7, 13, { href: null, pageId: 'page-1' });
  assert.deepEqual(selectedRuns(mention, 7, 13), [{ text: 'target', bold: true, pageId: 'page-1' }]);
  const unlinked = patchRuns(mention, 7, 13, { href: null, pageId: null });
  assert.deepEqual(selectedRuns(unlinked, 7, 13), [{ text: 'target', bold: true }]);
  const inserted = replaceRuns(mention, 13, 13, [{ text: ' 새 참조', pageId: 'page-2' }]);
  assert.equal(runsText(inserted), 'before target 새 참조 after');
  assert.equal(inserted.at(-1).text, ' after');
  assert.equal(runsText(replaceRuns(inserted, 0, runsText(inserted).length, [])), '');
});
