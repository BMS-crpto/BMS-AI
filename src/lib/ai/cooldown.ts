import type { ProviderId } from './types';

/**
 * In-memory circuit breaker (per server process).
 * - quota error  -> provider is skipped until cooldown expires (no repeated calls)
 * - auth error   -> provider is skipped for a long time (bad key needs a redeploy)
 * On Render's single instance this is sufficient. With several instances each
 * instance learns independently, which only costs one extra call per instance.
 */
const until = new Map<ProviderId, { at: number; reason: 'quota' | 'auth' }>();

const DEFAULT_QUOTA_COOLDOWN_S = Number(process.env.AI_QUOTA_COOLDOWN_SECONDS) || 15 * 60;
const MAX_COOLDOWN_S = 6 * 60 * 60;
const AUTH_COOLDOWN_S = 6 * 60 * 60;

export function markQuota(provider: ProviderId, retryAfterSeconds?: number) {
  // Short Retry-After values (per-minute limits) are honoured but never below 60s.
  const s = Math.min(Math.max(retryAfterSeconds ?? DEFAULT_QUOTA_COOLDOWN_S, 60), MAX_COOLDOWN_S);
  // If Google gave a tiny Retry-After we still use the default for daily-quota style messages.
  until.set(provider, { at: Date.now() + s * 1000, reason: 'quota' });
}

export function markAuthFailure(provider: ProviderId) {
  until.set(provider, { at: Date.now() + AUTH_COOLDOWN_S * 1000, reason: 'auth' });
}

export function cooldownInfo(provider: ProviderId): { remainingSeconds: number; reason: 'quota' | 'auth' } | null {
  const entry = until.get(provider);
  if (!entry) return null;
  const remaining = Math.ceil((entry.at - Date.now()) / 1000);
  if (remaining <= 0) {
    until.delete(provider);
    return null;
  }
  return { remainingSeconds: remaining, reason: entry.reason };
}

export function clearCooldown(provider: ProviderId) {
  until.delete(provider);
}
