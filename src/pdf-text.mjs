// 첨부 파일 내용 검색: the words of a PDF, for search — not a renderer. It reads every object (and those packed in
// object streams), decrypts files locked only against changes (an empty open password), walks the pages in order
// and runs each content stream's text operators: fonts mapped to Unicode by their ToUnicode table, a predefined
// Unicode or legacy CJK encoding, or a simple font's encoding and glyph names; lines and spaces from where the text
// is placed. Scanned pages (pictures of text) have no words to find.
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { inflateSync, constants as zlibConstants } from 'node:zlib';

export class PdfTextError extends Error { constructor(code, message) { super(message); this.code = code; } }

class Name { constructor(name) { this.name = name; } }
class Ref { constructor(num, gen) { this.num = num; this.gen = gen; } }
class Op { constructor(op) { this.op = op; } }
const isName = (value, name) => value instanceof Name && (name === undefined || value.name === name);

const SPACE = new Uint8Array(256), DELIMITER = new Uint8Array(256);
for (const code of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) SPACE[code] = 1;
for (const char of '()<>[]{}/%') DELIMITER[char.charCodeAt(0)] = 1;
const hexValue = code => code >= 0x30 && code <= 0x39 ? code - 0x30 : code >= 0x41 && code <= 0x46 ? code - 55 : code >= 0x61 && code <= 0x66 ? code - 87 : -1;

// Tokens of PDF syntax (objects and content streams alike). Strings stay bytes: what they mean depends on the font.
class Lexer {
  constructor(bytes, position = 0, end = bytes.length) { this.bytes = bytes; this.pos = position; this.end = end; this.peeked = []; }
  skip() {
    const { bytes } = this;
    while (this.pos < this.end) {
      const code = bytes[this.pos];
      if (SPACE[code]) this.pos++;
      else if (code === 0x25) { while (this.pos < this.end && bytes[this.pos] !== 0x0a && bytes[this.pos] !== 0x0d) this.pos++; }
      else break;
    }
  }
  token() {
    if (this.peeked.length) return this.peeked.pop();
    this.skip();
    const { bytes } = this;
    if (this.pos >= this.end) return undefined;
    const code = bytes[this.pos];
    if (code === 0x28) return this.literal();
    if (code === 0x3c) {
      if (bytes[this.pos + 1] === 0x3c) { this.pos += 2; return '<<'; }
      return this.hex();
    }
    if (code === 0x3e && bytes[this.pos + 1] === 0x3e) { this.pos += 2; return '>>'; }
    if (code === 0x5b || code === 0x5d || code === 0x7b || code === 0x7d) { this.pos++; return String.fromCharCode(code); }
    if (code === 0x2f) {
      let start = ++this.pos;
      while (this.pos < this.end && !SPACE[bytes[this.pos]] && !DELIMITER[bytes[this.pos]]) this.pos++;
      let name = Buffer.from(bytes.subarray(start, this.pos)).toString('latin1');
      if (name.includes('#')) name = name.replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      return new Name(name);
    }
    const start = this.pos;
    while (this.pos < this.end && !SPACE[bytes[this.pos]] && !DELIMITER[bytes[this.pos]]) this.pos++;
    if (this.pos === start) { this.pos++; return this.token(); }
    const word = Buffer.from(bytes.subarray(start, this.pos)).toString('latin1');
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    return new Op(word);
  }
  unread(token) { this.peeked.push(token); }
  literal() {
    const { bytes } = this, out = [];
    let depth = 1; this.pos++;
    while (this.pos < this.end) {
      let code = bytes[this.pos++];
      if (code === 0x5c) {
        code = bytes[this.pos++];
        if (code === 0x6e) out.push(0x0a); else if (code === 0x72) out.push(0x0d); else if (code === 0x74) out.push(0x09);
        else if (code === 0x62) out.push(0x08); else if (code === 0x66) out.push(0x0c);
        else if (code === 0x0d) { if (bytes[this.pos] === 0x0a) this.pos++; }
        else if (code === 0x0a) { /* line continuation */ }
        else if (code >= 0x30 && code <= 0x37) {
          let value = code - 0x30;
          for (let i = 0; i < 2 && bytes[this.pos] >= 0x30 && bytes[this.pos] <= 0x37; i++) value = value * 8 + bytes[this.pos++] - 0x30;
          out.push(value & 0xff);
        } else if (code !== undefined) out.push(code);
        continue;
      }
      if (code === 0x28) depth++;
      else if (code === 0x29 && --depth === 0) break;
      out.push(code);
    }
    return Buffer.from(out);
  }
  hex() {
    const { bytes } = this, out = [];
    let high = -1; this.pos++;
    while (this.pos < this.end && bytes[this.pos] !== 0x3e) {
      const value = hexValue(bytes[this.pos++]);
      if (value < 0) continue;
      if (high < 0) high = value; else { out.push(high * 16 + value); high = -1; }
    }
    this.pos++;
    if (high >= 0) out.push(high * 16);
    const result = Buffer.from(out); result.hex = true;
    return result;
  }
  // A value: numbers followed by "gen R" become references; << >> dictionaries are Maps; [ ] arrays.
  value(token = this.token()) {
    if (token === '<<') {
      const dict = new Map();
      for (;;) {
        const key = this.token();
        if (key === '>>' || key === undefined) return dict;
        if (!(key instanceof Name)) continue;
        const next = this.token();
        if (next === '>>') { dict.set(key.name, null); return dict; }
        dict.set(key.name, this.value(next));
      }
    }
    if (token === '[') {
      const list = [];
      for (;;) {
        const next = this.token();
        if (next === ']' || next === undefined) return list;
        list.push(this.value(next));
      }
    }
    if (typeof token === 'number' && Number.isInteger(token) && token >= 0) {
      const second = this.token();
      if (typeof second === 'number' && Number.isInteger(second)) {
        const third = this.token();
        if (third instanceof Op && third.op === 'R') return new Ref(token, second);
        if (third !== undefined) this.unread(third);
      }
      if (second !== undefined) this.unread(second);
    }
    return token;
  }
}

