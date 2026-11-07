import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readLocal, storeLocal } from '../data/api';
import { navigate, openAppPage } from '../data/router';
import { useWorkspace } from '../data/store';
import { Icon } from '../ui/Icon';
import { buildGraph, stepLayout, type GraphEdge, type GraphNode, type GraphOptions } from './graphData';

// 연결 지도 (/?graph=1, or around one page: &focus=<id>): every page as a point, coloured by the top-level page it
// sits under, and the lines between them — links and mentions, relations between rows, subpages. Drag to move
// around, scroll to zoom, drag a point to pull it, click to open the page.
const optionsKey = 'pageyard-graph-options';
const palette = ['#2383e2', '#d9730d', '#0f7b6c', '#9065b0', '#c14c8a', '#cb912f', '#448361', '#e03e3e', '#337ea9', '#9f6b53'];
interface View { x: number; y: number; scale: number }
const radius = (node: GraphNode) => (node.row ? 3 : 4) + Math.min(9, Math.sqrt(node.degree) * 1.8);

export function GraphPage({ focus }: { focus: string | null }) {
  const ws = useWorkspace();
  const [options, setOptions] = useState<GraphOptions>(() => ({ children: true, rows: false, orphans: true, depth: 1, ...readLocal<Partial<GraphOptions>>(optionsKey, {}), focus }));
  useEffect(() => setOptions(current => ({ ...current, focus })), [focus]);
  const change = (patch: Partial<GraphOptions>) => setOptions(current => { const next = { ...current, ...patch }, kept: Partial<GraphOptions> = { ...next }; delete kept.focus; storeLocal(optionsKey, JSON.stringify(kept)); return next; });
  const graph = useMemo(() => buildGraph(ws.snapshot.objects, id => ws.visible(id), options), [ws.revision, ws.snapshot, options]);
  const groups = useMemo(() => { const order = [...new Set(graph.nodes.map(node => node.group))]; return new Map(order.map((id, i) => [id, palette[i % palette.length]])); }, [graph]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sim = useRef<{ nodes: GraphNode[]; edges: GraphEdge[]; alpha: number; view: View; hover: string | null; found: string | null; fitted: boolean; frame: number }>({ nodes: [], edges: [], alpha: 1, view: { x: 0, y: 0, scale: 1 }, hover: null, found: null, fitted: false, frame: 0 });
  const [query, setQuery] = useState('');
  const [hoverTitle, setHoverTitle] = useState<{ title: string; x: number; y: number } | null>(null);

  // The drawing: lines first, then points, then names (always for the hovered page and its neighbours, the page in
  // the middle and well-linked pages; for all when zoomed in).
  const draw = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const context = canvas.getContext('2d'); if (!context) return;
    const ratio = window.devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    const style = getComputedStyle(canvas), color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const text = color('--text', '#2c2c2b'), soft = color('--text-tertiary', '#9b9a97'), line = color('--border-strong', '#d9d9d6'), background = color('--bg', '#fff');
    const { nodes, edges, view, hover, found } = sim.current, index = new Map(nodes.map(node => [node.id, node]));
    const near = new Set<string>();
    const lit = hover ?? found;
    if (lit) { near.add(lit); for (const edge of edges) { if (edge.a === lit) near.add(edge.b); if (edge.b === lit) near.add(edge.a); } }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.translate(width / 2 + view.x, height / 2 + view.y); context.scale(view.scale, view.scale);
    for (const edge of edges) {
      const a = index.get(edge.a), b = index.get(edge.b); if (!a || !b) continue;
      const on = !lit || (near.has(edge.a) && near.has(edge.b) && (edge.a === lit || edge.b === lit));
      context.globalAlpha = on ? (edge.kind === 'child' ? 0.55 : 0.8) : 0.12;
      context.strokeStyle = edge.kind === 'child' ? line : edge.kind === 'relation' ? (groups.get(a.group) ?? soft) : soft;
      context.lineWidth = (edge.kind === 'child' ? 1 : 1.3) / view.scale;
      context.setLineDash(edge.kind === 'relation' ? [4 / view.scale, 3 / view.scale] : []);
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    }
    context.setLineDash([]);
    for (const node of nodes) {
      const on = !lit || near.has(node.id), r = radius(node);
      context.globalAlpha = on ? 1 : 0.25;
      context.fillStyle = groups.get(node.group) ?? soft;
      context.beginPath();
      if (node.row) context.rect(node.x - r * 0.85, node.y - r * 0.85, r * 1.7, r * 1.7); else context.arc(node.x, node.y, r, 0, Math.PI * 2);
      context.fill();
      if (node.id === options.focus || node.id === lit) { context.lineWidth = 2 / view.scale; context.strokeStyle = text; context.stroke(); }
    }
    const fontSize = 12 / Math.max(view.scale, 0.6);
    context.font = `${fontSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textAlign = 'center'; context.textBaseline = 'top';
    context.lineJoin = 'round';
    for (const node of nodes) {
      const show = view.scale >= 1.1 || near.has(node.id) || node.id === options.focus || node.degree >= 5 && view.scale >= 0.6;
      if (!show) continue;
      const on = !lit || near.has(node.id), label = (node.title || t("새 페이지")).slice(0, 40);
      context.globalAlpha = on ? 1 : 0.3;
      context.lineWidth = 3 / view.scale; context.strokeStyle = background; context.strokeText(label, node.x, node.y + radius(node) + 3 / view.scale);
      context.fillStyle = text; context.fillText(label, node.x, node.y + radius(node) + 3 / view.scale);
    }
    context.globalAlpha = 1;
  };
  // Where each point is on screen, on the page list kept for the keyboard and screen readers.
  const place = () => {
    const canvas = canvasRef.current, list = listRef.current; if (!canvas || !list) return;
    const { nodes, view } = sim.current, box = canvas.getBoundingClientRect();
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const item of Array.from(list.querySelectorAll<HTMLElement>('[data-id]'))) {
      const node = byId.get(item.dataset.id!); if (!node) continue;
      item.dataset.x = String(Math.round(box.left + box.width / 2 + view.x + node.x * view.scale));
      item.dataset.y = String(Math.round(box.top + box.height / 2 + view.y + node.y * view.scale));
    }
  };
  const fit = () => {
    const canvas = canvasRef.current, { nodes } = sim.current; if (!canvas || !nodes.length) return;
    const xs = nodes.map(node => node.x), ys = nodes.map(node => node.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min(1.6, Math.max(0.2, Math.min((canvas.clientWidth - 120) / Math.max(maxX - minX, 1), (canvas.clientHeight - 120) / Math.max(maxY - minY, 1))));
    sim.current.view = { scale, x: -(minX + maxX) / 2 * scale, y: -(minY + maxY) / 2 * scale };
  };
  const run = () => {
    cancelAnimationFrame(sim.current.frame);
    const tick = () => {
      const state = sim.current;
      for (let i = 0; i < 2; i++) { stepLayout(state.nodes, state.edges, state.alpha); state.alpha *= 0.985; }
      if (!state.fitted && state.alpha < 0.35) { fit(); state.fitted = true; }
      draw();
      if (state.alpha > 0.01) state.frame = requestAnimationFrame(tick); else { if (!state.fitted) { fit(); state.fitted = true; draw(); } place(); }
    };
    sim.current.frame = requestAnimationFrame(tick);
  };
  // The pointer handlers (attached once) always call this render's drawing.
  const latest = useRef({ draw, place, fit, run });
  latest.current = { draw, place, fit, run };
  // A new picture keeps where known pages already were, and settles again.
  useEffect(() => {
    const before = new Map(sim.current.nodes.map(node => [node.id, node]));
    const nodes = graph.nodes.map(node => { const old = before.get(node.id); return old ? { ...node, x: old.x, y: old.y } : node; });
    const settled = before.size > 0 && nodes.every(node => before.has(node.id));
    sim.current = { ...sim.current, nodes, edges: graph.edges, alpha: settled ? 0.3 : 1, fitted: settled && sim.current.fitted };
    // Small maps settle before they are shown; larger ones settle in view.
    if (!settled && nodes.length <= 400) { for (let i = 0; i < 160; i++) { stepLayout(nodes, graph.edges, sim.current.alpha); sim.current.alpha *= 0.985; } fit(); sim.current.fitted = true; }
    run();
    return () => cancelAnimationFrame(sim.current.frame);
  }, [graph]);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const observer = new ResizeObserver(() => { latest.current.draw(); latest.current.place(); });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Pointer: drag the background to move, drag a point to pull it, click a point to open it; wheel zooms.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const world = (event: { clientX: number; clientY: number }) => {
      const box = canvas.getBoundingClientRect(), { view } = sim.current;
      return { x: (event.clientX - box.left - box.width / 2 - view.x) / view.scale, y: (event.clientY - box.top - box.height / 2 - view.y) / view.scale };
    };
    const hit = (event: { clientX: number; clientY: number }) => {
      const point = world(event); let best: GraphNode | null = null, distance = Infinity;
      for (const node of sim.current.nodes) { const d = Math.hypot(node.x - point.x, node.y - point.y); if (d < radius(node) + 6 / sim.current.view.scale && d < distance) { best = node; distance = d; } }
      return best;
    };
    let drag: { node: GraphNode | null; startX: number; startY: number; viewX: number; viewY: number; moved: boolean } | null = null;
    const down = (event: PointerEvent) => {
      const node = hit(event);
      drag = { node, startX: event.clientX, startY: event.clientY, viewX: sim.current.view.x, viewY: sim.current.view.y, moved: false };
      if (node) node.fixed = true;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag) {
        const node = hit(event), id = node?.id ?? null;
        canvas.style.cursor = node ? 'pointer' : 'grab';
        if (id !== sim.current.hover) { sim.current.hover = id; latest.current.draw(); }
        const box = canvas.getBoundingClientRect();
        setHoverTitle(node ? { title: node.title || t("새 페이지"), x: event.clientX - box.left, y: event.clientY - box.top } : null);
        return;
      }
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
      if (drag.node) { const point = world(event); drag.node.x = point.x; drag.node.y = point.y; if (sim.current.alpha < 0.2) { sim.current.alpha = 0.2; latest.current.run(); } else latest.current.draw(); }
      else { sim.current.view.x = drag.viewX + event.clientX - drag.startX; sim.current.view.y = drag.viewY + event.clientY - drag.startY; canvas.style.cursor = 'grabbing'; latest.current.draw(); }
    };
    const up = () => {
      if (!drag) return;
      const { node, moved } = drag; drag = null;
      if (node) { node.fixed = false; if (!moved) navigate(node.id); }
      latest.current.place();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = canvas.getBoundingClientRect(), view = sim.current.view;
      const before = view.scale, next = Math.min(4, Math.max(0.15, before * Math.exp(-event.deltaY * 0.0015)));
      const cx = event.clientX - box.left - box.width / 2, cy = event.clientY - box.top - box.height / 2;
      view.x = cx - (cx - view.x) * next / before; view.y = cy - (cy - view.y) * next / before; view.scale = next;
      latest.current.draw(); latest.current.place();
    };
    const leave = () => { if (!drag && sim.current.hover) { sim.current.hover = null; setHoverTitle(null); latest.current.draw(); } };
    const double = (event: MouseEvent) => { if (!hit(event)) { latest.current.fit(); latest.current.draw(); latest.current.place(); } };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('dblclick', double);
    return () => {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('dblclick', double);
    };
  }, []);

  // 페이지 찾기: the first page whose title has the words, brought to the middle and lit.
  const find = (text: string) => {
    const needle = text.trim().toLocaleLowerCase();
    const node = needle ? sim.current.nodes.find(item => (item.title || '').toLocaleLowerCase().includes(needle)) : null;
    sim.current.found = node?.id ?? null;
    if (node) { const view = sim.current.view; view.scale = Math.max(view.scale, 1.2); view.x = -node.x * view.scale; view.y = -node.y * view.scale; }
    draw(); place();
  };
  const focusPage = options.focus ? ws.get(options.focus) : null;
  const links = graph.edges.filter(edge => edge.kind !== 'child').length;
  const chip = (key: 'children' | 'rows' | 'orphans', label: string, icon: string) => (
    <button type="button" className={`filter-chip${options[key] ? ' active' : ''}`} aria-pressed={options[key]} data-option={key} onClick={() => change({ [key]: !options[key] })}><Icon name={icon} size={16} />{label}</button>
  );
  return (
    <div className="graph-page">
      <div className="graph-tools">
        <h1 className="graph-title"><Icon name="graph" size={22} />{t("연결 지도")}</h1>
        <span className="graph-count">{t("페이지 {0}개 · 연결 {1}개", [graph.nodes.length, links])}</span>
        {focusPage ? (
          <span className="graph-focus">
            <span className="graph-focus-label">{t("중심: {0}", [ws.title(focusPage) || t("새 페이지")])}</span>
            <select className="graph-depth" value={options.depth} aria-label={t("몇 단계까지")} onChange={event => change({ depth: Number(event.target.value) })}>
              {[1, 2, 3].map(depth => <option key={depth} value={depth}>{t("{0}단계", [depth])}</option>)}
            </select>
            <button type="button" className="icon-button small" aria-label={t("전체 보기")} title={t("전체 보기")} onClick={() => openAppPage('graph')}><Icon name="close" size={14} /></button>
          </span>
        ) : null}
        <span className="graph-gap" />
        {chip('children', t("하위 페이지"), 'page')}
        {chip('rows', t("데이터베이스 행"), 'database')}
        {chip('orphans', t("연결 없는 페이지"), 'eye')}
        <input className="graph-search" value={query} placeholder={t("페이지 찾기")} aria-label={t("페이지 찾기")} onChange={event => { setQuery(event.target.value); find(event.target.value); }} />
      </div>
      <div className="graph-stage">
        <canvas ref={canvasRef} className="graph-canvas" aria-label={t("연결 지도")} role="img" />
        {hoverTitle ? <div className="graph-tip" style={{ left: hoverTitle.x + 12, top: hoverTitle.y + 12 }}>{hoverTitle.title}</div> : null}
        {!graph.nodes.length ? <p className="graph-empty">{options.focus ? t("이 페이지와 연결된 페이지가 없습니다.") : t("아직 연결된 페이지가 없습니다. 페이지에서 @로 다른 페이지를 멘션하면 선이 생깁니다.")}</p> : null}
        <div className="graph-legend" aria-hidden="true">
          <span><i className="graph-line link" />{t("링크·멘션")}</span>
          <span><i className="graph-line relation" />{t("관계")}</span>
          {options.children ? <span><i className="graph-line child" />{t("하위 페이지")}</span> : null}
        </div>
        <ul className="graph-list" ref={listRef} aria-label={t("지도에 있는 페이지")}>
          {graph.nodes.map(node => <li key={node.id}><button type="button" data-id={node.id} data-degree={node.degree} onClick={() => navigate(node.id)}>{node.title || t("새 페이지")}</button></li>)}
        </ul>
      </div>
    </div>
  );
}
