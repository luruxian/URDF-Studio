import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  BOOTSTRAP_STORAGE_KEY,
} from '@/integrations/agile-robot/constants.ts';
import {
  setAiBackendAuthTokenProvider,
} from '@/shared/hostIntegrationState';

import {
  createConversationSession,
  deleteConversationSession,
  isRobotsStudioApiError,
  RobotsStudioApiError,
  syncConversationSnapshot,
} from './conversationSessionApi.ts';
import { isRobotsStudioApiError as isSharedRobotsStudioApiError } from '@/integrations/robots-studio/requirementsDocumentApi.ts';

const validBootstrap = {
  studio_token: 'test-token',
  studio_expires_at: '2026-08-09T00:00:00Z',
  order_id: 'order-123',
  attachment_id: 'att-456',
  conversation_id: null,
  input_image_path: 'orders/order-123/model_input.png',
  fallback_input_image_path: 'orders/order-123/fallback.png',
  api_base_url: 'https://api.example.com/api/v1',
};

const sampleSnapshotPut = {
  mode: 'general' as const,
  lang: 'zh',
  snapshot_revision: 1,
  snapshot: {
    robot: {
      name: 'demo',
      rootLinkId: 'base',
      linkCount: 1,
      jointCount: 0,
      links: [{
        id: 'base',
        name: 'base',
        visualType: 'box',
        collisionType: 'box',
        mass: 1,
      }],
      joints: [],
    },
    inspectionReport: null,
    selectedEntity: null,
    focusedIssue: null,
  },
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const emptyResponse = (status = 204): Response =>
  new Response(null, { status });

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true,
});

type FetchCall = { url: string; init?: RequestInit };

function installFetchMock(responses: Response[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[index];
    index += 1;
    if (next === undefined) {
      throw new Error('Mock fetch called more times than responses provided');
    }
    return next;
  }) as typeof fetch;
  return { calls };
}

const originalFetch = globalThis.fetch;

function storeBootstrapAndAuth(): void {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  setAiBackendAuthTokenProvider(() => 'test-token');
}

beforeEach(() => {
  sessionStorage.clear();
  setAiBackendAuthTokenProvider(null);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('RobotsStudioApiError is re-exported from shared robots studio client', () => {
  const error = new RobotsStudioApiError('boom', 500);
  assert.ok(error instanceof RobotsStudioApiError);
  assert.equal(isRobotsStudioApiError(error), true);
  assert.equal(isSharedRobotsStudioApiError(error), true);
});

test('createConversationSession throws 401 when no bootstrap is stored', async () => {
  setAiBackendAuthTokenProvider(() => 'test-token');
  await assert.rejects(() => createConversationSession(), (error: unknown) => {
    if (!isRobotsStudioApiError(error, 401)) return false;
    assert.match(error.message, /bootstrap/);
    return true;
  });
});

test('createConversationSession POSTs the conversation-sessions endpoint', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      session_id: 'sess-abc',
      expires_at: '2026-08-27T10:00:00Z',
    }, 201),
  ]);

  const result = await createConversationSession();

  assert.equal(result.sessionId, 'sess-abc');
  assert.equal(result.expiresAt, '2026-08-27T10:00:00Z');
  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/ai/conversation-sessions'),
    `unexpected URL: ${url}`,
  );
  assert.equal(init?.method, 'POST');
  assert.deepEqual(init?.headers, {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
  });
});

test('syncConversationSnapshot PUTs revision payload to session URL', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({ snapshot_revision: 1 }),
  ]);

  await syncConversationSnapshot('sess-abc', sampleSnapshotPut);

  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/ai/conversation-sessions/sess-abc'),
    `unexpected URL: ${url}`,
  );
  assert.equal(init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(init?.body)), sampleSnapshotPut);
});

test('syncConversationSnapshot throws with status and body on 409 stale revision', async () => {
  storeBootstrapAndAuth();
  installFetchMock([
    jsonResponse({ detail: 'stale_snapshot_revision' }, 409),
  ]);

  await assert.rejects(
    () => syncConversationSnapshot('sess-abc', sampleSnapshotPut),
    (error: unknown) => {
      if (!isRobotsStudioApiError(error, 409)) return false;
      assert.deepEqual(error.body, { detail: 'stale_snapshot_revision' });
      return true;
    },
  );
});

test('deleteConversationSession DELETEs the session URL', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([emptyResponse(204)]);

  await deleteConversationSession('sess-abc');

  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/ai/conversation-sessions/sess-abc'),
    `unexpected URL: ${url}`,
  );
  assert.equal(init?.method, 'DELETE');
});
