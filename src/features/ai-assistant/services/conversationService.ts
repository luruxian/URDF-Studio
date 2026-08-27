import OpenAI from 'openai';
import { translations, type Language } from '@/shared/i18n';
import { isAiBackendAuthError } from './aiBackendTransport';
import { isRobotsAiConversationReady } from './robotsConversationBackend';
import {
  isRobotsConversationAuthError,
  streamRobotsConversationCompletions,
} from './robotsConversationCompletions';

// Provider-agnostic tool-calling types. ConversationToolDefinition mirrors the
// OpenAI ChatCompletionTool shape so it can be passed through without a cast,
// while staying SDK-agnostic at this module boundary.
export interface ConversationToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ConversationToolCall {
  function: { name: string; arguments: string };
}

export interface ConversationHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SendConversationTurnInput {
  sessionId: string;
  lang?: Language;
  userMessage: string;
}

export interface SendConversationTurnStreamInput extends SendConversationTurnInput {
  signal?: AbortSignal;
  onReplyDelta?: (delta: string) => void;
  // Optional tool calling. When tools is omitted, behavior is unchanged.
  tools?: ConversationToolDefinition[];
  onToolCalls?: (toolCalls: ConversationToolCall[]) => void;
}

export type ConversationTurnErrorCode =
  | 'empty_user_message'
  | 'robots_handoff_required'
  | 'missing_api_key'
  | 'login_required'
  | 'empty_response'
  | 'request_failed';

export interface ConversationTurnError {
  code: ConversationTurnErrorCode;
  message: string;
}

export interface ConversationTurnResult {
  reply: string;
  error: ConversationTurnError | null;
}

export interface ConversationTurnStreamResult extends ConversationTurnResult {
  status: 'completed' | 'aborted' | 'error';
}

interface ConversationStreamChunkLike {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string | null;
        function?: {
          name?: string | null;
          arguments?: string | null;
        } | null;
      }>;
    };
    finish_reason?: string | null;
  }>;
}

const MAX_HISTORY_TURNS = 8;

const getConversationTexts = (lang: Language) => {
  const t = translations[lang];
  return {
    robotsHandoffRequired: t.aiConversationRobotsHandoffRequired,
    loginRequired: t.aiLoginRequired,
    emptyResponse: t.aiServiceReturnedEmptyContent,
    unknownError: t.unknownError,
    requestFailed: (message?: string) =>
      t.aiServiceCouldNotProcessRequest.replace(
        '{message}',
        message || t.unknownError.toLowerCase(),
      ),
  };
};

const sanitizeHistoryTurn = (turn: ConversationHistoryTurn): ConversationHistoryTurn | null => {
  if (!turn.content) return null;
  const content = turn.content.trim();
  if (!content) return null;
  if (turn.role !== 'user' && turn.role !== 'assistant') return null;
  return {
    role: turn.role,
    content,
  };
};

export const buildConversationMessages = (
  history: ConversationHistoryTurn[] | undefined,
  userMessage: string,
): Array<{ role: 'user' | 'assistant'; content: string }> => {
  const normalizedHistory = (history || [])
    .map(sanitizeHistoryTurn)
    .filter((turn): turn is ConversationHistoryTurn => Boolean(turn))
    .slice(-MAX_HISTORY_TURNS);

  const normalizedUserMessage = userMessage.trim();
  const messages = normalizedHistory.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  messages.push({
    role: 'user',
    content: normalizedUserMessage,
  });

  return messages;
};

export const serializeConversationHistory = (
  history: ConversationHistoryTurn[] | undefined,
): string => {
  const normalizedHistory = (history || [])
    .map(sanitizeHistoryTurn)
    .filter((turn): turn is ConversationHistoryTurn => Boolean(turn))
    .slice(-MAX_HISTORY_TURNS);

  return JSON.stringify(normalizedHistory);
};

const buildConversationError = (
  code: ConversationTurnErrorCode,
  message: string,
): ConversationTurnError => ({
  code,
  message,
});

export const isConversationAbortError = (error: unknown): boolean => {
  return (
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof Error && error.name === 'AbortError')
  );
};

