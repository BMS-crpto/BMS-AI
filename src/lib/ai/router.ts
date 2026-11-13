import { cooldownInfo, markAuthFailure, markMissing, markQuota } from './cooldown';
import { PROVIDER_LABEL, ProviderError } from './errors';
import { modelsFor } from './modes';
import { callProvider, isConfigured, MEDIA_CAPABLE } from './providers';
import { formatSources, searchConfigured, webSearch } from './search';
import type { ChatMessage, Media, ProviderAttempt, ProviderId, ProviderResult, SearchSource, ThinkingMode } from './types';

const ALL: ProviderId[] = ['gemini', 'groq', 'openrouter', 'anthropic', 'openai'];

const PER_CALL_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 40_000;
const TOTAL_BUDGET_MS = Number(process.env.AI_TOTAL_BUDGET_MS) || 85_000; // below typical 100s proxy limit
const MAX_TRANSIENT_TRIES = 3; // 1 call + 2 retries for 5xx
const MAX_TIMEOUT_TRIES = 2;   // 1 call + 1 retry for timeouts

export type RouteSuccess = {
  result: ProviderResult;
  attempts: ProviderAttempt[];
  notice?: string;
};

export class AllProvidersFailed extends Error {
  constructor(
    message: string,
    public attempts: ProviderAttempt[],
    public httpStatus: number,
    public code: 'no_provider' | 'quota' | 'unavailable'
  ) {
    super(message);
    this.name = 'AllProvidersFailed';
  }
}

