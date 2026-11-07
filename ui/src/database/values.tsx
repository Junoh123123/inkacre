import { t, translateServerMessage } from '../i18n';
import { deviceTimeZone, displayTimeZone, weekdayLabels, weekOffset } from '../data/settings';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apply, uploadFile, valueDraftKey, newId } from '../data/commands';
import { api, readLocal, storeLocal } from '../data/api';
import { report, useWorkspace, workspace } from '../data/store';
import { colorNames, displayDate, displayDateRange, displayDateWith, formatNumber, formatValue, formatYearMonth, optionColor, statusGroupKeys, statusGroupLabel, statusGroupName, tagColors, avatarLetter, statusChecked } from '../data/format';
import type { AttachmentEntity, NumberFormat, PageEntity, PropertyEntity, QueryRow, RichText, SelectOption } from '../data/types';
import { readRich, richToFragment } from '../editor/richdom';
import { Icon } from '../ui/Icon';
import { Popover, type Anchor, type Placement } from '../ui/overlay';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Switch, Tag } from '../ui/primitives';
import { EntityIcon } from '../page/EntityIcon';
import { openPeek, navigate } from '../data/router';
import { runButton } from '../dialogs/buttons';
import { openWorkspaceDialog } from '../dialogs/registry';
import { createRow } from '../page/actions';

export const readOnlyTypes = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id']);
export const propertyIcon = (type: string) => `type-${type}`;

// ---------- saving values ----------

interface ValueDraft { value: unknown; baseRevision: number }

export function readValueDraft(pageId: string, propertyId: string): ValueDraft | null {
  return readLocal<ValueDraft | null>(valueDraftKey(pageId, propertyId), null);
}

export function keepValueDraft(pageId: string, propertyId: string, value: unknown, baseRevision = workspace.revision) {
  storeLocal(valueDraftKey(pageId, propertyId), JSON.stringify({ value, baseRevision }));
}

export async function saveValue(pageId: string, property: PropertyEntity, value: unknown, revision?: number) {
  const draft = readValueDraft(pageId, property.id);
  keepValueDraft(pageId, property.id, value, draft?.baseRevision ?? revision ?? workspace.revision);
  const operation = property.type === 'relation'
    ? { type: 'relation.set', pageId, propertyId: property.id, targetIds: (value as string[] | null) ?? [] }
    : { type: 'value.set', pageId, propertyId: property.id, value };
  return apply([operation], { revision: draft?.baseRevision ?? revision });
}

// The value to show: a draft this browser kept (not yet saved) wins over the stored value.
export function shownValue(pageId: string, property: PropertyEntity, value: unknown): { value: unknown; drafted: boolean } {
  const draft = readValueDraft(pageId, property.id);
  if (!draft) return { value, drafted: false };
  if (JSON.stringify(draft.value) === JSON.stringify(value)) { localStorage.removeItem(valueDraftKey(pageId, property.id)); return { value, drafted: false }; }
  return { value: draft.value, drafted: true };
}

// ---------- display ----------

export function OptionTag({ property, id, onRemove }: { property: PropertyEntity; id: string; onRemove?: () => void }) {
  const option = property.options?.find(item => item.id === id);
  return <Tag color={optionColor(property, option)} status={property.type === 'status'} onRemove={onRemove}>{option?.name ?? t("삭제된 옵션")}</Tag>;
}

function isError(value: unknown): value is { error: { code: string; message: string } } {
  return !!value && typeof value === 'object' && 'error' in (value as object);
}

// Formatted runs shown as they read (links open in a new tab without starting an edit).
function RichRuns({ runs }: { runs: RichText }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    element.replaceChildren(richToFragment(runs));
    element.querySelectorAll('a').forEach(anchor => { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.addEventListener('click', event => event.stopPropagation()); });
    // A page mention in the value opens that page.
    element.querySelectorAll<HTMLElement>('[data-mention]').forEach(mention => { mention.classList.add('rich-runs-mention'); mention.addEventListener('click', event => { event.stopPropagation(); navigate(mention.dataset.mention!); }); });
  }, [JSON.stringify(runs)]);
  return <span ref={ref} className="rich-runs" />;
}

