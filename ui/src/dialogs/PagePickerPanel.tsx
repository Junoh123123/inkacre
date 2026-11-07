import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { report, useWorkspace, workspace } from '../data/store';
import { recentIds } from '../data/router';
import { avatarLetter } from '../data/format';
import type { Entity, PageEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { EntityIcon } from '../page/EntityIcon';
import { isDatabasePage } from '../database/shared';

// The page picker that opens beside "페이지로 옮기기": 400×420, a search box
// (376×28 at 12,12, magnifier), "추천" (12/500 #7d7a75, padding 12 14 4) with the private pages
// and recently visited pages and databases as a tree — rows 28 high across the whole width
// (padding-left 14, ▸ 20×20 r4, icon 18, title 14/400 at 60), hover wash .05.
// Typing lists every matching page and database instead, under "페이지": rows 45 high, inset 4, r6,
// icon 18, the name 14/16.8 and under it the place 12 #a19e99 ("first / … / last"); the first is picked.
// "다른 페이지로 옮기기" uses the same picker, 330 wide, under its button (placeholder "페이지의 이동 위치…").

export type PickTarget = PageEntity | Entity | null;

// Pages and databases: a full-page database is offered once, as its page (no sub-tree); an inline
// database as its data source.
const destinations = (item: Entity) => item.kind === 'page'
  ? !(item as PageEntity).sourceId && !(item as PageEntity).template
  : item.kind === 'source' && !(workspace.get<PageEntity>(item.parentId ?? '') && isDatabasePage(workspace.get<PageEntity>(item.parentId ?? '')!));
const childrenOf = (id: string | null) => workspace.children(id).filter(child => destinations(child) && workspace.visible(child.id));
/** The data source new pages go into when the destination is a database (else null). */
export function destinationSource(target: Entity | null): string | null {
  if (!target) return null;
  if (target.kind === 'source') return target.id;
  if (target.kind === 'page' && isDatabasePage(target as PageEntity)) return workspace.children(target.id).filter(child => child.kind === 'source' && workspace.visible(child.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null;
  return null;
}
const nameOf = (item: Entity) => workspace.title(item) || (item.kind === 'page' ? t("새 페이지") : t("제목 없음"));
// Where a result lives: its pages and databases from the top, the middle ones folded into "...".
function placeOf(item: Entity): string[] {
  const names = workspace.ancestry(item.id).filter(entry => entry.id !== item.id && (entry.kind === 'page' || entry.kind === 'source')).map(nameOf);
  const unique = names.filter((name, index) => name !== names[index - 1]);
  return unique.length > 2 ? [unique[0], '...', unique[unique.length - 1]] : unique;
}

interface Row { key: string; item: Entity | null; depth: number; open: boolean; expandable: boolean }

export function PagePickerPanel({ placeholder, exclude, allowRoot = true, pagesOnly = false, onPick, close }: { placeholder: string; exclude: Set<string>; allowRoot?: boolean; pagesOnly?: boolean; onPick: (target: PickTarget) => Promise<void> | void; close: () => void }) {
  // Moving pages or blocks offers pages only (not databases).
  const fits = (item: Entity) => destinations(item) && (!pagesOnly || (item.kind === 'page' && !isDatabasePage(item as PageEntity)));
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); }, []);

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle) {
      return ws.snapshot.objects.filter(item => fits(item) && ws.visible(item.id) && !exclude.has(item.id) && nameOf(item).toLocaleLowerCase().includes(needle))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50)
        .map(item => ({ key: item.id, item, depth: 0, open: false, expandable: false }));
    }
    const result: Row[] = [];
    const add = (item: Entity | null, depth: number, scope: string) => {
      const key = `${scope}/${item?.id ?? 'root'}`;
      const kids = item === null ? childrenOf(null) : item.kind === 'page' && !destinationSource(item) ? childrenOf(item.id) : [];
      const visibleKids = kids.filter(child => !exclude.has(child.id) && fits(child));
      const open = expanded.has(key);
      result.push({ key, item, depth, open, expandable: visibleKids.length > 0 });
      if (open) for (const child of visibleKids) add(child, depth + 1, key);
    };
    // 개인 페이지 heads the list where a page can go to the top; where blocks are moved the list
    // shows only pages (recent ones, or the top-level pages when nothing was visited yet).
    if (allowRoot) add(null, 0, 'r');
    const recent = recentIds().map(id => ws.get(id)).filter((item): item is Entity => !!item && fits(item) && ws.visible(item.id) && !exclude.has(item.id)).slice(0, 8);
    const list = recent.length || allowRoot ? recent : childrenOf(null).filter(item => fits(item) && !exclude.has(item.id));
    for (const item of list) add(item, 0, 'r');
    return result;
  }, [ws.version, query, expanded, allowRoot, pagesOnly]);
  const searching = !!query.trim();

  useEffect(() => { setActive(query.trim() ? 0 : -1); }, [query]);
  useEffect(() => { listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const toggle = (key: string) => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const pick = async (row: Row) => {
    if (!row.item && !allowRoot) { toggle(row.key); return; }
    close(); try { await onPick(row.item); } catch (error) { report(error); }
  };

  return (
    <div className={`picker-panel${searching ? ' searching' : ''}`} role="dialog" aria-label={placeholder}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        const row = rows[active];
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!rows.length) return;
          setActive(current => current < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (row) pick(row);
        } else if (event.key === 'ArrowRight' && row?.expandable && !row.open && !query.trim()) {
          event.preventDefault(); toggle(row.key);
        } else if (event.key === 'ArrowLeft' && row?.open && !query.trim()) {
          event.preventDefault(); toggle(row.key);
        }
      }}>
      <div className="menu-search with-icon picker-panel-search">
        <Icon name="search" size={16} className="menu-search-icon" />
        <input ref={inputRef} className="menu-search-input" placeholder={placeholder} aria-label={placeholder} value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      <div className="picker-panel-list" ref={listRef} onPointerLeave={() => { if (!query.trim()) setActive(-1); }}>
        {rows.length ? <div className={`picker-panel-heading${searching ? ' results' : ''}`}>{searching ? t("picker|페이지") : t("추천")}</div> : null}
        {searching ? rows.map((row, index) => (
          <div key={row.key} role="menuitem" data-row={index} className={`picker-result-row${index === active ? ' active' : ''}`}
            onPointerMove={() => { if (index !== active) setActive(index); }} onClick={() => pick(row)}>
            <span className="picker-result-icon">{row.item ? <EntityIcon item={row.item} size={18} /> : null}</span>
            <span className="picker-result-main">
              <span className="picker-result-title">{row.item ? nameOf(row.item) : ''}</span>
              {row.item && placeOf(row.item).length ? <span className="picker-result-place">{placeOf(row.item).map((part, i) => <span key={i}>{i ? <span className="picker-result-sep">/</span> : null}{part}</span>)}</span> : null}
            </span>
          </div>
        )) : rows.map((row, index) => (
          <div key={row.key} role="menuitem" data-row={index} className={`picker-tree-row${index === active ? ' active' : ''}`} style={{ paddingLeft: 14 + row.depth * 20 }}
            onPointerMove={() => { if (index !== active) setActive(index); }} onClick={() => pick(row)}>
            {row.expandable ? (
              <button type="button" className="picker-tree-toggle" aria-label={row.open ? t("접기") : t("펼치기")} aria-expanded={row.open}
                onClick={event => { event.stopPropagation(); toggle(row.key); }}>
                <Icon name="chevron-right" size={12} className={row.open ? 'open' : undefined} />
              </button>
            ) : <span className="picker-tree-toggle placeholder" />}
            <span className="picker-tree-icon">{row.item ? <EntityIcon item={row.item} size={18} /> : <span className="avatar picker-tree-avatar">{avatarLetter(t("나"))}</span>}</span>
            <span className="picker-tree-title">{row.item ? nameOf(row.item) : t("picker|개인 페이지")}</span>
            {row.item ? null : <Icon name="lock" size={16} className="picker-tree-lock" />}
          </div>
        ))}
        {!rows.length ? <div className="menu-empty">{t("일치하는 페이지가 없습니다.")}</div> : null}
      </div>
    </div>
  );
}
