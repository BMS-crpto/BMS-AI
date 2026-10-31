import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type Provider = 'openai' | 'anthropic' | 'gemini';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ======================================
// PROVIDER AVAILABILITY
// ======================================

function available(provider: Provider): boolean {
  if (provider === 'openai') {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  if (provider === 'anthropic') {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  return Boolean(process.env.GEMINI_API_KEY);
}

// ======================================
// SELECT AI PROVIDER
// ======================================

function chooseProvider(requested: string): Provider {
  const providers: Provider[] = [
    'openai',
    'anthropic',
    'gemini',
  ];

  if (requested === 'auto') {
    const selected = providers.find(available);

    if (selected) return selected;

    throw new Error(
      'No AI provider is configured. Add an API key in Render.'
    );
  }

  if (!providers.includes(requested as Provider)) {
    throw new Error('Invalid AI provider selected.');
  }

  const selected = requested as Provider;

  if (!available(selected)) {
    throw new Error(
      `${selected} is not configured. Add its API key in Render.`
    );
  }

  return selected;
}

// ======================================
// OPENAI
// ======================================

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

// ======================================
// CLAUDE / ANTHROPIC
// ======================================

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
        model:
          process.env.ANTHROPIC_MODEL ||
          'claude-3-5-haiku-latest',
        max_tokens: 2000,
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
      data.error?.message || 'Claude request failed.'
    );
  }

  const reply = (data.content || [])
    .filter(
      (part: { type: string }) => part.type === 'text'
    )
    .map(
      (part: { text: string }) => part.text
    )
    .join('\n');

  if (!reply.trim()) {
    throw new Error('Claude returned an empty response.');
  }

  return reply;
}

// ======================================
// GEMINI RESPONSE EXTRACTION
// ======================================

function extractGeminiText(data: any): string {
  if (typeof data.output_text === 'string') {
    return data.output_text;
  }

  const steps = Array.isArray(data.steps) ? data.steps : [];

  return steps
    .filter((step: any) => step.type === 'model_output')
    .flatMap((step: any) =>
      Array.isArray(step.content) ? step.content : []
    )
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text || '')
    .join('');
}

// ======================================
// GEMINI WITH AUTOMATIC BACKUP MODELS
// ======================================

async function callGemini(messages: ChatMessage[]) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing in Render.');
  }

  const models = [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
  ];

  const conversation = messages
    .map(message => {
      const speaker =
        message.role === 'user' ? 'User' : 'Assistant';

      return `${speaker}: ${message.content}`;
    })
    .join('\n\n');

  let lastError = 'All Gemini models are unavailable.';

  for (const model of models) {
    try {
      console.log(`BMS AI trying Gemini model: ${model}`);

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
            input: conversation,
          }),
          signal: AbortSignal.timeout(90000),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const message =
          data.error?.message || 'Gemini request failed.';

        lastError = message;

        if (
          [404, 429, 500, 502, 503, 504].includes(response.status)
        ) {
          console.warn(
            `Gemini ${model} unavailable. Trying backup model.`
          );

          continue;
        }

        throw new Error(message);
      }

      const reply = extractGeminiText(data);

      if (reply.trim()) {
        console.log(`BMS AI successfully used ${model}.`);
        return reply;
      }

      lastError = `${model} returned an empty response.`;

    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError'
      ) {
        lastError = `${model} timed out.`;
        continue;
      }

      if (
        error instanceof Error &&
        !error.message.includes('fetch')
      ) {
        throw error;
      }

      lastError =
        error instanceof Error
          ? error.message
          : 'Gemini connection failed.';
    }
  }

  throw new Error(
    `All Gemini backup models failed. ${lastError}`
  );
}

// ======================================
// MAIN CHAT API
// ======================================

export async function POST(request: NextRequest) {
  try {
    // Check login
    const userId = await getSessionUserId();

    if (!userId) {
      return NextResponse.json(
        { error: 'Sign in to use BMS AI.' },
        { status: 401 }
      );
    }

    // Read request
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

    // Validate messages
    const messages = body.messages.filter(message =>
      message &&
      (message.role === 'user' ||
        message.role === 'assistant') &&
      typeof message.content === 'string'
    );

    if (
      messages.length !== body.messages.length ||
      messages.some(message => message.content.length > 20000)
    ) {
      return NextResponse.json(
        { error: 'One or more messages are invalid or too long.' },
        { status: 400 }
      );
    }

    if (!messages.some(message => message.role === 'user')) {
      return NextResponse.json(
        { error: 'A user message is required.' },
        { status: 400 }
      );
    }

    // Select provider
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

    // Find or create conversation
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

    // Get latest user message
    const lastUser = [...messages]
      .reverse()
      .find(message => message.role === 'user');

    if (!lastUser) {
      return NextResponse.json(
        { error: 'A user message is required.' },
        { status: 400 }
      );
    }

    // Call AI
    const reply =
      provider === 'openai'
        ? await callOpenAI(messages)
        : provider === 'anthropic'
          ? await callAnthropic(messages)
          : await callGemini(messages);

    // Save successful messages
    await prisma.message.createMany({
      data: [
        {
          conversationId,
          role: 'user',
          content: lastUser.content,
        },
        {
          conversationId,
          role: 'assistant',
          content: reply,
          provider,
        },
      ],
    });

    // Update conversation
    await prisma.conversation.update({
      where: {
        id: conversationId,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    // Return response
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
