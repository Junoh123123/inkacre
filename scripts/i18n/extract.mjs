// Collects every interface message key — t("…") / tx("…") in ui/src and the Korean messages the engine (src/*.mjs)
// sends back — into ui/src/i18n/keys.json with where each is used. Run after changing interface text:
//   node scripts/i18n/extract.mjs
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ts = createRequire(join(root, 'ui/package.json'))('typescript');
const HANGUL = /[가-힣]/;
const keys = new Map();
const note = (key, at, server = false) => { const entry = keys.get(key) ?? { key, at: [], server }; if (!server) entry.server = false; if (entry.at.length < 6) entry.at.push(at); keys.set(key, entry); };

const walk = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? (name === 'i18n' ? [] : walk(path)) : /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []; });
for (const file of walk(join(root, 'ui/src'))) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['t', 'tx', 'tr', 'trx'].includes(node.expression.text)) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) note(first.text, `ui/src/${relative(join(root, 'ui/src'), file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
// Engine messages: Korean string literals, and template literals with {0}, {1}… for their values.
// (web/paste-blocks.mjs and web/table-grid.mjs are shared helpers the interface imports; their errors show as-is.)
const skip = new Set(['seed.mjs', 'mcp.mjs']);
const engineFiles = [...readdirSync(join(root, 'src')).filter(name => name.endsWith('.mjs') && !skip.has(name)).map(name => `src/${name}`), 'web/paste-blocks.mjs', 'web/table-grid.mjs'];
for (const name of engineFiles) {
  const text = readFileSync(join(root, name), 'utf8');
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const at = node => `${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = node => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && HANGUL.test(node.text)) { note(node.text, at(node), true); return; }
    if (ts.isTemplateExpression(node) && (HANGUL.test(node.head.text) || node.templateSpans.some(span => HANGUL.test(span.literal.text)))) {
      let key = node.head.text;
      node.templateSpans.forEach((span, index) => { key += `{${index}}${span.literal.text}`; });
      note(key, at(node), true);
      node.templateSpans.forEach(span => visit(span.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const list = [...keys.values()];
writeFileSync(join(root, 'ui/src/i18n/keys.json'), `${JSON.stringify(list, null, 1)}\n`);
console.log(`${list.length} keys (${list.filter(entry => entry.server).length} from the engine) → ui/src/i18n/keys.json`);
