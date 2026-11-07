import { t } from '../i18n';
import { api } from './api';

// Opened as the downloadable app (Inkacre.app, Inkacre.exe, ./inkacre): the server says so in /api/setup, and the
// workspace menu then offers to quit it — the app runs in the background with no window of its own to close.
let known: Promise<boolean> | null = null;
export function isDesktopApp(): Promise<boolean> {
  known ??= fetch('/api/setup').then(response => response.json()).then(setup => setup?.app === true, () => false);
  return known;
}

/** Stops the app (every workspace) and leaves a note in place of the page; opening the app again starts it. */
export async function quitApp() {
  await api('/api/quit', {});
  const note = document.createElement('div');
  note.className = 'app-quit-note';
  note.setAttribute('role', 'status');
  const title = document.createElement('strong'), text = document.createElement('p');
  title.textContent = t("Inkacre를 껐습니다");
  text.textContent = t("다시 쓰려면 Inkacre 앱을 여세요. 이 탭은 닫아도 됩니다.");
  note.append(title, text);
  document.body.append(note);
}
