import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AiBackendRequestError,
  isAiBackendEnabled,
  requestAiBackendContent,
  setAiBackendAuthTokenProvider,
} from './aiBackendTransport.ts';
import { setAiBackendBaseUrlResolver } from '../../../shared/hostIntegrationState';

const BACKEND_URL = 'https://backend.test/api/ai/urdf-studio';

const withBackendEnv = async (fn: () => Promise<void> | void): Promise<void> => {
  const previous = process.env.AI_BACKEND_URL;
  process.env.AI_BACKEND_URL = `${BACKEND_URL}/`;
  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.AI_BACKEND_URL;
    } else {
      process.env.AI_BACKEND_URL = previous;
    }
  }
};

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

const withFetch = async (
  impl: (url: string, init: RequestInit) => Promise<unknown>,
  fn: (requests: CapturedRequest[]) => Promise<void> | void,
): Promise<void> => {
  const previousFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const captured = { url: String(url), init: init ?? {} };
    requests.push(captured);
    return impl(captured.url, captured.init);
  }) as typeof fetch;
  try {
    await fn(requests);
  } finally {
    globalThis.fetch = previousFetch;
  }
};

const jsonResponse = (status: number, payload: unknown): unknown => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

test('isAiBackendEnabled reflects the backend URL env', async () => {
  assert.equal(isAiBackendEnabled(), false);
  await withBackendEnv(() => {
    assert.equal(isAiBackendEnabled(), true);
  });
});

test('getAiBackendBaseUrl prefers resolver over static env', async () => {
  setAiBackendBaseUrlResolver(() => 'https://robots.test/api/v1/me/projects/o/studio/ai');
  process.env.AI_BACKEND_URL = 'https://static.test/ai';
  try {
    await withFetch(
      async () => jsonResponse(200, { success: true, data: { content: 'x' } }),
      async (requests) => {
        await requestAiBackendContent('/generate', {});
        assert.match(requests[0].url, /\/studio\/ai\/generate$/);
      },
    );
  } finally {
    setAiBackendBaseUrlResolver(null);
    delete process.env.AI_BACKEND_URL;
  }
});

test('requestAiBackendContent posts JSON and returns data.content', async () => {
  await withBackendEnv(() =>
    withFetch(
      async () => jsonResponse(200, { success: true, data: { content: '{"a":1}' } }),
      async (requests) => {
        const content = await requestAiBackendContent('/generate', { prompt: 'hi' });
        assert.equal(content, '{"a":1}');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, `${BACKEND_URL}/generate`);
        assert.equal(requests[0].init.method, 'POST');
        assert.equal(JSON.parse(String(requests[0].init.body)).prompt, 'hi');
        const headers = requests[0].init.headers as Record<string, string>;
        assert.equal(headers['Content-Type'], 'application/json');
        assert.equal(headers.Authorization, undefined);
      },
    ),
  );
});

test('requestAiBackendContent attaches the registered auth token as Bearer', async () => {
  setAiBackendAuthTokenProvider(() => 'jwt-token');
  try {
    await withBackendEnv(() =>
      withFetch(
        async () => jsonResponse(200, { success: true, data: { content: 'ok' } }),
        async (requests) => {
          await requestAiBackendContent('/inspect', { robot: {} });
          const headers = requests[0].init.headers as Record<string, string>;
          assert.equal(headers.Authorization, 'Bearer jwt-token');
        },
      ),
    );
  } finally {
    setAiBackendAuthTokenProvider(null);
  }
});

test('requestAiBackendContent surfaces backend error messages with status', async () => {
  await withBackendEnv(() =>
    withFetch(
      async () => jsonResponse(401, { success: false, message: 'JWT Bearer token required' }),
      async () => {
        await assert.rejects(
          requestAiBackendContent('/generate', { prompt: 'hi' }),
          (error: unknown) => {
            assert.ok(error instanceof AiBackendRequestError);
            assert.equal(error.message, 'JWT Bearer token required');
            assert.equal(error.status, 401);
            return true;
          },
        );
      },
    ),
  );
});

test('requestAiBackendContent rejects empty content', async () => {
  await withBackendEnv(() =>
    withFetch(
      async () => jsonResponse(200, { success: true, data: { content: '' } }),
      async () => {
        await assert.rejects(
          requestAiBackendContent('/generate', { prompt: 'hi' }),
          AiBackendRequestError,
        );
      },
    ),
  );
});