export function RelationChip({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const ws = useWorkspace();
  const page = ws.get<PageEntity>(id);
  return (
    <span className={`relation-chip${page?.alive === false ? ' missing' : ''}`} onClick={event => { if (!onOpen || !page) return; event.stopPropagation(); onOpen(id); }}>
      <EntityIcon item={page} size={16} />
      <span className="relation-chip-title">{page ? page.title || t("새 페이지") : t("삭제된 항목")}</span>
    </span>
  );
}

export function ValueView({ property, value, row, mode = 'cell', wrap = false, asCheckbox = false }: { property: PropertyEntity; value: unknown; row?: QueryRow; mode?: 'cell' | 'card' | 'page'; wrap?: boolean; asCheckbox?: boolean }): ReactNode {
  if (isError(value)) return <span className="value-error" title={translateServerMessage(value.error.message)}>{value.error.code === 'CYCLE' ? t("순환 참조") : t("오류")}: {value.error.message}</span>;
  if (property.type === 'checkbox') return <span className={`checkbox-box${value === true ? ' checked' : ''}`} role="checkbox" aria-checked={value === true}>{value === true ? <Icon name="check" size={14} /> : null}</span>;
  if (property.type === 'status' && asCheckbox) { const checked = statusChecked(property, value); return <span className={`checkbox-box${checked ? ' checked' : ''}`} role="checkbox" aria-checked={checked}>{checked ? <Icon name="check" size={14} /> : null}</span>; }
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
  switch (property.type) {
    case 'select': case 'status': case 'multi_select':
      return <span className={`tag-list${wrap ? ' wrap' : ''}`}>{(Array.isArray(value) ? value : [value]).map(id => <OptionTag key={String(id)} property={property} id={String(id)} />)}</span>;
    case 'relation': {
      const ids = (Array.isArray(value) ? value : [value]) as string[];
      const display = row?.relationDisplay?.[property.id];
      return (
        <span className={`relation-list${wrap ? ' wrap' : ''}`}>
          {/* Each related page with the properties chosen to show beside it (관계형 › 표시할 속성) — in table cells too. */}
          {ids.map(id => {
            const fields = display?.find(item => item.id === id)?.fields.filter(field => !(field.value == null || field.value === '' || (Array.isArray(field.value) && !field.value.length))) ?? [];
            const chip = <RelationChip key={id} id={id} onOpen={mode === 'cell' ? undefined : target => openPeek(target, 'side')} />;
            return fields.length ? (
              <span key={id} className="relation-item">{chip}{fields.map(field => <span key={field.propertyId} className="relation-field" title={field.name}>{mode === 'cell' ? '' : `${field.name}: `}{formatValue(field.value, workspace.get<PropertyEntity>(field.propertyId))}</span>)}</span>
            ) : chip;
          })}
        </span>
      );
    }
    case 'date': {
      // A time in another zone reads in that zone, with the zone's name after it.
      const zoneName = (value as { timeZone?: string }).timeZone, foreign = !!zoneName && zoneName !== deviceZone() && String((value as { start?: string }).start ?? '').includes('T');
      return <span className="date-value">{displayDateRange(value as { start?: string; end?: string }, { dateFormat: property.dateFormat, timeFormat: property.timeFormat, timeZone: foreign ? zoneName : undefined })}{foreign ? <span className="date-zone"> {zoneName!.split('/').at(-1)!.replace(/_/g, ' ')}</span> : null}</span>;
    }
    case 'created_time': case 'last_edited_time': return <span className="date-value">{property.dateFormat || property.timeFormat ? displayDateWith(String(value), property) : displayDate(String(value))}</span>;
    case 'files':
      return (
        <span className={`file-list${wrap ? ' wrap' : ''}`}>
          {(value as string[]).map(id => {
            const file = workspace.get<AttachmentEntity>(id);
            return <a key={id} className="file-chip" href={`/api/attachments/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}><Icon name={file?.mediaType.startsWith('image/') ? 'image' : 'file'} size={14} /><span>{file?.name ?? t("첨부")}</span></a>;
          })}
        </span>
      );
    case 'person': case 'created_by': case 'last_edited_by':
      return <span className="person-list">{(Array.isArray(value) ? value : [value]).map((name, index) => <span key={index} className="person-chip"><span className="avatar small">{avatarLetter(String(name === 'user' ? t("나") : name))}</span><span>{name === 'user' ? t("나") : String(name)}</span></span>)}</span>;
    case 'url': return <a className="link-value" href={String(value)} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}><span className="link-value-text">{String(value).replace(/^https?:\/\//, '')}</span></a>;
    case 'email': return <a className="link-value" href={`mailto:${String(value)}`} onClick={event => event.stopPropagation()}><span className="link-value-text">{String(value)}</span></a>;
    case 'phone': return <a className="link-value" href={`tel:${String(value)}`} onClick={event => event.stopPropagation()}><span className="link-value-text">{String(value)}</span></a>;
    case 'number': return typeof value === 'number' ? <NumberValue value={value} format={property.numberFormat} /> : <span className="number-value">{String(value)}</span>;
    case 'unique_id': return <span className="unique-id">{property.idPrefix ? `${property.idPrefix}-${String(value)}` : String(value)}</span>;
    case 'place': return <span className="place-value"><Icon name="map" size={14} />{(value as { name?: string }).name}</span>;
    case 'formula': case 'rollup': {
      if (value && typeof value === 'object' && (value as { type?: string }).type === 'formatted_text') return <span>{formatValue(value, property)}</span>;
      if (typeof value === 'boolean') return <span className={`checkbox-box${value ? ' checked' : ''}`}>{value ? <Icon name="check" size={14} /> : null}</span>;
      if (typeof value === 'number') return <NumberValue value={value} format={property.numberFormat} />;
      if (Array.isArray(value)) return <span className="formula-list">{value.map((item, index) => <Fragment key={index}>{index ? ', ' : ''}{formatValue(item)}</Fragment>)}</span>;
      return <span>{formatValue(value, property)}</span>;
    }
    case 'text': {
      const runs = runsOf(value, row, property.id);
      return runs.some(run => Object.keys(run).some(key => key !== 'text')) ? <span className="text-value"><RichRuns runs={runs} /></span> : <span className="text-value">{formatValue(Array.isArray(value) ? runs.map(run => run.text).join('') : value, property)}</span>;
    }
    default: return <span className="text-value">{formatValue(value, property)}</span>;
  }
}

// ---------- editors ----------

export interface ValueEditorProps {
  anchor: Anchor;
  pageId: string;
  property: PropertyEntity;
  value: unknown;
  /** The query row, when there is one (formatted text values live in row.rich). */
  row?: QueryRow;
  onClose: () => void;
  placement?: Placement;
  width?: number;
  // When set, the editor reports values instead of saving them (forms, button actions, new rows).
  onChange?: (value: unknown) => void;
}

// Pickers that open over a value take at least the value's width (420 wide over a side peek's
// 412-wide value column).
function coverWidth(anchor: Anchor, min: number) {
  const width = anchor instanceof Element ? anchor.getBoundingClientRect().width : 0;
  return Math.max(min, Math.min(Math.round(width), 480));
}

export function ValueEditor(props: ValueEditorProps) {
  const { property } = props;
  switch (property.type) {
    case 'select': case 'status': case 'multi_select': return <OptionPicker {...props} />;
    case 'date': return <DatePicker {...props} />;
    case 'relation': return <RelationPicker {...props} />;
    case 'files': return <FilesEditor {...props} />;
    case 'person': return <PersonEditor {...props} />;
    case 'place': return <PlaceEditor {...props} />;
    case 'text': return <RichTextValueEditor {...props} />;
    case 'title': case 'number': case 'url': case 'email': case 'phone': return <TextValueEditor {...props} />;
    default: return null;
  }
}

function commitValue(props: ValueEditorProps, value: unknown) {
  if (props.onChange) { props.onChange(value); return Promise.resolve(); }
  return saveValue(props.pageId, props.property, value).then(() => undefined);
}

// 텍스트 속성 (the text property keeps formatting): bold ⌘B, italic ⌘I, underline ⌘U, strikethrough ⌘⇧S,
// code ⌘E and links ⌘K, as rich text runs; plain text stays a plain string.
const runsOf = (value: unknown, row?: QueryRow, propertyId?: string): RichText => Array.isArray(value) ? value as RichText : propertyId && row?.rich?.[propertyId] ? row.rich[propertyId] : value == null || value === '' ? [] : [{ text: String(value) }];
function RichTextValueEditor(props: ValueEditorProps) {
  const { property, value, anchor, onClose, pageId } = props;
  const box = useRef<HTMLDivElement>(null);
  const committed = useRef(false);
  const [link, setLink] = useState<{ range: Range; url: string } | null>(null);
  const initial = runsOf(value, props.row, property.id);
  const width = Math.max(props.width ?? (anchor instanceof Element ? anchor.getBoundingClientRect().width : 240), 280);
  useEffect(() => {
    const element = box.current; if (!element) return;
    element.replaceChildren(richToFragment(initial));
    // Focus once the popover is placed (it is hidden while it measures itself), caret at the end.
    const place = () => {
      if (!element.isConnected || document.activeElement === element) return;
      element.focus();
      const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    };
    place();
    const frame = requestAnimationFrame(place), timer = window.setTimeout(place, 60);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, []);
  const finish = () => {
    if (committed.current || !box.current) return;
    committed.current = true;
    onClose();
    const runs = readRich(box.current).filter(run => run.text !== '');
    const plain = runs.every(run => Object.keys(run).every(key => key === 'text'));
    const next = !runs.length ? null : plain ? runs.map(run => run.text).join('') : runs;
    if (JSON.stringify(next) === JSON.stringify(Array.isArray(value) ? value : value === '' ? null : value ?? null)) return;
    commitValue(props, next).catch(report);
    void pageId;
  };
  const exec = (command: string) => { document.execCommand(command); };
  const applyLink = () => {
    if (!link) return;
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(link.range);
    const url = link.url.trim();
    if (url) document.execCommand('createLink', false, /^[a-z]+:/i.test(url) ? url : `https://${url}`); else document.execCommand('unlink');
    setLink(null); box.current?.focus();
  };
  return (
    <Popover anchor={anchor} placement={props.placement ?? 'cover'} onClose={finish} className="value-editor text-value-editor rich-value-editor" style={{ width }}>
      <div ref={box} className="value-textarea rich-value-input" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={property.name}
        onPaste={event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(); return; }
          if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); document.execCommand('insertLineBreak'); return; }
          const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
          if (!mod) return;
          if (key === 'b') { event.preventDefault(); exec('bold'); }
          else if (key === 'i') { event.preventDefault(); exec('italic'); }
          else if (key === 'u') { event.preventDefault(); exec('underline'); }
          else if (key === 's' && event.shiftKey) { event.preventDefault(); exec('strikeThrough'); }
          else if (key === 'e') {
            event.preventDefault();
            const selection = window.getSelection();
            if (selection?.rangeCount && !selection.isCollapsed) { const range = selection.getRangeAt(0), code = document.createElement('code'); code.append(range.extractContents()); range.insertNode(code); }
          } else if (key === 'k') {
            event.preventDefault();
            const selection = window.getSelection();
            if (selection?.rangeCount && !selection.isCollapsed) { const text = selection.toString().trim(); setLink({ range: selection.getRangeAt(0).cloneRange(), url: /^https?:\/\/\S+$/.test(text) ? text : '' }); }
          }
        }} />
      {link ? (
        <form className="rich-value-link" onSubmit={event => { event.preventDefault(); applyLink(); }}>
          <input className="text-input" autoFocus value={link.url} placeholder={t("링크를 붙여넣거나 입력")} aria-label={t("링크")} onChange={event => setLink({ ...link, url: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setLink(null); box.current?.focus(); } }} />
          <button type="submit" className="blue-button small">{t("링크 걸기")}</button>
        </form>
      ) : <div className="rich-value-hint">{t("⌘B 굵게 · ⌘I 기울임 · ⌘U 밑줄 · ⌘E 코드 · ⌘K 링크")}</div>}
    </Popover>
  );
}

function TextValueEditor(props: ValueEditorProps) {
  const { property, value, anchor, onClose, pageId } = props;
  const initial = value == null ? '' : String(value);
  const [text, setText] = useState(initial);
  const [error, setError] = useState('');
  const committed = useRef(false);
  const multiline = property.type === 'text' || property.type === 'title';
  const width = Math.max(props.width ?? (anchor instanceof Element ? anchor.getBoundingClientRect().width : 240), 240);
  const finish = () => {
    if (committed.current) return;
    const trimmed = text;
    let next: unknown = trimmed;
    if (property.type === 'number') {
      if (!trimmed.trim()) next = null;
      else {
        const parsed = Number(trimmed.replace(/[,\s₩$€¥%]/g, ''));
        if (!Number.isFinite(parsed)) { setError(t("숫자를 입력하세요.")); return; }
        next = property.numberFormat?.style === 'percent' && /%/.test(trimmed) ? parsed / 100 : parsed;
      }
    } else if (property.type === 'url' && trimmed && !/^[a-z]+:/i.test(trimmed)) next = `https://${trimmed.trim()}`;
    else if (property.type !== 'title' && property.type !== 'text' && !trimmed.trim()) next = null;
    committed.current = true;
    onClose();
    if (JSON.stringify(next ?? null) === JSON.stringify(value ?? null) && !(property.type === 'title' && next !== value)) return;
    if (property.type === 'text' && !next && !value) return; // closing an empty text cell is not an edit
    if (property.type === 'title' && next === null) next = '';
    commitValue(props, next).catch(report);
    void pageId;
  };
  return (
    <Popover anchor={anchor} placement={props.placement ?? 'cover'} onClose={finish} className={`value-editor text-value-editor${property.type === 'title' ? ' title-value-editor' : ''}`} style={{ width }}>
      {multiline ? (
        <textarea className="value-textarea" autoFocus value={text} rows={1}
          ref={element => { if (element) { element.style.height = '0px'; element.style.height = `${Math.min(element.scrollHeight, 320)}px`; } }}
          onFocus={event => { const length = event.currentTarget.value.length; event.currentTarget.setSelectionRange(length, length); }}
          onChange={event => { setText(event.target.value); if (!props.onChange && property.type !== 'title') keepValueDraft(pageId, property.id, event.target.value); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(); }
          }} />
      ) : (
        <input className="value-input" autoFocus value={text} inputMode={property.type === 'number' ? 'decimal' : undefined}
          type={property.type === 'email' ? 'email' : 'text'}
          onChange={event => { setText(event.target.value); setError(''); }}
          onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); finish(); } }} />
      )}
      {error ? <div className="value-editor-error">{error}</div> : null}
      {property.type === 'url' && initial ? <a className="value-editor-link" href={initial} target="_blank" rel="noopener noreferrer"><Icon name="arrow-up-right" size={14} />{t("링크 열기")}</a> : null}
    </Popover>
  );
}

