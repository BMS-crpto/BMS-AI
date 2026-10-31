async function callGemini(messages: ChatMessage[]) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing in Render.');
  }

  const models = [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
  ];

  const conversation = messages
    .map(message => {
      const speaker =
        message.role === 'user' ? 'User' : 'Assistant';

      return `${speaker}: ${message.content}`;
    })
    .join('\n\n');

  let lastError = 'All Gemini models are temporarily unavailable.';

  for (const model of models) {
    try {
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
            input: conversation + '\n\nAssistant:',
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const errorMessage =
          data.error?.message || 'Gemini request failed.';

        // Only switch models for temporary service problems.
        if (
          [429, 500, 502, 503, 504].includes(response.status)
        ) {
          lastError = errorMessage;
          console.warn(`Gemini ${model} unavailable. Trying backup.`);
          continue;
        }

        throw new Error(errorMessage);
      }

      const reply = (data.steps || [])
        .filter(
          (step: { type: string }) =>
            step.type === 'model_output'
        )
        .flatMap(
          (step: {
            content?: Array<{
              type: string;
              text?: string;
            }>;
          }) => step.content || []
        )
        .filter(
          (part: { type: string }) =>
            part.type === 'text'
        )
        .map(
          (part: { text?: string }) =>
            part.text || ''
        )
        .join('');

      if (reply.trim()) {
        console.log(`BMS AI successfully used ${model}.`);
        return reply;
      }

      lastError = `${model} returned an empty response.`;

    } catch (error) {
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
    `All Gemini backup models failed. Last error: ${lastError}`
  );
        }
