import { formatDay } from '../data/format';
import { language, t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { newId } from '../data/commands';
import { workspace } from '../data/store';
import type { PropertyEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Popover, type Anchor } from '../ui/overlay';

// 변수 정의 (an automation action):
// - a 466-wide card: a 44-high head (20px r4 tinted icon box, "변수 정의" 14px; on hover a 53×28 ringed pair:
//   접기 · ⋯), a line, then per variable its name button (28 high, r6, the type icon 16 + name 14px #7d7a75 + ⌄)
//   7 above a 28-high r6 field (tinted, ringed; "@" and "Σ" at its right) and "다른 변수 정의…" (14px #7d7a75);
// - the name menu (265 wide): the name, 텍스트로 편집 · 수식으로 편집 · 복제 / 변수 지우기 / "유형: …";
// - text answers mention the trigger page's properties, the trigger time/date and people ("@"); a formula
//   ("Σ", "수식 편집") is shown as code. Later 속성 편집 actions can set a property to a variable ("# 변수 1").
export interface Variable { id: string; name: string; mode: 'text' | 'formula'; value: string }
export type VariableRef = { id: string; name: string; kind: VariableKind };
type VariableKind = 'text' | 'number' | 'checkbox' | 'date' | 'person';

const kindIcons: Record<VariableKind, string> = { text: 'type-text', number: 'type-number', checkbox: 'type-checkbox', date: 'type-date', person: 'type-person' };
const kindLabels: Record<VariableKind, string> = { text: t("텍스트"), number: t("숫자"), checkbox: t("체크박스"), date: t("날짜"), person: t("사람") };
// What a formula gives back, as far as one can tell without running it (the icon and "유형").
export function variableKind(variable: Variable): VariableKind {
  if (variable.mode === 'text') return 'text';
  const text = variable.value.trim();
  if (!text) return 'text';
  if (/^[\d\s+\-*/%^().]+$/.test(text) || /^(sum|min|max|abs|round|floor|ceil|sqrt|pow|toNumber|length|count|dateBetween)\(/.test(text)) return 'number';
  if (/(==|!=|>=|<=|[<>])|^(true|false|empty|contains|test|and|or|not)\b/.test(text)) return 'checkbox';
  if (/^(now|today|dateAdd|dateSubtract|parseDate|dateStart|dateEnd)\(|트리거된 (시간|날짜)|"\$(now|today)"/.test(text)) return 'date';
  if (/트리거한 사용자|페이지 작성자|"\$(actor|author)"/.test(text)) return 'person';
  return 'text';
}
export const variableIcon = (variable: Variable) => kindIcons[variableKind(variable)];

const triggerTokens: Array<{ token: string; label: string; icon: string; section: string }> = [
  { token: '$now', label: t("트리거된 시간"), icon: 'type-date', section: t("날짜") },
  { token: '$today', label: t("트리거된 날짜"), icon: 'type-date', section: t("날짜") },
  { token: '$actor', label: t("트리거한 사용자"), icon: 'type-person', section: t("사용자") },
  { token: '$author', label: t("페이지 작성자"), icon: 'type-person', section: t("사용자") },
  { token: '$page', label: t("트리거 페이지"), icon: 'arrow-up-right', section: t("페이지") },
];
function tokenLabel(token: string) {
  return triggerTokens.find(item => item.token === token)?.label ?? workspace.get<PropertyEntity>(token)?.name ?? t("삭제된 속성");
}

export function VariablesCard({ variables, sourceId, hasPage, onChange, onMore }: { variables: Variable[]; sourceId: string; hasPage: boolean; onChange: (variables: Variable[]) => void; onMore: (anchor: Element) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ anchor: Element; index: number } | null>(null);
  const [formula, setFormula] = useState<{ anchor: Element; index: number } | null>(null);
  const set = (index: number, patch: Partial<Variable>) => onChange(variables.map((item, i) => i === index ? { ...item, ...patch } : item));
  const nextName = () => { let n = variables.length + 1; while (variables.some(item => item.name === t("변수 {0}", [n]))) n++; return t("변수 {0}", [n]); };
  return (
    <div className="automation-vars">
      <div className="automation-vars-head">
        <span className="automation-vars-icon"><Icon name="text-block" size={14} /></span><span className="automation-vars-title">{t("변수 정의")}</span>
        <span className="automation-vars-tools">
          <button type="button" aria-label={collapsed ? t("펼치기") : t("접기")} title={collapsed ? t("펼치기") : t("접기")} onClick={() => setCollapsed(!collapsed)}><Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} /></button>
          <button type="button" aria-label={t("작업 옵션")} onClick={event => onMore(event.currentTarget)}><Icon name="more" size={16} /></button>
        </span>
      </div>
      {collapsed ? null : (
        <div className="automation-vars-body">
          {variables.map((variable, index) => (
            <div key={variable.id} className="automation-var">
              <button type="button" className="automation-var-name" onClick={event => setMenu({ anchor: event.currentTarget, index })}><Icon name={variableIcon(variable)} size={16} /><span>{variable.name}</span><Icon name="chevron-down" size={12} /></button>
              {variable.mode === 'formula' ? (
                <div className="automation-var-field formula" role="button" tabIndex={0} onClick={event => setFormula({ anchor: event.currentTarget, index })}>
                  <code className="automation-var-code">{variable.value}</code>
                  <span className="automation-var-tool active" aria-hidden="true">Σ</span>
                </div>
              ) : <TokenField value={variable.value} sourceId={sourceId} hasPage={hasPage} onChange={value => set(index, { value })} onFormula={anchor => { set(index, { mode: 'formula', value: '' }); setFormula({ anchor, index }); }} />}
            </div>
          ))}
          <button type="button" className="automation-var-more" onClick={() => onChange([...variables, { id: newId(), name: nextName(), mode: 'text', value: '' }])}>{t("다른 변수 정의…")}</button>
        </div>
      )}
      {menu && variables[menu.index] ? <VariableMenu anchor={menu.anchor} variable={variables[menu.index]} taken={variables.filter((_, i) => i !== menu.index).map(item => item.name)}
        onRename={name => set(menu.index, { name })}
        onMode={mode => { const anchor = menu.anchor.closest('.automation-var')?.querySelector('.automation-var-field') ?? menu.anchor; set(menu.index, { mode, value: mode === variables[menu.index].mode ? variables[menu.index].value : '' }); if (mode === 'formula') setFormula({ anchor, index: menu.index }); }}
        onDuplicate={() => { const copy = { ...variables[menu.index], id: newId(), name: t("{0} 사본", [variables[menu.index].name]) }; const next = [...variables]; next.splice(menu.index + 1, 0, copy); onChange(next); }}
        onClear={() => onChange(variables.length > 1 ? variables.filter((_, i) => i !== menu.index) : variables.map(item => ({ ...item, mode: 'text', value: '' })))}
        onClose={() => setMenu(null)} /> : null}
      {formula && variables[formula.index] ? <FormulaPopover anchor={formula.anchor} value={variables[formula.index].value} sourceId={sourceId} hasPage={hasPage}
        names={variables.slice(0, formula.index).map(item => item.name)}
        onDone={value => { set(formula.index, value.trim() ? { value } : { mode: 'text', value: '' }); setFormula(null); }} /> : null}
    </div>
  );
}

function VariableMenu({ anchor, variable, taken, onRename, onMode, onDuplicate, onClear, onClose }: { anchor: Element; variable: Variable; taken: string[]; onRename: (name: string) => void; onMode: (mode: Variable['mode']) => void; onDuplicate: () => void; onClear: () => void; onClose: () => void }) {
  const [name, setName] = useState(variable.name);
  const commit = () => { const next = name.trim(); if (next && next !== variable.name && !taken.includes(next)) onRename(next); };
  const entries: MenuEntry[] = [
    { kind: 'custom', render: () => <input className="automation-var-rename" value={name} autoFocus aria-label={t("변수 이름")} onChange={event => setName(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { commit(); onClose(); } }} /> },
    { kind: 'separator' },
    { label: t("텍스트로 편집"), icon: 'pencil', checked: variable.mode === 'text', onSelect: () => { commit(); onMode('text'); } },
    { label: t("수식으로 편집"), icon: 'sigma', checked: variable.mode === 'formula', onSelect: () => { commit(); onMode('formula'); } },
    { label: t("복제"), icon: 'duplicate', onSelect: () => { commit(); onDuplicate(); } },
    { kind: 'separator' },
    { label: t("변수 지우기"), icon: 'trash', onSelect: onClear },
    { kind: 'separator' },
    { kind: 'custom', render: () => <div className="automation-var-type">{t("유형: {0}", [kindLabels[variableKind(variable)]])}</div> },
  ];
  return <Menu anchor={anchor} placement="below-start" offset={0} width={265} entries={entries} onClose={() => { commit(); onClose(); }} label={t("변수")} />;
}

// A text value with mentions ({{token}} in the stored text, chips on screen).
export function TokenField({ value, sourceId, hasPage, onChange, onFormula, variables = [] }: { value: string; sourceId: string; hasPage: boolean; onChange: (value: string) => void; onFormula?: (anchor: Element) => void; variables?: Variable[] }) {
  const box = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [mention, setMention] = useState<Element | null>(null);
  const serialize = (element: HTMLElement) => [...element.childNodes].map(node => node instanceof HTMLElement && node.dataset.token ? `{{${node.dataset.token}}}` : node.textContent ?? '').join('');
  const label = (token: string) => token.startsWith('var:') ? variables.find(variable => variable.id === token.slice(4))?.name ?? t("변수")
    : token.startsWith('page:') ? workspace.title(workspace.get(token.slice(5))) || t("페이지")
    : token.startsWith('date:') ? formatDay(new Date(`${token.slice(5, 15)}T00:00`))
    : token.startsWith('=') ? `Σ ${token.slice(1).length > 24 ? `${token.slice(1, 24)}…` : token.slice(1)}`
    : tokenLabel(token);
  const [picking, setPicking] = useState<{ kind: 'date' | 'formula'; anchor: Element } | null>(null);
  const chip = (token: string) => { const span = document.createElement('span'); span.className = 'automation-chip'; span.contentEditable = 'false'; span.dataset.token = token; span.textContent = label(token); return span; };
  useEffect(() => {
    const element = box.current;
    if (!element || serialize(element) === value) return;
    element.textContent = '';
    value.split(/(\{\{[^{}]+\}\})/).filter(Boolean).forEach(part => element.append(/^\{\{[^{}]+\}\}$/.test(part) ? chip(part.slice(2, -2)) : document.createTextNode(part)));
  }, [value]);
  const remember = () => { const selection = window.getSelection(); if (selection?.rangeCount && box.current?.contains(selection.anchorNode)) range.current = selection.getRangeAt(0).cloneRange(); };
  const insert = (token: string) => {
    const element = box.current; if (!element) return;
    const at = range.current && element.contains(range.current.startContainer) ? range.current : (() => { const r = document.createRange(); r.selectNodeContents(element); r.collapse(false); return r; })();
    const node = chip(token); at.deleteContents(); at.insertNode(node);
    const after = document.createRange(); after.setStartAfter(node); after.collapse(true);
    element.focus(); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(after); range.current = after;
    onChange(serialize(element));
  };
  const today = new Date();
  const entries: MenuEntry[] = [
    { kind: 'section', label: t("속성 출처:") },
    { label: t("트리거 페이지"), icon: 'arrow-up-right', disabled: !hasPage, submenuWidth: 250, submenu: () => workspace.schema(sourceId).map(property => ({ label: property.name, icon: `type-${property.type}`, keywords: property.name, onSelect: () => insert(property.id) }) as MenuEntry) },
    { kind: 'separator' },
    { kind: 'section', label: t("날짜") },
    ...triggerTokens.filter(item => item.section === t("날짜")).map(item => ({ label: item.label, icon: item.icon, onSelect: () => insert(item.token) }) as MenuEntry),
    { label: t("오늘"), icon: 'clock', hint: formatDay(today), onSelect: () => { const element = box.current; if (!element) return; element.append(document.createTextNode(today.toISOString().slice(0, 10))); onChange(serialize(element)); } },
    { kind: 'separator' },
    { kind: 'section', label: t("사용자") },
    ...triggerTokens.filter(item => item.section === t("사용자")).map(item => ({ label: item.label, icon: item.icon, disabled: item.token === '$author' && !hasPage, onSelect: () => insert(item.token) }) as MenuEntry),
    { kind: 'separator' },
    { label: t("날짜 선택…"), icon: 'calendar', onSelect: () => { const anchor = box.current?.parentElement; if (anchor) setPicking({ kind: 'date', anchor }); } },
    { kind: 'separator' },
    { kind: 'section', label: t("페이지") },
    { label: t("트리거 페이지"), icon: 'page', disabled: !hasPage, onSelect: () => insert('$page') },
    // Any page of the workspace, by its title.
    { label: t("다른 페이지"), icon: 'page', submenuWidth: 260, submenu: () => (workspace.snapshot.objects.filter(item => item.kind === 'page' && workspace.visible(item.id) && !(item as unknown as { template?: boolean }).template && !(item as unknown as { sourceId?: string }).sourceId) as unknown as Array<{ id: string; title: string }>)
      .slice(0, 200).map(page => ({ label: page.title || t("새 페이지"), icon: 'page', keywords: page.title, onSelect: () => insert(`page:${page.id}`) }) as MenuEntry) },
    // Variables defined by earlier actions ({{var:id}}).
    ...(variables.length ? [{ kind: 'separator' } as MenuEntry, { kind: 'section', label: t("변수") } as MenuEntry, ...variables.map(variable => ({ label: variable.name, icon: variableIcon(variable), onSelect: () => insert(`var:${variable.id}`) }) as MenuEntry)] : []),
  ];
  return (
    <div className="automation-var-field">
      <div ref={box} className="automation-var-input" contentEditable suppressContentEditableWarning role="textbox" aria-label={t("변수 값")}
        onInput={event => onChange(serialize(event.currentTarget))} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
        onKeyDown={event => {
          if (event.key === 'Enter') event.preventDefault();
          if (event.key === '@' && !event.nativeEvent.isComposing) { event.preventDefault(); remember(); setMention(event.currentTarget.parentElement); }
        }} />
      <button type="button" className="automation-var-tool" aria-label={t("멘션")} title={t("멘션")} onMouseDown={event => event.preventDefault()} onClick={event => { remember(); setMention(event.currentTarget.parentElement); }}>@</button>
      {onFormula ? <button type="button" className="automation-var-tool" aria-label={t("수식으로 편집")} title={t("수식으로 편집")} onClick={event => onFormula(event.currentTarget.parentElement!)}>Σ</button>
        // Without a formula mode of its own, Σ puts a formula into the text where the caret is.
        : <button type="button" className="automation-var-tool" aria-label={t("수식 넣기")} title={t("수식 넣기")} onMouseDown={event => event.preventDefault()} onClick={event => { remember(); setPicking({ kind: 'formula', anchor: event.currentTarget.parentElement! }); }}>Σ</button>}
      {mention ? <Menu anchor={mention} placement="above-start" width={325} maxHeight={330} search={t("검색…")} entries={entries} onClose={() => setMention(null)} label={t("멘션")} /> : null}
      {picking?.kind === 'formula' ? <FormulaPopover anchor={picking.anchor} value="" sourceId={sourceId} hasPage={hasPage} names={variables.map(item => item.name)} onDone={text => { setPicking(null); if (text.trim()) insert(`=${text.trim().replace(/[{}]/g, '')}`); }} /> : null}
      {picking?.kind === 'date' ? (
        <Popover anchor={picking.anchor} placement="below-start" onClose={() => setPicking(null)} className="automation-date-pick" style={{ width: 220 }} label={t("날짜 선택")}>
          <input type="date" className="text-input" autoFocus aria-label={t("날짜 선택")} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) { const value = event.target.value; setPicking(null); insert(`date:${value}`); } }} />
        </Popover>
      ) : null}
    </div>
  );
}