// ----- select / multi-select / status -----

export function nextColor(options: SelectOption[]) {
  const used = new Set(options.map(option => option.color));
  return tagColors.slice(1).find(color => !used.has(color)) ?? tagColors[1 + (options.length % (tagColors.length - 1))];
}

export function OptionPicker(props: ValueEditorProps) {
  const { property, anchor, onClose } = props;
  const ws = useWorkspace();
  const live = ws.get<PropertyEntity>(property.id) ?? property;
  const multiple = live.type === 'multi_select';
  const [selected, setSelected] = useState<string[]>(() => props.value == null ? [] : (Array.isArray(props.value) ? props.value as string[] : [String(props.value)]));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [optionMenu, setOptionMenu] = useState<{ anchor: Element; option: SelectOption } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = live.options ?? [];
  const needle = query.trim().toLocaleLowerCase();
  const filtered = options.filter(option => option.name.toLocaleLowerCase().includes(needle));
  const exact = options.some(option => option.name.toLocaleLowerCase() === needle);
  const canCreate = !!needle && !exact && live.type !== 'status';
  const rows: Array<{ kind: 'option'; option: SelectOption } | { kind: 'create' }> = [...filtered.map(option => ({ kind: 'option' as const, option })), ...(canCreate ? [{ kind: 'create' as const }] : [])];

  const save = (ids: string[]) => {
    const value = multiple ? ids : ids[0] ?? null;
    commitValue(props, value).catch(report);
  };
  const choose = (option: SelectOption) => {
    if (multiple) {
      const next = selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id];
      setSelected(next); save(next); setQuery('');
    } else {
      setSelected([option.id]); save([option.id]); onClose();
    }
  };
  const create = async () => {
    const name = query.trim();
    if (!name) return;
    const option: SelectOption = { id: newId(), name, color: nextColor(options) };
    const ids = multiple ? [...selected, option.id] : [option.id];
    setQuery('');
    if (props.onChange) {
      await apply([{ type: 'property.update', id: live.id, options: [...options, option] }]);
      props.onChange(multiple ? ids : option.id);
    } else {
      const value = multiple ? ids : option.id;
      await apply([{ type: 'property.update', id: live.id, options: [...options, option] }, live.type === 'relation' ? { type: 'relation.set', pageId: props.pageId, propertyId: live.id, targetIds: ids } : { type: 'value.set', pageId: props.pageId, propertyId: live.id, value }]);
    }
    setSelected(ids);
    if (!multiple) onClose();
  };
  useEffect(() => { setActive(0); }, [needle]);

  const groups = live.type === 'status'
    ? [...statusGroupKeys.map(statusGroupName), ...new Set(filtered.map(statusGroupLabel).filter(label => !statusGroupKeys.map(statusGroupName).includes(label)))].map(label => ({ label, items: filtered.filter(option => statusGroupLabel(option) === label) })).filter(group => group.items.length)
    : [{ label: multiple || live.type === 'select' ? t("옵션 선택 또는 생성") : '', items: filtered }];

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const list = [...options];
    const from = list.findIndex(option => option.id === fromId), to = list.findIndex(option => option.id === toId);
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    apply([{ type: 'property.update', id: live.id, options: list }]).catch(report);
  };

  let index = -1;
  const optionRow = (option: SelectOption) => {
    index++;
    const myIndex = index;
    return (
      <div key={option.id} className={`option-row${myIndex === active ? ' active' : ''}${dragging === option.id ? ' dragging' : ''}`} role="option" aria-selected={selected.includes(option.id)}
        draggable={live.type !== 'status'}
        onDragStart={event => { setDragging(option.id); event.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={event => { if (dragging) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); if (dragging) reorder(dragging, option.id); setDragging(null); }}
        onDragEnd={() => setDragging(null)}
        onPointerMove={() => setActive(myIndex)} onClick={() => choose(option)}>
        {live.type !== 'status' ? <span className="option-handle" aria-hidden="true"><Icon name="drag" size={16} /></span> : null}
        <span className="option-tag"><Tag color={optionColor(live, option)} status={live.type === 'status'}>{option.name}</Tag></span>
        {!multiple && selected.includes(option.id) ? <Icon name="check" size={16} className="option-check" /> : null}
        <button type="button" className="option-more icon-button small" aria-label={t("{0} 옵션 편집", [option.name])} onClick={event => { event.stopPropagation(); setOptionMenu({ anchor: event.currentTarget, option }); }}><Icon name="more" size={16} /></button>
      </div>
    );
  };

  return (
    <Popover anchor={anchor} placement={props.placement ?? 'cover'} onClose={onClose} className="value-editor option-picker" style={{ width: coverWidth(anchor, live.type === 'status' ? 240 : 300) }} label={t("{0} 옵션", [live.name])}>
      <div className="option-input-area" onClick={() => inputRef.current?.focus()}>
        {selected.map(id => <OptionTag key={id} property={live} id={id} onRemove={() => { const next = selected.filter(item => item !== id); setSelected(next); save(next); }} />)}
        <input ref={inputRef} autoFocus className="option-search" value={query} placeholder={selected.length ? '' : live.type === 'status' ? t("옵션 검색") : t("옵션 검색 또는 생성")}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(current => Math.min(rows.length - 1, current + 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(current => Math.max(0, current - 1)); }
            else if (event.key === 'Enter') { event.preventDefault(); const row = rows[active]; if (row?.kind === 'option') choose(row.option); else if (row?.kind === 'create') create().catch(report); }
            else if (event.key === 'Backspace' && !query && selected.length) { const next = selected.slice(0, -1); setSelected(next); save(next); }
          }} />
      </div>
      <div className="option-list" role="listbox">
        {groups.map((group, groupIndex) => (
          <div key={group.label || groupIndex} className="option-group">
            {groupIndex > 0 && live.type === 'status' ? <div className="menu-separator" /> : null}
            {group.label && !(needle && live.type !== 'status') ? <div className="menu-heading">{group.label}</div> : null}
            {group.items.map(optionRow)}
          </div>
        ))}
        {canCreate ? (() => { index++; const myIndex = index; return (
          <div className={`option-row option-create${myIndex === active ? ' active' : ''}`} onPointerMove={() => setActive(myIndex)} onClick={() => create().catch(report)}>
            <span className="option-create-label">{t("새로 만들기:")}</span><Tag color={nextColor(options)}>{query.trim()}</Tag>
          </div>
        ); })() : null}
        {!rows.length ? <div className="menu-empty">{t("결과 없음")}</div> : null}
      </div>
      {live.type === 'status' ? (
        <div className="option-footer"><div className="menu-separator" /><div className="menu-item" onClick={() => { onClose(); openWorkspaceDialog('property', { sourceId: live.sourceId, propertyId: live.id }); }}><span className="menu-item-icon"><Icon name="settings" /></span><span className="menu-item-label">{t("속성 편집")}</span></div></div>
      ) : null}
      {optionMenu ? <OptionMenu property={live} option={optionMenu.option} anchor={optionMenu.anchor} onClose={() => setOptionMenu(null)} /> : null}
    </Popover>
  );
}

