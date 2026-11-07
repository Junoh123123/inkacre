import { t } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover, type Anchor, type Placement } from './overlay';

// "이름 바꾸기" opened from a menu: a small panel with the icon button and the name selected in a
// text box. Changes stay when the panel closes (Enter, Esc or a click elsewhere), as if saved
// while typing:
//   sidebar tab  — 280 wide, padding 8, 28×28 icon button (1px line, r6), 8 gap, the box tinted
//                  rgba(66,35,3,.03) with a blue ring, r6, placeholder "탭 이름".
//   sidebar page — 380×36, padding 4px 8px, the box 1px line, r4, padding 4px 10px.
export function RenamePopover({ anchor, placement = 'below-start', offset = 4, icon, iconLabel = t("아이콘 변경"), onIcon, value, placeholder, onCommit, onClose, variant = 'page' }: {
  anchor: Anchor; placement?: Placement; offset?: number; icon: ReactNode; iconLabel?: string; onIcon?: (button: HTMLElement) => void;
  value: string; placeholder?: string; onCommit: (value: string) => void; onClose: () => void; variant?: 'page' | 'tab';
}) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(text);
  latest.current = text;
  const done = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    if (latest.current !== value) onCommit(latest.current);
    onClose();
  };
  return (
    <Popover anchor={anchor} placement={placement} offset={offset} onClose={finish} className={`rename-popover rename-${variant}`} label={t("이름 바꾸기")}>
      <button type="button" className="rename-icon" aria-label={iconLabel} title={iconLabel} onClick={event => onIcon?.(event.currentTarget)}>{icon}</button>
      <span className="rename-box">
        <input ref={input} className="rename-input" value={text} placeholder={placeholder} aria-label={placeholder ?? t("이름")}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); }
          }} />
      </span>
    </Popover>
  );
}
