/**
 * In-memory circuit breaker (per server process), keyed by a provider ("openai")
 * or by one model of a provider ("gemini:gemini-3.8-flash").
 * - quota error     -> that key is skipped until the cooldown expires (no repeated calls)
 * - auth error      -> the whole provider is skipped for a long time (bad key needs a redeploy)
 * - model not found -> that model is skipped for a long time (wrong name in settings)
 * On Render's single instance this is sufficient. With several instances each
 * instance learns independently, which only costs one extra call per instance.
 */
export type CooldownReason = 'quota' | 'auth' | 'missing';

const until = new Map<string, { at: number; reason: CooldownReason }>();

const DEFAULT_QUOTA_COOLDOWN_S = Number(process.env.AI_QUOTA_COOLDOWN_SECONDS) || 15 * 60;
const MAX_COOLDOWN_S = 6 * 60 * 60;
const LONG_COOLDOWN_S = 6 * 60 * 60;

export function markQuota(key: string, retryAfterSeconds?: number) {
  // Short Retry-After values (per-minute limits) are honoured but never below 60s.
  const s = Math.min(Math.max(retryAfterSeconds ?? DEFAULT_QUOTA_COOLDOWN_S, 60), MAX_COOLDOWN_S);
  until.set(key, { at: Date.now() + s * 1000, reason: 'quota' });
}

export function markAuthFailure(key: string) {
  until.set(key, { at: Date.now() + LONG_COOLDOWN_S * 1000, reason: 'auth' });
}

export function markMissing(key: string) {
  until.set(key, { at: Date.now() + LONG_COOLDOWN_S * 1000, reason: 'missing' });
}

export function cooldownInfo(key: string): { remainingSeconds: number; reason: CooldownReason } | null {
  const entry = until.get(key);
  if (!entry) return null;
  const remaining = Math.ceil((entry.at - Date.now()) / 1000);
  if (remaining <= 0) {
    until.delete(key);
    return null;
  }
  return { remainingSeconds: remaining, reason: entry.reason };
}

export function clearCooldown(key: string) {
  until.delete(key);
}
