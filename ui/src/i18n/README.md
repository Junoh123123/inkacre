# Interface languages

The app ships in English (default for new installs), 한국어, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch and
Português (Brasil). People pick a language in **Settings → Language & time → Language**; the page reloads in that
language. A browser with no saved choice starts in the first of its preferred languages the app has, else English.
(Browsers that already used this app before languages existed keep Korean.)

## How messages work

The interface was written in Korean, so each message is looked up by its Korean text:

```ts
import { t, tx } from '../i18n';

t('새 페이지')                         // "New page"
t('{0}개 선택됨', [count])             // "{0} selected" → "3 selected"
tx('{0}의 모든 페이지', [<button …/>]) // placeholders may be React nodes
t('status-group|완료')                 // a context tag ("status-group|") separates same words with different meanings
```

- `{0}`, `{1}`… are filled in order. Translations may move them anywhere.
- After a placeholder, Korean particles written as `을(를)`, `이(가)`, `은(는)`, `와(과)`, `(으)로`, `(이)라` are settled
  from the value at runtime (Korean only); other languages simply leave them out.
- Dates, times and numbers come from `Intl` with the language's locale (`$meta.intl`), not from messages.
- Errors the engine sends back are Korean too; `translateServerMessage()` maps them (with their values) through the
  same files.

## Adding or improving a language

1. Copy `locales/en.json` to `locales/<code>.json` (a BCP 47 code such as `it` or `pt-PT`) and set its `$meta`:
   `{ "code": "it", "name": "Italiano", "english": "Italian", "intl": "it-IT" }`. The build picks the file up by itself;
   no other file needs changing.
2. Translate the values (the keys stay Korean). Keep every `{n}` placeholder; drop Korean particles; keep shortcuts,
   symbols and product names. Where your language already has a widely used word for a label, use it.
3. Check it: `node scripts/i18n/check.mjs <code>` lists missing keys and placeholder mistakes.
4. Build (`cd ui && npm run build`) and switch to the language in Settings.

## Changing interface text in code

Wrap new user-visible text in `t()` / `tx()` with the Korean text as the key, then run
`node scripts/i18n/extract.mjs` (updates `keys.json`) and `node scripts/i18n/check.mjs` to see which languages need the
new keys. Missing translations fall back to English, then to the Korean key.
