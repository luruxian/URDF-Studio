import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_CONVERSATION_COMPACT_BELOW_WIDTH,
  AI_CONVERSATION_DEFAULT_HEIGHT,
  AI_CONVERSATION_DEFAULT_WIDTH,
  AI_CONVERSATION_MIN_HEIGHT,
  AI_CONVERSATION_MIN_WIDTH,
  isAIConversationCompactLayout,
} from './aiConversationWindowLayout.ts';

test('AI conversation default size is two thirds of 760 by 620', () => {
  assert.equal(AI_CONVERSATION_DEFAULT_WIDTH, 507);
  assert.equal(AI_CONVERSATION_DEFAULT_HEIGHT, 413);
  assert.equal(AI_CONVERSATION_MIN_WIDTH, 480);
  assert.equal(AI_CONVERSATION_MIN_HEIGHT, 413);
  assert.equal(AI_CONVERSATION_COMPACT_BELOW_WIDTH, 507);
  assert.equal(isAIConversationCompactLayout(507), false);
  assert.equal(isAIConversationCompactLayout(506), true);
});
