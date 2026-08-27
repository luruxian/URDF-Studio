/**
 * Streaming chat/completions transport for robots-managed Studio conversation.
 *
 * POST `{scopedBackend}/v1/chat/completions` with a `studio` wrapper (`session_id`,
 * `user_message`). The BFF owns prompts, snapshot context, tool registration, and
 * upstream model (`LLM_MODEL`); client `messages` / `tools` / `model` are ignored
 * when `studio` is present.
 */

import OpenAI from 'openai';

import { createRobotsAgentOpenAIClient } from './robotsAgentLlm';
import type { ConversationToolCall, ConversationToolDefinition } from './conversationService';

export interface RobotsConversationCompletionsInput {
  sessionId: string;
  userMessage: string;
  signal?: AbortSignal;
  onReplyDelta?: (delta: string) => void;
  tools?: ConversationToolDefinition[];
  onToolCalls?: (toolCalls: ConversationToolCall[]) => void;
}

export interface RobotsConversationCompletionsResult {
  reply: string;
  status: 'completed' | 'aborted';
  toolCalls: ConversationToolCall[];
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
  }>;
}

/** True when robots BFF rejected the call for lack of a valid studio_token. */
export function isRobotsConversationAuthError(error: unknown): boolean {
  return error instanceof OpenAI.APIError && error.status === 401;
}

const extractStreamDelta = (chunk: ConversationStreamChunkLike | null | undefined): string => {
  if (!chunk?.choices?.length) {
    return '';
  }
  return chunk.choices.map((choice) => choice.delta?.content ?? '').join('');
};

const accumulateStreamToolCallDeltas = (
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
    for (const toolCall of toolCalls) {
      const existing = acc.get(toolCall.index) ?? { arguments: '' };
      if (toolCall.id) existing.id = toolCall.id;
      if (toolCall.function?.name) existing.name = toolCall.function.name;
      if (toolCall.function?.arguments) existing.arguments += toolCall.function.arguments;
      acc.set(toolCall.index, existing);
    }
  }
};

const buildToolCallsFromAccumulator = (
  acc: Map<number, { id?: string; name?: string; arguments: string }>,
): ConversationToolCall[] => {
  return Array.from(acc.entries())
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, toolCall]) => ({
      function: {
        name: toolCall.name ?? '',
        arguments: toolCall.arguments,
      },
    }))
    .filter((toolCall) => toolCall.function.name.length > 0);
};

export async function streamRobotsConversationCompletions(
  input: RobotsConversationCompletionsInput,
): Promise<RobotsConversationCompletionsResult> {
  const client = createRobotsAgentOpenAIClient();
  const toolAcc = new Map<number, { id?: string; name?: string; arguments: string }>();
  let reply = '';

  try {
    const stream = await client.chat.completions.create(
      {
        model: 'robots-managed',
        messages: [],
        stream: true,
        ...(input.tools ? { tools: input.tools } : {}),
        // Robots BFF extension; ignored by upstream OpenAI types.
        studio: {
          session_id: input.sessionId,
          user_message: input.userMessage,
        },
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      { signal: input.signal },
    );

    for await (const chunk of stream) {
      const delta = extractStreamDelta(chunk as ConversationStreamChunkLike);
      if (delta) {
        reply += delta;
        input.onReplyDelta?.(delta);
      }
      accumulateStreamToolCallDeltas(toolAcc, chunk as ConversationStreamChunkLike);
    }
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return {
        reply,
        status: 'aborted',
        toolCalls: buildToolCallsFromAccumulator(toolAcc),
      };
    }
    throw error;
  }

  const toolCalls = buildToolCallsFromAccumulator(toolAcc);
  if (toolCalls.length > 0) {
    input.onToolCalls?.(toolCalls);
  }

  return {
    reply,
    status: 'completed',
    toolCalls,
  };
}
