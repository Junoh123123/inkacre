import {isText,textValue} from './formula-values.mjs';
import { createHash } from 'node:crypto';
import { requireThat } from './contracts.mjs';

export const computedTypes = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button']);
const optionTypes = new Set(['select', 'multi_select', 'status']);
function unpack(value) {
  if (typeof value !== 'string' || !/^[\[{]/.test(value.trim())) return value;
  try { return JSON.parse(value); } catch { return value; }
}
function labels(property, value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(item => optionTypes.has(property.type) ? property.options?.find(option => option.id === item)?.name ?? String(item) : typeof item === 'object' ? JSON.stringify(item) : String(item));
}
export function conversionOptions(property, targetType, values, supplied) {
  if (supplied) return structuredClone(supplied);
  if (optionTypes.has(property.type)) return structuredClone(property.options ?? []);
  return [...new Set(values.filter(value => value != null && value !== '' && !value?.error).flatMap(value => labels(property, unpack(value))))].map(name => ({
    id: `option:${createHash('sha256').update(`${property.id}:${targetType}:${name}`).digest('hex').slice(0, 24)}`, name,
    ...(targetType === 'status' ? { group: 'todo' } : {}),
  }));
}
export function convertValue(state, original, target, value) {
  requireThat(!value?.error, 'CONVERSION_VALUE', '계산 오류를 먼저 해결하세요.');
  if (value == null) return null;
  const text = () => isText(value)?textValue(value):optionTypes.has(original.type) ? original.type === 'multi_select' ? JSON.stringify(labels(original, value)) : labels(original, value)[0] : typeof value === 'string' ? value : JSON.stringify(value);
  if (['text', 'phone', 'url', 'email'].includes(target.type)) return text();
  if (value === '') return null;
  const raw = optionTypes.has(original.type) ? original.type === 'multi_select' ? labels(original, value) : labels(original, value)[0] : unpack(value);
  if (target.type === 'number') {
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    const valid = typeof raw === 'number' || typeof raw === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim());
    requireThat(valid && Number.isFinite(Number(raw)), 'CONVERSION_VALUE', '숫자로 바꿀 수 없는 값입니다.'); return Number(raw);
  }
  if (target.type === 'checkbox') {
    if (typeof raw === 'boolean') return raw;
    if ([0, 1].includes(raw)) return raw === 1;
    const normalized = String(raw).trim().toLowerCase();
    requireThat(['true', 'false', '1', '0', '예', '아니요'].includes(normalized), 'CONVERSION_VALUE', 'true/false 또는 0/1로 표시된 값이 필요합니다.');
    return ['true', '1', '예'].includes(normalized);
  }
  if (target.type === 'date') return typeof raw === 'string' ? { start: raw.trim() } : raw;
  if (target.type === 'place') return typeof raw === 'string' ? { name: raw } : raw;
  if (target.type === 'person') {
    const values = Array.isArray(raw) ? raw : [raw];
    requireThat(values.every(value => typeof value === 'string'), 'CONVERSION_VALUE', '사람 값에는 이름 또는 ID 문자열이 필요합니다.'); return values;
  }
  if (optionTypes.has(target.type)) {
    const values = Array.isArray(raw) ? raw : [raw], oldIds = optionTypes.has(original.type) ? Array.isArray(value) ? value : [value] : [];
    const ids = values.map((label, index) => {
      const retained = target.options.find(option => option.id === oldIds[index]);
      const matches = retained ? [retained] : target.options.filter(option => option.name === String(label) || option.id === label);
      requireThat(matches.length === 1, 'CONVERSION_VALUE', '값에 대응하는 선택 항목이 하나여야 합니다.'); return matches[0].id;
    });
    if (target.type === 'multi_select') return [...new Set(ids)];
    requireThat(ids.length <= 1, 'CONVERSION_VALUE', '여러 선택 값을 단일 선택으로 줄일 수 없습니다.'); return ids[0] ?? null;
  }
  if (['relation', 'files'].includes(target.type)) {
    const values = Array.isArray(raw) ? raw : [raw];
    return [...new Set(values.map(value => {
      requireThat(typeof value === 'string', 'CONVERSION_VALUE', '대상 ID 또는 이름 문자열이 필요합니다.');
      const matchesKind = item => target.type === 'files' ? item.kind === 'attachment' && item.alive : item.kind === 'page' && item.sourceId === target.targetSourceId;
      const exact = state.get(value);
      if (exact && matchesKind(exact)) return exact.id;
      const matches = [...state.values()].filter(item => matchesKind(item) && (target.type === 'files' ? item.name : item.title) === value);
      requireThat(matches.length === 1, 'CONVERSION_VALUE', '이름에 대응하는 대상이 하나여야 합니다. ID로 지정하세요.'); return matches[0].id;
    }))];
  }
  return raw;
}
