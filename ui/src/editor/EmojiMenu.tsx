import { t } from '../i18n';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/Icon';
import { readLocal, storeLocal } from '../data/api';
import { emojiGroups, withSkin } from '../page/emoji';
import type { KeyTarget } from './SlashMenu';
import { workspace } from '../data/store';

export function CustomEmojiImage({ name, size = 22 }: { name: string; size?: number }) {
  const id = workspace.customEmoji()[name];
  return id ? <img className="custom-emoji-cell" src={`/api/attachments/${encodeURIComponent(id)}`} alt={`:${name}:`} width={size} height={size} draggable={false} /> : <span>:{name}:</span>;
}

// The inline emoji picker that ":" + text (or /emoji, which types the ":") opens at the caret,
// 408×356, r10; 12px/500 #7d7a75 group heads, 32×32 cells (r4, 24px emoji)
// twelve to a row from x 12, the keyboard's cell filled rgba(33,27,23,.05); a bar of group
// buttons along the bottom. The text after ":" narrows the grid; arrows move, Enter picks.
const recentEmojiKey = 'pageyard-recent-emoji';
const columns = 12;

export interface EmojiMenuProps { anchor: { x: number; y: number; height: number }; query: string; onChoose: (emoji: string) => void; onClose: () => void }

export const EmojiMenu = forwardRef<KeyTarget, EmojiMenuProps>(function EmojiMenu({ anchor, query, onChoose, onClose }, ref) {
  const [active, setActive] = useState(0);
  const [current, setCurrent] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const groups = useMemo(() => {
    const recent = readLocal<string[]>(recentEmojiKey, []).filter(emoji => !emoji.startsWith('icon:') && !emoji.startsWith('custom:'));
    // 사용자 지정 이모지 first (named pictures), as "custom:<name>".
    const custom = Object.keys(workspace.customEmoji()).sort().map(name => ({ emoji: `custom:${name}`, words: name }));
    const all = [...(custom.length ? [{ name: t("사용자 지정"), items: custom }] : []), ...(recent.length && !needle ? [{ name: t("최근 사용"), items: recent.map(emoji => ({ emoji, words: '' })) }] : []), ...emojiGroups];
    return all.map(group => ({ ...group, items: group.items.filter(item => !needle || item.words.toLocaleLowerCase().includes(needle)) })).filter(group => group.items.length);
  }, [needle]);
  const flat = useMemo(() => groups.flatMap(group => group.items.map(item => item.emoji)), [groups]);
  useEffect(() => { setActive(0); scrollerRef.current?.scrollTo({ top: 0 }); }, [needle]);
  // Nothing matches: the menu goes away and the typed text stays (":)" stays a smiley in text).
  useEffect(() => { if (needle && !flat.length) onClose(); }, [needle, flat.length]);
  useEffect(() => { scrollerRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const tone = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'][readLocal<number>('pageyard-emoji-skin', 0)] ?? '';
  const pick = (raw: string) => {
    if (raw.startsWith('custom:')) { onChoose(raw); return; }
    const emoji = withSkin(raw, tone);
    const recent = readLocal<string[]>(recentEmojiKey, []);
    storeLocal(recentEmojiKey, JSON.stringify([emoji, ...recent.filter(item => item !== emoji)].slice(0, 18)));
    onChoose(emoji);
  };
  useImperativeHandle(ref, () => ({
    onKey(event) {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
      if (step) { setActive(index => Math.min(flat.length - 1, Math.max(0, index + step))); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { const emoji = flat[active]; if (emoji) { pick(emoji); return true; } }
      return false;
    },
  }), [flat, active]);
  const jump = (index: number) => {
    const scroller = scrollerRef.current;
    const target = scroller?.querySelectorAll<HTMLElement>('.emoji-group')[index];
    if (scroller && target) scroller.scrollTop = target.offsetTop - scroller.offsetTop;
  };
  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let index = 0;
    scroller.querySelectorAll<HTMLElement>('.emoji-group').forEach((head, i) => { if (head.offsetTop - scroller.offsetTop <= scroller.scrollTop + 4) index = i; });
    setCurrent(index);
  };
  let offset = 0;
  return (
    <Popover anchor={{ x: anchor.x, y: anchor.y, width: 0, height: anchor.height }} placement="below-start" offset={8} onClose={onClose} className="emoji-picker emoji-inline" style={{ width: 408 }} label={t("이모지")} motion="fade">
      <div className="emoji-scroller" ref={scrollerRef} onScroll={onScroll}>
        {groups.map(group => {
          const start = offset;
          offset += group.items.length;
          return (
            <div key={group.name} className="emoji-group">
              <div className="emoji-group-head">{group.name}</div>
              <div className="emoji-grid">
                {group.items.map((item, i) => (
                  <button type="button" key={`${item.emoji}-${i}`} data-index={start + i} className={`emoji-cell${start + i === active ? ' active' : ''}`} title={item.words.split(' ')[0] || item.emoji}
                    onPointerMove={() => setActive(start + i)} onMouseDown={event => { event.preventDefault(); pick(item.emoji); }}>{item.emoji.startsWith('custom:') ? <CustomEmojiImage name={item.emoji.slice(7)} /> : withSkin(item.emoji, tone)}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="emoji-categories">
        {groups.map((group, index) => (
          <button type="button" key={group.name} className={`emoji-category${index === current ? ' active' : ''}`} title={group.name} aria-label={t("분류로 이동: {0}", [group.name])} onMouseDown={event => { event.preventDefault(); jump(index); }}>
            {group.name === t("최근 사용") ? <Icon name="clock" size={18} /> : group.items[0].emoji.startsWith('custom:') ? <CustomEmojiImage name={group.items[0].emoji.slice(7)} /> : <span className="emoji-category-glyph">{group.items[0].emoji}</span>}
          </button>
        ))}
      </div>
    </Popover>
  );
});
