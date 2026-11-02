'use client';

import { useState } from 'react';
import { ClientAttachment, copyText, exportCsv, exportPdf, exportWord, hasTable, TEMPLATES } from './chatTools';

export function AttachmentChips({ items, onRemove }: { items: ClientAttachment[]; onRemove: (index: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="chip-row">
      {items.map((a, i) => (
        <span className="chip chip-file" key={`${a.name}-${i}`}>
          {a.kind === 'image' ? '🖼' : a.kind === 'pdf' ? '📄' : a.kind === 'csv' || a.kind === 'xlsx' ? '📊' : '📝'} {a.name}
          <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${a.name}`}>×</button>
        </span>
      ))}
    </div>
  );
}

export function TemplateChips({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="chip-row chip-scroll" aria-label="Quick prompts">
      {TEMPLATES.map(t => (
        <button type="button" className="chip" key={t.label} onClick={() => onPick(t.prompt)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function MessageActions({ text }: { text: string }) {
  const [state, setState] = useState('');
  const flash = (msg: string) => {
    setState(msg);
    setTimeout(() => setState(''), 1500);
  };
  return (
    <div className="msg-actions">
      <button type="button" onClick={async () => flash((await copyText(text)) ? 'Copied' : 'Copy failed')}>
        {state || 'Copy'}
      </button>
      <button type="button" onClick={() => exportWord(text)}>Word</button>
      <button type="button" onClick={() => exportPdf(text)}>PDF</button>
      {hasTable(text) && (
        <button type="button" onClick={() => { exportCsv(text); }}>Table (CSV)</button>
      )}
    </div>
  );
}
