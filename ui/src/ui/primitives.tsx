import { t } from '../i18n';
import { useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from './Icon';
import { Popover } from './overlay';
import { report } from '../data/store';

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <label className="switch" onClick={event => event.stopPropagation()}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="switch-track"><span className="switch-knob" /></span>
    </label>
  );
}

export function Tag({ color = 'default', children, status = false, onRemove }: { color?: string; children: ReactNode; status?: boolean; onRemove?: () => void }) {
  return (
    <span className={`tag tag-${color}${status ? ' tag-status' : ''}`}>
      {status ? <span className="tag-dot" /> : null}
      <span className="tag-text">{children}</span>
      {onRemove ? <button type="button" className="tag-remove" aria-label={t("제거")} onClick={event => { event.stopPropagation(); onRemove(); }}><Icon name="close" size={12} /></button> : null}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

// Generic centered dialog for settings shown as panels.
export interface DialogProps {
  title: string;
  onClose: () => void;
  onSubmit?: () => Promise<unknown> | unknown;
  submitLabel?: string;
  cancelLabel?: string;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
  danger?: boolean;
}

export function Dialog({ title, onClose, onSubmit, submitLabel = t("저장"), cancelLabel = t("취소"), children, width = 560, footer, danger }: DialogProps) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!onSubmit) return onClose();
    setBusy(true);
    try { const result = await onSubmit(); if (result !== false) onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  return (
    <Popover anchor={{ x: 0, y: 0 }} placement="center" onClose={onClose} modal className="dialog-panel" style={{ width: `min(${width}px, calc(100vw - 32px))` }} label={title}>
      <form className="dialog" onSubmit={submit}>
        <div className="dialog-header">
          <div className="dialog-title">{title}</div>
          <button type="button" className="icon-button small" aria-label={t("닫기")} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="dialog-body">
          {children}
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </div>
        <div className="dialog-footer">
          {footer}
          <button type="button" className="outline-button" onClick={onClose}>{onSubmit ? cancelLabel : t("닫기")}</button>
          {onSubmit ? <button type="submit" className={danger ? 'blue-button danger' : 'blue-button'} disabled={busy}>{submitLabel}</button> : null}
        </div>
      </form>
    </Popover>
  );
}

// Mount a transient component (dialog) outside the React tree that requested it.
export function mountTransient(render: (close: () => void) => ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); };
  try { root.render(<>{render(close)}</>); } catch (error) { report(error); close(); }
  return close;
}

export function confirmDialog(title: string, message: ReactNode, { confirmLabel = t("확인"), danger = false } = {}): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    mountTransient(close => (
      <Dialog title={title} submitLabel={confirmLabel} danger={danger} width={420}
        onClose={() => { close(); if (!settled) resolve(false); }}
        onSubmit={() => { settled = true; resolve(true); }}>
        <div>{message}</div>
      </Dialog>
    ));
  });
}

// Small confirmation (deleting a comment): 324 wide, centred, title 16/600,
// a full-width red button over a cancel button.
// Deleting a view: the same box with the red word on an outlined button, and for a
// form a grey note under the title.
export function confirmSmall(title: string, confirmLabel = t("삭제"), { message, outline = false }: { message?: string; outline?: boolean } = {}): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    mountTransient(close => {
      const done = (value: boolean) => { if (settled) return; settled = true; close(); resolve(value); };
      return (
        <Popover anchor={{ x: window.innerWidth / 2 - 162, y: window.innerHeight / 2 - 72 }} placement="point" onClose={() => done(false)} modal className="confirm-small" label={title}>
          <div className="confirm-small-title">{title}</div>
          {message ? <div className="confirm-small-message">{message}</div> : null}
          <button type="button" className={`confirm-small-ok${outline ? ' outline' : ''}`} autoFocus onClick={() => done(true)}>{confirmLabel}</button>
          <button type="button" className="confirm-small-cancel" onClick={() => done(false)}>{t("취소")}</button>
        </Popover>
      );
    });
  });
}
