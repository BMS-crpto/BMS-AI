import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, content: true, provider: true, createdAt: true } } },
  });
  if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  return NextResponse.json({ conversation });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const result = await prisma.conversation.deleteMany({ where: { id, userId } });
  if (!result.count) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
