import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../data/api';
import { apply } from '../data/commands';
import { displayDate, formatValue, plainText, relativeTime } from '../data/format';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import type { BlockEntity, PageEntity, PropertyEntity, RichText } from '../data/types';
import { Dialog, confirmDialog } from '../ui/primitives';
import { Icon } from '../ui/Icon';

// 버전 기록 (page history): the page as it was at a version on the left, the versions on the right. A version
// can be named (버전 이름 지정); blocks can be ticked and copied (or all of them), to paste into the page as it is now;
// "이 버전으로 복원" puts the whole page back. For a database page the versions are those of its rows and properties, the
// left side lists the rows as they were, and the restore brings back the rows, their values and the properties.

interface HistoryCommand { id: string; revision: number; actor: string; kind: string; created_at: string }
interface PastPage { revision: number; entity: PageEntity; properties: Array<PropertyEntity & { value: unknown }>; blocks: BlockEntity[] }
interface PastSource { revision: number; total: number; properties: PropertyEntity[]; rows: Array<{ id: string; title: string; icon: string | null; values: Record<string, unknown> }> }

const actorName = (actor: string) => actor === 'user' ? t("나") : actor === 'agent' ? t("에이전트") : actor === 'automation' ? t("자동화") : actor === 'scheduler' ? t("예약 실행") : actor;
const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));

function runsHtml(runs: RichText) {
  return runs.map(run => {
    let html = escape(run.text);
    if (run.code) html = `<code>${html}</code>`;
    if (run.bold) html = `<strong>${html}</strong>`;
    if (run.italic) html = `<em>${html}</em>`;
    if (run.strike) html = `<s>${html}</s>`;
    if (run.underline) html = `<u>${html}</u>`;
    if (run.href) html = `<a href="${escape(run.href)}">${html}</a>`;
    return html;
  }).join('');
}
// Blocks as HTML the editor's paste understands (headings, lists, to-dos, quotes, code, dividers).
export function blocksHtml(blocks: BlockEntity[]) {
  const out: string[] = [];
  for (const block of blocks) {
    const inner = runsHtml(block.richText ?? []);
    switch (block.blockType) {
      case 'heading1': out.push(`<h1>${inner}</h1>`); break;
      case 'heading2': out.push(`<h2>${inner}</h2>`); break;
      case 'heading3': case 'heading4': out.push(`<h3>${inner}</h3>`); break;
      case 'bullet': out.push(`<ul><li>${inner}</li></ul>`); break;
      case 'numbered': out.push(`<ol><li>${inner}</li></ol>`); break;
      case 'todo': out.push(`<ul><li><input type="checkbox"${block.checked ? ' checked' : ''}> ${inner}</li></ul>`); break;
      case 'quote': out.push(`<blockquote>${inner}</blockquote>`); break;
      case 'code': out.push(`<pre><code>${escape(plainText(block.richText))}</code></pre>`); break;
      case 'divider': out.push('<hr>'); break;
      default: if (inner) out.push(`<p>${inner}</p>`);
    }
  }
  return out.join('');
}
async function copyBlocks(blocks: BlockEntity[]) {
  const html = blocksHtml(blocks), text = blocks.map(block => plainText(block.richText)).filter(Boolean).join('\n');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch { await navigator.clipboard.writeText(text); }
  setStatus(t("블록 {0}개를 복사했습니다. 페이지에 붙여 넣을 수 있습니다.", [blocks.length]));
}

function PastBlock({ block }: { block: BlockEntity }) {
  const text = plainText(block.richText);
  const type = block.blockType;
  if (type === 'divider') return <hr />;
  const marker: ReactNode = type === 'bullet' ? '•' : type === 'numbered' ? '1.' : type === 'todo' ? <input type="checkbox" checked={!!block.checked} readOnly tabIndex={-1} /> : null;
  return <div className={`version-block version-${type}`}>{marker ? <span className="version-marker">{marker}</span> : null}<span>{text || <span className="muted">{type === 'paragraph' ? '' : type}</span>}</span></div>;
}

