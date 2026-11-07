import { edgeScroller } from '../ui/drag';
import { formatMonthDay, formatYearMonth } from '../data/format';
import { t } from '../i18n';
import { useSettings, weekdayLabels, weekOffset } from '../data/settings';
import { useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayDay, moveDateToDay, shiftDay } from '../../../web/view-layout.mjs';
import { apply } from '../data/commands';
import { report } from '../data/store';
import type { Operation, PropertyEntity, QueryRow } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { EntityIcon } from '../page/EntityIcon';
import { workspace } from '../data/store';
import { ValueView, readOnlyTypes } from './values';
import { ToolbarSlot, newRow, openRow, rowIndex, shownProperties, updateView } from './shared';
import type { ViewProps } from './TableView';

const pad = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayMs = 86400000;
const addDays = (day: string, amount: number) => shiftDay(day, amount) as string;
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);

interface Placed { rowId: string; from: string; to: string; lane: number; startCol: number; span: number; continuesBefore: boolean; continuesAfter: boolean }

function layoutWeek(days: string[], items: Array<{ rowId: string; from: string; to: string }>) {
  const weekStart = days[0], weekEnd = days[6];
  const inWeek = items.filter(item => item.from <= weekEnd && item.to >= weekStart)
    .sort((a, b) => a.from.localeCompare(b.from) || diffDays(b.from, b.to) - diffDays(a.from, a.to));
  const lanes: string[][] = [];
  const placed: Placed[] = [];
  for (const item of inWeek) {
    const from = item.from < weekStart ? weekStart : item.from;
    const to = item.to > weekEnd ? weekEnd : item.to;
    const startCol = days.indexOf(from), endCol = days.indexOf(to);
    let lane = lanes.findIndex(used => used.every((day, index) => index % 2 === 0 ? !(day <= to && used[index + 1] >= from) : true));
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push(from, to);
    placed.push({ rowId: item.rowId, from: item.from, to: item.to, lane, startCol, span: endCol - startCol + 1, continuesBefore: item.from < weekStart, continuesAfter: item.to > weekEnd });
  }
  return { placed, lanes: lanes.length };
}

