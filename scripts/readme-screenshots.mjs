// The README's screenshots, made the same way every time: a fresh workspace in English (the welcome screen with the
// guide and examples), then a few linked pages, a PDF to search inside, and a change for the time machine.
// 사용법: node scripts/readme-screenshots.mjs   (writes docs/screenshots/*.png; needs Playwright with Chromium)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'screenshots');
const folder = mkdtempSync(path.join(tmpdir(), 'pageyard-shots-'));
const port = 9611, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open', '--lang', 'en'], { stdio: 'ignore' });
process.on('exit', () => { server.kill(); rmSync(folder, { recursive: true, force: true }); });
for (let tries = 0; tries < 60; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async (route, body) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text()); return response.json(); };
const apply = async operations => post('/api/commands', { id: `shot-${Date.now()}-${Math.random()}`, actor: 'user', expectedRevision: (await state()).revision, operations });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: 'light' });
const page = await context.newPage();
const shot = async name => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log(`docs/screenshots/${name}.png`); };

// 1. Welcome, then the guide and examples.
await page.goto(base, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await page.locator('.welcome-name input').fill('My notes');
await shot('welcome');
await page.locator('.welcome-start').click(); await page.waitForTimeout(2500);
const pages = (await state()).objects.filter(item => item.kind === 'page' && !item.sourceId && item.parentId === null);
const byTitle = title => pages.find(item => item.title === title)?.id;
await page.goto(`${base}/?id=${byTitle('Getting started')}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
await shot('page');
await page.goto(`${base}/?id=${byTitle('Tasks')}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
await page.locator('.db-tab[role="tab"]', { hasText: 'Board' }).first().click(); await page.waitForTimeout(1200);
await shot('board');

// 2. Notes that link to each other, a PDF attached to one of them, and a page changed after a while.
const pdf = await (async () => {
  const maker = await context.newPage();
  await maker.setContent('<html><body style="font-family:Georgia,serif;padding:40px"><h1>Apartment lease</h1><p>The tenant must give 60 days notice in writing before moving out.</p><p>Rent is due on the first day of each month.</p></body></html>');
  const bytes = await maker.pdf({ format: 'A4' }); await maker.close(); return bytes;
})();
const titles = {};
const link = (from, n, to, words) => ({ type: 'block.create', id: `${from}-${n}`, parentId: from, blockType: 'paragraph', richText: [{ text: `${words} ` }, { text: titles[to], pageId: to }] });
const note = (id, title, parentId = null) => { titles[id] = title; return { type: 'page.create', id, title, parentId }; };
const notes = [
  note('n-work', 'Work'), note('n-study', 'Study'), note('n-home', 'Home'),
  note('n-plan', 'Quarter plan', 'n-work'), note('n-oct', 'Meeting notes, Oct', 'n-work'), note('n-nov', 'Meeting notes, Nov', 'n-work'), note('n-ideas', 'Product ideas', 'n-work'), note('n-comp', 'Competitor review', 'n-work'), note('n-hire', 'Hiring notes', 'n-work'),
  note('n-pharm', 'Pharmacology', 'n-study'), note('n-inter', 'Drug interactions', 'n-study'), note('n-exam', 'Exam schedule', 'n-study'), note('n-seminar', 'Paper seminar', 'n-study'), note('n-read', 'Papers to read', 'n-study'),
  note('n-trip', 'Trip plan', 'n-home'), note('n-budget', 'Budget', 'n-home'), note('n-apt', 'Apartment', 'n-home'), note('n-gym', 'Workouts', 'n-home'),
];
await apply([...notes,
  link('n-plan', 1, 'n-ideas', 'Goals from'), link('n-plan', 2, 'n-comp', 'See'), link('n-oct', 1, 'n-plan', 'Updated'), link('n-nov', 1, 'n-plan', 'Progress on'), link('n-nov', 2, 'n-hire', 'Next:'),
  link('n-ideas', 1, 'n-comp', 'Compare with'), link('n-ideas', 2, 'n-inter', 'Backed by'), link('n-pharm', 1, 'n-inter', 'Next chapter:'), link('n-seminar', 1, 'n-read', 'Presenting from'), link('n-seminar', 2, 'n-pharm', 'Background:'),
  link('n-exam', 1, 'n-seminar', 'Seminar date in'), link('n-exam', 2, 'n-trip', 'After exams:'), link('n-trip', 1, 'n-budget', 'Budget in'), link('n-apt', 1, 'n-budget', 'Rent in'), link('n-gym', 1, 'n-budget', 'Membership in'),
]);
const attached = await post('/api/attachments', { commandId: `pdf-${Date.now()}`, actor: 'user', expectedRevision: (await state()).revision, name: 'Lease agreement.pdf', mediaType: 'application/pdf', base64: Buffer.from(pdf).toString('base64') });
await apply([{ type: 'block.create', id: 'n-apt-pdf', parentId: 'n-apt', blockType: 'pdf', attachmentId: attached.attachmentId }]);
await apply([{ type: 'block.create', id: 'n-plan-goal', parentId: 'n-plan', blockType: 'paragraph', richText: [{ text: 'Ship the offline search in November.' }] }]);
const then = (await state()).revision;
await new Promise(resolve => setTimeout(resolve, 1200));
await apply([{ type: 'block.update', id: 'n-plan-goal', richText: [{ text: 'Ship offline search and the link map in December.' }] }]);
for (let tries = 0; tries < 60; tries++) { const status = await (await fetch(`${base}/api/file-text`)).json(); if (status.indexed >= 1 && !status.pending) break; await new Promise(resolve => setTimeout(resolve, 250)); }

// 3. The link map, a search that finds words inside the PDF, and the time machine.
await page.goto(`${base}/?graph=1`, { waitUntil: 'networkidle' }); await page.waitForTimeout(4000);
await shot('graph');
await page.goto(`${base}/?id=n-apt`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
await page.keyboard.press('Control+k'); await page.waitForTimeout(400);
await page.locator('.search-input').fill('60 days notice'); await page.waitForTimeout(1200);
await shot('search');
await page.keyboard.press('Escape');
await page.goto(`${base}/?at=${then}&id=n-plan`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
await shot('time-machine');
await browser.close();
process.exit(0);