export function VersionHistoryDialog({ pageId, sourceId, revision, onClose }: { pageId: string; sourceId?: string; revision?: number; onClose: () => void }) {
  const ws = useWorkspace();
  const page = ws.get<PageEntity>(pageId);
  const database = !!sourceId;
  const [versions, setVersions] = useState<HistoryCommand[] | null>(null);
  const [selected, setSelected] = useState<number | null>(revision ?? null);
  const [pastPage, setPastPage] = useState<PastPage | null>(null);
  const [pastSource, setPastSource] = useState<PastSource | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState<{ revision: number; value: string } | null>(null);
  const [error, setError] = useState('');
  const names = page?.versionNames ?? {};

  useEffect(() => {
    api<{ commands: HistoryCommand[] }>(`/api/history?limit=100&${database ? `sourceId=${encodeURIComponent(sourceId!)}` : `pageId=${encodeURIComponent(pageId)}`}`)
      .then(data => { setVersions(data.commands); setSelected(current => current ?? data.commands[1]?.revision ?? data.commands[0]?.revision ?? null); })
      .catch(failure => setError(failure.message));
  }, [pageId, sourceId]);
  useEffect(() => {
    if (selected === null) return;
    setTicked(new Set());
    setPastPage(null); setPastSource(null);
    const request = database ? api<PastSource>(`/api/source-versions/${encodeURIComponent(sourceId!)}?revision=${selected}`).then(setPastSource) : api<PastPage>(`/api/versions/${encodeURIComponent(pageId)}?revision=${selected}`).then(setPastPage);
    request.catch(failure => setError(failure.message));
  }, [selected, pageId, sourceId]);

  const blocks = pastPage?.blocks ?? [];
  const tickedBlocks = blocks.filter(block => ticked.has(block.id));
  // Enter and leaving the field both end naming; only the first saves.
  const committed = useRef<number | null>(null);
  const commitName = (revision: number, value: string | null) => {
    if (committed.current === revision) return;
    committed.current = revision;
    setNaming(null);
    const name = value?.trim() || null;
    if (name !== (names[revision] ?? null)) apply([{ type: 'version.name', pageId, revision, name }]).catch(report);
  };
  const shown = useMemo(() => (pastSource?.properties ?? []).filter(property => property.type !== 'title').slice(0, 4), [pastSource]);
  const current = versions?.[0]?.revision;

  const restore = async () => {
    if (selected === null) return false;
    if (database) {
      if (!(await confirmDialog(t("데이터베이스 복원"), t("행과 값, 속성을 이 버전으로 되돌립니다. 그 뒤에 만든 행은 휴지통으로 갑니다. 이 복원도 변경 기록에서 되돌릴 수 있습니다."), { confirmLabel: t("복원") }))) return false;
      await apply([{ type: 'source.restore_version', id: sourceId!, revision: selected }]);
    } else await apply([{ type: 'page.restore_version', id: pageId, revision: selected }]);
    setStatus(t("이전 버전으로 복원했습니다."));
    return undefined;
  };

  return (
    <Dialog title={database ? t("데이터베이스 버전 기록") : t("버전 기록")} onClose={onClose} width={980} submitLabel={t("이 버전으로 복원")} onSubmit={selected !== null && selected !== current ? restore : undefined}
      footer={!database && blocks.length ? (
        <span className="version-copy-tools">
          <button type="button" className="outline-button" disabled={!tickedBlocks.length} onClick={() => copyBlocks(tickedBlocks).catch(report)}>{t("선택한 블록 복사 ({0})", [tickedBlocks.length])}</button>
          <button type="button" className="outline-button" onClick={() => copyBlocks(blocks).catch(report)}>{t("모두 복사")}</button>
        </span>
      ) : undefined}>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="version-history">
        <div className="version-history-preview">
          {selected === null ? <p className="muted">{versions && !versions.length ? t("기록이 없습니다.") : t("불러오는 중…")}</p> : null}
          {pastPage ? (
            <>
              <h2 className="version-title">{pastPage.entity.icon && !pastPage.entity.icon.startsWith('icon:') && !pastPage.entity.icon.startsWith('attachment') ? <span className="version-icon">{pastPage.entity.icon}</span> : null}{pastPage.entity.title || t("새 페이지")}</h2>
              {pastPage.properties.filter(property => !['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button'].includes(property.type)).map(property => (
                <div key={property.id} className="version-property"><span>{property.name}</span><span>{formatValue(property.value, property) || t("비어 있음")}</span></div>
              ))}
              <div className="version-body">
                {blocks.map(block => (
                  <label key={block.id} className={`version-row${ticked.has(block.id) ? ' ticked' : ''}`}>
                    <input type="checkbox" className="version-tick" aria-label={t("이 블록 선택")} checked={ticked.has(block.id)}
                      onChange={() => setTicked(currentSet => { const next = new Set(currentSet); if (next.has(block.id)) next.delete(block.id); else next.add(block.id); return next; })} />
                    <PastBlock block={block} />
                  </label>
                ))}
                {!blocks.length ? <p className="muted">{t("내용이 없습니다.")}</p> : null}
              </div>
            </>
          ) : null}
          {pastSource ? (
            <>
              <p className="muted">{t("이 버전의 행 {0}개", [pastSource.total])}</p>
              <table className="version-table">
                <thead><tr><th>{t("이름")}</th>{shown.map(property => <th key={property.id}>{property.name}</th>)}</tr></thead>
                <tbody>{pastSource.rows.map(row => (
                  <tr key={row.id} className={workspace.visible(row.id) ? '' : 'gone'}><td>{row.title || t("제목 없음")}</td>{shown.map(property => <td key={property.id}>{formatValue(row.values[property.id], property)}</td>)}</tr>
                ))}</tbody>
              </table>
            </>
          ) : null}
        </div>
        <div className="version-history-list" role="listbox" aria-label={t("버전")}>
          {versions?.map((version, index) => (
            <div key={version.id} role="option" aria-selected={selected === version.revision} className={`version-item${selected === version.revision ? ' selected' : ''}`} onClick={() => setSelected(version.revision)}>
              {naming?.revision === version.revision ? (
                <input className="text-input version-name-input" autoFocus value={naming.value} placeholder={t("버전 이름")} aria-label={t("버전 이름")}
                  onClick={event => event.stopPropagation()}
                  onChange={event => setNaming({ revision: version.revision, value: event.target.value })}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Enter') { event.preventDefault(); commitName(version.revision, naming.value); }
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNaming(null); }
                  }}
                  onBlur={() => commitName(version.revision, naming.value)} />
              ) : (
                <>
                  <div className="version-item-main">
                    <div className="version-item-title">{names[version.revision] ?? (index === 0 ? t("현재 버전") : displayDate(version.created_at))}</div>
                    <div className="version-item-meta">{names[version.revision] || index === 0 ? `${displayDate(version.created_at)} · ` : ''}{relativeTime(version.created_at)} · {actorName(version.actor)}{version.kind === 'undo' ? ` · ${t("되돌림")}` : ''}</div>
                  </div>
                  <button type="button" className="icon-button tiny" aria-label={t("버전 이름 지정")} title={t("버전 이름 지정")} onClick={event => { event.stopPropagation(); committed.current = null; setNaming({ revision: version.revision, value: names[version.revision] ?? '' }); }}><Icon name="pencil" size={14} /></button>
                </>
              )}
            </div>
          ))}
          {versions && !versions.length ? <p className="muted">{t("기록이 없습니다.")}</p> : null}
        </div>
      </div>
    </Dialog>
  );
}
