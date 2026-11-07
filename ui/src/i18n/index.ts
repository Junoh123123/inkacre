import { createElement, Fragment, type ReactNode } from 'react';
import { keys, languages, values } from 'virtual:locales';

// Interface language. Messages are keyed by the Korean source text (the app was written in Korean), sometimes after a
// context tag ("status-group|완료"); every
// ui/src/i18n/locales/<code>.json maps those keys to its language, with "{0}"-style placeholders for values.
// The language is chosen once at start-up — a change reloads the page — so labels built at module load are fine.
// Missing translations fall back to English, then to the Korean source.

export interface Language { code: string; name: string; english: string; intl: string }

const STORAGE = 'pageyard-language';
export const LANGUAGES: Language[] = [...(languages as Language[])].sort((a, b) => order(a.code) - order(b.code));
function order(code: string) { const index = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt-BR'].indexOf(code); return index < 0 ? 100 : index; }

function readStored(): string | null { try { return localStorage.getItem(STORAGE); } catch { return null; } }
export function matchLanguage(tag: string): string | null {
  const lower = tag.toLowerCase();
  const exact = LANGUAGES.find(language => language.code.toLowerCase() === lower);
  if (exact) return exact.code;
  if (lower.startsWith('zh')) return /tw|hk|mo|hant/.test(lower) ? 'zh-TW' : 'zh-CN';
  if (lower.startsWith('pt')) return LANGUAGES.some(language => language.code === 'pt-BR') ? 'pt-BR' : null;
  const base = lower.split('-')[0];
  return LANGUAGES.find(language => language.code.toLowerCase().split('-')[0] === base)?.code ?? null;
}
function detect(): string {
  const stored = readStored();
  if (stored && LANGUAGES.some(language => language.code === stored)) return stored;
  for (const tag of (typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [])) { const found = tag && matchLanguage(tag); if (found) return found; }
  return 'en';
}

export const language: string = detect();
export const languageInfo: Language = LANGUAGES.find(item => item.code === language) ?? { code: language, name: language, english: language, intl: language };
/** The BCP 47 tag for Intl formatting (dates, numbers, sorting). */
export const intlLocale = languageInfo.intl || language;
if (typeof document !== 'undefined') document.documentElement.lang = language;

const index = new Map<string, number>((keys as string[]).map((key, position) => [key, position]));
const table = (values as Record<string, Array<string | null>>)[language] ?? null;
const english = (values as Record<string, Array<string | null>>).en ?? null;

// A key may start with a context tag ("status-group|완료") when the same Korean words mean different things.
const CONTEXT = /^[a-z][a-z0-9-]*\|/;
const source = (key: string) => key.replace(CONTEXT, '');
function lookup(key: string): string {
  if (language === 'ko') return source(key);
  const position = index.get(key);
  if (position === undefined) return source(key);
  return table?.[position] ?? english?.[position] ?? source(key);
}

// Korean particles after a value: 을(를) · 이(가) · 은(는) · 와(과) · (으)로 · (이)라 settle on the value's last syllable.
function finalConsonant(word: string): number {
  const last = word.trim().slice(-1);
  if (!last) return -1;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
  if (/[0-9]/.test(last)) return [1, 8, 0, 0, 0, 0, 1, 8, 1, 0][Number(last)] ?? -1; // 영 일 이 삼 사 오 육 칠 팔 구
  if (/[a-z]/i.test(last)) return /[lmnr]/i.test(last) ? (/l/i.test(last) ? 8 : 1) : 0;
  return -1;
}
function particles(text: string, values: string[]): string {
  return text.replace(/\u0001(\d+)\u0002(을\(를\)|를\(을\)|이\(가\)|가\(이\)|은\(는\)|는\(은\)|와\(과\)|과\(와\)|\(으\)로|\(이\)라)/g, (_match, slot: string, particle: string) => {
    const value = values[Number(slot)] ?? '';
    const final = finalConsonant(value);
    if (final < 0) return value + particle;
    const has = final > 0;
    const choice: Record<string, string> = { '을(를)': has ? '을' : '를', '를(을)': has ? '을' : '를', '이(가)': has ? '이' : '가', '가(이)': has ? '이' : '가', '은(는)': has ? '은' : '는', '는(은)': has ? '은' : '는', '와(과)': has ? '과' : '와', '과(와)': has ? '과' : '와', '(으)로': has && final !== 8 ? '으로' : '로', '(이)라': has ? '이라' : '라' };
    return value + choice[particle];
  }).replace(/\u0001(\d+)\u0002/g, (_match, slot: string) => values[Number(slot)] ?? '');
}

type Args = ReadonlyArray<unknown> | Record<string, unknown>;
const text = (value: unknown) => value == null ? '' : String(value);

/** The message for `key` in the interface language, with {0} / {name} filled from `args`. */
export function t(key: string, args?: Args): string {
  const template = lookup(key);
  if (!args) return template;
  if (language === 'ko') {
    const slots: string[] = [];
    const marked = template.replace(/\{(\w+)\}/g, (match, name: string) => { const value = (args as Record<string, unknown>)[name]; if (value === undefined) return match; slots.push(text(value)); return `\u0001${slots.length - 1}\u0002`; });
    return particles(marked, slots);
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => { const value = (args as Record<string, unknown>)[name]; return value === undefined ? match : text(value); });
}

/** Like t(), but placeholders may be React nodes (a bold name, a chip): returns the pieces as a fragment. */
export function tx(key: string, args: ReadonlyArray<ReactNode>, texts: Record<number, string> = {}): ReactNode {
  if (args.every(arg => arg == null || typeof arg !== 'object')) return t(key, args as unknown[]);
  const template = lookup(key);
  const parts: ReactNode[] = [];
  let last = 0, piece = 0;
  const pattern = /\{(\d+)\}/g;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(template))) {
    if (found.index > last) parts.push(template.slice(last, found.index));
    const node = args[Number(found[1])];
    let after = found.index + found[0].length;
    // Korean particles right after a slot follow the slot's text (a <b>name</b> counts as "name").
    if (language === 'ko') {
      const particle = /^(을\(를\)|를\(을\)|이\(가\)|가\(이\)|은\(는\)|는\(은\)|와\(과\)|과\(와\)|\(으\)로|\(이\)라)/.exec(template.slice(after));
      if (particle) {
        const plain = texts[Number(found[1])] ?? plainOf(node);
        const fixed = particles(`\u0001${0}\u0002${particle[1]}`, [plain]).slice(plain.length);
        parts.push(typeof node === 'object' && node !== null ? createElement(Fragment, { key: `s${piece++}` }, node) : text(node));
        parts.push(fixed);
        after += particle[1].length;
        last = after; pattern.lastIndex = after;
        continue;
      }
    }
    parts.push(typeof node === 'object' && node !== null ? createElement(Fragment, { key: `s${piece++}` }, node) : text(node));
    last = after;
  }
  if (last < template.length) parts.push(template.slice(last));
  return createElement(Fragment, null, ...parts);
}
function plainOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(plainOf).join('');
  if (typeof node === 'object' && 'props' in node) return plainOf((node.props as { children?: ReactNode }).children);
  return '';
}

