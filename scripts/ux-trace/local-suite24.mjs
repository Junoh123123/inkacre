// 20차: first run. An empty workspace opens on the welcome screen (language preselected from the browser or --lang);
// "안내와 예시로 시작" makes five pages in that language as one command (시작하기 · 할 일 DB with 표/보드/캘린더 · 빠른 메모 ·
// 독서 목록 갤러리 · AI 에이전트 연결하기, its steps numbered 1–4), "빈 워크스페이스" makes nothing, and the screen
// does not come back. The week starts on the browser region's first day. Starts its own servers on empty folders.
// 사용법: node scripts/ux-trace/local-suite24.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite24-'));
const servers = [];
async function serve(name, port, extra = []) {
  const child = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', path.join(folder, name), '--port', String(port), '--no-open', ...extra], { stdio: 'ignore' });
  servers.push(child);
  for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/state`)).ok) return `http://127.0.0.1:${port}`; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`server ${name} did not start`);
}
const base = 4400 + Math.floor(Math.random() * 500);
const [en, ko, de, ja] = [await serve('en', base), await serve('ko', base + 1), await serve('de', base + 2), await serve('ja', base + 3, ['--lang', 'ja'])];
const browser = await chromium.launch();
const errors = [];
async function open(url, locale) {
  const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  return page;
}
const welcome = page => page.evaluate(() => { const w = document.querySelector('.welcome'); return w ? { title: w.querySelector('h1').textContent, lang: w.querySelector('select').value, options: w.querySelectorAll('select option').length, choices: w.querySelectorAll('.welcome-choice').length, start: w.querySelector('.welcome-start').textContent } : null; });
const sidebar = page => page.evaluate(() => [...document.querySelectorAll('.sidebar-row[data-tree-id]')].map(e => e.textContent.trim()));
const state = async url => (await fetch(`${url}/api/state`)).json();

// 1. English browser: welcome in English, 9 languages, two choices; the guide makes five pages in one command.
{
  const page = await open(en, 'en-US');
  const shown = await welcome(page);
  const before = (await state(en)).revision;
  await page.locator('.welcome-start').click(); await page.waitForTimeout(1500);
  const after = await state(en);
  const titles = await sidebar(page);
  const opened = await page.evaluate(() => document.querySelector('.page-title')?.textContent ?? document.querySelector('h1')?.textContent);
  ok('en-US: welcome "Welcome to Inkacre" · English preselected · 9 languages · 2 choices; Get started → 5 pages (one command, revision 0 → 1), Getting started opens',
    shown?.title === 'Welcome to Inkacre' && shown.lang === 'en' && shown.options === 9 && shown.choices === 2 && shown.start === 'Get started' && before === 0 && after.revision === 1
      && titles.join('|') === '🧭Getting started|✅Tasks|📝Quick note|📚Reading list|🤖Connect an AI agent' && opened === 'Getting started',
    `${JSON.stringify(shown)} ${before}→${after.revision} ${titles} ${opened}`);
  const foot = await page.evaluate(() => ({ name: document.querySelector('.workspace-switcher .workspace-name')?.textContent, mark: !!document.querySelector('.workspace-switcher svg.app-mark'), favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') }));
  const favicon = await fetch(`${en}/app/favicon.svg`);
  ok('no name given → "My workspace" with Inkacre\'s mark (not a first letter), favicon served', foot.name === 'My workspace' && foot.mark && foot.favicon === '/app/favicon.svg' && favicon.ok && /svg/.test(favicon.headers.get('content-type') ?? ''), JSON.stringify(foot));
  await page.locator('.sidebar-row[data-tree-id]').nth(1).click(); await page.waitForTimeout(1000);
  const db = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('button.db-tab')].map(e => e.textContent).join('|'), rows: document.querySelectorAll('.table-row').length }));
  await page.locator('.sidebar-row[data-tree-id]').nth(3).click(); await page.waitForTimeout(1000);
  const gallery = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('button.db-tab')].map(e => e.textContent).join('|'), cards: document.querySelectorAll('.row-card').length }));
  ok('Tasks: Table · Board · Calendar, 4 rows; Reading list: Gallery · Table, 3 cards', db.tabs === 'Table|Board|Calendar' && db.rows === 4 && gallery.tabs === 'Gallery|Table' && gallery.cards === 3, `${JSON.stringify(db)} ${JSON.stringify(gallery)}`);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('reload: no welcome once pages exist', !(await welcome(page)));
  await page.close();
}

// 2. Korean browser: Korean pages; the agent page's steps number 1–4 with the code inside steps 1 and 3.
{
  const page = await open(ko, 'ko-KR');
  const shown = await welcome(page);
  await page.locator('.welcome-name input').fill('준오의 노트');
  await page.locator('.welcome-start').click(); await page.waitForTimeout(1500);
  const named = (await state(ko)).objects.find(item => item.id === 'workspace-settings');
  const switcherName = await page.locator('.workspace-switcher .workspace-name').textContent().catch(() => '');
  ok('환영 화면에서 워크스페이스 이름 입력 → 저장되고 사이드바 아래에 표시', named?.name === '준오의 노트' && switcherName === '준오의 노트', `${named?.name} ${switcherName}`);
  const titles = await sidebar(page);
  await page.locator('.sidebar-row[data-tree-id]').nth(4).click(); await page.waitForTimeout(1000);
  const steps = await page.evaluate(() => [...document.querySelectorAll('.page-editor [data-block-type="numbered"], .page-editor .block-numbered')].length);
  const codes = await page.evaluate(() => document.querySelectorAll('.page-editor pre, .page-editor .code-block').length);
  ok('ko-KR: 환영 화면 한국어 · 시작하기 · 할 일 · 빠른 메모 · 독서 목록 · AI 에이전트 연결하기, 연결 방법 번호 4개 · 코드 2개',
    shown?.title === 'Inkacre에 오신 것을 환영합니다' && shown.lang === 'ko' && titles.join('|') === '🧭시작하기|✅할 일|📝빠른 메모|📚독서 목록|🤖AI 에이전트 연결하기' && steps >= 4 && codes === 2,
    `${shown?.title} ${titles} steps=${steps} codes=${codes}`);
  await page.close();
}

// 3. German browser, empty workspace: nothing is made, the week starts on Monday, and the screen stays away.
{
  const page = await open(de, 'de-DE');
  const shown = await welcome(page);
  await page.locator('.welcome-choice').nth(1).click(); await page.locator('.welcome-start').click(); await page.waitForTimeout(800);
  const after = await state(de);
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('pageyard-settings-v1') ?? '{}'));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('de-DE: "Willkommen…", Leerer Workspace → no objects (revision 0), week starts Monday, no welcome after reload',
    shown?.lang === 'de' && after.revision === 0 && after.objects.length === 0 && settings.weekStartsMonday === true && !(await welcome(page)), `${JSON.stringify(shown)} rev=${after.revision} ${JSON.stringify(settings)}`);
  await page.close();
}

// 4. --lang ja on the command line preselects Japanese for a browser that has not chosen one.
{
  const page = await open(ja, 'en-US');
  await page.waitForTimeout(800);
  const shown = await welcome(page);
  ok('--lang ja: welcome in Japanese for an English browser', shown?.lang === 'ja' && shown.title === 'Inkacreへようこそ', JSON.stringify(shown));
  await page.close();
}

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
for (const child of servers) child.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