export const extractConversationDelta = (
  chunk: ConversationStreamChunkLike | null | undefined,
): string => {
  if (!chunk?.choices?.length) {
    return '';
  }

  return chunk.choices.map((choice) => choice.delta?.content ?? '').join('');
};

/**
 * Accumulate streaming tool_calls from a chunk into a map keyed by index.
 * OpenAI streams tool_calls across multiple chunks:
 *  - first chunk: { index, id, type, function: { name } }
 *  - subsequent chunks: { index, function: { arguments: "..." } }
 */
export const accumulateToolCallDeltas = (
  acc: Map<number, { id?: string; name?: string; arguments: string }>,
  chunk: ConversationStreamChunkLike | null | undefined,
): void => {
  if (!chunk?.choices?.length) {
    return;
  }
  for (const choice of chunk.choices) {
    const toolCalls = choice.delta?.tool_calls;
    if (!toolCalls) {
      continue;
    }
    for (const tc of toolCalls) {
      const existing = acc.get(tc.index) ?? { arguments: '' };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name = tc.function.name;
      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
      acc.set(tc.index, existing);
    }
  }
};

export const sendConversationTurnStream = async (
  input: SendConversationTurnStreamInput,
): Promise<ConversationTurnStreamResult> => {
  if (testConversationTurnStreamOverride) {
    return testConversationTurnStreamOverride(input);
  }

  return sendConversationTurnStreamImpl(input);
};

let testConversationTurnStreamOverride:
  | ((input: SendConversationTurnStreamInput) => Promise<ConversationTurnStreamResult>)
  | null = null;

/** Test-only override for conversation transport (tool UI tests). */
export function __setConversationTurnStreamForTests(
  override:
    | ((input: SendConversationTurnStreamInput) => Promise<ConversationTurnStreamResult>)
    | null,
): void {
  testConversationTurnStreamOverride = override;
}

const sendConversationTurnStreamImpl = async ({
  sessionId,
  lang = 'en',
  userMessage,
  signal,
  onReplyDelta,
  tools,
  onToolCalls,
}: SendConversationTurnStreamInput): Promise<ConversationTurnStreamResult> => {
  const text = getConversationTexts(lang);
  const trimmedMessage = userMessage.trim();

  if (!trimmedMessage) {
    return {
      reply: '',
      error: buildConversationError('empty_user_message', text.emptyResponse),
      status: 'error',
    };
  }

  if (!sessionId.trim()) {
    return {
      reply: '',
      error: buildConversationError('request_failed', text.requestFailed()),
      status: 'error',
    };
  }

  if (!isRobotsAiConversationReady()) {
    return {
      reply: '',
      error: buildConversationError('robots_handoff_required', text.robotsHandoffRequired),
      status: 'error',
    };
  }

  try {
    const result = await streamRobotsConversationCompletions({
      sessionId: sessionId.trim(),
      userMessage: trimmedMessage,
      signal,
      onReplyDelta,
      tools,
      onToolCalls,
    });

    const normalizedReply = result.reply.trim();
    if (result.status === 'aborted') {
      return { reply: normalizedReply, error: null, status: 'aborted' };
    }
    if (!normalizedReply && result.toolCalls.length === 0) {
      return {
        reply: '',
        error: buildConversationError('empty_response', text.emptyResponse),
        status: 'error',
      };
    }
    return { reply: normalizedReply, error: null, status: 'completed' };
  } catch (error) {
    if (isConversationAbortError(error) || signal?.aborted) {
      return { reply: '', error: null, status: 'aborted' };
    }
    if (isAiBackendAuthError(error) || isRobotsConversationAuthError(error)) {
      return {
        reply: '',
        error: buildConversationError('login_required', text.loginRequired),
        status: 'error',
      };
    }
    const e = error as { message?: string };
    console.error('Conversation request failed', error);
    return {
      reply: '',
      error: buildConversationError('request_failed', text.requestFailed(e?.message)),
      status: 'error',
    };
  }
};

export const sendConversationTurn = async (
  input: SendConversationTurnInput,
): Promise<ConversationTurnResult> => {
  const result = await sendConversationTurnStream(input);
  return {
    reply: result.reply,
    error: result.error,
  };
};
