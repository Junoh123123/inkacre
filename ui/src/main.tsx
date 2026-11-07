import { createRoot } from 'react-dom/client';
import { App } from './shell/App';
import { PrintDocument, isPrintAddress } from './page/PrintDocument';
import './styles/tokens.css';
import './styles/base.css';
import './styles/overlay.css';
import './styles/shell.css';
import './styles/page.css';
import './styles/editor.css';
import './styles/database.css';
import { startLiveUpdates } from './data/store';
import { applyTheme } from './data/settings';

applyTheme();

startLiveUpdates();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.mjs', { type: 'module' }).catch(() => undefined);
createRoot(document.getElementById('root')!).render(isPrintAddress() ? <PrintDocument /> : <App />);