function OptionMenu({ property, option, anchor, onClose }: { property: PropertyEntity; option: SelectOption; anchor: Element; onClose: () => void }) {
  const [name, setName] = useState(option.name);
  const update = (patch: Partial<SelectOption> | null) => {
    const options = (property.options ?? []).flatMap(item => item.id !== option.id ? [item] : patch ? [{ ...item, ...patch }] : []);
    return apply([{ type: 'property.update', id: property.id, options }]).catch(report);
  };
  const entries: MenuEntry[] = [
    { kind: 'custom', render: () => (
      <input className="menu-name-input" value={name} autoFocus aria-label={t("옵션 이름")} onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (name.trim() && name.trim() !== option.name) update({ name: name.trim() }); onClose(); } }}
        onBlur={() => { if (name.trim() && name.trim() !== option.name) update({ name: name.trim() }); }} />
    ) },
    { label: t("삭제"), icon: 'trash', danger: true, onSelect: () => update(null) },
    { kind: 'separator' },
    { kind: 'section', label: t("색") },
    ...tagColors.map(color => ({ label: colorNames[color], icon: <span className={`swatch swatch-bg-${color === 'default' ? 'gray' : color}`} />, checked: optionColor(property, option) === color, onSelect: () => update({ color }) } as MenuEntry)),
  ];
  return <Menu anchor={anchor} placement="right-start" width={220} entries={entries} onClose={onClose} label={t("옵션")} />;
}

