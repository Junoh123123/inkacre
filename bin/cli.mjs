#!/usr/bin/env node
// Command line entry: `inkacre [start] [--port 4141] [--data DIR] [--lang ko] [--no-open]`, plus `app` (what the
// downloadable app runs: in the background, then the browser), `mcp`, `restore` and `capture` (빠른 기록: a line,
// to-do or database row into the running app).
// Works the same from a clone (./app-local), `npx`, a global install or the Docker image.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// node:sqlite with backup() arrived in Node 22.16; 24 (current LTS) is recommended.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16)) {
  console.error(`Node.js 22.16 or newer is needed (24 recommended; this is ${process.versions.node}). Install it from https://nodejs.org and run again.`);
  process.exit(1);
}
// node:sqlite still prints an "experimental" notice on Node 24; it is stable enough here and the notice only confuses.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => (/SQLite/.test(String(warning?.message ?? warning)) ? undefined : emitWarning.call(process, warning, ...rest));

const { APP, defaultDataDirectory, instanceId } = await import('../src/app-info.mjs');
const LANGUAGES = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt-BR'];
const HELP = `${APP.name} — a local workspace for pages, blocks and databases

Usage
  ${APP.command} [start] [options]     run the app and open it in your browser
  ${APP.command} app [--data <folder>]  run it in the background (or find it running) and open the browser
  ${APP.command} mcp                   MCP server for AI agents (talks to the running app)
  ${APP.command} restore --from BACKUP --to NEW_FOLDER
  ${APP.command} capture [--to PAGE] [--todo | --bullet] TEXT…        add a line to a page (default: Settings › Quick capture)
  ${APP.command} capture --db DATABASE [--prop NAME=VALUE]… TITLE      add a row to a database
                                                         (TEXT can come from stdin; --port PORT for another copy)
                                 (text can also come on standard input; --port picks another running app)

Options
  --port <number>   port to listen on (default ${APP.defaultPort}, or LOCAL_WORKSPACE_PORT)
  --data <folder>   where your workspace is kept (or LOCAL_WORKSPACE_DATA)
                    default: ${defaultDataDirectory()}
  --lang <code>     language for the first-run screen and starter pages: ${LANGUAGES.join(', ')}
  --host <address>  network address to bind (default 127.0.0.1; containers use 0.0.0.0)
  --no-open         don't open the browser
  -v, --version     print the version
  -h, --help        print this help`;

function parse(argv) {
  const options = { command: 'start', open: true };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) options.command = rest.shift();
  if (options.command === 'capture') { options.passthrough = rest; return options; }
  while (rest.length) {
    const flag = rest.shift();
    const value = () => { const next = rest.shift(); if (next === undefined || next.startsWith('--')) fail(`${flag} needs a value.`); return next; };
    if (flag === '--port') options.port = Number(value());
    else if (flag === '--data') options.data = value();
    else if (flag === '--lang') options.lang = value();
    else if (flag === '--host') options.host = value();
    else if (flag === '--no-open') options.open = false;
    else if (flag === '--app') options.app = true;
    else if (flag === '-h' || flag === '--help') options.command = 'help';
    else if (flag === '-v' || flag === '--version') options.command = 'version';
    else if (options.command === 'restore' || options.command === 'mcp') (options.passthrough ??= []).push(flag);
    else fail(`Unknown option: ${flag}\n\n${HELP}`);
  }
  return options;
}
function fail(message) { console.error(message); process.exit(2); }

// Data folder: --data, then LOCAL_WORKSPACE_DATA, then a folder already beside the app from before this command
// existed — data-live/ (the daily copy made by scripts/migrate-live-copy.mjs) before data/ (kept as the archive) —
// then the platform's application data folder.
function dataDirectory(options) {
  if (options.data) return path.resolve(options.data);
  if (process.env.LOCAL_WORKSPACE_DATA) return path.resolve(process.env.LOCAL_WORKSPACE_DATA);
  for (const name of ['data-live', 'data']) {
    const legacy = path.join(root, name);
    if (existsSync(path.join(legacy, 'workspace.sqlite'))) return legacy;
  }
  return defaultDataDirectory();
}

