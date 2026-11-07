import { t as tr } from '../i18n';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { report, workspace } from '../data/store';
import { apply, newId } from '../data/commands';
import type { PageEntity, QueryResult, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/overlay';
import { EntityIcon } from '../page/EntityIcon';
import { ToolbarSlot, openRow, rowIndex } from './shared';
import type { ViewProps } from './TableView';

// Map view: a 600-high map across the view (r6): land rgb(250,250,249),
// sea rgb(190,229,249), borders rgb(197,184,199), country names in capitals 11px rgb(92,92,112); with no pins it
// shows the United States. Pages with a place are pinned on it. At the top right a 28-square white button
// (r6, light shadow) turns on "핀 추가" — the next press on the map adds a page there — and becomes ×.
// Pages without a place are behind the toolbar button "지도 보기에 위치 없음(N)" (28 high, 14px #8e8b86): a
// 320-wide list with a search field. The base map is Natural Earth (ui/public/world-50m.json), Web Mercator.
type World = { size: number; land: string; borders: string; labels?: Array<{ name: string; x: number; y: number; area: number }> };
let worldPromise: Promise<World> | null = null;
const loadWorld = () => (worldPromise ??= fetch('/app/world-50m.json').then(response => { if (!response.ok) throw new Error(tr("지도를 불러오지 못했습니다.")); return response.json() as Promise<World>; }));

const MAXLAT = 85.05112878;
const mercator = (longitude: number, latitude: number) => {
  const phi = (Math.max(-MAXLAT, Math.min(MAXLAT, latitude)) * Math.PI) / 180;
  return { x: (longitude + 180) / 360, y: (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2 };
};
const HEIGHT = 600;
// The base map is a 1:50m outline, so zooming stops where it would only show its corners.
const MAX_SCALE = 4096 * 24;

type Camera = { x: number; y: number; scale: number };

// Without pins the map shows the United States, framed by the canvas width: a
// 540-wide canvas at 9720 px per world width around (−98.5°, 39°), a 1026-wide one at 5749 around (−100.1°, 39.9°).
// Widths in between are interpolated; beyond them the nearer framing is kept.
function home(width: number): Camera {
  const t = Math.min(1, Math.max(0, (width - 540) / (1026 - 540)));
  const a = mercator(-98.5, 39), b = mercator(-100.1, 39.9);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, scale: 9720 + (5749 - 9720) * t };
}
function fit(points: Array<{ x: number; y: number }>, width: number): Camera {
  if (!points.length) return home(width);
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, (maxY - minY) * (width / HEIGHT), 1e-6);
  const scale = points.length === 1 ? width * 12 : Math.max(width, (width * 0.7) / span);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale: Math.min(scale, width * 12, MAX_SCALE) };
}

