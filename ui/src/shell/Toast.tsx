import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { useStatus } from '../data/store';
import { openWorkspaceDialog } from '../dialogs/registry';

export function Toast() {
  const status = useStatus();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!(status.error || status.toast) || !status.text) { setVisible(false); return; }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), status.toast ? 3000 : 7000);
    return () => window.clearTimeout(timer);
  }, [status.at, status.error, status.text]);
  if (!visible) return null;
  // A plain note (no buttons): 42 high, 14px white on the dark bubble, 28 above the bottom.
  if (status.toast) return <div className="toast note" role="status"><span>{status.text}</span></div>;
  return (
    <div className="toast" role="alert">
      <span>{status.text}</span>
      {status.sync || /저장|충돌|연결/.test(status.text) ? <button type="button" onClick={() => openWorkspaceDialog('pending')}>{t("보류한 저장 보기")}</button> : null}
      <button type="button" aria-label={t("닫기")} onClick={() => setVisible(false)}>{t("닫기")}</button>
    </div>
  );
}
