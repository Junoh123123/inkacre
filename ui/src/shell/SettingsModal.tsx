import { LANGUAGES, language, setLanguage, t, tx } from '../i18n';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Popover } from '../ui/overlay';
import { Menu } from '../ui/Menu';
import { Icon } from '../ui/Icon';
import { AppMark } from '../ui/AppMark';
import { CaptureSettings } from './CaptureSettings';
import { FileTextStatus } from './FileTextStatus';
import { MirrorSettings } from './MirrorSettings';
import { BackupSettings } from './BackupSettings';
import { Switch } from '../ui/primitives';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import { apply, uploadFile } from '../data/commands';
import { readLocal, storeLocal } from '../data/api';
import { deviceTimeZone, updateSettings, useSettings, type StartPage, type ThemePref } from '../data/settings';
import { desktopNotificationsOn, setDesktopNotifications } from '../dialogs/workspaceDialogs';
import { openWorkspaceDialog } from '../dialogs/registry';
import { setWorkspaceIdentity, useWorkspaceIdentity } from '../data/workspaces';
import { EmojiPicker } from '../page/PageView';

// The settings window: 1361×727,
// 50 from the top, r12, modal shadow. Left a 240-wide #f9f8f7 column: search box (focused), then
// 12/500 #a19e99 section heads and 28-high rows 30 apart (14/500 #5f5e59, icon 20, selected row
// rgba(33,27,23,.05) with #2c2c2b text). Right: content 800 wide from x 469 — title 26/600/32,
// a 16/400 line under it, section heads 16/500 over a line, rows (label 14/500, note 13/400 #7d7a75)
// with drop-down buttons (28 high, r6, menu 250 wide under them) or switches on the right.
// Only the parts that apply to a local, single-person app are here (no account, members,
// billing, AI, connections or public pages).

type PageId = 'preferences' | 'notifications' | 'general' | 'capture' | 'backup' | 'mirror' | 'import';
const nav: Array<{ section: string; items: Array<{ id: PageId; label: string; icon: string }> }> = [
  { section: t("계정"), items: [{ id: 'preferences', label: t("설정"), icon: 'sliders' }, { id: 'notifications', label: t("알림"), icon: 'bell' }] },
  { section: t("워크스페이스"), items: [{ id: 'general', label: t("일반"), icon: 'settings' }, { id: 'capture', label: t("빠른 기록"), icon: 'lightning' }, { id: 'backup', label: t("백업"), icon: 'backup' }, { id: 'mirror', label: t("폴더 미러"), icon: 'export' }, { id: 'import', label: t("가져오기"), icon: 'import' }] },
];

