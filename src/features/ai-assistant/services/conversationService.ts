import OpenAI from 'openai';
import { translations, type Language } from '@/shared/i18n';
import { getConversationSystemPrompt, type ConversationMode } from '../config/prompts';
import {
  isAiBackendAuthError,
  isAiBackendEnabled,
  streamAiBackendChat,
} from './aiBackendTransport';
import { resolveAiRuntimeEnv, resolveOpenAiClientBaseUrl } from './aiRuntimeEnv';
import {
  resolveOpenAiChatExtraBody,
  stripModelThinkingContent,
} from './openAiRequestOptions';

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
  mode: ConversationMode;
  lang?: Language;
  context: string;
  history?: ConversationHistoryTurn[];
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

const getApiKey = (): string => {
  return resolveAiRuntimeEnv().apiKey;
};

const getBaseUrl = (): string => {
  return resolveAiRuntimeEnv().baseUrl;
};

const createOpenAIClient = (apiKey: string): OpenAI => {
  return new OpenAI({
    apiKey,
    baseURL: resolveOpenAiClientBaseUrl(getBaseUrl()),
    dangerouslyAllowBrowser: true,
  });
};

const getModelName = (): string => {
  return resolveAiRuntimeEnv().model;
};

const getConversationTexts = (lang: Language) => {
  const t = translations[lang];
  return {
    missingApiKey: t.apiKeyMissing,
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

// Mutable accumulation state for one direct-to-provider streaming turn.
interface DirectStreamState {
  reply: string;
  strippedReplyLength: number;
  finishReason: string | null;
  toolCallAcc: Map<number, { id?: string; name?: string; arguments: string }>;
}

/**
 * Process one streamed chunk: capture finish_reason, accumulate tool_calls and the
 * visible reply delta. Keeping this per-chunk makes the streaming loop trivial and
 * keeps sendConversationTurnStream within its complexity budget.
 */
const processDirectStreamChunk = (
  state: DirectStreamState,
  chunk: ConversationStreamChunkLike,
  onReplyDelta?: (delta: string) => void,
): void => {
  const firstChoice = chunk.choices?.[0];
  if (firstChoice?.finish_reason) {
    state.finishReason = firstChoice.finish_reason;
  }
  accumulateToolCallDeltas(state.toolCallAcc, chunk);

  const delta = extractConversationDelta(chunk);
  if (!delta) {
    return;
  }
  state.reply += delta;
  const strippedReply = stripModelThinkingContent(state.reply, { trim: false });
  const visibleDelta = strippedReply.slice(state.strippedReplyLength);
  state.strippedReplyLength = strippedReply.length;
  if (visibleDelta) {
    onReplyDelta?.(visibleDelta);
  }
};

/**
 * Turn accumulated streaming tool_calls into ConversationToolCall[] and emit them
 * through onToolCalls when the model finished with a tool_calls reason. Returns the
 * early-complete result (empty reply — the caller drives the tool UI) or null when
 * there is nothing to surface.
 */
const resolveStreamToolCalls = (
  finishReason: string | null,
  toolCallAcc: Map<number, { id?: string; name?: string; arguments: string }>,
  onToolCalls?: (toolCalls: ConversationToolCall[]) => void,
): ConversationTurnStreamResult | null => {
  if (finishReason !== 'tool_calls' || toolCallAcc.size === 0) {
    return null;
  }

  const toolCalls = Array.from(toolCallAcc.values()).flatMap((tc) => {
    if (!tc.name) {
      return [];
    }
    return [
      {
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      },
    ];
  });

  if (toolCalls.length > 0 && onToolCalls) {
    onToolCalls(toolCalls);
    return {
      reply: '',
      error: null,
      status: 'completed',
    };
  }

  return null;
};

export const sendConversationTurnStream = async ({
  mode,
  lang = 'en',
  context,
  history = [],
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

  if (isAiBackendEnabled()) {
    try {
      const result = await streamAiBackendChat(
        {
          mode,
          lang,
          context,
          history: (history || [])
            .map(sanitizeHistoryTurn)
            .filter((turn): turn is ConversationHistoryTurn => Boolean(turn))
            .slice(-MAX_HISTORY_TURNS),
          userMessage: trimmedMessage,
        },
        { signal, onDelta: onReplyDelta },
      );

      const normalizedReply = result.reply.trim();
      if (result.status === 'aborted') {
        return { reply: normalizedReply, error: null, status: 'aborted' };
      }
      if (!normalizedReply) {
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
      if (isAiBackendAuthError(error)) {
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
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      reply: '',
      error: buildConversationError('missing_api_key', text.missingApiKey),
      status: 'error',
    };
  }

  const systemPrompt = getConversationSystemPrompt(lang, {
    mode,
    context,
    // Conversation history already goes into `messages`; keep the prompt copy empty
    // so we do not pay for the same turns twice.
    history: '',
  });

  const openai = createOpenAIClient(apiKey);
  const modelName = getModelName();
  const extraBody = resolveOpenAiChatExtraBody(modelName);
  const messages = buildConversationMessages(history, trimmedMessage);
  const requestMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
  const streamState: DirectStreamState = {
    reply: '',
    strippedReplyLength: 0,
    finishReason: null,
    toolCallAcc: new Map<number, { id?: string; name?: string; arguments: string }>(),
  };

  try {
    const stream = await openai.chat.completions.create(
      {
        model: modelName,
        messages: requestMessages,
        temperature: 0.3,
        stream: true,
        ...(extraBody ? { extra_body: extraBody } : {}),
        // Pass tools through unchanged; ConversationToolDefinition is structurally
        // compatible with ChatCompletionTool. When tools is undefined the SDK omits it.
        tools,
      },
      {
        signal,
      },
    );

    for await (const chunk of stream) {
      processDirectStreamChunk(streamState, chunk, onReplyDelta);
    }

    // If the model asked to call tools, surface the accumulated calls to the
    // caller and return an empty reply — the caller drives the tool UI.
    const toolCallResult = resolveStreamToolCalls(
      streamState.finishReason,
      streamState.toolCallAcc,
      onToolCalls,
    );
    if (toolCallResult) {
      return toolCallResult;
    }

    const normalizedReply = stripModelThinkingContent(streamState.reply.trim());
    if (!normalizedReply) {
      return {
        reply: '',
        error: buildConversationError('empty_response', text.emptyResponse),
        status: 'error',
      };
    }

    return {
      reply: normalizedReply,
      error: null,
      status: 'completed',
    };
  } catch (error) {
    if (isConversationAbortError(error) || signal?.aborted) {
      return {
        reply: streamState.reply.trim(),
        error: null,
        status: 'aborted',
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
