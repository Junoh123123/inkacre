import { t, translateServerMessage } from '../i18n';
import { pastRoute } from './timeMachine';
// HTTP access to the local loopback service. Read requests fall back to the
// Cache API copy (shared with /classic), so a visited
// revision stays readable while the service is briefly unavailable.

export class ApiError extends Error {
  code?: string;
  details?: unknown;
  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const readRoutes = new Set(['/api/query', '/api/search', '/api/tasks', '/api/export', '/api/import/preview']);
let connected = true;
export const isConnected = () => connected;

async function cacheKey(route: string, body: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([route, body ?? null])));
  return `/__cached_read__/${[...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export async function api<T = any>(route: string, body?: unknown, knownRevision?: number): Promise<T> {
  const readOnly = body === undefined || readRoutes.has(route);
  let cache: Cache | undefined;
  let key: string | undefined;
  if (readOnly && 'caches' in window) {
    try {
      key = await cacheKey(route, body);
      cache = await caches.open('pageyard-reads-v1');
    } catch {
      cache = undefined;
    }
  }
  try {
    const response = await fetch(pastRoute(route), body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.error?.message ? translateServerMessage(data.error.message) : t("요청을 처리하지 못했습니다."), data.error?.code, data.error?.details);
    connected = true;
    if (cache && key) {
      try { await cache.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })); } catch { /* storage full */ }
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    connected = false;
    const response = cache && key ? await cache.match(key) : undefined;
    if (response) {
      const cached = await response.json();
      if (route === '/api/state' || cached.revision === undefined || cached.revision === knownRevision) return cached as T;
      throw new ApiError(t("이 화면의 저장 사본이 현재 자료보다 오래됐습니다. 앱에 다시 연결한 뒤 열어 주세요."));
    }
    throw error;
  }
}

export function storeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    localStorage.removeItem('pageyard-last-state-v1');
    try { localStorage.setItem(key, value); } catch { /* give up quietly */ }
  }
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