export function CalendarView({ result, view, sourceId }: ViewProps) {
  useSettings(); // re-render when the week start changes
  const config = view?.config ?? {};
  const weekMode = config.calendarMode === 'week';
  const today = dayKey(new Date());
  const [anchor, setAnchor] = useState(today);
  const [undated, setUndated] = useState<Element | null>(null);
  const toolbarSlot = useContext(ToolbarSlot);
  const [drag, setDrag] = useState<{ rowId: string; day: string; mode: 'move' | 'end' | 'start' } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const index = useMemo(() => rowIndex(result), [result]);
  const dateProperty = result.properties.find(property => property.id === result.presentation.datePropertyId);
  const endProperty = config.endDatePropertyId ? result.properties.find(property => property.id === config.endDatePropertyId) : undefined;
  const properties = shownProperties(result).filter(property => property.type !== 'title' && property.id !== dateProperty?.id);
  const items = (result.presentation.items ?? []).map(item => ({ rowId: item.rowId, from: displayDay(item.start, item.timeZone) as string, to: displayDay(item.end ?? item.start, item.timeZone) as string, raw: item }));
  const ordered = items.map(item => item.rowId);

  const first = new Date(`${anchor.slice(0, 7)}-01T00:00:00`);
  const gridStart = weekMode ? addDays(anchor, -weekOffset(new Date(`${anchor}T00:00:00`))) : addDays(dayKey(first), -weekOffset(first));
  const weeks = Array.from({ length: weekMode ? 1 : 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)));
  const month = anchor.slice(0, 7);

  if (!dateProperty) {
    return (
      <div className="board-empty">
        <p>{t("캘린더에 표시할 날짜 속성이 필요합니다.")}</p>
        <button type="button" className="outline-button small" onClick={() => {
          const date = result.properties.find(property => property.type === 'date');
          if (date && view) updateView(view, { datePropertyId: date.id });
          else import('../dialogs/registry').then(module => module.openWorkspaceDialog('property', { sourceId, type: 'date' }));
        }}>{t("날짜 속성 설정")}</button>
      </div>
    );
  }

  const move = (rowId: string, targetDay: string, mode: 'move' | 'end' | 'start') => {
    const row = index.get(rowId);
    const value = row?.values[dateProperty.id] as { start: string; end?: string; timeZone?: string } | undefined;
    if (!row || !value?.start || readOnlyTypes.has(dateProperty.type)) return;
    const operations: Operation[] = [];
    const startDay = displayDay(value.start, value.timeZone) as string;
    if (mode === 'move') {
      if (targetDay === startDay) return;
      operations.push({ type: 'value.set', pageId: rowId, propertyId: dateProperty.id, value: moveDateToDay(value, targetDay) });
      if (endProperty && endProperty.id !== dateProperty.id) {
        const end = row.values[endProperty.id] as { start: string; timeZone?: string } | undefined;
        if (end?.start) operations.push({ type: 'value.set', pageId: rowId, propertyId: endProperty.id, value: moveDateToDay(end, addDays(displayDay(end.start, end.timeZone) as string, diffDays(startDay, targetDay))) });
      }
    } else if (mode === 'end') {
      if (targetDay < startDay) return;
      const endValue = value.start.includes('T') ? moveDateToDay({ start: value.end ?? value.start, timeZone: value.timeZone }, targetDay).start : targetDay;
      operations.push({ type: 'value.set', pageId: rowId, propertyId: dateProperty.id, value: { ...value, end: targetDay === startDay && !value.start.includes('T') ? undefined : endValue } });
    }
    if (operations.length) apply(operations).catch(report);
  };

  const startDrag = (event: React.PointerEvent, rowId: string, mode: 'move' | 'end') => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startX = event.clientX, startY = event.clientY;
    let active = false;
    let target: string | null = null;
    let last = { x: startX, y: startY };
    const locate = () => {
      const cell = (document.elementFromPoint(last.x, last.y) as HTMLElement | null)?.closest<HTMLElement>('[data-day]');
      if (cell) { target = cell.dataset.day!; setDrag({ rowId, day: target, mode }); }
    };
    // Held near the top or bottom, the page scrolls so later weeks can be reached.
    const auto = edgeScroller((event.currentTarget as HTMLElement).closest<HTMLElement>('.frame-scroller, .peek-scroller'), () => { if (active) locate(); });
    const moveHandler = (moveEvent: PointerEvent) => {
      if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
      active = true;
      last = { x: moveEvent.clientX, y: moveEvent.clientY };
      locate();
      auto.update(moveEvent.clientX, moveEvent.clientY);
    };
    const up = () => {
      auto.stop();
      window.removeEventListener('pointermove', moveHandler);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!active) { if (mode === 'move') openRow(view, rowId, ordered); return; }
      if (target) move(rowId, target, mode);
    };
    window.addEventListener('pointermove', moveHandler);
    window.addEventListener('pointerup', up);
  };

  const shift = (delta: number) => {
    if (weekMode) setAnchor(addDays(anchor, delta * 7));
    else { const date = new Date(`${anchor.slice(0, 7)}-01T00:00:00`); date.setMonth(date.getMonth() + delta); setAnchor(dayKey(date)); }
  };
  const create = (day: string) => newRow(result, sourceId, { values: { [dateProperty.id]: { start: day } } }).catch(report);

  // "날짜 없음 (n)" sits at the left of the database toolbar, in the header for inline databases.
  const undatedButton = result.presentation.undated?.length ? <button type="button" className="calendar-undated" onClick={event => setUndated(event.currentTarget)}>{t("날짜 없음 ({0})", [result.presentation.undated.length])}</button> : null;
  return (
    <div className="calendar-view">
      <div className="calendar-head">
        <div className="calendar-title">{formatYearMonth(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1))}</div>
        <span className="spacer" />
        {undatedButton && !toolbarSlot ? undatedButton : null}
        {undatedButton && toolbarSlot ? createPortal(undatedButton, toolbarSlot) : null}
        <button type="button" className="calendar-nav" aria-label={weekMode ? t("이전 주") : t("이전 달")} onClick={() => shift(-1)}><Icon name="chevron-left" size={20} /></button>
        <button type="button" className="calendar-today" onClick={() => setAnchor(today)}>{t("오늘")}</button>
        <button type="button" className="calendar-nav" aria-label={weekMode ? t("다음 주") : t("다음 달")} onClick={() => shift(1)}><Icon name="chevron-right" size={20} /></button>
      </div>
      <div className="calendar-weekdays">{weekdayLabels().map(day => <div key={day}>{day}</div>)}</div>
      <div className="calendar-grid" ref={gridRef}>
        {weeks.map(days => {
          const { placed, lanes } = layoutWeek(days, items);
          // Events stack 34 apart (28 high + 3 above and below).
          const height = Math.max(weekMode ? 480 : 124, 33 + lanes * 34 + 22);
          return (
            <div key={days[0]} className="calendar-week" style={{ height }}>
              {days.map((day, column) => {
                const date = new Date(`${day}T00:00:00`);
                const weekend = column === 0 || column === 6;
                const label = date.getDate() === 1 ? formatMonthDay(date) : String(date.getDate());
                return (
                  <div key={day} data-day={day} className={`calendar-day${weekend ? ' weekend' : ''}${day.slice(0, 7) !== month && !weekMode ? ' other-month' : ''}${drag?.day === day ? ' drop-target' : ''}`}
                    onDoubleClick={event => { if (event.target === event.currentTarget) create(day); }}>
                    <button type="button" className="calendar-add" aria-label={t("항목 추가")} onClick={() => create(day)}><Icon name="plus" size={16} /></button>
                    <span className={`calendar-date${day === today ? ' today' : ''}`}>{label}</span>
                  </div>
                );
              })}
              {placed.map(item => {
                const row = index.get(item.rowId);
                if (!row) return null;
                const fields = properties.map(property => ({ property, value: row.values[property.id] })).filter(({ property, value }) => property.type === 'checkbox' ? value === true : !(value == null || value === '' || (Array.isArray(value) && !value.length)));
                return (
                  <div key={`${item.rowId}-${days[0]}`} className={`calendar-event${(row as QueryRow).colors?.row ? ` cc-${(row as QueryRow).colors!.row}` : ''}${drag?.rowId === item.rowId ? ' dragging' : ''}${item.continuesBefore ? ' cont-before' : ''}${item.continuesAfter ? ' cont-after' : ''}`}
                    style={{ left: `calc(${(item.startCol / 7) * 100}% + 6px)`, width: `calc(${(item.span / 7) * 100}% - 12px)`, top: 33 + item.lane * 34 }}
                    onPointerDown={event => startDrag(event, item.rowId, 'move')} title={row.title}>
                    {workspace.get(row.id) && (workspace.get(row.id) as { icon?: string }).icon ? <EntityIcon item={workspace.get(row.id)} size={14} /> : null}
                    <span className="calendar-event-title">{row.title || t("제목 없음")}</span>
                    {fields.slice(0, 2).map(({ property, value }) => <span key={property.id} className="calendar-event-field"><ValueView property={property as PropertyEntity} value={value} row={row as QueryRow} mode="card" /></span>)}
                    {!item.continuesAfter ? <span className="calendar-resize" onPointerDown={event => startDrag(event, item.rowId, 'end')} /> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {undated && result.presentation.undated ? (
        <Menu anchor={undated} placement="below-end" width={280} onClose={() => setUndated(null)} entries={result.presentation.undated.map(id => ({ label: index.get(id)?.title || t("제목 없음"), icon: 'page', onSelect: () => openRow(view, id, result.presentation.undated) }))} />
      ) : null}
    </div>
  );
}
