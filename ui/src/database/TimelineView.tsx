import { edgeScroller } from '../ui/drag';
import { formatMonth, formatYearMonth } from '../data/format';
import { t } from '../i18n';
import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayDay, moveDateToDay, shiftDay } from '../../../web/view-layout.mjs';
import { apply } from '../data/commands';
import { report, workspace } from '../data/store';
import { useLocalPreference } from '../data/hooks';
import type { Operation, QueryRow } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { EntityIcon } from '../page/EntityIcon';
import { ValueView, readOnlyTypes } from './values';
import { ToolbarSlot, newRow, openRow, rowIndex, shownProperties, updateView } from './shared';
import { setStatus } from '../data/store';
import type { ViewProps } from './TableView';

const dayMs = 86400000;
const pad = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (day: string, amount: number) => shiftDay(day, amount) as string;
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);
// Day widths per zoom; quarter and year (the wider scales) label weeks and months instead of days.
const zoomWidth: Record<string, number> = { hour: 480, day: 100, week: 56, biweek: 40, month: 40, quarter: 12, year: 4 };
const zoomLevels = ['hour', 'day', 'week', 'biweek', 'month', 'quarter', 'year'] as const;
const zoomLabels: Record<string, string> = { hour: t("zoom|시간"), day: t("일"), week: t("주"), biweek: t("zoom|2주"), month: t("월"), quarter: t("zoom|분기"), year: t("zoom|연") };
const navDays: Record<string, number> = { quarter: 30, year: 91 };
const rowHeight = 36;

// The red line marks the current time within today's column.
const dayFraction = () => { const now = new Date(); return (now.getHours() * 60 + now.getMinutes()) / 1440; };

