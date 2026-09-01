import test, { afterEach, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import { BOOTSTRAP_STORAGE_KEY } from '@/integrations/agile-robot/constants.ts';
import { setAiBackendAuthTokenProvider } from '@/shared/hostIntegrationState';

import {
  buildClientMutationId,
  createParseToolCalls,
  createStudioModificationTools,
  normalizeSectionUpdates,
} from './studioModificationTools.ts';
import {
  MESH_JOB_POLL_INTERVAL_MS,
} from './meshRegenerateApi.ts';

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

const proposeV2Args = {
  change_summary: 'Extend arm by 5cm',
  section_updates: { 性能参数: '臂展 +5cm' },
  history_bullets: ['臂展 +5cm'],
};

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

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

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

function countPatchCalls(calls: FetchCall[]): number {
  return calls.filter((call) => call.init?.method === 'PATCH').length;
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
// createStudioModificationTools availability
// ============================================================

test('createStudioModificationTools returns null without bootstrap', async () => {
  const config = await createStudioModificationTools({
    lang: 'zh',
    packageType: 'urdf_stl',
    importUrdfPackage: async () => {},
  });
  assert.equal(config, null);
});

test('createStudioModificationTools returns null for non-urdf_stl packageType', async () => {
  storeBootstrapAndAuth();
  const config = await createStudioModificationTools({
    lang: 'zh',
    packageType: 'glb',
    importUrdfPackage: async () => {},
  });
  assert.equal(config, null);
});

test('createStudioModificationTools GETs package_type when not provided', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      order_id: 'order-123',
      revision: 1,
      requirements_document: 'doc',
      updated_at: '2026-08-27T05:00:00Z',
      package_type: 'glb',
    }),
  ]);

  const config = await createStudioModificationTools({
    lang: 'en',
    importUrdfPackage: async () => {},
  });

  assert.equal(config, null);
  assert.equal(spy.calls.length, 1);
  assert.ok(spy.calls[0].url.includes('/requirements-document'));
});

test('createStudioModificationTools returns config for urdf_stl bootstrap order', async () => {
  storeBootstrapAndAuth();
  const config = await createStudioModificationTools({
    lang: 'zh',
    packageType: 'urdf_stl',
    importUrdfPackage: async () => {},
  });

  assert.ok(config);
  assert.equal(config.tools.length, 2);
  assert.equal(config.tools[0].function.name, 'propose_requirements_revision');
  assert.equal(config.tools[1].function.name, 'regenerate_robot_model');
});

// ============================================================
// buildClientMutationId / normalizeSectionUpdates
// ============================================================

