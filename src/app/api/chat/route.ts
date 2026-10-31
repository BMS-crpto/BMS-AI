import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type Provider = 'openai' | 'anthropic' | 'gemini';
type ChatMessage = { role: 'user' | 'assistant'; content: string };

function available(provider: Provider): boolean {
  if (provider === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  if (provider === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(process.env.GEMINI_API_KEY);
}

function chooseProvider(requested: string): Provider {
  const order: Provider[] = requested === 'auto'
    ? ['openai', 'anthropic', 'gemini']
    : [requested as Provider];
  const selected = order.find(p => ['openai', 'anthropic', 'gemini'].includes(p) && available(p));
  if (!selected) throw new Error(requested === 'auto'
    ? 'No AI provider is configured. Add an API key in your server environment.'
    : `The selected provider (${requested}) is not configured. Add its API key in your server environment.`);
  return selected;
}

async function callOpenAI(messages: ChatMessage[]) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.BMS_DEFAULT_MODEL || 'gpt-4o-mini', messages, temperature: 0.7 }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI request failed.');
  return data.choices?.[0]?.message?.content as string;
}

async function callAnthropic(messages: ChatMessage[]) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1200,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Anthropic request failed.');
  return (data.content || []).filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('\n');
}

async function callGemini(messages: ChatMessage[]) {
  const model = 'gemini-2.0-flash';
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 1200 } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Gemini request failed.');
  return (data.candidates?.[0]?.content?.parts || []).map((part: { text?: string }) => part.text || '').join('');
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: 'Sign in to use BMS AI.' }, { status: 401 });
    const body = await request.json() as { messages?: ChatMessage[]; provider?: string; conversationId?: string };
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 40) {
      return NextResponse.json({ error: 'Send between 1 and 40 messages.' }, { status: 400 });
    }
    const messages = body.messages.filter(m =>
      (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    );
    if (messages.length !== body.messages.length || messages.some(m => m.content.length > 20000)) {
      return NextResponse.json({ error: 'One or more messages are invalid or too long.' }, { status: 400 });
    }
    let conversationId = body.conversationId;
    if (conversationId) {
      const owned = await prisma.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } });
      if (!owned) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    } else {
      const firstUserText = messages.find(m => m.role === 'user')?.content || 'New chat';
      const conversation = await prisma.conversation.create({ data: { userId, title: firstUserText.slice(0, 64) } });
      conversationId = conversation.id;
    }
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) await prisma.message.create({ data: { conversationId, role: 'user', content: lastUser.content } });
    const provider = chooseProvider(body.provider || 'auto');
    const reply = provider === 'openai' ? await callOpenAI(messages)
      : provider === 'anthropic' ? await callAnthropic(messages)
      : await callGemini(messages);
    await prisma.message.create({ data: { conversationId, role: 'assistant', content: reply, provider } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return NextResponse.json({ reply, provider, conversationId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