// Stream filters (images' filters are not needed for text). No stream may expand past STREAM_LIMIT, nor a file's
// streams together past TOTAL_LIMIT: a small file can't make the reader run out of memory.
const STREAM_LIMIT = 64 * 1024 ** 2, TOTAL_LIMIT = 768 * 1024 ** 2;
// The synchronous inflater buffers its output up to the limit, even for streams it rejects.
const FLATE_LIMIT = 32 * 1024 ** 2;
function flate(bytes) {
  try {
    // Use one pass that can also recover the readable prefix of a truncated stream.
    return inflateSync(bytes, { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: FLATE_LIMIT });
  } catch { return null; }
}
function asciiHex(bytes) { return new Lexer(Buffer.concat([Buffer.from('<'), bytes, Buffer.from('>')])).hex(); }
function ascii85(bytes) {
  const out = []; let group = [];
  const text = Buffer.from(bytes).toString('latin1').replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  for (const char of text) {
    if (char === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
    const value = char.charCodeAt(0) - 33;
    if (value < 0 || value > 84) continue;
    group.push(value);
    if (group.length === 5) { let n = 0; for (const v of group) n = n * 85 + v; out.push(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255); group = []; }
  }
  if (group.length > 1) {
    const size = group.length; while (group.length < 5) group.push(84);
    let n = 0; for (const v of group) n = n * 85 + v;
    out.push(...[n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].slice(0, size - 1));
  }
  return Buffer.from(out);
}
function lzw(bytes, early = 1) {
  const out = []; let dictionary = [], width = 9, previous = null, buffer = 0, bits = 0;
  const reset = () => { dictionary = Array.from({ length: 258 }, (_, i) => i < 256 ? [i] : null); width = 9; previous = null; };
  reset();
  for (const byte of bytes) {
    buffer = buffer << 8 | byte; bits += 8;
    while (bits >= width) {
      const code = buffer >>> bits - width & (1 << width) - 1; bits -= width; buffer &= (1 << bits) - 1;
      if (code === 256) { reset(); continue; }
      if (code === 257 || out.length > STREAM_LIMIT) return Buffer.from(out);
      let entry = dictionary[code];
      if (!entry && previous) entry = [...previous, previous[0]];
      if (!entry) return Buffer.from(out);
      out.push(...entry);
      if (previous) dictionary.push([...previous, entry[0]]);
      previous = entry;
      if (dictionary.length + early >= 1 << width && width < 12) width++;
    }
  }
  return Buffer.from(out);
}
function runLength(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length && out.length < STREAM_LIMIT;) {
    const length = bytes[i++];
    if (length === 128) break;
    if (length < 128) { for (let j = 0; j <= length && i < bytes.length; j++) out.push(bytes[i++]); }
    else { const value = bytes[i++]; for (let j = 0; j < 257 - length; j++) out.push(value); }
  }
  return Buffer.from(out);
}
// PNG predictors (xref and object streams may use them).
function unpredict(bytes, parms) {
  const predictor = parms?.get?.('Predictor') ?? 1;
  if (predictor < 10) return bytes;
  const colors = parms.get('Colors') ?? 1, bitsPer = parms.get('BitsPerComponent') ?? 8, columns = parms.get('Columns') ?? 1;
  const pixel = Math.max(1, Math.ceil(colors * bitsPer / 8)), row = Math.ceil(colors * bitsPer * columns / 8);
  const out = Buffer.alloc(Math.floor(bytes.length / (row + 1)) * row);
  let prior = Buffer.alloc(row);
  for (let r = 0, i = 0; i + row < bytes.length + 1 && r * row < out.length; r++) {
    const type = bytes[i++], line = out.subarray(r * row, (r + 1) * row);
    for (let x = 0; x < row; x++) {
      const raw = bytes[i++] ?? 0, left = x >= pixel ? line[x - pixel] : 0, up = prior[x], upLeft = x >= pixel ? prior[x - pixel] : 0;
      let value = raw;
      if (type === 1) value = raw + left; else if (type === 2) value = raw + up; else if (type === 3) value = raw + (left + up >> 1);
      else if (type === 4) { const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft); value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft); }
      line[x] = value & 255;
    }
    prior = line;
  }
  return out;
}

