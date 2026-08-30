import test, { afterEach, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  BOOTSTRAP_STORAGE_KEY,
} from '@/integrations/agile-robot/constants.ts';
import {
  setAiBackendAuthTokenProvider,
} from '@/shared/hostIntegrationState';

import {
  createMeshImportGrant,
  formatMeshJobFailure,
  getMeshJob,
  getRequirementsDocument,
  getRobotsStudioErrorCode,
  isRobotsStudioApiError,
  MESH_JOB_POLL_INTERVAL_MS,
  MESH_JOB_POLL_TIMEOUT_MS,
  patchRequirementsDocument,
  pollMeshJob,
  regenerateMesh,
  RobotsStudioApiError,
} from './index.ts';

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

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true,
});

type FetchCall = { url: string; init?: RequestInit };

type MockResponse = Response | (() => Response);

function installFetchMock(
  responses: MockResponse[],
  options?: { repeatLast?: boolean },
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  const pick = (): Response | undefined => {
    let entry: MockResponse | undefined;
    if (index < responses.length) {
      entry = responses[index];
      index += 1;
    } else if (options?.repeatLast && responses.length > 0) {
      entry = responses[responses.length - 1];
    }
    if (entry === undefined) return undefined;
    return typeof entry === 'function' ? entry() : entry;
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = pick();
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

async function drivePollUntilSettled(
  t: TestContext,
  pollPromise: Promise<unknown>,
  maxTicks: number,
): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    await t.mock.timers.tick(MESH_JOB_POLL_INTERVAL_MS);
    await new Promise<void>((resolve) => setImmediate(resolve));
    let settled = false;
    pollPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    if (settled) break;
  }
}

beforeEach(() => {
  sessionStorage.clear();
  setAiBackendAuthTokenProvider(null);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================================
// RobotsStudioApiError / helpers
// ============================================================

test('RobotsStudioApiError carries name, status and body', () => {
  const error = new RobotsStudioApiError('boom', 500, { detail: 'x' });
  assert.equal(error.name, 'RobotsStudioApiError');
  assert.equal(error.status, 500);
  assert.deepEqual(error.body, { detail: 'x' });
  assert.ok(error instanceof Error);
});

test('isRobotsStudioApiError narrows only RobotsStudioApiError instances', () => {
  assert.equal(isRobotsStudioApiError(new RobotsStudioApiError('x', 401)), true);
  assert.equal(isRobotsStudioApiError(new Error('x')), false);
  assert.equal(isRobotsStudioApiError(null), false);
});

test('isRobotsStudioApiError matches the optional status', () => {
  assert.equal(isRobotsStudioApiError(new RobotsStudioApiError('x', 401), 401), true);
  assert.equal(isRobotsStudioApiError(new RobotsStudioApiError('x', 401), 500), false);
});

test('getRobotsStudioErrorCode reads error_code from JSON body', () => {
  assert.equal(getRobotsStudioErrorCode({ error_code: 'revision_conflict' }), 'revision_conflict');
  assert.equal(getRobotsStudioErrorCode({ message: 'x' }), undefined);
  assert.equal(getRobotsStudioErrorCode(null), undefined);
});

// ============================================================
// Auth / bootstrap guards
// ============================================================

test('getRequirementsDocument throws 401 when no bootstrap is stored', async () => {
  setAiBackendAuthTokenProvider(() => 'test-token');
  await assert.rejects(() => getRequirementsDocument(), (error: unknown) => {
    if (!isRobotsStudioApiError(error, 401)) return false;
    assert.match(error.message, /bootstrap/);
    return true;
  });
});

test('getRequirementsDocument throws 401 when auth token is missing', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  await assert.rejects(() => getRequirementsDocument(), (error: unknown) => {
    if (!isRobotsStudioApiError(error, 401)) return false;
    assert.match(error.message, /auth token/);
    return true;
  });
});

// ============================================================
// getRequirementsDocument
// ============================================================

test('getRequirementsDocument GETs the requirements-document endpoint', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      order_id: 'order-123',
      revision: 3,
      requirements_document: '## 背景\n...',
      updated_at: '2026-08-27T05:00:00Z',
      package_type: 'urdf_stl',
    }),
  ]);

  const result = await getRequirementsDocument();

  assert.equal(result.revision, 3);
  assert.equal(result.package_type, 'urdf_stl');
  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/requirements-document'),
    `unexpected URL: ${url}`,
  );
  assert.ok(init, 'getRequirementsDocument request should include init');
  assert.equal(init.method, 'GET');
  assert.deepEqual(init.headers, {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
  });
});

