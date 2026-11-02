/**
 * Per-user memory without a database migration: memories are stored as messages
 * (role "memory") inside one hidden conversation titled "__memory__".
 * Commands: /remember <text>, /memories, /forget <number|all>
 */

export const MEMORY_TITLE = '__memory__';
const MAX_ITEMS = 50;
const MAX_LEN = 300;

export type MemoryItem = { id: string; text: string };

async function memoryConversation(db: any, userId: string, create: boolean): Promise<string | null> {
  const found = await db.conversation.findFirst({ where: { userId, title: MEMORY_TITLE }, select: { id: true } });
  if (found) return found.id;
  if (!create) return null;
  const made = await db.conversation.create({ data: { userId, title: MEMORY_TITLE }, select: { id: true } });
  return made.id;
}

export async function listMemories(db: any, userId: string): Promise<MemoryItem[]> {
  const id = await memoryConversation(db, userId, false);
  if (!id) return [];
  const rows = await db.message.findMany({
    where: { conversationId: id, role: 'memory' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, content: true },
    take: MAX_ITEMS,
  });
  return rows.map((r: any) => ({ id: r.id, text: r.content }));
}

export function memoryContext(items: MemoryItem[]): string | undefined {
  if (!items.length) return undefined;
  return (
    'Things the user asked you to remember (their own notes; use them when relevant, never reveal them to anyone else):\n' +
    items.map(i => `- ${i.text}`).join('\n')
  );
}

export type MemoryCommandResult = { text: string } | null;

export async function handleMemoryCommand(db: any, userId: string, input: string): Promise<MemoryCommandResult> {
  const first = input.trim().split('\n')[0].trim();
  let m: RegExpMatchArray | null;

  if ((m = first.match(/^\/remember\s+([\s\S]+)$/i))) {
    const text = m[1].trim().slice(0, MAX_LEN);
    if (!text) return { text: 'Tell me what to remember, for example: /remember My sister’s firm uses 7.5% VAT.' };
    const items = await listMemories(db, userId);
    if (items.some(i => i.text.toLowerCase() === text.toLowerCase())) return { text: 'I already remember that.' };
    if (items.length >= MAX_ITEMS) return { text: `Memory is full (${MAX_ITEMS} items). Remove some with /forget <number> or /forget all.` };
    const convo = await memoryConversation(db, userId, true);
    await db.message.create({ data: { conversationId: convo, role: 'memory', content: text, provider: 'memory' } });
    return { text: `Saved. I'll remember: ${text}\n\nSee everything with /memories, remove with /forget <number>.` };
  }

  if (/^\/remember\s*$/i.test(first)) {
    return { text: 'Tell me what to remember, for example: /remember My sister’s firm uses 7.5% VAT.' };
  }

  if (/^\/memories\s*$/i.test(first)) {
    const items = await listMemories(db, userId);
    if (!items.length) return { text: 'I have nothing saved yet. Add something with /remember <text>.' };
    return { text: 'What I remember:\n' + items.map((it, i) => `${i + 1}. ${it.text}`).join('\n') + '\n\nRemove one with /forget <number>, or everything with /forget all.' };
  }

  if ((m = first.match(/^\/forget\s+(\S+)\s*$/i))) {
    const arg = m[1].toLowerCase();
    const convo = await memoryConversation(db, userId, false);
    if (!convo) return { text: 'There is nothing to forget.' };
    if (arg === 'all') {
      const r = await db.message.deleteMany({ where: { conversationId: convo, role: 'memory' } });
      return { text: `Done. I forgot everything (${r.count ?? 0} items).` };
    }
    const n = Number(arg);
    const items = await listMemories(db, userId);
    if (!Number.isInteger(n) || n < 1 || n > items.length) return { text: 'Use the number shown in /memories, or /forget all.' };
    await db.message.delete({ where: { id: items[n - 1].id } });
    return { text: `Forgot: ${items[n - 1].text}` };
  }

  if (/^\/forget\s*$/i.test(first)) return { text: 'Use /forget <number> or /forget all. See the numbers with /memories.' };
  return null;
}