// ----- date -----

const pad = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export function localIso(day: string, time: string) {
  const date = new Date(`${day}T${time || '00:00'}:00`);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${day}T${time || '00:00'}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
// A date's time zone (시간대 in the date picker): the wall time is entered and read in that zone.
// The zone dates are entered and read in (설정 › 시간대, else this device's).
const deviceZone = () => displayTimeZone();
function zoneOffset(zone: string, at: Date): number {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at).find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
    const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
    return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  } catch { return 0; }
}
export function zonedIso(day: string, time: string, zone: string) {
  const guess = Date.parse(`${day}T${time || '00:00'}:00Z`);
  const offset = zoneOffset(zone, new Date(guess - zoneOffset(zone, new Date(guess)) * 60000));
  const sign = offset >= 0 ? '+' : '-';
  return `${day}T${time || '00:00'}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
function splitDate(text: string | undefined, zone?: string): { day: string; time: string } {
  if (!text) return { day: '', time: '' };
  if (!text.includes('T')) return { day: text.slice(0, 10), time: '' };
  const date = new Date(text);
  if (zone && zone !== deviceTimeZone() && /Z|[+-]\d\d:\d\d$/.test(text) && Number.isFinite(date.getTime())) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  if (/Z|[+-]\d\d:\d\d$/.test(text) && Number.isFinite(date.getTime())) return { day: dayKey(date), time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
  return { day: text.slice(0, 10), time: text.slice(11, 16) };
}

export function DatePicker(props: ValueEditorProps) {
  const { anchor, onClose, property } = props;
  const initial = (props.value ?? null) as { start?: string; end?: string; timeZone?: string } | null;
  const [zone, setZone] = useState(() => initial?.timeZone || deviceZone());
  const zones = useMemo(() => { try { return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [zone]; } catch { return [zone]; } }, []);
  const [start, setStart] = useState(() => splitDate(initial?.start, initial?.timeZone ?? deviceZone()));
  const [end, setEnd] = useState(() => splitDate(initial?.end, initial?.timeZone ?? deviceZone()));
  const [hasEnd, setHasEnd] = useState(!!initial?.end && initial.end !== initial.start);
  const [withTime, setWithTime] = useState(!!initial?.start?.includes('T'));
  const [picking, setPicking] = useState<'start' | 'end'>('start');
  const [month, setMonth] = useState(() => { const base = start.day ? new Date(`${start.day}T00:00:00`) : new Date(); return new Date(base.getFullYear(), base.getMonth(), 1); });
  const [reminderMenu, setReminderMenu] = useState<Element | null>(null);
  const dirty = useRef(false);
  const latest = useRef({ start, end, hasEnd, withTime, zone });
  latest.current = { start, end, hasEnd, withTime, zone };

  const build = () => {
    const { start: s, end: e, hasEnd: ranged, withTime: timed, zone: z } = latest.current;
    if (!s.day) return null;
    const value: { start: string; end?: string; timeZone?: string } = { start: timed ? zonedIso(s.day, s.time || '09:00', z) : s.day };
    if (ranged && e.day) {
      const endValue = timed ? zonedIso(e.day, e.time || s.time || '09:00', z) : e.day;
      if (Date.parse(endValue) >= Date.parse(value.start)) value.end = endValue;
    }
    if (timed) value.timeZone = z;
    return value;
  };
  const save = () => { dirty.current = true; queueMicrotask(() => commitValue(props, build()).catch(report)); };

  const pickDay = (day: string) => {
    if (hasEnd && picking === 'end' && start.day) {
      if (day < start.day) { setEnd(start); setStart({ day, time: start.time }); }
      else setEnd({ day, time: end.time });
      setPicking('start');
    } else {
      setStart({ day, time: start.time });
      if (hasEnd) { if (end.day && end.day < day) setEnd({ day: '', time: '' }); setPicking('end'); }
    }
    latest.current = { ...latest.current };
    window.setTimeout(save, 0);
  };

  const first = new Date(month);
  const startOffset = weekOffset(first);
  const cells = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - startOffset + i));
  const today = dayKey(new Date());
  const inRange = (key: string) => hasEnd && start.day && end.day && key > start.day && key < end.day;

  const reminderEntries: MenuEntry[] = [
    { label: t("없음"), onSelect: () => undefined },
    ...[[t("날짜 시작 시각"), 0], [t("5분 전"), 5], [t("1시간 전"), 60], [t("1일 전"), 1440], [t("2일 전"), 2880], [t("1주 전"), 10080]].map(([label, minutes]) => ({
      label: String(label),
      onSelect: () => {
        if (props.onChange) return;
        // Offset is minutes before the date start; the engine reminds at start − offset.
        apply([{ type: 'reminder.set', parentId: props.pageId, datePropertyId: property.id, offsetMinutes: Math.max(0, Number(minutes)), message: `${workspace.get<PageEntity>(props.pageId)?.title || t("항목")} · ${property.name}` }]).catch(report);
      },
    } as MenuEntry)),
  ];

  return (
    <Popover anchor={anchor} placement={props.placement ?? 'below-cover'} onClose={onClose} className="value-editor date-picker" style={{ width: 287 }} label={t("{0} 날짜", [property.name])}>
      <div className="date-inputs">
        <DateField label={t("시작")} value={start} withTime={withTime} active={picking === 'start'} onFocus={() => setPicking('start')}
          onChange={next => { setStart(next); if (next.day) setMonth(new Date(Number(next.day.slice(0, 4)), Number(next.day.slice(5, 7)) - 1, 1)); window.setTimeout(save, 0); }} />
        {hasEnd ? <DateField label={t("종료")} value={end} withTime={withTime} active={picking === 'end'} onFocus={() => setPicking('end')} onChange={next => { setEnd(next); window.setTimeout(save, 0); }} /> : null}
      </div>
      <div className="date-month-head">
        <div className="date-month-title">{formatYearMonth(month)}</div>
        <button type="button" className="date-today" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>{t("오늘")}</button>
        <button type="button" className="icon-button tiny" aria-label={t("이전 달")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon name="chevron-left" size={16} /></button>
        <button type="button" className="icon-button tiny" aria-label={t("다음 달")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="chevron-right" size={16} /></button>
      </div>
      <div className="date-grid" role="grid">
        {weekdayLabels().map(day => <div key={day} className="date-weekday">{day}</div>)}
        {cells.map(date => {
          const key = dayKey(date);
          const selected = key === start.day || (hasEnd && key === end.day);
          return (
            <button key={key} type="button" className={`date-day${date.getMonth() !== month.getMonth() ? ' other' : ''}${key === today ? ' today' : ''}${selected ? ' selected' : ''}${inRange(key) ? ' in-range' : ''}`} onClick={() => pickDay(key)}>
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="date-options">
        <div className="date-option-row" onClick={() => { const next = !hasEnd; setHasEnd(next); if (next) { setPicking('end'); if (!end.day && start.day) setEnd(start); } latest.current = { ...latest.current, hasEnd: next }; window.setTimeout(save, 0); }}>
          <span>{t("종료일")}</span><Switch checked={hasEnd} onChange={() => undefined} label={t("종료일")} />
        </div>
        <div className="date-option-row" onClick={() => { const next = !withTime; setWithTime(next); if (next && !start.time) setStart({ ...start, time: '09:00' }); latest.current = { ...latest.current, withTime: next }; window.setTimeout(save, 0); }}>
          <span>{t("시간 포함")}</span><Switch checked={withTime} onChange={() => undefined} label={t("시간 포함")} />
        </div>
        {withTime ? <label className="date-option-row date-zone-row" onClick={event => event.stopPropagation()}><span>{t("시간대")}</span>
          <select className="date-zone-select" value={zone} aria-label={t("시간대")} onChange={event => { setZone(event.target.value); latest.current = { ...latest.current, zone: event.target.value }; window.setTimeout(save, 0); }}>
            {zones.map(item => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}
          </select></label> : null}
        {!props.onChange ? <div className="date-option-row" onClick={event => setReminderMenu(event.currentTarget)}><span>{t("리마인드")}</span><span className="date-option-value">{t("reminder-row|설정")}{" "}<Icon name="chevron-right" size={14} /></span></div> : null}
        <div className="menu-separator" />
        <div className="date-option-row clear" onClick={() => { setStart({ day: '', time: '' }); setEnd({ day: '', time: '' }); latest.current = { start: { day: '', time: '' }, end: { day: '', time: '' }, hasEnd: false, withTime: false, zone }; setHasEnd(false); commitValue(props, null).catch(report); onClose(); }}>{t("지우기")}</div>
      </div>
      {reminderMenu ? <Menu anchor={reminderMenu} placement="right-start" width={220} entries={reminderEntries} onClose={() => setReminderMenu(null)} /> : null}
    </Popover>
  );
}

function DateField({ label, value, withTime, active, onChange, onFocus }: { label: string; value: { day: string; time: string }; withTime: boolean; active: boolean; onChange: (value: { day: string; time: string }) => void; onFocus: () => void }) {
  const [text, setText] = useState(value.day ? displayDate(value.day, { withTime: false }) : '');
  useEffect(() => { setText(value.day ? displayDate(value.day, { withTime: false }) : ''); }, [value.day]);
  const parse = (input: string) => {
    const iso = input.match(/(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
    if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
    if (/오늘|today/i.test(input)) return dayKey(new Date());
    if (/내일|tomorrow/i.test(input)) { const date = new Date(); date.setDate(date.getDate() + 1); return dayKey(date); }
    return null;
  };
  return (
    <div className={`date-field${active ? ' active' : ''}`}>
      <input aria-label={t("{0} 날짜", [label])} value={text} placeholder={label} onFocus={onFocus}
        onChange={event => setText(event.target.value)}
        onBlur={() => { const day = parse(text); if (day && day !== value.day) onChange({ ...value, day }); else setText(value.day ? displayDate(value.day, { withTime: false }) : ''); }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); (event.target as HTMLInputElement).blur(); } }} />
      {withTime ? <input aria-label={t("{0} 시각", [label])} type="time" className="date-time" value={value.time} onChange={event => onChange({ ...value, time: event.target.value })} /> : null}
    </div>
  );
}

// ----- relation -----

export function RelationPicker(props: ValueEditorProps) {
  const { property, anchor, onClose } = props;
  const ws = useWorkspace();
  const [selected, setSelected] = useState<string[]>(() => (props.value as string[] | null) ?? []);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const single = property.relationLimit === 1;
  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return ws.snapshot.objects.filter(item => item.kind === 'page' && (item as PageEntity).sourceId === property.targetSourceId && !(item as PageEntity).template && ws.visible(item.id) && item.id !== props.pageId)
      .filter(item => !needle || ((item as PageEntity).title || '').toLocaleLowerCase().includes(needle)) as PageEntity[];
  }, [ws.version, query, property.targetSourceId, props.pageId]);
  const unselected = candidates.filter(page => !selected.includes(page.id)).slice(0, 50);
  const save = (ids: string[]) => commitValue(props, ids).catch(report);
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter(item => item !== id) : single ? [id] : [...selected, id];
    setSelected(next); save(next);
    if (single && !selected.includes(id)) onClose();
  };
  const createTarget = async () => {
    if (!property.targetSourceId) return;
    const id = await createRow(property.targetSourceId, { title: query.trim(), open: false });
    const next = single ? [id] : [...selected, id];
    setSelected(next); setQuery('');
    await commitValue(props, next);
  };
  const target = ws.get(property.targetSourceId ?? '');
  return (
    <Popover anchor={anchor} placement={props.placement ?? 'below-start'} onClose={onClose} className="value-editor relation-picker" style={{ width: 360 }} label={t("{0} 관계", [property.name])}>
      <div className="relation-head">
        <input autoFocus className="text-input" placeholder={t("페이지 링크 또는 검색")} value={query}
          onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(unselected.length - (query.trim() ? 0 : 1), index + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
            if (event.key === 'Enter') { event.preventDefault(); const page = unselected[active]; if (page) toggle(page.id); else if (query.trim()) createTarget().catch(report); }
          }} />
        <div className="relation-target">{target ? t("{0}에서", [workspace.title(target)]) : ''}</div>
      </div>
      <div className="relation-list-scroll">
        {selected.length ? <div className="menu-heading">{t("{0}개 연결됨", [selected.length])}</div> : null}
        {selected.map(id => (
          <div key={id} className="relation-row linked">
            <RelationChip id={id} />
            <button type="button" className="icon-button small" aria-label={t("연결 해제")} onClick={() => toggle(id)}><Icon name="close" size={14} /></button>
          </div>
        ))}
        {unselected.length ? <div className="menu-heading">{selected.length ? t("다른 페이지 링크") : t("페이지 링크")}</div> : null}
        {unselected.map((page, index) => (
          <div key={page.id} className={`relation-row${index === active ? ' active' : ''}`} onPointerMove={() => setActive(index)} onClick={() => toggle(page.id)}>
            <EntityIcon item={page} size={18} /><span className="relation-row-title">{page.title || t("새 페이지")}</span>
            <Icon name="plus" size={16} className="relation-row-add" />
          </div>
        ))}
        {query.trim() ? (
          <div className={`relation-row create${active === unselected.length ? ' active' : ''}`} onClick={() => createTarget().catch(report)}>
            <Icon name="plus" size={16} /><span>{t("새 페이지 \"{0}\" 만들기", [query.trim()])}</span>
          </div>
        ) : null}
        {!unselected.length && !selected.length && !query.trim() ? <div className="menu-empty">{t("연결할 페이지가 없습니다")}</div> : null}
      </div>
    </Popover>
  );
}

// ----- files -----

export function FilesEditor(props: ValueEditorProps) {
  const { property, anchor, onClose, pageId } = props;
  const ws = useWorkspace();
  const [ids, setIds] = useState<string[]>(() => (props.value as string[] | null) ?? []);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Element | null>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      let current = ids;
      for (const file of [...files]) {
        if (props.onChange) {
          const result = await uploadFile(file, workspace.revision);
          current = [...current, result.attachmentId];
          props.onChange(current);
        } else {
          const result = await uploadFile(file, workspace.revision, { pageId, propertyId: property.id, attachmentIds: current });
          current = [...current, result.attachmentId];
        }
        setIds(current);
      }
    } catch (error) { report(error); } finally { setBusy(false); }
  };
  const remove = (id: string) => { const next = ids.filter(item => item !== id); setIds(next); commitValue(props, next).catch(report); };
  // Files in a cell reorder by dragging their handles.
  const [fileDrag, setFileDrag] = useState<{ id: string; over: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const startFileDrag = (event: React.PointerEvent, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('.files-row') ?? [])];
    let over = ids.indexOf(id);
    const move = (moveEvent: PointerEvent) => {
      const index = rows.findIndex(row => moveEvent.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
      over = index < 0 ? rows.length : index;
      setFileDrag({ id, over });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setFileDrag(null);
      const from = ids.indexOf(id), to = over > from ? over - 1 : over;
      if (from < 0 || to === from) return;
      const next = [...ids]; next.splice(from, 1); next.splice(to, 0, id);
      setIds(next); commitValue(props, next).catch(report);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // A box over the value listing the files and "+ 파일 또는 이미지 추가"; that
  // opens a 300-wide panel above it with the 업로드 tab and a blue "파일 업로드" button.
  return (
    <Popover anchor={anchor} placement={props.placement ?? 'cover'} onClose={onClose} className="value-editor files-editor" style={{ width: coverWidth(anchor, 320) }} label={t("{0} 파일", [property.name])}>
      <div className="files-list" ref={listRef}>
        {ids.map((id, index) => {
          const file = ws.get<AttachmentEntity>(id);
          return (
            <div key={id} className={`files-row${fileDrag?.id === id ? ' dragging' : ''}${fileDrag && fileDrag.over === index ? ' drop-before' : ''}${fileDrag && fileDrag.over === ids.length && index === ids.length - 1 ? ' drop-after' : ''}`}>
              {ids.length > 1 ? <span className="files-handle" aria-label={t("끌어서 순서 바꾸기")} onPointerDown={event => startFileDrag(event, id)}><Icon name="drag" size={14} /></span> : null}
              <Icon name={file?.mediaType.startsWith('image/') ? 'image' : 'file'} size={18} />
              <a href={`/api/attachments/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer">{file?.name ?? t("첨부")}</a>
              <button type="button" className="icon-button small" aria-label={t("제거")} onClick={() => remove(id)}><Icon name="close" size={14} /></button>
            </div>
          );
        })}
      </div>
      <button type="button" className={`files-add${busy ? ' disabled' : ''}`} onClick={event => setPanel(event.currentTarget)}><Icon name="plus" size={16} /><span>{busy ? t("올리는 중…") : t("파일 또는 이미지 추가")}</span></button>
      {panel ? (
        <Popover anchor={panel} placement="above-start" offset={2} onClose={() => setPanel(null)} className="files-upload-panel" style={{ width: 300 }} label={t("파일 추가")}>
          <div className="files-upload-tabs"><span className="files-upload-tab active">{t("업로드")}</span></div>
          <label className="files-upload-button">
            <span>{t("파일 업로드")}</span>
            <input type="file" multiple hidden onChange={event => { setPanel(null); upload(event.target.files); }} />
          </label>
          <p className="files-upload-hint">{t("16 MiB 이하 파일 · 이 컴퓨터의 로컬 첨부로 저장됩니다")}</p>
        </Popover>
      ) : null}
    </Popover>
  );
}

