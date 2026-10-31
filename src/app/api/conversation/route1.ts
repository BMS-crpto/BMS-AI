import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const conversations = await prisma.conversation.findMany({
    where: { userId }, orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true },
    take: 50,
  });
  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title.slice(0, 80) : 'New chat';
  const conversation = await prisma.conversation.create({ data: { userId, title } });
  return NextResponse.json({ conversation }, { status: 201 });
}
