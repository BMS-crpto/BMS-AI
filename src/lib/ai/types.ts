export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'openrouter';
export type ThinkingMode = 'fast' | 'thinking' | 'coding' | 'research';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ErrorKind =
  | 'quota'       // 429 / RESOURCE_EXHAUSTED / insufficient_quota: do NOT retry
  | 'transient'   // 500 / 502 / 503 / 504 / network: retry with backoff
  | 'timeout'     // our own AbortSignal fired
  | 'auth'        // 401 / 403: bad key
  | 'not_found'   // 404: wrong model name
  | 'bad_request' // 400
  | 'empty'       // provider answered with no text
  | 'unknown';

export type SearchSource = { title: string; url: string; snippet: string };

export type ProviderResult = {
  text: string;
  provider: ProviderId;
  model: string;
  sources?: SearchSource[];
};

export type ProviderAttempt = {
  provider: ProviderId;
  status: 'skipped_unconfigured' | 'skipped_cooldown' | 'failed' | 'ok';
  kind?: ErrorKind;
  detail?: string;
  retryAfterSeconds?: number;
};
