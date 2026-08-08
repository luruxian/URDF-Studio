import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveOpenAiChatExtraBody,
  stripModelThinkingContent,
} from './openAiRequestOptions.ts';

test('resolveOpenAiChatExtraBody disables thinking for MiniMax models by default', () => {
  assert.deepEqual(resolveOpenAiChatExtraBody('MiniMax-M3'), {
    thinking: { type: 'disabled' },
    reasoning_split: true,
  });
});

test('resolveOpenAiChatExtraBody returns undefined for non-MiniMax models', () => {
  assert.equal(resolveOpenAiChatExtraBody('gpt-4.1-mini'), undefined);
});

test('resolveOpenAiChatExtraBody prefers configured JSON extra_body', () => {
  assert.deepEqual(
    resolveOpenAiChatExtraBody('MiniMax-M3', {
      VITE_OPENAI_EXTRA_BODY: '{"thinking":{"type":"adaptive"}}',
    }),
    { thinking: { type: 'adaptive' } },
  );
});

test('stripModelThinkingContent removes think tags from model content', () => {
  assert.equal(
    stripModelThinkingContent('<think>internal</think>\n\nHello'),
    'Hello',
  );
  assert.equal(
    stripModelThinkingContent('<think>secret</think>Answer'),
    'Answer',
  );
  assert.equal(
    stripModelThinkingContent('<think>still streaming', { trim: false }),
    '',
  );
});
