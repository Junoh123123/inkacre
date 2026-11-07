import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Bundles every ui/src/i18n/locales/<code>.json into one compact module: the message keys once (the Korean source
// strings, in en.json's order) and, per language, the translations in that order. Adding a language is adding a
// file — its "$meta" names it ({ "code", "name", "english", "intl" }).
const ID = 'virtual:locales', RESOLVED = '\0virtual:locales';

export function localesPlugin(dir) {
  return {
    name: 'pageyard-locales',
    resolveId(id) { return id === ID ? RESOLVED : null; },
    load(id) {
      if (id !== RESOLVED) return null;
      const files = readdirSync(dir).filter(file => file.endsWith('.json')).sort();
      const all = files.map(file => { this.addWatchFile(join(dir, file)); return JSON.parse(readFileSync(join(dir, file), 'utf8')); });
      const english = all.find(locale => locale.$meta?.code === 'en') ?? {};
      const keys = Object.keys(english).filter(key => key !== '$meta');
      const seen = new Set(keys);
      for (const locale of all) for (const key of Object.keys(locale)) if (key !== '$meta' && !seen.has(key)) { seen.add(key); keys.push(key); }
      const languages = all.map(locale => locale.$meta).filter(Boolean);
      const values = Object.fromEntries(all.filter(locale => locale.$meta).map(locale => [locale.$meta.code, keys.map(key => typeof locale[key] === 'string' ? locale[key] : null)]));
      return `export const languages = ${JSON.stringify(languages)};\nexport const keys = ${JSON.stringify(keys)};\nexport const values = ${JSON.stringify(values)};\n`;
    },
  };
}