// "수식 편집": the formula and what it can use — the trigger, the variables defined before it, the properties.
export function FormulaPopover({ anchor, value, sourceId, hasPage, names, onDone }: { anchor: Anchor; value: string; sourceId: string; hasPage: boolean; names: string[]; onDone: (value: string) => void }) {
  const [text, setText] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (name: string) => {
    const element = area.current; const snippet = `prop("${name}")`;
    const start = element?.selectionStart ?? text.length, end = element?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end); setText(next);
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + snippet.length, start + snippet.length); });
  };
  const group = (title: string, items: Array<{ name: string; icon: string; value?: string }>) => items.length ? (
    <div className="formula-group"><div className="formula-group-title">{title}</div>
      {items.map(item => <button type="button" key={item.name} className="formula-item" onClick={() => insert(item.value ?? item.name)}><Icon name={item.icon} size={16} /><span>{item.name}</span></button>)}
    </div>
  ) : null;
  return (
    <Popover anchor={anchor} placement="below-start" offset={4} onClose={() => onDone(text)} className="formula-popover" style={{ width: 560 }} label={t("수식 편집")}>
      <div className="formula-head"><span>{t("수식 편집")}</span><Icon name="question" size={14} className="formula-help" /><span className="spacer" /><button type="button" className="blue-button small" onClick={() => onDone(text)}>{t("완료")}</button></div>
      <textarea ref={area} className="formula-input" rows={4} value={text} placeholder={t("수식 입력")} autoFocus spellCheck={false} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onDone(text); } }} />
      <div className="formula-note">{t("prop(\"이름\")으로 속성·변수·트리거 값을 씁니다. 저장할 때 수식을 확인합니다.")}</div>
      <div className="formula-list">
        {group(t("트리거"), triggerTokens.filter(item => hasPage || !['$author', '$page'].includes(item.token)).map(item => ({ name: item.label, icon: item.icon, value: language === 'ko' ? item.label : item.token })))}
        {group(t("변수"), names.map(name => ({ name, icon: 'variable' })))}
        {hasPage ? group(t("속성"), workspace.schema(sourceId).map(property => ({ name: property.name, icon: `type-${property.type}` }))) : null}
      </div>
    </Popover>
  );
}

