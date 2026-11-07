// Checks the language files against ui/src/i18n/keys.json: missing and unused keys, and translations whose {0}
// placeholders differ from the key's. node scripts/i18n/check.mjs [code…]   (exit code 1 when something is off)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dir = join(root, 'ui/src/i18n/locales');
const keys = JSON.parse(readFileSync(join(root, 'ui/src/i18n/keys.json'), 'utf8')).map(entry => entry.key);
const wanted = process.argv.slice(2);
const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
let bad = false;
for (const name of readdirSync(dir).filter(name => name.endsWith('.json')).sort()) {
  const locale = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const code = locale.$meta?.code;
  if (!code) { console.log(`${name}: no "$meta" with a code`); bad = true; continue; }
  if (wanted.length && !wanted.includes(code)) continue;
  if (code === 'ko') { console.log(`${code}: source language (keys are Korean)`); continue; }
  const missing = keys.filter(key => typeof locale[key] !== 'string');
  const unused = Object.keys(locale).filter(key => key !== '$meta' && !keys.includes(key));
  const slotErrors = keys.filter(key => typeof locale[key] === 'string' && slots(locale[key]) !== slots(key));
  console.log(`${code}: ${keys.length - missing.length}/${keys.length} translated, ${unused.length} unused, ${slotErrors.length} placeholder mismatches`);
  for (const key of missing.slice(0, 20)) console.log(`  missing: ${JSON.stringify(key)}`);
  for (const key of slotErrors.slice(0, 20)) console.log(`  placeholders: ${JSON.stringify(key)} → ${JSON.stringify(locale[key])}`);
  for (const key of unused.slice(0, 10)) console.log(`  unused: ${JSON.stringify(key)}`);
  if (missing.length || slotErrors.length) bad = true;
}
process.exit(bad ? 1 : 0);
