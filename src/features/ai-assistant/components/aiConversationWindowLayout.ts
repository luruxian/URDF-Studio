export const AI_CONVERSATION_DEFAULT_WIDTH = 507;
export const AI_CONVERSATION_DEFAULT_HEIGHT = 413;
export const AI_CONVERSATION_MIN_WIDTH = 480;
export const AI_CONVERSATION_MIN_HEIGHT = 413;
export const AI_CONVERSATION_COMPACT_BELOW_WIDTH = 507;

export function isAIConversationCompactLayout(width: number): boolean {
  return width < AI_CONVERSATION_COMPACT_BELOW_WIDTH;
}
