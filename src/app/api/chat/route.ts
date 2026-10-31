import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type Provider = 'openai' | 'anthropic' | 'gemini';
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function available(provider: Provider): boolean {
  if (provider === 'openai') {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  if (provider === 'anthropic') {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  return Boolean(process.env.GEMINI_API_KEY);
}

function chooseProvider(requested: string): Provider {
  const validProviders: Provider[] = [
    'openai',
    'anthropic',
    'gemini',
  ];

  if (requested === 'auto') {
    const selected = validProviders.find(available);

    if (selected) return selected;

    throw new Error(
      'No AI provider is configured. Add an API key in Render.'
    );
  }

  if (!validProviders.includes(requested as Provider)) {
    throw new Error('Invalid AI provider selected.');
  }

  const selected = requested as Provider;

  if (!available(selected)) {
    throw new Error(
      `The selected provider (${selected}) is not configured. Add its API key in Render.`
    );
  }

  return selected;
}

async function callOpenAI(messages: ChatMessage[]) {
  const response = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.BMS_DEFAULT_MODEL || 'gpt-4o-mini',
        messages,
        temperature: 0.7,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || 'OpenAI request failed.'
    );
  }

  const reply = data.choices?.[0]?.message?.content;

  if (typeof reply !== 'string' || !reply.trim()) {
    throw new Error('OpenAI returned an empty response.');
  }

  return reply;
}

async function callAnthropic(messages: ChatMessage[]) {
  const response = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 1200,
        messages: messages.map(message => ({
          role: message.role,
          content: message.content,
        })),
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || 'Anthropic request failed.'
    );
  }

  const reply = (data.content || [])
    .filter((part: { type: string }) => part.type === 'text')
    .map((part: { text: string }) => part.text)
    .join('\n');

  if (!reply.trim()) {
    throw new Error('Anthropic returned an empty response.');
  }

  return reply;
}

async function callGemini(messages: ChatMessage[]) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing in Render.');
  }

  const model =
    process.env.BMS_GEMINI_MODEL || 'gemini-3.8-flash';

  // Preserve the complete conversation history.
  const conversation = messages
    .map(message => {
      const speaker =
        message.role === 'user' ? 'User' : 'Assistant';

      return `${speaker}: ${message.content}`;
    })
    .join('\n\n');

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input:
          conversation +
          '\n\nAssistant:',
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || 'Gemini request failed.'
    );
  }

  const reply = (data.steps || [])
    .filter(
      (step: { type: string }) =>
        step.type === 'model_output'
    )
    .flatMap(
      (step: { content?: Array<{ type: string; text?: string }> }) =>
        step.content || []
    )
    .filter(
      (part: { type: string }) => part.type === 'text'
    )
    .map(
      (part: { text?: string }) => part.text || ''
    )
    .join('');

  if (!reply.trim()) {
    throw new Error(
      'Gemini returned an empty response. Please try again.'
    );
  }

  return reply;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId();

    if (!userId) {
      return NextResponse.json(
        { error: 'Sign in to use BMS AI.' },
        { status: 401 }
      );
    }

    const body = await request.json() as {
      messages?: ChatMessage[];
      provider?: string;
      conversationId?: string;
    };

    if (
      !Array.isArray(body.messages) ||
      body.messages.length === 0 ||
      body.messages.length > 40
    ) {
      return NextResponse.json(
        { error: 'Send between 1 and 40 messages.' },
        { status: 400 }
      );
    }

    const messages = body.messages.filter(message =>
      (message.role === 'user' ||
        message.role === 'assistant') &&
      typeof message.content === 'string'
    );

    if (
      messages.length !== body.messages.length ||
      messages.some(message =>
        message.content.length > 20000
      )
    ) {
      return NextResponse.json(
        { error: 'One or more messages are invalid or too long.' },
        { status: 400 }
      );
    }

    // Select and validate the provider before saving messages.
    let provider: Provider;

    try {
      provider = chooseProvider(body.provider || 'auto');
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'AI provider unavailable.',
        },
        { status: 503 }
      );
    }

    let conversationId = body.conversationId;

    if (conversationId) {
      const owned = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          userId,
        },
        select: {
          id: true,
        },
      });

      if (!owned) {
        return NextResponse.json(
          { error: 'Conversation not found.' },
          { status: 404 }
        );
      }
    } else {
      const firstUserText =
        messages.find(message =>
          message.role === 'user'
        )?.content || 'New chat';

      const conversation = await prisma.conversation.create({
        data: {
          userId,
          title: firstUserText.slice(0, 64),
        },
      });

      conversationId = conversation.id;
    }

    const lastUser = [...messages]
      .reverse()
      .find(message => message.role === 'user');

    if (!lastUser) {
      return NextResponse.json(
        { error: 'A user message is required.' },
        { status: 400 }
      );
    }

    await prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content: lastUser.content,
      },
    });

    const reply =
      provider === 'openai'
        ? await callOpenAI(messages)
        : provider === 'anthropic'
          ? await callAnthropic(messages)
          : await callGemini(messages);

    await prisma.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: reply,
        provider,
      },
    });

    await prisma.conversation.update({
      where: {
        id: conversationId,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      reply,
      provider,
      conversationId,
    });

  } catch (error) {
    console.error('BMS AI chat error:', error);

    const message =
      error instanceof Error
        ? error.message
        : 'Unexpected server error.';

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
