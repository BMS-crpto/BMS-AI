import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type Provider = 'openai' | 'anthropic' | 'gemini';
type ThinkingMode = 'fast' | 'thinking' | 'coding' | 'research';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ======================================
// PROVIDER AVAILABILITY
// ======================================

function available(provider: Provider): boolean {
  if (provider === 'gemini') {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  if (provider === 'anthropic') {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  return Boolean(process.env.OPENAI_API_KEY);
}

// ======================================
// PROVIDER SELECTION
// ======================================

function chooseProvider(requested: string): Provider {
  if (requested === 'auto' || !requested) {
    // Gemini first because OpenAI has no credits.
    const order: Provider[] = [
      'gemini',
      'anthropic',
      'openai',
    ];

    const selected = order.find(available);

    if (!selected) {
      throw new Error(
        'No AI provider is configured. Check your Render environment variables.'
      );
    }

    return selected;
  }

  if (
    !['gemini', 'openai', 'anthropic'].includes(requested)
  ) {
    throw new Error('Invalid AI provider selected.');
  }

  const selected = requested as Provider;

  if (!available(selected)) {
    throw new Error(
      `${selected} is not configured in Render.`
    );
  }

  return selected;
}

// ======================================
// THINKING MODE INSTRUCTIONS
// ======================================

function getModeInstructions(mode: ThinkingMode): string {
  switch (mode) {
    case 'fast':
      return `
You are BMS AI in Fast mode.
Answer quickly, clearly and accurately.
Keep simple answers concise.
`;

    case 'thinking':
      return `
You are BMS AI in Deep Thinking mode.
Carefully analyze difficult questions.
Consider relevant alternatives and check your reasoning.
Give accurate, structured and detailed answers.
Do not reveal private internal reasoning.
`;

    case 'coding':
      return `
You are BMS AI in Coding mode.
Act as an expert software developer.
Write clean, working and secure code.
Explain where files belong and how to run the code.
When fixing errors, identify the cause and provide a complete correction.
`;

    case 'research':
      return `
You are BMS AI in Research mode.
Provide structured, evidence-conscious research assistance.
Separate established facts from uncertainty.
Mention when information may be outdated.
Do not invent sources, citations or live web searches.
`;

    default:
      return `
You are BMS AI, a helpful and intelligent assistant.
`;
  }
}

// ======================================
// EXTRACT GEMINI RESPONSE
// ======================================

function extractGeminiText(data: any): string {
  if (
    typeof data.output_text === 'string' &&
    data.output_text.trim()
  ) {
    return data.output_text;
  }

  const steps = Array.isArray(data.steps)
    ? data.steps
    : [];

  return steps
    .filter((step: any) => step.type === 'model_output')
    .flatMap((step: any) =>
      Array.isArray(step.content) ? step.content : []
    )
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text || '')
    .join('\n');
}

// ======================================
// GEMINI AI
// ======================================

async function callGemini(
  messages: ChatMessage[],
  mode: ThinkingMode
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing in Render.');
  }

  const models = [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-2.5-flash',
  ];

  const conversation = messages
    .map(message => {
      const speaker =
        message.role === 'user'
          ? 'User'
          : 'Assistant';

      return `${speaker}: ${message.content}`;
    })
    .join('\n\n');

  const thinkingLevel =
    mode === 'fast'
      ? 'low'
      : mode === 'thinking'
        ? 'high'
        : 'medium';

  let lastError = 'Gemini could not generate a response.';

  for (const model of models) {
    try {
      console.log(`BMS AI trying Gemini: ${model}`);

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
            system_instruction: getModeInstructions(mode),
            generation_config: {
              thinking_level: thinkingLevel,
              max_output_tokens: 3000,
            },
            store: false,
          }),
          signal: AbortSignal.timeout(25000),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const message =
          data.error?.message ||
          `Gemini returned HTTP ${response.status}.`;

        lastError = message;

        console.error(
          `Gemini ${model} error:`,
          message
        );

        if (
          [404, 429, 500, 502, 503, 504].includes(
            response.status
          )
        ) {
          continue;
        }

        throw new Error(message);
      }

      const reply = extractGeminiText(data);

      if (!reply.trim()) {
        lastError = `${model} returned an empty response.`;
        continue;
      }

      console.log(`BMS AI successfully used ${model}.`);

      return reply;

    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown Gemini error.';

      lastError = message;

      console.error(
        `Gemini ${model} failed:`,
        message
      );

      if (
        error instanceof Error &&
        error.name === 'TimeoutError'
      ) {
        lastError = `${model} timed out. Trying another model.`;
        continue;
      }

      if (
        error instanceof Error &&
        error.name === 'AbortError'
      ) {
        continue;
      }

      if (
        message.includes('fetch failed') ||
        message.includes('network')
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Gemini is temporarily unavailable. ${lastError}`
  );
}

// ======================================
// OPENAI
// ======================================

async function callOpenAI(
  messages: ChatMessage[],
  mode: ThinkingMode
): Promise<string> {
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
        messages: [
          {
            role: 'system',
            content: getModeInstructions(mode),
          },
          ...messages,
        ],
      }),
      signal: AbortSignal.timeout(30000),
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
// ANTHROPIC
// ======================================

async function callAnthropic(
  messages: ChatMessage[],
  mode: ThinkingMode
): Promise<string> {
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
        system: getModeInstructions(mode),
        messages,
      }),
      signal: AbortSignal.timeout(30000),
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
      (part: any) => part.type === 'text'
    )
    .map(
      (part: any) => part.text || ''
    )
    .join('\n');

  if (!reply.trim()) {
    throw new Error('Claude returned an empty response.');
  }

  return reply;
}

// ======================================
// MAIN CHAT API
// ======================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication
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
      thinkingMode?: string;
    };

    // Validate messages
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
      message &&
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

    if (!messages.some(message => message.role === 'user')) {
      return NextResponse.json(
        { error: 'A user message is required.' },
        { status: 400 }
      );
    }

    // Validate thinking mode
    const allowedModes: ThinkingMode[] = [
      'fast',
      'thinking',
      'coding',
      'research',
    ];

    const mode = allowedModes.includes(
      body.thinkingMode as ThinkingMode
    )
      ? body.thinkingMode as ThinkingMode
      : 'thinking';

    // Select provider
    let provider: Provider;

    try {
      provider = chooseProvider(body.provider || 'auto');
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error
            ? error.message
            : 'AI provider unavailable.',
        },
        { status: 503 }
      );
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

    // Find or create conversation
    let conversationId: string;

    if (body.conversationId) {
      const owned = await prisma.conversation.findFirst({
        where: {
          id: body.conversationId,
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

      conversationId = owned.id;

    } else {
      const conversation = await prisma.conversation.create({
        data: {
          userId,
          title: lastUser.content.slice(0, 64) || 'New chat',
        },
      });

      conversationId = conversation.id;
    }

    // Generate AI response
    let reply: string;

    if (provider === 'gemini') {
      reply = await callGemini(messages, mode);
    } else if (provider === 'openai') {
      reply = await callOpenAI(messages, mode);
    } else {
      reply = await callAnthropic(messages, mode);
    }

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

    return NextResponse.json({
      reply,
      provider,
      conversationId,
      thinkingMode: mode,
    });

  } catch (error) {
    console.error('BMS AI chat error:', error);

    const message =
      error instanceof Error
        ? error.message
        : 'Unexpected server error.';

    const status =
      message.toLowerCase().includes('temporarily unavailable') ||
      message.toLowerCase().includes('timed out')
        ? 503
        : 500;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
      }
