import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { MEMORY_TITLE } from '@/lib/memory';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const conversations = await prisma.conversation.findMany({
    // The hidden memory store must never show up as a chat.
    where: { userId, NOT: { title: MEMORY_TITLE } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true },
    take: 50,
  });
  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  let title = typeof body.title === 'string' ? body.title.slice(0, 80) : 'New chat';
  if (title === MEMORY_TITLE) title = 'New chat';
  const conversation = await prisma.conversation.create({ data: { userId, title } });
  return NextResponse.json({ conversation }, { status: 201 });
}
