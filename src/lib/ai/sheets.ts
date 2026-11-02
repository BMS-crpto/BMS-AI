import zlib from 'node:zlib';

/**
 * Spreadsheet reading without extra packages: CSV/TSV and .xlsx (a zip of XML files).
 * Totals are computed here, in code, so the AI quotes exact figures instead of adding up in its head.
 */

export type Table = { name: string; rows: string[][] };

const MAX_ROWS = 5000;
const MAX_COLS = 60;
const MAX_UNZIPPED = 20_000_000;

/* ---------------------------------- CSV ---------------------------------- */

export function parseCsv(text: string, name = 'data.csv'): Table {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] || '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = count('\t') > count(',') && count('\t') > count(';') ? '\t' : count(';') > count(',') ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length && rows.length < MAX_ROWS; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row.slice(0, MAX_COLS));
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some(c => c.trim() !== '') && rows.length < MAX_ROWS) rows.push(row.slice(0, MAX_COLS));
  }
  return { name, rows: rows.map(r => r.map(c => c.trim())) };
}

/* ---------------------------------- XLSX --------------------------------- */

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function readZip(data: Uint8Array): Map<string, () => Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 66_000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This does not look like an .xlsx file.');
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, () => Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < total && n < 2000; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nameLen));
    files.set(name, () => {
      if (size > MAX_UNZIPPED) throw new Error('The spreadsheet is too large to read.');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = data.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED });
      throw new Error('Unsupported compression inside the spreadsheet.');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

export function parseXlsx(data: Uint8Array, fileName = 'sheet.xlsx'): Table {
  const files = readZip(data);
  const text = (name: string) => {
    const f = files.get(name);
    return f ? new TextDecoder().decode(f()) : '';
  };

  const shared: string[] = [];
  for (const si of text('xl/sharedStrings.xml').match(/<si\b[\s\S]*?<\/si>/g) || []) {
    shared.push(decodeXml((si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
  }

  // Which cell styles are dates?
  const styles = text('xl/styles.xml');
  const customDate = new Set<number>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const code = decodeXml(m[2]).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (/[dmyhs]/i.test(code)) customDate.add(Number(m[1]));
  }
  const xfBlock = styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] || '';
  const dateStyle: boolean[] = (xfBlock.match(/<xf\b[^>]*>/g) || []).map(xf => {
    const id = Number(xf.match(/numFmtId="(\d+)"/)?.[1] ?? 0);
    return BUILTIN_DATE.has(id) || customDate.has(id);
  });

  // First worksheet (name and file path)
  const workbook = text('xl/workbook.xml');
  const first = workbook.match(/<sheet\b[^>]*>/);
  const sheetName = first ? decodeXml(first[0].match(/name="([^"]*)"/)?.[1] || 'Sheet1') : 'Sheet1';
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rid = first?.[0].match(/r:id="([^"]+)"/)?.[1];
  if (rid) {
    const rels = text('xl/_rels/workbook.xml.rels');
    for (const rel of rels.match(/<Relationship\b[^>]*>/g) || []) {
      if (rel.includes(`Id="${rid}"`)) {
        const target = rel.match(/Target="([^"]+)"/)?.[1];
        if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      }
    }
  }
  if (!files.has(sheetPath)) {
    sheetPath = [...files.keys()].find(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)) || sheetPath;
  }
  const xml = text(sheetPath);
  if (!xml) throw new Error('No readable worksheet found in this file.');

  const rows: string[][] = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
    if (rows.length >= MAX_ROWS) break;
    const out: string[] = [];
    for (const m of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const inner = m[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const s = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (t === 'inlineStr') value = decodeXml((inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).join(''));
      else if (v !== undefined) {
        if (t === 's') value = shared[Number(v)] ?? '';
        else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str' || t === 'e') value = decodeXml(v);
        else if (s >= 0 && dateStyle[s] && Number.isFinite(Number(v))) value = serialToDate(Number(v));
        else value = v;
      }
      const idx = ref ? colIndex(ref) : out.length;
      if (idx < MAX_COLS) { while (out.length < idx) out.push(''); out[idx] = value.trim(); }
    }
    if (out.some(c => c !== '')) rows.push(out);
  }
  return { name: `${fileName} / ${sheetName}`, rows };
}

/* -------------------------------- Summary -------------------------------- */

export function parseNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$€£₦¥]|NGN|USD|EUR|GBP/gi, '').replace(/[,\s]/g, '').replace(/%$/, '');
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

const fmt = (n: number) =>
  (Math.round(n * 1e6) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });

function csvLine(cells: string[]): string {
  return cells.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
}

export function summarizeTable(table: Table): string {
  const rows = table.rows.filter(r => r.length);
  if (!rows.length) return `TABLE ${table.name}: empty.`;
  const width = Math.max(...rows.map(r => r.length));
  const grid = rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? ''));

  const headerLike = grid[0].every(c => c !== '' && parseNumber(c) === null);
  const header = headerLike ? grid[0] : grid[0].map((_, i) => `Column ${i + 1}`);
  const body = headerLike ? grid.slice(1) : grid;

  const numericCols: number[] = [];
  const stats: string[] = [];
  header.forEach((h, c) => {
    const vals = body.map(r => r[c]).filter(v => v !== '');
    const nums = vals.map(parseNumber).filter((n): n is number => n !== null);
    if (nums.length && nums.length >= vals.length * 0.8) {
      numericCols.push(c);
      const sum = nums.reduce((a, b) => a + b, 0);
      stats.push(`- ${h}: ${nums.length} values, sum ${fmt(sum)}, average ${fmt(sum / nums.length)}, min ${fmt(Math.min(...nums))}, max ${fmt(Math.max(...nums))}`);
    }
  });

  // Totals grouped by the first text column whose values repeat (a category-like column).
  let grouped = '';
  const catCol = header.findIndex((_, c) => {
    if (numericCols.includes(c)) return false;
    const vals = body.map(r => r[c]).filter(v => v !== '');
    const distinct = new Set(vals).size;
    return distinct >= 2 && distinct <= 30 && distinct < vals.length;
  });
  if (catCol >= 0 && numericCols.length) {
    for (const nc of numericCols.slice(0, 3)) {
      const totals = new Map<string, number>();
      for (const r of body) {
        const n = parseNumber(r[nc]);
        if (n !== null && r[catCol]) totals.set(r[catCol], (totals.get(r[catCol]) || 0) + n);
      }
      const top = [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 15);
      grouped += `\nTotal of "${header[nc]}" by "${header[catCol]}": ` + top.map(([k, v]) => `${k} = ${fmt(v)}`).join('; ');
    }
  }

  const lines = [csvLine(header), ...body.map(csvLine)];
  let shown = lines;
  let note = '';
  if (lines.join('\n').length > 9000) {
    shown = lines.slice(0, 41);
    note = ` (showing the first 40 of ${body.length} rows)`;
  }

  return [
    `TABLE ${table.name}: ${body.length} data rows x ${width} columns${headerLike ? '' : ' (no header row found)'}`,
    stats.length
      ? 'Computed by code (exact, use these figures instead of adding numbers yourself):\n' + stats.join('\n') + grouped
      : 'No numeric columns were detected.',
    `Rows${note}:\n${shown.join('\n')}`,
  ].join('\n\n');
}
