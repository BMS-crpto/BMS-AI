import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type Provider = 'gemini' | 'openai' | 'anthropic';

type ThinkingMode = 'fast' | 'thinking' | 'coding' | 'research';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const GEMINI_MODEL = 'gemini-3.8-flash';

// ======================================
// PROVIDER SELECTION
// ======================================

function isAvailable(provider: Provider): boolean {
  if (provider === 'gemini') {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  if (provider === 'openai') {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function chooseProvider(requested: string): Provider {
  if (requested === 'auto') {
    // Gemini is the primary provider.
    const order: Provider[] = [
      'gemini',
      'anthropic',
      'openai',
    ];

    const selected = order.find(isAvailable);

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

  const provider = requested as Provider;

  if (!isAvailable(provider)) {
    throw new Error(
      `${provider} is not configured in Render.`
    );
  }

  return provider;
}

// ======================================
// MODE CONFIGURATION
// ======================================

function getThinkingLevel(mode: ThinkingMode) {
  switch (mode) {
    case 'fast':
      return 'low';

    case 'thinking':
      return 'high';

    case 'coding':
      return 'medium';

    case 'research':
      return 'high';

    default:
      return 'medium';
  }
}

function getSystemInstruction(mode: ThinkingMode) {
  const base = `
You are BMS AI, a capable, helpful and accurate AI assistant.

Your responsibilities:
- Answer questions clearly and accurately.
- Admit uncertainty instead of inventing facts.
- Give useful explanations and examples.
- Follow the user's instructions.
- Never fabricate sources, statistics or quotations.
- Do not reveal private internal reasoning.
`;

  const instructions: Record<ThinkingMode, string> = {
    fast: `
${base}

MODE: FAST

Prioritize speed and clarity.
Give direct answers.
Avoid unnecessary explanations.
`,

    thinking: `
${base}

MODE: DEEP THINKING

Carefully analyze complex questions.
Check assumptions and consider alternatives.
Explain important conclusions clearly.
Give structured, detailed answers when appropriate.
`,

    coding: `
${base}

MODE: CODING

Act as a senior software engineer.

Write reliable, maintainable and secure code.
Explain which files need to be changed.
When fixing errors, identify the actual cause.
Prefer complete working solutions over incomplete snippets.
Consider performance, accessibility and security.
`,

    research: `
${base}

MODE: LIVE RESEARCH

Use Google Search to investigate questions that need current information.

Research carefully.
Compare reliable sources.
Distinguish verified information from estimates.
Include dates when discussing changing information.
Never pretend to have searched if no search was performed.
Present findings in a clear, structured format.
`,

  };

  return instructions[mode];
}

// ======================================
// GEMINI RESPONSE EXTRACTION
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

  const input = messages.map(message => ({
    role: message.role === 'user' ? 'user' : 'model',
    content: [
      {
        type: 'text',
        text: message.content,
      },
    ],
  }));

  const requestBody: Record<string, any> = {
    model: GEMINI_MODEL,
    input,
    system_instruction: getSystemInstruction(mode),
    generation_config: {
      thinking_level: getThinkingLevel(mode),
      max_output_tokens: 4000,
    },
    store: false,
  };

  // Enable real Google Search in Research mode.
  if (mode === 'research') {
    requestBody.tools = [
      {
        type: 'google_search',
        search_types: ['web_search'],
      },
    ];
  }

  console.log(
    `BMS AI: Gemini ${GEMINI_MODEL}, mode=${mode}`
  );

  let response: Response;

  try {
    response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(55000),
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'TimeoutError'
    ) {
      throw new Error(
        'Gemini took too long to respond. Please try again.'
      );
    }

    throw new Error(
      'Could not connect to Gemini. Check your server connection.'
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `Gemini API returned HTTP ${response.status}.`;

    console.error('Gemini API error:', message);

    if (response.status === 429) {
      throw new Error(
        'Gemini usage limit reached or the service is busy. Please try again later.'
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Gemini API authentication failed. Check the API key in Render.'
      );
    }

    if (response.status === 404) {
      throw new Error(
        `Gemini model or endpoint not found: ${message}`
      );
    }

    throw new Error(message);
  }

  const reply = extractGeminiText(data);

  if (!reply.trim()) {
    throw new Error(
      'Gemini completed the request but returned no text.'
    );
  }

  console.log('BMS AI Gemini response successful.');

  return reply;
}

// ======================================
// OPENAI BACKUP
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
            content: getSystemInstruction(mode),
          },
          ...messages,
        ],
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  const data = await response.json().catch(() => ({}));

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
// ANTHROPIC BACKUP
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
        system: getSystemInstruction(mode),
        messages,
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message || 'Anthropic request failed.'
    );
  }

  const reply = (data.content || [])
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text || '')
    .join('\n');

  if (!reply.trim()) {
    throw new Error('Anthropic returned an empty response.');
  }

  return reply;
}

// ======================================
// MAIN CHAT API
// ======================================

export async function POST(request: NextRequest) {
  try {
    // Authentication
    const userId = await getSessionUserId();

    if (!userId) {
      return NextResponse.json(
        { error: 'Sign in to use BMS AI.' },
        { status: 401 }
      );
    }

    // Request body
    const body = await request.json();

    const messages = body.messages as ChatMessage[];

    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > 40
    ) {
      return NextResponse.json(
        { error: 'Send between 1 and 40 messages.' },
        { status: 400 }
      );
    }

    // Message validation
    for (const message of messages) {
      if (
        !message ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' ||
        message.content.length > 20000
      ) {
        return NextResponse.json(
          { error: 'Invalid message content.' },
          { status: 400 }
        );
      }
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

    // Thinking mode validation
    const allowedModes: ThinkingMode[] = [
      'fast',
      'thinking',
      'coding',
      'research',
    ];

    const mode: ThinkingMode =
      allowedModes.includes(body.thinkingMode)
        ? body.thinkingMode
        : 'thinking';

    // Provider selection
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

    // Conversation management
    let conversationId: string;

    if (body.conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: body.conversationId,
          userId,
        },
        select: {
          id: true,
        },
      });

      if (!conversation) {
        return NextResponse.json(
          { error: 'Conversation not found.' },
          { status: 404 }
        );
      }

      conversationId = conversation.id;

    } else {
      const conversation = await prisma.conversation.create({
        data: {
          userId,
          title: lastUser.content.slice(0, 64) || 'New chat',
        },
      });

      conversationId = conversation.id;
    }

    // Generate response
    let reply: string;

    if (provider === 'gemini') {
      reply = await callGemini(messages, mode);
    } else if (provider === 'openai') {
      reply = await callOpenAI(messages, mode);
    } else {
      reply = await callAnthropic(messages, mode);
    }

    // Save successful exchange
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
      message.toLowerCase().includes('limit') ||
      message.toLowerCase().includes('busy') ||
      message.toLowerCase().includes('too long') ||
      message.toLowerCase().includes('timed out')
        ? 503
        : 500;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
            }
