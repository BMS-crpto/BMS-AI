'use client';

import { ReactNode, useState } from 'react';
import { Block, Inline, parseMarkdown } from '@/lib/markdown';

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'br': return <br key={i} />;
      case 'code': return <code key={i}>{n.v}</code>;
      case 'strong': return <strong key={i}>{renderInline(n.c)}</strong>;
      case 'em': return <em key={i}>{renderInline(n.c)}</em>;
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {renderInline(n.c)}
          </a>
        );
    }
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  };
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || 'code'}</span>
        <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'p': return <p key={i}>{renderInline(b.c)}</p>;
      case 'h': {
        const level = Math.min(Math.max(b.level, 1), 6);
        const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return <Tag key={i}>{renderInline(b.c)}</Tag>;
      }
      case 'hr': return <hr key={i} />;
      case 'code': return <CodeBlock key={i} lang={b.lang} code={b.v} />;
      case 'quote': return <blockquote key={i}>{renderBlocks(b.c)}</blockquote>;
      case 'list': {
        const items = b.items.map((it, j) => (
          <li key={j}>
            {renderInline(it.c)}
            {renderBlocks(it.children)}
          </li>
        ));
        return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      case 'table':
        return (
          <div className="md-table" key={i}>
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} style={{ textAlign: b.align[j] as 'left' | 'center' | 'right' }}>{renderInline(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, j) => (
                      <td key={j} style={{ textAlign: b.align[j] as 'left' | 'center' | 'right' }}>{renderInline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export default function Markdown({ text }: { text: string }) {
  return <div className="md">{renderBlocks(parseMarkdown(text))}</div>;
}