export function MapView({ result, view, sourceId }: ViewProps) {
  const toolbarSlot = useContext(ToolbarSlot);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [world, setWorld] = useState<World | null>(null);
  const [failed, setFailed] = useState(false);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [unlocatedMenu, setUnlocatedMenu] = useState<Element | null>(null);
  const [adding, setAdding] = useState(false);
  const index = useMemo(() => rowIndex(result), [result]);
  const points = (result.presentation.points ?? []).filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)).map(point => ({ ...point, ...mercator(point.longitude!, point.latitude!) }));
  const unlocated = result.presentation.unlocated ?? [];
  const ordered = points.map(point => point.rowId);
  useEffect(() => { loadWorld().then(setWorld).catch(() => setFailed(true)); }, []);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => setWidth(Math.floor(box.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (width && !camera) setCamera(fit(points, width)); }, [width]);
  const cam = camera ?? fit(points, width || 1000);
  const minScale = Math.max(width, 256);
  const clampY = (y: number, scale: number) => { const half = HEIGHT / 2 / scale; return half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, y)); };
  const set = (next: Camera) => { const scale = Math.min(MAX_SCALE, Math.max(minScale, next.scale)); setCamera({ x: ((next.x % 1) + 1) % 1, y: clampY(next.y, scale), scale }); };
  const zoomAt = (factor: number, sx = width / 2, sy = HEIGHT / 2) => {
    const scale = Math.min(MAX_SCALE, Math.max(minScale, cam.scale * factor));
    const wx = cam.x + (sx - width / 2) / cam.scale, wy = cam.y + (sy - HEIGHT / 2) / cam.scale;
    set({ x: wx - (sx - width / 2) / scale, y: wy - (sy - HEIGHT / 2) / scale, scale });
  };
  const onWheel = (event: React.WheelEvent) => {
    const rect = boxRef.current!.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), event.clientX - rect.left, event.clientY - rect.top);
  };
  useEffect(() => {
    // React's wheel listener is passive; stop the page scrolling while the pointer is over the map.
    const box = boxRef.current;
    if (!box) return;
    const stop = (event: WheelEvent) => event.preventDefault();
    box.addEventListener('wheel', stop, { passive: false });
    return () => box.removeEventListener('wheel', stop);
  }, []);
  const placeAt = (clientX: number, clientY: number) => {
    const rect = boxRef.current!.getBoundingClientRect();
    const wx = cam.x + (clientX - rect.left - width / 2) / cam.scale, wy = cam.y + (clientY - rect.top - HEIGHT / 2) / cam.scale;
    const longitude = (((wx % 1) + 1) % 1) * 360 - 180;
    const latitude = (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI;
    setAdding(false);
    const placeId = view?.config.placePropertyId ?? result.properties.find(item => item.type === 'place')?.id;
    if (!placeId) return;
    const id = newId();
    apply([{ type: 'page.create', id, sourceId, title: '' }, { type: 'value.set', pageId: id, propertyId: placeId, value: { name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) } }])
      .then(() => openRow(view, id)).catch(report);
  };
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    if (adding) { placeAt(event.clientX, event.clientY); return; }
    const start = { x: event.clientX, y: event.clientY, cam };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => set({ ...start.cam, x: start.cam.x - (moveEvent.clientX - start.x) / start.cam.scale, y: start.cam.y - (moveEvent.clientY - start.y) / start.cam.scale });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const k = cam.scale / (world?.size ?? 4096);
  const tx = width / 2 - cam.x * cam.scale, ty = HEIGHT / 2 - cam.y * cam.scale;
  const copies = [-1, 0, 1, 2].filter(copy => tx + copy * cam.scale < width && tx + (copy + 1) * cam.scale > 0);
  // A pin is drawn on the copy of the world nearest the middle of the map.
  const screen = (point: { x: number; y: number }) => {
    const sx = tx + point.x * cam.scale;
    return { x: sx + Math.round((width / 2 - sx) / cam.scale) * cam.scale, y: ty + point.y * cam.scale };
  };
  const unlocatedButton = (
    <button type="button" className="db-tool map-unlocated-button" onClick={event => setUnlocatedMenu(event.currentTarget)}>{tr("지도 보기에 위치 없음({0})", [unlocated.length])}</button>
  );
  return (
    <div className="map-view">
      {toolbarSlot && unlocated.length ? createPortal(unlocatedButton, toolbarSlot) : null}
      <div className={`map-canvas${adding ? ' adding' : ''}`} ref={boxRef} onWheel={onWheel} onPointerDown={onPointerDown} onDoubleClick={event => { const rect = boxRef.current!.getBoundingClientRect(); zoomAt(2, event.clientX - rect.left, event.clientY - rect.top); }}>
        {width ? (
          <svg width={width} height={HEIGHT} className="map-svg" aria-label={tr("지도")}>
            <rect width={width} height={HEIGHT} className="map-sea" />
            {world ? copies.map(copy => (
              <g key={copy} transform={`translate(${tx + copy * cam.scale} ${ty}) scale(${k})`}>
                <path d={world.land} className="map-land" />
                <path d={world.borders} className="map-border" vectorEffect="non-scaling-stroke" />
              </g>
            )) : null}
            {world ? <Labels world={world} k={k} tx={tx} ty={ty} copies={copies} scale={cam.scale} width={width} /> : null}
          </svg>
        ) : null}
        {width ? points.map(point => {
          const at = screen(point);
          if (at.x < -40 || at.x > width + 40 || at.y < -40 || at.y > HEIGHT + 40) return null;
          const page = workspace.get<PageEntity>(point.rowId);
          return (
            <button type="button" key={point.rowId} className={`map-pin${hover === point.rowId ? ' hover' : ''}`} style={{ left: at.x, top: at.y }} aria-label={index.get(point.rowId)?.title || point.name}
              onPointerEnter={() => setHover(point.rowId)} onPointerLeave={() => setHover(null)} onClick={() => openRow(view, point.rowId, ordered)}>
              <span className="map-pin-head">{view?.config.showPageIcon !== false && page?.icon ? <EntityIcon item={page} size={16} /> : <Icon name="page" size={16} />}</span>
              {hover === point.rowId ? <span className="map-pin-label">{index.get(point.rowId)?.title || point.name || tr("제목 없음")}</span> : null}
            </button>
          );
        }) : null}
        {failed ? <div className="map-failed">{tr("지도를 불러오지 못했습니다")}</div> : null}
        <div className="map-controls">
          <button type="button" className={`map-control${adding ? ' active' : ''}`} aria-label={adding ? tr("핀 추가 끝내기") : tr("핀 추가 모드 켜기")} title={adding ? tr("핀 추가 끝내기") : tr("핀 추가")} onClick={() => setAdding(!adding)}><Icon name={adding ? 'close' : 'map-pin'} size={adding ? 12 : 16} /></button>
        </div>
      </div>
      {!toolbarSlot && unlocated.length ? unlocatedButton : null}
      {unlocatedMenu ? <UnlocatedList anchor={unlocatedMenu} ids={unlocated} result={result} view={view} onClose={() => setUnlocatedMenu(null)} /> : null}
    </div>
  );
}

