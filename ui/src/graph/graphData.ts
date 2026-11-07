import type { Entity, PageEntity } from '../data/types';

// 연결 지도: pages as points, and the lines between them — a link or mention in a page's text (link to page blocks
// too), a relation between database rows, and (when shown) a subpage under its page. Built from the workspace in
// memory, so the time machine shows the map as it was.
export type EdgeKind = 'link' | 'relation' | 'child';
export interface GraphNode { id: string; title: string; icon: string | null; group: string; row: boolean; degree: number; x: number; y: number; vx: number; vy: number; fixed?: boolean }
export interface GraphEdge { a: string; b: string; kind: EdgeKind }
export interface GraphOptions { children: boolean; rows: boolean; orphans: boolean; focus: string | null; depth: number }

interface RunLike { pageId?: string }
const runs = (value: unknown): RunLike[] => Array.isArray(value) ? value.flatMap(item => Array.isArray(item) ? runs(item) : item && typeof item === 'object' ? [item as RunLike] : []) : [];

// A stable place to start from, so the same workspace settles into the same picture.
function seed(id: string) { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

export function buildGraph(objects: Entity[], visible: (id: string) => boolean, options: GraphOptions) {
  const byId = new Map(objects.map(item => [item.id, item]));
  const pages = objects.filter(item => item.kind === 'page' && item.alive !== false && !(item as PageEntity).template && visible(item.id)) as PageEntity[];
  const pageIds = new Set(pages.map(page => page.id));
  // The page an object sits in (a block's page, a database's page, a row's database page).
  const owner = (id: string | null | undefined, skipSelf = false): string | null => {
    let item = id ? byId.get(id) : undefined, guard = 0;
    if (skipSelf && item) item = item.parentId ? byId.get(item.parentId) : undefined;
    while (item && item.kind !== 'page' && guard++ < 200) item = item.parentId ? byId.get(item.parentId) : undefined;
    return item && pageIds.has(item.id) ? item.id : null;
  };
  const top = new Map<string, string>();
  const group = (id: string): string => {
    if (top.has(id)) return top.get(id)!;
    let current = id, guard = 0;
    for (let parent = owner(id, true); parent && guard++ < 200; parent = owner(parent, true)) current = parent;
    top.set(id, current); return current;
  };
  const edges = new Map<string, GraphEdge>(), rank: Record<EdgeKind, number> = { link: 3, relation: 2, child: 1 };
  const connect = (a: string | null, b: string | null, kind: EdgeKind) => {
    if (!a || !b || a === b || !pageIds.has(a) || !pageIds.has(b)) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`, before = edges.get(key);
    if (!before || rank[kind] > rank[before.kind]) edges.set(key, { a, b, kind });
  };
  for (const item of objects) {
    if (item.alive === false || !visible(item.id)) continue;
    if (item.kind === 'block') {
      const from = owner(item.id);
      for (const run of [...runs((item as { richText?: unknown }).richText), ...runs((item as { cells?: unknown }).cells)]) if (run.pageId) connect(from, run.pageId, 'link');
    } else if (item.kind === 'page' && pageIds.has(item.id)) {
      const page = item as PageEntity;
      for (const value of Object.values(page.values ?? {})) {
        if (!Array.isArray(value)) continue;
        // A relation's targets are ids; text values with mentions are runs.
        if (value.every(entry => typeof entry === 'string')) for (const target of value as string[]) { if (byId.get(target)?.kind === 'page') connect(page.id, target, 'relation'); }
        else for (const run of runs(value)) if (run.pageId) connect(page.id, run.pageId, 'link');
      }
      if (options.children) connect(owner(page.id, true), page.id, 'child');
    }
  }
  // Database rows only when asked; then only rows with a line to something other than their own database.
  let kept = pages.filter(page => options.rows || !page.sourceId);
  let keptIds = new Set(kept.map(page => page.id));
  let list = [...edges.values()].filter(edge => (options.children || edge.kind !== 'child') && keptIds.has(edge.a) && keptIds.has(edge.b));
  if (options.rows) {
    const linked = new Set(list.filter(edge => edge.kind !== 'child').flatMap(edge => [edge.a, edge.b]));
    kept = kept.filter(page => !page.sourceId || linked.has(page.id));
    keptIds = new Set(kept.map(page => page.id));
    list = list.filter(edge => keptIds.has(edge.a) && keptIds.has(edge.b));
  }
  // Around one page: what is within the chosen number of steps.
  if (options.focus && keptIds.has(options.focus)) {
    const near = new Set([options.focus]);
    for (let step = 0; step < options.depth; step++) for (const edge of list) { if (near.has(edge.a)) near.add(edge.b); else if (near.has(edge.b)) near.add(edge.a); }
    kept = kept.filter(page => near.has(page.id));
    keptIds = near;
    list = list.filter(edge => near.has(edge.a) && near.has(edge.b));
  }
  const degree = new Map<string, number>();
  for (const edge of list) { degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1); degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1); }
  if (!options.orphans) kept = kept.filter(page => degree.has(page.id) || page.id === options.focus);
  const radius = 40 * Math.sqrt(kept.length + 1);
  const nodes: GraphNode[] = kept.map(page => {
    const angle = seed(page.id) * Math.PI * 2, distance = radius * Math.sqrt(seed(`${page.id}:r`));
    return { id: page.id, title: page.title, icon: page.icon ?? null, group: group(page.id), row: !!page.sourceId, degree: degree.get(page.id) ?? 0, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, vx: 0, vy: 0 };
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  return { nodes, edges: list.filter(edge => nodeIds.has(edge.a) && nodeIds.has(edge.b)) };
}

// One step of the layout: nearby points push apart (a grid finds the neighbours, so it stays fast with many pages),
// lines pull their ends together, and everything drifts gently to the middle. Returns how much moved.
export function stepLayout(nodes: GraphNode[], edges: GraphEdge[], alpha: number) {
  const index = new Map(nodes.map(node => [node.id, node]));
  const cell = 120, grid = new Map<string, GraphNode[]>();
  for (const node of nodes) { const key = `${Math.floor(node.x / cell)},${Math.floor(node.y / cell)}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(node); }
  for (const node of nodes) {
    const cx = Math.floor(node.x / cell), cy = Math.floor(node.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (other === node) continue;
        let x = node.x - other.x, y = node.y - other.y, d2 = x * x + y * y;
        if (d2 > cell * cell) continue;
        if (d2 < 0.01) { x = seed(node.id) - 0.5; y = seed(other.id) - 0.5; d2 = x * x + y * y + 0.01; }
        const force = 900 * alpha / d2;
        node.vx += x * force; node.vy += y * force;
      }
    }
  }
  for (const edge of edges) {
    const a = index.get(edge.a)!, b = index.get(edge.b)!;
    const x = b.x - a.x, y = b.y - a.y, d = Math.sqrt(x * x + y * y) || 1;
    const rest = edge.kind === 'child' ? 70 : 90, pull = (d - rest) / d * 0.06 * alpha * (edge.kind === 'child' ? 0.6 : 1);
    a.vx += x * pull; a.vy += y * pull; b.vx -= x * pull; b.vy -= y * pull;
  }
  let moved = 0;
  for (const node of nodes) {
    node.vx -= node.x * 0.004 * alpha; node.vy -= node.y * 0.004 * alpha;
    if (node.fixed) { node.vx = 0; node.vy = 0; continue; }
    node.vx *= 0.6; node.vy *= 0.6;
    const speed = Math.hypot(node.vx, node.vy);
    if (speed > 30) { node.vx *= 30 / speed; node.vy *= 30 / speed; }
    node.x += node.vx; node.y += node.vy; moved += Math.abs(node.vx) + Math.abs(node.vy);
  }
  return moved / Math.max(nodes.length, 1);
}
