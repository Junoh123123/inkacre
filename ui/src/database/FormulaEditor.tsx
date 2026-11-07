import { t, translateServerMessage } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../data/api';
import { useWorkspace } from '../data/store';
import { Icon } from '../ui/Icon';

// 수식 편집기 (formula editor): the formula, checked as you type with the first rows' results (or the error),
// and beside it what it can use — this database's properties and the functions, each with its form and an example.
// Clicking one puts it at the caret.

interface Preview { ok: boolean; code?: string; message?: string; rows?: Array<{ id: string; title: string; value: unknown }> }
interface FunctionHelp { name: string; group: string; form: string; example: string }

const groups = () => ({ logic: t("논리"), math: t("수학"), text: t("텍스트"), date: t("날짜"), list: t("목록"), other: t("기타") });
// The forms and examples are code (the function names are the same in every language).
const catalogue: Array<[string, keyof ReturnType<typeof groups>, string, string]> = [
  ['if', 'logic', 'if(condition, then, else)', 'if(prop("Done"), "✓", "")'], ['ifs', 'logic', 'ifs(c1, v1, c2, v2, …, else)', 'ifs(prop("n") > 10, "big", prop("n") > 5, "mid", "small")'],
  ['and', 'logic', 'and(a, b)', 'and(prop("A"), prop("B"))'], ['or', 'logic', 'or(a, b)', 'or(prop("A"), prop("B"))'], ['not', 'logic', 'not(value)', 'not(prop("Done"))'],
  ['empty', 'logic', 'empty(value)', 'empty(prop("Due"))'], ['equal', 'logic', 'equal(a, b)', 'equal(prop("Status"), "Done")'], ['test', 'logic', 'test(text, pattern)', 'test(prop("Name"), "^A")'],
  ['sum', 'math', 'sum(a, b, …)', 'sum(1, 2, 3)'], ['min', 'math', 'min(a, b, …)', 'min(prop("A"), 10)'], ['max', 'math', 'max(a, b, …)', 'max(prop("A"), 10)'],
  ['abs', 'math', 'abs(number)', 'abs(-3)'], ['round', 'math', 'round(number, digits)', 'round(3.14159, 2)'], ['floor', 'math', 'floor(number)', 'floor(2.7)'], ['ceil', 'math', 'ceil(number)', 'ceil(2.1)'],
  ['sqrt', 'math', 'sqrt(number)', 'sqrt(16)'], ['pow', 'math', 'pow(base, exponent)', 'pow(2, 8)'], ['mod', 'math', 'mod(a, b)', 'mod(7, 3)'], ['mean', 'math', 'mean(a, b, …)', 'mean(1, 2, 3)'],
  ['median', 'math', 'median(a, b, …)', 'median(1, 5, 9)'], ['sign', 'math', 'sign(number)', 'sign(-4)'], ['toNumber', 'math', 'toNumber(value)', 'toNumber("42")'], ['formatNumber', 'math', 'formatNumber(number)', 'formatNumber(1234567)'],
  ['concat', 'text', 'concat(a, b, …)', 'concat("A", "B")'], ['length', 'text', 'length(text)', 'length(prop("Name"))'], ['contains', 'text', 'contains(text, part)', 'contains(prop("Name"), "x")'],
  ['lower', 'text', 'lower(text)', 'lower("ABC")'], ['upper', 'text', 'upper(text)', 'upper("abc")'], ['trim', 'text', 'trim(text)', 'trim("  a  ")'],
  ['substring', 'text', 'substring(text, start, end)', 'substring("Inkacre", 0, 4)'], ['replace', 'text', 'replace(text, pattern, with)', 'replace("a-b", "-", " ")'], ['replaceAll', 'text', 'replaceAll(text, pattern, with)', 'replaceAll("a-b-c", "-", "")'],
  ['split', 'text', 'split(text, separator)', 'split("a,b", ",")'], ['join', 'text', 'join(list, separator)', 'join(["a", "b"], ", ")'], ['repeat', 'text', 'repeat(text, times)', 'repeat("★", 3)'],
  ['padStart', 'text', 'padStart(text, length, fill)', 'padStart("7", 3, "0")'], ['link', 'text', 'link(label, url)', 'link("Site", "https://example.com")'], ['style', 'text', 'style(text, "b", "red")', 'style("Late", "b", "red")'],
  ['format', 'text', 'format(value)', 'format(prop("Due"))'], ['match', 'text', 'match(text, pattern)', 'match("a1b2", "\\\\d")'],
  ['now', 'date', 'now()', 'now()'], ['today', 'date', 'today()', 'today()'], ['dateAdd', 'date', 'dateAdd(date, amount, unit)', 'dateAdd(now(), 3, "days")'], ['dateSubtract', 'date', 'dateSubtract(date, amount, unit)', 'dateSubtract(now(), 1, "weeks")'],
  ['dateBetween', 'date', 'dateBetween(a, b, unit)', 'dateBetween(prop("Due"), now(), "days")'], ['dateStart', 'date', 'dateStart(range)', 'dateStart(prop("Dates"))'], ['dateEnd', 'date', 'dateEnd(range)', 'dateEnd(prop("Dates"))'],
  ['dateRange', 'date', 'dateRange(start, end)', 'dateRange(now(), dateAdd(now(), 7, "days"))'], ['formatDate', 'date', 'formatDate(date, pattern)', 'formatDate(now(), "YYYY-MM-DD")'], ['parseDate', 'date', 'parseDate(text)', 'parseDate("2026-11-03")'],
  ['year', 'date', 'year(date)', 'year(now())'], ['month', 'date', 'month(date)', 'month(now())'], ['day', 'date', 'day(date)', 'day(now())'], ['week', 'date', 'week(date)', 'week(now())'], ['hour', 'date', 'hour(date)', 'hour(now())'],
  ['timestamp', 'date', 'timestamp(date)', 'timestamp(now())'],
  ['map', 'list', 'map(list, current …)', 'map([1, 2], current * 2)'], ['filter', 'list', 'filter(list, condition)', 'filter([1, 5, 9], current > 3)'], ['find', 'list', 'find(list, condition)', 'find(prop("Tags"), current == "A")'],
  ['some', 'list', 'some(list, condition)', 'some([1, 2], current > 1)'], ['every', 'list', 'every(list, condition)', 'every([1, 2], current > 0)'], ['sort', 'list', 'sort(list)', 'sort([3, 1, 2])'],
  ['reverse', 'list', 'reverse(list)', 'reverse([1, 2])'], ['unique', 'list', 'unique(list)', 'unique([1, 1, 2])'], ['flat', 'list', 'flat(list)', 'flat([[1], [2]])'], ['slice', 'list', 'slice(list, start, end)', 'slice([1, 2, 3], 1)'],
  ['first', 'list', 'first(list)', 'first(prop("Tags"))'], ['last', 'list', 'last(list)', 'last(prop("Tags"))'], ['at', 'list', 'at(list, index)', 'at([1, 2, 3], 1)'], ['count', 'list', 'count(list)', 'count(prop("Tags"))'], ['includes', 'list', 'includes(list, value)', 'includes(prop("Tags"), "A")'],
  ['let', 'other', 'let(name, value, expression)', 'let(x, 2, x * x)'], ['lets', 'other', 'lets(a, 1, b, 2, a + b)', 'lets(a, 1, b, 2, a + b)'], ['id', 'other', 'id()', 'id()'], ['name', 'other', 'name(person)', 'name(prop("Owner"))'],
];
const functions: FunctionHelp[] = catalogue.map(([name, group, form, example]) => ({ name, group, form, example }));

