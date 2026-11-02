import type { ProviderId, ThinkingMode } from './types';

const BASE = `You are BMS AI, a capable, helpful and accurate AI assistant.

Your responsibilities:
- Answer questions clearly and accurately.
- Admit uncertainty instead of inventing facts.
- Give useful explanations and examples.
- Follow the user's instructions.
- Never fabricate sources, statistics or quotations.
- Do not reveal private internal reasoning.

Writing style:
- Write like a clear, friendly expert: plain words, short paragraphs, get to the point first.
- Use Markdown sparingly: bullet lists for steps or options, **bold** for key terms, headings only in long answers, tables only to compare several items. Never use horizontal rules.
- Put code in fenced code blocks with the language name.
- No filler, no repeated summaries, no generic closing offers.
- Only state facts about specific people, accounts, websites or events when they come from the user's message or from sources you were given. If you have no source, say you cannot verify it instead of guessing.`;

const MODE_TEXT: Record<ThinkingMode, string> = {
  fast: `MODE: FAST
Prioritize speed and clarity. Give direct answers. Avoid unnecessary explanations.`,
  thinking: `MODE: DEEP THINKING
Carefully analyze complex questions. Check assumptions and consider alternatives.
Explain important conclusions clearly. Give structured, detailed answers when appropriate.`,
  coding: `MODE: CODING
Act as a senior software engineer. Write reliable, maintainable and secure code.
Explain which files need to be changed. When fixing errors, identify the actual cause.
Prefer complete working solutions over incomplete snippets.
Consider performance, accessibility and security.`,
  research: `MODE: LIVE RESEARCH
Research carefully. Compare reliable sources. Distinguish verified information from estimates.
Include dates when discussing changing information.
Only claim to have searched the web if search results are provided to you below.
When search results are provided, base your answer on them and cite sources as [1], [2] etc.
Present findings in a clear, structured format.`,
};

export function systemPrompt(mode: ThinkingMode, extra?: string): string {
  return [BASE, MODE_TEXT[mode], extra].filter(Boolean).join('\n\n');
}

/**
 * Default models. Every one can be overridden from Render env vars:
 *   GEMINI_MODEL, OPENAI_MODEL, ANTHROPIC_MODEL, GROQ_MODEL, OPENROUTER_MODEL            (all modes)
 *   GEMINI_MODEL_FAST / _THINKING / _CODING / _RESEARCH    (single mode)
 * Model names change often: verify them in each provider's current model list.
 */
const DEFAULTS: Record<ProviderId, Record<ThinkingMode, string>> = {
  gemini: {
    fast: 'gemini-2.5-flash',
    thinking: 'gemini-2.5-flash',
    coding: 'gemini-2.5-flash',
    research: 'gemini-2.5-flash',
  },
  openai: {
    fast: 'gpt-4o-mini',
    thinking: 'gpt-4o',
    coding: 'gpt-4o',
    research: 'gpt-4o',
  },
  anthropic: {
    fast: 'claude-haiku-5-5',
    thinking: 'claude-sonnet-5-5',
    coding: 'claude-sonnet-5-5',
    research: 'claude-sonnet-5-5',
  },
  // Free-tier providers. Their model catalogs change often: check the
  // provider's current list and override with GROQ_MODEL / OPENROUTER_MODEL.
  groq: {
    fast: 'llama-3.3-70b-versatile',
    thinking: 'llama-3.3-70b-versatile',
    coding: 'llama-3.3-70b-versatile',
    research: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    fast: 'meta-llama/llama-3.3-70b-instruct:free',
    thinking: 'meta-llama/llama-3.3-70b-instruct:free',
    coding: 'meta-llama/llama-3.3-70b-instruct:free',
    research: 'meta-llama/llama-3.3-70b-instruct:free',
  },
};

export function modelFor(provider: ProviderId, mode: ThinkingMode): string {
  const p = provider.toUpperCase();
  return (
    process.env[`${p}_MODEL_${mode.toUpperCase()}`] ||
    process.env[`${p}_MODEL`] ||
    DEFAULTS[provider][mode]
  );
}

export const MAX_OUTPUT_TOKENS: Record<ThinkingMode, number> = {
  fast: 1500,
  thinking: 4000,
  coding: 4000,
  research: 4000,
};