export function TimelineView({ result, view, sourceId }: ViewProps) {
  const config = view?.config ?? {};
  const zoom = config.timelineZoom ?? 'month';
  const perDay = zoomWidth[zoom] ?? 40;
  const today = dayKey(new Date());
  const index = useMemo(() => rowIndex(result), [result]);
  const dateProperty = result.properties.find(property => property.id === result.presentation.datePropertyId);
  const endProperty = config.endDatePropertyId ? result.properties.find(property => property.id === config.endDatePropertyId) : undefined;
  const items = (result.presentation.items ?? []).map(item => ({ rowId: item.rowId, from: displayDay(item.start, item.timeZone) as string, to: displayDay(item.end ?? item.start, item.timeZone) as string }));
  const ordered = items.map(item => item.rowId);
  const [showTable, setShowTable] = useLocalPreference(`pageyard-timeline-table:${view?.id ?? sourceId}`, false);
  const [zoomMenu, setZoomMenu] = useState<Element | null>(null);
  const [drag, setDrag] = useState<{ rowId: string; delta: number; mode: 'move' | 'start' | 'end' } | null>(null);
  const [visibleMonth, setVisibleMonth] = useState('');
  const [undatedMenu, setUndatedMenu] = useState<Element | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [limit, setLimit] = useState(config.loadLimit ?? 50);
  const [rowDrag, setRowDrag] = useState<{ rowId: string; over: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const earliest = items.reduce((min, item) => item.from < min ? item.from : min, addDays(today, -21));
  const latest = items.reduce((max, item) => item.to > max ? item.to : max, addDays(today, 60));
  const rangeStart = addDays(earliest, -14);
  const days = Math.max(zoom === 'year' ? 730 : zoom === 'quarter' ? 365 : 60, diffDays(rangeStart, latest) + 30);
  const width = days * perDay;
  const x = (day: string) => diffDays(rangeStart, day) * perDay;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // Today's left edge starts in the middle of the window less its 8px gutter (at 1242 wide,
    // today's column starts 617 in).
    element.scrollLeft = Math.max(0, x(today) - Math.round((element.clientWidth - 8) / 2));
    const update = () => {
      const day = addDays(rangeStart, Math.floor((element.scrollLeft + 104) / perDay));
      setVisibleMonth(formatYearMonth(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 1)));
      setScrollLeft(element.scrollLeft);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, view?.id, rangeStart]);

  // A full-page database's timeline runs to the bottom of the window, so its scroll bar sits there
  // rather than under the timeline in the middle of the page.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !element.closest('.database-block.full')) return;
    const fit = () => { element.style.minHeight = ''; const bottom = element.getBoundingClientRect().top + (element.closest('.frame-scroller')?.scrollTop ?? 0); element.style.minHeight = `${Math.max(0, window.innerHeight - bottom)}px`; };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });

  if (!dateProperty) {
    return (
      <div className="board-empty">
        <p>{t("타임라인에 표시할 날짜 속성이 필요합니다.")}</p>
        <button type="button" className="outline-button small" onClick={() => {
          const date = result.properties.find(property => property.type === 'date');
          if (date && view) updateView(view, { datePropertyId: date.id });
          else import('../dialogs/registry').then(module => module.openWorkspaceDialog('property', { sourceId, type: 'date' }));
        }}>{t("날짜 속성 설정")}</button>
      </div>
    );
  }

  const commit = (rowId: string, delta: number, mode: 'move' | 'start' | 'end') => {
    const row = index.get(rowId);
    const value = row?.values[dateProperty.id] as { start: string; end?: string; timeZone?: string } | undefined;
    if (!row || !value?.start || !delta || readOnlyTypes.has(dateProperty.type)) return;
    const operations: Operation[] = [];
    const startDay = displayDay(value.start, value.timeZone) as string;
    const endDay = displayDay(value.end ?? value.start, value.timeZone) as string;
    if (mode === 'move') {
      operations.push({ type: 'value.set', pageId: rowId, propertyId: dateProperty.id, value: moveDateToDay(value, addDays(startDay, delta)) });
      if (endProperty && endProperty.id !== dateProperty.id) {
        const end = row.values[endProperty.id] as { start: string; timeZone?: string } | undefined;
        if (end?.start) operations.push({ type: 'value.set', pageId: rowId, propertyId: endProperty.id, value: moveDateToDay(end, addDays(displayDay(end.start, end.timeZone) as string, delta)) });
      }
    } else if (mode === 'end') {
      const next = addDays(endDay, delta);
      if (next < startDay) return;
      const endValue = value.start.includes('T') ? moveDateToDay({ start: value.end ?? value.start, timeZone: value.timeZone }, next).start : next;
      operations.push({ type: 'value.set', pageId: rowId, propertyId: dateProperty.id, value: { ...value, end: endValue } });
    } else {
      const next = addDays(startDay, delta);
      if (next > endDay) return;
      const moved = moveDateToDay({ start: value.start, timeZone: value.timeZone }, next);
      operations.push({ type: 'value.set', pageId: rowId, propertyId: dateProperty.id, value: { ...value, start: moved.start, end: value.end ?? value.start } });
    }
    apply(operations).catch(report);
  };

  const startDrag = (event: React.PointerEvent, rowId: string, mode: 'move' | 'start' | 'end') => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startX = event.clientX;
    const scroller = scrollRef.current, startScroll = scroller?.scrollLeft ?? 0;
    let active = false, delta = 0, lastX = startX;
    // Days moved count the timeline's own scrolling too, so a bar held at the edge keeps travelling.
    const update = () => {
      const next = Math.round((lastX - startX + (scroller ? scroller.scrollLeft - startScroll : 0)) / perDay);
      if (next !== delta || !active) { delta = next; setDrag({ rowId, delta, mode }); }
    };
    const auto = edgeScroller(scroller, () => { if (active) update(); }, 'x');
    const move = (moveEvent: PointerEvent) => {
      if (!active && Math.abs(moveEvent.clientX - startX) < 4) return;
      lastX = moveEvent.clientX;
      update();
      active = true;
      auto.update(moveEvent.clientX, moveEvent.clientY);
    };
    const up = () => {
      auto.stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!active) { if (mode === 'move') openRow(view, rowId, ordered); return; }
      commit(rowId, delta, mode);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Header labels: months on top, days (or weeks) below.
  const months: Array<{ key: string; left: number; label: string }> = [];
  const ticks: Array<{ key: string; left: number; label: string; today: boolean; weekend: boolean }> = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(rangeStart, i);
    const date = new Date(`${day}T00:00:00`);
    if (zoom === 'year' ? date.getDate() === 1 && date.getMonth() === 0 : date.getDate() === 1) months.push({ key: day, left: i * perDay, label: zoom === 'year' ? String(date.getFullYear()) : formatMonth(date) });
    const label = zoom === 'year' ? (date.getDate() === 1 ? formatMonth(date).replace(/\s*\d{4}\s*[년年]?\s*/, '') : '')
      : zoom === 'quarter' || zoom === 'week' || zoom === 'biweek' ? (date.getDay() === 1 ? String(date.getDate()) : '') : String(date.getDate());
    ticks.push({ key: day, left: i * perDay, label, today: day === today, weekend: date.getDay() === 0 || date.getDay() === 6 });
  }

  const allRows = items.map(item => ({ ...item, row: index.get(item.rowId) })).filter((item): item is typeof item & { row: QueryRow } => !!item.row);
  // Load limit (10 · 25 · 50 · 100): the first N rows, then "더 불러오기".
  const rowsWithDates = allRows.slice(0, limit);
  const tableProperties = shownProperties(result).filter(property => property.type !== 'title').slice(0, 6);
  const positions = new Map(rowsWithDates.map((item, rowNumber) => [item.rowId, rowNumber]));
  const deps = result.presentation.dependencies ?? [];

  const rowsHeight = Math.max((rowsWithDates.length + 1) * 36 + 32, 144);
  const tableWidth = showTable ? 260 + tableProperties.length * 140 : 0;
  const sorted = !!config.sorts?.length;
  // Rows reorder by dragging them in the side table (the row order of an unsorted view, as in the table).
  const startRowDrag = (event: React.PointerEvent, rowId: string) => {
    if (event.button !== 0) return;
    const startY = event.clientY, from = rowsWithDates.findIndex(item => item.rowId === rowId);
    let active = false, over = from;
    const move = (moveEvent: PointerEvent) => {
      if (!active && Math.abs(moveEvent.clientY - startY) < 4) return;
      active = true;
      over = Math.max(0, Math.min(rowsWithDates.length, from + Math.round((moveEvent.clientY - startY) / rowHeight) + (moveEvent.clientY > startY ? 1 : 0)));
      setRowDrag({ rowId, over });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setRowDrag(null);
      if (!active) { openRow(view, rowId, ordered); return; }
      if (over === from || over === from + 1) return;
      if (sorted) { setStatus(t("정렬이 적용된 보기에서는 행 순서를 바꿀 수 없습니다. 정렬을 지우고 옮기세요.")); return; }
      const before = rowsWithDates[over]?.rowId;
      apply([{ type: 'node.move', id: rowId, parentId: sourceId, ...(before ? { beforeId: before } : {}) } as Operation]).catch(report);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const toolbarSlot = useContext(ToolbarSlot);
  // "날짜 없음 (N)" sits in the database toolbar, left of the filter button, as in the calendar.
  const undatedButton = result.presentation.undated?.length ? <button type="button" className="calendar-undated" onClick={event => setUndatedMenu(event.currentTarget)}>{t("날짜 없음 ({0})", [result.presentation.undated.length])}</button> : null;
  return (
    <div className={`timeline-view${showTable ? ' with-table' : ''}`}>
      {/* A 36px band (current month left, controls right; later months sit at their
          first day inside the scrolling band), then 28px of 12px day numbers. */}
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <button type="button" className="icon-button small" aria-label={showTable ? t("표 접기") : t("표 펼치기")} title={showTable ? t("표 접기") : t("표 펼치기")} onClick={() => setShowTable(!showTable)}><Icon name={showTable ? 'double-chevron-left' : 'double-chevron-right'} size={16} /></button>
          <span className="timeline-month-label">{visibleMonth}</span>
        </div>
        <span className="spacer" />
        <div className="timeline-toolbar-right">
          {undatedButton && !toolbarSlot ? undatedButton : null}
          <button type="button" className="timeline-zoom" onClick={event => setZoomMenu(event.currentTarget)}>{zoomLabels[zoom]}<Icon name="chevron-down" size={12} /></button>
          <button type="button" className="calendar-nav" aria-label={t("이전")} onClick={() => scrollRef.current?.scrollBy({ left: -perDay * (navDays[zoom] ?? 7), behavior: 'smooth' })}><Icon name="chevron-left" size={20} /></button>
          <button type="button" className="calendar-today" onClick={() => { const element = scrollRef.current; if (element) element.scrollTo({ left: Math.max(0, x(today) - Math.round((element.clientWidth - 8) / 2)), behavior: 'smooth' }); }}>{t("오늘")}</button>
          <button type="button" className="calendar-nav" aria-label={t("다음")} onClick={() => scrollRef.current?.scrollBy({ left: perDay * (navDays[zoom] ?? 7), behavior: 'smooth' })}><Icon name="chevron-right" size={20} /></button>
        </div>
        {undatedButton && toolbarSlot ? createPortal(undatedButton, toolbarSlot) : null}
      </div>
      <div className="timeline-body">
        {showTable ? (
          <div className="timeline-table" style={{ width: tableWidth }}>
            <div className="timeline-table-head"><span className="timeline-table-title">{t("이름")}</span>{tableProperties.map(property => <span key={property.id} className="timeline-table-cell">{property.name}</span>)}</div>
            {rowsWithDates.map((item, rowNumber) => (
              <div role="button" tabIndex={0} key={item.rowId} className={`timeline-table-row${rowDrag?.rowId === item.rowId ? ' dragging' : ''}${rowDrag && rowDrag.over === rowNumber ? ' drop-before' : ''}${rowDrag && rowDrag.over === rowsWithDates.length && rowNumber === rowsWithDates.length - 1 ? ' drop-after' : ''}`}
                onPointerDown={event => startRowDrag(event, item.rowId)} onKeyDown={event => { if (event.key === 'Enter') openRow(view, item.rowId, ordered); }}>
                <span className="timeline-table-title"><EntityIcon item={workspace.get(item.rowId)} size={16} /><span>{item.row.title || t("제목 없음")}</span></span>
                {tableProperties.map(property => <span key={property.id} className="timeline-table-cell"><ValueView property={property} value={item.row.values[property.id]} row={item.row} mode="card" /></span>)}
              </div>
            ))}
          </div>
        ) : null}
        <div className="timeline-scroll" ref={scrollRef}>
          <div className="timeline-canvas" style={{ width }}>
            <div className="timeline-header">
              <div className="timeline-months">{months.map(month => month.left - scrollLeft < 260 ? null : <span key={month.key} style={{ left: month.left }}>{month.label}</span>)}</div>
              <div className="timeline-days">{ticks.map(tick => <span key={tick.key} className={tick.today ? 'today' : ''} style={{ left: tick.left, width: perDay }}>{tick.today ? <span className="today-pill">{tick.label || new Date(`${tick.key}T00:00:00`).getDate()}</span> : tick.label}</span>)}</div>
            </div>
            <div className="timeline-grid" style={{ height: rowsHeight }}>
              {perDay >= 30 ? ticks.filter(tick => tick.weekend).map(tick => <div key={tick.key} className="timeline-weekend" style={{ left: tick.left, width: perDay }} />) : null}
              <div className="timeline-today-line" style={{ left: x(today) + Math.round(perDay * dayFraction()) }} />
              <svg className="timeline-deps" width={width} height={rowsWithDates.length * 36 + 40}>
                {deps.map(dep => {
                  const a = rowsWithDates.find(item => item.rowId === dep.predecessorId), b = rowsWithDates.find(item => item.rowId === dep.successorId);
                  if (!a || !b) return null;
                  const x1 = x(a.to) + perDay - 3, y1 = (positions.get(a.rowId) ?? 0) * 36 + 21, x2 = x(b.from), y2 = (positions.get(b.rowId) ?? 0) * 36 + 21;
                  const mid = Math.max(x1 + 8, x2 - 8);
                  return <path key={`${dep.predecessorId}-${dep.successorId}`} d={`M${x1} ${y1} H${mid} V${y2} H${x2}`} className={x2 < x1 ? 'conflict' : ''} />;
                })}
              </svg>
              {rowsWithDates.map((item, rowNumber) => {
                const dragging = drag?.rowId === item.rowId ? drag : null;
                const from = dragging && (dragging.mode === 'move' || dragging.mode === 'start') ? addDays(item.from, dragging.delta) : item.from;
                const to = dragging && (dragging.mode === 'move' || dragging.mode === 'end') ? addDays(item.to, dragging.delta) : item.to;
                const barWidth = Math.max(perDay - 3, (diffDays(from, to) + 1) * perDay - 3);
                const short = barWidth < 120;
                return (
                  <div key={item.rowId} className={`timeline-bar${item.row.colors?.row ? ` cc-${item.row.colors.row}` : ''}${dragging ? ' dragging' : ''}${short ? ' short' : ''}`} style={{ left: x(from) + 2, width: barWidth, top: rowNumber * 36 + 5 }}
                    onPointerDown={event => startDrag(event, item.rowId, 'move')} title={item.row.title}>
                    <span className="timeline-handle start" onPointerDown={event => startDrag(event, item.rowId, 'start')} />
                    <span className="timeline-bar-title">{item.row.title || t("제목 없음")}</span>
                    <span className="timeline-handle end" onPointerDown={event => startDrag(event, item.rowId, 'end')} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <button type="button" className="timeline-new" style={{ top: 64 + rowsWithDates.length * 36 + 4, left: tableWidth + 100 }}
          onClick={() => newRow(result, sourceId, { values: { [dateProperty.id]: { start: today } } }).catch(report)}><Icon name="plus" size={16} />{t("새로 만들기")}</button>
        {allRows.length > rowsWithDates.length ? <button type="button" className="timeline-more" style={{ top: 64 + rowsWithDates.length * 36 + 40, left: tableWidth + 100 }} onClick={() => setLimit(limit + (config.loadLimit ?? 50))}>{t("더 불러오기")} ({allRows.length - rowsWithDates.length})</button> : null}
      </div>
      {undatedMenu && result.presentation.undated ? (
        <Menu anchor={undatedMenu} placement="below-end" width={280} onClose={() => setUndatedMenu(null)} entries={result.presentation.undated.map(id => ({ label: index.get(id)?.title || t("제목 없음"), icon: 'page', onSelect: () => openRow(view, id, result.presentation.undated) }))} />
      ) : null}
      {zoomMenu ? <Menu anchor={zoomMenu} width={180} onClose={() => setZoomMenu(null)} entries={zoomLevels.map(level => ({ label: zoomLabels[level], checked: zoom === level, onSelect: () => updateView(view, { timelineZoom: level }) }))} /> : null}
    </div>
  );
}