// ----- person (local names) -----

export function PersonEditor(props: ValueEditorProps) {
  const { property, anchor, onClose } = props;
  const ws = useWorkspace();
  const [names, setNames] = useState<string[]>(() => (props.value as string[] | null) ?? []);
  const [query, setQuery] = useState('');
  const known = useMemo(() => {
    const all = new Set<string>();
    for (const item of ws.snapshot.objects) if (item.kind === 'page') for (const value of Object.values((item as PageEntity).values ?? {})) if (Array.isArray(value) && value.every(entry => typeof entry === 'string') && ws.schema((item as PageEntity).sourceId ?? '').some(p => p.type === 'person')) value.forEach(name => all.add(name));
    all.add(t("나"));
    return [...all].filter(name => !names.includes(name) && name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => (a === t("나") ? -1 : b === t("나") ? 1 : 0)).slice(0, 8);
  }, [ws.version, names, query]);
  const save = (next: string[]) => { setNames(next); commitValue(props, next).catch(report); };
  const add = (name: string) => { const clean = name.trim(); if (!clean || names.includes(clean)) return; save([...names, clean]); setQuery(''); };
  return (
    <Popover anchor={anchor} placement={props.placement ?? 'cover'} onClose={onClose} className="value-editor person-editor" style={{ width: coverWidth(anchor, 300) }} label={t("{0} 사람", [property.name])}>
      <div className="option-input-area">
        {names.map(name => <span key={name} className="person-chip removable"><span className="avatar small">{avatarLetter(name)}</span>{name}<button type="button" aria-label={t("제거")} onClick={() => save(names.filter(item => item !== name))}><Icon name="close" size={12} /></button></span>)}
        <input autoFocus className="option-search" placeholder={names.length ? '' : t("사람 검색 또는 이름 입력…")} value={query} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(query); } if (event.key === 'Backspace' && !query && names.length) save(names.slice(0, -1)); }} />
      </div>
      <div className="option-list">
        <div className="option-list-head">{t("복수 선택 가능")}</div>
        {known.map(name => <div key={name} className="option-row" onClick={() => add(name)}><span className="avatar small">{name.slice(0, 1)}</span><span>{name}</span>{name === t("나") ? <span className="option-you">{t("(나)")}</span> : null}</div>)}
        {query.trim() && !known.includes(query.trim()) ? <div className="option-row option-create" onClick={() => add(query)}><span className="option-create-label">{t("추가:")}</span><span>{query.trim()}</span></div> : null}
      </div>
    </Popover>
  );
}