/** Whether this browser has a language picked (in settings or on the welcome screen). */
export const hasChosenLanguage = () => readStored() !== null;

/** Keep the language now in use as this browser's choice (no reload). */
export function rememberLanguage() { try { localStorage.setItem(STORAGE, language); } catch { /* storage blocked */ } }

/** Switch the interface language (saved in this browser) and reload. */
export function setLanguage(code: string) {
  try { localStorage.setItem(STORAGE, code); } catch { /* storage blocked */ }
  location.reload();
}

/** Server messages (engine errors) are Korean templates; translate them, filling what the template left open. */
let serverPatterns: Array<{ key: string; pattern: RegExp }> | null = null;
export function translateServerMessage(message: string): string {
  if (language === 'ko' || !message) return message;
  if (index.has(message)) return lookup(message);
  serverPatterns ??= (keys as string[]).filter(key => /\{\d+\}/.test(key)).map(key => ({ key, pattern: new RegExp(`^${key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)')}$`, 's') }));
  for (const { key, pattern } of serverPatterns) {
    const found = pattern.exec(message);
    if (found) { const slots = key.match(/\{(\d+)\}/g)!.map(slot => Number(slot.slice(1, -1))); const args: string[] = []; slots.forEach((slot, position) => { args[slot] = found[position + 1]; }); return t(key, args); }
  }
  return message;
}
