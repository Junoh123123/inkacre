import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { apply, newId } from '../data/commands';
import { navigate } from '../data/router';
import { setStatus, workspace, useWorkspace } from '../data/store';
import { PagePicker } from './pageDialogs';
import { blockLabels, plainText } from '../data/format';
import type { BlockEntity, ButtonDefinition, Filter, PageEntity, PropertyEntity, SourceEntity } from '../data/types';
import { confirmDialog } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { EditableValue, readOnlyTypes } from '../database/values';
import { FilterEditor } from './filters';
import { TokenField, ValueSource, VariablesEditor, type Variable } from '../database/AutomationVariables';

// Running buttons (block buttons and button properties) and editing their actions.

export async function runButton(owner: BlockEntity | PropertyEntity, pageId?: string) {
  const button = owner.button;
  const revision = workspace.revision;
  const external = (button?.actions ?? []).filter(action => String(action.action).startsWith('send_'));
  if (button?.confirmation || external.length) {
    const ok = await confirmDialog(t("버튼 실행 확인"), (
      <div className="button-confirm">
        <p>{button?.confirmation || t("외부로 보내는 작업이 있습니다. 실행할까요?")}</p>
        {external.map((action, index) => <p key={index} className="muted">{action.action === 'send_email' ? t("받는 사람: {0} · 제목: {1}", [action.to, action.subject]) : t("수신 URL: {0}", [action.url])}</p>)}
      </div>
    ), { confirmLabel: t("실행") });
    if (!ok) return;
  }
  const result = await apply([{ type: 'button.run', id: owner.id, ...(pageId ? { pageId } : {}), confirmed: true }], { revision });
  for (const url of result.openUrls ?? []) window.open(url, '_blank', 'noopener,noreferrer');
  if (result.opens?.length) navigate(result.opens[result.opens.length - 1]);
}

type Action = Record<string, unknown> & { action: string };

const actionLabels: Record<string, string> = {
  set_property: t("속성 편집"), add_page: t("페이지 추가"), edit_pages: t("조건에 맞는 페이지 편집"), insert_blocks: t("블록 삽입"), open_page: t("페이지 열기"), open_url: t("URL 열기"),
  notify: t("알림 보내기"), send_webhook: t("Webhook 보내기"), send_email: t("이메일 보내기"), define_variables: t("변수 정의"),
};

const actionIcons: Record<string, string> = {
  set_property: 'property-edit', add_page: 'page', edit_pages: 'pencil', insert_blocks: 'plus', open_page: 'arrow-up-right', open_url: 'globe', notify: 'bell', send_webhook: 'link', send_email: 'arrow-right', define_variables: 'variable',
};
// A fresh action of a kind (변수 정의 starts with one variable).
const freshAction = (kind: string): Action => kind === 'define_variables' ? { action: kind, variables: [{ id: newId(), name: t("변수 {0}", [1]), mode: 'text', value: '' }] } : { action: kind };

const writable = (sourceId: string | null | undefined) => workspace.schema(sourceId ?? '').filter(property => !readOnlyTypes.has(property.type) && !['button', 'files'].includes(property.type));

