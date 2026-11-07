import { t } from '../i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Popover, type Anchor, type Motion, type Placement } from './overlay';

// Menu with optional search, sections (12/500 headers), 28px items, shortcuts and
// hover-opened submenus (width 265, item 28, radius 10 panel, radius 6 items, 1px section
// separators inset 12).

export type MenuEntry =
  | { kind?: 'item'; id?: string; label: string; icon?: ReactNode | string; shortcut?: string; hint?: string; checked?: boolean; disabled?: boolean; danger?: boolean; badge?: string;
      keywords?: string; onSelect?: () => unknown; submenu?: () => MenuEntry[]; submenuWidth?: number; keepOpen?: boolean; right?: ReactNode;
      /** Grey label (the filter menu's "+ 고급 필터 추가"). */
      muted?: boolean;
      /** A dark preview card beside the item while it is highlighted (전환 items). */
      preview?: { image?: ReactNode; text: string };
      /** A submenu drawn by the caller (a page picker…), centred on the item. */
      panel?: (close: () => void) => ReactNode; panelWidth?: number; panelLabel?: string }
  | { kind: 'section'; label: string }
  | { kind: 'separator' }
  | { kind: 'custom'; render: (close: () => void) => ReactNode; keywords?: string };

type Item = Extract<MenuEntry, { label: string; kind?: 'item' }>;
const isItem = (entry: MenuEntry): entry is Item => entry.kind === undefined || entry.kind === 'item';
const opensSub = (item: Item) => !!(item.submenu || item.panel);

export interface MenuProps {
  anchor: Anchor;
  entries: MenuEntry[];
  onClose: () => void;
  placement?: Placement;
  width?: number;
  search?: string | false;
  searchEntries?: () => MenuEntry[];
  footer?: ReactNode;
  className?: string;
  offset?: number;
  label?: string;
  maxHeight?: number;
  onCloseAll?: () => void;
  motion?: Motion;
  owner?: Element | null;
  submenuPlacement?: Placement;
  /** A magnifier in the search box (the page "…" menu has one). */
  searchIcon?: boolean;
}

function renderIcon(icon: ReactNode | string | undefined) {
  if (icon === undefined) return null;
  return <span className="menu-item-icon">{typeof icon === 'string' ? <Icon name={icon} /> : icon}</span>;
}

// Splits flat entries into sections separated by explicit separators.
function sections(entries: MenuEntry[]) {
  const result: MenuEntry[][] = [[]];
  for (const entry of entries) {
    if (entry.kind === 'separator') { if (result[result.length - 1].length) result.push([]); }
    else result[result.length - 1].push(entry);
  }
  return result.filter(section => section.length);
}

