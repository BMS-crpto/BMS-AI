import { useEffect, useRef, useState } from 'react';
import { firstTableCsv, toHtml } from '@/lib/markdown';

export type ClientAttachment = {
  name: string;
  kind: 'image' | 'pdf' | 'text' | 'csv' | 'xlsx';
  mime?: string;
  data?: string;
  text?: string;
};

const MAX_BINARY = 4_500_000; // pdf / xlsx, raw bytes
const MAX_TEXT = 1_500_000;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

async function imageToJpeg(file: File): Promise<string> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } catch {
    throw new Error(`Could not read the image "${file.name}". Try a JPG or PNG.`);
  }
}

export async function fileToAttachment(file: File): Promise<ClientAttachment> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const name = file.name || 'file';

  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return { name, kind: 'image', mime: 'image/jpeg', data: await imageToJpeg(file) };
  }
  if (file.type === 'application/pdf' || ext === 'pdf') {
    if (file.size > MAX_BINARY) throw new Error(`"${name}" is too large. PDFs can be up to about 4 MB.`);
    return { name, kind: 'pdf', mime: 'application/pdf', data: await readBase64(file) };
  }
  if (ext === 'xlsx') {
    if (file.size > MAX_BINARY) throw new Error(`"${name}" is too large. Spreadsheets can be up to about 4 MB.`);
    return { name, kind: 'xlsx', data: await readBase64(file) };
  }
  if (ext === 'xls') throw new Error('Old .xls files are not supported. Save it as .xlsx or .csv and try again.');
  if (ext === 'csv' || ext === 'tsv') {
    if (file.size > MAX_TEXT) throw new Error(`"${name}" is too large (limit about 1.5 MB).`);
    return { name, kind: 'csv', text: await file.text() };
  }
  if (['txt', 'md', 'json', 'log', 'xml'].includes(ext) || file.type.startsWith('text/')) {
    if (file.size > MAX_TEXT) throw new Error(`"${name}" is too large (limit about 1.5 MB).`);
    return { name, kind: 'text', text: await file.text() };
  }
  throw new Error(`"${name}" is not supported. Use photos, PDF, CSV, XLSX or text files.`);
}

/* ------------------------------- Voice input ------------------------------- */

export function useSpeech(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const recRef = useRef<any>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    const w = window as any;
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as any;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    setSpeechError('');
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results as ArrayLike<any>).map(r => r[0]?.transcript || '').join(' ').trim();
      if (text) onTextRef.current(text);
    };
    rec.onerror = (e: any) => {
      setSpeechError(e?.error === 'not-allowed' ? 'Microphone permission was denied.' : 'Voice input stopped. Try again.');
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  return { supported, listening, toggle, speechError };
}

/* ---------------------------------- Export --------------------------------- */

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const DOC_STYLE =
  'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111}' +
  'table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}th{background:#eee}' +
  'pre{background:#f4f4f4;padding:8px;white-space:pre-wrap}code{font-family:Consolas,monospace}';

export function exportWord(text: string) {
  const html =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
    `<head><meta charset="utf-8"><title>BMS AI</title><style>${DOC_STYLE}</style></head><body>${toHtml(text)}</body></html>`;
  download('bms-ai-answer.doc', 'application/msword', html);
}

export function exportCsv(text: string): boolean {
  const csv = firstTableCsv(text);
  if (!csv) return false;
  download('bms-ai-table.csv', 'text/csv;charset=utf-8', '\uFEFF' + csv);
  return true;
}

export function hasTable(text: string): boolean {
  return firstTableCsv(text) !== null;
}

/** Opens the print dialog; on a phone choose "Save as PDF". */
export function exportPdf(text: string) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>BMS AI</title><style>${DOC_STYLE}</style></head><body>${toHtml(text)}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60000);
  }, 300);
}

/* -------------------------------- Templates -------------------------------- */

export const TEMPLATES: { label: string; prompt: string }[] = [
  { label: 'Draft an invoice', prompt: 'Draft a professional invoice for this work. Client: [name]. Service: [what was done]. Amount: [amount]. Include an invoice number, date, payment terms and a short thank-you.' },
  { label: 'Summarize this file', prompt: 'Summarize the attached file in 5 short bullet points and list any action items or deadlines.' },
  { label: 'Check my sums', prompt: 'Using the attached spreadsheet, give the total for each category and point out anything unusual or possibly wrong.' },
  { label: 'Reply to a message', prompt: 'Write a polite, professional reply to this message:\n\n' },
  { label: 'Excel formula', prompt: 'Write an Excel formula for this and explain it step by step:\n\n' },
  { label: 'Notes to tasks', prompt: 'Turn these notes into a clear task list with owners and deadlines:\n\n' },
  { label: 'Explain simply', prompt: 'Explain this in simple words with an example:\n\n' },
];
