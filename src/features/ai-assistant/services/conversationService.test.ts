import test from 'node:test';
import assert from 'node:assert/strict';

import { setAiBackendBaseUrlResolver } from '@/shared/hostIntegrationState';

import {
  accumulateToolCallDeltas,
  buildConversationMessages,
  extractConversationDelta,
  isConversationAbortError,
  sendConversationTurn,
  sendConversationTurnStream,
  serializeConversationHistory,
} from './conversationService.ts';
import OpenAI from 'openai';

const ROBOTS_API_BASE = 'https://api.example.com/api/v1';
const ROBOTS_AI_BACKEND = `${ROBOTS_API_BASE}/me/projects/ord-9/studio/ai`;

const withRobotsConversationEnv = async (
  run: () => Promise<void>,
  options: { resolverUrl?: string } = {},
): Promise<void> => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  process.env.VITE_ROBOTS_API_BASE_URL = ROBOTS_API_BASE;
  setAiBackendBaseUrlResolver(() => options.resolverUrl ?? ROBOTS_AI_BACKEND);

  try {
    await run();
  } finally {
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
  }
};

test('buildConversationMessages keeps only valid recent history and appends current user message', () => {
  const history = [
    { role: 'user' as const, content: '  first question  ' },
    { role: 'assistant' as const, content: '' },
    { role: 'assistant' as const, content: 'first answer' },
    { role: 'user' as const, content: 'second question' },
  ];

  const messages = buildConversationMessages(history, '  current question ');

  assert.equal(messages.length, 4);
  assert.deepEqual(messages[0], { role: 'user', content: 'first question' });
  assert.deepEqual(messages[1], { role: 'assistant', content: 'first answer' });
  assert.deepEqual(messages[2], { role: 'user', content: 'second question' });
  assert.deepEqual(messages[3], { role: 'user', content: 'current question' });
});

test('buildConversationMessages limits history to the latest eight turns', () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `turn-${index}`,
  }));

  const messages = buildConversationMessages(history, 'latest-question');

  assert.equal(messages.length, 9);
  assert.deepEqual(messages[0], { role: 'user', content: 'turn-2' });
  assert.deepEqual(messages[7], { role: 'assistant', content: 'turn-9' });
  assert.deepEqual(messages[8], { role: 'user', content: 'latest-question' });
});

test('serializeConversationHistory applies the same sanitization contract as message building', () => {
  const history = [
    { role: 'user' as const, content: '  hello  ' },
    { role: 'assistant' as const, content: '' },
    { role: 'assistant' as const, content: 'world' },
  ];

  const serialized = serializeConversationHistory(history);
  assert.equal(
    serialized,
    '[{"role":"user","content":"hello"},{"role":"assistant","content":"world"}]',
  );
});

test('sendConversationTurn returns handoff error when robots API base is not configured', async () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  delete process.env.VITE_ROBOTS_API_BASE_URL;
  setAiBackendBaseUrlResolver(null);

  try {
    const result = await sendConversationTurn({
      mode: 'general',
      lang: 'en',
      context: '{"robot":{"name":"demo"}}',
      history: [],
      userMessage: 'What can this robot do?',
    });

    assert.equal(result.reply, '');
    assert.equal(result.error?.code, 'robots_handoff_required');
    assert.match(String(result.error?.message || ''), /Agile Robot/i);
  } finally {
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
  }
});

test('sendConversationTurnStream returns localized handoff error when robots session is unavailable', async () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  delete process.env.VITE_ROBOTS_API_BASE_URL;
  setAiBackendBaseUrlResolver(null);

  try {
    const result = await sendConversationTurnStream({
      mode: 'general',
      lang: 'zh',
      context: '{"robot":{"name":"demo"}}',
      history: [],
      userMessage: '这个机器人适合做什么？',
    });

    assert.equal(result.status, 'error');
    assert.equal(result.reply, '');
    assert.equal(result.error?.code, 'robots_handoff_required');
    assert.match(String(result.error?.message || ''), /Agile Robot|主站/);
  } finally {
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
  }
});

test('extractConversationDelta concatenates streamed content fragments', () => {
  const delta = extractConversationDelta({
    choices: [{ delta: { content: 'First' } }, { delta: { content: ' second' } }],
  });

  assert.equal(delta, 'First second');
  assert.equal(extractConversationDelta(undefined), '');
});