// ----- place -----

export function PlaceEditor(props: ValueEditorProps) {
  const { property, anchor, onClose } = props;
  const initial = (props.value ?? null) as { name?: string; latitude?: number; longitude?: number } | null;
  const [name, setName] = useState(initial?.name ?? '');
  const [latitude, setLatitude] = useState(initial?.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(initial?.longitude?.toString() ?? '');
  const [results, setResults] = useState<Array<{ name: string; latitude: number; longitude: number }> | null>(null);
  const [attribution, setAttribution] = useState('');
  const save = (value: unknown) => commitValue(props, value).catch(report);
  const read = () => name.trim() ? { name: name.trim(), ...(latitude ? { latitude: Number(latitude) } : {}), ...(longitude ? { longitude: Number(longitude) } : {}) } : null;
  const search = async () => {
    const data = await api<{ results: Array<{ name: string; latitude: number; longitude: number }>; attribution: string }>('/api/geocode', { query: name });
    setResults(data.results); setAttribution(data.attribution);
  };
  // 현재 위치 ("Use current location"): the browser's position, kept as coordinates on this computer only.
  const [locating, setLocating] = useState(false);
  const here = () => {
    if (!navigator.geolocation) { report(new Error(t("이 브라우저는 위치를 알려 주지 않습니다."))); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      setLocating(false);
      const lat = Number(position.coords.latitude.toFixed(6)), lon = Number(position.coords.longitude.toFixed(6)), label = name.trim() || t("현재 위치");
      setName(label); setLatitude(String(lat)); setLongitude(String(lon));
      save({ name: label, latitude: lat, longitude: lon });
    }, error => { setLocating(false); report(new Error(error.code === 1 ? t("위치 권한이 없습니다. 브라우저 설정에서 허용하세요.") : t("현재 위치를 알 수 없습니다."))); }, { timeout: 15000, maximumAge: 60000 });
  };
  return (
    <Popover anchor={anchor} placement={props.placement ?? 'below-start'} onClose={() => { const value = read(); if (JSON.stringify(value) !== JSON.stringify(initial)) save(value); onClose(); }} className="value-editor place-editor" style={{ width: 320 }} label={t("{0} 위치", [property.name])}>
      <div className="place-fields">
        <input autoFocus className="text-input" placeholder={t("장소 이름")} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); search().catch(report); } }} />
        <div className="place-coords">
          <input className="text-input" placeholder={t("위도")} inputMode="decimal" value={latitude} onChange={event => setLatitude(event.target.value)} />
          <input className="text-input" placeholder={t("경도")} inputMode="decimal" value={longitude} onChange={event => setLongitude(event.target.value)} />
        </div>
        <div className="place-actions">
          <button type="button" className="outline-button small" disabled={!name.trim()} onClick={() => search().catch(report)}>{t("공개 장소 찾기")}</button>
          <button type="button" className="outline-button small" disabled={locating} onClick={here}><Icon name="map" size={14} />{locating ? t("위치 찾는 중…") : t("현재 위치")}</button>
        </div>
        <p className="value-editor-note">{t("찾기를 누르면 장소 이름을 Photon(OpenStreetMap)에 보냅니다. 개인 주소는 좌표를 직접 입력하세요.")}</p>
      </div>
      {results ? (
        <div className="option-list">
          {results.map((place, index) => <div key={index} className="option-row" onClick={() => { setName(place.name); setLatitude(String(place.latitude)); setLongitude(String(place.longitude)); setResults(null); save(place); }}><Icon name="map" size={16} /><span>{place.name}</span></div>)}
          {!results.length ? <div className="menu-empty">{t("결과 없음")}</div> : null}
          {attribution ? <p className="value-editor-note">{attribution}</p> : null}
        </div>
      ) : null}
    </Popover>
  );
}