// Where an action's value comes from: typed in (the field beside it), a variable defined by an earlier action, or a
// formula ({ $variable } / { $formula } on the action, worked out when it runs).
export function ValueSource({ value, variables, sourceId, hasPage, onChange, emptyLabel, label }: { value: unknown; variables: Variable[]; sourceId: string; hasPage: boolean; onChange: (value: unknown) => void; emptyLabel?: string; label?: string }) {
  const [formula, setFormula] = useState<Element | null>(null);
  const ref = value && typeof value === 'object' && !Array.isArray(value) ? value as { $variable?: string; $formula?: string } : null;
  const current = ref?.$formula != null ? '$formula' : ref?.$variable ?? '';
  return (
    <>
      <select className="text-input automation-value-source" aria-label={label ?? t("값 출처")} value={current} onChange={event => {
        const next = event.target.value;
        if (next === '$formula') setFormula(event.currentTarget);
        else onChange(next ? { $variable: next } : null);
      }}>
        <option value="">{emptyLabel ?? t("직접 입력")}</option>
        {variables.map(variable => <option key={variable.id} value={variable.id}>{variable.name}</option>)}
        <option value="$formula">{t("사용자 지정 수식")}</option>
      </select>
      {ref?.$formula != null ? <button type="button" className="text-button small automation-value-formula" onClick={event => setFormula(event.currentTarget)}><Icon name="sigma" size={14} /><code>{ref.$formula}</code></button> : null}
      {formula ? <FormulaPopover anchor={formula} value={ref?.$formula ?? ''} sourceId={sourceId} hasPage={hasPage} names={variables.map(item => item.name)}
        onDone={text => { setFormula(null); if (text.trim()) onChange({ $formula: text }); }} /> : null}
    </>
  );
}