test('buildClientMutationId is deterministic for the same payload', async () => {
  const payload = {
    change_summary: 'arm +5cm',
    section_updates: { 性能参数: '臂展 +5cm' as const },
    history_bullets: ['臂展 +5cm'],
  };
  const first = await buildClientMutationId(3, payload);
  const second = await buildClientMutationId(3, payload);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('normalizeSectionUpdates strips ## prefixes and ignores unknown keys', () => {
  assert.deepEqual(
    normalizeSectionUpdates({
      '##性能参数': '## 臂展 +5cm',
      未知: 'skip',
    }),
    { 性能参数: '臂展 +5cm' },
  );
});

test('normalizeSectionUpdates turns over-escaped newlines into real line breaks', () => {
  const overEscaped = '- 负载 5kg\\n- 臂展 1.2m\\n\\n底座更紧凑';
  assert.equal(overEscaped.includes('\n'), false);

  assert.deepEqual(normalizeSectionUpdates({ 性能参数: overEscaped }), {
    性能参数: '- 负载 5kg\n- 臂展 1.2m\n\n底座更紧凑',
  });
});

test('normalizeSectionUpdates leaves already-real newlines unchanged', () => {
  assert.deepEqual(
    normalizeSectionUpdates({ 性能参数: '- 负载 5kg\n- 臂展 1.2m' }),
    { 性能参数: '- 负载 5kg\n- 臂展 1.2m' },
  );
});

test('createParseToolCalls unescapes literal newlines in propose tool arguments', () => {
  const parseToolCalls = createParseToolCalls('zh');
  const parsed = parseToolCalls([
    {
      function: {
        name: 'propose_requirements_revision',
        arguments:
          '{"change_summary":"arm +5cm","section_updates":{"性能参数":"- 负载 5kg\\\\n- 臂展 1.2m"},"history_bullets":["负载 +2kg\\\\n臂展 +5cm"]}',
      },
    },
  ]);

  assert.ok(parsed);
  assert.deepEqual(parsed.args.section_updates, {
    性能参数: '- 负载 5kg\n- 臂展 1.2m',
  });
  assert.deepEqual(parsed.args.history_bullets, ['负载 +2kg\n臂展 +5cm']);
});

// ============================================================
// parseToolCalls
// ============================================================

test('createParseToolCalls ignores get_requirements_document and picks actionable tool', () => {
  const parseToolCalls = createParseToolCalls('en');
  const parsed = parseToolCalls([
    {
      function: {
        name: 'get_requirements_document',
        arguments: '{}',
      },
    },
    {
      function: {
        name: 'propose_requirements_revision',
        arguments: JSON.stringify(proposeV2Args),
      },
    },
  ]);

  assert.ok(parsed);
  assert.equal(parsed.toolName, 'propose_requirements_revision');
});

test('createParseToolCalls returns null when only get_requirements_document is present', () => {
  const parseToolCalls = createParseToolCalls('en');
  assert.equal(
    parseToolCalls([
      {
        function: {
          name: 'get_requirements_document',
          arguments: '{}',
        },
      },
    ]),
    null,
  );
});

test('createParseToolCalls parses propose_requirements_revision with section names in summary', () => {
  const parseToolCalls = createParseToolCalls('zh');
  const parsed = parseToolCalls([
    {
      function: {
        name: 'propose_requirements_revision',
        arguments: JSON.stringify({
          change_summary: 'Extend arm by 5cm',
          section_updates: { 性能参数: '臂展 +5cm', 背景: '新背景' },
          history_bullets: ['臂展 +5cm'],
        }),
      },
    },
  ]);

  assert.ok(parsed);
  assert.equal(parsed.toolName, 'propose_requirements_revision');
  assert.match(parsed.summary, /性能参数/);
  assert.match(parsed.summary, /背景/);
});

test('createParseToolCalls returns null when section_updates is empty', () => {
  const parseToolCalls = createParseToolCalls('en');
  assert.equal(
    parseToolCalls([
      {
        function: {
          name: 'propose_requirements_revision',
          arguments: JSON.stringify({
            change_summary: 'x',
            section_updates: {},
            history_bullets: ['y'],
          }),
        },
      },
    ]),
    null,
  );
});

test('createParseToolCalls parses regenerate_robot_model with revision label', () => {
  const parseToolCalls = createParseToolCalls('zh');
  const parsed = parseToolCalls([
    {
      function: {
        name: 'regenerate_robot_model',
        arguments: JSON.stringify({ revision: 4 }),
      },
    },
  ]);

  assert.ok(parsed);
  assert.equal(parsed.toolName, 'regenerate_robot_model');
  assert.match(parsed.summary, /\(rev 4\)/);
});

test('createParseToolCalls returns null for invalid JSON arguments', () => {
  const parseToolCalls = createParseToolCalls('en');
  assert.equal(
    parseToolCalls([{ function: { name: 'propose_requirements_revision', arguments: '{' } }]),
    null,
  );
});

// ============================================================
// onExecute pipeline (fetch mocks stand in for API modules)
// ============================================================

test('onExecute for propose_requirements_revision runs PATCH → regenerate → poll → grant → import', async () => {
  storeBootstrapAndAuth();
  const importCalls: Array<{ importGrantId: string; fromOrigin: string }> = [];
  const spy = installFetchMock([
    jsonResponse({
      order_id: 'order-123',
      revision: 3,
      requirements_document: '## doc',
      updated_at: '2026-08-27T05:00:00Z',
      package_type: 'urdf_stl',
    }),
    jsonResponse({
      revision: 4,
      requirements_document: '## doc\n## v4',
      change_summary: 'arm +5cm',
      updated_at: '2026-08-27T05:01:00Z',
    }),
    jsonResponse(
      {
        job_id: 'job-1',
        revision: 4,
        status: 'queued',
        external_job_id: 'ext-1',
      },
      202,
    ),
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'done',
      attachment_id: 'att-new',
      package_type: 'urdf_stl',
      error_code: null,
      error_message: null,
    }),
    jsonResponse({
      package_type: 'urdf_stl',
      import_grant_id: 'pvw_abc',
      from_origin: 'https://robots.example.com',
      expires_at: '2026-08-27T06:00:00Z',
      attachment_id: 'att-new',
    }),
  ]);

  const config = await createStudioModificationTools({
    lang: 'zh',
    packageType: 'urdf_stl',
    importUrdfPackage: async (params) => {
      importCalls.push(params);
    },
  });
  assert.ok(config);

  const toolArgs = {
    change_summary: 'arm +5cm',
    section_updates: { 性能参数: '臂展 +5cm' },
    history_bullets: ['臂展 +5cm'],
  };

  const result = await config.onExecute({
    toolName: 'propose_requirements_revision',
    args: toolArgs,
    summary: 'arm +5cm',
  });

  assert.equal(result.success, true);
  assert.equal(spy.calls.length, 5);
  assert.equal(spy.calls[0].init?.method, 'GET');
  assert.equal(spy.calls[1].init?.method, 'PATCH');
  const patchBody = JSON.parse(String(spy.calls[1].init?.body)) as Record<string, unknown>;
  assert.equal(patchBody.base_revision, 3);
  assert.equal(patchBody.change_summary, 'arm +5cm');
  assert.deepEqual(patchBody.section_updates, { 性能参数: '臂展 +5cm' });
  assert.deepEqual(patchBody.history_bullets, ['臂展 +5cm']);
  assert.equal(typeof patchBody.client_mutation_id, 'string');
  assert.equal(spy.calls[2].init?.method, 'POST');
  assert.ok(spy.calls[2].url.includes('/mesh/regenerate'));
  assert.deepEqual(JSON.parse(String(spy.calls[2].init?.body)), {
    revision: 4,
    locale: 'zh-CN',
  });
  assert.ok(spy.calls[3].url.includes('/mesh/job'));
  assert.equal(spy.calls[4].init?.method, 'POST');
  assert.ok(spy.calls[4].url.includes('/mesh/import-grant'));
  assert.deepEqual(importCalls, [
    { importGrantId: 'pvw_abc', fromOrigin: 'https://robots.example.com' },
  ]);
});

