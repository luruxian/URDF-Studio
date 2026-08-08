interface OpenAiExtraBodySource {
  [key: string]: string | undefined;
  VITE_OPENAI_EXTRA_BODY?: string;
  OPENAI_EXTRA_BODY?: string;
}

const MINIMAX_MODEL_PATTERN = /minimax/i;

/** Remove MiniMax / reasoning blocks that may still appear inside `content`. */
export function stripModelThinkingContent(content: string, options?: { trim?: boolean }): string {
  let result = content
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, '')
    // Hide in-progress thinking blocks while the model is still streaming.
    .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<\|begin_of_thought\|>[\s\S]*$/gi, '');

  return options?.trim === false ? result : result.trim();
}

function parseConfiguredExtraBody(rawValue: string | undefined): Record<string, unknown> | undefined {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function resolveDefaultMiniMaxExtraBody(model: string): Record<string, unknown> | undefined {
  if (!MINIMAX_MODEL_PATTERN.test(model)) {
    return undefined;
  }

  return {
    thinking: { type: 'disabled' },
    reasoning_split: true,
  };
}

function readDefaultExtraBodyEnv(): OpenAiExtraBodySource {
  const viteEnv = ((import.meta as ImportMeta & { env?: OpenAiExtraBodySource }).env ??
    {}) as OpenAiExtraBodySource;
  const processEnv = (typeof process !== 'undefined' ? process.env : {}) as OpenAiExtraBodySource;

  return {
    VITE_OPENAI_EXTRA_BODY: viteEnv.VITE_OPENAI_EXTRA_BODY ?? processEnv.VITE_OPENAI_EXTRA_BODY,
    OPENAI_EXTRA_BODY: processEnv.OPENAI_EXTRA_BODY,
  };
}

/** Provider-specific OpenAI SDK `extra_body` options (e.g. disable MiniMax thinking). */
export function resolveOpenAiChatExtraBody(
  model: string,
  env: OpenAiExtraBodySource = readDefaultExtraBodyEnv(),
): Record<string, unknown> | undefined {
  const configured = parseConfiguredExtraBody(
    env.VITE_OPENAI_EXTRA_BODY?.trim() || env.OPENAI_EXTRA_BODY?.trim(),
  );
  if (configured) {
    return configured;
  }

  return resolveDefaultMiniMaxExtraBody(model);
}