test('getRequirementsDocument throws with status and body on a 401 response', async () => {
  storeBootstrapAndAuth();
  installFetchMock([jsonResponse({ message: 'unauthorized' }, 401)]);

  await assert.rejects(() => getRequirementsDocument(), (error: unknown) => {
    if (!isRobotsStudioApiError(error, 401)) return false;
    assert.deepEqual(error.body, { message: 'unauthorized' });
    assert.equal(error.message, 'Robots Studio API error: 401');
    return true;
  });
});

// ============================================================
// patchRequirementsDocument
// ============================================================

test('patchRequirementsDocument PATCHes revision payload', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      revision: 4,
      requirements_document: '## 背景\n## Studio 修订（v4）',
      change_summary: '手臂长度增加 5cm',
      updated_at: '2026-08-27T05:01:00Z',
    }),
  ]);

  const result = await patchRequirementsDocument({
    base_revision: 3,
    change_summary: '手臂长度增加 5cm',
    section_updates: {
      性能参数: '臂展 +5cm',
    },
    history_bullets: ['臂展 +5cm'],
    client_mutation_id: '550e8400-e29b-41d4-a716-446655440000',
  });

  assert.equal(result.revision, 4);
  assert.equal(result.change_summary, '手臂长度增加 5cm');
  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/requirements-document'),
    `unexpected URL: ${url}`,
  );
  assert.equal(init?.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(init?.body)), {
    base_revision: 3,
    change_summary: '手臂长度增加 5cm',
    section_updates: {
      性能参数: '臂展 +5cm',
    },
    history_bullets: ['臂展 +5cm'],
    client_mutation_id: '550e8400-e29b-41d4-a716-446655440000',
  });
});

test('patchRequirementsDocument surfaces revision_conflict on 409', async () => {
  storeBootstrapAndAuth();
  installFetchMock([
    jsonResponse({ error_code: 'revision_conflict', message: 'stale revision' }, 409),
  ]);

  await assert.rejects(
    () =>
      patchRequirementsDocument({
        base_revision: 2,
        change_summary: 'x',
        section_updates: { 背景: 'y' },
        history_bullets: ['y'],
      }),
    (error: unknown) => {
      if (!isRobotsStudioApiError(error, 409)) return false;
      assert.equal(getRobotsStudioErrorCode(error.body), 'revision_conflict');
      return true;
    },
  );
});

// ============================================================
// regenerateMesh
// ============================================================

test('regenerateMesh POSTs revision and default locale', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse(
      {
        job_id: 'job-1',
        revision: 4,
        status: 'queued',
        external_job_id: 'team-mesh-external-id',
      },
      202,
    ),
  ]);

  const result = await regenerateMesh({ revision: 4 });

  assert.equal(result.job_id, 'job-1');
  assert.equal(result.status, 'queued');
  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/mesh/regenerate'),
    `unexpected URL: ${url}`,
  );
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), {
    revision: 4,
    locale: 'zh-CN',
  });
});

test('regenerateMesh forwards explicit locale', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse(
      {
        job_id: 'job-1',
        revision: 4,
        status: 'queued',
        external_job_id: 'ext',
      },
      202,
    ),
  ]);

  await regenerateMesh({ revision: 4, locale: 'en' });

  assert.deepEqual(JSON.parse(String(spy.calls[0].init?.body)), {
    revision: 4,
    locale: 'en',
  });
});

// ============================================================
// getMeshJob / pollMeshJob
// ============================================================

