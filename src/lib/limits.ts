import { waitText } from './security';

/**
 * Daily AI-message limit per user. Counts today's AI answers saved in the database,
 * so it needs no new table. The owner (ADMIN_EMAILS) is exempt.
 * DAILY_MESSAGE_LIMIT=0 turns the limit off. Default: 50 per day, resetting at midnight UTC.
 */
const BUILT_IN_LABELS = ['memory', 'github', 'render'];

export function dailyLimit(): number {
  const raw = process.env.DAILY_MESSAGE_LIMIT;
  if (raw === undefined || raw.trim() === '') return 50;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function secondsUntilReset(now = new Date()): number {
  return Math.max(1, Math.ceil((startOfUtcDay(now).getTime() + 86_400_000 - now.getTime()) / 1000));
}

export async function usageToday(db: any, userId: string, now = new Date()): Promise<number> {
  return db.message.count({
    where: {
      role: 'assistant',
      createdAt: { gte: startOfUtcDay(now) },
      provider: { notIn: BUILT_IN_LABELS },
      conversation: { userId },
    },
  });
}

export function limitReachedText(limit: number, now = new Date()): string {
  return `You have used all ${limit} AI messages for today. The limit resets at midnight UTC, in ${waitText(secondsUntilReset(now))}. Commands like /memories and /usage still work.`;
}

export async function handleUsageCommand(db: any, userId: string, input: string, isAdmin: boolean): Promise<{ text: string } | null> {
  if (!/^\/usage\s*$/i.test(input.trim().split('\n')[0].trim())) return null;
  const limit = dailyLimit();
  const used = await usageToday(db, userId);
  if (isAdmin || limit === 0) return { text: `AI messages today: ${used}. There is no daily limit on your account.` };
  const left = Math.max(0, limit - used);
  return { text: `AI messages today: ${used} of ${limit} used, ${left} left. It resets at midnight UTC, in ${waitText(secondsUntilReset())}.` };
}
