import { classifyFetchFailure, classifyHttpError, ProviderError } from './errors';
import { MAX_OUTPUT_TOKENS, modelFor, systemPrompt } from './modes';
import type { ChatMessage, ProviderId, ProviderResult, SearchSource, ThinkingMode } from './types';

export type CallOptions = {
  messages: ChatMessage[];
  mode: ThinkingMode;
  timeoutMs: number;
  /** Search results to ground the answer (Research mode). */
  searchContext?: string;
  sources?: SearchSource[];
  /** Let Gemini use its own Google Search grounding (only when no search API key is set). */
  geminiNativeSearch?: boolean;
};

export function isConfigured(provider: ProviderId): boolean {
  if (provider === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
  if (provider === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function post(provider: ProviderId, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw classifyFetchFailure(provider, e);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw classifyHttpError(provider, res.status, res.headers, data);
  return data;
}

function nonEmpty(provider: ProviderId, text: string): string {
  if (!text.trim()) throw new ProviderError(provider, 'empty', `${provider} returned no text.`);
  return text;
}

async function callGemini(o: CallOptions): Promise<ProviderResult> {
  const model = modelFor('gemini', o.mode);
  const generationConfig: Record<string, unknown> = { maxOutputTokens: MAX_OUTPUT_TOKENS[o.mode] };
  // Thinking budget is only valid for 2.5-series models.
  if (/2\.5/.test(model) && o.mode === 'fast') generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemPrompt(o.mode, o.searchContext) }] },
    contents: o.messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    })),
    generationConfig,
  };
  if (o.geminiNativeSearch) body.tools = [{ google_search: {} }];

  const data = await post(
    'gemini',
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
    body,
    o.timeoutMs
  );

  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((p: any) => p.text || '').join('');
  let sources = o.sources;
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!sources && Array.isArray(chunks)) {
    sources = chunks
      .filter((c: any) => c.web?.uri)
      .map((c: any) => ({ title: c.web.title || c.web.uri, url: c.web.uri, snippet: '' }));
  }
  return { text: nonEmpty('gemini', text), provider: 'gemini', model, sources };
}

async function callOpenAI(o: CallOptions): Promise<ProviderResult> {
  const model = modelFor('openai', o.mode);
  const data = await post(
    'openai',
    'https://api.openai.com/v1/chat/completions',
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model,
      messages: [{ role: 'system', content: systemPrompt(o.mode, o.searchContext) }, ...o.messages],
      max_tokens: MAX_OUTPUT_TOKENS[o.mode],
    },
    o.timeoutMs
  );
  const text = data?.choices?.[0]?.message?.content;
  return { text: nonEmpty('openai', typeof text === 'string' ? text : ''), provider: 'openai', model, sources: o.sources };
}

async function callAnthropic(o: CallOptions): Promise<ProviderResult> {
  const model = modelFor('anthropic', o.mode);
  const data = await post(
    'anthropic',
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: MAX_OUTPUT_TOKENS[o.mode],
      system: systemPrompt(o.mode, o.searchContext),
      messages: o.messages,
    },
    o.timeoutMs
  );
  const text = (data?.content || []).filter((p: any) => p.type === 'text').map((p: any) => p.text || '').join('\n');
  return { text: nonEmpty('anthropic', text), provider: 'anthropic', model, sources: o.sources };
}

export function callProvider(provider: ProviderId, o: CallOptions): Promise<ProviderResult> {
  if (provider === 'gemini') return callGemini(o);
  if (provider === 'openai') return callOpenAI(o);
  return callAnthropic(o);
}
