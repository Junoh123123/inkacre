import { t } from '../i18n';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../ui/Icon';

// "페이지에서 찾기" (⌘F searches within the current page): a small bar at the top right of the page with
// the matches counted ("2/7"), ↑ ↓ (or Enter / ⇧Enter) to step through them and Esc to close. Matches are painted
// with the CSS Custom Highlight API, so the editor's DOM is never touched; the bar searches the open peek when
// there is one, otherwise the page in the frame (title, properties, content and database views).
let state = { open: false, nonce: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function openFindInPage() { state = { open: true, nonce: state.nonce + 1 }; emit(); }
export function closeFindInPage() { if (state.open) { state = { ...state, open: false }; emit(); } }
export function isFindOpen() { return state.open; }
function useFind() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state); }

type HighlightRegistry = Map<string, unknown>;
const highlights = (): HighlightRegistry | null => (globalThis.CSS as unknown as { highlights?: HighlightRegistry })?.highlights ?? null;
const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

export function findScope(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.peek .view-scroller, .peek .peek-scroller, .peek')
    ?? document.querySelector<HTMLElement>('.main-frame .view-scroller');
}

// Every case-insensitive occurrence of the text in visible text nodes under the element.
export function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      if (parent.closest('script, style, textarea, input, .find-bar, [aria-hidden="true"], .block-handles, .sr-only')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLocaleLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at); range.setEnd(node, at + needle.length);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      ranges.push(range);
    }
  }
  return ranges;
}

function paint(ranges: Range[], current: number) {
  const registry = highlights();
  if (!registry || !HighlightClass) return;
  if (!ranges.length) { registry.delete('pageyard-find'); registry.delete('pageyard-find-current'); return; }
  registry.set('pageyard-find', new HighlightClass(...ranges.filter((_, index) => index !== current)));
  if (ranges[current]) registry.set('pageyard-find-current', new HighlightClass(ranges[current])); else registry.delete('pageyard-find-current');
}

function reveal(range: Range | undefined) {
  if (!range) return;
  const element = range.startContainer.parentElement;
  const rect = range.getBoundingClientRect();
  const scroller = element?.closest<HTMLElement>('.view-scroller, .peek-scroller, .table-scroller, .board-scroller') ?? null;
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    if (rect.top < box.top + 60 || rect.bottom > box.bottom - 40) scroller.scrollBy({ top: rect.top - box.top - box.height / 3 });
    if (rect.left < box.left || rect.right > box.right) scroller.scrollBy({ left: rect.left - box.left - box.width / 3 });
  } else element?.scrollIntoView({ block: 'center' });
}

export function FindInPage() {
  const find = useFind();
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState(0);
  const ranges = useRef<Range[]>([]);
  const input = useRef<HTMLInputElement>(null);

  // ⌘F opens (or refocuses) the bar.
  useEffect(() => { if (find.open) requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); }); }, [find.open, find.nonce]);

  // Search again as the query, the page or its content changes.
  useEffect(() => {
    if (!find.open) { paint([], 0); return; }
    let frame = 0;
    const run = (keep: boolean) => {
      const scope = findScope();
      const next = scope && query ? findRanges(scope, query) : [];
      ranges.current = next;
      setCount(next.length);
      setCurrent(index => {
        const value = keep ? Math.min(index, Math.max(0, next.length - 1)) : 0;
        paint(next, value);
        return value;
      });
    };
    run(false);
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => run(true)); });
    const target = document.querySelector('.app') ?? document.body;
    observer.observe(target, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [find.open, query]);
  useEffect(() => { if (find.open && query) reveal(ranges.current[0]); }, [query]);
  useEffect(() => () => paint([], 0), []);

  if (!find.open) return null;
  const step = (delta: number) => {
    const total = ranges.current.length;
    if (!total) return;
    const next = (current + delta + total) % total;
    setCurrent(next);
    paint(ranges.current, next);
    reveal(ranges.current[next]);
  };
  const close = () => { closeFindInPage(); paint([], 0); };
  return (
    <div className="find-bar" role="search" aria-label={t("페이지에서 찾기")}>
      <Icon name="search" size={16} className="find-bar-icon" />
      <input ref={input} className="find-bar-input" value={query} placeholder={t("페이지에서 찾기")} aria-label={t("페이지에서 찾기")}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        }} />
      <span className="find-bar-count" aria-live="polite">{query ? (count ? `${current + 1}/${count}` : t("결과 없음")) : ''}</span>
      <button type="button" className="icon-button tiny" aria-label={t("이전 결과")} title={t("이전 결과")} disabled={!count} onClick={() => step(-1)}><Icon name="chevron-up" size={14} /></button>
      <button type="button" className="icon-button tiny" aria-label={t("다음 결과")} title={t("다음 결과")} disabled={!count} onClick={() => step(1)}><Icon name="chevron-down" size={14} /></button>
      <button type="button" className="icon-button tiny" aria-label={t("닫기")} title={t("닫기")} onClick={close}><Icon name="close" size={14} /></button>
    </div>
  );
}
