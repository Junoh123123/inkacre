import {mapTiles,mapPoint} from './map-layout.mjs';
import {highlightCode} from './code-highlight.mjs';
import {textBlocks,htmlBlocks} from './paste-blocks.mjs';
import {cellRange,clipboardRows,pastedValue} from './table-grid.mjs';
import katex from '/katex.mjs';
import { splitRuns, runsText, selectedRuns, replaceRuns, patchRuns, toggleMark, blockOrdinal, markdownBlock } from './rich-text.mjs';
import { monthDays, shiftMonth, onCalendarDay, timelineLayout, chartScale, projectPlace, moveMap, formatNumber,weekDays,shiftDay,moveDateToDay,shiftDateRange,displayDay } from './view-layout.mjs';

const $ = selector => document.querySelector(selector);
let state = { revision: 0, objects: [] }, objects = new Map(), selected = new URL(location.href).searchParams.get('id');
let undoTarget = null, redoTarget = null, rendering = 0, detailRendering = 0, recordDialog = null, detailId = null, connected = true;
const pendingSaves = new Set();
const viewPositions = new Map();
const blockSelection=new Set();let blockAnchor=null;
const pendingKey = 'pageyard-pending-v1';
const snapshotKey = 'pageyard-last-state-v1';
const valueDraftKey = (pageId, propertyId) => `pageyard-value-draft:${encodeURIComponent(pageId)}:${encodeURIComponent(propertyId)}`;
const blockFieldKey = (id, field) => `pageyard-block-field:${encodeURIComponent(id)}:${field}`;
const pending = new Map(JSON.parse(localStorage.getItem(pendingKey) ?? '[]'));
const blockLabels = { paragraph: '텍스트', heading1: '제목1', heading2: '제목2', heading3: '제목3', bullet: '글머리 기호 목록', numbered: '번호 매기기 목록', todo: '할 일 목록', toggle: '토글 목록', quote: '인용', code: '코드', divider: '구분선', callout: '콜아웃', bookmark: '웹 북마크', image: '이미지', file: '파일', synced: '동기화 블록', synced_reference: '동기화 참조', button: '버튼' };
const propertyLabels = { text: '텍스트', number: '숫자', checkbox: '체크박스', select: '선택', multi_select: '다중 선택', status: '상태', date: '날짜', url: 'URL', email: '이메일', phone: '전화번호', person: '사람', files: '파일과 미디어', relation: '관계형', formula: '수식', rollup: '롤업', place: '위치', created_time: '생성 일시', last_edited_time: '최종 편집 일시', created_by: '생성자', last_edited_by: '최종 편집자', unique_id: 'ID' };
propertyLabels.button = '버튼';
Object.assign(blockLabels,{table:'표',columns:'다단 열',column:'열',toc:'목차',math:'수학 공식 블록',video:'동영상'});
const slashGlyphs={paragraph:'T',heading1:'H₁',heading2:'H₂',heading3:'H₃',bullet:'•',numbered:'1.',todo:'☐',toggle:'▸',quote:'❝',code:'</>',divider:'—',callout:'!',bookmark:'↗',image:'▣',file:'⎘',button:'◉',table:'⊞',columns:'⫼',toc:'≣',math:'√x',video:'▶'};
const slashHints={heading1:'#',heading2:'##',heading3:'###',bullet:'-',numbered:'1.',todo:'[]',toggle:'>',quote:'"',divider:'---'};
const colors=['default','gray','brown','orange','yellow','green','blue','purple','pink','red'];
const aggregateLabels={count:'모두 세기',count_nonempty:'비어 있지 않은 값 세기',count_empty:'빈 값 세기',sum:'합계',average:'평균',min:'최소',max:'최대',median:'중앙값',percent_empty:'빈 값 세기(%)',percent_not_empty:'비어 있지 않은 값 세기(%)',checked:'체크한 개수',unchecked:'체크 안 한 개수',percent_checked:'체크 비율',percent_unchecked:'미체크 비율',earliest_date:'가장 이른 날짜',latest_date:'최근 날짜',date_range:'날짜 범위',values:'전체 값',unique:'고유 값'};
function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), event => { try { Promise.resolve(value(event)).catch(report); } catch (error) { report(error); } });
    else if (key === 'class') node.className = value;
    else if (value !== false && value != null) { if (key in node && !key.startsWith('aria-') && !key.startsWith('data-')) node[key] = value; else node.setAttribute(key, value); }
  }
  for (const child of children.flat(Infinity)) if (child != null && typeof child !== 'boolean') node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), event => { try { Promise.resolve(value(event)).catch(report); } catch (error) { report(error); } });
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function svgButton(name, action, ...children) {
  return svg('g', { role: 'button', tabindex: '0', 'aria-label': name, onclick: action, onkeydown: event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); return action(); } } }, svg('title', {}, name), ...children);
}
const button = (text, action, attributes = {}) => element('button', { type: 'button', onclick: action, ...attributes }, text);
const label = (text, control) => {
  if (control?.matches('input,select,textarea') && !control.hasAttribute('aria-label')) control.setAttribute('aria-label', text);
  return element('label', {}, text, control);
};
const input = (value = '', attributes = {}) => element('input', { value: value ?? '', ...attributes });
function select(options, value, attributes = {}) {
  return element('select', attributes, options.map(option => element('option', { value: option.id, selected: Array.isArray(value) ? value.includes(option.id) : option.id === value }, option.name)));
}
const icon = name => element('span', { class: `icon icon-${name}`, 'aria-hidden': 'true' });
const iconButton = (name, text, action, attributes = {}) => button(icon(name), action, { 'aria-label': text, title: text, ...attributes, class: `icon-button ${attributes.class ?? ''}` });
let openPopover = null, toastTimer;
function closePopover() { openPopover?.close(); }
function popover(anchor, build, { className = '', align = 'start', cover = false } = {}) {
  closePopover();
  const panel = element('div', { class: `popover ${className}` }), host = anchor.closest('dialog') ?? document.body;
  if ('showPopover' in panel) panel.popover = 'manual';
  const place = () => {
    const rect = anchor.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight;
    let left = align === 'end' ? rect.right - width : rect.left, top = cover ? rect.top : rect.bottom + 4;
    if (top + height > innerHeight - 8) top = Math.max(8, rect.top - height - 4);
    panel.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`; panel.style.top = `${top}px`;
  };
  const outside = event => { if (!panel.contains(event.target) && !anchor.contains(event.target)) close(); };
  const keys = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); anchor.focus?.(); } };
  function close() {
    if (openPopover !== api) return; openPopover = null;
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keys, true); removeEventListener('resize', place);
    panel.remove(); anchor.setAttribute?.('aria-expanded', 'false');
  }
  const api = { close, panel, place }; openPopover = api;
  host.append(panel); panel.append(...[build(api)].flat().filter(Boolean)); if (panel.popover) panel.showPopover();
  place(); anchor.setAttribute?.('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true); addEventListener('resize', place);
  return api;
}
function menu(anchor, items, options = {}) {
  return popover(anchor, api => {
    const nodes = items.filter(Boolean).map(item => {
      if (item === '-') return element('div', { class: 'menu-separator', role: 'separator' });
      if (item.heading) return element('div', { class: 'menu-heading' }, item.heading);
      if (item.node) return item.node;
      return element('button', { type: 'button', role: 'menuitem', class: `menu-item${item.danger ? ' danger' : ''}`, disabled: item.disabled, onclick: async () => { api.close(); await item.action(); } },
        item.icon ? icon(item.icon) : element('span', { class: 'icon' }), element('span', { class: 'menu-label' }, item.label), item.hint ? element('span', { class: 'menu-hint' }, item.hint) : null);
    });
    const list = element('div', { class: 'menu', role: 'menu', onkeydown: event => {
      const buttons = [...list.querySelectorAll('.menu-item:not(:disabled)')], index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    } }, nodes);
    queueMicrotask(() => list.querySelector('.menu-item:not(:disabled)')?.focus());
    return list;
  }, { className: 'menu-popover', ...options });
}
const tagColors = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
function optionColor(property, option) {
  if (tagColors.includes(option?.color)) return option.color;
  if (property?.type !== 'status') return 'default';
  const group = `${option?.group ?? ''}`.toLowerCase();
  return /완료|done|complete/.test(group) ? 'green' : /진행|progress|doing/.test(group) ? 'blue' : 'gray';
}
const tag = (text, color = 'default', extra = '') => element('span', { class: `tag tag-${color} ${extra}` }, text);
function displayDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text ?? ''); if (!match) return text ?? '';
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일${match[4] ? ` ${match[4]}:${match[5]}` : ''}`;
}
function displayValue(property, value) {
  if (value?.error) return element('span', { class: 'error' }, format(value, property));
  if (value == null || (Array.isArray(value) && !value.length) || value === '') return null;
  if (['select', 'status', 'multi_select'].includes(property.type)) return (Array.isArray(value) ? value : [value]).map(id => { const option = property.options?.find(item => item.id === id); return tag(option?.name ?? id, optionColor(property, option), property.type === 'status' ? 'tag-status' : ''); });
  if (property.type === 'relation') return (Array.isArray(value) ? value : [value]).map(id => element('span', { class: 'relation-chip' }, icon('page'), objects.get(id)?.title || '삭제된 항목'));
  if (property.type === 'date') return `${displayDate(value.start)}${value.end ? ` → ${displayDate(value.end)}` : ''}`;
  if (property.type === 'files') return value.map(id => element('span', { class: 'file-chip' }, icon('file'), objects.get(id)?.name ?? '첨부'));
  if (property.type === 'person') return value.map(name => element('span', { class: 'person-chip' }, element('span', { class: 'avatar', 'aria-hidden': 'true' }, String(name).slice(0, 1)), name));
  if (value?.type === 'formatted_text') return richNodes(value.richText);
  return format(value, property);
}
const inlineEditing = ['checkbox', 'button', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'];
function cellEditor(page, property, value, save, { placeholder = '' } = {}) {
  if (inlineEditing.includes(property.type)) return valueControl(page, property, value, save);
  const key = page.id ? valueDraftKey(page.id, property.id) : null, draft = key && localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)) : null;
  const shown = draft && JSON.stringify(draft.value) !== JSON.stringify(value) ? draft.value : value, content = displayValue(property, shown);
  const trigger = element('button', { type: 'button', class: `cell-value${shown !== value ? ' drafted' : ''}`, 'data-type': property.type, 'aria-haspopup': 'dialog', 'aria-label': `${page.title ?? '항목'} · ${property.name} 편집`, title: shown !== value ? '저장하지 못한 입력이 있습니다' : null, onclick: event => {
    if (event.altKey || event.shiftKey) return;
    if (['select', 'status'].includes(property.type) && page.id) return optionPicker(trigger, page, property, shown, save);
    popover(trigger, () => {
      const control = valueControl(page, property, value, save), field = element('div', { class: 'cell-editor', 'data-type': property.type }, element('div', { class: 'cell-editor-label' }, icon(`type-${property.type}`), property.name), control);
      queueMicrotask(() => (control.matches?.('input,select,textarea') ? control : control.querySelector?.('input:not([type=checkbox]),select,textarea'))?.focus());
      return field;
    }, { className: 'cell-popover' });
  } }, content ?? element('span', { class: 'placeholder' }, placeholder));
  return trigger;
}
function status(text, error = false) {
  const output = $('#status'); output.textContent = text; output.title = text; output.className = error ? 'error' : ''; $('#retry').hidden = !pending.size;
  const toast = $('#toast'); clearTimeout(toastTimer);
  if (error) { toast.textContent = text; toast.hidden = false; toastTimer = setTimeout(() => { toast.hidden = true; }, 7000); } else toast.hidden = true;
}
function report(error) { status(error.message ?? String(error), true); }
async function api(route, body) {
  const readOnly = body === undefined || ['/api/query', '/api/search', '/api/export', '/api/import/preview'].includes(route);
  let cache, key;
  if (readOnly && 'caches' in window) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([route, body ?? null])));
    key = `/__cached_read__/${[...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
    try { cache = await caches.open('pageyard-reads-v1'); } catch {}
  }
  try {
    const response = await fetch(route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error.message); error.code = data.error.code; error.details = data.error.details; throw error; }
    connected = true;
    if (cache) try { await cache.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })); } catch {}
    return data;
  } catch (error) {
    if (error.code) throw error;
    connected = false;
    const response = cache && await cache.match(key);
    if (response) {
      const cached = await response.json();
      if (route === '/api/state' || cached.revision === undefined || cached.revision === state.revision) return cached;
      throw new Error('이 화면의 저장 사본이 현재 자료보다 오래됐습니다. 앱에 다시 연결한 뒤 열어 주세요.');
    }
    throw error;
  }
}
function storeLocal(key, value) {
  try { localStorage.setItem(key, value); }
  catch (error) { localStorage.removeItem(snapshotKey); if (key !== snapshotKey) localStorage.setItem(key, value); }
}
function persistPending() { storeLocal(pendingKey, JSON.stringify([...pending])); $('#retry').hidden = !pending.size; }
const uploadBytesKey = id => `/__pending_upload__/${encodeURIComponent(id)}`;
async function uploadBytes(id, value) {
  const cache = await caches.open('pageyard-uploads-v1'), key = uploadBytesKey(id);
  if (value === null) return cache.delete(key);
  if (value !== undefined) return cache.put(key, new Response(value));
  const response = await cache.match(key);
  if (!response) { const error = new Error('보류한 파일 사본을 찾을 수 없습니다. 파일을 다시 선택하세요.'); error.code = 'UPLOAD_BYTES_MISSING'; throw error; }
  return response.text();
}
async function uploadFile(file, expectedRevision, reference) {
  if (file.size > 16 * 1024 * 1024) throw new Error('16 MiB 이하 파일을 선택하세요.');
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  const id = crypto.randomUUID(); await uploadBytes(id, btoa(binary));
  return sendCommand({ id, actor: 'user', expectedRevision, name: file.name, mediaType: file.type || 'application/octet-stream', ...(reference ? { reference } : {}) }, '/api/attachments');
}
function commandDrafts(operation) {
  const drafts = [];
  if (operation.type === 'block.update') {
    if (operation.richText !== undefined) drafts.push([`pageyard-draft:${operation.id}`, operation.richText]);
    for (const field of ['url', 'language']) if (operation[field] !== undefined) drafts.push([blockFieldKey(operation.id, field), operation[field]]);
  }
  if (['value.set', 'relation.set'].includes(operation.type)) drafts.push([valueDraftKey(operation.pageId, operation.propertyId), operation.value ?? operation.targetIds ?? null]);
  if (operation.type === 'page.update' && operation.title !== undefined) drafts.push([`pageyard-title-draft:${operation.id}`, operation.title]);
  return drafts;
}
async function sendCommand(command, route = '/api/commands') {
  pending.set(command.id, { route, command }); persistPending();
  try {
    const request = route === '/api/attachments' ? { commandId: command.id, ...Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'id')), base64: await uploadBytes(command.id) } : command;
    const result = await api(route, request);
    for (const operation of command.operations ?? []) for (const [key, value] of commandDrafts(operation)) {
      if (!localStorage.getItem(key)) continue;
      const draft = JSON.parse(localStorage.getItem(key));
      if (JSON.stringify(draft.richText ?? draft.value) === JSON.stringify(value)) localStorage.removeItem(key);
      else if (draft.baseRevision === command.expectedRevision) storeLocal(key, JSON.stringify({ ...draft, baseRevision: result.revision }));
    }
    pending.delete(command.id); persistPending();
    if (route === '/api/attachments') await uploadBytes(command.id, null).catch(() => {});
    undoTarget = result.undoHandle; redoTarget = null;
    $('#undo').disabled = !undoTarget; $('#redo').disabled = true;
    status(`저장됨 · ${result.revision}`); return result;
  } catch (error) {
    if (error.code === 'REVISION_CONFLICT') error.message = '다른 변경이 저장됐습니다. 입력을 보존한 채 최신 상태를 확인하세요.';
    else if (!error.code) error.message = '앱에 연결할 수 없습니다. 보류한 저장은 이 브라우저에 보존했습니다.';
    if (error.code && error.code !== 'REVISION_CONFLICT') { pending.delete(command.id); if (route === '/api/attachments') await uploadBytes(command.id, null).catch(() => {}); }
    else pending.get(command.id).error = { code: error.code ?? 'CONNECTION', message: error.message };
    persistPending();
    throw error;
  }
}
async function apply(operations, revision, { freshCommand = false } = {}) {
  await Promise.all(pendingSaves);
  const previous = !freshCommand && [...pending.values()].find(item => item.route === '/api/commands' && JSON.stringify(item.command.operations) === JSON.stringify(operations));
  const result = await sendCommand(previous?.command ?? { id: crypto.randomUUID(), actor: 'user', expectedRevision: revision ?? state.revision, operations });
  await refresh(true); return result;
}
function visible(id, seen = new Set()) {
  const item = objects.get(id); if (!item?.alive || seen.has(id)) return false; seen.add(id);
  const config = objects.get(item.sourceId)?.tasks?.subitems, parent = config?.enabled && item.values?.[config.parentPropertyId]?.[0];
  return (item.parentId == null || visible(item.parentId, new Set(seen))) && (!parent || visible(parent, new Set(seen)));
}
const childrenOf = parentId => state.objects.filter(item => item.parentId === parentId && item.alive).sort((a, b) => a.position - b.position);
const schemaOf = sourceId => state.objects.filter(item => item.kind === 'property' && item.sourceId === sourceId && item.alive).sort((a, b) => a.position - b.position);
const sources = () => state.objects.filter(item => item.kind === 'source' && visible(item.id));
function navigate(id, push = true) { recordDialog?.close();if(id!==selected){blockSelection.clear();blockAnchor=null;} selected = id;if(id)storeLocal('pageyard-recent',JSON.stringify([id,...JSON.parse(localStorage.getItem('pageyard-recent')??'[]').filter(x=>x!==id)].slice(0,30))); if (push) history.pushState({}, '', id ? `/?id=${encodeURIComponent(id)}` : '/'); return render().catch(report); }
const favorites=()=>objects.get('workspace-navigation')?.favorites??[];
function quickSwitch(){const query=input('',{'aria-label':'빠른 전환 검색',placeholder:'페이지·데이터베이스·보기 이름으로 이동'}),list=element('div',{class:'switch-list'}),dialog=modal('빠른 전환',[query,list],null);dialog.classList.add('switch-dialog');const draw=()=>{const text=query.value.toLocaleLowerCase(),recent=JSON.parse(localStorage.getItem('pageyard-recent')??'[]'),ordered=[...new Set([...favorites(),...recent,...state.objects.filter(x=>['page','source','view'].includes(x.kind)).map(x=>x.id)])];list.replaceChildren(...ordered.map(id=>objects.get(id)).filter(x=>x&&visible(x.id)&&!x.template&&(x.title??x.name??'').toLocaleLowerCase().includes(text)).slice(0,40).map(x=>button([x.icon?element('span',{class:'link-icon','aria-hidden':'true'},x.icon):icon(x.kind==='view'?`view-${x.viewType??'table'}`:x.kind==='source'?'source':'page'),element('span',{},x.title??x.name)],()=>{dialog.close();navigate(x.id)},{'aria-label':x.title??x.name})));};query.addEventListener('input',draw);query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();list.querySelector('button')?.click()}});draw();query.focus();}
function pageAppearance(page){const revision=state.revision,icon=input(page.icon??''),cover=select([{id:'',name:'커버 없음'},...state.objects.filter(x=>x.kind==='attachment'&&x.alive&&x.mediaType.startsWith('image/')).map(x=>({id:x.id,name:x.name}))],page.coverAttachmentId??''),wide=input('',{type:'checkbox',checked:page.fullWidth});modal('페이지 표시',[label('아이콘',icon),label('커버 이미지',cover),label('전체 너비',wide)],()=>apply([{type:'page.update',id:page.id,icon:icon.value||null,coverAttachmentId:cover.value||null,fullWidth:wide.checked}],revision));}
// 보기 탭 넘침(들어가는 탭 + 선택 탭 + "N개 더"). 숨긴 탭은 "N개 더" 메뉴에서 연다.
function fitTabs(tabs) {
  const update = () => {
    const links = [...tabs.querySelectorAll(':scope > a')], more = tabs.querySelector('.tab-more'); if (!tabs.isConnected || !tabs.clientWidth) return;
    for (const tab of links) tab.hidden = false; more.hidden = true;
    const available = tabs.clientWidth - 2, widths = links.map(tab => tab.offsetWidth + 2);
    if (widths.reduce((sum, width) => sum + width, 0) <= available) return;
    more.hidden = false; more.textContent = `${links.length}개 더 보기...`;
    const active = links.findIndex(tab => tab.classList.contains('active')), shown = new Set(active >= 0 ? [active] : []);
    let used = more.offsetWidth + 2 + (active >= 0 ? widths[active] : 0);
    for (let index = 0; index < links.length; index++) { if (index === active) continue; if (used + widths[index] > available) break; used += widths[index]; shown.add(index); }
    links.forEach((tab, index) => { tab.hidden = !shown.has(index); });
    more.textContent = `${links.length - shown.size}개 더 보기...`;
  };
  new ResizeObserver(() => requestAnimationFrame(update)).observe(tabs);
  return tabs;
}
function link(item) { return element('a', { href: `/?id=${encodeURIComponent(item.id)}`, 'aria-current': item.id === selected ? 'page' : null, 'data-kind': item.kind, 'data-view-type': item.kind === 'view' ? item.viewType ?? 'table' : null, class: item.icon ? 'has-icon' : null, onclick: event => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); navigate(item.id); } } }, item.icon ? element('span', { class: 'link-icon', 'aria-hidden': 'true' }, item.icon) : null, element('span', { class: 'link-text' }, item.title || item.name || '제목 없음')); }
function recordLink(item, view) {
  return element('a', { href: `/?id=${encodeURIComponent(item.id)}`, onclick: event => {
    if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); return openRecord(item.id, view?.config.openMode ?? 'side'); }
  } }, item.title || '제목 없음');
}
async function openRecord(id, mode) {
  if (mode === 'page') { navigate(id); return; }
  recordDialog?.close(); detailId = id;
  recordDialog = element('dialog', { class: `record-detail detail-${mode}`, 'aria-label': '항목 상세' },
    element('div', { class: 'toolbar peek-toolbar' }, iconButton('peek-close', '상세 닫기', () => recordDialog.close()), iconButton('expand', '전체 페이지로 열기', () => navigate(id)), element('span', { class: 'peek-spacer' }), iconButton('more', '페이지 메뉴', event => { const item = objects.get(id); if (item) pageMenu(event.currentTarget, item); }, { 'aria-haspopup': 'menu' })), element('div', { class: 'detail-content' }));
  recordDialog.addEventListener('close', event => { event.target.remove(); if (event.target === recordDialog) { recordDialog = null; detailId = null; } });
  document.body.append(recordDialog); recordDialog.showModal(); await renderDetail();
}
async function renderDetail() {
  if (!recordDialog?.open) return;
  const generation = ++detailRendering, dialog = recordDialog, id = detailId, content = element('div'), current = objects.get(id);
  if (current?.kind === 'page' && visible(current.id)) await renderPage(content, current);
  else content.append(element('p', {}, '이 항목은 휴지통에 있거나 더 이상 존재하지 않습니다.'));
  if (generation === detailRendering && dialog === recordDialog && id === detailId) dialog.querySelector('.detail-content').replaceChildren(...content.childNodes);
}
function desktopNotifications(){
 if(!('Notification' in window)||Notification.permission!=='granted'||localStorage.getItem('pageyard-desktop-notifications')!=='on')return;
 const seen=new Set(JSON.parse(localStorage.getItem('pageyard-notifications-seen')??'[]'));
 for(const note of state.objects.filter(o=>o.kind==='notification'&&!o.read&&visible(o.id)))if(!seen.has(note.id)){const notification=new Notification('Inkacre',{body:note.message,tag:note.id});notification.onclick=()=>{let parent=objects.get(note.parentId);while(parent&&parent.kind!=='page')parent=objects.get(parent.parentId);if(parent)navigate(parent.id);notification.close()};seen.add(note.id);}
 storeLocal('pageyard-notifications-seen',JSON.stringify([...seen].slice(-1000)));
}
async function configureDesktopNotifications(){if(!('Notification' in window))throw new Error('이 브라우저는 데스크톱 알림을 지원하지 않습니다.');if(localStorage.getItem('pageyard-desktop-notifications')==='on'){localStorage.removeItem('pageyard-desktop-notifications');return render()};const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('알림 권한이 허용되지 않았습니다. 받은 알림에서는 계속 확인할 수 있습니다.');storeLocal('pageyard-desktop-notifications','on');desktopNotifications();return render();}
async function refresh(force = false) {
  if (!force && document.activeElement?.matches('input,textarea,select,[contenteditable=true]')) { status(pending.size ? '저장 결과를 확인하지 못한 입력이 있습니다. 보류한 저장을 확인하세요.' : '새 변경이 있습니다. 현재 입력을 마친 뒤 최신 상태를 확인하세요.'); return; }
  state = await api('/api/state'); objects = new Map(state.objects.map(item => [item.id, item]));
  storeLocal(snapshotKey, JSON.stringify(state));desktopNotifications(); await render(); await renderDetail();
  if (!connected) status(`연결 끊김 · 마지막 확인 ${state.revision} · 새 입력은 이 브라우저에 보존합니다.`, true);
  else if (/^(저장됨|연결됨) · \d+$/.test($('#status').textContent)) status(`연결됨 · ${state.revision}`);
}
function modal(title, fields, action) {
  const dialog = element('dialog', { 'aria-label': title });
  const form = element('form', { onsubmit: async event => { event.preventDefault(); try { if (action) await action(); dialog.close(); } catch (error) { errorText.textContent = error.message; } } }, element('h2', {}, title), fields);
  const errorText = element('p', { class: 'error', role: 'alert' });
  form.append(errorText, element('div', { class: 'toolbar dialog-actions' }, button(action ? '취소' : '닫기', () => dialog.close()), action && element('button', { type: 'submit' }, '저장')));
  dialog.append(form); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal(); return dialog;
}
function buttonEditor(initial = {}, sourceId) {
  const caption = input(initial.label ?? '실행'), confirmation = input(initial.confirmation ?? ''), list = element('div'), entries = [];
  const pages = () => state.objects.filter(item=>item.kind==='page'&&!item.template&&visible(item.id)).map(item=>({id:item.id,name:item.title}));
  const targets = [{id:'$this',name:'현재 페이지/항목'},{id:'$created',name:'앞 액션에서 만든 페이지'},...pages()];
  const writable = id => schemaOf(id).filter(p=>!['formula','rollup','created_time','last_edited_time','created_by','last_edited_by','unique_id','button','files'].includes(p.type));
  function add(saved = {action:'set_property'}) {
    const kind = select([{id:'set_property',name:'속성 변경'},{id:'add_page',name:'페이지 만들기'},{id:'edit_pages',name:'조건에 맞는 항목 변경'},{id:'insert_blocks',name:'본문 블록 삽입'},{id:'open_page',name:'페이지 열기'},{id:'notify',name:'받은 알림에 남기기'},{id:'send_webhook',name:'Webhook/Slack 전송'},{id:'send_email',name:'이메일 전송'}],saved.action,{'aria-label':'액션 종류'}), fields = element('div'); let read;
    const entry = {read:()=>read()}, row = element('fieldset',{},kind,fields,button('액션 위로',()=>{const i=entries.indexOf(entry);if(i>0){[entries[i-1],entries[i]]=[entry,entries[i-1]];list.insertBefore(row,row.previousElementSibling)}}),button('액션 제거',()=>{entries.splice(entries.indexOf(entry),1);row.remove()}));
    function draw(data = {}) {
      fields.replaceChildren();
      const target = select(targets,data.targetId ?? '$this'), source = select(sources().map(s=>({id:s.id,name:s.name})),data.sourceId ?? sourceId ?? sources()[0]?.id), title = input(data.title ?? ''), message = input(data.message ?? '');
      if (kind.value==='set_property'||kind.value==='edit_pages') {
        const property = select([],data.propertyId ?? ''), holder = element('div');let value=data.value ?? null, filters;
        const values = () => {const p=objects.get(property.value);value=data.propertyId===property.value ? data.value ?? null : null;holder.replaceChildren(p && valueControl({title:'액션 값'},p,value,async next=>{value=next},{draftOnly:true}));};
        const update = () => {const targetSource=kind.value==='edit_pages'?source.value:target.value==='$created'?source.value:target.value==='$this'?sourceId:objects.get(target.value)?.sourceId;const options=writable(targetSource||source.value);property.replaceChildren(...options.map(p=>element('option',{value:p.id,selected:p.id===data.propertyId},p.name)));values();};
        property.addEventListener('change',values);target.addEventListener('change',update);source.addEventListener('change',()=>{update();if(filters){filters=filterEditor(schemaOf(source.value));filterHolder.replaceChildren(filters.node)}});update();
        const filterHolder=element('div');if(kind.value==='edit_pages'){filters=filterEditor(schemaOf(source.value),data.filter);filterHolder.append(filters.node);}
        fields.append(kind.value==='edit_pages'?label('항목 데이터베이스',source):label('대상 페이지',target),kind.value==='set_property'&&label('속성을 선택할 데이터베이스',source),label('변경할 속성',property),holder,filterHolder);
        read=()=>({action:kind.value,propertyId:property.value,value,...(kind.value==='edit_pages'?{sourceId:source.value,filter:filters.read()??{all:[]}}:{targetId:target.value})});
      } else if (kind.value==='add_page') {
        fields.append(label('데이터베이스',source),label('새 페이지 제목',title));read=()=>({action:'add_page',sourceId:source.value,title:title.value,...(data.values?{values:data.values}:{})});
      } else if (kind.value==='insert_blocks') {
        const position=select([{id:'above',name:'버튼 위'},{id:'below',name:'버튼 아래'},{id:'first',name:'페이지 맨 위'},{id:'last',name:'페이지 맨 아래'}],data.position??'below'),blocks=element('div'),items=[];
        const addBlock = (b={blockType:'paragraph',richText:[]})=>{const type=select(Object.entries(blockLabels).filter(([id])=>!['button','synced','synced_reference','image','file','column'].includes(id)).map(([id,name])=>({id,name})),b.blockType,{'aria-label':'삽입 블록 유형'}),text=element('textarea',{value:runsText(b.richText??[]),'aria-label':'삽입할 본문'});items.push(()=>({blockType:type.value,richText:text.value===runsText(b.richText??[])?b.richText:[{text:text.value}],...(b.checked!==undefined?{checked:b.checked}:{})}));blocks.append(type,text)};
        (data.blocks??[{}]).forEach(addBlock);fields.append(label('삽입 위치',position),blocks,button('삽입 블록 추가',()=>addBlock()));read=()=>({action:'insert_blocks',position:position.value,blocks:items.map(fn=>fn()),...(data.parentId?{parentId:data.parentId}:{})});
      } else if (kind.value==='open_page') {fields.append(label('열 페이지',target));read=()=>({action:'open_page',targetId:target.value});}
      else if(kind.value==='send_webhook'){const url=input(data.url??''),text=element('textarea',{value:JSON.stringify(data.body??{text:''},null,2)});fields.append(label('수신 Webhook URL',url),label('보낼 내용 (JSON)',text));read=()=>({action:'send_webhook',url:url.value,body:JSON.parse(text.value)});}
      else if(kind.value==='send_email'){const to=input(data.to??''),subject=input(data.subject??''),body=element('textarea',{value:data.message??''});fields.append(label('받는 이메일',to),label('메일 제목',subject),label('메일 본문',body),element('p',{},'메일은 로컬 SMTP 설정이 있어야 전송됩니다.'));read=()=>({action:'send_email',to:to.value,subject:subject.value,message:body.value});}
      else {fields.append(label('알림 내용',message));read=()=>({action:'notify',message:message.value});}
    }
    kind.addEventListener('change',()=>draw());draw(saved);entries.push(entry);list.append(row);
  }
  (initial.actions??[]).forEach(add);
  return {node:element('fieldset',{},element('legend',{},'버튼 동작'),label('버튼 이름',caption),label('실행 전 확인 문구',confirmation),list,button('액션 추가',()=>add())),read:()=>({label:caption.value,confirmation:confirmation.value||null,actions:entries.map(entry=>entry.read())})};
}
function buttonDialog(owner) {
  const revision=state.revision,editor=buttonEditor(owner.button,owner.sourceId);
  modal('버튼 설정',[editor.node],()=>apply([{type:owner.kind==='property'?'property.update':'block.update',id:owner.id,button:editor.read()}],revision));
}
async function runButton(owner,pageId) {
  const revision=state.revision,run=async()=>{const r=await apply([{type:'button.run',id:owner.id,...(pageId?{pageId}:{}),confirmed:true}],revision);if(r.opens?.length)navigate(r.opens.at(-1));};
  if(owner.button?.confirmation||owner.button?.actions.some(a=>a.action.startsWith('send_')))modal('버튼 실행 확인',[element('p',{},owner.button.confirmation??'외부 전송을 확인하세요.'),...(owner.button.actions??[]).filter(a=>a.action.startsWith('send_')).map(a=>element('p',{},a.action==='send_email'?`받는 사람: ${a.to} · 제목: ${a.subject} · ${a.message}`:`수신 URL: ${a.url} · ${JSON.stringify(a.body)}`))],run);else await run();
}
function templateSettings(sourceId) {
  const source=objects.get(sourceId);let revision=state.revision;const templates=state.objects.filter(item=>item.kind==='page'&&item.template&&item.sourceId===sourceId&&visible(item.id));
  const defaultTemplate=select([{id:'',name:'빈 항목'},...templates.map(t=>({id:t.id,name:t.title}))],source.defaultTemplateId??'');
  modal('템플릿 설정',[label('새 항목의 기본 템플릿',defaultTemplate),...templates.map(t=>element('p',{},t.title,' ',button(t.recurrence?.enabled?'반복 일정 수정':'반복 설정',()=>recurrenceDialog(t,()=>{if(source.defaultTemplateId===objects.get(sourceId).defaultTemplateId)revision=state.revision}))))],()=>apply([{type:'source.configure_templates',id:sourceId,defaultTemplateId:defaultTemplate.value||null}],revision));
}
function recurrenceDialog(template,onSaved) {
  const revision=state.revision,rule=template.recurrence??{},enabled=input('',{type:'checkbox',checked:rule.enabled??true}),frequency=select([{id:'day',name:'일'},{id:'week',name:'주'},{id:'month',name:'월'},{id:'year',name:'년'}],rule.frequency??'week'),interval=input(rule.interval??1,{type:'number',min:1,max:365}),start=input(rule.start??new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16),{type:'datetime-local'}),zone=input(rule.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone);
  modal('템플릿 반복',[label('반복 사용',enabled),label('반복 단위',frequency),label('반복 간격',interval),label('첫 실행 날짜와 시각',start),label('실행 시간대',zone)],async()=>{const result=await apply([{type:'template.configure',id:template.id,recurrence:{enabled:enabled.checked,frequency:frequency.value,interval:Number(interval.value),start:start.value,timeZone:zone.value}}],revision);await onSaved?.(result);return result;});
}
function reminderDialog(parentId,existing=null,options={}) {
  const parent=objects.get(parentId),revision=state.revision,dates=schemaOf(parent.sourceId).filter(p=>p.type==='date'),property=select([{id:'',name:'직접 시각 지정'},...dates.map(p=>({id:p.id,name:p.name}))],existing?.datePropertyId??''),at=input(existing?.at?new Date(Date.parse(existing.at)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):'',{type:'datetime-local'}),offset=input(existing?.offsetMinutes??0,{type:'number',min:0}),message=input(existing?.message??'알림');
  if(options.local)at.value=options.local;
  modal('알림 설정',[label('연결 날짜 속성',property),label('알림 시각 (기기 시간대)',at),label('날짜 시작 몇 분 전',offset),label('알림 내용',message)],()=>apply([...options.before??[],{type:'reminder.set',id:existing?.id??crypto.randomUUID(),parentId,...(property.value?{datePropertyId:property.value}:{at:new Date(at.value).toISOString()}),offsetMinutes:Number(offset.value),message:message.value}],options.revision??revision));
}
function reminderTime(text=''){const now=new Date(),date=new Date(now);if(/tomorrow|내일/i.test(text))date.setDate(date.getDate()+1);const iso=text.match(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/);if(iso)return iso[0].replace(' ','T')+(iso[0].length===10?'T09:00':'');const time=text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|시)?/i);let hour=Number(time?.[1]??9);if(time?.[3]?.toLowerCase()==='pm'&&hour<12)hour+=12;if(time?.[3]?.toLowerCase()==='am'&&hour===12)hour=0;date.setHours(hour,Number(time?.[2]??0),0,0);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function showDeliveries(){const jobs=state.objects.filter(o=>o.kind==='delivery'&&visible(o.id));let dialog;dialog=modal('외부 전송 기록',jobs.length?jobs.map(job=>element('article',{},element('p',{},`${job.channel==='email'?job.to:job.url} · ${job.status}`),element('p',{},job.error??job.receipt??''),['failed','unknown'].includes(job.status)&&button('전송 재시도',()=>modal('재전송 확인',[element('p',{},'수신처에서 이미 처리했을 수 있습니다. 실제 수신 결과를 확인한 후 재전송하세요.')],async()=>{dialog.close();await apply([{type:'delivery.update',id:job.id,status:'queued'}])})),['queued','failed','unknown'].includes(job.status)&&button('대기 전송 취소',async()=>{dialog.close();await apply([{type:'delivery.update',id:job.id,status:'cancelled'}])}))):[element('p',{},'전송 기록이 없습니다.')],null);}
function showInbox() {
  const notes=state.objects.filter(item=>item.kind==='notification'&&visible(item.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  let dialog;dialog=modal('받은 알림',notes.length?notes.map(note=>{let page=objects.get(note.parentId);while(page&&page.kind!=='page')page=objects.get(page.parentId);return element('article',{},element('p',{},note.message),page&&button(page.title,async()=>{dialog.close();await navigate(page.id);document.querySelector(`[data-block-id="${CSS.escape(note.parentId)}"]`)?.scrollIntoView({block:'center'})}),button(note.read?'읽지 않음으로':'읽음으로',async()=>{dialog.close();await apply([{type:'notification.read',id:note.id,read:!note.read}]);showInbox()}))}):[element('p',{},'받은 알림이 없습니다.')],null);
}
function importDialog(parentId=null,sourceId=null) {
  const format=select([{id:'csv',name:'CSV'},{id:'markdown',name:'Markdown'},{id:'html',name:'HTML'},{id:'zip',name:'ZIP'},{id:'bundle',name:'구조·첨부 보존 묶음'}],'csv'),title=input('가져온 자료'),text=element('textarea',{'aria-label':'가져올 내용',rows:14}),target=select([{id:'',name:'새 데이터베이스'},...sources().map(s=>({id:s.id,name:s.name}))],sourceId??'');
  const file=input('',{type:'file',accept:'.csv,.md,.markdown,.html,.htm,.zip,.json','aria-label':'가져올 파일'}),fileStatus=element('output');file.addEventListener('change',async()=>{const selected=file.files[0];if(!selected)return;if(selected.size>16*1024*1024){report(new Error('16MiB 이하의 파일을 선택하세요.'));return;}if(/\.zip$/i.test(selected.name)){format.value='zip';const bytes=new Uint8Array(await selected.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));text.value=btoa(binary);text.hidden=true;}else{format.value=/\.csv$/i.test(selected.name)?'csv':/\.html?$/i.test(selected.name)?'html':/\.json$/i.test(selected.name)?'bundle':'markdown';text.value=await selected.text();text.hidden=false;}fileStatus.textContent=selected.name;});format.addEventListener('change',()=>{text.hidden=format.value==='zip';});
  const dialog=modal('가져오기',[label('파일 선택',file),fileStatus,label('형식',format),label('제목',title),label('CSV를 추가할 데이터베이스',target),label('파일 내용을 붙여넣기',text)],async()=>{
    const preview=await api('/api/import/preview',{format:format.value,text:text.value,title:title.value,...(parentId?{parentId}:{}),...(format.value==='csv'&&target.value?{sourceId:target.value}:{})});
    const review=modal('가져오기 미리보기',[element('p',{},`${preview.changes.length}개 항목 생성·변경`),preview.warnings.map(w=>element('p',{},w)),element('ul',{},preview.changes.slice(0,50).map(item=>element('li',{},item.title??item.name??item.kind)))],async()=>{const result=await apply(preview.operations,preview.revision);if(result.copies?.[0])navigate(result.copies[0].copyId);});
    review.querySelector('button[type=submit]').textContent='가져오기 적용';
  });dialog.querySelector('button[type=submit]').textContent='미리보기';
}
async function exportDialog(id) {
  const current=objects.get(id),format=select([{id:'bundle',name:'구조·첨부 보존 묶음'},...(current.kind==='source'?[{id:'csv',name:'CSV'}]:[{id:'markdown',name:'Markdown'},{id:'html',name:'HTML'}]),{id:'zip',name:'Markdown·첨부 ZIP'}],'bundle'),holder=element('div');
  const dialog=modal('내보내기',[label('형식',format),holder],null);
  dialog.querySelector('form').append(button('내보낼 내용 만들기',async()=>{const data=await api('/api/export',{id,format:format.value});holder.replaceChildren(...data.warnings.map(w=>element('p',{},w)),element('textarea',{value:data.text,readOnly:true,rows:12,'aria-label':'내보낸 내용'}),button('파일로 저장',()=>{const url=URL.createObjectURL(new Blob([data.encoding==='base64'?Uint8Array.from(atob(data.text),c=>c.charCodeAt(0)):data.text],{type:data.mediaType})),a=element('a',{href:url,download:data.filename});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}));}));
}
function pageDialog(sourceId = null, template = false, parentTaskId = null, parentId = selected, values = {}) {
  const revision = state.revision;
  const title = input('', { placeholder: '제목 없음' }), parent = select([{ id: '', name: '최상위' }, ...state.objects.filter(item => item.kind === 'page' && visible(item.id)).map(item => ({ id: item.id, name: item.title }))], parentId ?? '');
  modal(parentTaskId ? '새 하위 항목' : template ? '새 템플릿' : sourceId ? '새 항목' : '새 페이지', [label('제목', title), !sourceId && label('상위 페이지', parent)], async () => {
    const id = crypto.randomUUID(), operations = [{ type: 'page.create', id, title: title.value, ...(sourceId ? { sourceId, template } : { parentId: parent.value || null }) }];
    if (parentTaskId) operations.push({ type: 'relation.set', pageId: id, propertyId: objects.get(sourceId).tasks.subitems.parentPropertyId, targetIds: [parentTaskId] });
    if (sourceId && !template) for (const [propertyId, value] of Object.entries(values)) operations.push({ type: 'value.set', pageId: id, propertyId, value });
    await apply(operations, revision); navigate(id);
  });
}
function taskSettingsDialog(sourceId) {
  const source = objects.get(sourceId), revision = state.revision, settings = source.tasks ?? {}, schema = schemaOf(sourceId);
  const pairs = schema.filter(property => property.type === 'relation' && property.targetSourceId === sourceId && property.inversePropertyId !== property.id && objects.get(property.inversePropertyId)?.alive && objects.get(property.inversePropertyId)?.inversePropertyId === property.id);
  const pairOptions = [{ id: '', name: '새 관계 속성 쌍 만들기' }, ...pairs.map(property => ({ id: property.id, name: `${property.name} / ${objects.get(property.inversePropertyId).name}` }))];
  const sub = input('', { type: 'checkbox', checked: settings.subitems?.enabled }), dep = input('', { type: 'checkbox', checked: settings.dependencies?.enabled });
  const parent = select(pairOptions, settings.subitems?.parentPropertyId ?? ''), predecessor = select(pairOptions, settings.dependencies?.predecessorPropertyId ?? '');
  const date = select([{ id: '', name: '선택 안 함' }, ...schema.filter(property => property.type === 'date').map(property => ({ id: property.id, name: property.name }))], settings.dependencies?.datePropertyId ?? schema.find(property => property.type === 'date')?.id ?? '');
  const mode = select([{ id: 'none', name: '자동 이동 안 함' }, { id: 'overlap', name: '겹칠 때만 이동' }, { id: 'preserve', name: '간격 유지' }], settings.dependencies?.mode ?? 'none');
  const weekends = input('', { type: 'checkbox', checked: settings.dependencies?.avoidWeekends });
  const pair = (control, first, second) => control.value ? { [first]: control.value, [second]: objects.get(control.value).inversePropertyId } : { [first]: crypto.randomUUID(), [second]: crypto.randomUUID() };
  modal('업무 구조 설정', [element('fieldset', {}, element('legend', {}, '상하위 항목'), label('하위 항목 사용', sub), label('상위 / 하위 관계 속성', parent)), element('fieldset', {}, element('legend', {}, '선행·후행 관계와 일정'), label('의존성 사용', dep), label('선행 / 후행 관계 속성', predecessor), label('일정 날짜 속성', date), label('일정 자동 이동', mode), label('이동한 일정의 시작·종료 주말 피하기', weekends))], () => apply([{ type: 'source.configure_tasks', id: sourceId,
    subitems: { enabled: sub.checked, ...(sub.checked ? pair(parent, 'parentPropertyId', 'childrenPropertyId') : {}) },
    dependencies: { enabled: dep.checked, ...(dep.checked ? pair(predecessor, 'predecessorPropertyId', 'successorPropertyId') : {}), datePropertyId: date.value || null, mode: mode.value, avoidWeekends: weekends.checked },
  }], revision));
}
function sourceDialog(pageId) {
  const name = input('새 데이터베이스');
  modal('데이터베이스 만들기', [label('이름', name)], async () => {
    const id = crypto.randomUUID(), viewId = crypto.randomUUID();
    await apply([{ type: 'source.create', id, pageId, name: name.value }, { type: 'view.create', id: viewId, sourceId: id, parentId: pageId, name: '테이블' }]); navigate(viewId);
  });
}
function format(value, property) {
  if(value?.type==='formatted_text')return runsText(value.richText);
  if (value?.error) return `${value.error.code}: ${value.error.message}`;
  if (value == null) return '비어 있음';
  if(typeof value==='number'&&property?.numberFormat)return formatNumber(value,property.numberFormat);
  if (property?.type === 'relation') return (Array.isArray(value) ? value : [value]).map(id => objects.get(id)?.title ?? '삭제된 항목').join(', ');
  if (['select', 'status', 'multi_select'].includes(property?.type)) return (Array.isArray(value) ? value : [value]).map(id => property.options?.find(option => option.id === id)?.name ?? id).join(', ');
  if (property?.type === 'date') return `${value.start}${value.end ? ` → ${value.end}` : ''}`;
  if (property?.type === 'place') return value.name;
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  return Array.isArray(value) ? value.map(item=>format(item)).join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function formatAggregate(value,operation,property){if(value?.error)return format(value,property);return typeof value==='number'&&operation?.startsWith('percent_')?formatNumber(value,{style:'percent',digits:1}):['count','count_nonempty','count_empty','checked','unchecked'].includes(operation)?String(value):format(value,property);}
function commitControls(controls, read, save, options = {}) {
  let submitted = JSON.stringify('initialValue' in options ? options.initialValue : read());
  async function commit() {
    if (controls.some(control => !control.checkValidity())) { controls.find(control => !control.checkValidity()).reportValidity(); return; }
    const value = read(), serialized = JSON.stringify(value);
    if (serialized === submitted) return;
    submitted = serialized;
    try { await save(value); } catch (error) { report(error); }
  }
  for (const control of controls) {
    control.addEventListener('change', commit);
    control.addEventListener('blur', commit);
    control.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(); } });
  }
  return controls[0];
}
// 선택·상태 셀 팝오버(셀 위에 열림, 위쪽 검색 입력에 현재 값 알약, 상태는 그룹 이름별 구역, 아래 "속성 편집")
function optionPicker(anchor, page, property, current, save) {
  const revision = state.revision, colorOf = option => optionColor(property, option);
  return popover(anchor, api => {
    const search = input('', { class: 'option-search', placeholder: property.type === 'select' ? '옵션 검색 또는 생성' : '검색', 'aria-label': `${property.name} 옵션 검색` }), list = element('div', { class: 'option-list', role: 'listbox', 'aria-label': `${property.name} 옵션` });
    const choose = async value => { api.close(); await save(value, revision); };
    const currentOption = (property.options ?? []).find(option => option.id === current);
    const head = element('div', { class: 'option-head' }, currentOption && element('span', { class: 'option-current' }, tag(currentOption.name, colorOf(currentOption), property.type === 'status' ? 'tag-status' : ''), button('×', () => choose(null), { class: 'option-clear', 'aria-label': `${property.name} 값 지우기` })), search);
    const draw = () => {
      const needle = search.value.trim().toLocaleLowerCase(), options = (property.options ?? []).filter(option => option.name.toLocaleLowerCase().includes(needle));
      const row = option => button(tag(option.name, colorOf(option), property.type === 'status' ? 'tag-status' : ''), () => choose(option.id), { class: 'option-row', role: 'option', 'aria-selected': String(option.id === current), 'aria-label': option.name });
      const groups = property.type === 'status' ? [...new Set(options.map(option => option.group ?? ''))] : [null];
      list.replaceChildren(...(property.type === 'select' ? [element('div', { class: 'menu-heading' }, '옵션 선택 또는 생성')] : []), ...groups.flatMap((group, index) => [index && property.type === 'status' ? element('div', { class: 'menu-separator', role: 'separator' }) : null, group ? element('div', { class: 'menu-heading' }, group) : null, ...options.filter(option => group == null || (option.group ?? '') === group).map(row)]).filter(Boolean));
      const exact = (property.options ?? []).some(option => option.name.toLocaleLowerCase() === needle);
      if (property.type === 'select' && needle && !exact) list.append(button([element('span', { class: 'menu-label' }, '생성'), tag(search.value.trim(), 'default')], async () => { const id = crypto.randomUUID(); api.close(); await apply([{ type: 'property.update', id: property.id, options: [...(property.options ?? []), { id, name: search.value.trim() }] }, { type: 'value.set', pageId: page.id, propertyId: property.id, value: id }], revision); }, { class: 'option-row option-create', role: 'option' }));
      if (!list.querySelector('.option-row')) list.append(element('div', { class: 'option-empty' }, '결과 없음'));
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', event => { const rows = [...list.querySelectorAll('.option-row')]; if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); (rows.find(row => row.matches('.active')) ?? rows[0])?.click(); } if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const index = rows.findIndex(row => row.matches('.active')); rows.forEach(row => row.classList.remove('active')); rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.classList.add('active'); } });
    draw(); queueMicrotask(() => search.focus());
    return [head, list, element('div', { class: 'menu-separator', role: 'separator' }), button([icon('settings'), element('span', { class: 'menu-label' }, '속성 편집')], () => { api.close(); propertyDialog(property.sourceId, property); }, { class: 'menu-item option-edit' })];
  }, { className: 'option-popover', cover: true });
}
// 표 열 머리 메뉴(머리 칸 아래, 유형 아이콘 + 이름 입력 · 속성 편집 · 필터/정렬/계산/고정/숨기기 · 속성 추가)
function propertyHeaderMenu(anchor, source, view, property, revision, shown = []) {
  const config = view?.config ?? {}, frozen = config.frozenProperties ?? [], sorts = config.sorts ?? [];
  const updateView = next => apply([{ type: 'view.update', id: view.id, config: next }], revision);
  const name = input(property.name, { class: 'property-name-input', 'aria-label': '속성 이름', onkeydown: event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); const value = event.target.value.trim(); if (value && value !== property.name) { closePopover(); apply([{ type: 'property.update', id: property.id, name: value }], revision).catch(report); } } } });
  const operations = ['count', 'count_nonempty', 'count_empty', 'percent_empty', 'percent_not_empty', ...(['number', 'formula', 'rollup'].includes(property.type) ? ['sum', 'average', 'median', 'min', 'max'] : []), ...(property.type === 'checkbox' ? ['checked', 'unchecked', 'percent_checked', 'percent_unchecked'] : []), ...(['date', 'created_time', 'last_edited_time'].includes(property.type) ? ['earliest_date', 'latest_date', 'date_range'] : [])];
  const calc = event => menu(event.currentTarget.closest('.popover')?.querySelector('.property-name-row') ?? anchor, [{ heading: `${property.name} 계산` }, { label: '없음', hint: config.columnAggregations?.[property.id] ? '' : '✓', action: () => { const next = { ...(config.columnAggregations ?? {}) }; delete next[property.id]; return updateView({ columnAggregations: next }); } }, ...operations.map(operation => ({ label: aggregateLabels[operation], hint: config.columnAggregations?.[property.id] === operation ? '✓' : '', action: () => updateView({ columnAggregations: { ...(config.columnAggregations ?? {}), [property.id]: operation } }) }))]);
  return menu(anchor, [
    { node: element('div', { class: 'property-name-row' }, element('span', { class: 'property-type-box', title: propertyLabels[property.type] ?? property.type }, icon(`type-${property.type}`)), name) },
    { icon: 'settings', label: '속성 편집', action: () => propertyDialog(source.id, property) },
    view && '-',
    view && { icon: 'filter', label: '필터', action: () => viewDialog(source.id, view) },
    view && { icon: 'sort', label: '오름차순 정렬', hint: sorts[0]?.propertyId === property.id && sorts[0].direction === 'asc' ? '✓' : '', action: () => updateView({ sorts: [{ propertyId: property.id, direction: 'asc' }, ...sorts.filter(sort => sort.propertyId !== property.id)] }) },
    view && { icon: 'sort', label: '내림차순 정렬', hint: sorts[0]?.propertyId === property.id && sorts[0].direction === 'desc' ? '✓' : '', action: () => updateView({ sorts: [{ propertyId: property.id, direction: 'desc' }, ...sorts.filter(sort => sort.propertyId !== property.id)] }) },
    view && { node: button([element('span', { class: 'menu-glyph', 'aria-hidden': 'true' }, 'Σ'), element('span', { class: 'menu-label' }, '계산'), icon('chevron-right')], calc, { class: 'menu-item', role: 'menuitem', 'aria-haspopup': 'menu' }) },
    view && { icon: 'pin', label: frozen.includes(property.id) ? '열 고정 해제' : '고정', action: () => updateView({ frozenProperties: frozen.includes(property.id) ? frozen.filter(id => id !== property.id) : [...frozen, property.id] }) },
    view && property.type !== 'title' && { icon: 'eye-off', label: '숨기기', action: () => updateView({ visibleProperties: (config.visibleProperties ?? shown).filter(id => id !== property.id) }) },
    '-',
    { icon: 'plus', label: '속성 추가', action: () => propertyDialog(source.id) },
  ], { className: 'menu-popover property-menu' });
}
function valueControl(page, property, value, save, { draftOnly = false } = {}) {
  if (property.type==='button') return element('span',{},page.id&&button(property.button?.label??property.name,()=>runButton(property,page.id)),button('버튼 설정',()=>buttonDialog(property)));
  const fieldName = `${page.title ?? '항목'} · ${property.name}`;
  const attrs = { 'aria-label': fieldName };
  if (['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(property.type)) return element('output', { class: value?.error ? 'error' : '' }, value?.type==='formatted_text'?richNodes(value.richText):Array.isArray(value)?value.flatMap((item,i)=>[i?', ':'',...(item?.type==='formatted_text'?richNodes(item.richText):[format(item)])]):format(value, property));
  const committedValue = value, key = page.id && !draftOnly ? valueDraftKey(page.id, property.id) : null;
  let draft = key && localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)) : null;
  if (draft && JSON.stringify(draft.value) === JSON.stringify(value)) { localStorage.removeItem(key); draft = null; }
  else if (draft) value = draft.value;
  const revision = draft?.baseRevision ?? state.revision, persist = value => { if (key) storeLocal(key, JSON.stringify({ value, baseRevision: revision })); };
  const originalSave = save;
  save = async (value, expectedRevision = revision) => { persist(value); return originalSave(value, expectedRevision); };
  const track = (controls, read) => { if (key) for (const control of controls) control.addEventListener('input', () => persist(read())); };
  if (property.type === 'checkbox') return input('', { ...attrs, type: 'checkbox', checked: value === true, onchange: event => save(event.target.checked) });
  if (['select', 'status', 'multi_select', 'relation'].includes(property.type)) {
    const tasks = objects.get(property.sourceId)?.tasks, sub = tasks?.subitems, singleParent = property.type === 'relation' && sub?.enabled && sub.parentPropertyId === property.id;
    const taskRole = (sub?.enabled && [sub.parentPropertyId, sub.childrenPropertyId].includes(property.id)) || (tasks?.dependencies?.enabled && [tasks.dependencies.predecessorPropertyId, tasks.dependencies.successorPropertyId].includes(property.id));
    const multiple = ['multi_select', 'relation'].includes(property.type) && !singleParent;
    const options = property.type === 'relation' ? state.objects.filter(item => item.kind === 'page' && (!taskRole || item.id !== page.id) && item.sourceId === property.targetSourceId && visible(item.id) && !item.template).map(item => ({ id: item.id, name: item.title })) : property.options ?? [];
    const picker=select(multiple ? options : [{ id: '', name: '비어 있음' }, ...options], singleParent ? value?.[0] ?? '' : value, { ...attrs, multiple, size: multiple ? Math.max(Math.min(options.length, 4), 2) : 1, onchange: event => save(multiple ? [...event.target.selectedOptions].map(option => option.value) : singleParent ? event.target.value ? [event.target.value] : [] : event.target.value || null) });
    return property.type==='relation'&&property.displayProperties?.length?element('div',{},picker,(page.relationDisplay?.[property.id]??[]).map(item=>element('p',{},recordLink(item),item.fields.map(field=>` · ${field.name}: ${format(field.value,objects.get(field.propertyId))}`)))):picker;
  }
  if (property.type === 'date') {
    const type = value?.start?.includes('T') ? 'text' : 'date';
    const start = input(value?.start ?? '', { type, 'aria-label': `${fieldName} 시작` }), end = input(value?.end ?? '', { type, 'aria-label': `${fieldName} 종료` });
    const zone = input(value?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, { 'aria-label': `${fieldName} 시간대` });
    const change = () => save(start.value ? { start: start.value, ...(end.value ? { end: end.value } : {}), timeZone: zone.value } : null);
    track([start, end, zone], () => start.value ? { start: start.value, ...(end.value ? { end: end.value } : {}), timeZone: zone.value } : null);
    if (draftOnly) for (const control of [start, end, zone]) control.addEventListener('input', change);
    const timed = input('', { type: 'checkbox', checked: type === 'text', 'aria-label': `${fieldName} 시각 포함`, onchange: event => {
      for (const control of [start, end]) { const previous = control.value; control.type = event.target.checked ? 'text' : 'date'; control.value = previous ? event.target.checked && !previous.includes('T') ? new Date(`${previous}T00:00:00`).toISOString() : event.target.checked ? previous : previous.slice(0, 10) : ''; }
      if (draftOnly) change();
    } });
    return element('div', { class: 'inline' }, start, '→', end, zone, label('시각 포함', timed), !draftOnly && button('날짜 저장', change));
  }
  if (property.type === 'place') {
    const name = input(value?.name ?? '', { 'aria-label': `${fieldName} 이름` }), latitude = input(value?.latitude ?? '', { type: 'number', step: 'any', 'aria-label': `${fieldName} 위도` }), longitude = input(value?.longitude ?? '', { type: 'number', step: 'any', 'aria-label': `${fieldName} 경도` });
    const read = () => name.value ? { name: name.value, ...(latitude.value ? { latitude: Number(latitude.value) } : {}), ...(longitude.value ? { longitude: Number(longitude.value) } : {}) } : null;
    track([name, latitude, longitude], read); commitControls([name, latitude, longitude], read, save, { initialValue: committedValue });
    return element('div', { class: 'inline' }, name, latitude, longitude,button('공개 장소 찾기',()=>{const query=input(name.value),results=element('div');const dialog=modal('장소 검색',[element('p',{},'입력한 장소 이름을 Photon에 전송합니다. 개인 주소·비공개 장소는 직접 좌표를 입력하세요.'),label('공개 장소 이름',query),results],null);dialog.querySelector('form').append(button('검색',async()=>{const data=await api('/api/geocode',{query:query.value});results.replaceChildren(...data.results.map(place=>button(place.name,async()=>{dialog.close();await save(place,state.revision)})),element('p',{},data.attribution))}));}));
  }
  if (property.type === 'files') {
    const picker = input('', { type: 'file', 'aria-label': `${fieldName} 첨부`, onchange: async event => {
      const file = event.target.files[0]; if (!file) return;
      const registered = await uploadFile(file, revision, draftOnly ? null : { pageId: page.id, propertyId: property.id, attachmentIds: value ?? [] });
      if (draftOnly) { state.revision = registered.revision; value = [...(value ?? []), registered.attachmentId]; await save(value, registered.revision); }
      else await refresh(true);
    } });
    return element('div', {}, (value ?? []).map(id => element('span', { class: 'file' }, element('a', { href: `/api/attachments/${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener' }, objects.get(id)?.name ?? '첨부'), button('참조 제거', () => save(value.filter(item => item !== id))))), picker);
  }
  const control = input(property.type === 'person' ? (value ?? []).join(', ') : value ?? '', { ...attrs, type: property.type === 'number' ? 'number' : 'text' });
  const read = () => property.type === 'number' ? control.value === '' ? null : Number(control.value) : property.type === 'person' ? control.value.split(',').map(value => value.trim()).filter(Boolean) : control.value;
  track([control], read); const tracked=commitControls([control], read, save, { initialValue: draft ? committedValue : read() });return property.type==='number'&&property.numberFormat?element('span',{},tracked,element('output',{},format(value,property))):tracked;
}