function UnlocatedList({ anchor, ids, result, view, onClose }: { anchor: Element; ids: string[]; result: QueryResult; view: ViewEntity | null; onClose: () => void }) {
  const index = rowIndex(result);
  const [query, setQuery] = useState('');
  const title = (id: string) => index.get(id)?.title || workspace.get<PageEntity>(id)?.title || '';
  const shown = ids.filter(id => !query.trim() || title(id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <Popover anchor={anchor} placement="below-start" offset={4} onClose={onClose} className="map-unlocated-menu" label={tr("위치 없음")} style={{ width: 320 }}>
      <div className="map-unlocated-search"><input autoFocus value={query} placeholder={tr("페이지 검색…")} aria-label={tr("페이지 검색")} onChange={event => setQuery(event.target.value)} /></div>
      <div className="map-unlocated-list">
        {shown.map(id => (
          <button type="button" key={id} className="menu-item" onClick={() => { onClose(); openRow(view, id, ids); }}>
            <span className="menu-item-icon"><EntityIcon item={workspace.get(id)} size={18} /></span>
            <span className="menu-item-label">{title(id) || tr("제목 없음")}</span>
          </button>
        ))}
        {!shown.length ? <div className="menu-empty">{tr("결과 없음")}</div> : null}
      </div>
    </Popover>
  );
}

// Country names: the larger countries first, each only where its name fits its shape and does not run into
// a name already placed.
function Labels({ world, k, tx, ty, copies, scale, width }: { world: World; k: number; tx: number; ty: number; copies: number[]; scale: number; width: number }) {
  const placed: Array<[number, number, number, number]> = [];
  const items: Array<{ key: string; x: number; y: number; name: string }> = [];
  for (const label of world.labels ?? []) {
    const w = label.name.length * 7.4 + 8;
    if (Math.sqrt(label.area) * k < w * 0.6) continue;
    for (const copy of copies) {
      const x = tx + copy * scale + label.x * k, y = ty + label.y * k;
      if (x < -w || x > width + w || y < -20 || y > HEIGHT + 20) continue;
      const box: [number, number, number, number] = [x - w / 2, y - 9, x + w / 2, y + 9];
      if (placed.some(other => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) continue;
      placed.push(box);
      items.push({ key: `${label.name}-${copy}`, x, y, name: label.name });
    }
    if (items.length > 60) break;
  }
  return <g className="map-labels">{items.map(item => <text key={item.key} x={item.x} y={item.y} dy="0.35em" textAnchor="middle" className="map-label">{item.name}</text>)}</g>;
}
