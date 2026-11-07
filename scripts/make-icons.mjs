// Draws the app icons for the downloadable packages from the app mark (web/app/favicon.svg) and writes them to
// packaging/icons/: AppIcon.icns (macOS, the mark on the standard rounded-square canvas), inkacre.ico (Windows) and
// inkacre.png (Linux); and the macOS disk image's window background (packaging/macos/dmg-background*.png and @2x:
// drag the app onto Applications — and, on the one for unsigned builds, how to allow it the first time). Run once
// after the mark or the wording changes; the packages use the files as they are in git.
// 사용법: node scripts/make-icons.mjs   (needs Playwright: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP } from '../src/app-info.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'packaging', 'icons');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const mark = readFileSync(path.join(root, 'web', 'app', 'favicon.svg'), 'utf8');
const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// The mark's square is x 1…47 of a 48 grid. Full bleed for Windows and Linux; for macOS the square sits in the
// 824-pt body of a 1024 canvas with a soft shadow below, as macOS app icons do.
const fullBleed = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="1 1 46 46">${inner}</svg>`;
const mac = size => {
  const scale = 824 / 46, offset = 100 - scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/></filter></defs>
    <g filter="url(#s)"><g transform="translate(${offset} ${offset}) scale(${scale})">${inner.replace('rx="11"', 'rx="10.3"')}</g></g></svg>`;
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// .icns: "icns", total length, then (type, length incl. 8-byte header, PNG) for each size.
const icnsTypes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
const entries = [];
for (const [type, size] of icnsTypes) {
  const data = await png(mac(size), size), head = Buffer.alloc(8);
  head.write(type, 0, 'ascii'); head.writeUInt32BE(data.length + 8, 4);
  entries.push(head, data);
}
const body = Buffer.concat(entries), icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii'); icnsHead.writeUInt32BE(body.length + 8, 4);

// .ico: ICONDIR, one 16-byte entry per size, then the PNGs (PNG-in-ICO, read by Windows Vista and later).
const icoSizes = [16, 24, 32, 48, 64, 128, 256], images = [];
for (const size of icoSizes) images.push(await png(fullBleed(size), size));
const dir = Buffer.alloc(6 + 16 * icoSizes.length);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(icoSizes.length, 4);
let offset = dir.length;
icoSizes.forEach((size, index) => {
  const at = 6 + 16 * index;
  dir.writeUInt8(size >= 256 ? 0 : size, at); dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
  dir.writeUInt16LE(1, at + 4); dir.writeUInt16LE(32, at + 6);
  dir.writeUInt32LE(images[index].length, at + 8); dir.writeUInt32LE(offset, at + 12);
  offset += images[index].length;
});

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'AppIcon.icns'), Buffer.concat([icnsHead, body]));
writeFileSync(path.join(out, 'inkacre.ico'), Buffer.concat([dir, ...images]));
writeFileSync(path.join(out, 'inkacre.png'), await png(fullBleed(512), 512));

// The disk image window (600×400): the app at x 160 and Applications at x 440 (icon centres, y 180, 128-pt icons with
// their names below, both placed by scripts/package.mjs), an arrow between them, a line above and a note below.
const background = note => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#fffaf1"/>
  <text x="300" y="62" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="17" font-weight="600" fill="#302536">Drag ${APP.name} to Applications</text>
  <path d="M244 180H350" fill="none" stroke="#6b4b9f" stroke-width="3" stroke-linecap="round"/>
  <path d="M338 168L354 180L338 192" fill="none" stroke="#6b4b9f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  ${note ? `<text x="300" y="330" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="12" fill="#665a6e">The first time, macOS asks: open System Settings › Privacy &amp; Security</text>
  <text x="300" y="348" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="12" fill="#665a6e">and choose Open Anyway next to the app.</text>` : ''}
</svg>`;
const shot = async (scale, note) => {
  const view = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 600, height: 400 } });
  await view.setContent(`<html><body style="margin:0">${background(note)}</body></html>`);
  const bytes = await view.screenshot({ clip: { x: 0, y: 0, width: 600, height: 400 } });
  await view.close();
  return bytes;
};
for (const [file, note] of [['dmg-background', false], ['dmg-background-unsigned', true]]) {
  writeFileSync(path.join(root, 'packaging', 'macos', `${file}.png`), await shot(1, note));
  writeFileSync(path.join(root, 'packaging', 'macos', `${file}@2x.png`), await shot(2, note));
}
await browser.close();
console.log(`icons → ${path.relative(root, out)}`);