test('accumulateToolCallDeltas accumulates tool_call fragments across chunks by index', () => {
  const acc = new Map<number, { id?: string; name?: string; arguments: string }>();

  accumulateToolCallDeltas(acc, {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', function: { name: 'look_up_motor' } }],
        },
      },
    ],
  });
  accumulateToolCallDeltas(acc, {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"name":' } }],
        },
      },
    ],
  });
  accumulateToolCallDeltas(acc, {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '"J10"}' } }],
        },
      },
    ],
  });

  assert.deepEqual(Array.from(acc.values()), [
    { id: 'call_1', name: 'look_up_motor', arguments: '{"name":"J10"}' },
  ]);

  // Null / undefined / empty chunks are no-ops and do not disturb the map.
  accumulateToolCallDeltas(acc, undefined);
  accumulateToolCallDeltas(acc, null);
  accumulateToolCallDeltas(acc, { choices: [] });
  accumulateToolCallDeltas(acc, { choices: [{ delta: { content: 'text' } }] });
  assert.equal(acc.size, 1);
  assert.deepEqual(Array.from(acc.values()), [
    { id: 'call_1', name: 'look_up_motor', arguments: '{"name":"J10"}' },
  ]);
});

test('isConversationAbortError recognizes SDK abort errors and AbortError names', () => {
  assert.equal(isConversationAbortError(new OpenAI.APIUserAbortError()), true);

  const abortError = new Error('Request aborted');
  abortError.name = 'AbortError';
  assert.equal(isConversationAbortError(abortError), true);

  assert.equal(isConversationAbortError(new Error('Other error')), false);
});

test('sendConversationTurnStream surfaces backend stream failures', async () => {
  await withRobotsConversationEnv(async () => {
    const previousFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new Error('connection refused');
    }) as typeof fetch;

    try {
      const result = await sendConversationTurnStream({
        mode: 'general',
        lang: 'en',
        context: '{"robot":{"name":"demo"}}',
        history: [],
        userMessage: 'How should I improve this robot?',
      });

      assert.equal(result.status, 'error');
      assert.equal(result.reply, '');
      assert.equal(result.error?.code, 'request_failed');
      assert.match(String(result.error?.message || ''), /connection refused/i);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('sendConversationTurnStream uses the robots BFF transport when configured', async () => {
  await withRobotsConversationEnv(async () => {
    const previousFetch = globalThis.fetch;
    const requests: Array<{ url: string; init: RequestInit }> = [];

    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"delta":"后端"}\n\n'));
          controller.enqueue(encoder.encode('data: {"delta":"回复"}\n\ndata: {"done":true}\n\n'));
          controller.close();
        },
      });
      return { ok: true, status: 200, body, json: async () => null };
    }) as typeof fetch;

    try {
      const streamedDeltas: string[] = [];
      const result = await sendConversationTurnStream({
        mode: 'general',
        lang: 'zh',
        context: '{"robot":{"name":"demo"}}',
        history: [
          { role: 'user', content: '  之前的问题  ' },
          { role: 'assistant', content: '' },
        ],
        userMessage: '  这个机器人怎么样？ ',
        onReplyDelta: (delta) => {
          streamedDeltas.push(delta);
        },
      });

      assert.deepEqual(streamedDeltas, ['后端', '回复']);
      assert.equal(result.status, 'completed');
      assert.equal(result.reply, '后端回复');
      assert.equal(result.error, null);

      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, `${ROBOTS_AI_BACKEND}/chat`);
      const sentPayload = JSON.parse(String(requests[0].init.body));
      assert.equal(sentPayload.userMessage, '这个机器人怎么样？');
      assert.equal(sentPayload.mode, 'general');
      assert.equal(sentPayload.lang, 'zh');
      assert.deepEqual(sentPayload.history, [{ role: 'user', content: '之前的问题' }]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('sendConversationTurnStream maps robots backend 401 to a login-required error', async () => {
  await withRobotsConversationEnv(async () => {
    const previousFetch = globalThis.fetch;

    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      body: null,
      json: async () => ({ success: false, message: 'JWT Bearer token required' }),
    })) as unknown as typeof fetch;

    try {
      const result = await sendConversationTurnStream({
        mode: 'general',
        lang: 'zh',
        context: '',
        history: [],
        userMessage: '这个机器人怎么样？',
      });

      assert.equal(result.status, 'error');
      assert.equal(result.error?.code, 'login_required');
      assert.equal(result.error?.message, '请先登录后再使用 AI 助手。');
      assert.ok(!String(result.error?.message).includes('JWT'));
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