function propertyDialog(sourceId, existing = null) {
  const revision = state.revision;
  const name = input(existing?.name ?? ''), type = select([{ id: 'title', name: '제목' }, ...Object.entries(propertyLabels).map(([id, name]) => ({ id, name }))].filter(option => existing?.type === 'title' || option.id !== 'title'), existing?.type ?? 'text', { disabled: existing?.type === 'title' });
  const options = element('div'), entries = [];
  function addOption(option = { id: crypto.randomUUID(), name: '' }) {
    const optionName = input(option.name, { 'aria-label': '선택 항목 이름', required: true });
    const group = input(option.group ?? '', { 'aria-label': '상태 그룹', placeholder: '대기·진행·완료 그룹' });
    const color = select(tagColors.map((id, index) => ({ id, name: ['기본', '회색', '갈색', '주황색', '노란색', '초록색', '파란색', '보라색', '분홍색', '빨간색'][index] })), tagColors.includes(option.color) ? option.color : 'default', { 'aria-label': '선택 항목 색' });
    const row = element('div', { class: 'inline option-row' }, optionName, color, group, button('항목 제거', () => { entries.splice(entries.indexOf(entry), 1); row.remove(); }));
    const entry = { option, optionName, group, color, row }; entries.push(entry); options.append(row);
  }
  (existing ? existing.options ?? [] : [{ id: crypto.randomUUID(), name: '시작 전', group: '할 일' }, { id: crypto.randomUUID(), name: '진행 중', group: '진행 중' }, { id: crypto.randomUUID(), name: '완료', group: '완료' }]).forEach(addOption);
  const formula = input(existing?.formula ?? 'prop("숫자") * 2'), automation=buttonEditor(existing?.button,sourceId);
  const limit=select([{id:'many',name:'여러 항목'},{id:'one',name:'한 항목'}],existing?.relationLimit===1?'one':'many'),display=select([],existing?.displayProperties??[],{multiple:true});
  const numberStyle=select([{id:'number',name:'숫자'},{id:'percent',name:'퍼센트'},{id:'currency',name:'통화'}],existing?.numberFormat?.style??'number'),currency=input(existing?.numberFormat?.currency??'KRW'),digits=input(existing?.numberFormat?.digits??2,{type:'number',min:0,max:20}),grouping=input('',{type:'checkbox',checked:existing?.numberFormat?.grouping??true});
  const relationSettings=element('fieldset',{},element('legend',{},'관계 표시'),label('연결할 수 있는 개수',limit),label('대상에서 표시할 속성',display)),numberSettings=element('fieldset',{},element('legend',{},'숫자 표시'),label('숫자 표시 형식',numberStyle),label('통화 코드',currency),label('소수 자릿수',digits),label('천 단위 구분',grouping));
  const target = select(sources().map(source => ({ id: source.id, name: source.name })), sourceId), inverse = input('', { placeholder: '두 속성으로 연결하려면 이름 입력' });
  const relation = select(schemaOf(sourceId).filter(property => property.type === 'relation').map(property => ({ id: property.id, name: property.name })), existing?.rollup?.relationPropertyId ?? '');
  const rollupTarget = select([], ''), aggregation = select(['sum', 'average', 'count', 'count_nonempty', 'count_empty', 'min', 'max', 'median', 'values', 'unique', 'percent_empty', 'percent_not_empty', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked', 'earliest_date', 'latest_date', 'date_range'].map(id => ({ id, name: id })), existing?.rollup?.aggregation ?? 'sum');
  const optionField = element('fieldset', {}, element('legend', {}, '선택 항목'), options, button('선택 항목 추가', () => addOption()), existing && element('p', {}, '항목을 비워 두고 유형을 바꾸면 기존 값에서 선택 항목을 만듭니다.')), formulaField = label('수식', formula), targetField = label('관계 대상 데이터베이스', target), inverseField = label('반대쪽 속성 이름', inverse), relationField = label('롤업 관계 속성', relation), rollupField = label('롤업 대상 속성', rollupTarget), aggregationField = label('집계', aggregation);
  const updateRollup = () => { const property = objects.get(relation.value), previous = rollupTarget.value || existing?.rollup?.targetPropertyId; rollupTarget.replaceChildren(...schemaOf(property?.targetSourceId).map(property => element('option', { value: property.id, selected: property.id === previous }, property.name))); };
  relation.addEventListener('change', updateRollup); updateRollup();
  const updateDisplay=()=>display.replaceChildren(...schemaOf(existing?.targetSourceId??target.value).map(p=>element('option',{value:p.id,selected:(existing?.displayProperties??[]).includes(p.id)},p.name)));target.addEventListener('change',updateDisplay);updateDisplay();
  const update = () => { relationSettings.hidden=type.value!=='relation';numberSettings.hidden=!['number','formula','rollup'].includes(type.value);automation.node.hidden=type.value!=='button'; optionField.hidden = !['select', 'multi_select', 'status'].includes(type.value); optionField.disabled = optionField.hidden; for (const entry of entries) entry.group.hidden = type.value !== 'status'; formulaField.hidden = type.value !== 'formula'; targetField.hidden = inverseField.hidden = type.value !== 'relation' || existing?.type === 'relation'; relationField.hidden = rollupField.hidden = aggregationField.hidden = type.value !== 'rollup'; };
  type.addEventListener('change', update); update();
  modal(existing ? '속성 수정' : '속성 추가', [label('속성 이름', name), label('속성 유형', type), optionField, formulaField, targetField, inverseField, relationField, rollupField, aggregationField,automation.node,relationSettings,numberSettings], async () => {
    const converting = existing && existing.type !== type.value;
    const operation = existing ? { type: converting ? 'property.convert' : 'property.update', id: existing.id, name: name.value, ...(converting ? { propertyType: type.value } : {}) } : { type: 'property.create', id: crypto.randomUUID(), sourceId, name: name.value, propertyType: type.value };
    if (['select', 'multi_select', 'status'].includes(type.value) && (!converting || entries.length)) operation.options = entries.map(({ option, optionName, group, color }) => ({ ...option, name: optionName.value.trim(), ...(type.value === 'status' ? { group: group.value } : {}), color: color.value === 'default' ? undefined : color.value }));
    if (type.value === 'formula' && (!existing || formula.value !== existing.formula)) operation.formula = formula.value;
    if (type.value === 'relation' && (!existing || converting)) { operation.targetSourceId = target.value; if (inverse.value) operation.inverse = { name: inverse.value }; }
    if (type.value === 'rollup') operation.rollup = { relationPropertyId: relation.value, targetPropertyId: rollupTarget.value, aggregation: aggregation.value };
    if(type.value==='button')operation.button=automation.read();
    if(type.value==='relation'){operation.relationLimit=limit.value==='one'?1:null;operation.displayProperties=[...display.selectedOptions].map(o=>o.value);}
    if(['number','formula','rollup'].includes(type.value))operation.numberFormat={style:numberStyle.value,currency:currency.value,digits:Number(digits.value),grouping:grouping.checked};
    if (converting) await showPropertyConversion(operation);
    else await apply([operation], revision);
  });
}
async function showPropertyConversion(operation, afterApply) {
  const preview = await api('/api/property-conversion/preview', operation);
  if (!preview.allowed) throw new Error([preview.error.message, ...(preview.error.details?.rows ?? []).map(row => `${row.title}: ${row.message}`), ...(preview.error.details?.properties ?? []).map(property => property.name)].join('\n'));
  const property = preview.property;
  const dialog = modal('속성 유형 변환 결과', [element('p', {}, `${property.before.name}${property.before.name === property.after.name ? '' : ` → ${property.after.name}`}: ${propertyLabels[property.before.type]} → ${propertyLabels[property.after.type]} · ${preview.changes.length}개 항목`),
    preview.notes.map(note => element('p', {}, note)), preview.changes.map(row => element('p', {}, `${row.title}${row.visible ? '' : ' (휴지통)'}: ${format(row.before, property.before)} → ${format(row.after, property.after)}`)),
    preview.effects.length ? element('section', {}, element('h3', {}, '계산 결과의 변화'), preview.effects.map(effect => element('p', {}, `${effect.title} · ${effect.name}: ${format(effect.before)} → ${format(effect.after)}`))) : null,
    preview.chartEffects.length ? element('section', {}, element('h3', {}, '차트 집계의 변화'), preview.chartEffects.map(view => element('div', {}, element('strong', {}, view.name), view.after.map(bar => element('p', {}, `${format(bar.value)}${bar.errors.length ? ` · 확인할 항목 ${bar.errors.length}개` : ''}`))))) : null,
    preview.viewChanges.length ? element('section', {}, element('h3', {}, '함께 바뀌는 보기 설정'), preview.viewChanges.map(view => element('p', {}, `${view.name}: 필터·날짜·장소 연결 갱신`))) : null],
  async () => { await apply([preview.operation], preview.revision, { freshCommand: true }); await afterApply?.(); });
  dialog.querySelector('button[type=submit]').textContent = '변환 적용';
}

const filterLabels = { eq: '같음', neq: '다름', contains: '포함', not_contains: '포함하지 않음', empty: '비어 있음', not_empty: '비어 있지 않음', gt: '초과', gte: '이상', lt: '미만', lte: '이하', before: '이전', after: '이후', in: '선택 중 하나',relative:'상대 날짜 기간' };
function filterValue(property, op, value) {
  if(op==='relative'){const period=select(['today','yesterday','tomorrow','this_week','last_week','next_week','this_month','last_month','next_month','past_days','next_days'].map((id,i)=>({id,name:['오늘','어제','내일','이번 주','지난 주','다음 주','이번 달','지난 달','다음 달','지난 N일','다음 N일'][i]})),value?.period??'today',{'aria-label':'상대 날짜 기간'}),amount=input(value?.amount??7,{type:'number',min:1,'aria-label':'기간 일수'}),zone=input(value?.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone,{'aria-label':'기간 시간대'});return {node:element('span',{},period,amount,zone),read:()=>({period:period.value,amount:Number(amount.value),timeZone:zone.value})};}
  if (['empty', 'not_empty'].includes(op)) return { node: element('span'), read: () => undefined };
  let options = property?.options;
  if (property?.type === 'relation') options = state.objects.filter(item => item.kind === 'page' && item.sourceId === property.targetSourceId && visible(item.id) && !item.template).map(item => ({ id: item.id, name: item.title }));
  if (options) {
    const multiple = op === 'in' || ['relation', 'multi_select'].includes(property.type) && ['eq', 'neq'].includes(op);
    const control = select(multiple ? options : [{ id: '', name: '비어 있음' }, ...options], value, { multiple, 'aria-label': '필터 값' });
    return { node: control, read: () => multiple ? [...control.selectedOptions].map(option => option.value) : control.value || null };
  }
  if (property?.type === 'checkbox') { const control = select([{ id: 'true', name: '예' }, { id: 'false', name: '아니요' }], String(value ?? true), { 'aria-label': '필터 값' }); return { node: control, read: () => control.value === 'true' }; }
  const control = input(typeof value === 'object' && value !== null ? value.start ?? JSON.stringify(value) : value ?? '', { 'aria-label': '필터 값', type: property?.type === 'number' ? 'number' : 'text', step: 'any' });
  return { node: control, read: () => property?.type === 'number' ? control.value === '' ? null : Number(control.value) : control.value };
}
function filterEditor(schema, initial = null) {
  function group(initial) {
    const negate = input('', { type: 'checkbox', checked: !!initial?.not, 'aria-label': '조건 묶음 반전' });
    initial = initial?.not ?? initial;
    const mode = select([{ id: 'all', name: '모든 조건 만족 (AND)' }, { id: 'any', name: '하나 이상 만족 (OR)' }], initial?.any ? 'any' : 'all', { 'aria-label': '조건 결합 방식' });
    const list = element('div'), entries = [], node = element('fieldset', { class: 'filter-group' }, element('legend', {}, '조건 묶음'), mode, label('결과 반전 (NOT)', negate), list);
    function add(value, nested = false) {
      const child = nested ? group(value) : rule(value), row = element('div', { class: 'filter-row' });
      row.append(child.node, button('조건 제거', () => { entries.splice(entries.indexOf(child), 1); row.remove(); })); entries.push(child); list.append(row);
    }
    function rule(value) {
      const property = select(schema.map(item => ({ id: item.id, name: item.name })), value?.propertyId ?? schema[0]?.id, { 'aria-label': '필터 속성' });
      const operation = select(Object.entries(filterLabels).map(([id, name]) => ({ id, name })), value?.op ?? 'eq', { 'aria-label': '필터 조건' });
      const holder = element('span'); let editor;
      const update = saved => { editor = filterValue(objects.get(property.value), operation.value, saved); holder.replaceChildren(editor.node); };
      property.addEventListener('change', () => update(null)); operation.addEventListener('change', () => update(editor.read())); update(value?.value);
      return { node: element('span', { class: 'inline' }, property, operation, holder), read: () => ({ propertyId: property.value, op: operation.value, ...(['empty', 'not_empty'].includes(operation.value) ? {} : { value: editor.read() }) }) };
    }
    for (const value of initial?.all ?? initial?.any ?? (initial ? [initial] : [])) add(value, !!(value.all || value.any || value.not));
    node.append(button('조건 추가', () => add(null)), button('조건 묶음 추가', () => add(null, true)));
    return { node, read: () => { const children = entries.map(entry => entry.read()).filter(Boolean); if (!children.length) return null; const filter = { [mode.value]: children }; return negate.checked ? { not: filter } : filter; } };
  }
  return group(initial);
}
function viewDialog(sourceId, existing = null, parentId, initial = null) {
  const revision = state.revision, schema = schemaOf(sourceId), options = [{ id: '', name: '없음' }, ...schema.map(property => ({ id: property.id, name: property.name }))];
  const config = existing?.config ?? initial?.config ?? {}, name = input(existing?.name ?? (initial ? `${initial.name} 연결 보기` : '새 보기')), type = select(['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed', 'chart', 'map', 'form', 'dashboard'].map(id => ({ id, name: { table: '표', board: '보드', list: '리스트', gallery: '갤러리', calendar: '캘린더', timeline: '타임라인', feed: '피드', chart: '차트', map: '지도', form: '양식', dashboard: '대시보드' }[id] })), existing?.viewType ?? initial?.viewType ?? 'table');
  const filters = filterEditor(schema, config.filter), sortList = element('div'), sortControls = [];
  function addSort(sort = {}) {
    const property = select(options, sort.propertyId ?? '', { 'aria-label': '정렬 속성' }), direction = select([{ id: 'asc', name: '오름차순' }, { id: 'desc', name: '내림차순' }], sort.direction ?? 'asc', { 'aria-label': '정렬 방향' });
    const row = element('div', { class: 'inline' }, property, direction, button('우선순위 올리기', () => { const index = sortControls.indexOf(entry); if (index > 0) { [sortControls[index - 1], sortControls[index]] = [entry, sortControls[index - 1]]; sortList.insertBefore(row, row.previousElementSibling); } }), button('정렬 제거', () => { sortControls.splice(sortControls.indexOf(entry), 1); row.remove(); }));
    const entry = { property, direction, row }; sortControls.push(entry); sortList.append(row);
  }
  (config.sorts ?? []).forEach(addSort);
  const columns = element('div'), columnEntries = [];
  for (const id of [...new Set([...(config.visibleProperties ?? schema.map(property => property.id)), ...schema.map(property => property.id)])]) {
    const property = objects.get(id); if (!property?.alive) continue;
    const checked = input('', { type: 'checkbox', checked: (config.visibleProperties ?? schema.map(property => property.id)).includes(id), 'aria-label': `${property.name} 표시` });
    const frozen=input('',{type:'checkbox',checked:(config.frozenProperties??[]).includes(id),'aria-label':`${property.name} 고정`}),aggregation=select([{id:'',name:'집계 없음'},...Object.entries(aggregateLabels).map(([id,name])=>({id,name}))],config.columnAggregations?.[id]??'',{'aria-label':`${property.name} 열 집계`});
    const row = element('div', { class: 'inline' }, label(property.name, checked),label('고정',frozen),aggregation, button('열 앞으로', () => { const index = columnEntries.indexOf(entry); if (index > 0) { [columnEntries[index - 1], columnEntries[index]] = [entry, columnEntries[index - 1]]; columns.insertBefore(row, row.previousElementSibling); } }));
    const entry = { id, checked,frozen,aggregation }; columnEntries.push(entry); columns.append(row);
  }
  const group = select(options, config.groupBy ?? ''), dateOptions = [options[0], ...options.filter(option => objects.get(option.id)?.type === 'date')];
  const subgroup=select(options,config.subgroupBy??''),hiddenGroups=select([],config.hiddenGroups??[],{multiple:true,'aria-label':'숨길 그룹'}),calendarMode=select([{id:'month',name:'월'},{id:'week',name:'주'}],config.calendarMode??'month'),timelineZoom=select([{id:'hour',name:'시간'},{id:'day',name:'일'},{id:'week',name:'주'},{id:'month',name:'월'}],config.timelineZoom??'day'),preview=select([{id:'none',name:'없음'},{id:'page_cover',name:'페이지 커버'},{id:'files',name:'파일 속성'}],config.galleryPreview??'none'),previewProperty=select([{id:'',name:'첫 파일 속성'},...schema.filter(p=>p.type==='files').map(p=>({id:p.id,name:p.name}))],config.previewPropertyId??'');
  const updateHidden=()=>{const p=objects.get(group.value),values=new Map((p?.options??[]).map(o=>[JSON.stringify(o.id),o.id]));values.set('null',null);for(const page of state.objects.filter(o=>o.kind==='page'&&o.sourceId===sourceId)){const value=page.values[group.value]??null;for(const item of Array.isArray(value)?value:[value])values.set(JSON.stringify(item),item)}for(const key of config.hiddenGroups??[])if(!values.has(key))values.set(key,JSON.parse(key));hiddenGroups.replaceChildren(...[...values].map(([key,value])=>element('option',{value:key,selected:(config.hiddenGroups??[]).includes(key)},format(value,p))));};group.addEventListener('change',updateHidden);updateHidden();
  const date = select(dateOptions, config.datePropertyId ?? ''), endDate = select(dateOptions, config.endDatePropertyId ?? ''), place = select([options[0], ...options.filter(option => objects.get(option.id)?.type === 'place')], config.placePropertyId ?? '');
  const chartValue = select(options, config.chart?.valuePropertyId ?? ''), chartGroup = select(options, config.chart?.groupBy ?? ''), chartAggregation = select(['count', 'sum', 'average', 'min', 'max'].map(id => ({ id, name: id })), config.chart?.aggregation ?? 'count');
  const chartType=select([{id:'bar',name:'막대'},{id:'line',name:'선'},{id:'donut',name:'도넛'}],config.chart?.type??'bar');
  const openMode = select([{ id: 'side', name: '사이드 보기' }, { id: 'center', name: '중앙에서 보기' }, { id: 'page', name: '전체 페이지 보기' }], config.openMode ?? 'side');
  const widgets = select(state.objects.filter(item => item.kind === 'view' && item.viewType !== 'dashboard' && visible(item.id)).map(item => ({ id: item.id, name: item.name })), config.widgets ?? [], { multiple: true, size: 4 });
  const taskDisplay = select([], config.subitems?.display ?? ''), taskInclude = select([], config.subitems?.include ?? '');
  const updateTasks = (initial = false) => {
    const tree = ['table', 'list', 'timeline'].includes(type.value), card = ['board', 'calendar', 'gallery'].includes(type.value);
    const previousDisplay = initial ? config.subitems?.display : taskDisplay.value, previousInclude = initial ? config.subitems?.include : taskInclude.value;
    const displays = tree ? [{ id: 'nested', name: '계층으로 표시' }, { id: 'flat', name: '평면으로 표시' }] : card ? [{ id: 'card', name: '카드에 하위 항목 표시' }, { id: 'flat', name: '평면으로 표시' }] : [{ id: 'flat', name: '평면으로 표시' }];
    const includes = tree ? [{ id: 'all', name: '상위·하위 모두' }, { id: 'parents', name: '상위 항목만' }, { id: 'children', name: '하위 항목만' }] : [{ id: card && (previousDisplay || displays[0].id) === 'card' ? 'parents' : 'all', name: card && (previousDisplay || displays[0].id) === 'card' ? '상위 항목만' : '모든 항목' }];
    taskDisplay.replaceChildren(...displays.map(option => element('option', { value: option.id, selected: option.id === previousDisplay }, option.name)));
    taskInclude.replaceChildren(...includes.map(option => element('option', { value: option.id, selected: option.id === previousInclude }, option.name)));
  };
  type.addEventListener('change', () => updateTasks()); taskDisplay.addEventListener('change', () => updateTasks()); updateTasks(true);
  const tasks = objects.get(sourceId).tasks?.subitems?.enabled && element('fieldset', {}, element('legend', {}, '하위 항목 보기'), label('하위 항목 배치', taskDisplay), label('포함할 항목', taskInclude));
  modal('보기 설정', [label('이름', name), label('유형', type), tasks,label('하위 그룹',subgroup),label('숨길 그룹',hiddenGroups),label('달력 표시 단위',calendarMode),label('타임라인 확대 단위',timelineZoom),label('카드 미리보기',preview),label('미리보기 파일 속성',previewProperty), filters.node, element('fieldset', {}, element('legend', {}, '정렬 · 위쪽 조건 우선'), sortList, button('정렬 추가', () => addSort())), label('그룹', group), element('fieldset', {}, element('legend', {}, '표시 속성 · 열 순서'), columns), label('시작 날짜 속성', date), label('종료 날짜 속성', endDate), label('장소 속성', place), label('차트 그룹', chartGroup), label('차트 값', chartValue), label('차트 집계', chartAggregation),label('차트 종류',chartType), label('상세 열기 방식', openMode), label('대시보드 보기', widgets)], async () => {
    const next = { ...config, filter: filters.read(), sorts: sortControls.filter(sort => sort.property.value).map(sort => ({ propertyId: sort.property.value, direction: sort.direction.value })), groupBy: group.value || null,
      visibleProperties: columnEntries.filter(entry => entry.checked.checked).map(entry => entry.id), widgets: [...widgets.selectedOptions].map(option => option.value), openMode: openMode.value,
      datePropertyId: date.value || null, endDatePropertyId: endDate.value || null, placePropertyId: place.value || null,
      chart: chartGroup.value ? { groupBy: chartGroup.value, aggregation: chartAggregation.value,type:chartType.value, ...(chartValue.value ? { valuePropertyId: chartValue.value } : {}) } : null };
    if (tasks) next.subitems = { display: taskDisplay.value, include: taskInclude.value };
    Object.assign(next,{subgroupBy:subgroup.value||null,hiddenGroups:[...hiddenGroups.selectedOptions].map(o=>o.value),groupOrder:group.value===(config.groupBy??'')?config.groupOrder??[]:[],calendarMode:calendarMode.value,timelineZoom:timelineZoom.value,galleryPreview:preview.value,previewPropertyId:previewProperty.value||null,columnAggregations:Object.fromEntries(columnEntries.filter(e=>e.aggregation.value).map(e=>[e.id,e.aggregation.value])),frozenProperties:columnEntries.filter(e=>e.frozen.checked).map(e=>e.id)});
    await apply([existing ? { type: 'view.update', id: existing.id, name: name.value, viewType: type.value, config: next } : { type: 'view.create', id: crypto.randomUUID(), sourceId, parentId: parentId ?? (objects.get(selected)?.kind === 'page' ? selected : objects.get(sourceId).parentId), name: name.value, viewType: type.value, config: next }], revision);
  });
}
function linkedViewDialog(pageId) {
  const source = select(sources().map(item => ({ id: item.id, name: item.name })), '', { 'aria-label': '연결할 데이터베이스' }), view = select([], '', { 'aria-label': '기준 보기' });
  const update = () => view.replaceChildren(element('option', { value: '' }, '새 설정으로 만들기'), ...state.objects.filter(item => item.kind === 'view' && item.sourceId === source.value && visible(item.id)).map(item => element('option', { value: item.id }, item.name)));
  source.addEventListener('change', update); update();
  modal('연결된 보기 추가', [label('데이터베이스', source), label('기준 보기', view)], () => {
    if (!source.value) throw new Error('연결할 데이터베이스를 먼저 만드세요.');
    viewDialog(source.value, null, pageId, objects.get(view.value));
  });
}
async function attachmentDialog(parentId, block = null) {
  await Promise.all(pendingSaves);
  const revision = state.revision, blockId = block?.id ?? crypto.randomUUID();
  const type = select([{ id: 'file', name: '파일' }, { id: 'image', name: '이미지' }], block?.blockType ?? 'file', { disabled: !!block, 'aria-label': '본문 첨부 유형' });
  const stored = select([], '', { 'aria-label': '저장된 첨부' }), picker = input('', { type: 'file', 'aria-label': '새 본문 첨부 파일' });
  const update = () => {
    stored.replaceChildren(element('option', { value: '' }, '선택하세요'), ...state.objects.filter(item => item.kind === 'attachment' && item.alive && (type.value !== 'image' || ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(item.mediaType))).map(item => element('option', { value: item.id, selected: item.id === block?.attachmentId }, item.name)));
    picker.accept = type.value === 'image' ? 'image/png,image/jpeg,image/gif,image/webp,image/avif' : ''; picker.value = '';
  };
  type.addEventListener('change', update); stored.addEventListener('change', () => { picker.value = ''; }); picker.addEventListener('change', () => { if (picker.files.length) stored.value = ''; }); update();
  modal(block ? '본문 첨부 교체' : '본문 첨부 추가', [label('유형', type), label('저장된 첨부 사용', stored), label('새 파일 선택', picker)], async () => {
    const file = picker.files[0];
    if (file) { await uploadFile(file, revision, block ? { blockId } : { parentId, blockId, blockType: type.value }); await refresh(true); }
    else {
      if (!stored.value) throw new Error('저장된 첨부를 고르거나 새 파일을 선택하세요.');
      await apply([block ? { type: 'block.update', id: blockId, attachmentId: stored.value } : { type: 'block.create', id: blockId, parentId, blockType: type.value, attachmentId: stored.value }], revision);
    }
  });
}
function blockFieldControl(block, field, name, beforeAction) {
  const key = blockFieldKey(block.id, field), committed = block[field] ?? '';
  let draft = localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)) : null;
  if (draft?.value === committed) { localStorage.removeItem(key); draft = null; }
  let revision = draft?.baseRevision ?? state.revision, editing = !!draft;
  const control = input(draft?.value ?? committed, { 'aria-label': name });
  control.addEventListener('input', () => {
    if (!editing && (objects.get(block.id)?.[field] ?? '') === committed) revision = state.revision;
    editing = true; storeLocal(key, JSON.stringify({ value: control.value, baseRevision: revision }));
  });
  const commit = async () => {
    const previousRevision = state.revision; if (await beforeAction() === false) return;
    if (revision === previousRevision && (objects.get(block.id)?.[field] ?? '') === committed) revision = state.revision;
    control.value = control.value.trim(); storeLocal(key, JSON.stringify({ value: control.value, baseRevision: revision })); await apply([{ type: 'block.update', id: block.id, [field]: control.value }], revision);
  };
  control.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit().catch(report); } });
  return element('div', { class: 'inline' }, label(name, control), button(`${name} 저장`, commit));
}
// 블록 메뉴(핸들 왼쪽에 뜨는 265px 메뉴 · 작업 검색 · 블록 유형 머리 · 전환/색 · 링크 복사/복제/옮기기/삭제 · 최종 편집 정보)
const actorNames = { user: '나', fixture: '합성 자료', mcp: '에이전트', agent: '에이전트' };
function blockActions(block, beforeAction = async () => true, extra = []) {
  const item = (iconName, text, hint, action, attributes = {}) => button([icon(iconName), element('span', { class: 'menu-label' }, text), hint ? element('span', { class: 'menu-hint' }, hint) : null], action, { role: 'menuitem', ...attributes });
  const search = input('', { class: 'menu-search', placeholder: '작업 검색…', 'aria-label': '블록 작업 검색', oninput: event => { const needle = event.target.value.trim().toLocaleLowerCase(); for (const node of event.target.parentElement.querySelectorAll(':scope > button, :scope > label.menu-select')) node.hidden = !!needle && !node.textContent.toLocaleLowerCase().includes(needle); for (const node of event.target.parentElement.querySelectorAll(':scope > .menu-separator, :scope > .menu-heading, :scope > .block-menu-meta')) node.hidden = !!needle; } });
  const text = runsText(block.richText ?? []), words = text.trim() ? text.trim().split(/\s+/).length : 0, edited = block.updatedAt ? new Date(block.updatedAt) : null;
  const meta = element('div', { class: 'block-menu-meta', 'aria-label': '최종 편집' }, element('div', { class: 'menu-heading' }, '최종 편집'), element('div', { class: 'block-menu-editor' }, element('span', { class: 'workspace-mark', 'aria-hidden': 'true' }, (actorNames[block.updatedBy] ?? block.updatedBy ?? '?').slice(0, 1)), element('span', {}, actorNames[block.updatedBy] ?? block.updatedBy ?? '알 수 없음')), edited && element('div', { class: 'block-menu-date' }, edited.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })), block.richText && element('div', { class: 'block-menu-date' }, `${words}단어, ${text.length}자`));
  return element('span', { class: 'block-tools', role: 'menu', 'aria-label': '블록 메뉴' }, search, element('div', { class: 'menu-heading' }, blockLabels[block.blockType] ?? '블록'), ...extra,
    element('div', { class: 'menu-separator', role: 'separator' }),
    item('link', '블록 링크 복사', '⌘^L', async () => { closeBlockMenus(); let page = objects.get(block.parentId); while (page?.kind === 'block') page = objects.get(page.parentId); const url = `${location.origin}/?id=${encodeURIComponent(page?.id ?? block.parentId)}#${encodeURIComponent(block.id)}`; await navigator.clipboard?.writeText(url); status('블록 링크를 복사했습니다.'); }, { 'aria-label': '블록 링크 복사' }),
    item('duplicate', '복제', '⌘D', async () => { closeBlockMenus();
      if (await beforeAction() === false) return;
      const siblings = childrenOf(block.parentId), next = siblings[siblings.findIndex(item => item.id === block.id) + 1];
      await apply([{ type: 'block.duplicate', id: block.id, ...(next ? { beforeId: next.id } : {}) }]);
    }, { 'aria-label': '블록 복제' }),
    item('move', '옮기기', '⌘⇧P', async () => { closeBlockMenus();
      if (await beforeAction() === false) return;
      const revision = state.revision, targets = state.objects.filter(item => ['page', 'block'].includes(item.kind) && item.id !== block.id && item.blockType !== 'synced_reference' && visible(item.id));
      const parent = select(targets.map(item => ({ id: item.id, name: item.title ?? ((item.richText ?? []).map(run => run.text).join('').slice(0, 60) || blockLabels[item.blockType]) })), block.parentId);
      modal('블록 이동', [label('옮길 위치', parent)], () => apply([{ type: 'node.move', id: block.id, parentId: parent.value }], revision));
    }, { 'aria-label': '블록 옮기기' }),
    item('trash', '삭제', 'Del', async () => { closeBlockMenus(); if (await beforeAction() !== false) await apply([{ type: 'node.trash', id: block.id }]); }, { 'aria-label': '블록 삭제', class: 'danger' }),
    element('div', { class: 'menu-separator', role: 'separator' }),
    item('bell', '알림', null, () => { closeBlockMenus(); reminderDialog(block.id); }, { 'aria-label': '알림' }),
    element('div', { class: 'menu-separator', role: 'separator' }), meta);
}
function closeBlockMenus(except = null) { for (const node of document.querySelectorAll('.block.menu-open')) if (node !== except) node.classList.remove('menu-open'); }
function toggleBlockMenu(wrapper) { closePopover(); closeBlockMenus(wrapper); const open = wrapper.classList.toggle('menu-open'); if (!open) return; const tools = wrapper.querySelector(':scope > .block-tools, :scope > .block-line > .block-tools, :scope > details > summary > .block-line > .block-tools'), handle = wrapper.querySelector(':scope > .block-drag') ?? wrapper; if (!tools) return;
  const place = () => { const rect = handle.getBoundingClientRect(), width = tools.offsetWidth, height = tools.offsetHeight; let left = rect.left - width - 4; if (left < 8) left = Math.min(innerWidth - width - 8, rect.right + 4); const top = Math.max(8, Math.min(innerHeight - height - 8, rect.top + rect.height / 2 - height / 2)); tools.style.left = `${left}px`; tools.style.top = `${top}px`; };
  place(); const search = tools.querySelector(':scope > .menu-search'); if (search) { search.value = ''; search.dispatchEvent(new Event('input')); search.focus(); } else tools.querySelector('select,button')?.focus(); }
