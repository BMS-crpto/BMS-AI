import type { ErrorKind, ProviderId } from './types';

export class ProviderError extends Error {
  constructor(
    public provider: ProviderId,
    public kind: ErrorKind,
    message: string,
    public status?: number,
    public retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function parseRetryAfter(headers: Headers, body: any): number | undefined {
  const header = headers.get('retry-after');
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  }
  // Gemini puts "retryDelay": "34s" inside error.details (RetryInfo)
  const details = body?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const m = typeof d?.retryDelay === 'string' && d.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
      if (m) return Math.ceil(Number(m[1]));
    }
  }
  return undefined;
}

/**
 * Turns an HTTP error response into a typed ProviderError.
 * The key distinction: 429 = quota/rate limit (never retried),
 * 5xx = temporary (retried a limited number of times).
 */
export function classifyHttpError(
  provider: ProviderId,
  status: number,
  headers: Headers,
  body: any
): ProviderError {
  const message: string =
    body?.error?.message || body?.message || `${provider} returned HTTP ${status}.`;
  const code = String(body?.error?.status || body?.error?.code || body?.error?.type || '');
  const retryAfter = parseRetryAfter(headers, body);

  if (
    status === 429 ||
    /RESOURCE_EXHAUSTED|insufficient_quota|rate_limit/i.test(code) ||
    /quota|rate limit|billing/i.test(message) && status !== 503
  ) {
    return new ProviderError(provider, 'quota', message, status, retryAfter);
  }
  // Anthropic overloaded_error is HTTP 529
  if ([500, 502, 503, 504, 529].includes(status)) {
    return new ProviderError(provider, 'transient', message, status, retryAfter);
  }
  if (status === 401 || status === 403) return new ProviderError(provider, 'auth', message, status);
  if (status === 404) return new ProviderError(provider, 'not_found', message, status);
  if (status === 400) return new ProviderError(provider, 'bad_request', message, status);
  return new ProviderError(provider, 'unknown', message, status);
}

export function classifyFetchFailure(provider: ProviderId, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const name = (error as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ProviderError(provider, 'timeout', `${provider} did not respond in time.`);
  }
  return new ProviderError(provider, 'transient', `Could not connect to ${provider}.`);
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Claude',
  groq: 'Groq',
  openrouter: 'OpenRouter',
};