// Every setting by page, so the search box finds a setting by its name or note, not only the page names.
const timeZones = () => { try { return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { return []; } };

// The workspace's mark: its icon (emoji or picture) or the first letter of its name.
export function WorkspaceMark({ name, icon, size = 22 }: { name: string; icon: string | null; size?: number }) {
  if (icon?.startsWith('attachment:')) return <img className="workspace-mark image" src={`/api/attachments/${encodeURIComponent(icon.slice(11))}`} width={size} height={size} alt="" draggable={false} />;
  if (icon && !icon.startsWith('icon:')) return <span className="workspace-mark emoji" style={{ width: size, height: size, fontSize: Math.round(size * 0.72) }}>{icon}</span>;
  // No icon chosen: Inkacre's mark (a first letter on grey read as a stray character).
  void name;
  return <AppMark size={size} className="workspace-mark app" />;
}

const settingsIndex: Array<{ page: PageId; label: string; note: string }> = [
  { page: 'preferences', label: t("테마"), note: t("이 기기에서 사용할 테마를 선택하세요") },
  { page: 'preferences', label: t("Enter 키를 누르면 새 줄이 추가됩니다"), note: t("댓글 등 입력 칸에 적용됩니다. {0} 키를 눌러 보냅니다.", ['Cmd/Ctrl + Enter']) },
  { page: 'preferences', label: t("언어"), note: t("이 앱에서 사용할 언어입니다") },
  { page: 'preferences', label: t("한 주의 시작을 월요일로"), note: t("캘린더와 날짜 선택기의 표시 방법에 영향을 줍니다") },
  { page: 'preferences', label: t("고대비"), note: t("글자 · 테두리 · 포커스 표시를 더 진하게 합니다") },
  { page: 'preferences', label: t("시간대"), note: t("시각을 이 시간대로 보여 주고 입력합니다. 자동은 이 기기의 시간대입니다.") },
  { page: 'preferences', label: t("시작 시 열기"), note: t("앱을 처음 열 때 표시할 페이지를 선택하세요") },
  { page: 'notifications', label: t("데스크톱 알림"), note: t("새 알림(리마인더)을 이 브라우저의 데스크톱 알림으로도 보여 줍니다. 받은 알림에는 항상 남습니다.") },
  { page: 'general', label: t("이름"), note: t("사이드바 아래에 표시되는 워크스페이스 이름입니다") },
  { page: 'general', label: t("아이콘"), note: t("워크스페이스 전환 메뉴와 사이드바에 표시됩니다") },
  { page: 'general', label: t("사용자 지정 이모지"), note: t("이름을 붙인 그림을 :이름: 으로 글에 넣고 아이콘으로 씁니다") },
  { page: 'general', label: t("모든 워크스페이스 콘텐츠 내보내기"), note: t("모든 페이지를 HTML 또는 Markdown 및 CSV로, 첨부 파일과 함께 ZIP 하나로 받습니다") },
  { page: 'general', label: t("첨부 파일 내용 검색"), note: t("PDF, Word, Excel, PowerPoint, 한글(HWPX), OpenDocument, 텍스트 파일의 내용도 검색합니다. 사진 속 글자는 읽지 않습니다.") },
  { page: 'capture', label: t("기록이 들어갈 페이지"), note: t("페이지를 정하지 않은 기록이 이 페이지 끝에 붙습니다") },
  { page: 'capture', label: t("호출하는 방법"), note: t("단축어, Raycast, 터미널처럼 이 컴퓨터의 다른 도구에서 호출 한 번으로 페이지에 한 줄을 붙이거나 데이터베이스에 항목을 추가합니다.") },
  { page: 'capture', label: t("받은 파일 폴더"), note: t("이 폴더에 새로 들어온 파일(스캔, 스크린샷, 다운로드)을 위 페이지 끝에 붙입니다. 폴더를 고를 때 이미 있던 파일은 가져오지 않으며, 파일을 지우지 않습니다.") },
  { page: 'backup', label: t("자동 백업"), note: t("워크스페이스 전체(페이지, 데이터베이스, 첨부 파일, 변경 기록)를 정해 둔 주기로 백업합니다. 지난 백업 뒤로 바뀐 것이 없으면 건너뜁니다.") },
  { page: 'backup', label: t("백업 폴더"), note: t("지금은 데이터 폴더 안에 있어 디스크가 고장 나면 함께 잃습니다. 외장 디스크나 다른 드라이브의 폴더를 고르세요.") },
  { page: 'mirror', label: t("미러 폴더"), note: t("워크스페이스 전체를 이 컴퓨터의 폴더에 Markdown과 CSV 파일로 계속 내보냅니다. Obsidian, VS Code, Spotlight, git이나 백업 도구에서 그대로 열 수 있습니다.") },
  { page: 'import', label: t("파일 가져오기"), note: t("Markdown, CSV, HTML, 텍스트 파일 또는 붙여 넣은 내용을 새 페이지로 가져옵니다") },
];

// Workspace name shown in the sidebar footer — kept in the workspace's own data (data/workspaces.ts).
export function useWorkspaceName() { return useWorkspaceIdentity().name; }

let openSettings: ((page?: PageId) => void) | null = null;
export function showSettings(page: PageId = 'preferences') { openSettings?.(page); }

export function SettingsHost() {
  const [page, setPage] = useState<PageId | null>(null);
  useEffect(() => { openSettings = next => setPage(next ?? 'preferences'); return () => { openSettings = null; }; }, []);
  return page ? <SettingsModal page={page} onPage={setPage} onClose={() => setPage(null)} /> : null;
}

function Row({ label, note, children }: { label: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="prefs-row" data-label={typeof label === 'string' ? label : undefined}>
      <div className="prefs-row-text"><div className="prefs-row-label">{label}</div>{note ? <div className="prefs-row-note">{note}</div> : null}</div>
      <div className="prefs-row-control">{children}</div>
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  const [anchor, setAnchor] = useState<Element | null>(null);
  const current = options.find(option => option.value === value);
  return (
    <>
      <button type="button" className="prefs-choice" aria-haspopup="menu" aria-label={label} onClick={event => setAnchor(event.currentTarget)}>
        <span>{current?.label}</span><Icon name="chevron-down" size={12} />
      </button>
      {anchor ? <Menu anchor={anchor} placement="below-end" width={250} onClose={() => setAnchor(null)} entries={options.map(option => ({ label: option.label, checked: option.value === value, onSelect: () => onChange(option.value) }))} /> : null}
    </>
  );
}

function SettingsModal({ page, onPage, onClose }: { page: PageId; onPage: (page: PageId) => void; onClose: () => void }) {
  const settings = useSettings();
  const identity = useWorkspaceIdentity();
  const name = identity.name;
  const [iconPicker, setIconPicker] = useState<Element | null>(null);
  const [query, setQuery] = useState('');
  const [desktop, setDesktop] = useState(desktopNotificationsOn);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const width = Math.min(1361, window.innerWidth - 150), height = Math.min(727, window.innerHeight - 100);
  const needle = query.trim().toLocaleLowerCase();
  const settingMatches = needle ? settingsIndex.filter(item => item.label.toLocaleLowerCase().includes(needle) || item.note.toLocaleLowerCase().includes(needle)) : [];
  const visibleNav = nav.map(group => ({ ...group, items: group.items.filter(item => !needle || item.label.toLocaleLowerCase().includes(needle) || settingMatches.some(match => match.page === item.id)) })).filter(group => group.items.length);
  const pageLabel = (id: PageId) => nav.flatMap(group => group.items).find(item => item.id === id)?.label ?? '';
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  // A setting picked from the results: its row scrolls into view and is marked for a moment.
  useEffect(() => {
    if (!focusLabel) return;
    const row = [...document.querySelectorAll<HTMLElement>('.prefs-modal .prefs-row')].find(element => element.dataset.label === focusLabel);
    row?.scrollIntoView({ block: 'center' });
    row?.classList.add('prefs-row-found');
    const timer = setTimeout(() => row?.classList.remove('prefs-row-found'), 1600);
    return () => clearTimeout(timer);
  }, [focusLabel, page]);

  let content: ReactNode = null;
  if (page === 'preferences') {
    content = (
      <>
        <h1 className="prefs-title">{t("설정")}</h1>
        <p className="prefs-lead">{t("이 앱의 디자인과 동작을 선택하세요")}</p>
        <h2 className="prefs-section">{t("설정")}</h2>
        <Row label={t("테마")} note={t("이 기기에서 사용할 테마를 선택하세요")}>
          <Choice<ThemePref> label={t("테마")} value={settings.theme} onChange={theme => updateSettings({ theme })}
            options={[{ value: 'system', label: t("시스템 설정 사용") }, { value: 'light', label: t("라이트 모드") }, { value: 'dark', label: t("다크 모드") }]} />
        </Row>
        <Row label={t("고대비")} note={t("글자 · 테두리 · 포커스 표시를 더 진하게 합니다")}>
          <Switch label={t("고대비")} checked={settings.highContrast} onChange={highContrast => updateSettings({ highContrast })} />
        </Row>
        <h2 className="prefs-section">{t("입력 옵션")}</h2>
        <Row label={t("Enter 키를 누르면 새 줄이 추가됩니다")} note={<>{tx("댓글 등 입력 칸에 적용됩니다. {0} 키를 눌러 보냅니다.", [<b>Cmd/Ctrl + Enter</b>])}</>}>
          <Switch label={t("Enter 키로 줄 바꾸기")} checked={settings.enterNewLine} onChange={enterNewLine => updateSettings({ enterNewLine })} />
        </Row>
        <h2 className="prefs-section">{t("언어와 시간")}</h2>
        <Row label={t("언어")} note={t("이 앱에서 사용할 언어입니다")}>
          <Choice label={t("언어")} value={language} onChange={code => { if (code !== language) setLanguage(code); }} options={LANGUAGES.map(item => ({ value: item.code, label: item.name }))} />
        </Row>
        <Row label={t("한 주의 시작을 월요일로")} note={t("캘린더와 날짜 선택기의 표시 방법에 영향을 줍니다")}>
          <Switch label={t("한 주의 시작을 월요일로")} checked={settings.weekStartsMonday} onChange={weekStartsMonday => updateSettings({ weekStartsMonday })} />
        </Row>
        <Row label={t("시간대")} note={t("시각을 이 시간대로 보여 주고 입력합니다. 자동은 이 기기의 시간대입니다.")}>
          <select className="prefs-select" aria-label={t("시간대")} value={settings.timeZone ?? ''} onChange={event => updateSettings({ timeZone: event.target.value || null })}>
            <option value="">{t("자동 ({0})", [deviceTimeZone()])}</option>
            {timeZones().map(zone => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
          </select>
        </Row>
        <h2 className="prefs-section">{t("시작 페이지")}</h2>
        <Row label={t("시작 시 열기")} note={t("앱을 처음 열 때 표시할 페이지를 선택하세요")}>
          <Choice<StartPage> label={t("시작 시 열기")} value={settings.startPage} onChange={startPage => updateSettings({ startPage })}
            options={[{ value: 'last', label: t("마지막으로 본 페이지") }, { value: 'top', label: t("사이드바의 맨 위 페이지") }, { value: 'home', label: t("홈") }, { value: 'library', label: t("라이브러리") }]} />
        </Row>
        <h2 className="prefs-section">{t("휴지통")}</h2>
        <Row label={t("휴지통 자동 비우기")} note={t("휴지통에 30일 넘게 있는 항목을 앱을 열 때 영구 삭제합니다")}>
          <Switch label={t("휴지통 자동 비우기")} checked={settings.trashAutoPurge} onChange={trashAutoPurge => updateSettings({ trashAutoPurge })} />
        </Row>
      </>
    );
  } else if (page === 'notifications') {
    content = (
      <>
        <h1 className="prefs-title">{t("알림")}</h1>
        <p className="prefs-lead">{t("알림을 받을 시기와 방법을 정하세요")}</p>
        <h2 className="prefs-section">{t("데스크톱 알림")}</h2>
        <Row label={t("데스크톱 알림")} note={t("새 알림(리마인더)을 이 브라우저의 데스크톱 알림으로도 보여 줍니다. 받은 알림에는 항상 남습니다.")}>
          <Switch label={t("데스크톱 알림")} checked={desktop} onChange={on => setDesktopNotifications(on).then(() => { setDesktop(on); setStatus(on ? t("데스크톱 알림을 켰습니다.") : t("데스크톱 알림을 껐습니다.")); }).catch(report)} />
        </Row>
      </>
    );
  } else if (page === 'general') {
    content = (
      <>
        <h1 className="prefs-title">{t("일반")}</h1>
        <p className="prefs-lead">{t("워크스페이스 설정")}</p>
        <h2 className="prefs-section">{t("워크스페이스")}</h2>
        <Row label={t("이름")} note={t("사이드바 아래에 표시되는 워크스페이스 이름입니다")}>
          <input className="prefs-input" defaultValue={name} aria-label={t("워크스페이스 이름")} onBlur={event => { if (event.target.value.trim() !== name) setWorkspaceIdentity({ name: event.target.value.trim() || null }).catch(report); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) (event.target as HTMLInputElement).blur(); }} />
        </Row>
        <Row label={t("아이콘")} note={t("워크스페이스 전환 메뉴와 사이드바에 표시됩니다")}>
          <button type="button" className="prefs-choice workspace-icon-choice" onClick={event => setIconPicker(event.currentTarget)}>
            <WorkspaceMark name={name} icon={identity.icon} size={20} />{identity.icon ? t("바꾸기") : t("아이콘 선택")}
          </button>
        </Row>
        {iconPicker ? <EmojiPicker anchor={iconPicker} upload onClose={() => setIconPicker(null)} onPick={value => { setIconPicker(null); setWorkspaceIdentity({ icon: value }).catch(report); }} onRemove={identity.icon ? () => { setIconPicker(null); setWorkspaceIdentity({ icon: null }).catch(report); } : undefined} /> : null}
        <h2 className="prefs-section">{t("사용자 지정 이모지")}</h2>
        <CustomEmojiSettings />
        <h2 className="prefs-section">{t("검색")}</h2>
        <Row label={t("첨부 파일 내용 검색")} note={t("PDF, Word, Excel, PowerPoint, 한글(HWPX), OpenDocument, 텍스트 파일의 내용도 검색합니다. 사진 속 글자는 읽지 않습니다.")}>
          <FileTextStatus />
        </Row>
        <h2 className="prefs-section">{t("내보내기")}</h2>
        <Row label={t("모든 워크스페이스 콘텐츠 내보내기")} note={t("모든 페이지를 HTML 또는 Markdown 및 CSV로, 첨부 파일과 함께 ZIP 하나로 받습니다")}>
          <button type="button" className="prefs-choice" onClick={() => { onClose(); openWorkspaceDialog('export', { id: '*' }); }}>{t("내보내기")}</button>
        </Row>
      </>
    );
  } else if (page === 'capture') {
    content = <CaptureSettings Row={Row} />;
  } else if (page === 'backup') {
    content = <BackupSettings Row={Row} />;
  } else if (page === 'mirror') {
    content = <MirrorSettings Row={Row} />;
  } else {
    content = (
      <>
        <h1 className="prefs-title">{t("가져오기")}</h1>
        <p className="prefs-lead">{t("다른 앱의 자료를 이 워크스페이스로 가져옵니다")}</p>
        <h2 className="prefs-section">{t("가져오기")}</h2>
        <Row label={t("파일 가져오기")} note={t("Markdown, CSV, HTML, 텍스트 파일 또는 붙여 넣은 내용을 새 페이지로 가져옵니다")}>
          <button type="button" className="prefs-choice" onClick={() => { onClose(); openWorkspaceDialog('import', {}); }}>{t("가져오기")}</button>
        </Row>
      </>
    );
  }

  return (
    <Popover anchor={{ x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2 }} placement="point" modal onClose={onClose} className="prefs-modal" style={{ width, height }} label={t("설정")} motion="fade">
      <div className="prefs-nav">
        <div className="prefs-search"><Icon name="search" size={16} /><input ref={searchRef} placeholder={t("설정 검색")} value={query} onChange={event => setQuery(event.target.value)} aria-label={t("설정 검색")} /></div>
        <div className="prefs-nav-list">
          {settingMatches.length ? (
            <div className="prefs-nav-group">
              <div className="prefs-nav-head">{t("설정 항목")}</div>
              {settingMatches.map(item => (
                <button key={`${item.page}:${item.label}`} type="button" className="prefs-nav-item prefs-nav-match" onClick={() => { onPage(item.page); setFocusLabel(item.label); }}>
                  <span className="prefs-nav-match-label">{item.label}</span><span className="prefs-nav-match-page">{pageLabel(item.page)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {needle && !settingMatches.length && !visibleNav.length ? <div className="prefs-nav-empty">{t("결과 없음")}</div> : null}
          {visibleNav.map(group => (
            <div key={group.section} className="prefs-nav-group">
              <div className="prefs-nav-head">{group.section}</div>
              {group.items.map(item => (
                <button key={item.id} type="button" role="tab" aria-selected={item.id === page} className={`prefs-nav-item${item.id === page ? ' selected' : ''}`} onClick={() => onPage(item.id)}>
                  <Icon name={item.icon} size={20} /><span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="prefs-content">
        <button type="button" className="prefs-close icon-button" aria-label={t("닫기")} title={t("닫기")} onClick={onClose}><Icon name="close" size={16} /></button>
        <div className="prefs-column">{content}</div>
      </div>
    </Popover>
  );
}

// 사용자 지정 이모지: name a picture (lower-case letters, digits, _ + -) to type it as :name: in text and pick it as
// an icon. The pictures are local attachments.
function CustomEmojiSettings() {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const emoji = Object.entries(ws.customEmoji()).sort(([a], [b]) => a.localeCompare(b));
  const valid = /^[a-z0-9_+-]{1,40}$/.test(name);
  const add = async (picked: File) => {
    setBusy(true);
    try {
      const result = await uploadFile(picked, workspace.revision);
      await apply([{ type: 'emoji.set', name, attachmentId: result.attachmentId }]);
      setName('');
    } catch (error) { report(error); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  return (
    <div className="custom-emoji-settings">
      <p className="prefs-row-note">{t("이름을 붙인 그림을 :이름: 으로 글에 넣고 아이콘으로 씁니다")}</p>
      <div className="custom-emoji-add">
        <input className="prefs-input" placeholder={t("이름 (예: party-parrot)")} value={name} onChange={event => setName(event.target.value.toLowerCase().replace(/\s+/g, '-'))} aria-label={t("이모지 이름")} />
        <label className={`prefs-choice${!valid || busy ? ' disabled' : ''}`}>{busy ? t("올리는 중…") : t("그림 선택")}
          <input ref={file} type="file" hidden disabled={!valid || busy} accept="image/png,image/jpeg,image/gif,image/webp,image/avif" onChange={event => { const picked = event.target.files?.[0]; if (picked) add(picked).catch(report); }} />
        </label>
      </div>
      {name && !valid ? <p className="prefs-row-note warning-text">{t("영문 소문자, 숫자, _ + - 만 쓸 수 있습니다")}</p> : null}
      {emoji.length ? (
        <div className="custom-emoji-list">
          {emoji.map(([key, id]) => (
            <div key={key} className="custom-emoji-row">
              <img src={`/api/attachments/${encodeURIComponent(id)}`} alt={`:${key}:`} width={24} height={24} />
              <code>:{key}:</code>
              <button type="button" className="icon-button tiny" aria-label={t("삭제")} title={t("삭제")} onClick={() => apply([{ type: 'emoji.set', name: key, attachmentId: null }]).catch(report)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      ) : <p className="prefs-row-note">{t("아직 사용자 지정 이모지가 없습니다.")}</p>}
    </div>
  );
}