function openBrowser(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  try { spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* no browser here */ }
}

async function alreadyRunning(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1500) });
    return response.ok && typeof (await response.json()).revision === 'number';
  } catch { return false; }
}

async function start(options) {
  const port = options.port ?? Number(process.env.LOCAL_WORKSPACE_PORT ?? APP.defaultPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Not a port number: ${options.port}`);
  const host = options.host ?? process.env.LOCAL_WORKSPACE_HOST ?? '127.0.0.1';
  if (options.lang) {
    if (!LANGUAGES.includes(options.lang)) fail(`Unknown language "${options.lang}". Choose one of: ${LANGUAGES.join(', ')}`);
    process.env.LOCAL_WORKSPACE_LANG = options.lang;
  }
  const directory = dataDirectory(options);
  const { startLocalServer } = await import('../src/server.mjs');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const { server } = startLocalServer({
    directory, port, host, app: !!options.app,
    onListening: listening => {
      const url = `http://127.0.0.1:${listening.address().port}`;
      console.log(`${APP.name} is running at ${url}\nData folder: ${directory}\nPress Ctrl+C to stop.`);
      if (!loopback) console.log(`Listening on ${host} for a container or proxy. The app has no sign-in: publish the port only to this computer (for example -p 127.0.0.1:${listening.address().port}:${listening.address().port}).`);
      if (options.open && loopback && process.stdout.isTTY) openBrowser(url);
    },
  });
  server.on('error', async error => {
    if (error.code === 'EADDRINUSE' && await alreadyRunning(port)) {
      const url = `http://127.0.0.1:${port}`;
      console.log(`${APP.name} is already running at ${url}`);
      if (options.open && process.stdout.isTTY) openBrowser(url);
      process.exit(0);
    }
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is used by another program. Try --port ${port + 1}.` : `Could not start: ${error.message}`);
    process.exit(1);
  });
}

// 앱으로 열기 — what the downloadable app runs (packaging/): this data folder's copy if it is already running, else a
// new one in the background (its output in <data>/logs/pageyard.log), then the browser. The port is kept in
// <data>/app.json so the address — and the browser's settings for it — stay the same; when another program (or another
// Inkacre) holds it, the next free one is used. PAGEYARD_HEADLESS=1: no browser and no dialogs (checks, CI).
async function openApp(options) {
  const directory = dataDirectory(options), headless = process.env.PAGEYARD_HEADLESS === '1';
  const tell = message => { console.error(message); if (!headless) dialog(message); process.exit(1); };
  try { mkdirSync(directory, { recursive: true }); } catch (error) { tell(`${APP.name} can't use its data folder ${directory}: ${error.message}`); }
  const instance = instanceId(directory), appFile = path.join(directory, 'app.json');
  let saved = {}; try { saved = JSON.parse(readFileSync(appFile, 'utf8')); } catch { /* first run */ }
  const show = port => {
    try { writeFileSync(appFile, `${JSON.stringify({ ...saved, port }, null, 2)}\n`); } catch { /* kept next time */ }
    console.log(`${APP.name} is running at http://127.0.0.1:${port}\nData folder: ${directory}`);
    if (!headless) openBrowser(`http://127.0.0.1:${port}`);
    process.exit(0);
  };
  let port = options.port ?? saved.port ?? APP.defaultPort, found = false;
  for (let tries = 0; tries < 40 && !found; tries++, port++) {
    const running = await health(port);
    if (running?.instance === instance) return show(port);
    if (!running && await portFree(port)) found = true;
  }
  if (!found) tell(`${APP.name} found no free port from ${options.port ?? saved.port ?? APP.defaultPort} on.`);
  port -= 1;
  const logs = path.join(directory, 'logs'), log = path.join(logs, 'pageyard.log');
  mkdirSync(logs, { recursive: true });
  try { if (statSync(log).size > 2 * 1024 * 1024) renameSync(log, path.join(logs, 'pageyard.1.log')); } catch { /* none yet */ }
  const output = openSync(log, 'a');
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), 'start', '--app', '--no-open', '--port', String(port), '--data', directory],
    { detached: true, stdio: ['ignore', output, output], windowsHide: true });
  let ended = null;
  child.on('exit', code => { ended = code; });
  child.unref();
  for (let waited = 0; waited < 60000 && ended === null; waited += 250) {
    if ((await health(port))?.instance === instance) return show(port);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  let tail = ''; try { tail = readFileSync(log, 'utf8').trim().split('\n').slice(-6).join('\n'); } catch { /* no log */ }
  tell(`${APP.name} did not start.${tail ? `\n\n${tail}` : ''}\n\nLog: ${log}`);
}
async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : {};
  } catch { return null; }
}
function portFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}
// A message box where there is no terminal to read (the app was opened from Finder, Explorer or a desktop menu).
function dialog(message) {
  const text = message.replace(/\s*\n+\s*/g, ' — ');
  try {
    if (process.platform === 'darwin') spawnSync('osascript', ['-e', `display dialog ${JSON.stringify(text)} with title "${APP.name}" buttons {"OK"} default button 1 with icon caution`]);
    else if (process.platform === 'win32') spawnSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${text.replaceAll("'", "''")}', '${APP.name}') | Out-Null`], { windowsHide: true });
    else spawnSync('zenity', ['--error', '--title', APP.name, '--text', text]);
  } catch { /* the message is on stderr */ }
}

