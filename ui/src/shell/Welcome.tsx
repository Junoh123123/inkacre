import { hasChosenLanguage, language, LANGUAGES, rememberLanguage, setLanguage, t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { apply } from '../data/commands';
import { navigate } from '../data/router';
import { report } from '../data/store';
import { updateSettings } from '../data/settings';
import { storeLocal } from '../data/api';
import { starterOperations } from './starter';
import { AppMark } from '../ui/AppMark';
import { defaultWorkspaceName } from '../data/workspaces';

// First run (an empty workspace nobody has started yet): pick the language, then start with the guide and examples
// or with nothing. The language decides what the starter pages are written in; it can change later in 설정 › 언어와
// 시간, but pages already made keep their words. The week's first day follows the browser's region.
export const welcomedKey = 'pageyard-welcomed';
const choiceKey = 'pageyard-welcome-choice';

function regionWeekStartsMonday(): boolean | null {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return typeof firstDay === 'number' ? firstDay === 1 : null;
  } catch { return null; }
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const [choice, setChoice] = useState<'starter' | 'empty'>(() => (sessionStorage.getItem(choiceKey) === 'empty' ? 'empty' : 'starter'));
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { startButton.current?.focus(); }, []);
  // A language given on the command line (--lang) is preselected, unless this browser already picked one.
  useEffect(() => {
    if (hasChosenLanguage()) return;
    fetch('/api/setup').then(response => response.json()).then((setup: { language?: string | null }) => {
      if (setup.language && setup.language !== language && LANGUAGES.some(item => item.code === setup.language)) setLanguage(setup.language);
    }).catch(() => undefined);
  }, []);
  const pick = (value: 'starter' | 'empty') => { setChoice(value); try { sessionStorage.setItem(choiceKey, value); } catch { /* storage blocked */ } };

  const start = async () => {
    setBusy(true);
    try {
      rememberLanguage();
      const monday = regionWeekStartsMonday();
      if (monday !== null) updateSettings({ weekStartsMonday: monday });
      // The workspace's name (설정 › 일반 › 이름 later); left empty, it is "내 워크스페이스".
      if (name.trim()) await apply([{ type: 'workspace.update', name: name.trim() }]);
      if (choice === 'starter') {
        const { operations, firstPageId } = starterOperations();
        await apply(operations);
        navigate(firstPageId, { replace: true });
      }
      storeLocal(welcomedKey, 'true');
      onDone();
    } catch (error) { setBusy(false); report(error); }
  };

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <AppMark size={44} className="welcome-mark" />
        <h1 id="welcome-title">{t("welcome|{0}에 오신 것을 환영합니다", [__APP_NAME__])}</h1>
        <p className="welcome-lead">{t("welcome|페이지와 데이터베이스가 모두 이 컴퓨터에만 저장됩니다. 계정도, 인터넷 연결도 필요 없습니다.")}</p>
        <label className="welcome-field">
          <span>{t("언어")}</span>
          <select value={language} onChange={event => setLanguage(event.target.value)} disabled={busy}>
            {LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
        <label className="welcome-field welcome-name">
          <span>{t("워크스페이스 이름")}</span>
          <input value={name} maxLength={200} placeholder={defaultWorkspaceName()} onChange={event => setName(event.target.value)} disabled={busy} />
        </label>
        <fieldset className="welcome-choices" disabled={busy}>
          <legend>{t("welcome|어떻게 시작할까요?")}</legend>
          <label className={`welcome-choice${choice === 'starter' ? ' selected' : ''}`}>
            <input type="radio" name="welcome-start" checked={choice === 'starter'} onChange={() => pick('starter')} />
            <span className="welcome-choice-body">
              <span className="welcome-choice-title">{t("welcome|안내와 예시로 시작")}<span className="welcome-badge">{t("welcome|추천")}</span></span>
              <span className="welcome-choice-note">{t("welcome|시작하기 안내, 할 일 데이터베이스, 빠른 메모, 독서 목록, AI 에이전트 연결 방법을 만들어 둡니다. 언제든 지울 수 있습니다.")}</span>
            </span>
          </label>
          <label className={`welcome-choice${choice === 'empty' ? ' selected' : ''}`}>
            <input type="radio" name="welcome-start" checked={choice === 'empty'} onChange={() => pick('empty')} />
            <span className="welcome-choice-body">
              <span className="welcome-choice-title">{t("welcome|빈 워크스페이스")}</span>
              <span className="welcome-choice-note">{t("welcome|아무것도 없이 바로 시작합니다.")}</span>
            </span>
          </label>
        </fieldset>
        <button ref={startButton} type="button" className="welcome-start" onClick={start} disabled={busy}>{busy ? t("welcome|준비하는 중…") : t("welcome|시작하기")}</button>
        <p className="welcome-note">{t("welcome|언어는 나중에 설정 › 언어와 시간에서 바꿀 수 있습니다. 이미 만든 페이지의 내용은 바뀌지 않습니다.")}</p>
      </div>
    </div>
  );
}
