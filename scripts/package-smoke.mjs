// Opens a built package the way a person would (its launcher, not node directly) on an empty data folder and checks
// that it answers, that opening it again finds the running copy instead of starting a second one, and that "quit"
// stops it. Used by the release workflow on each system.  사용법: node scripts/package-smoke.mjs dist[/<package folder>]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { APP } from '../src/app-info.mjs';

// The launcher in a package folder, or in the one package folder inside the folder given (dist/).
const given = path.resolve(process.argv[2] ?? 'dist');
const launcherIn = folder => [
  path.join(folder, APP.name + '.app', 'Contents', 'MacOS', APP.name),
  path.join(folder, APP.name, APP.name + '.exe'),
  path.join(folder, APP.command, APP.command),
].find(existsSync);
const launcher = launcherIn(given) ?? readdirSync(given, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => launcherIn(path.join(given, entry.name))).find(Boolean);
if (!launcher) throw new Error(`No launcher in ${given}`);
const data = mkdtempSync(path.join(tmpdir(), 'inkacre-package-'));
const env = { ...process.env, LOCAL_WORKSPACE_DATA: data, PAGEYARD_HEADLESS: '1' };
let failures = 0;
const annotate = text => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=Package check::${text.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`); };
const ok = (name, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!pass) { failures++; annotate(`${name}${detail ? ` — ${detail}` : ''}`); } };
const open = () => new Promise(resolve => {
  const started = Date.now(), child = spawn(launcher, [], { env, stdio: 'inherit' });
  child.on('exit', code => resolve({ code, ms: Date.now() - started }));
  child.on('error', error => resolve({ code: -1, error }));
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const appFile = () => JSON.parse(readFileSync(path.join(data, 'app.json'), 'utf8'));

try {
  const resources = process.platform === 'darwin'
    ? path.resolve(path.dirname(launcher), '..', 'Resources')
    : path.dirname(launcher);
  const nodeLicense = readFileSync(path.join(resources, 'runtime', 'LICENSE'), 'utf8');
  ok('the bundled Node license is present', nodeLicense.startsWith('Node.js is licensed for use as follows:'));
  const uiNotices = readFileSync(path.join(resources, 'app', 'web', 'app', 'THIRD_PARTY_NOTICES.md'), 'utf8');
  ok('the bundled UI licenses are present', uiNotices.includes('react - ') && uiNotices.includes('prosemirror-view - '));
  ok('vendored browser bundle notices are present', existsSync(path.join(resources, 'app', 'web', 'vendor', 'THIRD_PARTY_NOTICES.txt')));
  const projectLicense = readFileSync(path.join(resources, 'app', 'LICENSE'), 'utf8');
  ok('the Inkacre license is present', projectLicense.startsWith('MIT License'));
  const first = await open();
  ok('the launcher starts Inkacre and returns', first.code === 0, `exit ${first.code} after ${first.ms} ms${first.error ? ` ${first.error.message}` : ''}`);
  const { port } = appFile(), base = `http://127.0.0.1:${port}`;
  const health = await (await fetch(`${base}/api/health`)).json();
  ok('it answers on the port it kept', health.status === 'ok', `port ${port}`);
  const page = await fetch(`${base}/`), html = await page.text();
  ok('the interface loads', page.ok && html.includes('id="root"') && (await fetch(`${base}/app/app.js`)).ok);
  const setup = await (await fetch(`${base}/api/setup`)).json();
  ok('it knows it was opened as the app (the menu offers quitting)', setup.app === true);
  const again = await open();
  ok('opening it again finds the running copy', again.code === 0 && appFile().port === port && (await (await fetch(`${base}/api/health`)).json()).instance === health.instance);
  const quit = await fetch(`${base}/api/quit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
  ok('quit is accepted', quit.ok, `status ${quit.status}`);
  let stopped = false;
  for (let tries = 0; tries < 50 && !stopped; tries++) { await wait(200); stopped = await fetch(`${base}/api/health`).then(() => false, () => true); }
  ok('it stops', stopped);
} catch (error) {
  ok('no error', false, error.stack ?? String(error));
  try { const log = readFileSync(path.join(data, 'logs', 'pageyard.log'), 'utf8').slice(-3000); console.log(log); annotate(`log: ${log}`); } catch { /* no log */ }
} finally {
  rmSync(data, { recursive: true, force: true });
}
console.log(failures ? `${failures} FAIL` : 'ALL PASS');
process.exit(failures ? 1 : 0);