test('getMeshJob GETs the mesh job endpoint without revision query by default', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'running',
      attachment_id: null,
      package_type: 'urdf_stl',
      error_code: null,
      error_message: null,
    }),
  ]);

  const result = await getMeshJob();

  assert.equal(result.status, 'running');
  assert.equal(spy.calls.length, 1);
  const { url } = spy.calls[0];
  assert.ok(url.includes('/me/projects/order-123/studio/mesh/job'));
  assert.ok(!url.includes('revision='));
});

test('getMeshJob includes revision query when provided', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'done',
      attachment_id: 'att-new',
      package_type: 'urdf_stl',
      error_code: null,
      error_message: null,
    }),
  ]);

  const result = await getMeshJob(4);

  assert.equal(result.attachment_id, 'att-new');
  assert.ok(spy.calls[0].url.includes('revision=4'));
});

test('formatMeshJobFailure prefers error_code over error_message', () => {
  assert.equal(
    formatMeshJobFailure({
      job_id: 'j1',
      revision: 1,
      status: 'failed',
      attachment_id: null,
      package_type: 'urdf_stl',
      error_code: 'E1',
      error_message: 'boom',
    }),
    'E1',
  );
  assert.equal(
    formatMeshJobFailure({
      job_id: 'j1',
      revision: 1,
      status: 'failed',
      attachment_id: null,
      package_type: 'urdf_stl',
      error_code: null,
      error_message: 'boom',
    }),
    'boom',
  );
});

test('pollMeshJob polls across intervals until done', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'running',
      attachment_id: null,
      package_type: 'urdf_stl',
      error_code: null,
      error_message: null,
    }),
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'done',
      attachment_id: 'att-new',
      package_type: 'urdf_stl',
      error_code: null,
      error_message: null,
    }),
  ]);

  const pollPromise = pollMeshJob(4);
  await drivePollUntilSettled(t, pollPromise, 20);

  const result = await pollPromise;
  assert.equal(result.status, 'done');
  assert.equal(result.attachment_id, 'att-new');
  assert.equal(spy.calls.length, 2);
});

test('pollMeshJob throws 408 when polling exceeds the timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  storeBootstrapAndAuth();
  installFetchMock(
    [
      () =>
        jsonResponse({
          job_id: 'job-1',
          revision: 4,
          status: 'queued',
          attachment_id: null,
          package_type: 'urdf_stl',
          error_code: null,
          error_message: null,
        }),
    ],
    { repeatLast: true },
  );

  const pollPromise = pollMeshJob();
  const maxTicks = Math.ceil(MESH_JOB_POLL_TIMEOUT_MS / MESH_JOB_POLL_INTERVAL_MS) + 2;
  await drivePollUntilSettled(t, pollPromise, maxTicks);

  await assert.rejects(
    pollPromise,
    (error: unknown) =>
      isRobotsStudioApiError(error, 408) &&
      /超时/.test(error.message),
  );
});

// ============================================================
// createMeshImportGrant
// ============================================================

test('createMeshImportGrant POSTs attachment_id when provided', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      package_type: 'urdf_stl',
      import_grant_id: 'pvw_abc',
      from_origin: 'https://robots.example.com',
      expires_at: '2026-08-27T06:00:00Z',
      attachment_id: 'att-new',
    }),
  ]);

  const result = await createMeshImportGrant({ attachment_id: 'att-new' });

  assert.equal(result.import_grant_id, 'pvw_abc');
  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/mesh/import-grant'),
    `unexpected URL: ${url}`,
  );
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), { attachment_id: 'att-new' });
});

test('createMeshImportGrant omits attachment_id when not provided', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      package_type: 'urdf_stl',
      import_grant_id: 'pvw_abc',
      from_origin: 'https://robots.example.com',
      expires_at: '2026-08-27T06:00:00Z',
      attachment_id: 'att-latest',
    }),
  ]);

  await createMeshImportGrant();

  assert.deepEqual(JSON.parse(String(spy.calls[0].init?.body)), {});
});