// RC4 (old PDF encryption; OpenSSL 3 no longer offers it by default).
function rc4(key, data) {
  const s = new Uint8Array(256); for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = j + s[i] + key[i % key.length] & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) { i = i + 1 & 255; j = j + s[i] & 255; [s[i], s[j]] = [s[j], s[i]]; out[n] = data[n] ^ s[s[i] + s[j] & 255]; }
  return out;
}
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts.map(part => Buffer.from(part)))).digest();
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
function aesDecrypt(key, data, iv = null) {
  try {
    const vector = iv ?? data.subarray(0, 16), body = iv ? data : data.subarray(16);
    const decipher = createDecipheriv(key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc', key, vector);
    if (iv) decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch { return null; }
}
// Revision 6 password hash (ISO 32000-2, 7.6.4.3.4), here with an empty password.
function encryptAes(key, iv, data) { const cipher = createCipheriv('aes-128-cbc', key, iv); cipher.setAutoPadding(false); return Buffer.concat([cipher.update(data), cipher.final()]); }
function hash6(password, salt, userKey = Buffer.alloc(0)) {
  let k = createHash('sha256').update(Buffer.concat([password, salt, userKey])).digest(), e = Buffer.alloc(0);
  for (let round = 0; round < 64 || e[e.length - 1] > round - 32; round++) {
    const block = Buffer.concat([password, k, userKey]);
    e = encryptAes(k.subarray(0, 16), k.subarray(16, 32), Buffer.concat(Array.from({ length: 64 }, () => block)));
    const mod = e.subarray(0, 16).reduce((sum, byte) => sum + byte, 0) % 3;
    k = createHash(['sha256', 'sha384', 'sha512'][mod]).update(e).digest();
  }
  return k.subarray(0, 32);
}

class Document {
  constructor(bytes) {
    this.bytes = bytes;
    this.objects = new Map();
    this.cache = new Map();
    this.decoded = 0;
    this.trailers = [];
    this.scan();
    this.security();
  }
  // Every "n g obj" in the file; a later one replaces an earlier one (incremental updates), then the objects packed
  // in object streams that nothing later replaced.
  scan() {
    const text = this.bytes.toString('latin1'), pattern = /(\d+)\s+(\d+)\s+obj\b/g, packed = [];
    let match;
    while ((match = pattern.exec(text))) {
      const num = Number(match[1]), gen = Number(match[2]), lexer = new Lexer(this.bytes, pattern.lastIndex);
      let value;
      try { value = lexer.value(); } catch { continue; }
      const entry = { num, gen, value, offset: match.index };
      const after = lexer.token();
      if (after instanceof Op && after.op === 'stream' && value instanceof Map) {
        let start = lexer.pos;
        if (this.bytes[start] === 0x0d) start++;
        if (this.bytes[start] === 0x0a) start++;
        const length = value.get('Length');
        let end = -1;
        if (typeof length === 'number' && start + length <= this.bytes.length && /^\s*endstream/.test(text.slice(start + length, start + length + 20))) end = start + length;
        if (end < 0) { const found = text.indexOf('endstream', start); end = found < 0 ? this.bytes.length : found; while (end > start && (this.bytes[end - 1] === 0x0a || this.bytes[end - 1] === 0x0d)) end--; }
        entry.stream = [start, end];
        pattern.lastIndex = end;
        if (isName(value.get('Type'), 'XRef')) this.trailers.push({ offset: match.index, dict: value });
        if (isName(value.get('Type'), 'ObjStm')) packed.push(entry);
      }
      const current = this.objects.get(num);
      if (!current || current.offset <= entry.offset) this.objects.set(num, entry);
    }
    for (const found of text.matchAll(/trailer\s*<</g)) {
      try { const value = new Lexer(this.bytes, found.index + 7).value(); if (value instanceof Map) this.trailers.push({ offset: found.index, dict: value }); } catch { /* skip */ }
    }
    this.trailers.sort((a, b) => a.offset - b.offset);
    this.packed = packed;
  }
  unpack() {
    for (const entry of this.packed) {
      if (this.objects.get(entry.num) !== entry) continue;
      const data = this.streamData(entry);
      if (!data) continue;
      const count = entry.value.get('N') ?? 0, first = entry.value.get('First') ?? 0, header = new Lexer(data, 0, first), pairs = [];
      for (let i = 0; i < count; i++) { const num = header.token(), offset = header.token(); if (typeof num !== 'number' || typeof offset !== 'number') break; pairs.push([num, offset]); }
      for (const [num, offset] of pairs) {
        const current = this.objects.get(num);
        if (current && current.offset > entry.offset) continue;
        try { this.objects.set(num, { num, gen: 0, value: new Lexer(data, first + offset).value(), offset: entry.offset + 0.5, packed: true }); } catch { /* skip */ }
      }
    }
  }
  trailer(key) { for (let i = this.trailers.length - 1; i >= 0; i--) if (this.trailers[i].dict.has(key)) return this.trailers[i].dict.get(key); return undefined; }
  get(value, depth = 0) {
    while (value instanceof Ref && depth++ < 32) value = this.objects.get(value.num)?.value;
    return value;
  }
  entry(value) { return value instanceof Ref ? this.objects.get(value.num) : null; }
  security() {
    const encrypt = this.get(this.trailer('Encrypt'));
    if (!(encrypt instanceof Map)) { this.unpack(); return; }
    const filter = this.get(encrypt.get('Filter'));
    if (!isName(filter, 'Standard')) throw new PdfTextError('PDF_ENCRYPTED', 'encrypted');
    const v = encrypt.get('V') ?? 0, r = encrypt.get('R') ?? 2, o = encrypt.get('O'), u = encrypt.get('U'), p = encrypt.get('P') ?? 0;
    const id = this.get(this.trailer('ID'))?.[0] ?? Buffer.alloc(0);
    const cf = this.get(encrypt.get('CF')), stmf = this.get(encrypt.get('StmF'))?.name ?? 'Identity';
    const method = v >= 4 ? this.get(this.get(cf?.get(stmf))?.get('CFM'))?.name ?? 'None' : 'V2';
    this.aes = method === 'AESV2' || method === 'AESV3';
    this.identityStreams = v >= 4 && (stmf === 'Identity' || method === 'None');
    if (r >= 5) {
      const ue = encrypt.get('UE');
      if (!Buffer.isBuffer(u) || !Buffer.isBuffer(ue)) throw new PdfTextError('PDF_ENCRYPTED', 'encrypted');
      const empty = Buffer.alloc(0), check = r === 5 ? createHash('sha256').update(Buffer.concat([u.subarray(32, 40)])).digest() : hash6(empty, u.subarray(32, 40));
      if (!check.equals(u.subarray(0, 32))) throw new PdfTextError('PDF_ENCRYPTED', 'password');
      const intermediate = r === 5 ? createHash('sha256').update(u.subarray(40, 48)).digest() : hash6(empty, u.subarray(40, 48));
      this.key = aesDecrypt(intermediate, ue.subarray(0, 32), Buffer.alloc(16));
      this.r6 = true;
    } else {
      const length = (v === 1 ? 40 : encrypt.get('Length') ?? 40) / 8;
      const pBytes = Buffer.alloc(4); pBytes.writeInt32LE(p);
      const metadata = encrypt.get('EncryptMetadata') !== false;
      let key = md5(PAD, o, pBytes, id, r >= 4 && !metadata ? Buffer.from([255, 255, 255, 255]) : Buffer.alloc(0)).subarray(0, length);
      if (r >= 3) for (let i = 0; i < 50; i++) key = md5(key).subarray(0, length);
      // The empty user password must open it (a file locked against changes only); otherwise it stays unread.
      const expected = r === 2 ? rc4(key, PAD) : (() => { let x = rc4(key, md5(PAD, id)); for (let i = 1; i <= 19; i++) x = rc4(Buffer.from(key.map(byte => byte ^ i)), x); return x; })();
      if (!Buffer.isBuffer(u) || !expected.subarray(0, r === 2 ? 32 : 16).equals(u.subarray(0, r === 2 ? 32 : 16))) throw new PdfTextError('PDF_ENCRYPTED', 'password');
      this.key = key;
    }
    this.unpack();
  }
  decrypt(entry, data) {
    if (!this.key || this.identityStreams || entry.packed) return data;
    if (isName(entry.value.get?.('Type'), 'XRef')) return data;
    if (this.r6) return aesDecrypt(this.key, data) ?? Buffer.alloc(0);
    const extra = Buffer.from([entry.num & 255, entry.num >> 8 & 255, entry.num >> 16 & 255, entry.gen & 255, entry.gen >> 8 & 255]);
    const key = md5(this.key, extra, this.aes ? Buffer.from('sAlT') : Buffer.alloc(0)).subarray(0, Math.min(this.key.length + 5, 16));
    return this.aes ? aesDecrypt(key, data) ?? Buffer.alloc(0) : rc4(key, data);
  }
  streamData(entry) {
    if (!entry?.stream) return null;
    if (this.cache.has(entry)) return this.cache.get(entry);
    let data = this.decrypt(entry, this.bytes.subarray(entry.stream[0], entry.stream[1]));
    const dict = entry.value;
    let filters = this.get(dict.get('Filter')), parms = this.get(dict.get('DecodeParms') ?? dict.get('DP'));
    filters = filters == null ? [] : Array.isArray(filters) ? filters.map(item => this.get(item)) : [filters];
    parms = Array.isArray(parms) ? parms.map(item => this.get(item)) : [parms];
    for (let i = 0; i < filters.length && data; i++) {
      const name = filters[i]?.name, parm = parms[i];
      if (name === 'FlateDecode' || name === 'Fl') { const raw = flate(data); data = raw && unpredict(raw, parm); }
      else if (name === 'ASCIIHexDecode' || name === 'AHx') data = asciiHex(data);
      else if (name === 'ASCII85Decode' || name === 'A85') data = ascii85(data);
      else if (name === 'LZWDecode' || name === 'LZW') data = unpredict(lzw(data, parm?.get?.('EarlyChange') ?? 1), parm);
      else if (name === 'RunLengthDecode' || name === 'RL') data = runLength(data);
      else data = null;
    }
    this.decoded += data?.length ?? 0;
    if (this.decoded > TOTAL_LIMIT) throw new PdfTextError('PDF_LIMIT', 'too much data');
    this.cache.set(entry, data);
    return data;
  }
  stream(value) { return this.streamData(this.entry(value) ?? (value?.stream ? value : null)); }
  pages() {
    const root = this.get(this.trailer('Root'));
    const pages = [], seen = new Set();
    const walk = (node, inherited, depth) => {
      const dict = this.get(node);
      if (!(dict instanceof Map) || depth > 64) return;
      if (node instanceof Ref) { if (seen.has(node.num)) return; seen.add(node.num); }
      const resources = dict.get('Resources') ?? inherited;
      const kids = this.get(dict.get('Kids'));
      if (Array.isArray(kids)) { for (const kid of kids) walk(kid, resources, depth + 1); return; }
      pages.push({ dict, resources });
    };
    if (root instanceof Map) walk(root.get('Pages'), null, 0);
    if (!pages.length) {
      // No page tree to follow: every page object, in file order.
      for (const entry of [...this.objects.values()].sort((a, b) => a.offset - b.offset)) if (entry.value instanceof Map && isName(entry.value.get('Type'), 'Page')) pages.push({ dict: entry.value, resources: entry.value.get('Resources') });
    }
    return pages;
  }
}

// Unicode for glyph names (simple fonts with /Differences): uniXXXX, uXXXX and the common Latin names.
const LATIN1_NAMES = 'Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis'.split(' ');
const ASCII_NAMES = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at'.split(' ');
const GLYPHS = new Map([
  ...ASCII_NAMES.map((name, i) => [name, String.fromCharCode(32 + i)]),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => [c, c]), ...'abcdefghijklmnopqrstuvwxyz'.split('').map(c => [c, c]),
  ['bracketleft', '['], ['backslash', '\\'], ['bracketright', ']'], ['asciicircum', '^'], ['underscore', '_'], ['grave', '`'], ['braceleft', '{'], ['bar', '|'], ['braceright', '}'], ['asciitilde', '~'],
  ['quoteleft', '‘'], ['quoteright', '’'], ['quotedblleft', '“'], ['quotedblright', '”'], ['quotesinglbase', '‚'], ['quotedblbase', '„'], ['endash', '–'], ['emdash', '—'], ['bullet', '•'], ['ellipsis', '…'],
  ['fi', 'fi'], ['fl', 'fl'], ['ff', 'ff'], ['ffi', 'ffi'], ['ffl', 'ffl'], ['Euro', '€'], ['copyright', '©'], ['registered', '®'], ['trademark', '™'], ['degree', '°'], ['plusminus', '±'], ['section', '§'],
  ['paragraph', '¶'], ['dagger', '†'], ['daggerdbl', '‡'], ['periodcentered', '·'], ['minus', '−'], ['nbspace', ' '], ['nonbreakingspace', ' '], ['sterling', '£'], ['yen', '¥'], ['cent', '¢'], ['guillemotleft', '«'], ['guillemotright', '»'],
  ['exclamdown', '¡'], ['questiondown', '¿'], ['OE', 'Œ'], ['oe', 'œ'], ['Scaron', 'Š'], ['scaron', 'š'], ['Zcaron', 'Ž'], ['zcaron', 'ž'], ['Ydieresis', 'Ÿ'], ['dotlessi', 'ı'], ['Lslash', 'Ł'], ['lslash', 'ł'], ['florin', 'ƒ'], ['perthousand', '‰'],
  ...LATIN1_NAMES.map((name, i) => [name, String.fromCharCode(0xc0 + i)]),
]);
function glyphUnicode(name) {
  if (GLYPHS.has(name)) return GLYPHS.get(name);
  const base = name.split('.')[0];
  if (GLYPHS.has(base)) return GLYPHS.get(base);
  let match = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(base);
  if (match) return String.fromCharCode(...match[1].match(/.{4}/g).map(hex => parseInt(hex, 16)));
  match = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (match) return String.fromCodePoint(parseInt(match[1], 16));
  return null;
}
const decoders = new Map();
const decoder = label => { if (!decoders.has(label)) { try { decoders.set(label, new TextDecoder(label)); } catch { decoders.set(label, null); } } return decoders.get(label); };
const singleByte = label => { const d = decoder(label); return Array.from({ length: 256 }, (_, i) => d ? d.decode(Buffer.from([i])) : String.fromCharCode(i)); };
const ENCODINGS = { WinAnsiEncoding: singleByte('windows-1252'), MacRomanEncoding: singleByte('macintosh'), StandardEncoding: Array.from({ length: 256 }, (_, i) => i === 0x27 ? '’' : i === 0x60 ? '‘' : String.fromCharCode(i)), PDFDocEncoding: singleByte('latin1') };

// A CMap stream (ToUnicode, or an embedded encoding): code space ranges, and codes to text.
function parseCMap(bytes) {
  const lexer = new Lexer(bytes), ranges = [], map = new Map(), spans = [];
  const utf16 = buffer => { let text = ''; for (let i = 0; i + 1 < buffer.length; i += 2) text += String.fromCharCode(buffer[i] << 8 | buffer[i + 1]); if (buffer.length % 2) text += String.fromCharCode(buffer.at(-1)); return text; };
  const number = buffer => { let value = 0; for (const byte of buffer) value = value * 256 + byte; return value; };
  let token, mode = null;
  const operands = [];
  while ((token = lexer.token()) !== undefined) {
    if (token instanceof Op) {
      const op = token.op;
      if (op === 'begincodespacerange' || op === 'beginbfchar' || op === 'beginbfrange' || op === 'begincidrange' || op === 'begincidchar') { mode = op.slice(5); operands.length = 0; continue; }
      if (op.startsWith('end')) { mode = null; operands.length = 0; continue; }
      continue;
    }
    if (!mode) continue;
    if (token === '[') { const list = []; let item; while ((item = lexer.token()) !== ']' && item !== undefined) list.push(item); operands.push(list); }
    else operands.push(token);
    if (mode === 'codespacerange' && operands.length === 2) { const [low, high] = operands.splice(0); if (Buffer.isBuffer(low) && Buffer.isBuffer(high)) ranges.push({ length: low.length, low: [...low], high: [...high] }); }
    else if (mode === 'bfchar' && operands.length === 2) {
      const [code, target] = operands.splice(0);
      if (Buffer.isBuffer(code)) map.set(number(code), Buffer.isBuffer(target) ? utf16(target) : target instanceof Name ? glyphUnicode(target.name) ?? '' : '');
    }
    else if (mode === 'bfrange' && operands.length === 3) {
      const [low, high, target] = operands.splice(0);
      if (!Buffer.isBuffer(low) || !Buffer.isBuffer(high)) continue;
      const from = number(low), to = number(high);
      if (Array.isArray(target)) { target.forEach((item, i) => { if (Buffer.isBuffer(item) && from + i <= to) map.set(from + i, utf16(item)); }); }
      else if (Buffer.isBuffer(target) && target.length) {
        const base = utf16(target), shifted = code => base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + code - from);
        if (to - from <= 512) for (let code = from; code <= to; code++) map.set(code, shifted(code));
        else spans.push({ from, to, shifted });
      }
    } else if ((mode === 'cidrange' && operands.length === 3) || (mode === 'cidchar' && operands.length === 2)) operands.length = 0;
  }
  const lookup = code => {
    if (map.has(code)) return map.get(code);
    for (const span of spans) if (code >= span.from && code <= span.to) { const text = span.shifted(code); map.set(code, text); return text; }
    return undefined;
  };
  return { ranges, lookup, size: map.size + spans.length };
}