document.addEventListener('scroll', event => { if (event.target?.id === 'main' && document.querySelector('.block.menu-open')) closeBlockMenus(); }, true);
document.addEventListener('pointerdown', event => { if (!event.target.closest?.('.block.menu-open > .block-tools, .block.menu-open > .block-line > .block-tools, .block.menu-open > details > summary > .block-line > .block-tools, .block-drag')) closeBlockMenus(); }, true);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.querySelector('.block.menu-open')) { const open = document.querySelector('.block.menu-open'); closeBlockMenus(); open.querySelector(':scope > .block-drag')?.focus(); } });
function clearDropMarks(except = null) { for (const node of document.querySelectorAll('[data-drop]')) if (node !== except) delete node.dataset.drop; }
document.addEventListener('dragend', () => clearDropMarks());
document.addEventListener('keydown', async event => {
  if (event.defaultPrevented || event.isComposing || !blockSelection.size || document.activeElement?.matches('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') { blockSelection.clear(); updateBlockSelection(); return; }
  if (['Backspace', 'Delete'].includes(event.key)) { const ids = selectedBlockRoots(); if (!ids.length) return; event.preventDefault(); try { await apply(ids.map(id => ({ type: 'node.trash', id }))); blockSelection.clear(); updateBlockSelection(); } catch (error) { report(error); } }
});
async function addBlockBelow(block) {
  const siblings = childrenOf(block.parentId), next = siblings[siblings.findIndex(item => item.id === block.id) + 1], id = crypto.randomUUID();
  await apply([{ type: 'block.create', id, parentId: block.parentId, ...(next ? { beforeId: next.id } : {}) }]);
  const editor = document.querySelector(`[data-block-id="${CSS.escape(id)}"] [contenteditable]`); if (!editor) return;
  editor.focus(); editor.textContent = '/'; const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(range);
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '/' }));
}
function readRich(root) {
  const result = [];
  function walk(node, marks = {}) {
    if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) result.push({ text: node.textContent, ...marks }); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName)) return;
    if(['SCRIPT','STYLE','IFRAME','OBJECT','NOSCRIPT'].includes(node.tagName))return;
    const next = { ...marks };
    if (['B', 'STRONG'].includes(node.tagName)) next.bold = true;
    if (['I', 'EM'].includes(node.tagName)) next.italic = true;
    if (['S', 'DEL', 'STRIKE'].includes(node.tagName)) next.strike = true;
    if (node.tagName === 'CODE') next.code = true;
    if(node.tagName==='U'||node.style?.textDecoration?.includes('underline'))next.underline=true;
    if(node.style?.fontWeight==='bold'||Number(node.style?.fontWeight)>=600)next.bold=true;if(node.style?.fontStyle==='italic')next.italic=true;if(node.style?.textDecoration?.includes('line-through'))next.strike=true;
    const cssColor=value=>{if(/^#[0-9a-f]{6}$/i.test(value)||colors.includes(value))return value;const m=value?.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\)$/);return m?'#'+m.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join(''):null;};
    const color=cssColor(node.dataset?.color??node.style?.color),background=cssColor(node.dataset?.background??node.style?.backgroundColor);if(color)next.color=color;if(background)next.background=background;
    if (node.tagName === 'A') {
      if (/^(https?:|mailto:)/i.test(node.getAttribute('href') ?? '')) next.href = node.getAttribute('href');
      if (objects.get(node.dataset.pageId)?.kind === 'page') next.pageId = node.dataset.pageId;
    }
    if (node.tagName === 'BR') result.push({ text: '\n' });
    else { if (['DIV', 'P', 'LI'].includes(node.tagName) && result.length && !result.at(-1).text.endsWith('\n')) result.push({ text: '\n' }); for (const child of node.childNodes) walk(child, next); }
  }
  for (const child of root.childNodes) walk(child);
  return result;
}
function richNodes(runs) {
  return runs.map(run => {
    let node = document.createTextNode(run.text);
    for (const [mark, tag] of [['code', 'code'], ['bold', 'strong'], ['italic', 'em'], ['strike', 's'],['underline','u']]) if (run[mark]) node = element(tag, {}, node);
    if(run.color||run.background)node=element('span',{'data-color':run.color,'data-background':run.background,class:`${run.color&&!run.color.startsWith('#')?'text-'+run.color:''} ${run.background&&!run.background.startsWith('#')?'bg-'+run.background:''}`,style:`${run.color?.startsWith('#')?'color:'+run.color+';':''}${run.background?.startsWith('#')?'background-color:'+run.background+';':''}`},node);
    if (run.href) node = element('a', { href: run.href, rel: 'noopener', target: '_blank' }, node);
    if (run.pageId) node = element('a', { href: `/?id=${encodeURIComponent(run.pageId)}`, 'data-page-id': run.pageId }, node);
    return node;
  });
}
function focusBlock(id, offset = 0) {
  const editor = document.querySelector(`[data-block-id="${CSS.escape(id)}"] [contenteditable]`);
  if (!editor) return;
  editor.focus();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); let node, remaining = offset;
  const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
  while ((node = walker.nextNode())) {
    if (remaining <= node.textContent.length) { range.setStart(node, remaining); range.collapse(true); break; }
    remaining -= node.textContent.length;
  }
  getSelection().removeAllRanges(); getSelection().addRange(range);
}
const richToolbars = new WeakMap(); let activeRichToolbar = null;
function placeRichToolbar() {
  const selection = getSelection(); let toolbar = null, rect = null;
  if (selection.rangeCount && !selection.isCollapsed) {
    const node = selection.anchorNode, editor = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('[contenteditable=true]');
    if (editor && editor.contains(selection.focusNode)) { toolbar = richToolbars.get(editor) ?? null; rect = selection.getRangeAt(0).getBoundingClientRect(); }
  }
  if (activeRichToolbar && activeRichToolbar !== toolbar && !activeRichToolbar.contains(document.activeElement)) activeRichToolbar.classList.remove('active');
  if (toolbar && rect && (rect.width || rect.height)) {
    toolbar.classList.add('active');
    const width = toolbar.offsetWidth, height = toolbar.offsetHeight;
    toolbar.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    toolbar.style.top = `${rect.bottom + 8 + height > innerHeight - 8 ? Math.max(8, rect.top - height - 8) : rect.bottom + 8}px`;
    activeRichToolbar = toolbar;
  } else if (!activeRichToolbar?.contains(document.activeElement)) activeRichToolbar = null;
}
document.addEventListener('selectionchange', placeRichToolbar);
document.addEventListener('scroll', () => { if (activeRichToolbar) placeRichToolbar(); }, true);
function richToolbar(editor, changed, save, isComposing, blockInfo = null) {
  let lastSelection = { start: 0, end: 0 };
  function capture() {
    const selection = getSelection();
    if (selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
        const offset = (node, at) => {
          const prefix = document.createRange(); prefix.selectNodeContents(editor); prefix.setEnd(node, at);
          const root = element('div', {}, prefix.cloneContents()); return runsText(readRich(root)).length;
        };
        lastSelection = { start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) };
      }
    }
    return { ...lastSelection };
  }
  function selectOffsets(start, end) {
    const point = offset => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); let node, consumed = 0;
      while ((node = walker.nextNode())) { if (offset <= consumed + node.textContent.length) return [node, offset - consumed]; consumed += node.textContent.length; }
      return [editor, editor.childNodes.length];
    };
    const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(end));
    editor.focus(); getSelection().removeAllRanges(); getSelection().addRange(range); lastSelection = { start, end };
  }
  async function commit(runs, start, end) {
    if (isComposing()) throw new Error('글자 조합을 확정한 뒤 서식을 변경하세요.');
    editor.replaceChildren(...richNodes(runs)); selectOffsets(start, end); changed();
    if (await save() === false) throw new Error('입력을 보존했습니다. 보류한 저장을 확인하세요.');
  }
  function selected(expandLink = false) {
    const range = capture(), runs = readRich(editor);
    if (expandLink && range.start === range.end) {
      let offset = 0;
      for (const run of runs) { if (range.start >= offset && range.start <= offset + run.text.length && (run.href || run.pageId)) { range.start = offset; range.end = offset + run.text.length; break; } offset += run.text.length; }
    }
    return { ...range, runs };
  }
  const requireSelection = range => { if (range.start === range.end) throw new Error('변경할 텍스트를 먼저 선택하세요.'); };
  const mark = async name => { const range = selected(); requireSelection(range); await commit(toggleMark(range.runs, range.start, range.end, name), range.start, range.end); };
  function linkDialog(mention = false) {
    const range = selected(true), picked = selectedRuns(range.runs, range.start, range.end), text = runsText(picked), first = picked[0];
    const caption = input(text, { 'aria-label': '표시 텍스트' });
    const target = mention ? select([{ id: '', name: '페이지를 선택하세요' }, ...state.objects.filter(item => item.kind === 'page' && visible(item.id)).map(item => ({ id: item.id, name: item.title }))], first?.pageId ?? '', { 'aria-label': '참조할 페이지' }) : input(first?.href ?? '', { 'aria-label': '링크 URL', placeholder: 'https://…' });
    modal(mention ? '페이지 멘션 편집' : '링크 편집', [label('표시 텍스트', caption), label(mention ? '페이지' : 'URL', target)], async () => {
      let patch;
      if (mention) { if (!target.value) throw new Error('참조할 페이지를 선택하세요.'); patch = { pageId: target.value, href: null }; }
      else { let valid = false; try { valid = ['http:', 'https:', 'mailto:'].includes(new URL(target.value.trim()).protocol); } catch {} if (!valid) throw new Error('http, https, mailto 링크를 입력하세요.'); patch = { href: target.value.trim(), pageId: null }; }
      const labelText = caption.value || (mention ? objects.get(target.value).title : target.value.trim());
      const runs = labelText === text ? patchRuns(range.runs, range.start, range.end, patch) : replaceRuns(range.runs, range.start, range.end, [{ ...Object.fromEntries(Object.entries(first ?? {}).filter(([key]) => !['text', 'href', 'pageId'].includes(key))), text: labelText, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value != null)) }]);
      await commit(runs, range.start, range.start + labelText.length);
    });
  }
  // 선택 서식 도구(선택 아래에 뜨는 세로 팝오버 — 블록 유형 행 · 서식 아이콘 두 줄)
  const colorNames = ['기본', '회색', '갈색', '주황색', '노란색', '초록색', '파란색', '보라색', '분홍색', '빨간색'];
  const colorMenu = anchor => { const range = selected(); requireSelection(range); const pick = (field, id) => commit(patchRuns(range.runs, range.start, range.end, { [field]: id === 'default' ? null : id }), range.start, range.end).catch(report);
    popover(anchor, api => [element('div', { class: 'menu-heading' }, '텍스트 색'), element('div', { class: 'color-grid' }, colors.map((id, index) => button(element('span', { class: `color-swatch text-${id}` }, 'A'), () => { api.close(); pick('color', id); }, { 'aria-label': `${colorNames[index]} 텍스트`, title: `${colorNames[index]} 텍스트` }))), element('div', { class: 'menu-heading' }, '배경 색'), element('div', { class: 'color-grid' }, colors.map((id, index) => button(element('span', { class: `color-swatch bg-${id}` }, 'A'), () => { api.close(); pick('background', id); }, { 'aria-label': `${colorNames[index]} 배경`, title: `${colorNames[index]} 배경` })))], { className: 'color-popover' }); };
  const markButton = (key, name, glyph, shortcut) => button(glyph, () => mark(key), { 'aria-label': name, title: shortcut ? `${name} (⌘/Ctrl+${shortcut})` : name, class: `mark-button mark-${key}` });
  const toolbar = element('div', { class: 'rich-tools', role: 'toolbar', 'aria-label': '텍스트 서식' },
    blockInfo && button([icon('type-text'), element('span', { class: 'menu-label' }, blockInfo.label), icon('chevron-right')], event => menu(event.currentTarget, Object.entries(blockLabels).filter(([id]) => !['synced', 'synced_reference', 'column'].includes(id)).map(([id, name]) => ({ label: name, hint: id === blockInfo.type ? '✓' : '', action: () => blockInfo.change(id) }))), { class: 'rich-turn', 'aria-label': `블록 유형 전환 · ${blockInfo.label}`, 'aria-haspopup': 'menu' }),
    element('div', { class: 'rich-grid' },
      button([element('span', { class: 'mark-color-glyph' }, 'A')], event => colorMenu(event.currentTarget), { 'aria-label': '텍스트·배경 색', title: '텍스트·배경 색', class: 'mark-button mark-color', 'aria-haspopup': 'menu' }),
      markButton('bold', '굵게', 'B', 'B'), markButton('italic', '기울임', 'I', 'I'), markButton('underline', '밑줄', 'U', 'U'),
      iconButton('clear-format', '서식 제거', async () => { const range = selected(); requireSelection(range); await commit(patchRuns(range.runs, range.start, range.end, { bold: null, italic: null, strike: null, code: null,underline:null,color:null,background:null }), range.start, range.end); }),
      iconButton('link', '링크', () => linkDialog(), { title: '링크 (⌘/Ctrl+K)' }), markButton('strike', '취소선', 'S'), markButton('code', '인라인 코드', '</>', 'E'), iconButton('mention', '페이지 멘션', () => linkDialog(true)),
      iconButton('unlink', '링크·멘션 제거', async () => { const range = selected(true); requireSelection(range); await commit(patchRuns(range.runs, range.start, range.end, { href: null, pageId: null }), range.start, range.end); })));
  richToolbars.set(editor, toolbar);
  toolbar.addEventListener('mousedown', event => { capture(); event.preventDefault(); });
  editor.addEventListener('mouseup', capture); editor.addEventListener('keyup', capture);
  editor.addEventListener('keydown', event => {
    if (isComposing() || event.isComposing || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase(), name = { b: 'bold', i: 'italic', e: 'code',u:'underline' }[key];
    if (name || key === 'k') { event.preventDefault(); if (key === 'k') linkDialog(); else mark(name).catch(report); }
  });
  return toolbar;
}
function blockOrder(){const root=recordDialog?.querySelector('article[aria-label="페이지 본문"]')??document.querySelector('#main article[aria-label="페이지 본문"]');return [...new Set([...(root?.querySelectorAll('[data-block-id]')??[])].map(n=>n.dataset.blockId))];}
function selectedBlockRoots(){return blockOrder().filter(id=>{if(!blockSelection.has(id)||!visible(id))return false;let parent=objects.get(objects.get(id).parentId);while(parent?.kind==='block'){if(blockSelection.has(parent.id))return false;parent=objects.get(parent.parentId)}return true;});}
function updateBlockSelection(){for(const node of document.querySelectorAll('[data-block-select]'))node.checked=blockSelection.has(node.dataset.blockSelect);for(const node of document.querySelectorAll('[data-block-count]'))node.textContent=`${blockSelection.size}개 블록 선택`;}
function blockSelectionTools(){return element('div',{class:'toolbar block-selection',role:'toolbar','aria-label':'선택 블록 작업'},element('output',{'data-block-count':true},`${blockSelection.size}개 블록 선택`),button('선택 블록 복제',()=>{const ids=selectedBlockRoots();if(!ids.length)throw new Error('블록을 먼저 선택하세요.');return apply([{type:'blocks.duplicate',ids}])}),button('선택 블록 이동',()=>{const ids=selectedBlockRoots();if(!ids.length)throw new Error('블록을 먼저 선택하세요.');const columns=ids.every(id=>objects.get(id).blockType==='column'),targets=state.objects.filter(x=>visible(x.id)&&!ids.includes(x.id)&&(columns?x.blockType==='columns':['page','block'].includes(x.kind)&&!['columns','synced_reference'].includes(x.blockType))),parent=select(targets.map(x=>({id:x.id,name:x.title||runsText(x.richText??[]).slice(0,40)||blockLabels[x.blockType]})),targets[0]?.id),before=select([],''),revision=state.revision,update=()=>before.replaceChildren(element('option',{value:''},'마지막에 배치'),...childrenOf(parent.value).filter(x=>!ids.includes(x.id)).map(x=>element('option',{value:x.id},`${x.title||runsText(x.richText??[]).slice(0,30)||blockLabels[x.blockType]} 앞`)));parent.addEventListener('change',update);update();modal('선택 블록 이동',[label('옮길 위치',parent),label('배치 위치',before)],async()=>{await apply(ids.map(id=>({type:'node.move',id,parentId:parent.value,...(before.value?{beforeId:before.value}:{})})),revision);blockSelection.clear();updateBlockSelection()});}),button('선택 블록 삭제',async()=>{const ids=selectedBlockRoots();if(!ids.length)throw new Error('블록을 먼저 선택하세요.');await apply(ids.map(id=>({type:'node.trash',id})));blockSelection.clear();updateBlockSelection()}),button('블록 선택 해제',()=>{blockSelection.clear();updateBlockSelection()}));}
function renderSimpleTable(wrapper,block) {
  const key=`pageyard-table-draft:${block.id}`,cached=localStorage.getItem(key),draft=cached?JSON.parse(cached):null;let cells=structuredClone(draft?.cells??block.cells??[[[],[]],[[],[]]]),base=draft?.baseRevision??state.revision,editing=!!draft,saved=JSON.stringify(block.cells??[[[],[]],[[],[]]]),inflight=null,blocked=false;
  const table=element('table',{'aria-label':'본문 단순 표',class:'simple-table'}),editors=[];
  const read=()=>editors.map(row=>row.map(readRich));
  const changed=()=>{if(!editing&&JSON.stringify(objects.get(block.id)?.cells??[[[],[]],[[],[]]])===saved)base=state.revision;editing=true;cells=read();storeLocal(key,JSON.stringify({cells,baseRevision:base}));};
  const save=async()=>{if(blocked)return false;if(inflight)await inflight;if(blocked)return false;const next=read();if(JSON.stringify(next)===saved)return true;const request=sendCommand({id:crypto.randomUUID(),actor:'user',expectedRevision:base,operations:[{type:'block.update',id:block.id,cells:next}]});inflight=request;pendingSaves.add(request);try{const result=await request;base=result.revision;state.revision=result.revision;block.cells=next;saved=JSON.stringify(next);if(JSON.stringify(read())===saved){localStorage.removeItem(key);editing=false;}else changed();return true;}catch(error){blocked=true;report(error);return false;}finally{pendingSaves.delete(request);inflight=null;}};
  cells.forEach((row,r)=>{const tr=element('tr'),controls=[];row.forEach((runs,c)=>{const cell=element('div',{contentEditable:true,role:'textbox','aria-label':`표 ${r+1}행 ${c+1}열`},richNodes(runs));controls.push(cell);cell.addEventListener('input',changed);cell.addEventListener('blur',()=>save().catch(report));cell.addEventListener('paste',event=>{event.preventDefault();const text=event.clipboardData.getData('text/plain');try{if(text.includes('\t')||text.includes('\n')){const grid=clipboardRows(text);if(r+grid.length>editors.length||grid.some(row=>c+row.length>editors[r].length))throw new Error('붙여넣을 범위만큼 먼저 행·열을 추가하세요.');grid.forEach((row,ri)=>row.forEach((text,ci)=>editors[r+ri][c+ci].replaceChildren(...richNodes([{text}]))));changed();}else{const selection=getSelection();if(!selection.rangeCount)return;const range=selection.getRangeAt(0);if(!cell.contains(range.commonAncestorContainer))return;range.deleteContents();const html=event.clipboardData.getData('text/html'),root=html?new DOMParser().parseFromString(html,'text/html').body:element('div',{},text),fragment=document.createDocumentFragment();fragment.append(...richNodes(readRich(root)));const last=fragment.lastChild;range.insertNode(fragment);if(last){range.setStartAfter(last);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}changed();}}catch(error){report(error)}});tr.append(element(block.tableHeader?.row&&r===0||block.tableHeader?.column&&c===0?'th':'td',{},richToolbar(cell,changed,save,()=>false),cell));});editors.push(controls);table.append(tr);});
  const update=async next=>{if(await save()===false)return;return apply([{type:'block.update',id:block.id,cells:next}],base)};
  wrapper.append(element('div',{class:'table-wrap'},table),element('div',{class:'toolbar table-tools'},button('표 저장',save),button('행 추가',()=>update([...read(),read()[0].map(()=>[])])),button('열 추가',()=>update(read().map(row=>[...row,[]]))),button('마지막 행 제거',()=>modal('행 제거 확인',[element('p',{},'마지막 행의 값을 제거합니다. 변경 기록에서 되돌릴 수 있습니다.')],()=>update(read().slice(0,-1))),{disabled:cells.length<=1}),button('마지막 열 제거',()=>modal('열 제거 확인',[element('p',{},'마지막 열의 값을 제거합니다. 변경 기록에서 되돌릴 수 있습니다.')],()=>update(read().map(row=>row.slice(0,-1)))),{disabled:cells[0].length<=1}),button('표 머리글',()=>{const row=input('',{type:'checkbox',checked:block.tableHeader?.row}),column=input('',{type:'checkbox',checked:block.tableHeader?.column});modal('표 머리글',[label('첫 행을 머리글로',row),label('첫 열을 머리글로',column)],async()=>{if(await save()!==false)return apply([{type:'block.update',id:block.id,tableHeader:{row:row.checked,column:column.checked}}],base)})})),blockActions(block,save));
}
function blockElement(block, stack = new Set()) {
  if (stack.has(block.id)) return element('p', { class: 'error' }, '순환 참조');
  stack = new Set([...stack, block.id]);
  const wrapper = element('section', { class: 'block', 'data-block-id': block.id });
  wrapper.append(input('',{type:'checkbox',checked:blockSelection.has(block.id),'data-block-select':block.id,'aria-label':`블록 선택: ${runsText(block.richText??[]).slice(0,40)||blockLabels[block.blockType]}`,onclick:event=>{const order=blockOrder();if(event.shiftKey&&blockAnchor&&order.includes(blockAnchor)){const a=order.indexOf(blockAnchor),b=order.indexOf(block.id);for(const id of order.slice(Math.min(a,b),Math.max(a,b)+1))blockSelection.add(id);}else if(event.target.checked)blockSelection.add(block.id);else blockSelection.delete(block.id);blockAnchor=block.id;updateBlockSelection();}}));
  wrapper.append(element('button',{type:'button',class:'block-add','aria-label':'아래에 블록 추가',title:'클릭하여 아래에 블록 추가',onclick:()=>addBlockBelow(block)},icon('plus')),element('span',{draggable:true,'data-block-drag':block.id,'aria-label':'블록 끌기',class:'block-drag',role:'button',tabindex:0,'aria-haspopup':'menu',title:'끌어서 이동 · 클릭하여 메뉴 열기',onclick:()=>toggleBlockMenu(wrapper),onkeydown:event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();toggleBlockMenu(wrapper)}}},icon('drag')));wrapper.addEventListener('dragstart',event=>{if(event.target.closest('[data-block-drag]')?.dataset.blockDrag!==block.id)return;event.stopPropagation();if(!blockSelection.has(block.id)){blockSelection.clear();blockSelection.add(block.id);updateBlockSelection()}event.dataTransfer.setData('application/x-local-blocks',JSON.stringify(selectedBlockRoots()))});
  wrapper.addEventListener('dragover',event=>{if(!event.dataTransfer.types.includes('application/x-local-blocks'))return;event.preventDefault();event.stopPropagation();const rect=wrapper.getBoundingClientRect();clearDropMarks(wrapper);wrapper.dataset.drop=event.altKey?'inside':event.clientY>rect.top+rect.height/2?'below':'above';});wrapper.addEventListener('dragleave',event=>{if(!wrapper.contains(event.relatedTarget))delete wrapper.dataset.drop;});wrapper.addEventListener('drop',async event=>{const text=event.dataTransfer.getData('application/x-local-blocks');clearDropMarks();if(!text)return;event.preventDefault();event.stopPropagation();try{const ids=JSON.parse(text);if(ids.includes(block.id))return;const below=event.clientY>wrapper.getBoundingClientRect().top+wrapper.getBoundingClientRect().height/2,siblings=childrenOf(block.parentId),next=siblings[siblings.findIndex(x=>x.id===block.id)+1],parentId=event.altKey?block.id:block.parentId,beforeId=event.altKey?null:below?next?.id:block.id;await apply(ids.map(id=>({type:'node.move',id,parentId,...(beforeId?{beforeId}:{})})));blockSelection.clear();}catch(error){report(error)}});
  const reminders=childrenOf(block.id).filter(item=>item.kind==='reminder');if(reminders.length)wrapper.append(element('div',{class:'block-reminders'},reminders.map(item=>button([icon('bell'),`알림: ${item.at?new Date(item.at).toLocaleString('ko-KR'):item.message}`],()=>reminderDialog(block.id,item)))));
  if(block.blockType==='button'){wrapper.append(button([icon('type-button'),block.button?.label??'실행'],()=>runButton(block),{class:'button-block-run','aria-label':block.button?.label??'실행'}),button('버튼 설정',()=>buttonDialog(block),{class:'block-extra'}),blockActions(block));return wrapper;}
  if(block.blockType==='table'){renderSimpleTable(wrapper,block);return wrapper;}
  if(['columns','column'].includes(block.blockType)){wrapper.classList.add(block.blockType);wrapper.append(blockActions(block),element('div',{class:block.blockType==='columns'?'column-grid':'column-content'},childrenOf(block.id).filter(x=>x.kind==='block').map(child=>blockElement(child,stack))),button(block.blockType==='columns'?'단 추가':'블록 추가',()=>apply([{type:'block.create',parentId:block.id,blockType:block.blockType==='columns'?'column':'paragraph'}])));return wrapper;}
  if(block.blockType==='toc'){let page=objects.get(block.parentId);while(page?.kind==='block')page=objects.get(page.parentId);const list=element('ul',{'aria-label':'페이지 목차'}),draw=()=>{const headings=[];const visit=id=>{for(const child of childrenOf(id).filter(x=>x.kind==='block')){if(/^heading[123]$/.test(child.blockType))headings.push(child);visit(child.id)}};visit(page?.id);list.replaceChildren(...headings.map(h=>element('li',{style:`margin-left:${(Number(h.blockType.at(-1))-1)*16}px`},button(runsText(h.richText)||'빈 제목',()=>document.querySelector(`[data-block-id="${CSS.escape(h.id)}"]`)?.scrollIntoView({block:'start'})))));};draw();wrapper.append(list,button('목차 새로 읽기',draw),blockActions(block));return wrapper;}
  if(block.blockType==='math'){const cached=localStorage.getItem(`pageyard-draft:${block.id}`),draft=cached?JSON.parse(cached):null,expression=element('textarea',{value:draft?runsText(draft.richText):runsText(block.richText),'aria-label':'수학식 TeX'}),preview=element('div',{'aria-label':'수학식 미리보기'});let revision=draft?.baseRevision??state.revision,editing=!!draft;const draw=()=>katex.render(expression.value,preview,{displayMode:true,throwOnError:false,trust:false,maxExpand:1000,maxSize:10});wrapper.classList.toggle('math-editing',!!draft);preview.tabIndex=0;preview.setAttribute('role','button');preview.title='클릭하여 수식 편집';preview.addEventListener('click',()=>{wrapper.classList.add('math-editing');expression.focus()});preview.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();wrapper.classList.add('math-editing');expression.focus()}});expression.addEventListener('input',()=>{if(!editing){if(JSON.stringify(objects.get(block.id)?.richText)===JSON.stringify(block.richText))revision=state.revision;editing=true;}storeLocal(`pageyard-draft:${block.id}`,JSON.stringify({richText:[{text:expression.value}],baseRevision:revision}));draw()});draw();wrapper.append(preview,expression,button('수학식 적용',()=>apply([{type:'block.update',id:block.id,richText:[{text:expression.value}]}],revision)),blockActions(block));return wrapper;}
  if(block.blockType==='video'){if(block.attachmentId)wrapper.append(element('video',{controls:true,src:`/api/attachments/${encodeURIComponent(block.attachmentId)}`,preload:'metadata'}));else if(block.url){let src;const u=new URL(block.url);if(['youtube.com','www.youtube.com','youtu.be','www.youtube-nocookie.com'].includes(u.hostname)){const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')??u.pathname.split('/').at(-1);if(/^[\w-]{11}$/.test(id))src=`https://www.youtube-nocookie.com/embed/${id}`;}else if(['vimeo.com','www.vimeo.com'].includes(u.hostname)&&/^\/\d+$/.test(u.pathname))src=`https://player.vimeo.com/video${u.pathname}`;if(src)wrapper.append(element('iframe',{src,title:runsText(block.richText)||'동영상',loading:'lazy',allowFullscreen:true,referrerPolicy:'no-referrer',sandbox:'allow-scripts allow-same-origin allow-presentation'}));wrapper.append(element('a',{href:block.url,target:'_blank',rel:'noopener'},'동영상 링크 열기'));}
    wrapper.append(button('동영상 설정',()=>{const revision=state.revision,url=input(block.url??''),file=select([{id:'',name:'링크 사용'},...state.objects.filter(x=>x.kind==='attachment'&&x.alive&&x.mediaType.startsWith('video/')).map(x=>({id:x.id,name:x.name}))],block.attachmentId??'');modal('동영상 설정',[label('동영상 URL',url),label('저장된 동영상',file)],()=>apply([{type:'block.update',id:block.id,url:url.value,attachmentId:file.value||null}],revision));}),blockActions(block));return wrapper;}
  if (['synced', 'synced_reference'].includes(block.blockType)) {
    wrapper.classList.add('synced'); wrapper.append(element('small', { class: 'muted' }, block.blockType === 'synced' ? '동기화 원본' : '공유 참조'), blockActions(block));
    const parent = block.blockType === 'synced_reference' ? block.sourceBlockId : block.id;
    wrapper.append(...childrenOf(parent).filter(item => item.kind === 'block').map(child => blockElement(child, stack)));
    wrapper.append(button('블록 추가', () => apply([{ type: 'block.create', parentId: parent }]))); return wrapper;
  }
  if (block.blockType === 'divider') { wrapper.append(element('hr'), blockActions(block), element('div', { class: 'block-children' }, childrenOf(block.id).filter(item => item.kind === 'block').map(child => blockElement(child, stack)))); return wrapper; }
  if (['file', 'image'].includes(block.blockType) && block.attachmentId) {
    const attachment = objects.get(block.attachmentId), href = `/api/attachments/${encodeURIComponent(block.attachmentId)}`;
    wrapper.append(element('figure', { class: 'block-media' }, block.blockType === 'image' ? element('img', { src: href, alt: runsText(block.richText ?? []) || attachment?.name || '첨부 이미지', loading: 'lazy', onerror: () => report(new Error('이미지를 표시할 수 없습니다. 첨부 열기로 파일을 확인하세요.')) }) : null, element('a', { href, target: '_blank', rel: 'noopener' }, attachment?.name ?? '첨부 열기')));
  }
  if (block.blockType === 'bookmark' && block.url) wrapper.append(element('a', { href: block.url, target: '_blank', rel: 'noopener', class: 'bookmark-link' }, block.url));
  const editor = element('div', { class: `block-content block-${block.blockType}`, contentEditable: 'true', role: 'textbox', 'aria-label': `${blockLabels[block.blockType] ?? '블록'} 본문`, 'aria-multiline': 'true', 'data-placeholder': "'/'를 입력해 명령어 사용", 'data-list-number': block.blockType === 'numbered' ? blockOrdinal(childrenOf(block.parentId), block.id) : null }, richNodes(block.richText ?? []));
  const commands = element('div', { class: 'block-commands', role: 'listbox', 'aria-label': '블록 명령', hidden: true });
  let commandIndex = 0, commandOptions = [];
  let composing = false, timer, inflight = null, baseRevision = state.revision, saved = JSON.stringify(block.richText ?? []), blocked = false;
  const draftKey = `pageyard-draft:${block.id}`;
  const cached = localStorage.getItem(draftKey);
  if (cached) {
    const draft = JSON.parse(cached);
    if (JSON.stringify(draft.richText) === saved) localStorage.removeItem(draftKey);
    else { editor.replaceChildren(...richNodes(draft.richText)); baseRevision = draft.baseRevision; status('저장하지 못한 입력을 복원했습니다. 최신 상태와 충돌하면 입력을 유지합니다.'); }
  }
  const dirty = () => JSON.stringify(readRich(editor)) !== saved;
  editor.addEventListener('focus', () => { if (!dirty() && !blocked && objects.get(block.id)?.version === block.version) baseRevision = state.revision; });
  async function save() {
    clearTimeout(timer);
    if (composing || blocked || !dirty()) return !composing && !blocked;
    if (inflight) { await inflight; if (dirty()) return save(); return; }
    const richText = readRich(editor), serialized = JSON.stringify(richText);
    storeLocal(draftKey, JSON.stringify({ richText, baseRevision }));
    inflight = sendCommand({ id: crypto.randomUUID(), actor: 'user', expectedRevision: baseRevision, operations: [{ type: 'block.update', id: block.id, richText }] });
    const request = inflight; pendingSaves.add(request);
    try {
      const result = await inflight; baseRevision = result.revision; state.revision = result.revision;
      saved = serialized; block.richText = richText; block.version = result.revision;
      if (!dirty()) localStorage.removeItem(draftKey);
      else storeLocal(draftKey, JSON.stringify({ richText: readRich(editor), baseRevision }));
    } catch (error) { blocked = true; report(error); }
    finally { pendingSaves.delete(request); inflight = null; }
    return !blocked;
  }
  editor.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
  editor.addEventListener('compositionend', () => { composing = false; changed(); });
  async function convertBlock(definition) {
    commands.hidden = true; await save(); if (blocked) return;
    await apply([{ type: 'block.update', id: block.id, ...definition, richText: [] }], baseRevision);
    focusBlock(block.id);
  }
  function updateCommands() {
    const text = runsText(readRich(editor));
    commands.hidden = composing || ['code', 'bookmark', 'image', 'file'].includes(block.blockType) || !/^\/[^\n]*$/.test(text);
    editor.toggleAttribute('data-slash-empty', !commands.hidden && text === '/');
    if (commands.hidden) return;
    requestAnimationFrame(() => { commands.classList.remove('above'); const rect = commands.getBoundingClientRect(), top = wrapper.getBoundingClientRect().top; if (rect.bottom > innerHeight - 8 && top - rect.height > 60) commands.classList.add('above'); });
    const needle = text.slice(1).replace(/\s/g, '').toLowerCase();
    const aliases = { paragraph: 'text', heading1: 'h1', heading2: 'h2', heading3: 'h3', bullet: 'bulleted list', numbered: 'numbered list', todo: 'checkbox to-do' };
    commandOptions = Object.entries(blockLabels).filter(([type, name]) => !['synced', 'synced_reference','column'].includes(type) && `${type}${name}${aliases[type] ?? ''}`.replace(/\s/g, '').toLowerCase().includes(needle));
    commandIndex = 0;
    commands.dataset.heading = needle ? '필터링된 결과' : '기본 블록';
    commands.replaceChildren(...commandOptions.map(([type, name], index) => button([element('span', { class: 'slash-glyph', 'aria-hidden': 'true' }, slashGlyphs[type] ?? '·'), element('span', { class: 'slash-label' }, name), slashHints[type] ? element('span', { class: 'slash-hint', 'aria-hidden': 'true' }, slashHints[type]) : null], () => convertBlock({ blockType: type }), { role: 'option', 'aria-label': name, 'aria-selected': index === 0 ? 'true' : 'false' })));
    if (!commandOptions.length) commands.append(element('span', {}, '결과 없음'));
    commands.append(element('div', { class: 'slash-footer', 'aria-hidden': 'true' }, element('span', {}, '메뉴 닫기'), element('kbd', {}, 'esc')));
  }
  commands.addEventListener('mousedown', event => event.preventDefault());
  function changed() {
    storeLocal(draftKey, JSON.stringify({ richText: readRich(editor), baseRevision })); status('입력 중…'); clearTimeout(timer);
    updateCommands();
    if (!composing) {
      if (block.blockType === 'paragraph' && runsText(readRich(editor)) === '---') convertBlock({ blockType: 'divider' }).catch(report);
      else timer = setTimeout(save, 700);
    }
  }
  editor.addEventListener('input', changed);
  editor.addEventListener('blur', () => { save().catch(report); });
  editor.addEventListener('paste', async event => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html'), text = event.clipboardData.getData('text/plain');
    const temporary = html ? new DOMParser().parseFromString(html, 'text/html').body : element('div', {}, text);
    const selection = getSelection(); if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return;
    try {const descriptors=['code','bookmark','image','file'].includes(block.blockType)?[]:html?htmlBlocks(temporary,readRich):textBlocks(text);if(descriptors.length>1||descriptors[0]&&(descriptors[0].blockType!=='paragraph'||descriptors[0].children?.length)){
      const range=selection.getRangeAt(0),prefix=document.createRange(),suffix=document.createRange();prefix.selectNodeContents(editor);prefix.setEnd(range.startContainer,range.startOffset);suffix.selectNodeContents(editor);suffix.setStart(range.endContainer,range.endOffset);const before=element('div',{},prefix.cloneContents()),after=element('div',{},suffix.cloneContents()),left=readRich(before),right=readRich(after);
      await save();if(blocked)return;const siblings=childrenOf(block.parentId).filter(x=>x.kind==='block'),next=siblings[siblings.findIndex(x=>x.id===block.id)+1],operations=[],first=descriptors.shift();let last;
      const insert=(descriptor,parentId,beforeId)=>{const {children=[],...data}=descriptor,id=crypto.randomUUID(),operation={type:'block.create',id,parentId,...data,...(beforeId?{beforeId}:{})};operations.push(operation);for(const child of children)insert(child,id);return operation;};
      if(first.blockType==='paragraph'||!left.length&&['heading1','heading2','heading3','bullet','numbered','todo','quote'].includes(first.blockType)){
        const {children=[],...data}=first;last={type:'block.update',id:block.id,...data,blockType:first.blockType==='paragraph'?block.blockType:first.blockType,richText:[...left,...first.richText]};operations.push(last);for(const child of children)insert(child,block.id);
      }else {operations.push({type:'block.update',id:block.id,richText:left});last=insert(first,block.parentId,next?.id);}
      for(const descriptor of descriptors)last=insert(descriptor,block.parentId,next?.id);
      if(right.length){if(['paragraph','heading1','heading2','heading3','bullet','numbered','todo','quote'].includes(last.blockType??block.blockType))last.richText=[...last.richText??[],...right];else insert({blockType:'paragraph',richText:right},block.parentId,next?.id);}
      if(operations.length>500)throw new Error('붙여넣을 블록이 너무 많습니다. 나눠서 붙여넣으세요.');await apply(operations,baseRevision);localStorage.removeItem(draftKey);focusBlock(last.id,runsText(last.richText??[]).length);return;
    }}catch(error){report(error);return;}
    const range = selection.getRangeAt(0); range.deleteContents();
    const fragment = document.createDocumentFragment(); fragment.append(...richNodes(block.blockType==='code'?[{text}]:readRich(temporary)));
    const last = fragment.lastChild; range.insertNode(fragment); if (last) { range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
    changed();
  });
  editor.addEventListener('keydown', async event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    try {
    if (!commands.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); commands.hidden = true; return; }
      if (commandOptions.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + commandOptions.length) % commandOptions.length;
        [...commands.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === commandIndex)));
        commands.children[commandIndex].scrollIntoView({ block: 'nearest' }); return;
      }
      if (commandOptions.length && event.key === 'Enter') { event.preventDefault(); return convertBlock({ blockType: commandOptions[commandIndex][0] }).catch(report); }
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'd' && !event.shiftKey) { event.preventDefault(); await save(); if (blocked) return; const siblings = childrenOf(block.parentId), next = siblings[siblings.findIndex(item => item.id === block.id) + 1]; await apply([{ type: 'block.duplicate', id: block.id, ...(next ? { beforeId: next.id } : {}) }]); return; }
      if (key === '/') { event.preventDefault(); await save(); toggleBlockMenu(wrapper); return; }
      if (event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); await save(); if (blocked) return;
        const siblings = childrenOf(block.parentId), index = siblings.findIndex(item => item.id === block.id);
        if (event.key === 'ArrowUp' && index > 0) await apply([{ type: 'node.move', id: block.id, parentId: block.parentId, beforeId: siblings[index - 1].id }], baseRevision);
        else if (event.key === 'ArrowDown' && index < siblings.length - 1) await apply([{ type: 'node.move', id: block.id, parentId: block.parentId, ...(siblings[index + 2] ? { beforeId: siblings[index + 2].id } : {}) }], baseRevision);
        focusBlock(block.id); return;
      }
    }
    if (event.key === 'Escape' && commands.hidden && !event.shiftKey) { event.preventDefault(); await save(); editor.blur(); blockSelection.clear(); blockSelection.add(block.id); blockAnchor = block.id; updateBlockSelection(); return; }
    const selection = getSelection(), prefix = document.createRange(); prefix.selectNodeContents(editor);
    const inside = selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode);
    if (inside) prefix.setEnd(selection.anchorNode, selection.anchorOffset);
    const collapsed = inside && selection.isCollapsed, caret = collapsed ? prefix.toString().length : null;
    const text = runsText(readRich(editor));
    if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && block.blockType === 'paragraph' && caret === text.length && markdownBlock(text)) {
      event.preventDefault(); return convertBlock(markdownBlock(text)).catch(report);
    }
    const remind=text.match(/(^|\s)@remind(?:\s+(.*))?$/i);if(event.key==='Enter'&&!event.shiftKey&&remind){event.preventDefault();await save();if(blocked)return;reminderDialog(block.id,null,{revision:baseRevision,local:reminderTime(remind[2]),before:[{type:'block.update',id:block.id,richText:splitRuns(readRich(editor),remind.index+remind[1].length)[0]}]});return;}
    if (event.key === 'Enter' && !event.shiftKey && ['numbered', 'bullet', 'todo'].includes(block.blockType) && !text) {
      event.preventDefault(); return convertBlock({ blockType: 'paragraph' }).catch(report);
    }
    if (event.key === 'Enter' && !event.shiftKey && block.blockType !== 'code') {
      event.preventDefault(); await save(); if (blocked) return;
      const selection = getSelection(), range = document.createRange(); range.selectNodeContents(editor);
      if (selection.rangeCount && editor.contains(selection.anchorNode)) range.setEnd(selection.anchorNode, selection.anchorOffset);
      const [left, right] = splitRuns(readRich(editor), range.toString().length), id = crypto.randomUUID();
      const siblings = childrenOf(block.parentId).filter(item => item.kind === 'block'), next = siblings[siblings.findIndex(item => item.id === block.id) + 1];
      await apply([{ type: 'block.update', id: block.id, richText: left }, { type: 'block.create', id, parentId: block.parentId, blockType: ['bullet', 'numbered', 'todo'].includes(block.blockType) ? block.blockType : 'paragraph', richText: right, ...(next ? { beforeId: next.id } : {}) }], baseRevision);
      localStorage.removeItem(draftKey); document.querySelector(`[data-block-id="${CSS.escape(id)}"] [contenteditable]`)?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault(); await save(); if (blocked) return;
      const siblings = childrenOf(block.parentId).filter(item => item.kind === 'block'), index = siblings.findIndex(item => item.id === block.id);
      const parent = objects.get(block.parentId);
      if (event.shiftKey && parent?.kind === 'block') {
        const parentSiblings = childrenOf(parent.parentId), next = parentSiblings[parentSiblings.findIndex(item => item.id === parent.id) + 1];
        await apply([{ type: 'node.move', id: block.id, parentId: parent.parentId, ...(next ? { beforeId: next.id } : {}) }], baseRevision);
      } else if (!event.shiftKey && index > 0) await apply([{ type: 'node.move', id: block.id, parentId: siblings[index - 1].id }], baseRevision);
    } else if (event.key === 'Backspace' && caret === 0) {
      const blank = !text.replace(/\n/g, '');
      if (blank && ['numbered', 'bullet', 'todo'].includes(block.blockType)) { event.preventDefault(); return convertBlock({ blockType: 'paragraph' }).catch(report); }
      const siblings = childrenOf(block.parentId), previous = siblings[siblings.findIndex(item => item.id === block.id) - 1];
      if (blank && !childrenOf(block.id).length && previous?.kind === 'block' && !text.includes('\n\n')) { event.preventDefault(); localStorage.removeItem(draftKey); await apply([{ type: 'node.trash', id: block.id }], baseRevision); focusBlock(previous.id, runsText(previous.richText ?? []).length); return; }
      const mergeTypes = ['paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'todo', 'quote', 'callout'];
      if (previous?.kind === 'block' && mergeTypes.includes(previous.blockType) && mergeTypes.includes(block.blockType)) {
        event.preventDefault(); await save(); if (blocked) return;
        const offset = runsText(previous.richText ?? []).length;
        await apply([{ type: 'block.update', id: previous.id, richText: [...previous.richText ?? [], ...readRich(editor)] }, ...childrenOf(block.id).map(child => ({ type: 'node.move', id: child.id, parentId: previous.id })), { type: 'node.trash', id: block.id }], baseRevision);
        focusBlock(previous.id, offset);
      } else if (!text && !childrenOf(block.id).length) { event.preventDefault(); await apply([{ type: 'node.trash', id: block.id }], baseRevision); }
    }
    } catch (error) { report(error); }
  });
  const beforeAction = async () => { await save(); return !blocked; };
  const kind = select(Object.entries(blockLabels).filter(([id]) => !['synced', 'synced_reference','column'].includes(id)).map(([id, name]) => ({ id, name })), block.blockType, { 'aria-label': '블록 유형', onchange: async event => { if (!await beforeAction()) return; await apply([{ type: 'block.update', id: block.id, blockType: event.target.value }], baseRevision); } });
  const colorNames=['기본','회색','갈색','주황색','노란색','초록색','파란색','보라색','분홍색','빨간색'],blockColor=select([{id:'',name:'—'},...colors.map((id,i)=>({id:`text:${id}`,name:`${colorNames[i]} 텍스트`})),...colors.map((id,i)=>({id:`background:${id}`,name:`${colorNames[i]} 배경`}))],'',{'aria-label':'블록 색',onchange:async event=>{const [field,value]=event.target.value.split(':');if(!field)return;if(!await beforeAction())return;const runs=readRich(editor);await apply([{type:'block.update',id:block.id,richText:patchRuns(runs,0,runsText(runs).length,{[field==='text'?'color':'background']:value==='default'?null:value})}],state.revision);}});
  const tools = blockActions(block, async () => { await save(); return !blocked; }, [element('label', { class: 'menu-select' }, icon('turn-into'), element('span', {}, '전환'), kind), element('label', { class: 'menu-select' }, icon('color'), element('span', {}, '색'), blockColor), button([icon('arrow-up'), element('span', { class: 'menu-label' }, '위로 옮기기'), element('span', { class: 'menu-hint' }, '⌘⇧↑')], async () => { closeBlockMenus(); await save(); if (blocked) return; const siblings = childrenOf(block.parentId); const previous = siblings[siblings.findIndex(item => item.id === block.id) - 1]; if (previous) await apply([{ type: 'node.move', id: block.id, parentId: block.parentId, beforeId: previous.id }], baseRevision); }, { role: 'menuitem', 'aria-label': '위로 옮기기' })]);
  const line = element('div', { class: 'block-line' }, tools, block.blockType === 'todo' ? input('', { type: 'checkbox', checked: !!block.checked, 'aria-label': '완료', onchange: event => apply([{ type: 'block.update', id: block.id, checked: event.target.checked }]) }) : null, editor);
  wrapper.append(richToolbar(editor, changed, save, () => composing, { type: block.blockType, label: blockLabels[block.blockType] ?? '텍스트', change: async type => { if (!await beforeAction()) return; await apply([{ type: 'block.update', id: block.id, blockType: type }], baseRevision); } }), commands);
  if (block.blockType === 'bookmark') {wrapper.append(blockFieldControl(block, 'url', '북마크 URL', beforeAction),button('북마크 미리보기 가져오기',async()=>{if(!await beforeAction())return;const bookmark=await api('/api/bookmark-preview',{url:objects.get(block.id).url});await apply([{type:'block.update',id:block.id,bookmark}],state.revision)}));if(block.bookmark)wrapper.append(element('article',{class:'bookmark-preview'},element('a',{href:block.url,target:'_blank',rel:'noopener'},block.bookmark.title),element('p',{},block.bookmark.description),element('small',{},block.bookmark.siteName)));}
  if (block.blockType === 'code') {wrapper.append(blockFieldControl(block, 'language', '코드 언어', beforeAction));const preview=element('code',{class:'hljs'}),paint=()=>{const value=highlightCode(runsText(readRich(editor)),block.language??'');if(value==null)preview.textContent=runsText(readRich(editor));else preview.innerHTML=value;};paint();editor.addEventListener('input',paint);wrapper.append(element('details',{},element('summary',{},'코드 구문 강조'),element('pre',{},preview)));}
  if (['file', 'image'].includes(block.blockType)) wrapper.append(element('div', { class: 'inline' }, button('첨부 선택·교체', async () => { if (await beforeAction()) await attachmentDialog(block.parentId, block); }), block.attachmentId ? button('첨부 참조 제거', async () => { if (await beforeAction()) await apply([{ type: 'block.update', id: block.id, attachmentId: null }], baseRevision); }) : element('span', { class: 'muted' }, '첨부를 선택하세요.')));
  if (block.blockType === 'toggle') { const details = element('details', {}, element('summary', {}, line), element('div', { class: 'block-children' }, childrenOf(block.id).filter(item => item.kind === 'block').map(child => blockElement(child, stack)))); wrapper.append(details); }
  else wrapper.append(line, element('div', { class: 'block-children' }, childrenOf(block.id).filter(item => item.kind === 'block').map(child => blockElement(child, stack))));
  return wrapper;
}

