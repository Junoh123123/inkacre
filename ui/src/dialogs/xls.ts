import { t } from '../i18n';
// Excel 97–2003 workbooks (.xls): the first visible worksheet's cells as rows of text, read here in the browser.
// The file is a compound document (sectors chained by allocation tables, small streams in a mini stream); the
// "Workbook" stream inside is a run of BIFF8 records — the shared string table (which may continue over CONTINUE
// records, each continuation of a string's characters starting with a fresh options byte), the sheet list, and per
// sheet the cell records (shared strings, numbers, RK and MULRK compressed numbers, formulas with their cached
// results, labels, booleans and errors). Formats are not applied: numbers come as they are stored, like .xlsx imports.

const END = 0xfffffffa;

function compoundStream(bytes: Uint8Array, wanted: string[]): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length < 512 || signature.some((value, index) => bytes[index] !== value)) return null;
  const sectorSize = 1 << view.getUint16(0x1e, true), miniSize = 1 << view.getUint16(0x20, true);
  const fatCount = view.getUint32(0x2c, true), firstDirectory = view.getUint32(0x30, true), cutoff = view.getUint32(0x38, true);
  const firstMiniFat = view.getUint32(0x3c, true);
  let difat = view.getUint32(0x44, true);
  const difatCount = view.getUint32(0x48, true), perSector = sectorSize / 4;
  const offset = (sector: number) => (sector + 1) * sectorSize;
  const fatSectors: number[] = [];
  for (let index = 0; index < 109 && fatSectors.length < fatCount; index++) fatSectors.push(view.getUint32(0x4c + index * 4, true));
  for (let round = 0; round < difatCount && difat < END && offset(difat) + sectorSize <= bytes.length; round++) {
    for (let index = 0; index < perSector - 1 && fatSectors.length < fatCount; index++) fatSectors.push(view.getUint32(offset(difat) + index * 4, true));
    difat = view.getUint32(offset(difat) + (perSector - 1) * 4, true);
  }
  const fat = new Uint32Array(fatSectors.length * perSector);
  fatSectors.forEach((sector, index) => { for (let item = 0; item < perSector && offset(sector) + item * 4 + 4 <= bytes.length; item++) fat[index * perSector + item] = view.getUint32(offset(sector) + item * 4, true); });
  const chain = (start: number, table: Uint32Array) => { const sectors: number[] = [], seen = new Set<number>(); for (let sector = start; sector < END && sector < table.length && !seen.has(sector); sector = table[sector]) { seen.add(sector); sectors.push(sector); } return sectors; };
  const read = (start: number) => { const sectors = chain(start, fat), out = new Uint8Array(sectors.length * sectorSize); sectors.forEach((sector, index) => out.set(bytes.subarray(offset(sector), offset(sector) + sectorSize), index * sectorSize)); return out; };
  const directory = read(firstDirectory), dv = new DataView(directory.buffer);
  const entries: Array<{ name: string; type: number; start: number; size: number }> = [];
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const length = Math.max(0, dv.getUint16(at + 64, true) - 2);
    let name = '';
    for (let index = 0; index < length; index += 2) name += String.fromCharCode(dv.getUint16(at + index, true));
    entries.push({ name, type: directory[at + 66], start: dv.getUint32(at + 116, true), size: dv.getUint32(at + 120, true) });
  }
  const root = entries.find(entry => entry.type === 5);
  const entry = wanted.map(name => entries.find(item => item.type === 2 && item.name.toLowerCase() === name.toLowerCase())).find(Boolean);
  if (!entry) return null;
  if (entry.size >= cutoff || !root) return read(entry.start).subarray(0, entry.size);
  const miniStream = read(root.start), miniFatBytes = read(firstMiniFat), miniFat = new Uint32Array(miniFatBytes.length / 4);
  const mv = new DataView(miniFatBytes.buffer);
  for (let index = 0; index < miniFat.length; index++) miniFat[index] = mv.getUint32(index * 4, true);
  const sectors = chain(entry.start, miniFat), out = new Uint8Array(sectors.length * miniSize);
  sectors.forEach((sector, index) => out.set(miniStream.subarray(sector * miniSize, sector * miniSize + miniSize), index * miniSize));
  return out.subarray(0, entry.size);
}

const latin = (bytes: Uint8Array) => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return text; };
const utf16 = (bytes: Uint8Array) => { let text = ''; for (let index = 0; index + 1 < bytes.length; index += 2) text += String.fromCharCode(bytes[index] | (bytes[index + 1] << 8)); return text; };

