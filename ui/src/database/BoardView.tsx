import { t } from '../i18n';
import { useLocalPreference } from '../data/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apply, newId } from '../data/commands';
import { report, setStatus, workspace } from '../data/store';
import { useRoute } from '../data/router';
import { optionColor, plainText, statusGroupName, tagColors } from '../data/format';
import type { AttachmentEntity, BlockEntity, Operation, PageEntity, PropertyEntity, QueryGroup, QueryResult, QueryRow, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Tag } from '../ui/primitives';
import { EntityIcon } from '../page/EntityIcon';
import { ValueView, readOnlyTypes, saveValue, shownValue } from './values';
import { displayGroups, groupValue, newRow, openRow, rowIndex, shownProperties, updateView } from './shared';
import type { ViewProps } from './TableView';
import type { Anchor } from '../ui/overlay';
import { createDragGhost, edgeScroller, pastThreshold, useFadeList, type DragGhost } from '../ui/drag';
import { RowMenu } from './RowMenu';

// ---------- card (board and gallery) ----------

function coverOf(row: QueryRow, result: QueryResult, view: ViewEntity | null): string | null {
  const mode = view?.config.galleryPreview ?? (view?.viewType === 'gallery' ? 'page_cover' : 'none');
  if (mode === 'page_cover' && row.coverAttachmentId) return `/api/attachments/${encodeURIComponent(row.coverAttachmentId)}`;
  if (mode === 'files') {
    const propertyId = view?.config.previewPropertyId ?? result.properties.find(property => property.type === 'files')?.id;
    const files = propertyId ? row.values[propertyId] as string[] | undefined : undefined;
    const image = files?.find(id => workspace.get<AttachmentEntity>(id)?.mediaType.startsWith('image/'));
    if (image) return `/api/attachments/${encodeURIComponent(image)}`;
  }
  return null;
}

// 카드 미리보기 › 페이지 콘텐츠: the start of the page as it reads — headings, text, list items and its first picture.
function ContentPreview({ pageId }: { pageId: string }) {
  const blocks = (workspace.children(pageId).filter(child => child.kind === 'block') as BlockEntity[]).slice(0, 12);
  const picture = blocks.find(block => block.blockType === 'image' && block.attachmentId);
  return (
    <div className="card-content-preview" aria-hidden="true">
      {picture && blocks.indexOf(picture) === 0 ? <img src={`/api/attachments/${encodeURIComponent(picture.attachmentId!)}`} alt="" draggable={false} /> : blocks.map(block => {
        const text = plainText(block.richText);
        if (!text) return null;
        const marker = block.blockType === 'bullet' ? '• ' : block.blockType === 'todo' ? (block.checked ? '☑ ' : '☐ ') : block.blockType === 'numbered' ? '1. ' : '';
        return <div key={block.id} className={`card-content-line ${block.blockType}`}>{marker}{text}</div>;
      })}
    </div>
  );
}