test('onExecute retries mesh only after successful PATCH (single PATCH call)', async () => {
  storeBootstrapAndAuth();
  const spy = installFetchMock([
    jsonResponse({
      order_id: 'order-123',
      revision: 3,
      requirements_document: '## doc',
      updated_at: '2026-08-27T05:00:00Z',
      package_type: 'urdf_stl',
    }),
    jsonResponse({
      revision: 4,
      requirements_document: '## doc\n## v4',
      change_summary: 'arm +5cm',
      updated_at: '2026-08-27T05:01:00Z',
    }),
    jsonResponse(
      {
        job_id: 'job-1',
        revision: 4,
        status: 'queued',
        external_job_id: 'ext-1',
      },
      202,
    ),
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'failed',
      attachment_id: null,
      package_type: 'urdf_stl',
      error_code: 'mesh_failed',
      error_message: 'boom',
    }),
    jsonResponse(
      {
        job_id: 'job-1',
        revision: 4,
        status: 'queued',
        external_job_id: 'ext-1',
      },
      202,
    ),
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'done',
      attachment_id: 'att-new',
      package_type: 'urdf_stl',
      error_code: null,
      error_message: null,
    }),
    jsonResponse({
      package_type: 'urdf_stl',
      import_grant_id: 'pvw_abc',
      from_origin: 'https://robots.example.com',
      expires_at: '2026-08-27T06:00:00Z',
      attachment_id: 'att-new',
    }),
  ]);

  const config = await createStudioModificationTools({
    lang: 'en',
    packageType: 'urdf_stl',
    importUrdfPackage: async () => {},
  });
  assert.ok(config);

  const toolCall = {
    toolName: 'propose_requirements_revision' as const,
    args: {
      change_summary: 'arm +5cm',
      section_updates: { 性能参数: '臂展 +5cm' },
      history_bullets: ['臂展 +5cm'],
    },
    summary: 'arm +5cm',
  };

  const first = await config.onExecute(toolCall);
  assert.equal(first.success, false);

  const second = await config.onExecute(toolCall);
  assert.equal(second.success, true);
  assert.equal(countPatchCalls(spy.calls), 1);
});

test('onExecute for regenerate_robot_model skips PATCH and runs mesh pipeline', async () => {
  storeBootstrapAndAuth();
  const importCalls: Array<{ importGrantId: string; fromOrigin: string }> = [];
  const spy = installFetchMock([
    jsonResponse(
      {
        job_id: 'job-1',
        revision: 4,
        status: 'queued',
        external_job_id: 'ext-1',
      },
      202,
    ),
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'done',
      attachment_id: 'att-new',
      package_type: 'urdf_stl',
      error_code: null,
      error_message: null,
    }),
    jsonResponse({
      package_type: 'urdf_stl',
      import_grant_id: 'pvw_abc',
      from_origin: 'https://robots.example.com',
      expires_at: '2026-08-27T06:00:00Z',
      attachment_id: 'att-new',
    }),
  ]);

  const config = await createStudioModificationTools({
    lang: 'en',
    packageType: 'urdf_stl',
    importUrdfPackage: async (params) => {
      importCalls.push(params);
    },
  });
  assert.ok(config);

  const result = await config.onExecute({
    toolName: 'regenerate_robot_model',
    args: { revision: 4 },
    summary: 'regenerate',
  });

  assert.equal(result.success, true);
  assert.equal(spy.calls.length, 3);
  assert.ok(spy.calls[0].url.includes('/mesh/regenerate'));
  assert.ok(spy.calls[1].url.includes('/mesh/job'));
  assert.ok(spy.calls[2].url.includes('/mesh/import-grant'));
  assert.equal(importCalls.length, 1);
});