// The shared string table, read across its CONTINUE records.
function sharedStrings(segments: Uint8Array[]): string[] {
  const strings: string[] = [];
  if (!segments.length || segments[0].length < 8) return strings;
  const unique = new DataView(segments[0].buffer, segments[0].byteOffset, segments[0].byteLength).getUint32(4, true);
  let segment = 0, at = 8;
  const more = () => segment < segments.length;
  const byte = () => { while (more() && at >= segments[segment].length) { segment++; at = 0; } return more() ? segments[segment][at++] : 0; };
  const u16 = () => byte() | (byte() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const skip = (count: number) => { while (count > 0 && more()) { const room = segments[segment].length - at; if (room <= 0) { segment++; at = 0; continue; } const step = Math.min(room, count); at += step; count -= step; } };
  for (let index = 0; index < unique && more(); index++) {
    let count = u16();
    const options = byte();
    const runs = options & 0x08 ? u16() : 0, extended = options & 0x04 ? u32() : 0;
    let wide = options & 0x01, text = '';
    while (count > 0 && more()) {
      if (at >= segments[segment].length) { segment++; at = 0; if (!more()) break; wide = segments[segment][at++] & 0x01; }
      const size = wide ? 2 : 1, take = Math.min(count, Math.floor((segments[segment].length - at) / size));
      if (take <= 0) { at = segments[segment].length; continue; }
      const part = segments[segment].subarray(at, at + take * size);
      text += wide ? utf16(part) : latin(part);
      at += take * size; count -= take;
    }
    skip(runs * 4 + extended);
    strings.push(text);
  }
  return strings;
}

const errors: Record<number, string> = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0f: '#VALUE!', 0x17: '#REF!', 0x1d: '#NAME?', 0x24: '#NUM!', 0x2a: '#N/A' };
const number = (value: number) => String(Number(value.toPrecision(15)));
function rk(value: number) {
  let result: number;
  if (value & 0x02) result = value >> 2;
  else { const buffer = new DataView(new ArrayBuffer(8)); buffer.setUint32(4, value & 0xfffffffc, true); result = buffer.getFloat64(0, true); }
  return number(value & 0x01 ? result / 100 : result);
}
// A BIFF8 XLUnicodeString (16-bit length, options byte, 8- or 16-bit characters).
const unicodeString = (data: Uint8Array, at: number) => { const view = new DataView(data.buffer, data.byteOffset, data.byteLength); const count = view.getUint16(at, true), wide = data[at + 2] & 0x01; const body = data.subarray(at + 3, at + 3 + count * (wide ? 2 : 1)); return wide ? utf16(body) : latin(body); };

export function xlsRows(bytes: Uint8Array): string[][] {
  const stream = compoundStream(bytes, ['Workbook', 'Book']);
  if (!stream) throw new Error(t("엑셀 파일을 읽지 못했습니다."));
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const records: Array<{ type: number; at: number; data: Uint8Array }> = [];
  for (let at = 0; at + 4 <= stream.length;) {
    const type = view.getUint16(at, true), length = view.getUint16(at + 2, true);
    records.push({ type, at, data: stream.subarray(at + 4, at + 4 + length) });
    at += 4 + length;
  }
  const first = records[0];
  if (!first || first.type !== 0x0809 || new DataView(first.data.buffer, first.data.byteOffset, first.data.byteLength).getUint16(0, true) !== 0x0600) throw new Error(t("Excel 97 이전 형식의 .xls 파일은 가져올 수 없습니다. .xlsx로 저장한 뒤 가져오세요."));
  const sheets: Array<{ at: number; visible: boolean; worksheet: boolean }> = [];
  let strings: string[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index], data = record.data, dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (record.type === 0x0085 && data.length >= 6) sheets.push({ at: dv.getUint32(0, true), visible: (data[4] & 0x03) === 0, worksheet: data[5] === 0 });
    if (record.type === 0x00fc) {
      const segments = [data];
      for (let next = index + 1; next < records.length && records[next].type === 0x003c; next++) segments.push(records[next].data);
      strings = sharedStrings(segments);
    }
    if (record.type === 0x000a) break;
  }
  const sheet = sheets.find(item => item.worksheet && item.visible) ?? sheets.find(item => item.worksheet);
  if (!sheet) throw new Error(t("시트가 비어 있습니다."));
  const rows: string[][] = [];
  const put = (row: number, column: number, value: string) => { (rows[row] ??= [])[column] = value; };
  const start = records.findIndex(record => record.at === sheet.at);
  if (start < 0) throw new Error(t("엑셀 파일을 읽지 못했습니다."));
  let pendingFormula: [number, number] | null = null;
  for (let index = start + 1; index < records.length; index++) {
    const { type, data } = records[index], dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (type === 0x000a) break;
    if (data.length < 6 && type !== 0x0207) continue;
    const row = data.length >= 4 ? dv.getUint16(0, true) : 0, column = data.length >= 4 ? dv.getUint16(2, true) : 0;
    if (type === 0x00fd && data.length >= 10) put(row, column, strings[dv.getUint32(6, true)] ?? '');
    else if (type === 0x0203 && data.length >= 14) put(row, column, number(dv.getFloat64(6, true)));
    else if (type === 0x027e && data.length >= 10) put(row, column, rk(dv.getUint32(6, true)));
    else if (type === 0x00bd) { for (let at = 4, col = column; at + 6 <= data.length - 2; at += 6, col++) put(row, col, rk(dv.getUint32(at + 2, true))); }
    else if ((type === 0x0204 || type === 0x00d6) && data.length >= 9) put(row, column, unicodeString(data, 6));
    else if (type === 0x0205 && data.length >= 8) put(row, column, data[7] ? errors[data[6]] ?? '#ERROR' : data[6] ? 'true' : 'false');
    else if (type === 0x0006 && data.length >= 14) {
      if (data[12] === 0xff && data[13] === 0xff) {
        const kind = data[6];
        if (kind === 0) pendingFormula = [row, column];
        else if (kind === 1) put(row, column, data[8] ? 'true' : 'false');
        else if (kind === 2) put(row, column, errors[data[8]] ?? '#ERROR');
        else put(row, column, '');
      } else put(row, column, number(dv.getFloat64(6, true)));
    } else if (type === 0x0207 && pendingFormula && data.length >= 3) { put(pendingFormula[0], pendingFormula[1], unicodeString(data, 0)); pendingFormula = null; }
  }
  return Array.from(rows, row => Array.from(row ?? [], value => value ?? ''));
}
