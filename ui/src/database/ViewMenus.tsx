import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { ViewEntity, ViewType } from '../data/types';
import { Icon, viewIcon } from '../ui/Icon';
import { Popover } from '../ui/overlay';
import { viewTypeLabels } from './shared';

// "+" next to the view tabs: 390 wide, r10. "새 보기 추가" 12/500 #7d7a75 at (16,14);
// 92×62 tiles (r8) four to a row from x 8 at 94-px steps, rows at y 38/101/164; a 22px icon centred at
// the top and the 14px #494846 name under it; the first tile is highlighted for the keyboard.
export const addViewOrder: ViewType[] = ['table', 'board', 'gallery', 'list', 'chart', 'dashboard', 'timeline', 'feed', 'map', 'calendar', 'form'];

// From "+ 새 보기" at the bottom of the views list the same grid opens to the left
// of that row, touching it and centred on it, while the list stays open.
export function AddViewMenu({ anchor, onPick, onClose }: { anchor: Element; onPick: (type: ViewType) => void; onClose: () => void }) {
  const beside = anchor.classList.contains('views-menu-new');
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[event.key];
      if (step) { event.preventDefault(); setActive(index => Math.min(addViewOrder.length - 1, Math.max(0, index + step))); }
      else if (event.key === 'Enter') { event.preventDefault(); onPick(addViewOrder[active]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  return (
    <Popover anchor={anchor} placement={beside ? 'left-center' : 'below-start'} offset={beside ? 0 : 4} onClose={onClose} className="add-view-menu" label={t("새 보기 추가")} style={{ width: 390 }}>
      <div ref={panel}>
        <div className="add-view-head">{t("새 보기 추가")}</div>
        <div className="add-view-grid" role="menu">
          {addViewOrder.map((type, index) => (
            <button type="button" key={type} role="menuitem" className={`add-view-tile${index === active ? ' active' : ''}`} onPointerMove={() => setActive(index)} onClick={() => onPick(type)}>
              <Icon name={viewIcon[type] ?? 'table'} size={22} /><span>{viewTypeLabels[type]}</span>
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

// "N개 더": 290 wide. A search field (258×28, r6, focused) at (16,16), then every
// view in a 28-high row (drag handle at 14, the view icon at 40, the name at 68, "⋯" 24 wide at the
// right), a line, and "+ 새 보기".
export function ViewsOverflowMenu({ anchor, views, activeId, onSelect, onMore, onReorder, onNew, onNewSource, onClose, canAdd }: {
  anchor: Element; views: ViewEntity[]; activeId?: string; onSelect: (id: string) => void; onMore: (view: ViewEntity, anchor: Element) => void;
  onReorder: (id: string, ids: string[]) => void; onNew: (row: Element) => void; onNewSource?: () => void; onClose: () => void; canAdd: boolean;
}) {
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const shown = views.filter(view => !needle || view.name.toLocaleLowerCase().includes(needle));
  const startDrag = (event: React.PointerEvent, id: string) => {
    if (event.button !== 0 || needle) return;
    event.preventDefault(); event.stopPropagation();
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('.views-menu-row') ?? [])];
    let over = views.findIndex(view => view.id === id);
    setDrag({ id, over });
    const move = (moveEvent: PointerEvent) => {
      const index = rows.findIndex(row => moveEvent.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
      over = index < 0 ? rows.length : index;
      setDrag({ id, over });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDrag(null);
      const ids = views.map(view => view.id), from = ids.indexOf(id), to = over > from ? over - 1 : over;
      if (from < 0 || to === from) return;
      ids.splice(from, 1); ids.splice(to, 0, id);
      onReorder(id, ids);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <Popover anchor={anchor} placement="below-start" offset={4} onClose={onClose} className="views-menu" label={t("보기")} style={{ width: 290 }}>
      <div className="views-menu-search"><input autoFocus value={query} placeholder={t("보기 검색…")} aria-label={t("보기 검색")} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter' && shown[0]) { onSelect(shown[0].id); onClose(); } }} /></div>
      <div className="views-menu-scroll">
      <div className="views-menu-list" ref={list}>
        {shown.map((view, index) => (
          <div key={view.id} role="menuitem" tabIndex={-1} className={`views-menu-row${view.id === activeId ? ' current' : ''}${drag?.id === view.id ? ' dragging' : ''}${drag && drag.over === index ? ' drop-before' : ''}${drag && index === shown.length - 1 && drag.over === shown.length ? ' drop-after' : ''}`}
            onClick={() => { onSelect(view.id); onClose(); }}>
            <span className="views-menu-handle" aria-label={t("보기 순서 바꾸기")} onPointerDown={event => startDrag(event, view.id)} onClick={event => event.stopPropagation()}><Icon name="drag" size={16} /></span>
            <Icon name={viewIcon[view.viewType] ?? 'table'} size={20} className="views-menu-icon" />
            <span className="views-menu-name">{view.name}</span>
            <button type="button" className="views-menu-more" aria-label={t("{0} 메뉴", [view.name])} onClick={event => { event.stopPropagation(); onMore(view, event.currentTarget); }}><Icon name="more" size={16} /></button>
          </div>
        ))}
        {!shown.length ? <div className="views-menu-empty">{t("결과 없음")}</div> : null}
      </div>
      {canAdd ? (
        <>
          <div className="views-menu-sep" />
          <button type="button" className="views-menu-row views-menu-new" onClick={event => onNew(event.currentTarget)}><Icon name="plus" size={20} className="views-menu-icon" /><span className="views-menu-name">{t("새 보기")}</span></button>
          {onNewSource ? <button type="button" className="views-menu-row views-menu-new" onClick={() => { onClose(); onNewSource(); }}><Icon name="database" size={20} className="views-menu-icon" /><span className="views-menu-name">{t("새 데이터 소스")}</span></button> : null}
        </>
      ) : null}
      </div>
    </Popover>
  );
}