test('onExecute maps revision_conflict 409 to a refresh message', async () => {
  storeBootstrapAndAuth();
  installFetchMock([
    jsonResponse({
      order_id: 'order-123',
      revision: 3,
      requirements_document: '## doc',
      updated_at: '2026-08-27T05:00:00Z',
      package_type: 'urdf_stl',
    }),
    jsonResponse({ error_code: 'revision_conflict', message: 'stale revision' }, 409),
  ]);

  const config = await createStudioModificationTools({
    lang: 'zh',
    packageType: 'urdf_stl',
    importUrdfPackage: async () => {},
  });
  assert.ok(config);

  const result = await config.onExecute({
    toolName: 'propose_requirements_revision',
    args: {
      change_summary: 'x',
      section_updates: { 背景: 'y' },
      history_bullets: ['y'],
    },
    summary: 'x',
  });

  assert.equal(result.success, false);
  assert.match(result.message, /刷新/);
});

test('onExecute maps duplicate_content 409 to a localized message', async () => {
  storeBootstrapAndAuth();
  installFetchMock([
    jsonResponse({
      order_id: 'order-123',
      revision: 3,
      requirements_document: '## doc',
      updated_at: '2026-08-27T05:00:00Z',
      package_type: 'urdf_stl',
    }),
    jsonResponse({ error_code: 'duplicate_content', message: 'dup' }, 409),
  ]);

  const config = await createStudioModificationTools({
    lang: 'zh',
    packageType: 'urdf_stl',
    importUrdfPackage: async () => {},
  });
  assert.ok(config);

  const result = await config.onExecute({
    toolName: 'propose_requirements_revision',
    args: {
      change_summary: 'x',
      section_updates: { 背景: 'y' },
      history_bullets: ['y'],
    },
    summary: 'x',
  });

  assert.equal(result.success, false);
  assert.match(result.message, /重复/);
});

test('onExecute surfaces failed mesh jobs', async () => {
  storeBootstrapAndAuth();
  installFetchMock([
    jsonResponse(
      {
        job_id: 'job-1',
        revision: 4,
        status: 'queued',
        external_job_id: 'ext-1',
      },
      202,
    ),
    jsonResponse({
      job_id: 'job-1',
      revision: 4,
      status: 'failed',
      attachment_id: null,
      package_type: 'urdf_stl',
      error_code: 'mesh_failed',
      error_message: 'boom',
    }),
  ]);

  const config = await createStudioModificationTools({
    lang: 'en',
    packageType: 'urdf_stl',
    importUrdfPackage: async () => {},
  });
  assert.ok(config);

  const result = await config.onExecute({
    toolName: 'regenerate_robot_model',
    args: { revision: 4 },
    summary: 'regenerate',
  });

  assert.equal(result.success, false);
  assert.equal(result.message, 'mesh_failed');
});

test('onExecute forwards AbortSignal to pollMeshJob', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  storeBootstrapAndAuth();
  const controller = new AbortController();
  installFetchMock(
    [
      jsonResponse(
        {
          job_id: 'job-1',
          revision: 4,
          status: 'queued',
          external_job_id: 'ext-1',
        },
        202,
      ),
      () =>
        jsonResponse({
          job_id: 'job-1',
          revision: 4,
          status: 'running',
          attachment_id: null,
          package_type: 'urdf_stl',
          error_code: null,
          error_message: null,
        }),
    ],
    { repeatLast: true },
  );

  const config = await createStudioModificationTools({
    lang: 'en',
    packageType: 'urdf_stl',
    signal: controller.signal,
    importUrdfPackage: async () => {},
  });
  assert.ok(config);

  const resultPromise = config.onExecute({
    toolName: 'regenerate_robot_model',
    args: { revision: 4 },
    summary: 'regenerate',
  });
  controller.abort();
  await drivePollUntilSettled(t, resultPromise, 2);
  const result = await resultPromise;

  assert.equal(result.success, false);
  assert.match(result.message, /取消|Cancelled|cancel/i);
});
