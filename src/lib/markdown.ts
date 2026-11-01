/**
 * Tiny, dependency-free Markdown parser for chat answers.
 * It produces a plain data tree (never HTML), so the renderer can build React
 * elements from it and nothing the AI writes can inject markup or scripts.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

export type ListItem = { c: Inline[]; children: Block[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'hr' }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; items: ListItem[] }
  | { t: 'table'; head: Inline[][]; align: string[]; rows: Inline[][][] };

function pushText(out: Inline[], text: string) {
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (i > 0) out.push({ t: 'br' });
    if (part) out.push({ t: 'text', v: part });
  });
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) { pushText(out, buf); buf = ''; }
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;

    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'code', v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if ((m = rest.match(/^<br\s*\/?>/i))) { flush(); out.push({ t: 'br' }); i += m[0].length; continue; }
    if ((m = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/))) {
      flush(); out.push({ t: 'link', href: m[2], c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/))) {
      flush(); out.push({ t: 'strong', c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\*([^\s*](?:[^*]*?[^\s*])?)\*/))) {
      flush(); out.push({ t: 'em', c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    const prev = i > 0 ? src[i - 1] : '';
    if (!/[A-Za-z0-9]/.test(prev) && (m = rest.match(/^_([^\s_](?:[^_]*?[^\s_])?)_(?![A-Za-z0-9])/))) {
      flush(); out.push({ t: 'em', c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    if (!/[A-Za-z0-9]/.test(prev) && (m = rest.match(/^https?:\/\/[^\s<>"')\]]+/))) {
      const url = m[0].replace(/[.,;:!?]+$/, '');
      flush(); out.push({ t: 'link', href: url, c: [{ t: 'text', v: url }] }); i += url.length; continue;
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
}

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (s[k] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[k];
  }
  cells.push(cur.trim());
  return cells;
}

type Flat = { indent: number; ordered: boolean; text: string };

function buildList(items: Flat[], pos: { i: number }, indent: number): Block {
  const list: { t: 'list'; ordered: boolean; items: ListItem[] } = {
    t: 'list', ordered: items[pos.i].ordered, items: [],
  };
  while (pos.i < items.length) {
    const it = items[pos.i];
    if (it.indent < indent) break;
    if (it.indent > indent) {
      list.items[list.items.length - 1].children.push(buildList(items, pos, it.indent));
      continue;
    }
    list.items.push({ c: parseInline(it.text), children: [] });
    pos.i++;
  }
  return list;
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) || HEADING.test(line) || HR.test(line) || LIST.test(line) ||
    /^\s*>/.test(line) || (line.includes('|') && next !== undefined && TABLE_SEP.test(next))
  );
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m: RegExpMatchArray | null;

    if ((m = line.match(FENCE))) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // closing fence (or end of text while streaming/truncated)
      blocks.push({ t: 'code', lang: m[1] || '', v: body.join('\n') });
      continue;
    }
    if ((m = line.match(HEADING))) {
      blocks.push({ t: 'h', level: m[1].length, c: parseInline(m[2]) });
      i++; continue;
    }
    if (HR.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(c =>
        /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : 'left');
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ t: 'table', head: head.map(parseInline), align, rows });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { inner.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ t: 'quote', c: parseMarkdown(inner.join('\n')) });
      continue;
    }

    if (LIST.test(line)) {
      const flat: Flat[] = [];
      while (i < lines.length) {
        const lm = lines[i].match(LIST);
        if (lm) {
          const indent = lm[1].replace(/\t/g, '    ').length;
          const ordered = /\d/.test(lm[2]);
          // A different list type at the top level starts a new list.
          if (flat.length && indent <= flat[0].indent && ordered !== flat[0].ordered) break;
          flat.push({ indent, ordered, text: lm[3] });
          i++;
        } else if (!lines[i].trim() && i + 1 < lines.length && LIST.test(lines[i + 1])) {
          i++; // blank line between items of the same list
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && flat.length && !startsBlock(lines[i], lines[i + 1])) {
          flat[flat.length - 1].text += ' ' + lines[i].trim(); // wrapped continuation line
          i++;
        } else break;
      }
      blocks.push(buildList(flat, { i: 0 }, flat[0].indent));
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i], lines[i + 1]))) {
      para.push(lines[i]); i++;
    }
    blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
  }
  return blocks;
}
