import { t } from '../i18n';
import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { apply, newId } from '../data/commands';
import { report, workspace } from '../data/store';
import type { FormConfig, FormQuestion, Operation, PropertyEntity, PropertyType, ViewEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Switch } from '../ui/primitives';
import { propertyLabels } from '../data/format';
import { openWorkspaceDialog } from '../dialogs/registry';
import { Popover, type Anchor } from '../ui/overlay';
import { EditableValue, nextColor } from './values';
import { CoverPicker, EmojiPicker } from '../page/PageView';
import { defaultStatusOptions } from '../dialogs/databaseDialogs';
import { ToolbarSlot, updateView } from './shared';
import type { ViewProps } from './TableView';

// Form builder: a 600-wide column in the middle; "양식 제목" 40/700
// and "설명(선택 사항)" 16px; one card per question (600 wide, r12, padding 12, 24 apart, the chosen one
// ringed 1.25px #b6d4f3) with the question 24/700, a "응답자의 답변" box and "⋯"; "+" adds a question.
// "미리 보기" in the toolbar shows the form as a respondent sees it, and submitting adds a page.
const unsupported = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button']);
export const formSupported = (property: PropertyEntity) => !unsupported.has(property.type);

// The submit button's colour; blue is the default.
const submitColors = ['blue', 'gray', 'brown', 'orange', 'yellow', 'green', 'purple', 'pink', 'red'] as const;
type SubmitColor = typeof submitColors[number];
const submitPalette: Record<SubmitColor, string> = { blue: '#2383e2', gray: '#787774', brown: '#9f6b53', orange: '#d9730d', yellow: '#cb912f', green: '#448361', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47' };
const colorNames = (): Record<SubmitColor, string> => ({ blue: t("파란색"), gray: t("회색"), brown: t("갈색"), orange: t("주황색"), yellow: t("노란색"), green: t("초록색"), purple: t("보라색"), pink: t("분홍색"), red: t("빨간색") });
const submitStyle = (color: string | null | undefined) => color && color !== 'blue' && color in submitPalette ? { background: submitPalette[color as SubmitColor], borderColor: submitPalette[color as SubmitColor] } : undefined;

export function formQuestions(view: ViewEntity | null, properties: PropertyEntity[]): FormQuestion[] {
  const form = view?.config.form;
  if (form) return form.questions.filter(question => properties.some(property => property.id === question.propertyId));
  return properties.filter(formSupported).map(property => ({ propertyId: property.id }));
}

export function FormView({ result, view, sourceId }: ViewProps) {
  const toolbarSlot = useContext(ToolbarSlot);
  const [preview, setPreview] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: Element; propertyId?: string } | null>(null);
  const [options, setOptions] = useState<{ anchor: Anchor; propertyId: string } | null>(null);
  const properties = result.properties;
  const questions = formQuestions(view, properties);
  const form: FormConfig = { ...(view?.config.form ?? {}), title: view?.config.form?.title ?? '', description: view?.config.form?.description ?? '', questions };
  const [iconPicker, setIconPicker] = useState<Element | null>(null);
  const [coverPicker, setCoverPicker] = useState<Element | null>(null);
  const save = (patch: Partial<FormConfig>) => updateView(view, { form: { ...form, ...patch } });
  const setQuestion = (propertyId: string, patch: Partial<FormQuestion>) => save({ questions: questions.map(question => question.propertyId === propertyId ? { ...question, ...patch } : question) });
  const unused = properties.filter(property => formSupported(property) && !questions.some(question => question.propertyId === property.id));
  const toggle = (
    <button type="button" className={`db-tool form-preview-button${preview ? ' active' : ''}`} onClick={() => setPreview(!preview)}>
      <Icon name={preview ? 'pencil' : 'eye'} size={16} /><span>{preview ? t("편집") : t("미리 보기")}</span>
    </button>
  );
  // "+": an unused property, or a new property made for the question (a question can create one).
  const addNew = (type: PropertyType) => {
    const id = newId();
    const create: Operation = { type: 'property.create', id, sourceId, name: propertyLabels[type], propertyType: type, ...(type === 'status' ? { options: defaultStatusOptions() } : ['select', 'multi_select'].includes(type) ? { options: [] } : {}) } as Operation;
    apply([create, ...(view ? [{ type: 'view.update', id: view.id, config: { form: { ...form, questions: [...questions, { propertyId: id }] } } } as Operation] : [])]).then(() => setSelected(id)).catch(report);
  };
  const entries = (): MenuEntry[] => [
    ...(unused.length ? [{ kind: 'section', label: t("기존 속성") } as MenuEntry, ...unused.map(property => ({ label: property.name, icon: `type-${property.type}`, keywords: property.name, onSelect: () => { save({ questions: [...questions, { propertyId: property.id }] }); setSelected(property.id); } }) as MenuEntry)] : []),
    { kind: 'section', label: t("새 질문") } as MenuEntry,
    ...(['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'files', 'checkbox', 'url', 'email', 'phone'] as PropertyType[]).map(type => ({ label: propertyLabels[type], icon: `type-${type}`, keywords: `${propertyLabels[type]} ${type}`, onSelect: () => addNew(type) }) as MenuEntry),
  ];
  // "⋯" opens 질문 옵션 beside the card (24 to its right, top-aligned, kept on screen; it stays put while the
  // form scrolls). Clicking a card only selects it — or moves an open panel to it.
  const openOptions = (propertyId: string, card: Element) => { const rect = card.getBoundingClientRect(); setSelected(propertyId); setOptions({ anchor: { x: rect.right + 24, y: rect.top }, propertyId }); };
  const select = (propertyId: string, card: Element) => { if (options) openOptions(propertyId, card); else setSelected(propertyId); };
  // A question's title follows its property's name unless "속성 이름과 동기화" is off (then it keeps its own).
  const rename = (question: FormQuestion, property: PropertyEntity, title: string) => {
    if (question.syncName !== false) { if (title && title !== property.name) apply([{ type: 'property.update', id: property.id, name: title }]).catch(report); }
    else setQuestion(question.propertyId, { title: title || null });
  };
  return (
    <div className="form-view">
      {toolbarSlot ? createPortal(toggle, toolbarSlot) : null}
      {preview ? <FormPreview form={form} properties={properties} sourceId={sourceId} /> : (
        <div className="form-builder" onPointerDown={event => { if (!(event.target as Element).closest('.form-question')) setSelected(null); }}>
          {form.coverAttachmentId ? (
            <div className="form-cover"><img src={`/api/attachments/${encodeURIComponent(form.coverAttachmentId)}`} alt="" draggable={false} />
              <div className="page-cover-actions"><button type="button" onClick={event => setCoverPicker(event.currentTarget)}>{t("커버 변경")}</button><button type="button" onClick={() => save({ coverAttachmentId: null })}>{t("제거")}</button></div>
            </div>
          ) : null}
          {form.icon ? <button type="button" className="form-icon" aria-label={t("아이콘 변경")} onClick={event => setIconPicker(event.currentTarget)}>{form.icon}</button> : null}
          <div className="form-head-controls">
            {!form.icon ? <button type="button" className="page-control" onClick={event => setIconPicker(event.currentTarget)}><Icon name="emoji" size={14} />{t("아이콘 추가")}</button> : null}
            {!form.coverAttachmentId ? <button type="button" className="page-control" onClick={event => setCoverPicker(event.currentTarget)}><Icon name="image" size={14} />{t("커버 추가")}</button> : null}
          </div>
          <FormText className="form-builder-title" value={form.title ?? ''} placeholder={t("양식 제목")} onSave={title => save({ title })} />
          <FormText className="form-builder-description" value={form.description ?? ''} placeholder={t("설명(선택 사항)")} onSave={description => save({ description })} />
          {questions.map(question => {
            const property = properties.find(item => item.id === question.propertyId)!;
            return (
              <div key={question.propertyId} className={`form-question${selected === question.propertyId ? ' selected' : ''}`} onPointerDown={event => { if (!(event.target as Element).closest('.form-question-more')) select(question.propertyId, event.currentTarget); }}>
                <div className="form-question-head">
                  <FormText className="form-question-title" value={question.syncName !== false ? property.name : question.title ?? property.name} placeholder={property.name} onSave={title => rename(question, property, title)} />
                  {question.required ? <span className="form-question-required" aria-label={t("필수")}>*</span> : null}
                  <button type="button" className="form-question-more" aria-label={t("질문 옵션")} onClick={event => { const card = (event.currentTarget as Element).closest('.form-question'); if (card) openOptions(question.propertyId, card); }}><Icon name="more" size={16} /></button>
                </div>
                <ConditionNote question={question} questions={questions} properties={properties} />
                {question.description != null ? <FormText className="form-question-description" value={question.description} placeholder={t("설명 추가")} onSave={description => setQuestion(question.propertyId, { description })} /> : null}
                {multiple(property) ? <div className="form-question-note">{t("(응답자는 여러 개 선택 가능)")}</div> : null}
                <AnswerSample property={property} question={question} />
              </div>
            );
          })}
          <button type="button" className="form-add-question" aria-label={t("질문 추가")} title={t("질문 추가")} onClick={event => setMenu({ anchor: event.currentTarget })}><Icon name="plus" size={16} /></button>
          {/* The submit button's words and colour, and what shows after submitting — a title and a message
              (submission settings). */}
          <div className="form-submit-settings">
            <div className="form-submit-edit blue-button form-submit" style={submitStyle(form.submitColor)}><FormText className="form-submit-label" value={form.submitLabel ?? ''} placeholder={t("제출")} onSave={submitLabel => save({ submitLabel: submitLabel || null })} /></div>
            <div className="form-submit-colors" role="radiogroup" aria-label={t("버튼 색")}>
              {submitColors.map(color => <button type="button" key={color} role="radio" aria-checked={(form.submitColor ?? 'blue') === color} aria-label={colorNames()[color]} title={colorNames()[color]} className={`form-submit-color${(form.submitColor ?? 'blue') === color ? ' active' : ''}`} style={{ background: submitPalette[color] }} onClick={() => save({ submitColor: color === 'blue' ? null : color })} />)}
            </div>
            <label className="form-confirmation-field"><span>{t("제출 후 제목")}</span><FormText className="form-confirmation-title" value={form.confirmationTitle ?? ''} placeholder={t("응답을 제출했습니다")} onSave={confirmationTitle => save({ confirmationTitle: confirmationTitle || null })} /></label>
            <label className="form-confirmation-field"><span>{t("제출 후 메시지")}</span><FormText className="form-confirmation" value={form.confirmation ?? ''} placeholder={t("응답해 주셔서 감사합니다")} onSave={confirmation => save({ confirmation: confirmation || null })} /></label>
          </div>
        </div>
      )}
      {menu ? <Menu anchor={menu.anchor} placement="below-center" width={260} search={t("속성 검색…")} entries={entries()} onClose={() => setMenu(null)} /> : null}
      {iconPicker ? <EmojiPicker anchor={iconPicker} onClose={() => setIconPicker(null)} onPick={icon => save({ icon })} onRemove={form.icon ? () => save({ icon: null }) : undefined} /> : null}
      {coverPicker ? <CoverPicker anchor={coverPicker} current={form.coverAttachmentId ?? null} onSet={async coverAttachmentId => { await save({ coverAttachmentId }); }} onClose={() => setCoverPicker(null)} /> : null}
      {options && !preview ? (() => {
        const question = questions.find(item => item.propertyId === options.propertyId);
        const property = properties.find(item => item.id === options.propertyId);
        if (!question || !property) return null;
        const index = questions.indexOf(question);
        return <QuestionOptions anchor={options.anchor} question={question} property={property} first={index === 0} last={index === questions.length - 1} sourceId={sourceId}
          later={questions.slice(index + 1).map(item => ({ question: item, property: properties.find(entry => entry.id === item.propertyId)! })).filter(item => item.property)}
          onChange={patch => setQuestion(question.propertyId, patch)}
          onMove={step => { const next = [...questions]; next.splice(index + step, 0, ...next.splice(index, 1)); save({ questions: forwardOnly(next) }); }}
          onDuplicate={() => {
            // A copy of the property (same type and settings) asked right after this one.
            const id = newId();
            const copy: Record<string, unknown> = { type: 'property.create', id, sourceId, name: t("{0} (사본)", [property.name]), propertyType: property.type };
            for (const key of ['options', 'targetSourceId', 'relationLimit', 'numberFormat']) if ((property as unknown as Record<string, unknown>)[key] != null) copy[key] = structuredClone((property as unknown as Record<string, unknown>)[key]);
            if (Array.isArray(copy.options)) copy.options = (copy.options as { id: string }[]).map(option => ({ ...option, id: newId() }));
            const next = [...questions]; next.splice(index + 1, 0, { ...question, propertyId: id, title: question.syncName === false ? question.title : null });
            apply([copy as never, ...(view ? [{ type: 'view.update', id: view.id, config: { form: { ...form, questions: next } } } as never] : [])]).catch(report);
          }}
          onDelete={() => { setOptions(null); save({ questions: withoutTarget(questions.filter(item => item.propertyId !== question.propertyId), question.propertyId) }); }}
          onClose={() => { setOptions(null); setSelected(null); }} />;
      })() : null}
    </div>
  );
}

function FormText({ value, placeholder, className, onSave }: { value: string; placeholder: string; className: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <textarea className={`form-text ${className}`} rows={1} value={shown} placeholder={placeholder} aria-label={placeholder}
      ref={element => { if (element) { element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`; } }}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => { if (draft !== null && draft !== value) onSave(draft.trim()); setDraft(null); }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); (event.target as HTMLTextAreaElement).blur(); } }} />
  );
}

// Answers as the builder shows them: a 38-high box ringed rgb(240,239,237) with the
// placeholder 16px rgb(188,186,182) — 8 under the title area for typed answers, flush for pickers (날짜 · 사람 ·
// 위치, a ⇕ at the right); options as rows 32 apart (a 15px ring box or circle, the name 16px, editable) and
// "+ 옵션 추가"; files a faded "업로드" button with the size limits beside it.
const multiple = (property: PropertyEntity) => property.type === 'multi_select' || property.type === 'person';
function AnswerSample({ property, question }: { property: PropertyEntity; question: FormQuestion }) {
  if (property.type === 'checkbox') return <div className="form-answer-check"><span className="form-checkbox" /><span>{t("체크박스 레이블(선택 사항)")}</span></div>;
  if (['select', 'status', 'multi_select'].includes(property.type)) {
    if (question.optionDisplay === 'dropdown') return <div className="form-answer-box picker"><span>{t("옵션 선택")}</span><Icon name="selector" size={16} /></div>;
    return <OptionRows property={property} />;
  }
  if (property.type === 'files') return <div className="form-answer-upload"><span className="form-upload-button"><Icon name="upload" size={16} /><span>{t("업로드")}</span></span><span className="form-upload-limits">{t("파일 크기: 최대 100MB / 파일 수: 최대 20개 파일")}</span></div>;
  if (['date', 'person', 'relation', 'place'].includes(property.type)) return <div className={`form-answer-box picker${property.type === 'place' ? ' offset' : ''}`}><span>{t("응답자의 답변")}</span><Icon name="selector" size={16} /></div>;
  return <div className={`form-answer-box${question.longAnswer ? ' long' : ''}`}>{t("응답자의 답변")}</div>;
}

// The option list in the builder: names edit in place (renaming the option), "+ 옵션 추가" adds one.
function OptionRows({ property }: { property: PropertyEntity }) {
  const [adding, setAdding] = useState(false);
  const options = property.options ?? [];
  const save = (next: typeof options) => apply([{ type: 'property.update', id: property.id, options: next }]).catch(report);
  const box = property.type === 'multi_select' ? 'form-checkbox' : 'form-radio';
  return (
    <div className="form-answer-options">
      {options.map(option => (
        <div key={option.id} className="form-answer-option"><span className={box} />
          <input className="form-option-name" defaultValue={option.name} aria-label={t("옵션 이름")} key={option.name}
            onBlur={event => { const name = event.target.value.trim(); if (name && name !== option.name) save(options.map(item => item.id === option.id ? { ...item, name } : item)); else event.target.value = option.name; }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) (event.target as HTMLInputElement).blur(); }} />
        </div>
      ))}
      {property.type !== 'status' ? (adding ? (
        <div className="form-answer-option"><span className={box} />
          <input className="form-option-name" autoFocus placeholder={t("옵션 이름")} aria-label={t("새 옵션")}
            onBlur={event => { const name = event.target.value.trim(); setAdding(false); if (name) save([...options, { id: newId(), name, color: nextColor(options) }]); }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') { (event.target as HTMLInputElement).value = ''; (event.target as HTMLInputElement).blur(); } }} />
        </div>
      ) : <button type="button" className="form-add-option" onClick={() => setAdding(true)}><Icon name="plus" size={13} /><span>{t("옵션 추가")}</span></button>) : null}
    </div>
  );
}

// "질문 옵션": a 290-wide panel 24 to the right of the card — 필수 · 설명 · 긴 답변 (typed
// answers) · 옵션 표시 방법 (options) · 최대 선택 수 (several answers), then 질문 유형 (the property type; changing it
// converts the property) · 연결된 속성 보기 · 속성 이름과 동기화, then 질문 이동 · 질문 복제 · 질문 삭제.
const questionTypes: { type: PropertyType; label: string }[] = [
  { type: 'text', label: t("텍스트") }, { type: 'select', label: t("객관식") }, { type: 'date', label: t("날짜") }, { type: 'person', label: t("사람") },
  { type: 'files', label: t("파일과 미디어") }, { type: 'number', label: t("숫자") }, { type: 'checkbox', label: t("체크박스") }, { type: 'email', label: t("이메일") },
  { type: 'url', label: 'URL' }, { type: 'phone', label: t("전화번호") }, { type: 'place', label: t("위치") },
];
const questionTypeOf = (type: PropertyType): PropertyType => type === 'multi_select' || type === 'status' ? 'select' : type;
const questionTypeLabel = (type: PropertyType) => type === 'title' ? t("제목") : questionTypes.find(item => item.type === questionTypeOf(type))?.label ?? propertyLabels[type];
const maxChoices = [1, 2, 3, 4, 5, 10];

function QuestionOptions({ anchor, question, property, first, last, sourceId, later, onChange, onMove, onDuplicate, onDelete, onClose }: {
  anchor: Anchor; question: FormQuestion; property: PropertyEntity; first: boolean; last: boolean; sourceId: string; later: Array<{ question: FormQuestion; property: PropertyEntity }>;
  onChange: (patch: Partial<FormQuestion>) => void; onMove: (step: number) => void; onDuplicate: () => void; onDelete: () => void; onClose: () => void;
}) {
  const [sub, setSub] = useState<{ kind: 'move' | 'type' | 'display' | 'max' | 'logic'; anchor: Element } | null>(null);
  const textual = ['title', 'text'].includes(property.type); // 긴 답변 is offered for text answers only
  const choice = ['select', 'multi_select', 'status'].includes(property.type);
  const isTitle = property.type === 'title';
  const toggle = (icon: string, label: string, checked: boolean, change: (value: boolean) => void) => (
    <label className="chart-card-row"><Icon name={icon} size={18} /><span>{label}</span><Switch checked={checked} onChange={change} label={label} /></label>
  );
  const opener = (kind: 'move' | 'type' | 'display' | 'max' | 'logic', icon: string, label: string, value?: string) => (
    <button type="button" className={`chart-card-row${sub?.kind === kind ? ' open' : ''}`} onClick={event => setSub(sub?.kind === kind ? null : { kind, anchor: event.currentTarget })}>
      <Icon name={icon} size={18} /><span>{label}</span>{value != null ? <span className="chart-card-value">{value}</span> : null}<Icon name={sub?.kind === kind && kind !== 'move' ? 'chevron-down' : 'chevron-right'} size={14} />
    </button>
  );
  const convert = (type: PropertyType) => {
    if (questionTypeOf(property.type) === type) return;
    apply([{ type: 'property.convert', id: property.id, propertyType: type, fromType: property.type }]).catch(report);
  };
  const subMenu = () => {
    if (!sub) return null;
    const close = () => setSub(null);
    if (sub.kind === 'logic') return <LogicPanel anchor={sub.anchor} question={question} property={property} later={later} onChange={logic => onChange({ logic })} onClose={close} />;
    if (sub.kind === 'move') return <Menu anchor={sub.anchor} placement="right-start" width={180} onClose={close} entries={[{ label: t("위로 이동"), icon: 'arrow-up', disabled: first, onSelect: () => onMove(-1) }, { label: t("아래로 이동"), icon: 'arrow-down', disabled: last, onSelect: () => onMove(1) }]} />;
    if (sub.kind === 'type') return <Menu anchor={sub.anchor} placement="below-end" offset={0} width={250} className="question-type-menu" onClose={close} label={t("질문 유형")}
      entries={questionTypes.map(item => ({ label: item.label, icon: <span className="question-type-box"><Icon name={`type-${item.type}`} size={20} /></span>, checked: questionTypeOf(property.type) === item.type, onSelect: () => convert(item.type) }))} />;
    if (sub.kind === 'display') return <Menu anchor={sub.anchor} placement="below-end" offset={0} width={250} onClose={close} label={t("옵션 표시 방법")}
      entries={[{ label: t("목록 보기"), checked: question.optionDisplay !== 'dropdown', onSelect: () => onChange({ optionDisplay: 'list' }) }, { label: t("드롭다운"), checked: question.optionDisplay === 'dropdown', onSelect: () => onChange({ optionDisplay: 'dropdown' }) }]} />;
    return <Menu anchor={sub.anchor} placement="below-end" offset={0} width={250} onClose={close} label={t("최대 선택 수")}
      entries={[{ label: 'Unlimited', checked: question.maxSelections == null, onSelect: () => onChange({ maxSelections: null }) },
        ...maxChoices.map(count => ({ label: String(count), checked: question.maxSelections === count, onSelect: () => onChange({ maxSelections: count }) })),
        { kind: 'custom' as const, render: closeAll => <input className="form-max-custom" type="number" min={1} placeholder={t("사용자 지정")} aria-label={t("사용자 지정")} defaultValue={question.maxSelections != null && !maxChoices.includes(question.maxSelections) ? question.maxSelections : undefined}
          onKeyDown={event => { if (event.key === 'Enter') { const value = Math.floor(Number((event.target as HTMLInputElement).value)); if (value >= 1) { onChange({ maxSelections: value }); closeAll(); } } }} /> }]} />;
  };
  return (
    <Popover anchor={anchor} placement="point" onClose={onClose} className="form-options" style={{ width: 290 }} label={t("질문 옵션")}>
      <div className="form-options-head"><span>{t("질문 옵션")}</span><button type="button" className="settings-close" aria-label={t("닫기")} onClick={onClose}><Icon name="close" size={12} /></button></div>
      {toggle('asterisk', t("필수"), !!question.required, value => onChange({ required: value }))}
      {toggle('caption', t("설명"), question.description != null, value => onChange({ description: value ? '' : null }))}
      {textual ? toggle('fit-width', t("긴 답변"), !!question.longAnswer, value => onChange({ longAnswer: value })) : null}
      {choice ? opener('display', 'option-list', t("옵션 표시 방법"), question.optionDisplay === 'dropdown' ? t("드롭다운") : t("목록 보기")) : null}
      {multiple(property) ? opener('max', 'hash', t("최대 선택 수"), question.maxSelections == null ? 'Unlimited' : String(question.maxSelections)) : null}
      {branching(property) ? opener('logic', 'dependency', question.logic?.length ? t("조건부 로직") : t("조건부 로직 추가"), question.logic?.length ? t("{0}개", [question.logic.length]) : undefined) : null}
      <div className="form-options-sep" />
      {isTitle
        ? <div className="chart-card-row static"><Icon name="question-type" size={18} /><span>{t("질문 유형")}</span><span className="chart-card-value">{questionTypeLabel(property.type)}</span></div>
        : opener('type', 'question-type', t("질문 유형"), questionTypeLabel(property.type))}
      <button type="button" className="chart-card-row" onClick={() => { onClose(); openWorkspaceDialog('property', { sourceId, propertyId: property.id }); }}><Icon name="database" size={18} /><span>{t("연결된 속성 보기")}</span><Icon name="chevron-right" size={14} /></button>
      {toggle('swap', t("속성 이름과 동기화"), question.syncName !== false, value => onChange({ syncName: value, ...(value ? { title: null } : { title: property.name }) }))}
      <div className="form-options-sep" />
      {opener('move', 'move', t("질문 이동"))}
      {!isTitle ? <button type="button" className="chart-card-row" onClick={() => { onClose(); onDuplicate(); }}><Icon name="duplicate" size={18} /><span>{t("질문 복제")}</span></button> : null}
      <button type="button" className="chart-card-row danger" onClick={onDelete}><Icon name="trash" size={18} /><span>{t("질문 삭제")}</span></button>
      {subMenu()}
    </Popover>
  );
}

function FormPreview({ form, properties, sourceId }: { form: FormConfig; properties: PropertyEntity[]; sourceId: string }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const title = properties.find(property => property.type === 'title');
  const shown = visibleQuestions(form.questions, properties, values);
  const submit = async () => {
    const lacking = form.questions.filter(question => shown.has(question.propertyId) && question.required && (values[question.propertyId] == null || values[question.propertyId] === '' || values[question.propertyId] === false || (Array.isArray(values[question.propertyId]) && !(values[question.propertyId] as unknown[]).length))).map(question => question.propertyId);
    setMissing(lacking);
    if (lacking.length) return;
    const id = newId();
    const operations: Operation[] = [{ type: 'page.create', id, sourceId, title: title && shown.has(title.id) ? String(values[title.id] ?? '') : '' }];
    for (const [propertyId, value] of Object.entries(values)) {
      const property = properties.find(item => item.id === propertyId);
      if (!property || property.type === 'title' || value == null || !shown.has(propertyId)) continue;
      operations.push(property.type === 'relation' ? { type: 'relation.set', pageId: id, propertyId, targetIds: value as string[] } : { type: 'value.set', pageId: id, propertyId, value });
    }
    await apply(operations);
    setValues({}); setDone(true);
  };
  if (done) return <div className="form-builder form-preview"><div className="form-done"><Icon name="check" size={28} /><h3>{form.confirmationTitle || (form.confirmationTitle == null && form.confirmation) || t("응답을 제출했습니다")}</h3>{form.confirmationTitle && form.confirmation ? <p className="form-done-message">{form.confirmation}</p> : null}<button type="button" className="outline-button small" onClick={() => setDone(false)}>{t("다른 응답 제출")}</button></div></div>;
  return (
    <form className="form-builder form-preview" onSubmit={event => { event.preventDefault(); submit().catch(report); }}>
      {form.coverAttachmentId ? <div className="form-cover"><img src={`/api/attachments/${encodeURIComponent(form.coverAttachmentId)}`} alt="" draggable={false} /></div> : null}
      {form.icon ? <div className="form-icon static">{form.icon}</div> : null}
      <h1 className="form-preview-title">{form.title || t("제목 없는 양식")}</h1>
      {form.description ? <p className="form-preview-description">{form.description}</p> : null}
      {form.questions.map(question => {
        const property = properties.find(item => item.id === question.propertyId);
        if (!property || !shown.has(property.id)) return null;
        return (
          <div key={property.id} className={`form-question preview${missing.includes(property.id) ? ' missing' : ''}`}>
            <div className="form-question-head"><span className="form-question-title static">{question.title || property.name}</span>{question.required ? <span className="form-question-required">*</span> : null}</div>
            {question.description ? <p className="form-question-description static">{question.description}</p> : null}
            {question.longAnswer && ['title', 'text'].includes(property.type) ? (
              <textarea className="form-answer-input long" rows={3} placeholder={t("답변 입력")} value={String(values[property.id] ?? '')} onChange={event => setValues({ ...values, [property.id]: event.target.value })} />
            ) : ['title', 'text', 'number', 'url', 'email', 'phone'].includes(property.type) ? (
              <input className="form-answer-input" type={property.type === 'number' ? 'number' : property.type === 'email' ? 'email' : 'text'} placeholder={t("답변 입력")} value={String(values[property.id] ?? '')}
                onChange={event => setValues({ ...values, [property.id]: property.type === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value })} />
            ) : ['select', 'multi_select', 'status'].includes(property.type) && question.optionDisplay !== 'dropdown' ? (
              <ChoiceList property={property} value={values[property.id]} max={question.maxSelections ?? null} onChange={value => setValues({ ...values, [property.id]: value })} />
            ) : <EditableValue pageId="" property={property} value={values[property.id] ?? (property.type === 'checkbox' ? false : null)} onChange={value => setValues({ ...values, [property.id]: Array.isArray(value) && question.maxSelections != null ? value.slice(0, question.maxSelections) : value })} placeholder={t("선택")} className="form-answer-value" />}
            {missing.includes(property.id) ? <div className="form-missing">{t("필수 질문입니다")}</div> : null}
          </div>
        );
      })}
      <button type="submit" className="blue-button form-submit" style={submitStyle(form.submitColor)}>{form.submitLabel || t("제출")}</button>
    </form>
  );
}

// A respondent's choice: one option (radio) or several (checkboxes, up to 최대 선택 수).
function ChoiceList({ property, value, max, onChange }: { property: PropertyEntity; value: unknown; max: number | null; onChange: (value: unknown) => void }) {
  const many = property.type === 'multi_select';
  const chosen = Array.isArray(value) ? value as string[] : typeof value === 'string' ? [value] : [];
  const pick = (id: string) => {
    if (!many) { onChange(chosen[0] === id ? null : id); return; }
    if (chosen.includes(id)) onChange(chosen.filter(item => item !== id));
    else if (max == null || chosen.length < max) onChange([...chosen, id]);
  };
  return (
    <div className="form-answer-options" role={many ? 'group' : 'radiogroup'}>
      {(property.options ?? []).map(option => (
        <div key={option.id} className="form-answer-option" role={many ? 'checkbox' : 'radio'} aria-checked={chosen.includes(option.id)} tabIndex={0}
          onClick={() => pick(option.id)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); pick(option.id); } }}>
          <span className={`${many ? 'form-checkbox' : 'form-radio'}${chosen.includes(option.id) ? ' on' : ''}`} /><span>{option.name}</span>
        </div>
      ))}
    </div>
  );
}

// Asked when a form view is made: make one question per supported property, or start empty.
export function FormQuestionsDialog({ viewId, onClose }: { viewId: string; onClose: () => void }) {
  const view = workspace.get<ViewEntity>(viewId);
  const properties = view ? workspace.schema(view.sourceId) : [];
  const supported = properties.filter(formSupported);
  const title = properties.find(property => property.type === 'title');
  const choose = (all: boolean) => {
    onClose();
    if (view) updateView(view, { form: { title: '', description: '', questions: (all ? supported : title ? [title] : []).map(property => ({ propertyId: property.id })) } });
  };
  return (
    <Popover anchor={{ x: window.innerWidth / 2 - 180, y: window.innerHeight / 2 - 100 }} placement="point" onClose={() => choose(false)} modal className="form-questions-dialog" label={t("양식 질문 만들기")} style={{ width: 360 }}>
      <div className="form-questions-title">{t("기존 속성을 바탕으로 양식 질문을 자동으로 만들까요?")}</div>
      <div className="form-questions-text">{t("지원되는 속성 유형으로만 새 질문을 만듭니다.")}</div>
      <button type="button" className="form-questions-ok" autoFocus onClick={() => choose(true)}>{t("질문 {0}개 만들기", [supported.length])}</button>
      <button type="button" className="form-questions-cancel" onClick={() => choose(false)}>{t("처음부터 만들기")}</button>
    </Popover>
  );
}

// 조건부 로직: a choice or checkbox
// question can show later questions only when the respondent picks a given answer. A question some rule points
// at stays hidden until one of those rules matches; hidden questions are neither required nor submitted.
const branching = (property: PropertyEntity) => ['select', 'multi_select', 'status', 'checkbox'].includes(property.type);
const answered = (answer: unknown, value: unknown) => Array.isArray(answer) ? answer.includes(value) : (answer ?? false) === value;

export function visibleQuestions(questions: FormQuestion[], properties: PropertyEntity[], values: Record<string, unknown>): Set<string> {
  const rulesFor = new Map<string, Array<{ source: string; value: unknown }>>();
  const counts = (id: string) => { const property = properties.find(item => item.id === id); return !!property && branching(property); };
  for (const question of questions) if (counts(question.propertyId)) for (const rule of question.logic ?? []) for (const target of rule.show) {
    if (!rulesFor.has(target)) rulesFor.set(target, []);
    rulesFor.get(target)!.push({ source: question.propertyId, value: rule.value });
  }
  const memo = new Map<string, boolean>();
  const visible = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, false); // a loop of rules shows nothing
    const rules = rulesFor.get(id);
    const result = !rules || rules.some(rule => visible(rule.source) && answered(values[rule.source], rule.value));
    memo.set(id, result);
    return result;
  };
  return new Set(questions.map(question => question.propertyId).filter(visible));
}

// Rules only point forward: after a move, a question that now comes first is no longer a target of the later one.
function forwardOnly(questions: FormQuestion[]): FormQuestion[] {
  return questions.map((question, index) => question.logic ? { ...question, logic: question.logic.map(rule => ({ ...rule, show: rule.show.filter(id => questions.findIndex(item => item.propertyId === id) > index) })).filter(rule => rule.show.length) } : question);
}
function withoutTarget(questions: FormQuestion[], propertyId: string): FormQuestion[] {
  return questions.map(question => question.logic ? { ...question, logic: question.logic.map(rule => ({ ...rule, show: rule.show.filter(id => id !== propertyId) })).filter(rule => rule.show.length) } : question);
}

function answerLabel(property: PropertyEntity, value: unknown) {
  if (property.type === 'checkbox') return value === true ? t("선택됨") : t("선택 안 됨");
  return property.options?.find(option => option.id === value)?.name ?? t("삭제된 옵션");
}
function answerChoices(property: PropertyEntity): Array<{ value: unknown; label: string }> {
  if (property.type === 'checkbox') return [{ value: true, label: t("선택됨") }, { value: false, label: t("선택 안 됨") }];
  return (property.options ?? []).map(option => ({ value: option.id, label: option.name }));
}

// Under a question that only shows conditionally: which answer shows it.
function ConditionNote({ question, questions, properties }: { question: FormQuestion; questions: FormQuestion[]; properties: PropertyEntity[] }) {
  const reasons = questions.flatMap(source => (source.logic ?? []).filter(rule => rule.show.includes(question.propertyId)).map(rule => {
    const property = properties.find(item => item.id === source.propertyId);
    return property ? t("'{0}'에서 '{1}'", [source.syncName !== false ? property.name : source.title || property.name, answerLabel(property, rule.value)]) : null;
  })).filter(Boolean);
  if (!reasons.length) return null;
  return <div className="form-question-condition"><Icon name="dependency" size={14} /><span>{t("{0}을(를) 선택하면 표시", [reasons.join(t(" 또는 "))])}</span></div>;
}

function LogicPanel({ anchor, question, property, later, onChange, onClose }: { anchor: Element; question: FormQuestion; property: PropertyEntity; later: Array<{ question: FormQuestion; property: PropertyEntity }>; onChange: (logic: FormQuestion['logic']) => void; onClose: () => void }) {
  const rules = question.logic ?? [];
  const [menu, setMenu] = useState<{ kind: 'value' | 'show'; index: number; anchor: Element } | null>(null);
  const choices = answerChoices(property);
  const name = (item: { question: FormQuestion; property: PropertyEntity }) => item.question.syncName !== false ? item.property.name : item.question.title || item.property.name;
  const set = (index: number, patch: Partial<{ value: unknown; show: string[] }>) => onChange(rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  const add = () => { if (choices.length && later.length) onChange([...rules, { value: choices.find(choice => !rules.some(rule => rule.value === choice.value))?.value ?? choices[0].value, show: [later[0].question.propertyId] }]); };
  return (
    <Popover anchor={anchor} placement="right-start" onClose={onClose} className="form-logic" style={{ width: 320 }} label={t("조건부 로직")}>
      <div className="form-options-head"><span>{t("조건부 로직")}</span></div>
      <p className="form-logic-text">{t("응답자가 고른 답변에 따라 뒤에 있는 질문을 표시합니다. 조건에 걸린 질문은 조건이 맞을 때까지 숨겨집니다.")}</p>
      {rules.map((rule, index) => {
        const shown = rule.show.map(id => later.find(item => item.question.propertyId === id)).filter((item): item is { question: FormQuestion; property: PropertyEntity } => !!item);
        return (
          <div key={index} className="form-logic-rule">
            <div className="form-logic-line"><span className="form-logic-word">{t("답변이")}</span>
              <button type="button" className="form-logic-pick" onClick={event => setMenu({ kind: 'value', index, anchor: event.currentTarget })}><span>{answerLabel(property, rule.value)}</span><Icon name="chevron-down" size={10} /></button>
              <span className="form-logic-word">{t("이면")}</span><span className="spacer" />
              <button type="button" className="ccolor-remove" aria-label={t("조건 삭제")} title={t("삭제")} onClick={() => onChange(rules.filter((_, i) => i !== index))}><Icon name="trash" size={14} /></button>
            </div>
            <div className="form-logic-line"><span className="form-logic-word">{t("표시")}</span>
              <button type="button" className={`form-logic-pick wide${shown.length ? '' : ' empty'}`} onClick={event => setMenu({ kind: 'show', index, anchor: event.currentTarget })}><span>{shown.length ? shown.map(name).join(', ') : t("질문 선택…")}</span><Icon name="chevron-down" size={10} /></button>
            </div>
          </div>
        );
      })}
      {later.length ? <button type="button" className="ccolor-more form-logic-add" disabled={!choices.length} onClick={add}><Icon name="plus" size={14} /><span>{t("조건 추가")}</span></button>
        : <p className="form-logic-text muted">{t("이 질문 뒤에 질문이 있어야 조건을 만들 수 있습니다.")}</p>}
      {menu?.kind === 'value' ? <Menu anchor={menu.anchor} placement="below-start" width={200} onClose={() => setMenu(null)}
        entries={choices.map(choice => ({ label: choice.label, checked: rules[menu.index]?.value === choice.value, onSelect: () => set(menu.index, { value: choice.value }) }))} /> : null}
      {menu?.kind === 'show' ? <Menu anchor={menu.anchor} placement="below-start" width={240} onClose={() => setMenu(null)}
        entries={later.map(item => {
          const on = rules[menu.index]?.show.includes(item.question.propertyId);
          return { label: name(item), icon: `type-${item.property.type}`, checked: on, keepOpen: true, onSelect: () => {
            const show = rules[menu.index].show;
            const next = on ? show.filter(id => id !== item.question.propertyId) : [...show, item.question.propertyId];
            if (next.length) set(menu.index, { show: next });
          } };
        })} /> : null}
    </Popover>
  );
}
