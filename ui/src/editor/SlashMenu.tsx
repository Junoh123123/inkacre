import { t } from '../i18n';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/Icon';
import { MenuPreview } from '../ui/Menu';
import { slashPreview } from './blockPreview';
import { filterSlash, slashSections, type SlashItem } from './slashItems';

export interface KeyTarget { onKey: (event: KeyboardEvent) => boolean }

export interface SlashMenuProps { anchor: { x: number; y: number; height: number }; query: string; onChoose: (item: SlashItem) => void; onClose: () => void; onMiss: (count: number) => void }

export const SlashMenu = forwardRef<KeyTarget, SlashMenuProps>(function SlashMenu({ anchor, query, onChoose, onClose, onMiss }, ref) {
  const items = useMemo(() => filterSlash(query), [query]);
  const [active, setActive] = useState(0);
  // The preview card shows for the item picked with the arrow keys, not under the pointer.
  const [keyboard, setKeyboard] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { onMiss(items.length ? 0 : 1); }, [items.length]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  useImperativeHandle(ref, () => ({
    onKey(event) {
      if (event.key === 'ArrowDown') { setKeyboard(true); setActive(index => (index + 1) % Math.max(1, items.length)); return true; }
      if (event.key === 'ArrowUp') { setKeyboard(true); setActive(index => (index - 1 + items.length) % Math.max(1, items.length)); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { const item = items[active]; if (item) { onChoose(item); return true; } onClose(); return false; }
      return false;
    },
  }), [items, active, onChoose, onClose]);

  const filtered = !!query.trim();
  const groups = filtered ? [{ label: t("필터링된 결과"), items }] : slashSections.map(section => ({ label: section, items: items.filter(item => item.section === section) })).filter(group => group.items.length);
  let index = -1;
  return (
    <Popover anchor={{ x: anchor.x, y: anchor.y, width: 0, height: anchor.height }} placement="below-start" offset={8} onClose={onClose} className="slash-menu" style={{ width: 324 }} role="listbox" label={t("블록 명령")}>
      {items.length ? (
        <div className="slash-scroller" ref={listRef}>
          {groups.map(group => (
            <div key={group.label} className="slash-group">
              <div className="menu-heading slash-heading">{group.label}</div>
              {group.items.map(item => {
                index++;
                const myIndex = index;
                return (
                  <div key={item.id} role="option" aria-selected={myIndex === active} data-index={myIndex} className={`slash-item${myIndex === active ? ' active' : ''}`}
                    onPointerMove={() => { if (myIndex !== active) { setActive(myIndex); setKeyboard(false); } }} onMouseDown={event => { event.preventDefault(); onChoose(item); }}>
                    <span className="slash-item-icon">{item.swatch ? <span className={`swatch ${item.swatch}`}>{item.swatch.startsWith('swatch-text-') ? 'A' : ''}</span> : <Icon name={item.icon} />}</span>
                    <span className="slash-item-label">{item.label}{(filtered || item.showSub) && item.sub ? <span className="slash-item-sub"> · {item.sub}</span> : null}</span>
                    {item.badge ? <span className={`menu-item-badge${item.badge === t("slash|신규") ? ' new' : ''}`}>{item.badge}</span> : null}
                    {item.hint ? <span className="slash-item-hint">{item.hint}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
      {keyboard && items[active] && slashPreview(items[active].id) ? <MenuPreview target={() => listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`) ?? null} index={active} preview={slashPreview(items[active].id)!} /> : null}
      <div className="slash-footer">
        <div className="slash-close" onMouseDown={event => { event.preventDefault(); onClose(); }}><span>{t("메뉴 닫기")}</span><span className="slash-esc">esc</span></div>
      </div>
    </Popover>
  );
});