export function RowCard({ row, result, view, properties, orderedIds, editing, onEdited, className, dragProps, galleryCover, selected, onSelect }: {
  row: QueryRow; result: QueryResult; view: ViewEntity | null; properties: PropertyEntity[]; orderedIds: string[]; editing?: boolean; onEdited?: () => void; className?: string;
  dragProps?: { onPointerDown: (event: React.PointerEvent) => void }; galleryCover?: boolean; selected?: boolean; onSelect?: (id: string) => void;
}) {
  const [title, setTitle] = useState<string | null>(editing ? row.title : null);
  const [menu, setMenu] = useState<{ anchor: Anchor; pointer: boolean } | null>(null);
  const [subOpen, setSubOpen] = useState(false);
  const route = useRoute();
  // Sub-items shown "inside the parent's card" (view setting 하위 항목 표시): a toggle with the children's titles.
  const cardChildren = result.presentation.subitems?.display === 'card' ? row.task?.children ?? [] : [];
  // A card shows the selection ring while it is selected or while its page is open in a peek.
  const ringed = selected || route.peek === row.id;
  const titleProperty = result.properties.find(property => property.type === 'title');
  const cover = coverOf(row, result, view);
  const commitTitle = () => {
    if (title !== null && title !== row.title && titleProperty) saveValue(row.id, titleProperty, title).catch(report);
    setTitle(null);
    onEdited?.();
  };
  const fields = properties.filter(property => property.type !== 'title').map(property => {
    const raw = row.values[property.id];
    const value = readOnlyTypes.has(property.type) ? raw : shownValue(row.id, property, raw).value;
    return { property, value };
  }).filter(({ property, value }) => property.type === 'checkbox' ? value === true : !(value == null || value === '' || (Array.isArray(value) && !value.length)));
  // Card settings: the page icon can be hidden; "모든 콘텐츠 줄바꿈" lets values wrap (on by default
  // on boards); the compact layout runs properties together, keeping the ones marked "전체 행" on lines of their own.
  const config = view?.config;
  const showIcon = config?.showPageIcon !== false;
  const wrap = config?.wrapProperties ?? view?.viewType !== 'gallery';
  const compact = config?.cardLayout === 'compact';
  const fullWidth = new Set(config?.fullWidthProperties ?? []);
  const field = ({ property, value }: (typeof fields)[number]) => <div key={property.id} className={`card-field type-${property.type}${wrap ? '' : ' nowrap'}`}><ValueView property={property} value={value} row={row} mode="card" wrap={wrap} asCheckbox={property.type === 'status' && !!config?.checkboxStatus?.includes(property.id)} /></div>;
  const fieldRows: Array<(typeof fields)> = [];
  for (const item of fields) {
    const last = fieldRows[fieldRows.length - 1];
    if (compact && !fullWidth.has(item.property.id) && last && !fullWidth.has(last[0].property.id)) last.push(item);
    else fieldRows.push([item]);
  }
  return (
    <div className={`row-card${className ? ` ${className}` : ''}${row.colors?.row ? ` cc-${row.colors.row}` : ''}${galleryCover ? ' gallery' : ''}${ringed ? ' selected' : ''}${compact ? ' compact' : ''}`} data-row-id={row.id}
      onContextMenu={event => { if ((event.target as HTMLElement).closest('textarea')) return; event.preventDefault(); onSelect?.(row.id); setMenu({ anchor: { x: event.clientX, y: event.clientY }, pointer: true }); }}
      onPointerDown={event => { if ((event.target as HTMLElement).closest('button, a, textarea, .card-actions')) return; dragProps?.onPointerDown(event); }}
      onClick={event => { if ((event.target as HTMLElement).closest('button, a, textarea, .card-actions') || title !== null) return; openRow(view, row.id, orderedIds, { side: event.altKey }); }}>
      {view?.config.galleryPreview === 'page_content' ? <div className={`card-cover content${galleryCover ? '' : ' small'}`}><ContentPreview pageId={row.id} /></div>
        : galleryCover ? <div className={`card-cover${view?.config.previewFit === 'contain' ? ' fit' : ''}`}>{cover ? <img src={cover} alt="" draggable={false} /> : null}</div>
        : cover ? <div className={`card-cover small${view?.config.previewFit === 'contain' ? ' fit' : ''}`}><img src={cover} alt="" draggable={false} /></div> : null}
      <div className="card-body">
        <div className={`card-title${view?.config.hideTitle && title === null ? ' hidden-title' : ''}`}>
          {showIcon && workspace.get<PageEntity>(row.id)?.icon ? <EntityIcon item={workspace.get(row.id)} size={18} /> : null}
          {title !== null ? (
            <textarea className="card-title-input" autoFocus rows={1} value={title} placeholder={t("제목 없음")} onChange={event => setTitle(event.target.value)} onBlur={commitTitle}
              onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); commitTitle(); } if (event.key === 'Escape') { event.preventDefault(); setTitle(null); onEdited?.(); } }} />
          ) : <span className="card-title-text">{row.title || <span className="title-placeholder">{t("제목 없음")}</span>}</span>}
        </div>
        {fieldRows.map(group => group.length > 1 || (compact && !fullWidth.has(group[0].property.id)) ? <div key={group[0].property.id} className="card-fields-inline">{group.map(field)}</div> : field(group[0]))}
        {cardChildren.length ? (
          <div className="card-subitems">
            <button type="button" className="card-subitems-toggle" aria-expanded={subOpen} onClick={() => setSubOpen(!subOpen)}>
              <Icon name="chevron-right" size={12} className={subOpen ? 'open' : ''} /><span>{t("하위 항목 {0}개", [cardChildren.length])}</span>
            </button>
            {subOpen ? cardChildren.map(child => (
              <button type="button" key={child.id} className="card-subitem" onClick={() => openRow(view, child.id, cardChildren.map(item => item.id))}>
                <EntityIcon item={workspace.get(child.id)} size={14} /><span>{child.title || t("제목 없음")}</span>
              </button>
            )) : null}
          </div>
        ) : null}
      </div>
      {title === null ? (
        <div className="card-actions">
          <button type="button" aria-label={t("이름 바꾸기")} title={t("이름 바꾸기")} onClick={() => setTitle(row.title)}><Icon name="pencil" size={16} /></button>
          <button type="button" aria-label={t("더 보기")} title={t("삭제, 복제 등")} onClick={event => setMenu({ anchor: event.currentTarget, pointer: false })}><Icon name="more" size={16} /></button>
        </div>
      ) : null}
      {menu ? <RowMenu anchor={menu.anchor} placement={menu.pointer ? 'pointer' : 'below-start'} rowId={row.id} view={view} orderedIds={orderedIds} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

// ---------- board ----------

export function GroupTitle({ property, group }: { property: PropertyEntity | undefined; group: QueryGroup; count?: number }) {
  if (group.statusGroup) {
    const label = group.statusGroup;
    const tone = label === statusGroupName('complete') ? 'green' : label === statusGroupName('in_progress') ? 'blue' : 'gray';
    return <span className={`board-group-title status-${tone}`}><Icon name={label === statusGroupName('complete') ? 'status-done' : label === statusGroupName('in_progress') ? 'status-progress' : 'status-todo'} size={20} /><span className="board-group-name">{label}</span></span>;
  }
  const empty = group.value == null || (Array.isArray(group.value) && !group.value.length);
  if (empty) return <span className="board-group-title"><span className="board-group-name muted">{property ? t("{0} 없음", [property.name]) : t("없음")}</span></span>;
  if (property && ['select', 'status', 'multi_select'].includes(property.type)) {
    const option = property.options?.find(item => item.id === group.value);
    const color = optionColor(property, option);
    return <span className="board-group-title"><Tag color={color} status={property.type === 'status'}>{option?.name ?? t("삭제된 옵션")}</Tag></span>;
  }
  if (property?.type === 'checkbox') return <span className="board-group-title"><span className="board-group-name">{group.value ? t("체크 표시됨") : t("체크 표시 안 됨")}</span></span>;
  if (property?.type === 'relation') return <span className="board-group-title"><span className="board-group-name">{workspace.get<PageEntity>(String(group.value))?.title || t("새 페이지")}</span></span>;
  return <span className="board-group-title"><span className="board-group-name">{String(group.value)}</span></span>;
}

export function BoardView({ result, view, sourceId }: ViewProps) {
  const property = result.properties.find(item => item.id === result.presentation.groupPropertyId);
  const groups = displayGroups(result, view?.config ?? {}, property);
  const index = useMemo(() => rowIndex(result), [result]);
  const properties = shownProperties(result);
  const [editing, setEditing] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: Element; group: QueryGroup } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropLine, setDropLine] = useState<{ key: string; left: number; top: number; width: number } | null>(null);
  const fadingLines = useFadeList(dropLine, line => line.key);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  // A selected card (after a drop or a right-click) stays ringed until the next click elsewhere or Esc.
  useEffect(() => {
    if (!selectedCard) return;
    const clear = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof PointerEvent && (event.target as Element | null)?.closest?.(`[data-row-id="${CSS.escape(selectedCard)}"], .overlay-layer`)) return;
      setSelectedCard(null);
    };
    window.addEventListener('pointerdown', clear, true);
    window.addEventListener('keydown', clear, true);
    return () => { window.removeEventListener('pointerdown', clear, true); window.removeEventListener('keydown', clear, true); };
  }, [selectedCard]);
  const [closedLanes, setClosedLanes] = useLocalPreference<string[]>(`pageyard-board-lanes:${view?.id ?? sourceId}`, []);
  const boardRef = useRef<HTMLDivElement>(null);
  const config = view?.config ?? {};
  const sorted = !!config.sorts?.length;
  // A status always has a value, so an empty "no status" column is not shown.
  const isEmptyGroup = (group: QueryGroup) => group.value == null || (Array.isArray(group.value) && !group.value.length);
  const visible = groups.filter(group => !group.hidden && !(property?.type === 'status' && isEmptyGroup(group) && !group.rowIds.length));
  const hidden = groups.filter(group => group.hidden);
  const ordered = visible.flatMap(group => group.rowIds);
  const statusTone = (group: QueryGroup) => {
    if (group.statusGroup) return group.statusGroup === statusGroupName('complete') ? 'green' : group.statusGroup === statusGroupName('in_progress') ? 'blue' : 'gray';
    if (!property || property.type !== 'status' && property.type !== 'select') return 'gray';
    const option = property.options?.find(item => item.id === group.value);
    return option ? optionColor(property, option) : 'gray';
  };

  // Sub-groups (swimlanes): the union of every column's sub-groups, in first-seen order.
  const subProperty = config.subgroupBy ? result.properties.find(item => item.id === config.subgroupBy) : undefined;
  const lanes = subProperty && groups.some(group => group.subgroups) ? (() => {
    const seen = new Map<string, QueryGroup>();
    for (const group of groups) for (const sub of group.subgroups ?? []) if (!seen.has(sub.key)) seen.set(sub.key, { ...sub, rowIds: [] });
    for (const group of groups) for (const sub of group.subgroups ?? []) seen.get(sub.key)!.rowIds.push(...sub.rowIds);
    // Option order like the columns; the empty sub-group goes last.
    const order = (lane: QueryGroup) => { if (lane.value == null) return Number.MAX_SAFE_INTEGER; const at = subProperty.options?.findIndex(option => option.id === lane.value) ?? -1; return at < 0 ? Number.MAX_SAFE_INTEGER - 1 : at; };
    return [...seen.values()].sort((a, b) => order(a) - order(b));
  })() : null;
  const laneOf = (row: QueryRow) => lanes?.find(lane => lane.rowIds.includes(row.id))?.key ?? null;

  if (!property) {
    return (
      <div className="board-empty">
        <p>{t("보드를 나눌 속성(상태·선택 등)이 필요합니다.")}</p>
        <button type="button" className="outline-button small" onClick={() => {
          const candidate = result.properties.find(item => ['status', 'select', 'multi_select', 'checkbox', 'person'].includes(item.type));
          if (candidate && view) updateView(view, { groupBy: candidate.id });
          else import('../dialogs/registry').then(module => module.openWorkspaceDialog('property', { sourceId, type: 'status' }));
        }}>{t("그룹 속성 설정")}</button>
      </div>
    );
  }

  const startDrag = (event: React.PointerEvent, row: QueryRow, from: QueryGroup) => {
    if (event.button !== 0) return;
    const card = (event.currentTarget as HTMLElement);
    const startX = event.clientX, startY = event.clientY;
    let active = false;
    let ghost: DragGhost | null = null;
    const fromLane = laneOf(row);
    let target: { group: string | null; before: string | null; lane: string | null } | null = null;
    // The card stays in place while a 40% copy follows the pointer; a
    // 4px line in the gap between cards shows where it will land (none where nothing would move).
    // Where the card would land for a pointer at (x, y); worked out again after every auto-scroll step.
    const locate = (pointerX: number, pointerY: number) => {
      const moveEvent = { clientX: pointerX, clientY: pointerY };
      const column = (document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-group-key]');
      if (column) {
        const all = [...column.querySelectorAll<HTMLElement>('.row-card')];
        const others = all.filter(element => element.dataset.rowId !== row.id);
        const index = others.findIndex(element => { const box = element.getBoundingClientRect(); return moveEvent.clientY < box.top + box.height / 2; });
        const at = index < 0 ? others.length : index;
        const next = index < 0 ? null : others[index];
        target = { group: column.dataset.groupKey ?? null, before: next?.dataset.rowId ?? null, lane: column.dataset.laneKey ?? null };
        const own = all.findIndex(element => element.dataset.rowId === row.id);
        // Nothing is shown over the card itself or just above the next card;
        // the line under the card before it still shows.
        const sourceBox = card.getBoundingClientRect();
        const unchanged = own >= 0 && own === at && moveEvent.clientY >= sourceBox.top;
        if (unchanged) setDropLine(null);
        else {
          const body = column.querySelector<HTMLElement>('.board-column-body') ?? column;
          const bodyBox = body.getBoundingClientRect();
          const reference = next ?? others.at(-1) ?? null;
          const box = reference?.getBoundingClientRect();
          const aboveSelf = own >= 0 && own === at;
          const top = aboveSelf ? sourceBox.top - 6 : next ? box!.top - 6 : box ? box.bottom + 2 : bodyBox.top + 2;
          setDropLine({ key: `${target.group}|${target.lane}|${target.before}`, left: box?.left ?? bodyBox.left, top, width: box?.width ?? bodyBox.width });
        }
      } else { target = null; setDropLine(null); }
    };
    // Held near an edge, the board scrolls sideways and the page up or down (the drop line follows).
    let last = { x: startX, y: startY };
    const relocate = () => { if (active) locate(last.x, last.y); };
    const autoX = edgeScroller(boardRef.current, relocate, 'x');
    const autoY = edgeScroller(card.closest<HTMLElement>('.frame-scroller, .peek-scroller'), relocate);
    const move = (moveEvent: PointerEvent) => {
      if (!active && !pastThreshold(moveEvent.clientX - startX, moveEvent.clientY - startY)) return;
      if (!active) {
        active = true;
        document.body.classList.add('dragging-cards');
        setDragId(row.id);
        ghost = createDragGhost([card], startX, startY, { copyClass: 'drag-source' });
      }
      last = { x: moveEvent.clientX, y: moveEvent.clientY };
      ghost?.move(moveEvent.clientX, moveEvent.clientY);
      locate(moveEvent.clientX, moveEvent.clientY);
      autoX.update(moveEvent.clientX, moveEvent.clientY);
      autoY.update(moveEvent.clientX, moveEvent.clientY);
    };
    const up = () => {
      autoX.stop(); autoY.stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-cards');
      ghost?.remove();
      setDragId(null);
      setDropLine(null);
      if (active) {
        // The click that ends a drag must not open the card.
        const swallow = (clickEvent: MouseEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
      if (!active || !target) return;
      // The dropped card is selected.
      setSelectedCard(row.id);
      const destination = groups.find(group => group.key === target!.group);
      if (!destination) return;
      const operations: Operation[] = [];
      if (destination.key !== from.key && !readOnlyTypes.has(property.type)) {
        let value = groupValue(property, destination);
        if (property.type === 'multi_select' || property.type === 'person') {
          const current = (row.values[property.id] as string[] | null) ?? [];
          value = [...current.filter(item => item !== from.value), ...(destination.value == null ? [] : [destination.value as string])].filter((item, i, list) => list.indexOf(item) === i);
        }
        operations.push(property.type === 'relation' ? { type: 'relation.set', pageId: row.id, propertyId: property.id, targetIds: (value as string[]) ?? [] } : { type: 'value.set', pageId: row.id, propertyId: property.id, value: value ?? null });
      }
      if (!sorted && target.before !== row.id) {
        const before = target.before;
        // Keep the card where it was dropped (rows are ordered by position when the view has no sort).
        operations.push({ type: 'node.move', id: row.id, parentId: sourceId, ...(before ? { beforeId: before } : (() => {
          const ids = destination.rowIds.filter(id => id !== row.id);
          const last = ids[ids.length - 1];
          if (!last) return {};
          const siblings = workspace.children(sourceId).filter(item => item.kind === 'page' && !(item as PageEntity).template).map(item => item.id);
          const after = siblings[siblings.indexOf(last) + 1];
          return after && after !== row.id ? { beforeId: after } : {};
        })()) });
      }
      const toLane = target.lane;
      if (subProperty && lanes && toLane !== fromLane && !readOnlyTypes.has(subProperty.type)) {
        const lane = lanes.find(item => item.key === toLane);
        if (lane) {
          let value = groupValue(subProperty, lane);
          if (subProperty.type === 'multi_select' || subProperty.type === 'person') {
            const fromValue = lanes.find(item => item.key === fromLane)?.value;
            const current = (row.values[subProperty.id] as string[] | null) ?? [];
            value = [...current.filter(item => item !== fromValue), ...(lane.value == null ? [] : [lane.value as string])].filter((item, i, list) => list.indexOf(item) === i);
          }
          operations.push(subProperty.type === 'relation' ? { type: 'relation.set', pageId: row.id, propertyId: subProperty.id, targetIds: (value as string[]) ?? [] } : { type: 'value.set', pageId: row.id, propertyId: subProperty.id, value: value ?? null });
        }
      }
      if (operations.length) apply(operations).catch(report);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const groupEntries = (group: QueryGroup): MenuEntry[] => {
    const option = group.statusGroup ? undefined : property.options?.find(item => item.id === group.value);
    return [
      { label: t("그룹 숨기기"), icon: 'eye-off', onSelect: () => updateView(view, { hiddenGroups: [...(config.hiddenGroups ?? []), group.key] }) },
      ...(option && ['select', 'status', 'multi_select'].includes(property.type) ? [
        { kind: 'separator' } as MenuEntry,
        { kind: 'section', label: t("색") } as MenuEntry,
        ...tagColors.map(color => ({ label: color === 'default' ? t("기본") : color, icon: <span className={`swatch swatch-bg-${color === 'default' ? 'gray' : color}`} />, checked: optionColor(property, option) === color, onSelect: () => apply([{ type: 'property.update', id: property.id, options: (property.options ?? []).map(item => item.id === option.id ? { ...item, color } : item) }]).catch(report) } as MenuEntry)),
        { kind: 'separator' } as MenuEntry,
        { label: t("옵션 삭제"), icon: 'trash', danger: true, onSelect: () => apply([{ type: 'property.update', id: property.id, options: (property.options ?? []).filter(item => item.id !== option.id) }]).catch(report) } as MenuEntry,
      ] : []),
    ];
  };

  const addRow = async (group: QueryGroup, lane?: QueryGroup) => {
    const values: Record<string, unknown> = readOnlyTypes.has(property.type) ? {} : { [property.id]: groupValue(property, group) };
    if (lane && subProperty && !readOnlyTypes.has(subProperty.type)) values[subProperty.id] = groupValue(subProperty, lane);
    const id = await newRow(result, sourceId, { values, open: false });
    setEditing(id);
  };

  const head = (group: QueryGroup, rows: QueryRow[]) => (
    <div className="board-column-head">
      <GroupTitle property={property} group={group} count={rows.length} />
      <span className="board-column-actions">
        <button type="button" className="icon-button tiny" aria-label={t("그룹 옵션")} onClick={event => setMenu({ anchor: event.currentTarget, group })}><Icon name="more" size={16} /></button>
        <button type="button" className="icon-button tiny" aria-label={t("새 페이지")} onClick={() => addRow(group).catch(report)}><Icon name="plus" size={16} /></button>
      </span>
    </div>
  );
  const body = (group: QueryGroup, rows: QueryRow[], lane?: QueryGroup) => (
    <div className="board-column-body">
      {rows.map(row => (
        <div key={row.id} className="board-card-slot">
          <RowCard row={row} result={result} view={view} properties={properties} orderedIds={ordered} editing={editing === row.id} onEdited={() => setEditing(null)}
            className={dragId === row.id ? 'drag-source' : undefined} dragProps={{ onPointerDown: event => startDrag(event, row, group) }}
            selected={selectedCard === row.id} onSelect={setSelectedCard} />
        </div>
      ))}
      <button type="button" className="board-new" onClick={() => addRow(group, lane).catch(report)}><Icon name="plus" size={16} /><span>{t("새 페이지")}</span></button>
    </div>
  );
  const rowsOf = (ids: string[]) => ids.map(id => index.get(id)).filter((row): row is QueryRow => !!row);

  if (lanes && subProperty) {
    return (
      <div className={`board-view subgrouped${config.columnBackground === false ? ' no-tint' : ''} card-${config.cardSize ?? 'medium'}`} ref={boardRef}>
        <div className="board-head-row">
          {visible.map(group => <div key={group.key} className={`board-column board-head-cell tone-${statusTone(group)}`}>{head(group, rowsOf(group.rowIds))}</div>)}
        </div>
        {lanes.map(lane => {
          const open = !closedLanes.includes(lane.key);
          return (
            <section key={lane.key} className="board-lane">
              <button type="button" className="board-lane-head" aria-expanded={open} onClick={() => setClosedLanes(current => (current.includes(lane.key) ? current.filter(key => key !== lane.key) : [...current, lane.key]))}>
                <Icon name="chevron-right" size={12} className={open ? 'rotated' : ''} />
                <GroupTitle property={subProperty} group={lane} />
                <span className="board-lane-count">{lane.rowIds.length}</span>
              </button>
              {open ? (
                <div className="board-columns lane">
                  {visible.map(group => {
                    const cell = group.subgroups?.find(sub => sub.key === lane.key);
                    const rows = rowsOf(cell?.rowIds ?? []);
                    return (
                      <div key={group.key} className={`board-column lane-cell tone-${statusTone(group)}`} data-group-key={group.key} data-lane-key={lane.key}>
                        {body(group, rows, lane)}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
        {fadingLines.map(entry => <div key={entry.id} className={`card-drop-line drop-fade${entry.leaving ? ' leaving' : ''}`} style={{ left: entry.item.left, top: entry.item.top, width: entry.item.width }} />)}
        {menu ? <Menu anchor={menu.anchor} width={240} entries={groupEntries(menu.group)} onClose={() => setMenu(null)} /> : null}
      </div>
    );
  }

  return (
    <div className={`board-view${config.columnBackground === false ? ' no-tint' : ''} card-${config.cardSize ?? 'medium'}`} ref={boardRef}>
      <div className="board-columns">
        {visible.map(group => {
          const rows = rowsOf(group.rowIds);
          return (
            <div key={group.key} className={`board-column tone-${statusTone(group)}`} data-group-key={group.key}>
              {head(group, rows)}
              {body(group, rows)}
            </div>
          );
        })}
        {/* A status board grouped by its To-do · In progress · Complete groups has no "+ 그룹 추가". */}
        {property && ['select', 'status', 'multi_select'].includes(property.type) && !(property.type === 'status' && groups.some(group => group.statusGroup)) ? (
          <div className="board-add-group">
            {newGroup !== null ? (
              <input className="text-input board-add-group-input" autoFocus placeholder={t("그룹 이름")} value={newGroup} onChange={event => setNewGroup(event.target.value)}
                onBlur={() => setNewGroup(null)}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === 'Escape') { event.preventDefault(); setNewGroup(null); }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const name = newGroup.trim();
                    setNewGroup(null);
                    if (name) apply([{ type: 'property.update', id: property.id, options: [...(property.options ?? []), { id: newId(), name, ...(property.type === 'status' ? { group: 'todo' } : {}), color: tagColors[1 + ((property.options?.length ?? 0) % 9)] }] }]).catch(report);
                  }
                }} />
            ) : <button type="button" className="board-add-group-button" onClick={() => setNewGroup('')}><Icon name="plus" size={16} />{t("그룹 추가")}</button>}
          </div>
        ) : null}
        {hidden.length ? (
          <div className="board-hidden">
            <div className="board-hidden-title">{t("숨겨진 그룹")}</div>
            {hidden.map(group => (
              <button type="button" key={group.key} className="board-hidden-row" onClick={() => updateView(view, { hiddenGroups: (config.hiddenGroups ?? []).filter(key => key !== group.key) })}>
                <GroupTitle property={property} group={group} count={group.rowIds.length} /><Icon name="eye" size={14} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {fadingLines.map(entry => <div key={entry.id} className={`card-drop-line drop-fade${entry.leaving ? ' leaving' : ''}`} style={{ left: entry.item.left, top: entry.item.top, width: entry.item.width }} />)}
      {menu ? <Menu anchor={menu.anchor} width={240} entries={groupEntries(menu.group)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