// ---------- property value cell for page properties / forms ----------

export interface EditableValueProps { pageId: string; property: PropertyEntity; value: unknown; row?: QueryRow; placeholder?: string; className?: string; onChange?: (value: unknown) => void; wrap?: boolean }

export function EditableValue({ pageId, property, value, row, placeholder = t("비어 있음"), className, onChange, wrap = true }: EditableValueProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { value: shown, drafted } = onChange ? { value, drafted: false } : shownValue(pageId, property, value);
  const readOnly = readOnlyTypes.has(property.type);
  if (property.type === 'button') {
    return (
      <div className={`editable-value${className ? ` ${className}` : ''}`}>
        <button type="button" className="outline-button small property-button" onClick={() => { const live = workspace.get<PropertyEntity>(property.id); if (live) runButton(live, pageId).catch(report); }}>{property.button?.label || property.name}</button>
      </div>
    );
  }
  const toggleCheckbox = () => {
    const next = shown !== true;
    if (onChange) onChange(next); else saveValue(pageId, property, next).catch(report);
  };
  const empty = shown == null || shown === '' || (Array.isArray(shown) && !shown.length);
  return (
    <>
      <div className={`editable-value${className ? ` ${className}` : ''}${readOnly ? ' read-only' : ''}${drafted ? ' drafted' : ''}${empty ? ' empty' : ''}`} data-type={property.type}
        role={readOnly ? undefined : 'button'} tabIndex={readOnly ? undefined : 0} title={drafted ? t("저장하지 못한 입력이 있습니다") : undefined}
        onClick={event => { if (readOnly) return; if (property.type === 'checkbox') { toggleCheckbox(); return; } setAnchor(event.currentTarget); }}
        onKeyDown={event => { if (readOnly) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (property.type === 'checkbox') toggleCheckbox(); else setAnchor(event.currentTarget); } }}>
        {empty && property.type !== 'checkbox' ? <span className="value-placeholder">{readOnly ? '' : placeholder}</span> : <ValueView property={property} value={shown} row={row} mode="page" wrap={wrap} />}
      </div>
      {anchor ? <ValueEditor anchor={anchor} pageId={pageId} property={property} value={shown} onClose={() => setAnchor(null)} onChange={onChange ? next => onChange(next) : undefined} /> : null}
    </>
  );
}

export function openRow(rowId: string, mode: 'side' | 'center' | 'page' = 'side') {
  if (mode === 'page') navigate(rowId); else openPeek(rowId, mode);
}

// A number shown as a number, a bar or a ring ("Show as"). The value fills it up to "divide by"
// (100 for numbers, 1 for percentages), and the number can show beside it.
export function NumberValue({ value, format }: { value: number; format?: NumberFormat }) {
  const text = format ? formatNumber(value, format) : String(value);
  if (!format?.display || format.display === 'number') return <span className="number-value">{text}</span>;
  const total = format.divideBy ?? (format.style === 'percent' ? 1 : 100);
  const ratio = Math.max(0, Math.min(1, total ? value / total : 0));
  const color = format.color ?? 'green';
  const label = format.showNumber === false ? null : <span className="number-shown">{text}</span>;
  if (format.display === 'ring') {
    const radius = 6, length = 2 * Math.PI * radius;
    return (
      <span className={`number-ring number-color-${color}`} title={text}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r={radius} className="ring-track" /><circle cx="8" cy="8" r={radius} className="ring-fill" strokeDasharray={`${length * ratio} ${length}`} transform="rotate(-90 8 8)" /></svg>
        {label}
      </span>
    );
  }
  return <span className={`number-bar number-color-${color}`} title={text}>{label}<span className="bar-track"><span className="bar-fill" style={{ width: `${ratio * 100}%` }} /></span></span>;
}