// variant "panel": inside the button block's own settings panel, which has the name itself —
// the actions as cards, then "+ 새 작업" and the confirmation line.
export function ButtonEditor({ value, sourceId, onChange, variant = 'dialog' }: { value: ButtonDefinition; sourceId?: string | null; onChange: (value: ButtonDefinition) => void; variant?: 'dialog' | 'panel' }) {
  const ws = useWorkspace();
  const sources = ws.sources() as SourceEntity[];
  const pages = useMemo(() => ws.snapshot.objects.filter(item => item.kind === 'page' && !(item as PageEntity).template && ws.visible(item.id)) as PageEntity[], [ws.version]);
  const [addMenu, setAddMenu] = useState<Element | null>(null);
  const set = (patch: Partial<ButtonDefinition>) => onChange({ ...value, ...patch });
  const setAction = (index: number, action: Action) => set({ actions: value.actions.map((item, i) => i === index ? action : item) });
  const remove = (index: number) => set({ actions: value.actions.filter((_, i) => i !== index) });
  const move = (index: number, delta: number) => {
    const list = [...value.actions];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    set({ actions: list });
  };
  const targetOptions = [{ id: '$this', name: t("이 페이지") }, { id: '$created', name: t("앞에서 만든 페이지") }, ...pages.map(page => ({ id: page.id, name: page.title || t("새 페이지") }))];
  return (
    <div className={`button-editor${variant === 'panel' ? ' panel' : ''}`}>
      {variant === 'dialog' ? <label className="field"><span>{t("버튼 이름")}</span><input className="text-input" value={value.label} onChange={event => set({ label: event.target.value })} /></label> : null}
      {variant === 'dialog' ? <label className="field"><span>{t("실행 전 확인 문구 (선택)")}</span><input className="text-input" value={value.confirmation ?? ''} placeholder={t("비워 두면 바로 실행")} onChange={event => set({ confirmation: event.target.value || null })} /></label> : null}
      <div className="button-actions">
        {value.actions.map((action, index) => {
          const kind = action.action;
          const actionSource = kind === 'edit_pages' || kind === 'add_page' ? String(action.sourceId ?? sourceId ?? sources[0]?.id ?? '') : action.targetId === '$created' ? String(action.sourceId ?? sources[0]?.id ?? '') : action.targetId && action.targetId !== '$this' ? workspace.get<PageEntity>(String(action.targetId))?.sourceId ?? '' : sourceId ?? '';
          const properties = writable(actionSource);
          const property = properties.find(item => item.id === action.propertyId);
          // Variables from earlier 변수 정의 actions; a button property's page gives @ mentions its properties.
          const earlier = value.actions.slice(0, index).flatMap(item => item.action === 'define_variables' ? (item.variables as Variable[]) : []);
          const tokenSource = sourceId ?? '', hasPage = !!sourceId;
          const isRef = (raw: unknown) => !!raw && typeof raw === 'object' && !Array.isArray(raw) && ('$variable' in (raw as object) || '$formula' in (raw as object));
          return (
            <div key={index} className="button-action">
              <div className="button-action-head">
                <span className="button-action-index">{index + 1}</span>
                <select className="text-input" value={kind} onChange={event => setAction(index, freshAction(event.target.value))}>
                  {Object.entries(actionLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <button type="button" className="icon-button small" aria-label={t("위로")} onClick={() => move(index, -1)}><Icon name="arrow-up" size={14} /></button>
                <button type="button" className="icon-button small" aria-label={t("아래로")} onClick={() => move(index, 1)}><Icon name="arrow-down" size={14} /></button>
                <button type="button" className="icon-button small" aria-label={t("작업 삭제")} onClick={() => remove(index)}><Icon name="trash" size={14} /></button>
              </div>
              {kind === 'set_property' || kind === 'edit_pages' ? (
                <div className="button-action-body">
                  {kind === 'edit_pages' ? (
                    <label className="field"><span>{t("데이터베이스")}</span><select className="text-input" value={actionSource} onChange={event => setAction(index, { ...action, sourceId: event.target.value, propertyId: undefined, value: undefined, filter: undefined })}>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                  ) : (
                    <label className="field"><span>{t("대상 페이지")}</span><select className="text-input" value={String(action.targetId ?? '$this')} onChange={event => setAction(index, { ...action, targetId: event.target.value, propertyId: undefined, value: undefined })}>{targetOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
                  )}
                  {kind === 'set_property' && action.targetId === '$created' ? (
                    <label className="field"><span>{t("만든 페이지의 데이터베이스")}</span><select className="text-input" value={actionSource} onChange={event => setAction(index, { ...action, sourceId: event.target.value })}>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                  ) : null}
                  <label className="field"><span>{t("속성")}</span><select className="text-input" value={String(action.propertyId ?? '')} onChange={event => setAction(index, { ...action, propertyId: event.target.value, value: null })}>
                    <option value="">{t("속성 선택")}</option>
                    {properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select></label>
                  {property ? (
                    <div className="field"><span>{t("값")}</span>
                      {isRef(action.value) ? null : ['title', 'text', 'url', 'email', 'phone'].includes(property.type)
                        ? <TokenField value={typeof action.value === 'string' ? action.value : ''} sourceId={tokenSource} hasPage={hasPage} variables={earlier} onChange={next => setAction(index, { ...action, value: next })} />
                        : <EditableValue pageId="" property={property} value={action.value ?? null} onChange={next => setAction(index, { ...action, value: next })} placeholder={t("값 선택")} />}
                      <ValueSource value={action.value} variables={earlier} sourceId={tokenSource} hasPage={hasPage} onChange={next => setAction(index, { ...action, value: next })} />
                      {property.type === 'date' ? <div className="button-tokens"><button type="button" className="text-button small" onClick={() => setAction(index, { ...action, value: '$today' })}>{t("오늘")}</button><button type="button" className="text-button small" onClick={() => setAction(index, { ...action, value: '$now' })}>{t("지금")}</button></div> : null}
                    </div>
                  ) : null}
                  {kind === 'edit_pages' ? <div className="field"><span>{t("대상 페이지")}</span><ValueSource label={t("대상 페이지")} emptyLabel={t("조건에 맞는 모든 페이지")} value={action.pages ?? null} variables={earlier} sourceId={tokenSource} hasPage={hasPage} onChange={pages => { const next = { ...action }; if (pages) next.pages = pages; else delete next.pages; setAction(index, next); }} /></div> : null}
                  {kind === 'edit_pages' ? <div className="field"><span>{t("조건")}</span><FilterEditor sourceId={actionSource} value={(action.filter as Filter | undefined) ?? null} onChange={filter => setAction(index, { ...action, filter: filter ?? { all: [] } })} /></div> : null}
                </div>
              ) : kind === 'add_page' ? (
                <div className="button-action-body">
                  <label className="field"><span>{t("데이터베이스")}</span><select className="text-input" value={actionSource} onChange={event => setAction(index, { ...action, sourceId: event.target.value })}>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                  <div className="field"><span>{t("새 페이지 제목")}</span><TokenField value={String(action.title ?? '')} sourceId={tokenSource} hasPage={hasPage} variables={earlier} onChange={title => setAction(index, { ...action, title })} /></div>
                </div>
              ) : kind === 'insert_blocks' ? (
                <InsertBlocksEditor action={action} onChange={next => setAction(index, next)} />
              ) : kind === 'open_page' ? (
                <div className="button-action-body"><label className="field"><span>{t("열 페이지")}</span><select className="text-input" value={String(action.targetId ?? '$this')} onChange={event => setAction(index, { ...action, targetId: event.target.value })}>{targetOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label></div>
              ) : kind === 'open_url' ? (
                <div className="button-action-body"><label className="field"><span>{t("열 주소")}</span><input className="text-input" type="url" value={String(action.url ?? '')} placeholder="https://" onChange={event => setAction(index, { ...action, url: event.target.value })} /></label></div>
              ) : kind === 'send_webhook' ? (
                <WebhookEditor action={action} onChange={next => setAction(index, next)} tokens={{ sourceId: tokenSource, hasPage, variables: earlier }} />
              ) : kind === 'define_variables' ? (
                <div className="button-action-body"><VariablesEditor variables={(action.variables as Variable[] | undefined) ?? []} sourceId={tokenSource} hasPage={hasPage} earlier={earlier} onChange={variables => setAction(index, { ...action, variables })} /></div>
              ) : kind === 'send_email' ? (
                <div className="button-action-body">
                  <label className="field"><span>{t("받는 이메일")}</span><input className="text-input" value={String(action.to ?? '')} onChange={event => setAction(index, { ...action, to: event.target.value })} /></label>
                  <div className="field"><span>{t("email|제목")}</span><TokenField value={String(action.subject ?? '')} sourceId={tokenSource} hasPage={hasPage} variables={earlier} onChange={subject => setAction(index, { ...action, subject })} /></div>
                  <div className="field"><span>{t("본문")}</span><TokenField value={String(action.message ?? '')} sourceId={tokenSource} hasPage={hasPage} variables={earlier} onChange={message => setAction(index, { ...action, message })} /></div>
                  <p className="muted">{t("메일은 로컬 SMTP 설정이 있어야 전송됩니다.")}</p>
                </div>
              ) : (
                <div className="button-action-body"><label className="field"><span>{t("알림 내용")}</span><TokenField value={String(action.message ?? '')} sourceId={tokenSource} hasPage={hasPage} variables={earlier} onChange={message => setAction(index, { ...action, message })} /></label></div>
              )}
            </div>
          );
        })}
      </div>
      {variant === 'panel' ? (
        // "+ 새 작업" lists the kinds of action to add.
        <button type="button" className="button-panel-add" onClick={event => setAddMenu(event.currentTarget)}><Icon name="plus" size={16} />{t("새 작업")}</button>
      ) : <button type="button" className="text-button add-action" onClick={() => set({ actions: [...value.actions, { action: 'set_property', targetId: '$this' }] })}><Icon name="plus" size={16} />{t("작업 추가")}</button>}
      {addMenu ? <Menu anchor={addMenu} placement="below-start" width={280} onClose={() => setAddMenu(null)} entries={Object.entries(actionLabels).map(([id, label]) => ({ label, icon: actionIcons[id] ?? 'lightning', onSelect: () => set({ actions: [...value.actions, id === 'open_url' ? { action: id, url: '' } : id === 'define_variables' ? freshAction(id) : { action: id, targetId: '$this' }] }) }))} /> : null}
      {variant === 'panel' && value.confirmation != null ? <label className="button-panel-confirm"><span>{t("실행 전 확인")}</span><input className="text-input" value={value.confirmation ?? ''} placeholder={t("확인 문구")} onChange={event => set({ confirmation: event.target.value })} /></label> : null}
    </div>
  );
}

// 블록 삽입: simple lines typed here, or the blocks of a page copied in whole — pictures, tables, formatting, nested
// blocks and all (compose them on any page, then "페이지에서 블록 가져오기").
type InsertBlock = { blockType: string; richText: Array<{ text: string } & Record<string, unknown>>; checked?: boolean; children?: InsertBlock[] } & Record<string, unknown>;
const extraKeys = ['language', 'attachmentId', 'url', 'cells', 'tableHeader', 'icon', 'color', 'toggleable', 'listFormat', 'ratio', 'columnWidths', 'rowColors', 'columnColors', 'caption', 'height', 'width', 'align', 'alt', 'href', 'crop', 'mask', 'direction', 'cellColors', 'merges'];
const skipped = new Set(['synced', 'synced_reference', 'tabs', 'tab', 'button']);
export function blocksOf(parentId: string, depth = 0): InsertBlock[] {
  if (depth > 8) return [];
  return (workspace.children(parentId).filter(child => child.kind === 'block' && workspace.visible(child.id)) as BlockEntity[]).flatMap(block => {
    // Columns give their content in reading order; synced blocks, tabs and buttons stay behind.
    if (block.blockType === 'columns' || block.blockType === 'column') return blocksOf(block.id, depth);
    if (skipped.has(block.blockType)) return [];
    const record = block as unknown as Record<string, unknown>;
    const item: InsertBlock = { blockType: block.blockType, richText: (structuredClone(block.richText ?? []) as unknown as Array<Record<string, unknown>>).map(({ comments: _comments, ...run }) => run) as InsertBlock['richText'] };
    if (block.checked !== undefined) item.checked = block.checked;
    for (const key of extraKeys) if (record[key] != null) item[key] = structuredClone(record[key]);
    const children = blocksOf(block.id, depth + 1);
    if (children.length) item.children = children;
    return [item];
  });
}
const countBlocks = (list: InsertBlock[]): number => list.reduce((sum, block) => sum + 1 + countBlocks(block.children ?? []), 0);
const simple = (list: InsertBlock[]) => list.every(block => !block.children?.length && Object.keys(block).every(key => ['blockType', 'richText', 'checked'].includes(key)) && block.richText.every(run => Object.keys(run).every(key => key === 'text')));
function BlockTree({ blocks, depth = 0 }: { blocks: InsertBlock[]; depth?: number }) {
  return <>{blocks.map((block, index) => (
    <div key={index}>
      <div className="insert-block-tree-row" style={{ paddingLeft: depth * 16 }}>
        <span className="insert-block-kind">{blockLabels[block.blockType as keyof typeof blockLabels] ?? block.blockType}</span>
        <span className="insert-block-text">{block.blockType === 'image' ? t("그림") : block.blockType === 'table' ? t("표 {0}행", [(block.cells as unknown[] | undefined)?.length ?? 0]) : plainText(block.richText as never).slice(0, 80)}</span>
      </div>
      {block.children ? <BlockTree blocks={block.children} depth={depth + 1} /> : null}
    </div>
  ))}</>;
}
function InsertBlocksEditor({ action, onChange }: { action: Action; onChange: (action: Action) => void }) {
  const blocks = (action.blocks as InsertBlock[] | undefined) ?? [{ blockType: 'paragraph', richText: [] }];
  const set = (list: InsertBlock[]) => onChange({ ...action, blocks: list });
  const [picking, setPicking] = useState(false);
  const rich = !simple(blocks);
  return (
    <div className="button-action-body">
      <label className="field"><span>{t("button-position|위치")}</span><select className="text-input" value={String(action.position ?? 'below')} onChange={event => onChange({ ...action, position: event.target.value, blocks })}>
        <option value="above">{t("버튼 위")}</option><option value="below">{t("버튼 아래")}</option><option value="first">{t("페이지 맨 위")}</option><option value="last">{t("페이지 맨 아래")}</option>
      </select></label>
      {rich ? (
        <div className="insert-block-tree">
          <div className="insert-block-tree-head"><span>{t("블록 {0}개", [countBlocks(blocks)])}</span><button type="button" className="text-button small" onClick={() => set([{ blockType: 'paragraph', richText: [] }])}>{t("지우고 직접 입력")}</button></div>
          <BlockTree blocks={blocks} />
        </div>
      ) : (
        <>
          {blocks.map((block, index) => (
            <div key={index} className="insert-block-row">
              <select className="text-input" value={block.blockType} onChange={event => set(blocks.map((item, i) => i === index ? { ...item, blockType: event.target.value } : item))}>
                {Object.entries(blockLabels).filter(([id]) => !['button', 'synced', 'synced_reference', 'image', 'file', 'column', 'columns', 'table', 'video', 'audio', 'breadcrumb', 'bookmark', 'pdf', 'embed', 'link_to_page', 'tabs', 'tab'].includes(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <input className="text-input" value={plainText(block.richText as never)} placeholder={t("내용")} onChange={event => set(blocks.map((item, i) => i === index ? { ...item, richText: event.target.value ? [{ text: event.target.value }] : [] } : item))} />
              <button type="button" className="icon-button small" aria-label={t("블록 삭제")} onClick={() => set(blocks.filter((_, i) => i !== index))}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <button type="button" className="text-button small" onClick={() => set([...blocks, { blockType: 'paragraph', richText: [] }])}><Icon name="plus" size={14} />{t("블록 추가")}</button>
        </>
      )}
      <button type="button" className="outline-button small insert-block-from-page" onClick={() => setPicking(true)}><Icon name="page" size={14} />{t("페이지에서 블록 가져오기")}</button>
      <p className="muted small">{t("그림 · 표 · 서식 · 들여쓴 블록까지 그대로 넣으려면 아무 페이지에 원하는 블록을 만들어 두고 가져오세요.")}</p>
      {picking ? <PagePicker title={t("블록을 가져올 페이지")} placeholder={t("페이지 검색…")} onClose={() => setPicking(false)} onPick={page => {
        setPicking(false);
        if (!page) return;
        const copied = blocksOf(page.id);
        if (!copied.length) { setStatus(t("그 페이지에 가져올 블록이 없습니다.")); return; }
        set(copied.slice(0, 100));
      }} /> : null}
    </div>
  );
}

// Webhook: the address and what is sent. A plain message ({ "text": … }) is written with @ mentions of the page's
// properties, the time and variables; any other JSON is typed as it is ({{…}} in its strings are filled in too).
export function WebhookEditor({ action, onChange, tokens }: { action: Action; onChange: (action: Action) => void; tokens?: { sourceId: string; hasPage: boolean; variables: Variable[] } }) {
  const body = (action.body ?? { text: '' }) as unknown;
  const plain = !!body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1 && typeof (body as { text?: unknown }).text === 'string';
  const [json, setJson] = useState(!plain || !tokens);
  const [raw, setRaw] = useState(() => JSON.stringify(body, null, 2));
  const [error, setError] = useState('');
  return (
    <div className="button-action-body">
      <label className="field"><span>{t("수신 URL")}</span><input className="text-input" value={String(action.url ?? '')} placeholder="https://hooks.slack.com/…" onChange={event => onChange({ ...action, url: event.target.value })} /></label>
      {!json && tokens ? (
        <div className="field"><span>{t("보낼 메시지")}</span>
          <TokenField value={String((body as { text: string }).text)} sourceId={tokens.sourceId} hasPage={tokens.hasPage} variables={tokens.variables} onChange={text => onChange({ ...action, body: { text } })} />
          <button type="button" className="text-button small" onClick={() => { setRaw(JSON.stringify(body, null, 2)); setJson(true); }}>{t("JSON으로 편집")}</button>
        </div>
      ) : (
        <label className="field"><span>{t("보낼 내용 (JSON)")}</span><textarea className="text-input mono" rows={4} value={raw} onChange={event => { setRaw(event.target.value); try { onChange({ ...action, body: JSON.parse(event.target.value) }); setError(''); } catch { setError(t("JSON 형식이 맞지 않습니다.")); } }} /></label>
      )}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

export const emptyButton = (): ButtonDefinition => ({ label: t("새 버튼"), confirmation: null, actions: [] });
export { newId };
