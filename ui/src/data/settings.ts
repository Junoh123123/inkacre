import { intlLocale, t } from '../i18n';
import { useSyncExternalStore } from 'react';
import { readLocal, storeLocal } from './api';

// Personal preferences from the settings window ("설정" under 계정), kept per browser: theme, Enter behaviour in comment
// boxes, week start, and which page opens when the app starts.
export type ThemePref = 'system' | 'light' | 'dark';
export type StartPage = 'last' | 'top' | 'library' | 'home';
/** trashAutoPurge: items in the trash for more than 30 days are purged when the app opens (a 30-day trash). */
/** highContrast: stronger text, borders and focus (고대비); timeZone: null follows this device, else a zone name. */
export interface Settings { theme: ThemePref; enterNewLine: boolean; weekStartsMonday: boolean; startPage: StartPage; trashAutoPurge: boolean; highContrast: boolean; timeZone: string | null }

const key = 'pageyard-settings-v1';
const defaults: Settings = { theme: 'system', enterNewLine: false, weekStartsMonday: false, startPage: 'last', trashAutoPurge: false, highContrast: false, timeZone: null };
let current: Settings = { ...defaults, ...readLocal<Partial<Settings>>(key, {}) };
const listeners = new Set<() => void>();

export function getSettings() { return current; }
export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  storeLocal(key, JSON.stringify(current));
  applyTheme();
  listeners.forEach(listener => listener());
}
export function useSettings() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => current);
}

// Light or dark on <html data-theme>; "시스템 설정 사용" follows the OS and its changes.
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
export function resolvedTheme(): 'light' | 'dark' {
  if (current.theme === 'system') return media?.matches ? 'dark' : 'light';
  return current.theme;
}
export function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  if (current.highContrast) document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast;
}
// The time zone times are shown and entered in: the one chosen in 설정, or this device's.
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export function displayTimeZone(): string {
  const zone = current.timeZone;
  if (!zone) return deviceTimeZone();
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return zone; } catch { return deviceTimeZone(); }
}
media?.addEventListener('change', () => { if (current.theme === 'system') { applyTheme(); listeners.forEach(listener => listener()); } });

// Week grids (calendar view, date picker) start on Sunday, or Monday when chosen.
export function weekdayLabels(): string[] {
  // Short weekday names in the interface language (2023-01-01 was a Sunday).
  const format = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' });
  const days = Array.from({ length: 7 }, (_, index) => format.format(new Date(2023, 0, 1 + index)));
  return current.weekStartsMonday ? [...days.slice(1), days[0]] : days;
}
export function weekOffset(date: Date): number {
  return current.weekStartsMonday ? (date.getDay() + 6) % 7 : date.getDay();
}

// Comment boxes: Enter sends, Shift+Enter breaks the line — or, with "Enter 키로 줄 바꾸기" on,
// Enter breaks the line and ⌘/Ctrl+Enter sends (입력 옵션).
export function isSendKey(event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
  if (event.key !== 'Enter') return false;
  if (current.enterNewLine) return event.metaKey || event.ctrlKey;
  return !event.shiftKey;
}
