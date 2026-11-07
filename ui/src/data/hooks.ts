import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useWorkspace } from './store';
import type { CommentEntity, Entity, PageEntity, QueryResult, QueryRow } from './types';

// Server reads that depend on the workspace revision (computed values, queries).
// They refetch when the snapshot changes and keep the last result while loading.

export interface PageDetail {
  revision: number;
  entity: PageEntity & {
    visible: boolean;
    computed?: Record<string, unknown>;
    relationDisplay?: QueryRow['relationDisplay'];
    task?: QueryRow['task'];
    children?: Entity[];
    comments?: CommentEntity[];
    backlinks?: Array<{ id: string; title: string; icon?: string | null }>;
  };
}

export function usePageDetail(id: string | null): { detail: PageDetail | null; error: string | null } {
  const ws = useWorkspace();
  const [state, setState] = useState<{ detail: PageDetail | null; error: string | null; id: string | null }>({ detail: null, error: null, id: null });
  const generation = useRef(0);
  useEffect(() => {
    if (!id) return;
    const current = ++generation.current;
    const timer = window.setTimeout(() => {
      api<PageDetail>(`/api/objects/${encodeURIComponent(id)}`)
        .then(detail => { if (current === generation.current) setState({ detail, error: null, id }); })
        .catch(error => { if (current === generation.current) setState(previous => ({ detail: previous.id === id ? previous.detail : null, error: error instanceof Error ? error.message : String(error), id })); });
    }, state.id === id ? 60 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ws.version]);
  return { detail: state.id === id ? state.detail : null, error: state.id === id ? state.error : null };
}

export interface QueryInput { viewId?: string | null; sourceId?: string; search?: string; limit?: number; filter?: unknown }

export function useQuery(input: QueryInput | null): { result: QueryResult | null; error: string | null; loading: boolean } {
  const ws = useWorkspace();
  const key = input ? JSON.stringify(input) : '';
  const [state, setState] = useState<{ key: string; result: QueryResult | null; error: string | null; loading: boolean }>({ key: '', result: null, error: null, loading: false });
  const generation = useRef(0);
  useEffect(() => {
    if (!input) return;
    const current = ++generation.current;
    setState(previous => ({ ...previous, loading: true }));
    const timer = window.setTimeout(() => {
      api<QueryResult>('/api/query', { ...input, limit: input.limit ?? 200 })
        .then(result => { if (current === generation.current) setState({ key, result, error: null, loading: false }); })
        .catch(error => { if (current === generation.current) setState(previous => ({ key, result: previous.key === key ? previous.result : null, error: error instanceof Error ? error.message : String(error), loading: false })); });
    }, state.key === key ? 40 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ws.version]);
  const same = state.key === key;
  return { result: same ? state.result : null, error: same ? state.error : null, loading: !same || state.loading };
}

// Per-viewer UI preferences that the engine does not store (column widths, wrap).
export function useLocalPreference<T>(key: string, initial: T): [T, (value: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : initial; } catch { return initial; }
  });
  useEffect(() => {
    try { const raw = localStorage.getItem(key); setValue(raw ? JSON.parse(raw) as T : initial); } catch { setValue(initial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = (next: T | ((previous: T) => T)) => setValue(previous => {
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
    try { localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* storage unavailable */ }
    return resolved;
  });
  return [value, update];
}
