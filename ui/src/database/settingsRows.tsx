import { t } from '../i18n';
import { useState, type ReactNode } from 'react';
import { Menu } from '../ui/Menu';
import { Icon } from '../ui/Icon';
import { Switch } from '../ui/primitives';

// Rows of the view settings panel: a link row (icon, label, value, ›), a switch row and a value row that
// opens a menu (the chevron turns down while it is open).
export function Row({ icon, label, value, onClick, danger, disabled, chevron = true }: { icon: string; label: string; value?: ReactNode; onClick: (anchor: HTMLElement) => void; danger?: boolean; disabled?: boolean; chevron?: boolean }) {
  return (
    <button type="button" className={`settings-row${danger ? ' danger' : ''}${disabled ? ' disabled' : ''}`} disabled={disabled} onClick={event => onClick(event.currentTarget)}>
      <Icon name={icon} size={20} /><span className="settings-row-label">{label}</span>
      {value !== undefined ? <span className="settings-row-value">{value}</span> : null}
      {chevron && !disabled ? <Icon name="chevron-right" size={14} className="settings-row-chevron" /> : null}
    </button>
  );
}

export function SwitchRow({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (value: boolean) => void; icon?: string }) {
  return <label className="settings-row switch-row">{icon ? <Icon name={icon} size={20} /> : null}<span className="settings-row-label">{label}</span><Switch checked={checked} onChange={onChange} label={label} /></label>;
}

export function ValueRow({ label, value, open, onClick, icon, disabled }: { label: string; value: ReactNode; open?: boolean; onClick: (anchor: HTMLElement) => void; icon?: string; disabled?: boolean }) {
  return (
    <button type="button" className={`settings-row value-row${open ? ' open' : ''}${disabled ? ' disabled' : ''}`} disabled={disabled} onClick={event => onClick(event.currentTarget)}>
      {icon ? <Icon name={icon} size={20} /> : null}<span className="settings-row-label">{label}</span><span className="settings-row-value">{value}</span>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="settings-row-chevron" />
    </button>
  );
}


/** A value row whose menu picks one of a few options (no native selects here). */
export function PickRow({ label, value, options, onChange, width = 220 }: { label: string; value: string; options: Array<{ id: string; name: string; icon?: string }>; onChange: (value: string) => void; width?: number }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = options.find(option => option.id === value);
  return (
    <>
      <ValueRow label={label} value={current?.name ?? ''} open={!!anchor} onClick={setAnchor} />
      {anchor ? <Menu anchor={anchor} placement="below-end" width={width} search={options.length > 8 ? t("검색…") : false} onClose={() => setAnchor(null)}
        entries={options.map(option => ({ label: option.name, icon: option.icon, checked: option.id === value, keywords: option.name, onSelect: () => onChange(option.id) }))} /> : null}
    </>
  );
}