export function previewText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(previewText).join(', ');
  const record = value as Record<string, unknown>;
  if (record.type === 'formatted_text' && Array.isArray(record.richText)) return (record.richText as Array<{ text: string }>).map(run => run.text).join('');
  if (typeof record.start === 'string') return `${record.start}${record.end ? ` → ${record.end}` : ''}`;
  if (record.error && typeof record.error === 'object') return String((record.error as { message?: string }).message ?? '');
  return JSON.stringify(value);
}

export function FormulaEditor({ sourceId, propertyId, value, onChange }: { sourceId: string; propertyId?: string; value: string; onChange: (value: string) => void }) {
  const ws = useWorkspace();
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [query, setQuery] = useState('');
  const [help, setHelp] = useState<FunctionHelp | null>(null);
  const names = groups();
  // Checked shortly after typing stops; an empty formula has nothing to show.
  useEffect(() => {
    if (!value.trim()) { setPreview(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<Preview>('/api/formula-preview', { sourceId, formula: value, ...(propertyId ? { propertyId } : {}) }).then(result => { if (!cancelled) setPreview(result); }).catch(error => { if (!cancelled) setPreview({ ok: false, message: error instanceof Error ? error.message : String(error) }); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [value, sourceId, propertyId]);
  const insert = (snippet: string, caretBack = 0) => {
    const element = area.current;
    const start = element?.selectionStart ?? value.length, end = element?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + snippet + value.slice(end));
    requestAnimationFrame(() => { element?.focus(); const at = start + snippet.length - caretBack; element?.setSelectionRange(at, at); });
  };
  const needle = query.trim().toLowerCase();
  const properties = ws.schema(sourceId).filter(property => !needle || property.name.toLowerCase().includes(needle));
  const shown = useMemo(() => functions.filter(item => !needle || item.name.toLowerCase().includes(needle)), [needle]);
  return (
    <div className="formula-editor">
      <textarea ref={area} className="text-input mono formula-editor-input" rows={4} value={value} placeholder={t("prop(\"숫자\") * 2")} spellCheck={false} aria-label={t("수식")}
        onChange={event => onChange(event.target.value)} />
      <div className={`formula-preview${preview && !preview.ok ? ' error' : ''}`} role="status" aria-live="polite">
        {!preview ? <span className="muted">{t("수식을 입력하면 처음 몇 행의 결과가 여기 보입니다.")}</span>
          : !preview.ok ? <span><Icon name="warning" size={14} /> {translateServerMessage(preview.message ?? "")}</span>
          : preview.rows?.length ? preview.rows.map(row => <div key={row.id} className="formula-preview-row"><span className="formula-preview-title">{row.title || t("제목 없음")}</span><span className="formula-preview-value">{previewText(row.value) || t("(비어 있음)")}</span></div>)
          : <span className="muted">{t("수식이 올바릅니다. 아직 행이 없습니다.")}</span>}
      </div>
      <div className="formula-browser">
        <div className="formula-browser-list">
          <div className="settings-search"><Icon name="search" size={14} /><input value={query} placeholder={t("속성 · 함수 검색")} aria-label={t("속성 · 함수 검색")} onChange={event => setQuery(event.target.value)} /></div>
          {properties.length ? <div className="formula-group-title">{t("속성")}</div> : null}
          {properties.map(property => (
            <button type="button" key={property.id} className="formula-item" onClick={() => insert(`prop("${property.name}")`)} onMouseEnter={() => setHelp(null)}>
              <Icon name={`type-${property.type}`} size={16} /><span>{property.name}</span>
            </button>
          ))}
          {(Object.keys(names) as Array<keyof typeof names>).map(group => {
            const items = shown.filter(item => item.group === group);
            return items.length ? (
              <div key={group}>
                <div className="formula-group-title">{names[group]}</div>
                {items.map(item => (
                  <button type="button" key={item.name} className={`formula-item${help?.name === item.name ? ' active' : ''}`} onMouseEnter={() => setHelp(item)} onFocus={() => setHelp(item)} onClick={() => insert(`${item.name}()`, 1)}>
                    <Icon name="type-formula" size={16} /><span>{item.name}</span>
                  </button>
                ))}
              </div>
            ) : null;
          })}
        </div>
        <div className="formula-help">
          {help ? (
            <>
              <div className="formula-help-name">{help.name}</div>
              <div className="formula-help-label">{t("형식")}</div>
              <code className="formula-help-code">{help.form}</code>
              <div className="formula-help-label">{t("예")}</div>
              <code className="formula-help-code">{help.example}</code>
            </>
          ) : <p className="muted small">{t("함수에 마우스를 올리면 형식과 예가 보입니다. 누르면 커서 자리에 들어갑니다.")}</p>}
        </div>
      </div>
    </div>
  );
}
