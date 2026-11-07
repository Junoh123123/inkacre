import { t } from '../i18n';
import { createDragGhost, edgeScroller, pastThreshold, useFadeList, type DragGhost } from '../ui/drag';
import { pressClosedMenu } from '../ui/overlay';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clipboardRows, pastedValue } from '../../../web/table-grid.mjs';
import { apply, newId } from '../data/commands';
import { report, setStatus, workspace } from '../data/store';
import { useLocalPreference } from '../data/hooks';
import { aggregateLabels, formatAggregate, formatValue, optionColor, propertyLabels, statusGroupName, statusToggleValue } from '../data/format';
import type { Operation, PageEntity, PropertyEntity, QueryGroup, QueryResult, QueryRow, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { RowMenu } from './RowMenu';
import type { Anchor, Placement } from '../ui/overlay';
import { discardEmptyRow } from '../page/actions';
import { Tag } from '../ui/primitives';
import { EntityIcon } from '../page/EntityIcon';
import { ValueEditor, ValueView, readOnlyTypes, saveValue, shownValue } from './values';
import { NewPropertyMenu, PropertyHeaderMenu, aggregationsFor } from './PropertyMenus';
import { displayGroups, groupValue, newRow, openRow, rowIndex, shownProperties, updateView, useDatabaseLock } from './shared';
import { runButton } from '../dialogs/buttons';
import { PropertyComments } from '../page/PropertyComments';
import type { CommentEntity } from '../data/types';

export interface ViewProps {
  result: QueryResult;
  view: ViewEntity | null;
  sourceId: string;
  inline: boolean;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onFilterProperty?: (propertyId: string) => void;
  /** Shown instead of the "새 페이지" row when a filter leaves nothing ("필터 편집" and
   *  "+ 새 페이지" as outlined buttons in the middle of a 144-high band). */
  emptyState?: ReactNode;
}

const defaultWidth = (property: PropertyEntity) => property.type === 'title' ? 280 : property.type === 'checkbox' ? 120 : 200;
const textTypes = new Set(['title', 'text', 'number', 'url', 'email', 'phone']);

interface Cell { row: number; col: number }
interface Line { kind: 'row'; row: QueryRow; depth: number; group?: QueryGroup }
type Entry = Line | { kind: 'group'; group: QueryGroup; count: number } | { kind: 'new'; group?: QueryGroup; parentTaskId?: string; depth: number };

export function GroupLabel({ property, group }: { property: PropertyEntity | undefined; group: QueryGroup }) {
  if (group.statusGroup) {
    const tone = group.statusGroup === statusGroupName('complete') ? 'green' : group.statusGroup === statusGroupName('in_progress') ? 'blue' : 'gray';
    return <span className={`board-group-title status-${tone}`}><Icon name={group.statusGroup === statusGroupName('complete') ? 'status-done' : group.statusGroup === statusGroupName('in_progress') ? 'status-progress' : 'status-todo'} size={16} /><span className="board-group-name">{group.statusGroup}</span></span>;
  }
  if (group.value == null || (Array.isArray(group.value) && !group.value.length)) return <span className="group-empty">{property ? t("{0} 없음", [property.name]) : t("없음")}</span>;
  if (property && ['select', 'status', 'multi_select'].includes(property.type)) {
    const option = property.options?.find(item => item.id === group.value);
    return <Tag color={optionColor(property, option)} status={property.type === 'status'}>{option?.name ?? t("삭제된 옵션")}</Tag>;
  }
  if (property?.type === 'checkbox') return <span>{group.value ? t("체크 표시됨") : t("체크 표시 안 됨")}</span>;
  return <span>{formatValue(group.value, property) || t("없음")}</span>;
}

export function TableView({ result, view, sourceId, inline, selected, onSelect, onFilterProperty, emptyState }: ViewProps) {
  const columns = shownProperties(result);
  const { locked } = useDatabaseLock(sourceId);
  const key = view?.id ?? sourceId;
  const [widths, setWidths] = useLocalPreference<Record<string, number>>(`pageyard-colwidth:${key}`, {});
  const [wrapped, setWrapped] = useLocalPreference<string[]>(`pageyard-colwrap:${key}`, []);
  const [collapsed, setCollapsed] = useLocalPreference<string[]>(`pageyard-group-collapsed:${key}`, []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cell, setCell] = useState<{ anchor: Cell; focus: Cell } | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; propertyId: string; element: HTMLElement; text?: string } | null>(null);
  const [header, setHeader] = useState<{ anchor: Element; property: PropertyEntity } | null>(null);
  const [addColumn, setAddColumn] = useState<Element | null>(null);
  const [calc, setCalc] = useState<{ anchor: Element; property: PropertyEntity } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ anchor: Element; group: QueryGroup } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ anchor: Anchor; id: string; placement?: Placement; cell?: { element: Element; property: PropertyEntity } } | null>(null);
  // 속성 값 댓글 from a cell: 💬 on hover (and always, with the count, while a comment is open there).
  const [cellComments, setCellComments] = useState<{ anchor: Element; rowId: string; property: PropertyEntity } | null>(null);
  const openComments = new Map<string, number>();
  for (const item of workspace.snapshot.objects as unknown as CommentEntity[]) if (item.kind === 'comment' && item.propertyId && item.alive !== false && !item.resolved && !item.threadId) openComments.set(`${item.parentId}:${item.propertyId}`, (openComments.get(`${item.parentId}:${item.propertyId}`) ?? 0) + 1);
  const freshRow = useRef<string | null>(null);
  // "+" left of a row: a new row right below it (above with Option), its title being edited at once.
  const addRowNear = async (row: QueryRow, group: QueryGroup | undefined, above: boolean) => {
    const values = group && groupProperty && !readOnlyTypes.has(groupProperty.type) ? { [groupProperty.id]: groupValue(groupProperty, group) } : {};
    const siblings = workspace.children(sourceId).filter(item => item.kind === 'page' && !(item as PageEntity).template).map(item => item.id);
    const before = sorted ? undefined : above ? row.id : siblings[siblings.indexOf(row.id) + 1];
    const id = await newRow(result, sourceId, { values, open: false, beforeId: before });
    freshRow.current = id;
    setTimeout(() => {
      const element = gridRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"] [data-col="0"]`);
      if (element) { const [r, c] = element.dataset.cell!.split(':').map(Number); setCell({ anchor: { row: r, col: c }, focus: { row: r, col: c } }); setEditing({ rowId: id, propertyId: columns[0].id, element }); }
    }, 150);
  };
  const [dragColumn, setDragColumn] = useState<{ id: string; over: string | null; side: 'left' | 'right' } | null>(null);
  const [dragRow, setDragRow] = useState<{ id: string; over: string | null; after: boolean } | null>(null);
  const [rowLine, setRowLine] = useState<{ key: string; left: number; width: number; top: number } | null>(null);
  const fadingRowLines = useFadeList(rowLine, line => line.key);
  const gridRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const justDragged = useRef(false);
  const config = view?.config ?? {};
  const frozen = new Set(config.frozenProperties ?? []);
  const groupProperty = result.presentation.groupPropertyId ? result.properties.find(property => property.id === result.presentation.groupPropertyId) : undefined;
  const nested = result.presentation.subitems?.display === 'nested';
  const sorted = !!config.sorts?.length;
  const index = useMemo(() => rowIndex(result), [result]);

  // Flattened lines (groups, rows, nested sub-items, "new" rows).
  const entries = useMemo(() => {
    const out: Entry[] = [];
    const pushRows = (rows: QueryRow[], depth: number, group?: QueryGroup) => {
      for (const row of rows) {
        out.push({ kind: 'row', row, depth, group });
        if (nested && row.children?.length && expanded.has(row.id)) pushRows(row.children, depth + 1, group);
      }
    };
    if (result.presentation.groups) {
      for (const group of displayGroups(result, config, groupProperty)) {
        if (group.hidden) continue;
        const rows = group.rowIds.map(id => index.get(id)).filter((row): row is QueryRow => !!row);
        out.push({ kind: 'group', group, count: rows.length });
        if (collapsed.includes(group.key)) continue;
        pushRows(rows, 0, group);
        out.push({ kind: 'new', group, depth: 0 });
      }
    } else {
      pushRows(result.rows, 0);
      if (result.rows.length || !emptyState) out.push({ kind: 'new', depth: 0 });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, expanded, collapsed, nested, index, config.statusGrouping, config.hideEmptyGroups, config.groupSort, !!emptyState]);
  const lines = entries.filter((entry): entry is Line => entry.kind === 'row');
  const rowIds = lines.map(line => line.row.id);

  const widthOf = (property: PropertyEntity) => widths[property.id] ?? defaultWidth(property);
  let left = 0;
  const stickyLeft = new Map<string, number>();
  for (const property of columns) { if (frozen.has(property.id)) stickyLeft.set(property.id, left); left += widthOf(property); }
  const totalWidth = columns.reduce((sum, property) => sum + widthOf(property), 0);

  const inRange = (row: number, col: number) => {
    if (!cell) return false;
    const r1 = Math.min(cell.anchor.row, cell.focus.row), r2 = Math.max(cell.anchor.row, cell.focus.row);
    const c1 = Math.min(cell.anchor.col, cell.focus.col), c2 = Math.max(cell.anchor.col, cell.focus.col);
    return row >= r1 && row <= r2 && col >= c1 && col <= c2;
  };

  const cellElement = (row: number, col: number) => gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`) ?? null;

  const startEdit = (rowIndexValue: number, col: number, text?: string) => {
    const line = lines[rowIndexValue];
    const property = columns[col];
    const element = cellElement(rowIndexValue, col);
    if (!line || !property || !element) return;
    if (property.type === 'checkbox') { const { value } = shownValue(line.row.id, property, line.row.values[property.id]); saveValue(line.row.id, property, value !== true).catch(report); return; }
    if (property.type === 'status' && config.checkboxStatus?.includes(property.id)) { const { value } = shownValue(line.row.id, property, line.row.values[property.id]); const next = statusToggleValue(property, value); if (next) saveValue(line.row.id, property, next).catch(report); return; }
    if (property.type === 'button') { const live = workspace.get<PropertyEntity>(property.id); if (live) runButton(live, line.row.id).catch(report); return; }
    if (readOnlyTypes.has(property.type)) return;
    setEditing({ rowId: line.row.id, propertyId: property.id, element, text });
  };

  const clearRange = () => {
    if (!cell) return;
    const operations: Operation[] = [];
    for (let r = Math.min(cell.anchor.row, cell.focus.row); r <= Math.max(cell.anchor.row, cell.focus.row); r++) {
      for (let c = Math.min(cell.anchor.col, cell.focus.col); c <= Math.max(cell.anchor.col, cell.focus.col); c++) {
        const property = columns[c], row = lines[r]?.row;
        if (!property || !row || readOnlyTypes.has(property.type) || property.type === 'button') continue;
        if (property.type === 'relation') operations.push({ type: 'relation.set', pageId: row.id, propertyId: property.id, targetIds: [] });
        else operations.push({ type: 'value.set', pageId: row.id, propertyId: property.id, value: property.type === 'title' ? '' : property.type === 'checkbox' ? false : null });
      }
    }
    if (operations.length) apply(operations).catch(report);
  };

  // ⌘D / ⌘R (fill down / fill right): the range's top row (or left column) copied into the rest of it; a single
  // cell takes the value of the cell above (or to the left).
  const fillRange = (direction: 'down' | 'right') => {
    if (!cell) return;
    let top = Math.min(cell.anchor.row, cell.focus.row), bottom = Math.max(cell.anchor.row, cell.focus.row);
    let left = Math.min(cell.anchor.col, cell.focus.col), right = Math.max(cell.anchor.col, cell.focus.col);
    if (direction === 'down' && top === bottom) { if (top === 0) return; top -= 1; }
    if (direction === 'right' && left === right) { if (left === 0) return; left -= 1; }
    const valueOf = (rowIndexValue: number, property: PropertyEntity) => {
      const row = lines[rowIndexValue]?.row;
      if (!row) return undefined;
      if (property.type === 'title') return row.title;
      return (row as QueryRow & { rich?: Record<string, unknown> }).rich?.[property.id] ?? row.values[property.id];
    };
    const operations: Operation[] = [];
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        if ((direction === 'down' && r === top) || (direction === 'right' && c === left)) continue;
        const property = columns[c], row = lines[r]?.row;
        if (!property || !row || readOnlyTypes.has(property.type) || property.type === 'button') continue;
        const from = direction === 'down' ? valueOf(top, property) : columns[left]?.id === property.id ? valueOf(r, property) : (columns[left]?.type === property.type ? valueOf(r, columns[left]) : undefined);
        if (from === undefined) continue;
        if (property.type === 'relation') operations.push({ type: 'relation.set', pageId: row.id, propertyId: property.id, targetIds: (from as string[] | null) ?? [] });
        else operations.push({ type: 'value.set', pageId: row.id, propertyId: property.id, value: from ?? (property.type === 'checkbox' ? false : null) } as Operation);
      }
    }
    if (operations.length) apply(operations).then(() => setStatus(t("{0}개 셀을 채웠습니다.", [operations.length]))).catch(report);
  };

  const copyRange = (event: ClipboardEvent) => {
    if (!cell || editing) return;
    const lines2: string[] = [];
    for (let r = Math.min(cell.anchor.row, cell.focus.row); r <= Math.max(cell.anchor.row, cell.focus.row); r++) {
      const values: string[] = [];
      for (let c = Math.min(cell.anchor.col, cell.focus.col); c <= Math.max(cell.anchor.col, cell.focus.col); c++) {
        const property = columns[c], row = lines[r]?.row;
        const text = property && row ? (property.type === 'title' ? row.title : property.type === 'checkbox' ? String(row.values[property.id] === true) : formatValue(row.values[property.id], property)) : '';
        values.push(/[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
      }
      lines2.push(values.join('\t'));
    }
    event.preventDefault();
    event.clipboardData?.setData('text/plain', lines2.join('\n'));
  };

  const pasteRange = (event: ClipboardEvent) => {
    if (!cell || editing) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    event.preventDefault();
    try {
      const grid = clipboardRows(text.replace(/\n$/, '')) as string[][];
      const startRow = Math.min(cell.anchor.row, cell.focus.row), startCol = Math.min(cell.anchor.col, cell.focus.col);
      const singleValue = grid.length === 1 && grid[0].length === 1;
      const rowsSpan = singleValue ? Math.abs(cell.anchor.row - cell.focus.row) + 1 : grid.length;
      const colsSpan = singleValue ? Math.abs(cell.anchor.col - cell.focus.col) + 1 : grid[0].length;
      const operations: Operation[] = [];
      for (let r = 0; r < rowsSpan; r++) {
        const row = lines[startRow + r]?.row;
        if (!row) break;
        for (let c = 0; c < colsSpan; c++) {
          const property = columns[startCol + c];
          if (!property || readOnlyTypes.has(property.type) || ['button', 'files', 'place'].includes(property.type)) continue;
          const raw = singleValue ? grid[0][0] : grid[r][c] ?? '';
          const value = pastedValue(raw, property, workspace.objects);
          operations.push(property.type === 'relation' ? { type: 'relation.set', pageId: row.id, propertyId: property.id, targetIds: value ?? [] } : { type: 'value.set', pageId: row.id, propertyId: property.id, value });
        }
      }
      if (operations.length) apply(operations).then(() => setStatus(t("{0}개 셀에 붙여넣었습니다.", [operations.length]))).catch(report);
    } catch (error) { report(error); }
  };

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onCopy = (event: ClipboardEvent) => copyRange(event);
    const onPaste = (event: ClipboardEvent) => pasteRange(event);
    grid.addEventListener('copy', onCopy);
    grid.addEventListener('paste', onPaste);
    return () => { grid.removeEventListener('copy', onCopy); grid.removeEventListener('paste', onPaste); };
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing || !cell || event.nativeEvent.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    const move = (dr: number, dc: number) => {
      event.preventDefault();
      const focus = { row: Math.max(0, Math.min(lines.length - 1, cell.focus.row + dr)), col: Math.max(0, Math.min(columns.length - 1, cell.focus.col + dc)) };
      setCell(event.shiftKey ? { anchor: cell.anchor, focus } : { anchor: focus, focus });
      cellElement(focus.row, focus.col)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    if (event.key === 'ArrowUp') move(-1, 0);
    else if (event.key === 'ArrowDown') move(1, 0);
    else if (event.key === 'ArrowLeft') move(0, -1);
    else if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) move(0, 1);
    else if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); move(0, -1); }
    else if (event.key === 'Enter') { event.preventDefault(); if (mod && lines[cell.focus.row]) openRow(view, lines[cell.focus.row].row.id, rowIds); else startEdit(cell.focus.row, cell.focus.col); }
    else if (event.key === 'Escape') { event.preventDefault(); setCell(null); }
    else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); clearRange(); }
    else if (mod && !event.shiftKey && !event.altKey && (event.key.toLowerCase() === 'd' || event.key.toLowerCase() === 'r')) { event.preventDefault(); fillRange(event.key.toLowerCase() === 'd' ? 'down' : 'right'); }
    else if (event.key === ' ' && columns[cell.focus.col]?.type === 'checkbox') { event.preventDefault(); startEdit(cell.focus.row, cell.focus.col); }
    else if (event.key.length === 1 && !mod && textTypes.has(columns[cell.focus.col]?.type)) { event.preventDefault(); startEdit(cell.focus.row, cell.focus.col, event.key); }
    // An input method (Korean, Japanese…) starting on a selected cell: open the editor right away
    // without cancelling the key, so the composition lands in the editor's field.
    else if ((event.key === 'Process' || event.nativeEvent.keyCode === 229) && textTypes.has(columns[cell.focus.col]?.type)) startEdit(cell.focus.row, cell.focus.col);
  };

  const onCellPointerDown = (event: React.PointerEvent, row: number, col: number) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, a, .row-open')) return;
    if (event.shiftKey && cell) { event.preventDefault(); setCell({ anchor: cell.anchor, focus: { row, col } }); gridRef.current?.focus({ preventScroll: true }); return; }
    const start = { row, col };
    let dragged = false;
    const moveHandler = (moveEvent: PointerEvent) => {
      const target = (document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-cell]');
      if (!target) return;
      const [r, c] = target.dataset.cell!.split(':').map(Number);
      if (r !== start.row || c !== start.col) { dragged = true; setCell({ anchor: start, focus: { row: r, col: c } }); }
    };
    const up = () => {
      window.removeEventListener('pointermove', moveHandler);
      window.removeEventListener('pointerup', up);
      if (!dragged) { setCell({ anchor: start, focus: start }); startEdit(row, col); }
      gridRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('pointermove', moveHandler);
    window.addEventListener('pointerup', up);
  };

  const startResize = (event: React.PointerEvent, property: PropertyEntity) => {
    event.preventDefault(); event.stopPropagation();
    resizing.current = true;
    const startX = event.clientX, start = widthOf(property);
    const move = (moveEvent: PointerEvent) => setWidths(previous => ({ ...previous, [property.id]: Math.max(property.type === 'title' ? 100 : 32, Math.round(start + moveEvent.clientX - startX)) }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setTimeout(() => { resizing.current = false; }, 0); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startColumnDrag = (event: React.PointerEvent, property: PropertyEntity) => {
    if (event.button !== 0 || !view) return;
    const startX = event.clientX;
    let active = false;
    const move = (moveEvent: PointerEvent) => {
      if (!active && Math.abs(moveEvent.clientX - startX) < 5) return;
      active = true;
      const target = (document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-head-id]');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setDragColumn({ id: property.id, over: target.dataset.headId ?? null, side: moveEvent.clientX < rect.left + rect.width / 2 ? 'left' : 'right' });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragColumn(current => {
        if (active && current?.over && current.over !== property.id) {
          const order = (config.visibleProperties ?? result.visibleProperties).filter(id => id !== property.id);
          let at = order.indexOf(current.over);
          if (at < 0) at = order.length; else if (current.side === 'right') at += 1;
          order.splice(at, 0, property.id);
          updateView(view, { visibleProperties: order });
        }
        return null;
      });
      if (active) { justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 0); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startRowDrag = (event: React.PointerEvent, row: QueryRow, group?: QueryGroup) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX, startY = event.clientY;
    // Pressing the handle while its menu is open closes the menu (overlay) and must not reopen it.
    const menuWasOpen = pressClosedMenu(event.nativeEvent, handle);
    let active = false;
    let ghost: DragGhost | null = null;
    // Like blocks and cards: a 40% copy of the row(s) follows the pointer while the rows stay put,
    // and a 4px line (fading in and out) marks where they will land — none where nothing would move.
    const dragged = selected.has(row.id) ? rowIds.filter(id => selected.has(id)) : [row.id];
    const move = (moveEvent: PointerEvent) => {
      if (!active && !pastThreshold(moveEvent.clientX - startX, moveEvent.clientY - startY)) return;
      if (!active) {
        active = true;
        document.body.classList.add('dragging-rows');
        const elements = dragged.map(id => handle.closest('.table-body, .table-scroll, .database-block')?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)).filter((element): element is HTMLElement => !!element);
        ghost = createDragGhost(elements, startX, startY, { contextClass: 'table-view' });
      }
      ghost?.move(moveEvent.clientX, moveEvent.clientY);
      last = { x: moveEvent.clientX, y: moveEvent.clientY };
      locate(moveEvent.clientX, moveEvent.clientY);
      auto.update(moveEvent.clientX, moveEvent.clientY);
    };
    // Near the top or bottom of the page the page scrolls along (the drop line follows).
    let last = { x: startX, y: startY };
    const auto = edgeScroller(handle.closest<HTMLElement>('.frame-scroller'), () => { if (active) locate(last.x, last.y); });
    const locate = (clientX: number, clientY: number) => {
      const target = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-row-id]');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const over = target.dataset.rowId ?? null;
      const after = clientY > rect.top + rect.height / 2;
      const position = over ? rowIds.indexOf(over) : -1;
      const last = rowIds.indexOf(dragged[dragged.length - 1]);
      if (!over || dragged.includes(over) || (!after && position === last + 1)) { setDragRow(current => (current ? { ...current, over: null } : current)); setRowLine(null); return; }
      setDragRow({ id: row.id, over, after });
      const table = target.closest('.table-scroll')?.getBoundingClientRect() ?? rect;
      const left = Math.max(rect.left, table.left), right = Math.min(rect.right, table.right);
      setRowLine({ key: `${over}:${after}`, left, width: right - left, top: (after ? rect.bottom : rect.top) - 2 });
    };
    const up = () => {
      auto.stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost?.remove();
      setRowLine(null);
      document.body.classList.remove('dragging-rows');
      setDragRow(current => {
        // A click (no drag) selects the row and opens its menu left of the handle.
        if (!active) { if (menuWasOpen) return null; if (!selected.has(row.id)) onSelect(new Set([row.id])); if (handle) setRowMenu({ anchor: handle, id: row.id, placement: 'left-center' }); return null; }
        if (current?.over && current.over !== row.id) {
          const ids = selected.has(row.id) ? rowIds.filter(id => selected.has(id)) : [row.id];
          const targetLine = lines.find(line => line.row.id === current.over);
          const operations: Operation[] = [];
          if (targetLine?.group && groupProperty && targetLine.group.key !== group?.key && !readOnlyTypes.has(groupProperty.type)) {
            for (const id of ids) operations.push(groupProperty.type === 'relation' ? { type: 'relation.set', pageId: id, propertyId: groupProperty.id, targetIds: (groupValue(groupProperty, targetLine.group) as string[]) ?? [] } : { type: 'value.set', pageId: id, propertyId: groupProperty.id, value: groupValue(groupProperty, targetLine.group) ?? null });
          }
          if (!sorted) {
            const siblings = workspace.children(sourceId).filter(item => item.kind === 'page' && !(item as PageEntity).template).map(item => item.id);
            let before: string | undefined;
            if (current.after) { const position = siblings.indexOf(current.over); before = siblings.slice(position + 1).find(id => !ids.includes(id)); }
            else before = current.over;
            for (const id of ids) operations.push({ type: 'node.move', id, parentId: sourceId, ...(before ? { beforeId: before } : {}) });
          } else if (!operations.length) setStatus(t("정렬이 적용된 보기에서는 행 순서를 바꿀 수 없습니다. 정렬을 지우고 옮기세요."));
          if (operations.length) apply(operations).catch(report);
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const editingProperty = editing ? columns.find(property => property.id === editing.propertyId) : undefined;
  const editingRow = editing ? index.get(editing.rowId) : undefined;
  const allSelected = rowIds.length > 0 && rowIds.every(id => selected.has(id));
  const aggregations = result.presentation.columnAggregations ?? {};

  let rowCounter = -1;
  return (
    <div className={`table-view${inline ? ' inline' : ''}`}>
      <div className="table-scroll">
        <div ref={gridRef} className="table-grid" tabIndex={-1} onKeyDown={onKeyDown} style={{ minWidth: totalWidth + 64 }}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && !document.querySelector('.overlay-layer')) setCell(null); }}>
          <div className="table-head-row" role="row">
            <div className={`row-gutter head${allSelected ? ' checked' : ''}${selected.size ? ' visible' : ''}`}>
              <label className="row-check" title={t("모두 선택")}><input type="checkbox" checked={allSelected} onChange={() => onSelect(allSelected ? new Set() : new Set(rowIds))} /><span className="row-check-box">{allSelected ? <Icon name="check" size={12} /> : null}</span></label>
            </div>
            {columns.map(property => (
              <div key={property.id} data-head-id={property.id} role="columnheader"
                className={`table-head-cell${frozen.has(property.id) ? ' frozen' : ''}${dragColumn?.over === property.id ? ` drop-${dragColumn.side}` : ''}${dragColumn?.id === property.id ? ' dragging' : ''}`}
                style={{ width: widthOf(property), ...(stickyLeft.has(property.id) ? { left: stickyLeft.get(property.id) } : {}) }}
                onPointerDown={event => { if ((event.target as HTMLElement).closest('.col-resize') || locked) return; startColumnDrag(event, property); }}
                onClick={event => { if (resizing.current || justDragged.current || locked) return; setHeader({ anchor: event.currentTarget, property }); }}>
                <Icon name={`type-${property.type}`} size={16} className="head-icon" />
                <span className="head-name">{property.name}</span>
                <span className="col-resize" onPointerDown={event => startResize(event, property)} onClick={event => event.stopPropagation()} onDoubleClick={() => setWidths(previous => { const next = { ...previous }; delete next[property.id]; return next; })} />
              </div>
            ))}
            {locked ? null : <button type="button" className="table-head-add" aria-label={t("속성 추가")} title={t("속성 추가")} onClick={event => setAddColumn(event.currentTarget)}><Icon name="plus" size={16} /></button>}
            <div className="table-head-fill" />
          </div>
          {entries.map((entry, entryIndex) => {
            if (entry.kind === 'group') {
              const isCollapsed = collapsed.includes(entry.group.key);
              return (
                <div key={`g-${entry.group.key}`} className="table-group-head">
                  <button type="button" className="group-toggle icon-button tiny" aria-label={isCollapsed ? t("펼치기") : t("접기")} onClick={() => setCollapsed(isCollapsed ? collapsed.filter(item => item !== entry.group.key) : [...collapsed, entry.group.key])}><Icon name="triangle-right" size={12} className={isCollapsed ? '' : 'rotated'} /></button>
                  <GroupLabel property={groupProperty} group={entry.group} />
                  <span className="group-count">{entry.count}</span>
                  <span className="group-head-actions">
                    <button type="button" className="icon-button tiny" aria-label={t("그룹 메뉴")} onClick={event => setGroupMenu({ anchor: event.currentTarget, group: entry.group })}><Icon name="more" size={14} /></button>
                    <button type="button" className="icon-button tiny" aria-label={t("이 그룹에 새 페이지")} onClick={() => newRow(result, sourceId, { values: groupProperty ? { [groupProperty.id]: groupValue(groupProperty, entry.group) } : {} }).catch(report)}><Icon name="plus" size={14} /></button>
                  </span>
                </div>
              );
            }
            if (entry.kind === 'new') {
              return (
                <button type="button" key={`n-${entry.group?.key ?? 'all'}-${entryIndex}`} className="table-new-row" onClick={async () => {
                  const values = entry.group && groupProperty && !readOnlyTypes.has(groupProperty.type) ? { [groupProperty.id]: groupValue(groupProperty, entry.group) } : {};
                  const id = await newRow(result, sourceId, { values, open: false });
                  // Focus the new row's title cell for typing.
                  setTimeout(() => {
                    const element = gridRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"] [data-col="0"]`);
                    if (element) { const [r, c] = element.dataset.cell!.split(':').map(Number); setCell({ anchor: { row: r, col: c }, focus: { row: r, col: c } }); setEditing({ rowId: id, propertyId: columns[0].id, element }); }
                  }, 150);
                }}>
                  <Icon name="plus" size={16} /><span>{t("새 페이지")}</span>
                </button>
              );
            }
            const line = entry;
            const row = line.row;
            const rowNumber = ++rowCounter;
            const isSelected = selected.has(row.id);
            return (
              <div key={row.id} data-row-id={row.id} role="row" className={`table-row${isSelected ? ' selected' : ''}${row.colors?.row ? ` cc-${row.colors.row}` : ''}`}
                onContextMenu={event => {
                  // Right-click selects the row and opens its menu at the pointer.
                  if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
                  event.preventDefault();
                  if (!isSelected) onSelect(new Set([row.id]));
                  const cellElement = (event.target as HTMLElement).closest<HTMLElement>('[data-col]'), cellProperty = cellElement ? columns[Number(cellElement.dataset.col)] : undefined;
                  setRowMenu({ anchor: { x: event.clientX, y: event.clientY }, id: row.id, ...(cellElement && cellProperty && !['title', 'button'].includes(cellProperty.type) ? { cell: { element: cellElement, property: cellProperty } } : {}) });
                }}>
                <div className={`row-gutter${isSelected ? ' checked' : ''}${selected.size ? ' visible' : ''}`}>
                  <button type="button" className="row-add" aria-label={t("클릭하여 아래에 추가, Option-클릭하여 위에 추가")} title={t("클릭하여 아래에 추가\nOption-클릭하여 위에 추가")} onPointerDown={event => event.stopPropagation()} onClick={event => addRowNear(row, line.group, event.altKey).catch(report)}><Icon name="plus" size={16} /></button>
                  <span className="row-drag" role="button" aria-label={t("드래그하여 옮기기, 클릭하여 메뉴 열기")} title={t("드래그하여 옮기기\n클릭하여 메뉴 열기")} onPointerDown={event => startRowDrag(event, row, line.group)}><Icon name="drag" size={16} /></span>
                  <label className="row-check"><input type="checkbox" checked={isSelected} onChange={() => onSelect(new Set(isSelected ? [...selected].filter(id => id !== row.id) : [...selected, row.id]))} /><span className="row-check-box">{isSelected ? <Icon name="check" size={12} /> : null}</span></label>
                </div>
                {columns.map((property, col) => {
                  const raw = property.type === 'title' ? row.title : row.values[property.id];
                  const { value, drafted } = readOnlyTypes.has(property.type) ? { value: raw, drafted: false } : shownValue(row.id, property, raw);
                  const isRange = inRange(rowNumber, col);
                  const isFocus = cell && cell.focus.row === rowNumber && cell.focus.col === col;
                  const wrap = wrapped.includes(property.id);
                  return (
                    <div key={property.id} data-cell={`${rowNumber}:${col}`} data-col={col} role="gridcell"
                      className={`table-cell type-${property.type}${row.colors?.cells?.[property.id] ? ` cc-${row.colors.cells[property.id]}` : ''}${frozen.has(property.id) ? ' frozen' : ''}${isRange ? ' in-range' : ''}${isFocus && !editing ? ' focused' : ''}${drafted ? ' drafted' : ''}${wrap ? ' wrap' : ''}`}
                      style={{ width: widthOf(property), ...(stickyLeft.has(property.id) ? { left: stickyLeft.get(property.id) } : {}) }}
                      onPointerDown={event => onCellPointerDown(event, rowNumber, col)}>
                      {property.type === 'title' ? (
                        <div className="title-cell" style={{ paddingLeft: line.depth * 24 }}>
                          {nested ? (row.children?.length ? <button type="button" className="subitem-toggle icon-button tiny" aria-label={expanded.has(row.id) ? t("하위 항목 접기") : t("하위 항목 펼치기")} onPointerDown={event => event.stopPropagation()} onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })}><Icon name="triangle-right" size={12} className={expanded.has(row.id) ? 'rotated' : ''} /></button> : <span className="subitem-spacer" />) : null}
                          {config.showPageIcon === false ? null : <span className="title-icon"><EntityIcon item={workspace.get(row.id)} size={18} /></span>}
                          <span className="title-text">{String(value ?? '') || <span className="title-placeholder">{t("제목 없음")}</span>}</span>
                          <button type="button" className="row-open" onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.preventDefault()} onClick={event => openRow(view, row.id, rowIds, { side: event.altKey })}><Icon name={config.openMode === 'center' ? 'peek-center' : config.openMode === 'page' ? 'peek-full' : 'peek-side'} size={14} /><span>{t("열기")}</span></button>
                        </div>
                      ) : property.type === 'button' ? (
                        <button type="button" className="cell-button" onPointerDown={event => event.stopPropagation()} onClick={() => { const live = workspace.get<PropertyEntity>(property.id); if (live) runButton(live, row.id).catch(report); }}>{property.button?.label || property.name}</button>
                      ) : (
                        <ValueView property={property} value={value} row={row} mode="cell" wrap={wrap} asCheckbox={property.type === 'status' && !!config.checkboxStatus?.includes(property.id)} />
                      )}
                      {property.type !== 'title' && property.type !== 'button' && openComments.get(`${row.id}:${property.id}`) ? (() => {
                        const count = openComments.get(`${row.id}:${property.id}`) ?? 0;
                        return <button type="button" className={`cell-comment${count ? ' has' : ''}`} aria-label={t("{0} 댓글", [property.name])} title={t("{0} 댓글", [property.name])} onPointerDown={event => event.stopPropagation()} onClick={event => setCellComments({ anchor: event.currentTarget.closest('.table-cell')!, rowId: row.id, property })}><Icon name="comment" size={14} />{count ? <span>{count}</span> : null}</button>;
                      })() : null}
                    </div>
                  );
                })}
                <div className="table-row-fill" />
              </div>
            );
          })}
          {emptyState && !result.presentation.groups && !result.rows.length ? <div className="table-empty">{emptyState}</div> : null}
          <div className="table-calc-row">
            <div className="row-gutter" />
            {columns.map(property => {
              const operation = config.columnAggregations?.[property.id];
              return (
                <button type="button" key={property.id} className={`table-calc-cell${operation ? ' set' : ''}${frozen.has(property.id) ? ' frozen' : ''}`} style={{ width: widthOf(property), ...(stickyLeft.has(property.id) ? { left: stickyLeft.get(property.id) } : {}) }}
                  onClick={event => view && setCalc({ anchor: event.currentTarget, property })}>
                  {operation ? <><span className="calc-label">{aggregateLabels[operation]}</span><span className="calc-value">{formatAggregate(aggregations[property.id], operation, property)}</span></> : <span className="calc-placeholder">{t("계산")}<Icon name="chevron-down" size={12} /></span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {fadingRowLines.map(entry => <div key={entry.id} className={`card-drop-line drop-fade${entry.leaving ? ' leaving' : ''}`} style={{ left: entry.item.left, top: entry.item.top, width: entry.item.width }} />)}
      {editing && editingProperty && editingRow ? (
        <ValueEditor anchor={editing.element} pageId={editing.rowId} property={editingProperty} placement={['title', 'text', 'number', 'url', 'email', 'phone', 'select', 'status', 'multi_select', 'person'].includes(editingProperty.type) ? 'cover' : 'below-start'}
          value={editing.text !== undefined ? editing.text : shownValue(editing.rowId, editingProperty, editingProperty.type === 'title' ? editingRow.title : editingRow.values[editingProperty.id]).value}
          width={editing.element.getBoundingClientRect().width} row={editingRow}
          onClose={() => {
            const id = editing.rowId;
            setEditing(null); requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
            if (freshRow.current === id) { freshRow.current = null; window.setTimeout(() => discardEmptyRow(id), 700); }
          }} />
      ) : null}
      {header ? <PropertyHeaderMenu anchor={header.anchor} property={header.property} view={view} result={result} onClose={() => setHeader(null)} onFilter={onFilterProperty}
        wrap={wrapped.includes(header.property.id)} onWrap={value => setWrapped(value ? [...wrapped, header.property.id] : wrapped.filter(id => id !== header.property.id))} /> : null}
      {addColumn ? <NewPropertyMenu anchor={addColumn} sourceId={sourceId} view={view} result={result} onClose={() => setAddColumn(null)} /> : null}
      {calc && view ? (
        <Menu anchor={calc.anchor} placement="below-start" width={240} onClose={() => setCalc(null)} entries={[
          { label: t("없음"), checked: !config.columnAggregations?.[calc.property.id], onSelect: () => { const next = { ...(config.columnAggregations ?? {}) }; delete next[calc.property.id]; updateView(view, { columnAggregations: next }); } },
          ...aggregationsFor(calc.property).map(operation => ({ label: aggregateLabels[operation], checked: config.columnAggregations?.[calc.property.id] === operation, onSelect: () => updateView(view, { columnAggregations: { ...(config.columnAggregations ?? {}), [calc.property.id]: operation } }) } as MenuEntry)),
        ]} />
      ) : null}
      {cellComments ? <PropertyComments anchor={cellComments.anchor} pageId={cellComments.rowId} property={cellComments.property} comments={workspace.children(cellComments.rowId).filter(item => item.kind === 'comment') as unknown as CommentEntity[]} onClose={() => setCellComments(null)} /> : null}
      {rowMenu ? <RowMenu anchor={rowMenu.anchor} placement={rowMenu.placement} rowId={rowMenu.id} view={view} orderedIds={rowIds} onClose={() => setRowMenu(null)}
        cellComment={rowMenu.cell ? { name: rowMenu.cell.property.name, open: () => { const cell = rowMenu.cell!; setRowMenu(null); setCellComments({ anchor: cell.element, rowId: rowMenu.id, property: cell.property }); } } : undefined} /> : null}
      {groupMenu && view ? (
        <Menu anchor={groupMenu.anchor} width={240} onClose={() => setGroupMenu(null)} entries={[
          { label: t("그룹 숨기기"), icon: 'eye-off', onSelect: () => updateView(view, { hiddenGroups: [...(config.hiddenGroups ?? []), groupMenu.group.key] }) },
          { label: t("그룹 해제"), icon: 'group', onSelect: () => updateView(view, { groupBy: null }) },
        ]} />
      ) : null}
      {result.hasMore ? <div className="table-more">{t("{0}개 중 {1}개 표시", [result.total, result.rows.length])}</div> : null}
    </div>
  );
}

export function propertyTypeLabel(property: PropertyEntity) { return propertyLabels[property.type]; }
export { newId };