export function Menu({ anchor, entries, onClose, placement = 'below-start', width = 265, search = false, searchEntries, footer, className, offset = 4, label, maxHeight, onCloseAll, motion, owner, submenuPlacement, searchIcon = false }: MenuProps) {
  const closeAll = onCloseAll ?? onClose;
  const [query, setQuery] = useState('');
  // Nothing is highlighted until the pointer or arrow keys move or a query is typed.
  const [active, setActive] = useState(-1);
  const [submenu, setSubmenu] = useState<{ index: number; element: HTMLElement } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    const pool = searchEntries ? searchEntries() : entries;
    const result: MenuEntry[] = [];
    let pendingSection: MenuEntry | null = null;
    for (const entry of pool) {
      if (entry.kind === 'section') { pendingSection = entry; continue; }
      if (entry.kind === 'separator') continue;
      const haystack = `${'label' in entry ? entry.label : ''} ${'keywords' in entry ? entry.keywords ?? '' : ''}`.toLocaleLowerCase();
      if (!haystack.includes(needle)) continue;
      if (pendingSection) { if (result.length) result.push({ kind: 'separator' }); result.push(pendingSection); pendingSection = null; }
      result.push(entry);
    }
    return result;
  }, [entries, query, searchEntries]);

  const items = useMemo(() => shown.filter(isItem).filter(item => !item.disabled), [shown]);
  useEffect(() => { setActive(query.trim() ? 0 : -1); }, [query]);
  useEffect(() => { if (search !== false) requestAnimationFrame(() => inputRef.current?.focus()); }, [search]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-menu-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = async (item: Item, element?: HTMLElement) => {
    if (item.disabled) return;
    if (opensSub(item)) { if (element) setSubmenu({ index: items.indexOf(item), element }); return; }
    if (!item.keepOpen) closeAll();
    await item.onSelect?.();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!items.length) return;
      setActive(current => (current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length));
      setSubmenu(null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[active];
      const element = listRef.current?.querySelector<HTMLElement>(`[data-menu-index="${active}"]`) ?? undefined;
      if (item) choose(item, element);
    } else if (event.key === 'ArrowRight') {
      const item = items[active];
      const element = listRef.current?.querySelector<HTMLElement>(`[data-menu-index="${active}"]`);
      if (item && opensSub(item) && element) { event.preventDefault(); setSubmenu({ index: active, element }); }
    } else if (event.key === 'ArrowLeft' && submenu) {
      event.preventDefault(); setSubmenu(null);
    }
  };

  let itemIndex = -1;
  const groups = sections(shown);
  const openItem = submenu ? items[submenu.index] : null;

  return (
    <Popover anchor={anchor} owner={owner} placement={placement} onClose={onClose} offset={offset} className={`menu-panel${className ? ` ${className}` : ''}`} style={{ width }} role="menu" label={label} motion={motion}>
      <div className="menu" onKeyDown={onKeyDown} tabIndex={-1} ref={element => { if (element && search === false) requestAnimationFrame(() => { if (!element.contains(document.activeElement)) element.focus({ preventScroll: true }); }); }}>
        {search !== false ? (
          <div className={`menu-search${searchIcon ? ' with-icon' : ''}`}>
            {searchIcon ? <Icon name="search" size={16} className="menu-search-icon" /> : null}
            <input ref={inputRef} className="menu-search-input" placeholder={search} value={query} onChange={event => setQuery(event.target.value)} aria-label={search} />
          </div>
        ) : null}
        <div className="menu-scroller" ref={listRef} style={maxHeight ? { maxHeight } : undefined} onPointerLeave={() => { if (!submenu && !query.trim()) setActive(-1); }}>
          {groups.length ? groups.map((group, groupIndex) => (
            <div className="menu-section" key={groupIndex}>
              {groupIndex > 0 ? <div className="menu-separator" role="separator" /> : null}
              <div className="menu-group">
                {group.map((entry, entryIndex) => {
                  if (entry.kind === 'section') return <div className="menu-heading" key={`h${entryIndex}`}>{entry.label}</div>;
                  if (entry.kind === 'custom') return <div className="menu-custom" key={`c${entryIndex}`}>{entry.render(closeAll)}</div>;
                  if (!isItem(entry)) return null;
                  const index = entry.disabled ? -1 : ++itemIndex;
                  return (
                    <div
                      key={entry.id ?? `${entry.label}-${entryIndex}`}
                      role="menuitem"
                      aria-disabled={entry.disabled || undefined}
                      aria-haspopup={entry.submenu ? 'menu' : entry.panel ? 'dialog' : undefined}
                      data-menu-index={index}
                      className={`menu-item${index === active ? ' active' : ''}${entry.disabled ? ' disabled' : ''}${entry.danger ? ' danger' : ''}${entry.muted ? ' muted' : ''}`}
                      onPointerMove={() => {
                        if (index < 0 || index === active) return;
                        setActive(index);
                        window.clearTimeout(hoverTimer.current);
                        if (opensSub(entry)) {
                          const element = listRef.current?.querySelector<HTMLElement>(`[data-menu-index="${index}"]`);
                          hoverTimer.current = window.setTimeout(() => element && setSubmenu({ index, element }), 90);
                        } else if (submenu) hoverTimer.current = window.setTimeout(() => setSubmenu(null), 160);
                      }}
                      onClick={event => choose(entry, event.currentTarget)}
                    >
                      {renderIcon(entry.icon)}
                      <span className="menu-item-label">{entry.label}</span>
                      {entry.badge ? <span className="menu-item-badge">{entry.badge}</span> : null}
                      {entry.hint ? <span className="menu-item-hint">{entry.hint}</span> : null}
                      {entry.right ?? null}
                      {entry.shortcut ? <span className="menu-item-shortcut">{entry.shortcut}</span> : null}
                      {entry.checked ? <Icon name="check" size={16} className="menu-item-check" /> : null}
                      {opensSub(entry) ? <Icon name="chevron-right" size={16} className="menu-item-chevron" /> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )) : <div className="menu-empty">{t("결과 없음")}</div>}
        </div>
        {footer ? <div className="menu-footer">{footer}</div> : null}
      </div>
      {openItem?.submenu && submenu ? (
        <Menu anchor={submenu.element} placement={submenuPlacement ?? 'right-start'} offset={0} width={openItem.submenuWidth ?? 220} entries={openItem.submenu()} onClose={() => setSubmenu(null)} onCloseAll={closeAll} submenuPlacement={submenuPlacement} />
      ) : null}
      {openItem?.panel && submenu ? (
        <Popover anchor={submenu.element} placement="side-middle" offset={0} onClose={() => setSubmenu(null)} className="menu-panel menu-sub-panel" style={{ width: openItem.panelWidth ?? 400 }} label={openItem.panelLabel ?? openItem.label}>
          {openItem.panel(closeAll)}
        </Popover>
      ) : null}
      {!submenu && items[active]?.preview ? <MenuPreview target={() => listRef.current?.querySelector<HTMLElement>(`[data-menu-index="${active}"]`) ?? null} index={active} preview={items[active].preview!} /> : null}
    </Popover>
  );
}

// The preview card of a highlighted item (전환): the dark tooltip bubble,
// 156 wide (padding 5 8), a 140×100 picture (r4) and the description 6 below it; 6 right of the
// item and centred on it, kept 4px inside the window (on the left when there is no room).
export function MenuPreview({ target, index, preview }: { target: () => HTMLElement | null; index: number; preview: { image?: ReactNode; text: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const item = target();
    const bubble = ref.current;
    if (!item || !bubble) return;
    const rect = item.getBoundingClientRect();
    const width = bubble.offsetWidth, height = bubble.offsetHeight;
    let left = rect.right + 6;
    if (left + width > window.innerWidth - 4) left = rect.left - 6 - width;
    const top = Math.max(4, Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - 4 - height));
    setPosition({ left, top });
  }, [index, preview.text]);
  return createPortal(
    <div ref={ref} className={`tooltip menu-preview${preview.image ? '' : ' text-only'}${position ? ' shown' : ''}`} role="tooltip" style={{ left: position?.left ?? -9999, top: position?.top ?? -9999 }}>
      {preview.image ? <div className="menu-preview-image">{preview.image}</div> : null}
      <div className="menu-preview-text">{preview.text}</div>
    </div>,
    document.body,
  );
}