const PREDEFINED = [
  [/^Uni\w*-UCS2-[HV]$|^Uni\w*-UTF16-[HV]$/, 'utf-16be'],
  [/^(KSC|KSCms|KSCpc)-|^KSC-EUC|UHC/, 'euc-kr'],
  [/^(90ms|90msp|83pv|Add|Ext|EUC|H$|V$)-?.*RKSJ|^EUC-[HV]$|^90ms-RKSJ/, 'shift_jis'],
  [/^GB|^GBK|^GBpc/, 'gbk'],
  [/^B5|^ETen|^HKscs|^CNS/, 'big5'],
];
class Font {
  constructor(doc, ref) {
    const dict = doc.get(ref) instanceof Map ? doc.get(ref) : new Map();
    this.subtype = doc.get(dict.get('Subtype'))?.name ?? 'Type1';
    this.type0 = this.subtype === 'Type0';
    this.widths = new Map(); this.defaultWidth = this.type0 ? 1000 : 0; this.scale = 0.001;
    const toUnicode = doc.stream(dict.get('ToUnicode'));
    this.cmap = toUnicode ? parseCMap(toUnicode) : null;
    if (this.cmap && !this.cmap.size) this.cmap = null;
    const encoding = doc.get(dict.get('Encoding'));
    this.ranges = null;
    if (this.type0) {
      const name = encoding instanceof Name ? encoding.name : null;
      // How many bytes a code takes: two for Identity and the Unicode CMaps, the embedded CMap's code space, or the
      // legacy encoding's lead bytes (the ToUnicode table's code space when there is one).
      if (name && /^Identity-[HV]$/.test(name)) this.fixed = 2;
      else if (name) { this.legacy = PREDEFINED.find(([pattern]) => pattern.test(name))?.[1] ?? null; this.fixed = this.legacy === 'utf-16be' || !this.legacy ? 2 : 0; }
      else { const embedded = doc.stream(dict.get('Encoding')); this.ranges = embedded ? parseCMap(embedded).ranges : null; if (!this.ranges?.length) this.ranges = null; }
      if (!this.fixed && !this.ranges && this.cmap?.ranges.length) this.ranges = this.cmap.ranges;
      if (!this.fixed && !this.ranges && !this.legacy) this.fixed = 2;
      const descendant = doc.get(doc.get(dict.get('DescendantFonts'))?.[0]);
      if (descendant instanceof Map) {
        this.defaultWidth = doc.get(descendant.get('DW')) ?? 1000;
        const w = doc.get(descendant.get('W'));
        if (Array.isArray(w)) for (let i = 0; i < w.length;) {
          const first = doc.get(w[i]), second = doc.get(w[i + 1]);
          if (Array.isArray(second)) { second.forEach((width, j) => this.widths.set(first + j, doc.get(width))); i += 2; }
          else { const width = doc.get(w[i + 2]); for (let code = first; code <= second && code - first < 65536; code++) this.widths.set(code, width); i += 3; }
        }
      }
    } else {
      this.fixed = 1;
      const base = encoding instanceof Name ? encoding.name : encoding instanceof Map ? doc.get(encoding.get('BaseEncoding'))?.name : null;
      this.table = [...(ENCODINGS[base] ?? ENCODINGS.WinAnsiEncoding)];
      const differences = encoding instanceof Map ? doc.get(encoding.get('Differences')) : null;
      if (Array.isArray(differences)) {
        let code = 0;
        for (const item of differences.map(value => doc.get(value))) {
          if (typeof item === 'number') code = item;
          else if (item instanceof Name) { const text = glyphUnicode(item.name); if (text !== null) this.table[code] = text; else if (!/^\.notdef$/.test(item.name)) this.table[code] = this.table[code] ?? ''; code++; }
        }
      }
      const first = doc.get(dict.get('FirstChar')) ?? 0, widths = doc.get(dict.get('Widths'));
      if (Array.isArray(widths)) widths.forEach((width, i) => this.widths.set(first + i, doc.get(width)));
      const descriptor = doc.get(dict.get('FontDescriptor'));
      this.defaultWidth = descriptor instanceof Map ? doc.get(descriptor.get('MissingWidth')) ?? 0 : 0;
      if (!this.widths.size && !this.defaultWidth) this.defaultWidth = 500;
      if (this.subtype === 'Type3') { const matrix = doc.get(dict.get('FontMatrix')); if (Array.isArray(matrix)) this.scale = Math.abs(doc.get(matrix[0]) ?? 0.001); }
    }
  }
  // A shown string → [{ text, width (in text space units per font size), space (a single-byte 32) }].
  codeLength(bytes, i) {
    if (this.ranges) {
      for (let n = 1; n <= 4 && i + n <= bytes.length; n++) if (this.ranges.some(range => range.length === n && range.low.every((low, k) => bytes[i + k] >= low && bytes[i + k] <= range.high[k]))) return n;
      return this.type0 ? Math.min(2, bytes.length - i) : 1;
    }
    if (this.fixed) return Math.min(this.fixed, bytes.length - i);
    return bytes[i] < 0x80 ? 1 : Math.min(2, bytes.length - i);
  }
  decode(bytes) {
    const glyphs = [];
    for (let i = 0; i < bytes.length;) {
      const length = this.codeLength(bytes, i);
      let code = 0; for (let k = 0; k < length; k++) code = code * 256 + bytes[i + k];
      let text = this.cmap?.lookup(code);
      if (text === undefined) {
        if (this.legacy === 'utf-16be') text = String.fromCharCode(code);
        else if (this.legacy) text = decoder(this.legacy)?.decode(bytes.subarray(i, i + length)) ?? '';
        else if (this.type0) text = '';
        else text = this.table[code] ?? '';
      }
      const width = this.legacy && this.legacy !== 'utf-16be' ? (length === 1 ? 0.5 : 1) : (this.widths.get(code) ?? this.defaultWidth) * this.scale;
      glyphs.push({ text: text.replace(/\0/g, ''), width, space: length === 1 && code === 32 });
      i += length;
    }
    return glyphs;
  }
}