async function renderDatabase(container, queryInput, compact = false) {
  const token = rendering, result = await api('/api/query', queryInput); if (token !== rendering) return;
  const view = result.view, source = result.source;
  if (!compact) {
    const templates = state.objects.filter(item => item.kind === 'page' && item.sourceId === source.id && item.template && visible(item.id));
    const instantiate = async template => { const id = crypto.randomUUID(); await apply([{ type: 'template.instantiate', id: template.id, newId: id, sourceId: source.id, title: `${template.title} 새 항목` }]); navigate(id); };
    const search = inputElementSearch(queryInput.search ?? '', async value => { content.replaceChildren(); await renderDatabase(content, { ...queryInput, search: value }, true); });
    search.classList.add('db-search'); search.hidden = !queryInput.search;
    const settings = () => view ? viewDialog(source.id, view) : viewDialog(source.id);
    container.append(element('div', { class: 'db-header' }, element('h2', { class: 'db-title' }, source.name)),
      element('div', { class: 'db-viewbar' },
        fitTabs(element('div', { class: 'tabs' }, state.objects.filter(item => item.kind === 'view' && item.sourceId === source.id && visible(item.id)).map(item => { const tab = link(item); tab.dataset.viewId = item.id; if (item.id === view?.id) tab.classList.add('active'); return tab; }), button('', event => menu(event.currentTarget, [...event.currentTarget.parentElement.querySelectorAll(':scope > a[hidden]')].map(tab => ({ icon: `view-${tab.dataset.viewType ?? 'table'}`, label: tab.textContent, action: () => navigate(tab.dataset.viewId) })).concat(['-', { icon: 'plus', label: '새 보기 추가', action: () => viewDialog(source.id) }])), { class: 'tab-more', hidden: true, 'aria-haspopup': 'menu' }), iconButton('plus', '새 보기', () => viewDialog(source.id), { class: 'tab-add' }))),
        element('div', { class: 'db-actions' },
          iconButton('filter', '필터', settings), iconButton('sort', '정렬', settings),
          iconButton('search', '이 보기에서 검색', () => { search.hidden = !search.hidden; if (!search.hidden) search.querySelector('input').focus(); }),
          view && iconButton('settings', '보기 설정', settings),
          iconButton('more', '데이터베이스 메뉴', event => databaseMenu(event.currentTarget, source, view), { 'aria-haspopup': 'menu' }),
          element('div', { class: 'new-split' }, button('새로 만들기', () => pageDialog(source.id), { class: 'primary new-main' }),
            iconButton('chevron-down', '새로 만들기 옵션', event => menu(event.currentTarget, [templates.length && { heading: '템플릿' }, ...templates.map(template => ({ icon: 'template', label: template.title, action: () => instantiate(template) })), templates.length && '-', { icon: 'plus', label: '새 템플릿', action: () => pageDialog(source.id, true) }, { icon: 'settings', label: '템플릿 설정', action: () => templateSettings(source.id) }], { align: 'end' }), { class: 'primary new-more', 'aria-haspopup': 'menu' })))),
      search);
  }
  const content = element('div', { class: 'db-body', 'data-presentation': result.presentation.type ?? 'table' }); container.append(content);
  const rowMap = new Map(result.rows.map(row => [row.id, row]));
  const columns = result.visibleProperties.map(id => result.properties.find(property => property.id === id)).filter(Boolean);
  const selectedCells=new Set();let cellAnchor=null;const selectedCount=element('output',{'aria-label':'선택 셀 개수'},'0개 선택');
  const visibleRows=()=>result.rows.filter(row=>!nested||!row.task?.ancestors.some(id=>collapsed.has(id))).map(r=>r.id);
  const updateSelection=()=>{selectedCount.textContent=`${selectedCells.size}개 선택`;for(const td of content.querySelectorAll('[data-cell]'))td.setAttribute('aria-selected',String(selectedCells.has(td.dataset.cell)));};
  const selectCell=(row,property,event)=>{if(!event.shiftKey&&!event.altKey&&event.target!==event.currentTarget)return;event.preventDefault();const current=[row.id,property.id];selectedCells.clear();for(const key of event.shiftKey&&cellAnchor?cellRange(visibleRows(),columns.map(p=>p.id),cellAnchor,current):[JSON.stringify(current)])selectedCells.add(key);if(!event.shiftKey)cellAnchor=current;updateSelection();event.currentTarget.focus();};
  const editSelection=()=>{const fields=[...new Set([...selectedCells].map(k=>JSON.parse(k)[1]))].map(id=>objects.get(id)).filter(p=>p&&!['formula','rollup','created_time','last_edited_time','created_by','last_edited_by','unique_id','button'].includes(p.type));
    if(!fields.length)throw new Error('편집할 셀을 먼저 선택하세요.');const edits=fields.map(p=>{let value=null;const enabled=input('',{type:'checkbox','aria-label':`${p.name} 일괄 변경`});return {id:p.id,enabled,read:()=>value,node:element('fieldset',{},label(`${p.name} 변경`,enabled),valueControl({title:'일괄 입력'},p,null,async next=>{value=next},{draftOnly:true}))}}),revision=result.revision;
    modal('선택 셀 일괄 편집',edits.map(e=>e.node),()=>{const operations=[...selectedCells].map(k=>JSON.parse(k)).flatMap(([pageId,propertyId])=>{const edit=edits.find(e=>e.id===propertyId&&e.enabled.checked);return edit?[{type:'value.set',pageId,propertyId,value:edit.read()}]:[]});if(!operations.length)throw new Error('변경할 속성을 선택하세요.');return apply(operations,revision)});
  };
  const saveValue = (row, property, value, revision = result.revision) => apply([{ type: 'value.set', pageId: row.id, propertyId: property.id, value }], revision);
  const nested = result.presentation.subitems?.display === 'nested', positionKey = view?.id ?? source.id;
  const collapsed = viewPositions.get(positionKey)?.collapsed ?? new Set();
  viewPositions.set(positionKey, { ...viewPositions.get(positionKey), collapsed });
  const rowAttributes = row => ({ 'data-record-id': row.id, 'data-task-ancestors': JSON.stringify(nested ? row.task?.ancestors ?? [] : []), hidden: nested && row.task?.ancestors.some(id => collapsed.has(id)) });
  const titleCell = row => {
    const control = row.task?.children.length && nested ? button(collapsed.has(row.id) ? '▸' : '▾', () => {
      if (collapsed.has(row.id)) collapsed.delete(row.id); else collapsed.add(row.id);
      for (const node of content.querySelectorAll('[data-task-ancestors]')) node.toggleAttribute('hidden', JSON.parse(node.dataset.taskAncestors).some(id => collapsed.has(id)));
      for (const node of content.querySelectorAll('[data-task-toggle]')) { node.textContent = collapsed.has(node.dataset.taskToggle) ? '▸' : '▾'; node.setAttribute('aria-expanded', String(!collapsed.has(node.dataset.taskToggle))); }
    }, { 'aria-label': `${row.title} 하위 항목 접기/펼치기`, 'aria-expanded': !collapsed.has(row.id), 'data-task-toggle': row.id }) : null;
    return element('span', { class: 'task-title', style: `padding-left:${nested ? (row.depth ?? 0) * 20 : 0}px` }, control, recordLink(row, view), row.contextOnly && element('small', { class: 'muted' }, '상위 문맥'), source.tasks?.subitems?.enabled && !row.contextOnly && button('+', () => pageDialog(source.id, false, row.id), { 'aria-label': `${row.title} 하위 항목 추가` }), !row.contextOnly && button([icon('expand'), '열기'], () => openRecord(row.id, view?.config.openMode ?? 'side'), { class: 'open-chip', 'aria-label': `${row.title} 열기`, title: { side: '사이드 보기로 열기', center: '중앙에서 보기로 열기', page: '전체 페이지로 열기' }[view?.config.openMode ?? 'side'] }));
  };
  const cardChildren = row => result.presentation.subitems?.display === 'card' && row.task?.children.length ? element('details', {}, element('summary', {}, `하위 항목 ${row.task.children.length}개`), element('ul', {}, row.task.children.map(child => element('li', {}, recordLink(child, view))))) : null;
  const card = row => {const property=view?.config.previewPropertyId??result.properties.find(p=>p.type==='files')?.id,attachmentId=view?.config.galleryPreview==='page_cover'?row.coverAttachmentId:view?.config.galleryPreview==='files'?(row.values[property]??[]).find(id=>objects.get(id)?.mediaType.startsWith('image/')):null;return element('article', { class: 'card', 'data-record-id': row.id },attachmentId&&element('img',{src:`/api/attachments/${encodeURIComponent(attachmentId)}`,alt:`${row.title} 미리보기`,loading:'lazy',class:'card-preview'}), element('div', { class: 'card-body' }, titleCell(row), cardChildren(row), columns.filter(property => property.type !== 'title').map(property => { const shown = displayValue(property, row.values[property.id]); return shown == null ? null : element('div', { class: 'card-prop', 'data-type': property.type, title: property.name }, shown); })));};
  if (result.presentation.type === 'board') {
    const groupProperty = result.properties.find(property => property.id === result.presentation.groupPropertyId);
    const ordered=result.presentation.groups.map(g=>g.key),reorder=(from,to)=>{if(from===to||!ordered.includes(from)||!ordered.includes(to))return;const keys=ordered.filter(k=>k!==from);keys.splice(keys.indexOf(to),0,from);return apply([{type:'view.update',id:view.id,config:{groupOrder:keys}}],result.revision)};
    const makeCard=(id,group)=>{const row=rowMap.get(id),item=card(row);item.draggable=true;item.addEventListener('dragstart',event=>{event.stopPropagation();event.dataTransfer.setData('application/x-local-row',JSON.stringify({id,sourceId:source.id,from:group.value}))});if(groupProperty)item.append(element('div',{class:'card-group-change'},label('그룹 변경',valueControl(row,groupProperty,row.values[groupProperty.id],(value,revision)=>saveValue(row,groupProperty,value,revision)))));return item;};
    const groupColor=group=>{const option=groupProperty?.options?.find(o=>o.id===group.value);return group.value==null?'default':optionColor(groupProperty,option);};
    const presetValues=group=>groupProperty&&group.value!=null&&['select','status','checkbox'].includes(groupProperty.type)?{[groupProperty.id]:group.value}:groupProperty&&group.value!=null&&groupProperty.type==='multi_select'?{[groupProperty.id]:[group.value]}:{};
    content.append(element('div',{class:'cards'},result.presentation.groups.filter(g=>!g.hidden&&!(g.value==null&&groupProperty?.type==='status'&&!g.rowIds.length)).map(group=>element('section',{class:'group','data-group-value':group.key,'data-color':groupColor(group),ondragover:event=>event.preventDefault(),ondrop:async event=>{event.preventDefault();event.stopPropagation();const groupKey=event.dataTransfer.getData('application/x-local-group');if(groupKey&&view)return reorder(groupKey,group.key);const text=event.dataTransfer.getData('application/x-local-row');if(!text||!groupProperty)return;const dragged=JSON.parse(text),row=rowMap.get(dragged.id);if(dragged.sourceId!==source.id||!row)throw new Error('같은 데이터베이스의 항목을 옮기세요.');const multiple=['multi_select','relation','person','files'].includes(groupProperty.type),value=multiple?group.value==null?[]:[...new Set([...(row.values[groupProperty.id]??[]).filter(v=>JSON.stringify(v)!==JSON.stringify(dragged.from)),group.value])]:group.value;await saveValue(row,groupProperty,value);}},element('div',{class:'group-head'},element('h3',{draggable:!!view,ondragstart:event=>event.dataTransfer.setData('application/x-local-group',group.key)},tag(format(group.value,groupProperty),groupColor(group),groupProperty?.type==='status'?'tag-status':''),element('span',{class:'group-count'},String(group.rowIds.length))),view&&element('div',{class:'toolbar group-tools'},iconButton('eye-off','그룹 숨기기',()=>apply([{type:'view.update',id:view.id,config:{hiddenGroups:[...(view.config.hiddenGroups??[]),group.key]}}],result.revision)),iconButton('arrow-left','그룹 앞으로',()=>{const i=ordered.indexOf(group.key);if(i>0)return reorder(group.key,ordered[i-1])}),iconButton('plus',`${format(group.value,groupProperty)} 그룹에 새 페이지`,()=>pageDialog(source.id,false,null,selected,presetValues(group))))),group.subgroups?group.subgroups.map(sub=>element('section',{class:'subgroup'},element('h4',{},format(sub.value,objects.get(view.config.subgroupBy))),sub.rowIds.filter(id=>rowMap.has(id)).map(id=>makeCard(id,group)))):group.rowIds.filter(id=>rowMap.has(id)).map(id=>makeCard(id,group)),button([icon('plus'),'새 페이지'],()=>pageDialog(source.id,false,null,selected,presetValues(group)),{class:'group-add','aria-label':`${format(group.value,groupProperty)} 그룹에 새 페이지 추가`})))));
    if(result.presentation.groups.some(g=>g.hidden)&&view)content.append(button('숨긴 그룹 설정',()=>viewDialog(source.id,view)));
  } else if (['gallery', 'feed'].includes(result.presentation.type)) content.append(element('div', { class: 'cards' }, result.rows.map(card)));
  else if (result.presentation.type === 'list') content.append(element('ul', {}, result.rows.map(row => element('li', rowAttributes(row), titleCell(row),columns.filter(p=>p.type!=='title').map(p=>element('span',{class:'muted'},` · ${p.name}: ${format(row.values[p.id],p)}`))))));
  else if (['calendar', 'timeline'].includes(result.presentation.type)) {
    const date = result.properties.find(property => property.id === result.presentation.datePropertyId), endDate = result.properties.find(property => property.id === view?.config.endDatePropertyId);
    const editDate = row => element('div', { ...rowAttributes(row), class: 'date-edit-row' }, titleCell(row), date && cellEditor(row, date, row.values[date.id], (value, revision) => saveValue(row, date, value, revision), { placeholder: '날짜 없음' }), endDate && endDate.id !== date?.id && cellEditor(row, endDate, row.values[endDate.id], (value, revision) => saveValue(row, endDate, value, revision), { placeholder: '종료일 없음' }));
    const items = result.presentation.items.filter(item => rowMap.has(item.rowId)), key = view?.id ?? source.id;
    const moveDay=async(row,targetDay)=>{if(!date||!row.values[date.id])throw new Error('먼저 시작 날짜를 지정하세요.');const value=row.values[date.id],delta=(Date.parse(targetDay)-Date.parse(displayDay(value.start,value.timeZone)))/86400000,operations=[{type:'value.set',pageId:row.id,propertyId:date.id,value:moveDateToDay(value,targetDay)}];if(endDate&&endDate.id!==date.id&&row.values[endDate.id])operations.push({type:'value.set',pageId:row.id,propertyId:endDate.id,value:moveDateToDay(row.values[endDate.id],shiftDay(displayDay(row.values[endDate.id].start,row.values[endDate.id].timeZone),delta))});return apply(operations,result.revision)};
    const moveHours=(row,hours)=>{if(!row.values[date.id].start.includes('T'))throw new Error('시간 단위 이동에는 시각이 포함된 날짜가 필요합니다.');const operations=[{type:'value.set',pageId:row.id,propertyId:date.id,value:shiftDateRange(row.values[date.id],hours,'hour')}];if(endDate&&endDate.id!==date.id&&row.values[endDate.id])operations.push({type:'value.set',pageId:row.id,propertyId:endDate.id,value:shiftDateRange(row.values[endDate.id],hours,'hour')});return apply(operations,result.revision);};
    const resize=async(row,target)=>{const property=endDate&&endDate.id!==date?.id?endDate:date,value=row.values[property.id];return saveValue(row,property,property===date?{...value,end:target}:value?target.includes('T')?shiftDateRange(value,(Date.parse(target)-Date.parse(value.start))/3600000,'hour'):moveDateToDay(value,target):{start:target});};
    const resizeDialog=row=>{const value=row.values[date.id],current=endDate&&endDate.id!==date.id?row.values[endDate.id]?.start:value.end??value.start,control=input(current??'',{type:current?.includes('T')?'text':'date'});modal('기간 종료 조절',[label('새 종료일',control)],()=>resize(row,control.value));};
    const dateDrag=(event,row,mode='move')=>{event.stopPropagation();event.dataTransfer.setData('application/x-local-date',JSON.stringify({id:row.id,sourceId:source.id,mode}));};
    const dropOnDay=async(event,day)=>{event.preventDefault();const text=event.dataTransfer.getData('application/x-local-date');if(!text)return;const data=JSON.parse(text),row=rowMap.get(data.id);if(data.sourceId!==source.id||!row)throw new Error('같은 데이터베이스의 일정만 옮길 수 있습니다.');return data.mode==='end'?resize(row,row.values[date.id].start.includes('T')?moveDateToDay({start:row.values[date.id].end??row.values[date.id].start,timeZone:row.values[date.id].timeZone},day).start:day):moveDay(row,day);};
    if (result.presentation.type === 'calendar') {
      const weekly=view?.config.calendarMode==='week',calendar = element('section', { 'aria-label': weekly?'주 달력':'월 달력' });
      const draw = () => {
        const today = new Date().toLocaleDateString('en-CA'), month = viewPositions.get(key)?.month ?? today.slice(0, 7);
        const setMonth = value => { if (/^\d{4}-\d{2}$/.test(value)) { viewPositions.set(key, { ...viewPositions.get(key), month: value }); draw(); } };
        const anchor=viewPositions.get(key)?.week??new Date().toLocaleDateString('en-CA'),setWeek=value=>{if(/^\d{4}-\d{2}-\d{2}$/.test(value)){viewPositions.set(key,{...viewPositions.get(key),week:value});draw();}};
        const picker = input(weekly?anchor:month, { type: weekly?'date':'month', 'aria-label': weekly?'표시할 주':'표시할 달', onchange: event => weekly?setWeek(event.target.value):setMonth(event.target.value) });
        const days = weekly?weekDays(anchor):monthDays(month);
        const eventCard=(row,span)=>element('div',{class:'calendar-event',style:`--span:${span}`,'data-record-id':row.id,draggable:true,ondragstart:event=>dateDrag(event,row)},recordLink(row,view),cardChildren(row),element('button',{type:'button',draggable:true,ondragstart:event=>dateDrag(event,row,'end'),'aria-label':`${row.title} 종료일 끌기`,title:'끌어서 종료일 조절',class:'date-resize',onclick:()=>resizeDialog(row)},icon('resize')),button('기간 조절',()=>resizeDialog(row),{class:'resize-dialog'}));
        const weeks=Array.from({length:weekly?1:6},(_,week)=>{
          const weekList=days.slice(week*7,week*7+7),lanes=[],placed=[];
          for(const item of items){const covered=weekList.map((day,index)=>onCalendarDay(item,day)?index:-1).filter(index=>index>=0);if(!covered.length)continue;const start=covered[0],end=covered.at(-1);let lane=lanes.findIndex(used=>used.every(([a,b])=>end<a||start>b));if(lane<0){lane=lanes.length;lanes.push([]);}lanes[lane].push([start,end]);placed.push({item,start,end,lane});}
          return element('tr',{},weekList.map((day,index)=>element('td',{class:`${weekly||day.startsWith(month)?'':'outside-month'}${day===today?' today':''}`,'data-date':day,ondragover:event=>event.preventDefault(),ondrop:event=>dropOnDay(event,day)},element('time',{dateTime:day},weekly||day.endsWith('-01')?`${Number(day.slice(5,7))}월 ${Number(day.slice(8))}일`:String(Number(day.slice(8)))),date&&iconButton('plus',`${displayDate(day)}에 새 항목`,()=>pageDialog(source.id,false,null,selected,{[date.id]:{start:day,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}}),{class:'day-add'}),
            lanes.map((_,lane)=>{const hit=placed.find(entry=>entry.lane===lane&&entry.start<=index&&entry.end>=index);if(!hit||hit.start!==index)return element('div',{class:'calendar-slot','aria-hidden':'true'});return eventCard(rowMap.get(hit.item.rowId),hit.end-hit.start+1);}))));
        });
        calendar.replaceChildren(element('div',{class:'toolbar calendar-head'},element('strong',{class:'calendar-title'},weekly?`${displayDate(days[0])} – ${displayDate(days[6])}`:`${month.slice(0,4)}년 ${Number(month.slice(5,7))}월`),picker,element('span',{class:'calendar-nav'},iconButton('chevron-left',weekly?'이전 주':'이전 달',()=>weekly?setWeek(shiftDay(anchor,-7)):setMonth(shiftMonth(month,-1))),button('오늘',()=>weekly?setWeek(today):setMonth(today.slice(0,7)),{class:'today-button'}),iconButton('chevron-right',weekly?'다음 주':'다음 달',()=>weekly?setWeek(shiftDay(anchor,7)):setMonth(shiftMonth(month,1))))),element('table',{class:'calendar-grid','aria-label':`${weekly?anchor:month} 달력`},element('thead',{},element('tr',{},['일','월','화','수','목','금','토'].map(name=>element('th',{},name)))),element('tbody',{},weeks)));
      };
      draw(); content.append(calendar);
    } else {
      const zoom=view?.config.timelineZoom??'day', timeline = element('section', { 'aria-label': '기간 타임라인', class: 'timeline-view' }), header=40, rowHeight=36, barHeight=32;
      const unitMs = zoom === 'hour' ? 3600000 : 86400000, unitPx = {hour:40,day:40,week:14,month:5}[zoom] ?? 40, LW = 0;
      const base = timelineLayout(items,zoom), todayMs = Date.parse(new Date().toLocaleDateString('en-CA')), screenWidth = Math.max(640, document.querySelector('#main')?.clientWidth || innerWidth - 270);
      const itemsFrom = base.rows.length ? base.fromMillis : null, itemsTo = base.rows.length ? base.fromMillis + base.spanMs : null;
      const withToday = zoom !== 'hour' && (itemsFrom == null || (Math.abs(todayMs - itemsFrom) / unitMs < 400 && Math.abs(todayMs - itemsTo) / unitMs < 400));
      let fromMs = Math.min(...[itemsFrom, withToday ? todayMs : null].filter(v => v != null)), toMs = Math.max(...[itemsTo, withToday ? todayMs + unitMs : null].filter(v => v != null));
      if (!Number.isFinite(fromMs)) { fromMs = Math.floor(Date.now() / unitMs) * unitMs; toMs = fromMs + unitMs; }
      const pad = Math.ceil(screenWidth / unitPx) * unitMs; fromMs = Math.floor((fromMs - pad) / unitMs) * unitMs; toMs = Math.ceil((toMs + pad) / unitMs) * unitMs;
      const layout = { ...base, fromMillis: fromMs, spanMs: toMs - fromMs, rows: base.rows.map(row => { const startMs = base.fromMillis + row.start * base.spanMs, endMs = startMs + row.width * base.spanMs; return { ...row, start: (startMs - fromMs) / (toMs - fromMs), width: (endMs - startMs) / (toMs - fromMs) }; }) };
      const count = Math.round(layout.spanMs / unitMs), VW = count * unitPx, area = VW, step = unitPx;
      const bodyRows = layout.rows.length + 1, bottom = header + Math.max(120, bodyRows * rowHeight + 24);
      const monthLabel = ms => { const d = new Date(ms); return zoom === 'hour' ? displayDate(d.toISOString().slice(0, 10)) : `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`; };
      const title = element('strong', { class: 'calendar-title timeline-title' }, monthLabel(withToday ? todayMs : fromMs + layout.spanMs / 2));
      const scroller = element('div', { class: 'timeline-scroll' }), frame = element('div', { class: 'table-wrap timeline-wrap' }, scroller);
      const positionKey = view?.id ?? source.id, xOf = ms => (ms - fromMs) / unitMs * unitPx;
      const scrollTo = ms => { scroller.scrollLeft = Math.max(0, xOf(ms) - scroller.clientWidth / 2); };
      const nav = (direction) => { scroller.scrollBy({ left: direction * Math.max(unitPx * 7, scroller.clientWidth / 2), behavior: 'smooth' }); };
      const zoomSelect = view && select([{id:'hour',name:'시간'},{id:'day',name:'월'},{id:'week',name:'분기'},{id:'month',name:'연'}], zoom, { class: 'timeline-zoom', 'aria-label': '타임라인 확대 단위', title: '하루(또는 한 시간)당 폭: 시간 40 · 월 40 · 분기 14 · 연 5px', onchange: event => apply([{ type: 'view.update', id: view.id, config: { timelineZoom: event.target.value } }], result.revision) });
      timeline.append(element('div', { class: 'timeline-head' }, title, element('span', { class: 'calendar-nav' }, zoomSelect, iconButton('chevron-left', '이전 기간', () => nav(-1)), button('오늘', () => { viewPositions.set(positionKey, { ...viewPositions.get(positionKey), timelineCenter: null }); scrollTo(zoom === 'hour' ? Date.now() : todayMs + unitMs / 2); }, { class: 'today-button' }), iconButton('chevron-right', '다음 기간', () => nav(1)))));
      scroller.addEventListener('scroll', () => { const center = fromMs + (scroller.scrollLeft + scroller.clientWidth / 2) / unitPx * unitMs; title.textContent = monthLabel(center); viewPositions.set(positionKey, { ...viewPositions.get(positionKey), timelineCenter: center }); }, { passive: true });
      const marker = `dependency-${crypto.randomUUID()}`, plot = svg('svg', { viewBox: `0 0 ${VW} ${bottom}`, width: VW, height: bottom, class: 'timeline-plot', 'aria-label': '업무 일정과 의존성' });
      plot.style.width=`${VW}px`;
      plot.addEventListener('dragover',event=>event.preventDefault());plot.addEventListener('drop',async event=>{event.preventDefault();try{const text=event.dataTransfer.getData('application/x-local-date');if(!text)return;const data=JSON.parse(text),row=rowMap.get(data.id);if(data.sourceId!==source.id||!row)return;const rect=plot.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,((event.clientX-rect.left)/rect.width*VW-LW)/area)),target=new Date(layout.fromMillis+Math.floor(fraction*layout.spanMs/(zoom==='hour'?3600000:86400000))*(zoom==='hour'?3600000:86400000)).toISOString();if(data.mode==='end')await resize(row,row.values[date.id].start.includes('T')?target:target.slice(0,10));else if(zoom==='hour'&&row.values[date.id].start.includes('T'))await moveHours(row,Math.round((Date.parse(target)-Date.parse(row.values[date.id].start))/3600000));else await moveDay(row,target.slice(0,10));}catch(error){report(error)}});
      plot.append(svg('defs', {}, svg('marker', { id: marker, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'dependency-head' }))));
      plot.append(svg('rect', { x: 0, y: header, width: VW, height: bottom - header, class: 'timeline-bg' }), svg('line', { x1: 0, x2: VW, y1: header - .5, y2: header - .5, class: 'timeline-rule' }));
      for (let index = 0; index < count; index++) {
        const at = layout.fromMillis + index * unitMs, x = LW + index * step, day = new Date(at), weekend = zoom !== 'hour' && unitPx >= 14 && [0, 6].includes(day.getUTCDay());
        if (weekend) plot.append(svg('rect', { x, y: header, width: step, height: bottom - header, class: 'timeline-weekend' }));
        const labelText = zoom === 'hour' ? String(day.getHours()) : zoom === 'day' ? String(day.getUTCDate()) : zoom === 'week' ? (day.getUTCDay() === 1 ? String(day.getUTCDate()) : null) : (day.getUTCDate() === 1 ? `${day.getUTCMonth() + 1}월` : null);
        if (labelText && !(zoom !== 'hour' && at === todayMs)) plot.append(svg('text', { x: zoom === 'day' || zoom === 'hour' ? x + step / 2 : x, y: 25, 'text-anchor': zoom === 'day' || zoom === 'hour' ? 'middle' : 'start', class: 'timeline-label' }, labelText));
      }
      if (zoom !== 'hour' && todayMs >= layout.fromMillis && todayMs < layout.fromMillis + layout.spanMs) { const x = LW + xOf(todayMs) + (zoom === 'day' ? step / 2 : 0); plot.append(svg('circle', { cx: x, cy: 20, r: 11, class: 'timeline-today-dot' }), svg('text', { x, y: 25, 'text-anchor': 'middle', class: 'timeline-label today' }, String(new Date(todayMs).getUTCDate())), svg('line', { x1: x, x2: x, y1: header, y2: bottom, class: 'timeline-today' }), svg('circle', { cx: x, cy: header, r: 3.5, class: 'timeline-today-dot' })); }
      const coordinates = new Map(layout.rows.map((item, index) => [item.rowId, { ...item, x: LW + item.start * area, endX: LW + (item.start + item.width) * area, y: header + index * rowHeight + rowHeight / 2 + 1 }]));
      for (const edge of result.presentation.dependencies ?? []) {
        const from = coordinates.get(edge.predecessorId), to = coordinates.get(edge.successorId); if (!from || !to) continue;
        const ancestors = nested ? [...rowMap.get(edge.predecessorId).task.ancestors, ...rowMap.get(edge.successorId).task.ancestors] : [];
        const bend = Math.max(from.endX + 10, to.x - 12);
        plot.append(svg('path', { d: `M ${from.endX} ${from.y} H ${bend} V ${to.y - 14} H ${to.x - 6} V ${to.y}`, class: 'dependency-edge', 'marker-end': `url(#${marker})`, 'aria-label': `${edge.predecessorTitle} → ${edge.successorTitle}`, 'data-task-ancestors': JSON.stringify(ancestors), hidden: ancestors.some(id => collapsed.has(id)) }));
      }
      const list = element('details', { class: 'timeline-list kbd-fallback' }, element('summary', {}, `일정 목록 · 키보드 조정 (${coordinates.size})`));
      for (const item of coordinates.values()) {
        const row = rowMap.get(item.rowId), name = `${row.title}: ${item.from} → ${item.to}`, attrs = rowAttributes(row), width = Math.max(3, item.endX - item.x), top = item.y - barHeight / 2;
        plot.append(svg('g', { ...attrs, hidden: attrs.hidden ? '' : null }, svgButton(name, () => openRecord(row.id, view?.config.openMode ?? 'side'), svg('rect', { x: item.x + .5, y: top, width: width - 1, height: barHeight, rx: 6, class: 'plot-bar timeline-bar' }), svg('text', { x: item.x + 10, y: item.y + 5, class: 'timeline-bar-label' }, row.title))));
        plot.append(svg('foreignObject',{x:item.x,y:top,width:Math.max(12,item.endX-item.x),height:barHeight},element('div',{draggable:true,role:'button',tabIndex:0,'aria-label':`${row.title} 일정 끌기`,class:'timeline-drag',style:'width:100%;height:100%;cursor:grab',ondragstart:event=>dateDrag(event,row),onclick:()=>openRecord(row.id,view?.config.openMode??'side')})),svg('foreignObject',{x:item.endX-8,y:top,width:12,height:barHeight},element('div',{draggable:true,role:'button',tabIndex:0,'aria-label':`${row.title} 막대 종료일 끌기`,class:'timeline-resize',style:'width:100%;height:100%;cursor:ew-resize',ondragstart:event=>dateDrag(event,row,'end'),onclick:()=>resizeDialog(row)})));
        list.append(element('div', { class: 'timeline-row', ...rowAttributes(row),draggable:true,ondragstart:event=>dateDrag(event,row) }, titleCell(row), element('small', {}, ` ${zoom==='hour'?row.values[date.id].start:item.from} → ${item.to}`),element('button',{type:'button',draggable:true,ondragstart:event=>dateDrag(event,row,'end'),'aria-label':`${row.title} 종료일 끌기`,class:'date-resize',onclick:()=>resizeDialog(row)},icon('resize')),button('기간 조절',()=>resizeDialog(row)),button('일정 앞으로',()=>zoom==='hour'?moveHours(row,-1):moveDay(row,shiftDay(displayDay(row.values[date.id].start,row.values[date.id].timeZone),zoom==='week'?-7:-1))),button('일정 뒤로',()=>zoom==='hour'?moveHours(row,1):moveDay(row,shiftDay(displayDay(row.values[date.id].start,row.values[date.id].timeZone),zoom==='week'?7:1)))));
      }
      scroller.append(plot);
      frame.append(button([icon('plus'), '새로 만들기'], () => pageDialog(source.id), { class: 'timeline-add', style: `top:${header + layout.rows.length * rowHeight + 6}px`, 'aria-label': '타임라인에 새 항목 추가' }));
      timeline.append(frame, list);
      requestAnimationFrame(() => { const saved = viewPositions.get(positionKey)?.timelineCenter; scrollTo(saved ?? (withToday ? todayMs + unitMs / 2 : (itemsFrom ?? fromMs))); });
      if (result.presentation.dependencies?.length) timeline.append(element('details', {}, element('summary', {}, '선행 → 후행 관계'), element('ul', {}, result.presentation.dependencies.map(edge => element('li', {}, recordLink({ id: edge.predecessorId, title: edge.predecessorTitle }, view), ' → ', recordLink({ id: edge.successorId, title: edge.successorTitle }, view))))));
      content.append(timeline);
    }
    content.append(element('details', { class: 'kbd-fallback' }, element('summary', {}, '날짜 편집'), items.map(item => editDate(rowMap.get(item.rowId)))));
    const undated = result.presentation.undated.filter(id => rowMap.has(id)), actions = container.querySelector(':scope > .db-viewbar .db-actions') ?? container.closest('.database-section')?.querySelector('.db-actions');
    if (undated.length && actions) actions.prepend(button(`날짜 없음 (${undated.length}개)`, event => popover(event.currentTarget, () => [element('div', { class: 'popover-heading' }, '날짜 미지정'), ...undated.map(id => editDate(rowMap.get(id)))], { className: 'undated-popover', align: 'end' }), { class: 'undated-button', 'aria-haspopup': 'dialog' }));
    else if (undated.length) content.append(element('h3', {}, '날짜 미지정'), ...undated.map(id => editDate(rowMap.get(id))));
    if (!date) content.append(element('p', {}, '보기 설정에서 날짜 속성을 선택하세요.'));
  }
  else if (result.presentation.type === 'chart') {
    const groupProperty = objects.get(view.config.chart?.groupBy ?? view.config.groupBy) ?? result.properties.find(property => property.type === 'status');
    const bars = result.presentation.bars, scale = chartScale(bars.map(bar => bar.value)), plot = svg('svg', { viewBox: `0 0 700 ${Math.max(60, bars.length * 48 + 35)}`, class: 'chart-plot', 'aria-label': '그룹별 집계 그래프' });
    const chartKind=view.config.chart?.type??'bar',drill=async bar=>{const name=format(JSON.parse(bar.key),groupProperty),dialog=modal(`차트 원본 · ${name}`,[],null);await renderDatabase(dialog.querySelector('form'),{sourceId:source.id,filter:bar.drilldown},true);};
    if(chartKind!=='bar'){
      const graph=svg('svg',{viewBox:'0 0 700 340',class:'chart-plot','aria-label':chartKind==='line'?'그룹별 선 그래프':'그룹별 도넛 그래프'}),palette=['#547daf','#ac623c','#4a8b64','#9568a6','#b89a35'];
      if(chartKind==='line'){const min=scale.min,max=scale.max,span=max-min||1;let path='',connected=false;bars.forEach((bar,i)=>{if(typeof bar.value!=='number'){connected=false;return}const x=60+i*580/Math.max(1,bars.length-1),y=285-(bar.value-min)/span*240;path+=`${connected?'L':'M'}${x} ${y} `;connected=true;graph.append(svgButton(`${format(JSON.parse(bar.key),groupProperty)}: ${bar.value}`,()=>drill(bar),svg('circle',{cx:x,cy:y,r:7,fill:palette[i%palette.length]}),svg('text',{x,y:315,'text-anchor':'middle'},format(JSON.parse(bar.key),groupProperty))));});graph.prepend(svg('path',{d:path,fill:'none',stroke:'#547daf','stroke-width':2}));graph.append(svg('text',{x:5,y:45},format(max)),svg('text',{x:5,y:285},format(min)));}
      else {const valid=bars.every(bar=>typeof bar.value==='number'&&bar.value>=0),total=valid?bars.reduce((sum,b)=>sum+b.value,0):0;let offset=0;const circumference=2*Math.PI*110;if(total>0)bars.forEach((bar,i)=>{if(!bar.value)return;const length=bar.value/total*circumference;graph.append(svgButton(`${format(JSON.parse(bar.key),groupProperty)}: ${bar.value}`,()=>drill(bar),svg('circle',{cx:210,cy:165,r:110,fill:'none',stroke:palette[i%palette.length],'stroke-width':45,'stroke-dasharray':`${length} ${circumference-length}`,'stroke-dashoffset':-offset,transform:'rotate(-90 210 165)'})));offset+=length;});else graph.append(svg('text',{x:40,y:160},valid?'표시할 양수 값이 없습니다.':'도넛은 오류 없는 0 이상 값에만 표시합니다.'));}
      content.append(graph,element('ul',{},bars.map(bar=>element('li',{},button(`${format(JSON.parse(bar.key),groupProperty)}: ${format(bar.value)}`,()=>drill(bar))))));
    } else {
    plot.append(svg('line', { x1: 190 + scale.zero * 400, y1: 0, x2: 190 + scale.zero * 400, y2: bars.length * 48, class: 'plot-axis' }), svg('text', { x: 190, y: bars.length * 48 + 22 }, format(scale.min)), svg('text', { x: 590, y: bars.length * 48 + 22, 'text-anchor': 'end' }, format(scale.max)));
    bars.forEach((bar, index) => {
      const groupName = format(JSON.parse(bar.key), groupProperty);
      const name = `${groupName}: ${bar.value == null ? '값 없음' : format(bar.value)}`, geometry = scale.bars[index], y = index * 48;
      plot.append(svgButton(name, async () => {
        const dialog = modal(`차트 원본 · ${groupName}`, [], null);
        await renderDatabase(dialog.querySelector('form'), { sourceId: source.id, filter: bar.drilldown }, true);
      }, svg('rect', { x: 0, y, width: 700, height: 44, class: 'plot-hit' }), svg('text', { x: 0, y: y + 25 }, groupName), geometry && svg('rect', { x: 190 + geometry.start * 400, y: y + 8, width: Math.max(geometry.width * 400, 1), height: 28, class: 'plot-bar' }), svg('text', { x: 610, y: y + 25, class: bar.value?.error ? 'error' : '' }, bar.value == null ? '값 없음' : format(bar.value))));
    });
    content.append(plot);
    }
  }
  else if (result.presentation.type === 'map') {
    const points = result.presentation.points.filter(point => rowMap.has(point.rowId)), key = view?.id ?? source.id, panel = element('section', { 'aria-label': '좌표 지도' });
    const draw = () => {
      const viewport = viewPositions.get(key)?.map ?? { longitude: 0, latitude: 0, span: 360 }, change = next => { viewPositions.set(key, { ...viewPositions.get(key), map: next }); draw(); };
      const tiles=view.config.mapBackground?mapTiles(viewport):null;
      const plot = svg('svg', { viewBox: '0 0 700 350', class: 'map-plot', 'aria-label': '경도와 위도로 배치한 장소' });
      if(tiles)plot.append(...tiles.tiles.map(tile=>svg('image',{href:`/api/map/tiles/${tile.z}/${tile.x}/${tile.y}`,x:tile.left,y:tile.top,width:256,height:256})));
      for (let index = 0; index <= 4; index++) {
        plot.append(svg('line', { x1: index * 175, x2: index * 175, y1: 0, y2: 350, class: 'plot-grid' }), svg('line', { x1: 0, x2: 700, y1: index * 87.5, y2: index * 87.5, class: 'plot-grid' }));
      }
      for (const point of points) {
        const position = tiles?mapPoint(point,tiles):projectPlace(point, viewport); if (!position) continue;
        plot.append(svgButton(`${point.name} · ${rowMap.get(point.rowId).title}`, () => openRecord(point.rowId, view?.config.openMode ?? 'side'), svg('circle', { cx: position.x * 700, cy: position.y * 350, r: 7, class: 'plot-pin' }), svg('text', { x: Math.min(600, position.x * 700 + 10), y: Math.max(15, position.y * 350 - 10) }, point.name)));
      }
      const first = points.find(point => Number.isFinite(point.longitude) && Number.isFinite(point.latitude));
      panel.replaceChildren(element('h3', {}, view.config.mapBackground?'지도':'좌표 지도'),button(view.config.mapBackground?'배경 지도 끄기':'배경 지도 켜기',()=>modal('지도 배경',[element('p',{},view.config.mapBackground?'배경 지도를 끕니다.':'현재 지도 영역을 OpenStreetMap에 전송해 배경 지도를 표시합니다.')],()=>apply([{type:'view.update',id:view.id,config:{mapBackground:!view.config.mapBackground}}],state.revision))),view.config.mapBackground?element('a',{href:'https://www.openstreetmap.org/copyright',target:'_blank',rel:'noopener'},'© OpenStreetMap contributors'):'', element('div', { class: 'toolbar' }, button('지도 확대', () => change(moveMap(viewport, 0, 0, .5))), button('지도 축소', () => change(moveMap(viewport, 0, 0, 2))), ...[['서쪽', -1, 0], ['동쪽', 1, 0], ['북쪽', 0, 1], ['남쪽', 0, -1]].map(([name, x, y]) => button(name, () => change(moveMap(viewport, x * viewport.span / 4, y * viewport.span / 8)))), first && button('첫 장소로', () => change(moveMap({ longitude: first.longitude, latitude: first.latitude, span: 30 }))), button('지도 전체', () => change({ longitude: 0, latitude: 0, span: 360 }))), plot, element('p', { class: 'muted' }, `중심 경도 ${viewport.longitude.toFixed(2)}°, 위도 ${viewport.latitude.toFixed(2)}° · 경도 범위 ${viewport.span}°`));
    };
    draw(); content.append(panel, element('ul', {}, points.map(point => element('li', {}, `${point.name} · ${point.latitude ?? '위도 없음'}, ${point.longitude ?? '경도 없음'} `, recordLink(rowMap.get(point.rowId), view)))), element('p', {}, `장소 미지정 ${result.presentation.unlocated.length}개 · 좌표 없는 장소 ${points.filter(point => !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)).length}개`));
  }
  else if (result.presentation.type === 'dashboard') for (const viewId of result.presentation.widgets) { const widget = element('section'); content.append(widget); await renderDatabase(widget, { viewId }, false); }
  else if (result.presentation.type === 'form') {
    const draft = new Map(), fakePage = { title: '새 항목' }, form = element('form', { onsubmit: async event => { event.preventDefault(); const id = crypto.randomUUID(); const title = result.properties.find(property => property.type === 'title'); await apply([{ type: 'page.create', id, sourceId: source.id, title: draft.get(title.id) || '제목 없음' }, ...[...draft].filter(([propertyId]) => propertyId !== title.id).map(([propertyId, value]) => ({ type: 'value.set', pageId: id, propertyId, value }))]); navigate(id); } });
    for (const property of result.presentation.fields) form.append(label(property.name, valueControl(fakePage, property, null, async value => { draft.set(property.id, value); }, { draftOnly: true })));
    form.append(element('button', { type: 'submit' }, '항목 만들기')); content.append(form);
  } else {
    content.append(element('div',{class:'toolbar cell-tools',role:'toolbar','aria-label':'선택 셀 작업'},selectedCount,button('선택 셀 편집',editSelection),button('선택 해제',()=>{selectedCells.clear();cellAnchor=null;updateSelection()}),element('small',{},'Alt+클릭 선택 · Shift+클릭 범위 · 복사/붙여넣기')));
    const table=rows=>{
      const frozen=view?.config.frozenProperties??[],widthOf=p=>p.type==='title'?280:200,style=p=>{if(!frozen.includes(p.id))return null;const before=columns.filter(c=>frozen.includes(c.id));return `position:sticky;left:${40+before.slice(0,before.findIndex(c=>c.id===p.id)).reduce((sum,c)=>sum+widthOf(c),0)}px;z-index:3;min-width:${widthOf(p)}px`;};
      const node=element('table',{'aria-label':`${source.name} 데이터 표`,class:'db-table',title:'Alt+클릭으로 셀 선택 · Shift+클릭으로 범위 선택'},element('thead',{},element('tr',{},element('th',{class:'row-gutter'},element('span',{class:'visually-hidden'},'선택')),columns.map(p=>element('th',{style:style(p),'data-type':p.type,class:frozen.includes(p.id)?'frozen':null},button([icon(`type-${p.type}`),element('span',{},p.name)],event=>propertyHeaderMenu(event.currentTarget,source,view,p,result.revision,result.visibleProperties),{'aria-label':p.name,'aria-haspopup':'menu'}))))),element('tbody',{},rows.map(row=>element('tr',rowAttributes(row),element('td',{class:'row-gutter'},input('',{type:'checkbox','aria-label':`${row.title} 행 선택`,onchange:event=>{for(const p of columns){const key=JSON.stringify([row.id,p.id]);if(event.target.checked)selectedCells.add(key);else selectedCells.delete(key)}updateSelection()}})),columns.map(p=>element('td',{tabIndex:0,style:style(p),'data-type':p.type,class:frozen.includes(p.id)?'frozen':null,'data-cell':JSON.stringify([row.id,p.id]),'aria-label':`${row.title} · ${p.name} 셀`,'aria-selected':false,onmousedown:event=>selectCell(row,p,event),onfocusin:()=>{if(!cellAnchor)cellAnchor=[row.id,p.id]},onkeydown:event=>{if(event.target!==event.currentTarget||!event.shiftKey||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const rows=visibleRows(),r=Math.max(0,Math.min(rows.length-1,rows.indexOf(row.id)+(event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0))),c=Math.max(0,Math.min(columns.length-1,columns.findIndex(x=>x.id===p.id)+(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0)));selectedCells.clear();for(const key of cellRange(rows,columns.map(x=>x.id),cellAnchor??[row.id,p.id],[rows[r],columns[c].id]))selectedCells.add(key);updateSelection();content.querySelector(`[data-cell="${CSS.escape(JSON.stringify([rows[r],columns[c].id]))}"]`)?.focus();}},p.type==='title'?titleCell(row):cellEditor(row,p,row.values[p.id],(value,revision)=>saveValue(row,p,value,revision))))))));
      if(Object.keys(result.presentation.columnAggregations??{}).length)node.append(element('tfoot',{},element('tr',{},element('td',{class:'row-gutter',title:'전체 일치 행'},element('span',{class:'visually-hidden'},'전체 일치 행')),columns.map(p=>element('td',{'data-aggregate-property':p.id},view?.config.columnAggregations?.[p.id]?[element('span',{class:'calc-label'},aggregateLabels[view.config.columnAggregations[p.id]]),element('span',{class:'visually-hidden'},': '),formatAggregate(result.presentation.columnAggregations[p.id],view.config.columnAggregations[p.id],p)]:'')))));
      node.addEventListener('copy',event=>{if(!selectedCells.size)return;const rows=visibleRows().filter(id=>[...selectedCells].some(k=>JSON.parse(k)[0]===id)),cols=columns.filter(p=>[...selectedCells].some(k=>JSON.parse(k)[1]===p.id));event.preventDefault();event.clipboardData.setData('text/plain',rows.map(id=>cols.map(p=>selectedCells.has(JSON.stringify([id,p.id]))?format(rowMap.get(id).values[p.id],p):'').join('\t')).join('\n'));});
      node.addEventListener('paste',event=>{const text=event.clipboardData.getData('text/plain');if(!cellAnchor||(!text.includes('\t')&&!text.includes('\n')&&event.target.tagName!=='TD'))return;event.preventDefault();try{const grid=clipboardRows(text),rowIds=visibleRows(),r=rowIds.indexOf(cellAnchor[0]),c=columns.findIndex(p=>p.id===cellAnchor[1]);if(r<0||c<0||r+grid.length>rowIds.length||grid.some(row=>c+row.length>columns.length))throw new Error('붙여넣을 범위가 현재 표를 벗어납니다.');const operations=grid.flatMap((row,ri)=>row.map((text,ci)=>({type:'value.set',pageId:rowIds[r+ri],propertyId:columns[c+ci].id,value:pastedValue(text,columns[c+ci],objects)})));apply(operations,result.revision).catch(report);}catch(error){report(error)}});
      return element('div',{class:'table-wrap'},node,button([icon('plus'),'새 페이지'],()=>pageDialog(source.id),{class:'add-row'}));
    };
    if (result.presentation.groups) {
      const property = result.properties.find(item => item.id === result.presentation.groupPropertyId);
      for (const group of result.presentation.groups) {
        const memberIds = new Set(group.rowIds.filter(id => rowMap.has(id))), included = new Set(memberIds);
        if (nested) for (const id of memberIds) for (const parent of rowMap.get(id).task?.ancestors ?? []) if (rowMap.has(parent)) included.add(parent);
        const rows = result.rows.filter(row => included.has(row.id)).map(row => memberIds.has(row.id) ? row : { ...row, contextOnly: true });
        if (rows.length) content.append(element('section', { 'data-group-value': group.key, 'aria-label': `${format(group.value, property)} 그룹` }, element('h3', {}, `${format(group.value, property)} · ${group.rowIds.length}`), table(rows)));
      }
    } else content.append(table(result.rows));
  }
  content.append(element('p', { class: 'muted db-count', 'data-always': result.hasMore || result.rows.some(row => row.contextOnly) ? 'true' : null }, `${result.rows.some(row => row.contextOnly) ? '조건 일치 ' : ''}${result.total}개${result.hasMore ? ' · 일부 표시' : ''}`));
  const pageSize = queryInput.limit ?? 100;
  const turnPage = async offset => { container.replaceChildren(); await renderDatabase(container, { ...queryInput, offset }, compact); };
  if (result.offset || result.hasMore) content.append(element('div', { class: 'toolbar' }, button('이전 항목', () => turnPage(Math.max(0, result.offset - pageSize)), { disabled: !result.offset }), button('다음 항목', () => turnPage(result.offset + pageSize), { disabled: !result.hasMore })));
}
function inputElementSearch(value, action) {
  const control = input(value, { placeholder: '이 보기에서 검색', 'aria-label': 'DB 내 검색' });
  return element('form', { onsubmit: event => { event.preventDefault(); return action(control.value); } }, control, element('button', {}, '찾기'));
}
const sidebarCollapsedKey = 'pageyard-sidebar-collapsed';
const sidebarAction = (name, text, action, { active = false, hint = '', label = text } = {}) => element('button', { type: 'button', class: `sidebar-action${active ? ' active' : ''}`, 'aria-label': label !== text ? label : null, onclick: action }, icon(name), element('span', { class: 'sidebar-action-label' }, text), hint ? element('span', { class: 'sidebar-hint' }, hint) : null);
function ancestry(id) {
  const chain = []; let current = objects.get(id), guard = 0;
  while (current && guard++ < 40) { chain.unshift(current); current = current.kind === 'page' && current.sourceId && !current.parentId ? objects.get(current.sourceId) : objects.get(current.parentId); }
  return chain.filter(item => ['page', 'source', 'view'].includes(item.kind));
}
function renderTopbar() {
  const current = selected && objects.get(selected), crumbs = $('#crumbs'), actions = $('#page-actions');
  if (!current || !visible(current.id)) { crumbs.replaceChildren(element('span', { class: 'crumb current' }, current ? '항목을 찾을 수 없음' : '홈')); actions.replaceChildren(); return; }
  const chain = ancestry(current.id), shown = chain.length > 4 ? [chain[0], null, ...chain.slice(-2)] : chain;
  crumbs.replaceChildren(...shown.flatMap((item, index) => [index ? element('span', { class: 'crumb-separator', 'aria-hidden': 'true' }, '/') : [],
    item === null ? element('span', { class: 'crumb ellipsis' }, '…') : index === shown.length - 1 ? element('span', { class: 'crumb current', 'aria-current': 'page' }, item.icon ? element('span', { class: 'link-icon' }, item.icon) : null, item.title ?? item.name ?? '제목 없음') : element('span', { class: 'crumb' }, link(item))]));
  const starred = favorites().includes(current.id);
  actions.replaceChildren(iconButton(starred ? 'star-filled' : 'star', starred ? '즐겨찾기 해제' : '즐겨찾기 추가', () => apply([{ type: 'navigation.set', favorites: [...favorites().filter(x => x !== current.id && visible(x)), ...(starred ? [] : [current.id])] }]), { class: starred ? 'starred' : '' }),
    iconButton('more', current.kind === 'page' ? '페이지 메뉴' : '데이터베이스 메뉴', event => current.kind === 'page' ? pageMenu(event.currentTarget, current) : databaseMenu(event.currentTarget, objects.get(current.sourceId ?? current.id), current.kind === 'view' ? current : null), { 'aria-haspopup': 'menu' }));
}
function movePageDialog(current) {
  const revision = state.revision;
  const parent = select(current.sourceId ? [{ id: current.sourceId, name: objects.get(current.sourceId)?.name ?? '데이터베이스' }] : [{ id: '', name: '최상위' }, ...state.objects.filter(item => item.kind === 'page' && item.id !== current.id && visible(item.id)).map(item => ({ id: item.id, name: item.title }))], current.parentId ?? '');
  const before = select([], '', { 'aria-label': '배치 위치' });
  const update = () => before.replaceChildren(element('option', { value: '' }, '마지막에 배치'), ...childrenOf(parent.value || null).filter(item => item.id !== current.id).map(item => element('option', { value: item.id }, `${item.title ?? item.name ?? blockLabels[item.blockType] ?? '항목'} 앞`)));
  parent.addEventListener('change', update); update();
  modal('페이지 이동', [label('상위 페이지', parent), label('배치 위치', before)], () => apply([{ type: 'node.move', id: current.id, parentId: parent.value || null, ...(before.value ? { beforeId: before.value } : {}) }], revision));
}
function bodySearchDialog(pageId) {
  const query = input('', { 'aria-label': 'DB 내 검색', placeholder: '본문에서 찾기' });
  modal('본문 검색', [label('찾을 내용', query)], async () => { const result = await api('/api/search', { query: query.value, pageId }); status(`본문 일치 ${result.blocks.length}곳`); for (const match of result.blocks) document.querySelector(`[data-block-id="${CSS.escape(match.id)}"]`)?.scrollIntoView({ block: 'center' }); }).querySelector('button[type=submit]').textContent = '찾기';
}
function syncedReferenceDialog(pageId) {
  const source = select(state.objects.filter(item => item.blockType === 'synced' && visible(item.id)).map(item => ({ id: item.id, name: (childrenOf(item.id)[0]?.richText ?? []).map(run => run.text).join('') || '동기화 원본' })), '');
  modal('동기화 참조', [label('공유 원본', source)], () => apply([{ type: 'block.create', parentId: pageId, blockType: 'synced_reference', sourceBlockId: source.value }]));
}
function commentDialog(page) {
  const text = element('textarea', { 'aria-label': '주석 내용', required: true }), revision = state.revision;
  modal('개인 주석 추가', [label('내용', text)], async () => { if (!text.value.trim()) throw new Error('주석 내용을 입력하세요.'); await apply([{ type: 'comment.create', parentId: page.id, richText: [{ text: text.value }] }], revision); });
}
function pageMenu(anchor, page) {
  const starred = favorites().includes(page.id);
  return menu(anchor, [
    { icon: starred ? 'star-filled' : 'star', label: starred ? '즐겨찾기 해제' : '즐겨찾기 추가', action: () => apply([{ type: 'navigation.set', favorites: [...favorites().filter(x => x !== page.id && visible(x)), ...(starred ? [] : [page.id])] }]) },
    { icon: 'appearance', label: '페이지 표시', hint: '아이콘·커버·너비', action: () => pageAppearance(page) },
    '-',
    { icon: 'page', label: '하위 페이지', action: () => pageDialog(null, false, null, page.id) },
    { icon: 'source', label: '데이터베이스 추가', action: () => sourceDialog(page.id) },
    { icon: 'view-table', label: '연결된 보기', action: () => linkedViewDialog(page.id) },
    { icon: 'synced', label: '동기화 블록', action: () => apply([{ type: 'block.create', parentId: page.id, blockType: 'synced' }]) },
    { icon: 'synced', label: '동기화 참조 추가', action: () => syncedReferenceDialog(page.id) },
    { icon: 'file', label: '본문 첨부', action: () => attachmentDialog(page.id) },
    '-',
    { icon: 'duplicate', label: '복제', action: async () => { const id = crypto.randomUUID(); await apply([{ type: 'page.duplicate', id: page.id, newId: id }]); navigate(id); } },
    { icon: 'move', label: '이동', action: () => movePageDialog(page) },
    { icon: 'history', label: '페이지 이력', action: () => showPageHistory(page.id) },
    { icon: 'bell', label: '알림 설정', action: () => reminderDialog(page.id) },
    page.sourceId && { icon: 'tasks', label: '업무 구조 설정', action: () => taskSettingsDialog(page.sourceId) },
    page.template && { icon: 'repeat', label: '반복 설정', action: () => recurrenceDialog(page) },
    { icon: 'search', label: '본문 검색', action: () => bodySearchDialog(page.id) },
    '-',
    { icon: 'import', label: '가져오기', action: () => importDialog(page.id) },
    { icon: 'export', label: '내보내기', action: () => exportDialog(page.id) },
    '-',
    { icon: 'trash', label: '휴지통으로', danger: true, action: async () => { await apply([{ type: 'node.trash', id: page.id }]); if (selected === page.id || detailId === page.id) navigate(null); } },
  ], { align: 'end' });
}
function databaseMenu(anchor, source, view) {
  if (!source) return;
  const id = view?.id ?? source.id, starred = favorites().includes(id);
  return menu(anchor, [
    { icon: starred ? 'star-filled' : 'star', label: starred ? '즐겨찾기 해제' : '즐겨찾기 추가', action: () => apply([{ type: 'navigation.set', favorites: [...favorites().filter(x => x !== id && visible(x)), ...(starred ? [] : [id])] }]) },
    view && { icon: 'settings', label: '보기 설정', action: () => viewDialog(source.id, view) },
    { icon: 'plus', label: '새 보기', action: () => viewDialog(source.id) },
    '-',
    { icon: 'type-text', label: '속성 추가', action: () => propertyDialog(source.id) },
    { icon: 'tasks', label: '업무 구조 설정', action: () => taskSettingsDialog(source.id) },
    { icon: 'template', label: '새 템플릿', action: () => pageDialog(source.id, true) },
    { icon: 'template', label: '템플릿 설정', action: () => templateSettings(source.id) },
    '-',
    { icon: 'import', label: '가져오기', action: () => importDialog(source.parentId, source.id) },
    { icon: 'export', label: '내보내기', action: () => exportDialog(source.id) },
  ], { align: 'end' });
}
async function render() {
  const token = ++rendering; closePopover();
  const sidebar = $('#sidebar-body'), collapsedIds = new Set(JSON.parse(localStorage.getItem(sidebarCollapsedKey) ?? '[]'));
  const pages = element('div', { class: 'sidebar-tree', role: 'tree', 'aria-label': '개인 페이지' });
  const toggle = id => { if (collapsedIds.has(id)) collapsedIds.delete(id); else collapsedIds.add(id); storeLocal(sidebarCollapsedKey, JSON.stringify([...collapsedIds])); render().catch(report); };
  function tree(parentId, depth = 0) {
    if (depth > 30) return;
    for (const item of childrenOf(parentId).filter(item => ['page', 'source', 'view'].includes(item.kind) && !item.sourceId)) {
      const views = item.kind === 'source' ? childrenOf(item.parentId).filter(view => view.kind === 'view' && view.sourceId === item.id) : [];
      const expandable = views.length || childrenOf(item.id).some(child => ['page', 'source', 'view'].includes(child.kind) && !child.sourceId), closed = collapsedIds.has(item.id), name = item.title ?? item.name ?? '제목 없음';
      pages.append(element('div', { class: `sidebar-item${depth ? ' nested' : ''}`, style: `--depth:${depth}`, role: 'treeitem', 'aria-expanded': expandable ? String(!closed) : null },
        link(item), expandable ? iconButton(closed ? 'chevron-right' : 'chevron-down', `${name} ${closed ? '펼치기' : '접기'}`, () => toggle(item.id), { class: 'tree-toggle' }) : null,
        item.kind === 'page' ? element('span', { class: 'sidebar-item-actions' }, iconButton('more', `${name} 메뉴`, event => pageMenu(event.currentTarget, item), { 'aria-haspopup': 'menu' }), iconButton('plus', `${name}에 하위 페이지 추가`, () => pageDialog(null, false, null, item.id))) : null));
      if (closed) continue;
      for (const view of views) pages.append(element('div', { class: 'sidebar-item nested view-item', style: `--depth:${depth + 1}`, role: 'treeitem' }, link(view)));
      tree(item.id, depth + 1);
    }
  }
  const unread = state.objects.filter(item => item.kind === 'notification' && !item.read && visible(item.id)).length, badge = $('#sidebar-inbox .inbox-badge');
  if (badge) { badge.hidden = !unread; badge.textContent = unread > 99 ? '99+' : String(unread); $('#sidebar-inbox').setAttribute('aria-label', `받은 알림 · ${unread}`); }
  // 사이드바: 머리 아이콘 줄 · 검색 상자 · 홈 줄 · 즐겨찾기/최근/개인 페이지 · 아래 워크스페이스 전환. 로컬 도구는 워크스페이스 메뉴로 옮겼다.
  const sections = [element('div', { class: 'sidebar-nav sidebar-tabs' },
    sidebarAction('home', '홈', () => navigate(null), { active: !selected }),
    iconButton('switch', '빠른 전환 (⌘P)', quickSwitch, { class: 'sidebar-tab-icon' }))];
  if (favorites().length) sections.push(element('section', { class: 'sidebar-section' }, element('h3', { class: 'sidebar-heading' }, '즐겨찾기'), ...favorites().filter(id => visible(id)).map(id => element('div', { class: 'sidebar-item' }, link(objects.get(id))))));
  const recent = JSON.parse(localStorage.getItem('pageyard-recent') ?? '[]').filter(id => visible(id)).slice(0, 8);
  if (recent.length) sections.push(element('details', { class: 'sidebar-section sidebar-recent', open: localStorage.getItem('pageyard-recent-closed') !== '1', ontoggle: event => storeLocal('pageyard-recent-closed', event.target.open ? '0' : '1') }, element('summary', { class: 'sidebar-heading' }, '최근'), ...recent.map(id => element('div', { class: 'sidebar-item' }, link(objects.get(id))))));
  tree(null);
  sections.push(element('section', { class: 'sidebar-section sidebar-pages' }, element('h3', { class: 'sidebar-heading' }, '개인 페이지'), pages, sidebarAction('plus', '새 페이지 추가', () => pageDialog())));
  sidebar.replaceChildren(...sections);
  renderTopbar();
  const main = element('div'); await renderCurrent(main, token);
  if (token === rendering) { $('#main').classList.toggle('page-wide', !!objects.get(selected)?.fullWidth); $('#main').classList.toggle('database-page', ['view', 'source'].includes(objects.get(selected)?.kind)); $('#main').replaceChildren(...main.childNodes); }
}
async function renderCurrent(main, token) {
  if (!selected) { main.append(element('h1', {}, '워크스페이스'), button('새 페이지', () => pageDialog()), ...state.objects.filter(item => item.kind === 'page' && item.parentId === null && item.alive).map(item => element('p', {}, link(item)))); return; }
  const current = objects.get(selected);
  if (!current || !visible(selected)) { main.append(element('h1', {}, '항목을 찾을 수 없습니다.'), button('휴지통 보기', showTrash)); return; }
  if (['view', 'source'].includes(current.kind)) { await renderDatabase(main, current.kind === 'view' ? { viewId: selected } : { sourceId: selected }); return; }
  if (current.kind !== 'page') { const parent = objects.get(current.parentId); if (parent) main.append(link(parent)); main.append(element('p', {}, current.kind === 'block' ? (current.richText ?? []).map(run => run.text).join('') : current.name ?? '항목')); return; }
  await renderPage(main, current, token);
}
async function renderPage(main, current, token = rendering) {
  const loaded = await api(`/api/objects/${encodeURIComponent(current.id)}`);
  main.classList.toggle('page-wide', !!current.fullWidth);
  if (current.coverAttachmentId) main.append(element('div', { class: 'page-cover-wrap' }, element('img', { src: `/api/attachments/${encodeURIComponent(current.coverAttachmentId)}`, alt: `${current.title} 커버`, class: 'page-cover' }), element('div', { class: 'cover-actions' }, button('변경하기', () => pageAppearance(current), { 'aria-label': '커버 변경하기' }))));
  if (token !== rendering) return;
  const header = element('header', { class: `page-header${current.icon ? ' has-icon' : ''}${current.coverAttachmentId ? ' has-cover' : ''}` });
  if (current.icon) header.append(element('button', { type: 'button', class: 'page-icon', 'aria-label': '아이콘 변경', title: '아이콘 변경', onclick: () => pageAppearance(current) }, current.icon));
  header.append(element('div', { class: 'page-controls' }, !current.icon && button([icon('emoji'), '아이콘 추가'], () => pageAppearance(current)), !current.coverAttachmentId && button([icon('image'), '커버 추가'], () => pageAppearance(current)), button([icon('comment'), '댓글 추가'], () => commentDialog(current))));
  if (current.template) header.append(element('div', { class: 'template-banner', role: 'note' }, icon('template'), element('span', {}, `${objects.get(current.sourceId)?.name ?? '데이터베이스'}의 템플릿을 편집하고 있습니다.`), button('반복 설정', () => recurrenceDialog(current))));
  const titleKey = `pageyard-title-draft:${current.id}`, draft = localStorage.getItem(titleKey) ? JSON.parse(localStorage.getItem(titleKey)) : null;
  const titleControl = input(draft?.value ?? current.title, { class: 'page-title', 'aria-label': '페이지 제목', placeholder: '새 페이지' }), titleRevision = draft?.baseRevision ?? loaded.revision;
  titleControl.addEventListener('input', () => storeLocal(titleKey, JSON.stringify({ value: titleControl.value, baseRevision: titleRevision })));
  header.append(commitControls([titleControl], () => titleControl.value, title => apply([{ type: 'page.update', id: current.id, title }], titleRevision), { initialValue: current.title }));
  main.append(header);
  if (current.sourceId) {
    const source = objects.get(current.sourceId), task = loaded.entity.task, properties = element('section', { class: 'page-properties', 'aria-label': '속성' });
    for (const property of schemaOf(current.sourceId).filter(property => property.type !== 'title')) properties.append(element('div', { class: 'property', 'data-type': property.type }, element('label', {}, button([icon(`type-${property.type}`), element('span', {}, property.name)], () => propertyDialog(current.sourceId, property), { 'aria-label': property.name })), element('div', { class: 'property-value' }, cellEditor(loaded.entity, property, loaded.entity.computed[property.id], (value, revision) => apply([{ type: 'value.set', pageId: current.id, propertyId: property.id, value }], revision), { placeholder: '비어 있음' }))));
    if (source.tasks?.subitems?.enabled && !current.template) properties.append(element('section', { 'aria-label': '업무 계층', class: 'property task-property' }, element('span', { class: 'property-name' }, icon('tasks'), '하위 항목'), element('div', { class: 'property-value' }, task?.parentId && element('p', {}, '상위 항목: ', recordLink(objects.get(task.parentId))), task?.children.length ? element('ul', {}, task.children.map(child => element('li', {}, recordLink(child)))) : null, button([icon('plus'), '하위 항목 추가'], () => pageDialog(current.sourceId, false, current.id), { class: 'quiet' }))));
    if (source.tasks?.dependencies?.enabled && !current.template) properties.append(element('section', { 'aria-label': '업무 의존성', class: 'property task-property' }, element('span', { class: 'property-name' }, icon('dependency'), '의존성'), element('div', { class: 'property-value' }, ['predecessors', 'successors'].map((key, index) => element('p', {}, index ? '후행 업무: ' : '선행 업무: ', task?.[key].length ? task[key].map(item => element('span', {}, recordLink(item), ' ')) : '없음')))));
    properties.append(button([icon('plus'), '속성 추가'], () => propertyDialog(current.sourceId), { class: 'add-property' }));
    main.append(properties);
  }
  const reminders = childrenOf(current.id).filter(item => item.kind === 'reminder');
  main.append(element('section', { 'aria-label': '페이지 알림', class: 'page-reminders' }, reminders.map(item => element('span', { class: 'reminder-chip' }, button([icon('bell'), item.message], () => reminderDialog(current.id, item)), iconButton('close', '알림 취소', () => apply([{ type: 'node.trash', id: item.id }]))))));
  renderComments(main, current, loaded.entity.comments ?? []);
  if (loaded.entity.backlinks?.length) main.append(element('details', { class: 'backlinks' }, element('summary', {}, `이 페이지를 참조하는 항목 · ${loaded.entity.backlinks.length}`), loaded.entity.backlinks.map(page => element('p', {}, link(page)))));
  const children = childrenOf(current.id).filter(item => item.kind === 'page');
  if (children.length) main.append(element('div', { class: 'child-pages' }, children.map(child => element('p', { class: 'child-page' }, link(child)))));
  main.append(blockSelectionTools());
  main.append(element('article', { 'aria-label': '페이지 본문', class: 'page-body' }, childrenOf(current.id).filter(item => item.kind === 'block').map(block => blockElement(block))));
  main.append(button([icon('plus'), '블록 추가'], async () => { const id = crypto.randomUUID(); await apply([{ type: 'block.create', id, parentId: current.id }]); document.querySelector(`[data-block-id="${CSS.escape(id)}"] [contenteditable]`)?.focus(); }, { class: 'add-block-row', title: '클릭하여 새 블록 추가' }));
  for (const source of childrenOf(current.id).filter(item => item.kind === 'source')) { const section = element('section', { class: 'database-section' }); main.append(section); const view = childrenOf(current.id).find(item => item.kind === 'view' && item.sourceId === source.id); await renderDatabase(section, view ? { viewId: view.id } : { sourceId: source.id }); }
  for (const view of childrenOf(current.id).filter(item => item.kind === 'view' && !childrenOf(current.id).some(source => source.kind === 'source' && source.id === item.sourceId))) { const section = element('section', { class: 'database-section' }); main.append(section); await renderDatabase(section, { viewId: view.id }); }
}
function renderComments(container, page, comments) {
  if (!comments.length) return;
  const includeResolved = input('', { type: 'checkbox', 'aria-label': '해결된 주석 표시' }), list = element('div', { class: 'comment-list' }), open = comments.filter(comment => !comment.resolved).length;
  const panel = element('details', { class: 'comments', open: open > 0 }, element('summary', {}, icon('comment'), `개인 주석 · 미해결 ${open}개`), list, element('div', { class: 'comment-tools' }, button([icon('plus'), '주석 추가'], () => commentDialog(page), { class: 'quiet' }), label('해결된 주석 표시', includeResolved)));
  const renderList = () => list.replaceChildren(...comments.filter(comment => includeResolved.checked || !comment.resolved).map(comment => element('article', { 'data-comment-id': comment.id, class: comment.resolved ? 'resolved' : '' },
    element('div', { class: 'comment-meta' }, element('span', { class: 'avatar', 'aria-hidden': 'true' }, String(comment.createdBy ?? '나').slice(0, 1)), element('strong', {}, comment.createdBy), element('small', {}, `${comment.createdAt}${comment.parentId !== page.id ? ' · 블록 주석' : ''}`)),
    element('p', {}, richNodes(comment.richText)),
    element('div', { class: 'comment-actions' }, button(comment.resolved ? '다시 열기' : '해결', () => apply([{ type: 'comment.update', id: comment.id, resolved: !comment.resolved }])), button('주석 수정', () => {
      const text = element('textarea', { value: comment.richText.map(run => run.text).join(''), required: true }), revision = state.revision;
      modal('개인 주석 수정', [label('내용', text)], () => apply([{ type: 'comment.update', id: comment.id, richText: [{ text: text.value }] }], revision));
    }), button('주석 삭제', () => apply([{ type: 'node.trash', id: comment.id }]))))));
  includeResolved.addEventListener('change', renderList); renderList(); container.append(panel);
}
async function showPageHistory(pageId) {
  const { commands } = await api(`/api/history?pageId=${encodeURIComponent(pageId)}`);
  const dialog = modal('페이지 변경 기록', commands.map(command => element('article', {}, element('p', {}, `${command.created_at} · ${command.actor} · 버전 ${command.revision}`), button('이 시점 보기', () => previewPageVersion(pageId, command.revision, () => dialog.close())))), null);
}
async function previewPageVersion(pageId, revision, afterRestore) {
  const past = await api(`/api/versions/${encodeURIComponent(pageId)}?revision=${revision}`), current = await api(`/api/objects/${encodeURIComponent(pageId)}`);
  const preview = element('section', {}, element('p', {}, '제목·속성·본문을 복원합니다. 현재 위치와 개인 주석은 유지됩니다.'), element('p', {}, `제목: ${current.entity.title} → ${past.entity.title}`),
    past.properties.filter(property => !['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(property.type)).map(property => element('p', {}, `${property.name}: ${format(current.entity.computed?.[property.id], property)} → ${format(property.value, property)}`)),
    element('h3', {}, '선택한 시점의 본문'), past.blocks.map(block => element('p', {}, richNodes(block.richText ?? []))));
  const dialog = modal('과거 상태 비교', [preview], async () => { await apply([{ type: 'page.restore_version', id: pageId, revision }], current.revision); afterRestore?.(); });
  dialog.querySelector('button[type=submit]').textContent = '이 상태로 복원';
}
function showTrash() {
  const main = $('#main'); main.replaceChildren(element('h1', {}, '휴지통'), ...state.objects.filter(item => !item.alive).map(item => element('p', {}, item.title ?? item.name ?? blockLabels[item.blockType] ?? item.kind, ' ', button('복원', () => apply([{ type: 'node.restore', id: item.id }])))));
}
$('#new-page').onclick = () => pageDialog();
$('#sidebar-inbox').onclick = () => showInbox();
$('#sidebar-trash').onclick = () => showTrash();
$('#workspace-menu').onclick = event => menu(event.currentTarget, [{ heading: '로컬 워크스페이스' },
  { icon: 'import', label: '가져오기', action: () => importDialog() },
  { icon: 'send', label: '외부 전송 기록', action: showDeliveries },
  { icon: 'bell', label: localStorage.getItem('pageyard-desktop-notifications') === 'on' ? '데스크톱 알림 끄기' : '데스크톱 알림 켜기', action: () => configureDesktopNotifications().catch(report) },
  { icon: 'clock', label: '예약 작업 지금 확인', action: () => apply([{ type: 'scheduler.tick', at: new Date().toISOString() }]) },
  { icon: 'backup', label: '백업', action: runBackup }, '-',
  { icon: 'trash', label: '휴지통', action: () => showTrash() }]);
const setSidebar = open => { $('#shell').classList.toggle('sidebar-closed', !open); $('#sidebar-open').hidden = open; storeLocal('pageyard-sidebar-closed', open ? '0' : '1'); };
$('#sidebar-toggle').onclick = () => setSidebar(false); $('#sidebar-open').onclick = () => setSidebar(true);
if (localStorage.getItem('pageyard-sidebar-closed') === '1') setSidebar(false);
addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.shiftKey && !document.activeElement?.closest?.('[contenteditable=true]')) { event.preventDefault(); if ($('#shell').classList.contains('sidebar-closed')) setSidebar(true); $('#search').focus(); } });
$('#reload').onclick = () => refresh(true).catch(report);
$('#retry').onclick = async () => {
  let latest;
  try { latest = await api('/api/state'); if (!connected) latest = null; } catch { latest = null; }
  const current = latest ? new Map(latest.objects.map(item => [item.id, item])) : objects;
  const sections = [...pending].map(([key, item]) => {
    const conversion = item.command.operations?.find(operation => operation.type === 'property.convert');
    const summaries = (item.command.operations ?? []).map(operation => {
      const target = current.get(operation.pageId ?? operation.id);
      const property = current.get(operation.propertyId);
      if (operation.type === 'value.set' || operation.type === 'relation.set') return `${target?.title ?? '항목'} · ${property?.name ?? '속성'}: ${format(target?.values?.[property?.id ?? operation.propertyId], property)} → ${format(operation.type === 'value.set' ? operation.value : operation.targetIds, property)}`;
      if (operation.type === 'block.update') return [operation.richText !== undefined ? `본문: ${runsText(target?.richText ?? [])} → ${runsText(operation.richText)}` : null, ...['url', 'language', 'attachmentId'].filter(field => operation[field] !== undefined).map(field => `${field}: ${target?.[field] ?? '비어 있음'} → ${operation[field] ?? '비어 있음'}`)].filter(Boolean).join('\n');
      if (operation.type === 'page.update') return `페이지: ${target?.title ?? ''} → ${operation.title ?? target?.title ?? ''}`;
      return `${target?.title ?? target?.name ?? '항목'} 변경`;
    });
    if (item.route === '/api/attachments') {
      const reference = item.command.reference;
      summaries.push(`${item.command.name} 첨부${reference?.propertyId ? ` · ${current.get(reference.pageId)?.title ?? '항목'} · ${current.get(reference.propertyId)?.name ?? '파일'}: ${format(current.get(reference.pageId)?.values?.[reference.propertyId], { type: 'files' })} → 파일 추가` : reference ? ` · 본문 ${reference.parentId ? '블록 추가' : '첨부 교체'}` : ' 등록'}`);
    }
    const richComparisons = (item.command.operations ?? []).filter(operation => operation.type === 'block.update' && operation.richText !== undefined).map(operation => element('div', {}, element('strong', {}, '저장된 본문'), element('p', {}, richNodes(current.get(operation.id)?.richText ?? [])), element('strong', {}, '보존한 입력'), element('p', {}, richNodes(operation.richText))));
    return element('article', {}, element('p', {}, summaries.join('\n') || '되돌리기'), richComparisons, element('p', { class: 'error' }, item.error?.message ?? '저장 결과를 확인하지 못했습니다.'), element('div', { class: 'toolbar' },
      button('같은 저장 다시 확인', async () => { await sendCommand(item.command, item.route); await refresh(true); sectionDialog.close(); }),
      conversion && latest ? button('변환 결과 다시 확인', async () => { await showPropertyConversion(conversion, () => { pending.delete(key); persistPending(); }); sectionDialog.close(); }) : null,
      !conversion && item.error?.code === 'REVISION_CONFLICT' && ['/api/commands', '/api/attachments'].includes(item.route) && latest ? button('확인한 현재 값에 적용', async () => {
        const upload = item.route === '/api/attachments', reference = item.command.reference;
        await sendCommand({ ...item.command, id: upload ? item.command.id : crypto.randomUUID(), expectedRevision: latest.revision,
          ...(reference?.propertyId ? { reference: { ...reference, attachmentIds: current.get(reference.pageId)?.values?.[reference.propertyId] ?? [] } } : {}) }, item.route);
        pending.delete(key); persistPending(); await refresh(true); sectionDialog.close();
      }) : null,
      button('보류 입력 버리기', async () => { for (const operation of item.command.operations ?? []) for (const [key] of commandDrafts(operation)) localStorage.removeItem(key);
        pending.delete(key); persistPending(); if (item.route === '/api/attachments') await uploadBytes(key, null); sectionDialog.close(); await refresh(true); status('보류한 입력을 버렸습니다. 저장된 업무 데이터는 바뀌지 않았습니다.'); })));
  });
  const sectionDialog = modal(latest ? '보류한 저장 · 현재 값과 비교' : '보류한 저장 · 연결 끊김', sections, null);
};
async function openRunList() {
  const content = element('div'), dialog = modal('에이전트 실행 기록', [content], null);
  async function load(offset = 0) {
    const page = await api(`/api/runs?limit=20&offset=${offset}`);
    content.replaceChildren(element('p', {}, `작업 ${page.total}건`), button('새로 읽기', () => load(offset)),
      ...page.runs.map(run => element('article', {}, element('h3', {}, new Date(run.updatedAt).toLocaleString('ko-KR')),
        element('p', {}, `저장된 변경 ${run.commandCount}건 · 설명 ${run.logCount}건`), element('p', {}, run.summary ?? '설명 없이 저장된 변경'),
        button('기록 열기', () => openRunDetail(run.runId, () => dialog.close(), () => load(offset))))),
      ...(!page.total ? [element('p', {}, '기록된 에이전트 작업이 없습니다.')] : []),
      element('div', { class: 'toolbar' }, button('이전', () => load(Math.max(0, offset - 20)), { disabled: !offset }), button('다음', () => load(offset + 20), { disabled: !page.hasMore })));
  }
  await load();
}
async function openRunDetail(runId, leaveList, updateList) {
  const content = element('div'), errorText = element('p', { class: 'error', role: 'alert' }), dialog = modal('에이전트 작업 상세', [errorText, content], null);
  const targetLink = target => target.location ? element('a', { href: target.location, onclick: event => {
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault(); dialog.close(); leaveList(); navigate(new URL(target.location, location.href).searchParams.get('id'));
  } }, target.label) : element('span', {}, `${target.label} · 현재 열 수 없음`);
  async function load(offset = 0) {
    const detail = await api(`/api/runs/${encodeURIComponent(runId)}?limit=20&offset=${offset}`);
    errorText.textContent = '';
    content.replaceChildren(button('새로 읽기', () => load(offset)), element('h3', {}, `실제 저장된 변경 · ${detail.commandTotal}건`),
      ...(!detail.commandTotal ? [element('p', {}, '이 실행에 연결된 저장 명령은 없습니다.')] : []),
      ...detail.commands.map(command => element('article', { 'data-command-id': command.id },
        element('h4', {}, `${command.kind === 'undo' ? '복구' : '변경'} · 버전 ${command.revision} · ${new Date(command.created_at).toLocaleString('ko-KR')}`),
        element('ul', {}, command.changes.map(target => element('li', {}, targetLink(target)))),
        button('이 변경 되돌리기', async () => {
          try {
            await Promise.all(pendingSaves);
            const result = await sendCommand({ id: crypto.randomUUID(), actor: 'user', expectedRevision: detail.revision, targetCommandId: command.id }, '/api/undo');
            redoTarget = result.commandId; $('#redo').disabled = false; await refresh(true); await load(offset); await updateList();
          } catch (error) { errorText.textContent = error.message; }
        }))),
      element('div', { class: 'toolbar' }, button('이전 변경', () => load(Math.max(0, offset - 20)), { disabled: !offset }), button('다음 변경', () => load(offset + 20), { disabled: !detail.hasMore })),
      element('h3', {}, '별도 처리 설명'), ...(!detail.logs.length ? [element('p', {}, '저장된 설명이 없습니다.')] : []),
      ...detail.logs.map(log => element('article', {}, element('p', {}, new Date(log.createdAt).toLocaleString('ko-KR')), element('pre', { class: 'run-message' }, log.message),
        log.targets.length ? element('div', {}, element('p', {}, '설명에 연결된 항목'), element('ul', {}, log.targets.map(target => element('li', {}, targetLink(target))))) : null)));
  }
  await load();
}
$('#runs').onclick = openRunList;
async function runBackup() { try { const result = await api('/api/backups', {}); status(`백업 저장: ${result.destination}`); } catch (error) { report(error); } }
$('#history').onclick = async () => {
  try {
    const { commands } = await api('/api/history');
    modal('변경 기록', commands.map(command => element('article', {}, element('h3', {}, `${command.revision} · ${command.actor} · ${command.kind === 'undo' ? '복구' : '변경'}`), element('p', {}, command.result.changes.map(change => objects.get(change.id)?.title ?? objects.get(change.id)?.name ?? blockLabels[objects.get(change.id)?.blockType] ?? '항목').join(', ') || '내용 변화 없음'), button('이 변경 되돌리기', async () => {
      const result = await sendCommand({ id: crypto.randomUUID(), actor: 'user', expectedRevision: state.revision, targetCommandId: command.id }, '/api/undo');
      redoTarget = result.commandId; $('#redo').disabled = false; await refresh(true); status('변경을 되돌렸습니다.');
    }))), null);
  } catch (error) { report(error); }
};
$('#undo').onclick = async () => {
  await Promise.allSettled(pendingSaves);
  if (!undoTarget) return;
  try { const result = await sendCommand({ id: crypto.randomUUID(), actor: 'user', expectedRevision: state.revision, targetCommandId: undoTarget }, '/api/undo'); redoTarget = result.commandId; undoTarget = null; $('#redo').disabled = false; $('#undo').disabled = true; await refresh(true); status('되돌렸습니다.'); } catch (error) { report(error); }
};
$('#redo').onclick = async () => {
  await Promise.allSettled(pendingSaves);
  if (!redoTarget) return;
  try { const result = await sendCommand({ id: crypto.randomUUID(), actor: 'user', expectedRevision: state.revision, targetCommandId: redoTarget }, '/api/undo'); undoTarget = result.commandId; redoTarget = null; $('#redo').disabled = true; $('#undo').disabled = false; await refresh(true); } catch (error) { report(error); }
};
$('#search-form').onsubmit = async event => { event.preventDefault(); try { const result = await api('/api/search', { query: $('#search').value }); $('#main').replaceChildren(element('h1', {}, `검색 · ${result.total}개`), ...result.results.map(item => element('article', {}, element('h2', {}, link(item)), element('p', {}, item.excerpt)))); } catch (error) { report(error); } };
addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='p'){event.preventDefault();quickSwitch();}});
addEventListener('popstate', () => { selected = new URL(location.href).searchParams.get('id'); render().catch(report); });
addEventListener('online', () => { if (pending.size) status('연결이 복구됐습니다. 보류한 저장을 재시도할 수 있습니다.'); });
const events = new EventSource('/api/events');
events.onopen = () => { connected = true; status(pending.size ? '연결됐습니다. 보류한 저장을 확인하세요.' : `연결됨 · ${state.revision}`); };
events.onmessage = event => { const data = JSON.parse(event.data); if (data.revision !== state.revision) refresh().catch(report); };
events.onerror = () => { connected = false; status('앱 연결이 끊겼습니다. 입력과 보류한 저장은 브라우저에 보존합니다.', true); };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.mjs', { type: 'module' }).catch(error => report(new Error(`오프라인 화면 준비 실패: ${error.message}`)));
try { await refresh(true); if (connected) status(`저장됨 · ${state.revision}`); } catch (error) {
  const cached = localStorage.getItem(snapshotKey);
  if (cached) { state = JSON.parse(cached); objects = new Map(state.objects.map(item => [item.id, item])); await render().catch(report); }
  report(error);
}