// 변수 정의 in a button: each variable's name, text (with @ mentions) or formula.
export function VariablesEditor({ variables, sourceId, hasPage, earlier, onChange }: { variables: Variable[]; sourceId: string; hasPage: boolean; earlier: Variable[]; onChange: (variables: Variable[]) => void }) {
  const [formula, setFormula] = useState<{ anchor: Element; id: string } | null>(null);
  const set = (id: string, patch: Partial<Variable>) => onChange(variables.map(item => item.id === id ? { ...item, ...patch } : item));
  const editing = formula ? variables.find(item => item.id === formula.id) : undefined;
  return (
    <div className="button-variables">
      {variables.map(variable => (
        <div key={variable.id} className="button-variable">
          <div className="button-variable-head">
            <input className="text-input" value={variable.name} aria-label={t("변수 이름")} onChange={event => set(variable.id, { name: event.target.value })} />
            <select className="text-input" aria-label={t("유형")} value={variable.mode} onChange={event => set(variable.id, { mode: event.target.value as Variable['mode'] })}>
              <option value="text">{t("텍스트")}</option><option value="formula">{t("수식")}</option>
            </select>
            {variables.length > 1 ? <button type="button" className="icon-button small" aria-label={t("변수 지우기")} onClick={() => onChange(variables.filter(item => item.id !== variable.id))}><Icon name="close" size={14} /></button> : null}
          </div>
          {variable.mode === 'text'
            ? <TokenField value={variable.value} sourceId={sourceId} hasPage={hasPage} variables={earlier} onChange={value => set(variable.id, { value })} />
            : <button type="button" className="text-button small automation-value-formula" onClick={event => setFormula({ anchor: event.currentTarget, id: variable.id })}><Icon name="sigma" size={14} /><code>{variable.value || t("수식 입력")}</code></button>}
        </div>
      ))}
      <button type="button" className="text-button small" onClick={() => onChange([...variables, { id: newId(), name: t("변수 {0}", [earlier.length + variables.length + 1]), mode: 'text', value: '' }])}><Icon name="plus" size={14} />{t("다른 변수 정의…")}</button>
      {formula && editing ? <FormulaPopover anchor={formula.anchor} value={editing.value} sourceId={sourceId} hasPage={hasPage} names={earlier.map(item => item.name)} onDone={text => { setFormula(null); set(editing.id, { value: text }); }} /> : null}
    </div>
  );
}