const multiply = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const IDENTITY = [1, 0, 0, 1, 0, 0];

// Text of a page: runs content streams (and the forms they draw), placing each shown string to decide where lines
// break and where words are apart.
class PageText {
  constructor(doc, limit) { this.doc = doc; this.fonts = new Map(); this.out = []; this.length = 0; this.limit = limit; this.last = null; }
  font(resources, name) {
    const fonts = this.doc.get(this.doc.get(resources)?.get?.('Font'));
    const ref = fonts instanceof Map ? fonts.get(name) : undefined;
    const key = ref instanceof Ref ? `r${ref.num}` : ref;
    if (!key) return null;
    if (!this.fonts.has(key)) { try { this.fonts.set(key, new Font(this.doc, ref)); } catch { this.fonts.set(key, null); } }
    return this.fonts.get(key);
  }
  emit(text, x, y, size, endX) {
    if (!text) return;
    const last = this.last;
    if (last) {
      const lineHeight = Math.max(size, last.size, 1);
      if (Math.abs(y - last.y) > lineHeight * 0.5) this.push('\n');
      else if (x - last.endX > Math.max(size, last.size) * 0.18 && !/\s$/.test(this.out.at(-1) ?? '') && !/^\s/.test(text)) this.push(' ');
      else if (x < last.x - lineHeight && !/\s$/.test(this.out.at(-1) ?? '')) this.push(' ');
    }
    this.push(text);
    this.last = { x, y, size, endX };
  }
  push(text) { this.out.push(text); this.length += text.length; }
  run(content, resources, ctm, depth = 0, forms = new Set()) {
    if (!content || depth > 6 || this.length > this.limit) return;
    const lexer = new Lexer(content), stack = [], doc = this.doc;
    let state = { ctm, font: null, size: 0, charSpacing: 0, wordSpacing: 0, scale: 1, leading: 0, rise: 0 };
    const saved = [];
    let tm = IDENTITY, tlm = IDENTITY;
    const show = bytes => {
      const font = state.font;
      if (!font || !Buffer.isBuffer(bytes)) return;
      const glyphs = font.decode(bytes);
      const start = multiply(tm, state.ctm), size = state.size * Math.hypot(start[2], start[3]) || state.size;
      let text = '';
      for (const glyph of glyphs) {
        text += glyph.text;
        const advance = (glyph.width * state.size + state.charSpacing + (glyph.space ? state.wordSpacing : 0)) * state.scale;
        tm = multiply([1, 0, 0, 1, advance, 0], tm);
      }
      const end = multiply(tm, state.ctm);
      this.emit(text, start[4], start[5], size, end[4]);
    };
    const nextLine = () => { tlm = multiply([1, 0, 0, 1, 0, -state.leading], tlm); tm = tlm; };
    let token;
    while ((token = lexer.token()) !== undefined) {
      if (!(token instanceof Op)) {
        if (token === '[') { lexer.unread(token); stack.push(lexer.value()); }
        else if (token === '<<') { lexer.unread(token); stack.push(lexer.value()); }
        else stack.push(token);
        if (stack.length > 64) stack.splice(0, stack.length - 64);
        continue;
      }
      const op = token.op, n = i => stack.at(i);
      switch (op) {
        case 'q': saved.push({ ...state }); break;
        case 'Q': if (saved.length) state = saved.pop(); break;
        case 'cm': if (stack.length >= 6) state.ctm = multiply(stack.slice(-6).map(Number), state.ctm); break;
        case 'BT': tm = tlm = IDENTITY; break;
        case 'ET': break;
        case 'Tf': state.font = this.font(resources, n(-2)?.name); state.size = Number(n(-1)) || 0; break;
        case 'Tc': state.charSpacing = Number(n(-1)) || 0; break;
        case 'Tw': state.wordSpacing = Number(n(-1)) || 0; break;
        case 'Tz': state.scale = (Number(n(-1)) || 100) / 100; break;
        case 'TL': state.leading = Number(n(-1)) || 0; break;
        case 'Ts': state.rise = Number(n(-1)) || 0; break;
        case 'Td': tlm = multiply([1, 0, 0, 1, Number(n(-2)) || 0, Number(n(-1)) || 0], tlm); tm = tlm; break;
        case 'TD': state.leading = -(Number(n(-1)) || 0); tlm = multiply([1, 0, 0, 1, Number(n(-2)) || 0, Number(n(-1)) || 0], tlm); tm = tlm; break;
        case 'Tm': if (stack.length >= 6) { tlm = tm = stack.slice(-6).map(Number); } break;
        case 'T*': nextLine(); break;
        case 'Tj': show(n(-1)); break;
        case "'": nextLine(); show(n(-1)); break;
        case '"': state.wordSpacing = Number(n(-3)) || 0; state.charSpacing = Number(n(-2)) || 0; nextLine(); show(n(-1)); break;
        case 'TJ': {
          const list = n(-1);
          if (Array.isArray(list)) for (const item of list) {
            if (typeof item === 'number') tm = multiply([1, 0, 0, 1, -item / 1000 * state.size * state.scale, 0], tm);
            else show(item);
          }
          break;
        }
        case 'Do': {
          const xobjects = doc.get(doc.get(resources)?.get?.('XObject'));
          const ref = xobjects instanceof Map ? xobjects.get(n(-1)?.name) : null, entry = doc.entry(ref);
          if (entry?.stream && isName(doc.get(entry.value.get('Subtype')), 'Form') && !forms.has(entry.num)) {
            const matrix = doc.get(entry.value.get('Matrix'));
            const inner = new Set(forms); inner.add(entry.num);
            this.run(doc.streamData(entry), entry.value.get('Resources') ?? resources, Array.isArray(matrix) && matrix.length === 6 ? multiply(matrix.map(value => Number(doc.get(value)) || 0), state.ctm) : state.ctm, depth + 1, inner);
          }
          break;
        }
        case 'BI': {
          // An inline image: skip its data up to EI.
          let item; while ((item = lexer.token()) !== undefined && !(item instanceof Op && item.op === 'ID'));
          const bytes = lexer.bytes;
          let at = lexer.pos + 1;
          while (at < lexer.end - 1 && !(SPACE[bytes[at - 1]] && bytes[at] === 0x45 && bytes[at + 1] === 0x49 && (at + 2 >= lexer.end || SPACE[bytes[at + 2]]))) at++;
          lexer.pos = at + 2;
          break;
        }
        default: break;
      }
      stack.length = 0;
      if (this.length > this.limit) return;
    }
  }
}

// The text of a PDF (pages apart by a blank line), up to about `limit` characters.
export function pdfText(input, { limit = 2_000_000 } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.subarray(0, 1024).toString('latin1').indexOf('%PDF-') < 0) throw new PdfTextError('PDF_FORMAT', 'not a PDF');
  const doc = new Document(bytes), pages = [];
  let total = 0;
  for (const { dict, resources } of doc.pages()) {
    const page = new PageText(doc, limit - total);
    let contents = doc.get(dict.get('Contents'));
    contents = Array.isArray(contents) ? contents : contents == null ? [] : [dict.get('Contents')];
    const data = Buffer.concat(contents.map(item => doc.stream(item) ?? Buffer.alloc(0)).flatMap(part => [part, Buffer.from('\n')]));
    try { page.run(data, resources, IDENTITY); } catch { /* a broken page keeps what it read */ }
    const text = page.out.join('').split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
    pages.push(text); total += text.length;
    if (total >= limit) break;
  }
  return pages.join('\n\n').slice(0, limit);
}
