import { timingSafeEqual } from 'node:crypto';

/* ----------------------------- Invite code ----------------------------- */

/** When INVITE_CODE is set in the server settings, sign-ups need it. */
export function inviteRequired(): boolean {
  return Boolean(process.env.INVITE_CODE?.trim());
}

export function inviteOk(provided: unknown): boolean {
  const expected = process.env.INVITE_CODE?.trim();
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------ Rate limiter ----------------------------- */

// In-memory sliding window (per server process). Enough for one Render instance.
const hits = new Map<string, number[]>();
let lastSweep = 0;

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now()
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, list] of hits) {
      if (!list.length || now - list[list.length - 1] > 3_600_000) hits.delete(k);
    }
  }
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true };
}

export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim() || 'unknown';
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export function waitText(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 5400) return `about ${Math.ceil(seconds / 60)} minutes`;
  return `about ${Math.ceil(seconds / 3600)} hours`;
}