function providerOrder(requested: string): ProviderId[] {
  const configured = (process.env.AI_PROVIDER_ORDER || 'gemini,groq,openrouter,anthropic,openai')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter((s): s is ProviderId => (ALL as string[]).includes(s));
  const base = [...new Set([...configured, ...ALL])];
  if ((ALL as string[]).includes(requested)) {
    return [requested as ProviderId, ...base.filter(p => p !== requested)];
  }
  return base;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const backoff = (attempt: number, retryAfter?: number) =>
  Math.min(retryAfter ? retryAfter * 1000 : 600 * 2 ** attempt, 5000) + Math.floor(Math.random() * 250);

function minutes(seconds: number) {
  return seconds < 90 ? 'about a minute' : `about ${Math.ceil(seconds / 60)} minutes`;
}

function describe(a: ProviderAttempt): string {
  const name = PROVIDER_LABEL[a.provider];
  switch (a.status) {
    case 'skipped_unconfigured': return `${name}: not configured on the server`;
    case 'skipped_cooldown': return `${name}: quota exhausted (paused, retry in ${minutes(a.retryAfterSeconds ?? 900)})`;
    case 'failed':
      switch (a.kind) {
        case 'quota': return `${name}: quota or rate limit reached`;
        case 'transient': return `${name}: temporarily overloaded`;
        case 'timeout': return `${name}: did not respond in time`;
        case 'auth': return `${name}: API key rejected (check server settings)`;
        case 'not_found': return `${name}: configured model not found (check model name)`;
        case 'bad_request': return `${name}: request rejected`;
        case 'empty': return `${name}: returned an empty answer`;
        default: return `${name}: unexpected error`;
      }
    default: return name;
  }
}

function buildFailure(attempts: ProviderAttempt[], mediaPresent = false): AllProvidersFailed {
  const configured = attempts.filter(a => a.status !== 'skipped_unconfigured');
  if (configured.length === 0) {
    return new AllProvidersFailed(
      'No AI provider is configured on the server. Add GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY in the hosting environment.',
      attempts, 503, 'no_provider'
    );
  }
  const quotaish = (a: ProviderAttempt) => a.status === 'skipped_cooldown' || a.kind === 'quota';
  const allQuota = configured.every(quotaish);
  const waits = configured.map(a => a.retryAfterSeconds).filter((n): n is number => typeof n === 'number');
  const hint = allQuota
    ? waits.length
      ? ` Usage limits are exhausted; the soonest provider may recover in ${minutes(Math.min(...waits))}. Adding billing or another provider key removes the limit.`
      : ' Usage limits are exhausted. Try again later, or add billing or another provider key.'
    : ' Please try again in a moment.';
  const lines = configured.map(describe).join('; ');
  const mediaNote = mediaPresent ? ' Images and PDFs can only be read by Gemini, OpenAI or Claude (Groq and OpenRouter cannot).' : '';
  return new AllProvidersFailed(
    `BMS AI could not get an answer from any AI provider. ${lines}.${hint}${mediaNote}`,
    attempts,
    allQuota ? 429 : 503,
    allQuota ? 'quota' : 'unavailable'
  );
}

export async function routeChat(input: {
  messages: ChatMessage[];
  mode: ThinkingMode;
  requested: string;
  extraContext?: string;
  media?: Media[];
}): Promise<RouteSuccess> {
  const { messages, mode, requested } = input;
  const startedAt = Date.now();
  const deadline = startedAt + TOTAL_BUDGET_MS;
  const attempts: ProviderAttempt[] = [];

  // ---- Research: one web search per request, shared by whichever provider answers.
  let sources: SearchSource[] | undefined;
  let searchContext: string | undefined;
  if (mode === 'research' && searchConfigured()) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const found = await webSearch(lastUser);
    if (found.ok) {
      sources = found.sources;
      searchContext = formatSources(found.sources);
    }
  }
  const searchUnavailable = mode === 'research' && !sources;
  if (input.extraContext) searchContext = [input.extraContext, searchContext].filter(Boolean).join('\n\n');

  // ---- Provider loop
  const media = input.media && input.media.length ? input.media : undefined;
  let order = providerOrder(requested);
  if (media) {
    order = order.filter(p => MEDIA_CAPABLE.includes(p));
    if (!order.some(isConfigured)) {
      throw new AllProvidersFailed(
        'Reading images and PDFs needs a Gemini, OpenAI or Claude API key on the server. Groq and OpenRouter cannot read them. Add one of those keys, or paste the text instead.',
        [], 503, 'no_provider'
      );
    }
  }

  for (const provider of order) {
    if (!isConfigured(provider)) {
      attempts.push({ provider, status: 'skipped_unconfigured' });
      continue;
    }
    const cd = cooldownInfo(provider);
    if (cd) {
      attempts.push({ provider, status: cd.reason === 'quota' ? 'skipped_cooldown' : 'failed', kind: cd.reason === 'auth' ? 'auth' : 'quota', retryAfterSeconds: cd.remainingSeconds });
      continue;
    }

    const geminiNativeSearch = provider === 'gemini' && searchUnavailable;
    const usedNoSearch = searchUnavailable && !geminiNativeSearch;

    const models = modelsFor(provider, mode);
    const keyOf = (m: string) => `${provider}:${m}`;
    let lastError: ProviderError | null = null;
    let stopProvider = false;

    for (let mi = 0; mi < models.length && !stopProvider; mi++) {
      const model = models[mi];
      if (cooldownInfo(keyOf(model))) continue; // this model is paused (quota) or missing

      // With backup models left, give up on a busy model sooner.
      const moreModels = models.slice(mi + 1).some(m => !cooldownInfo(keyOf(m)));
      const maxTransient = moreModels ? 2 : MAX_TRANSIENT_TRIES;

      let tries = 0;
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining < 4000) { stopProvider = true; break; }
        tries++;
        try {
          const result = await callProvider(provider, {
            messages, mode, media, model,
            timeoutMs: Math.min(PER_CALL_TIMEOUT_MS, remaining),
            searchContext, sources, geminiNativeSearch,
          });
          attempts.push({ provider, status: 'ok' });
          const notices: string[] = [];
          const first = attempts.find(a => a.status !== 'skipped_unconfigured');
          if (first && first.provider !== provider) {
            const why = first.status === 'skipped_cooldown' || first.kind === 'quota' ? 'usage limit reached' : first.kind === 'auth' ? 'API key problem' : 'temporarily unavailable';
            notices.push(`${PROVIDER_LABEL[first.provider]} ${why}, so ${PROVIDER_LABEL[provider]} answered instead.`);
          }
          if (usedNoSearch) notices.push('Live web search was unavailable, so this answer is not based on current web sources.');
          return { result, attempts, notice: notices.join(' ') || undefined };
        } catch (e) {
          const err = e instanceof ProviderError ? e : new ProviderError(provider, 'unknown', String(e));
          lastError = err;
          console.error(`BMS AI ${provider}/${model} error [${err.kind}${err.status ? ' ' + err.status : ''}]: ${err.message}`);

          if (err.kind === 'quota') { markQuota(keyOf(model), err.retryAfterSeconds); break; }   // never retry quota; try the next model
          if (err.kind === 'not_found') { markMissing(keyOf(model)); break; }                      // wrong model name: skip it for hours
          if (err.kind === 'auth') { markAuthFailure(provider); stopProvider = true; break; }       // bad key: skip the provider
          const canRetry =
            (err.kind === 'transient' && tries < maxTransient) ||
            (err.kind === 'timeout' && tries < MAX_TIMEOUT_TRIES);
          if (canRetry) { await sleep(backoff(tries - 1, err.retryAfterSeconds)); continue; }
          // Out of retries on a busy model: the next model may be fine. Other errors end this provider.
          if (err.kind === 'transient' || err.kind === 'timeout' || err.kind === 'empty') break;
          stopProvider = true;
          break;
        }
      }
    }

    // Summarise this provider for the final message.
    const waits = models
      .map(m => cooldownInfo(keyOf(m)))
      .filter((c): c is NonNullable<typeof c> => Boolean(c) && c!.reason === 'quota')
      .map(c => c.remainingSeconds);
    const authCd = cooldownInfo(provider);
    if (lastError === null) {
      // Every model was already paused; nothing was called.
      attempts.push({
        provider,
        status: waits.length ? 'skipped_cooldown' : 'failed',
        kind: waits.length ? 'quota' : 'not_found',
        retryAfterSeconds: waits.length ? Math.min(...waits) : undefined,
      });
    } else {
      attempts.push({
        provider, status: 'failed',
        kind: authCd ? 'auth' : lastError.kind,
        detail: lastError.message,
        retryAfterSeconds: waits.length ? Math.min(...waits) : undefined,
      });
    }
  }

  throw buildFailure(attempts, Boolean(media));
}