// 빠른 기록 from a terminal, a script or a launcher (Raycast, Alfred, Shortcuts' "Run Shell Script").
async function capture(args) {
  const body = { source: 'cli' }, words = [];
  let port = Number(process.env.LOCAL_WORKSPACE_PORT || APP.defaultPort), portGiven = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], value = () => { const next = args[++index]; if (next === undefined) fail(`${flag} needs a value.`); return next; };
    if (flag === '--to') body.to = value();
    else if (flag === '--db') body.database = value();
    else if (flag === '--title') body.title = value();
    else if (flag === '--todo') body.as = 'todo';
    else if (flag === '--bullet') body.as = 'bullet';
    else if (flag === '--port') port = Number(value()), portGiven = true;
    else if (flag === '--prop') { const pair = value(), at = pair.indexOf('='); if (at < 1) fail('--prop needs NAME=VALUE.'); (body.properties ??= {})[pair.slice(0, at)] = pair.slice(at + 1); }
    else if (flag === '--') words.push(...args.slice(index + 1)), index = args.length;
    else if (flag.startsWith('--')) fail(`Unknown option: ${flag}\n\n${HELP}`);
    else words.push(flag);
  }
  let text = words.join(' ');
  if (!text && !process.stdin.isTTY) { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); text = Buffer.concat(chunks).toString('utf8'); }
  body.text = text;
  const base = !portGiven && process.env.LOCAL_WORKSPACE_URL || `http://127.0.0.1:${port}`;
  let response;
  try { response = await fetch(new URL('/api/capture', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { fail(`${APP.name} is not running at ${base}. Start it with \`${APP.command}\` first.`); }
  const data = await response.json();
  if (!response.ok) fail(data.error?.message ?? 'The capture was not saved.');
  console.log(`${body.database ? 'Added a row' : 'Added'} → ${data.title || data.pageId}`);
}

function runScript(script, args) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'src', script), ...args], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 1));
}

const options = parse(process.argv.slice(2));
if (options.command === 'help') console.log(HELP);
else if (options.command === 'version') console.log(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version);
else if (options.command === 'start') await start(options);
else if (options.command === 'app') await openApp(options);
else if (options.command === 'mcp') runScript('mcp.mjs', options.passthrough ?? []);
else if (options.command === 'restore') runScript('restore.mjs', options.passthrough ?? []);
else if (options.command === 'capture') await capture(options.passthrough ?? []);
else fail(`Unknown command: ${options.command}\n\n${HELP}`);
