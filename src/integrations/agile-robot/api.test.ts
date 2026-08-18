import test, { afterEach, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  AgileRobotApiError,
  formatHunyuanJobFailure,
  hunyuanGetJob,
  hunyuanPollJob,
  hunyuanSubmit,
  isAgileRobotApiError,
  jimengEdit,
} from './api.ts';
import {
  BOOTSTRAP_STORAGE_KEY,
  HUNYUAN_POLL_INTERVAL_MS,
  HUNYUAN_POLL_TIMEOUT_MS,
} from './constants.ts';

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

// Node has no sessionStorage; install a jsdom one so the module under test can
// read/write it. Kept at module scope so all tests share one instance, cleared
// between tests below.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true,
});

type FetchCall = { url: string; init?: RequestInit };

/** A Response instance, or a factory producing a fresh one per call. Factories
 *  are required when the same logical body is read more than once (polling),
 *  since a Response body stream is consumed by the first json() read. */
type MockResponse = Response | (() => Response);

/**
 * Replace globalThis.fetch with a queue-based mock. Each call consumes the next
 * entry; with `repeatLast` the final entry is reused once the queue is empty
 * (for polling tests). Returns the captured calls for assertions.
 */
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

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Drive hunyuanPollJob's mocked timers until its promise settles. */
async function drivePollUntilSettled(
  t: TestContext,
  pollPromise: Promise<unknown>,
  maxTicks: number,
): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    await t.mock.timers.tick(HUNYUAN_POLL_INTERVAL_MS);
    // The poll loop resumes on a microtask after the mocked sleep fires; drain
    // the macrotask queue so the continuation runs before the next tick.
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

// ============================================================
// AgileRobotApiError / isAgileRobotApiError
// ============================================================

test('AgileRobotApiError carries name, status and body', () => {
  const error = new AgileRobotApiError('boom', 500, { detail: 'x' });
  assert.equal(error.name, 'AgileRobotApiError');
  assert.equal(error.status, 500);
  assert.deepEqual(error.body, { detail: 'x' });
  assert.ok(error instanceof Error);
});

test('AgileRobotApiError keeps body undefined when omitted', () => {
  const error = new AgileRobotApiError('boom', 500);
  assert.equal(error.body, undefined);
});

test('isAgileRobotApiError narrows only AgileRobotApiError instances', () => {
  assert.equal(isAgileRobotApiError(new AgileRobotApiError('x', 401)), true);
  assert.equal(isAgileRobotApiError(new Error('x')), false);
  assert.equal(isAgileRobotApiError('nope'), false);
  assert.equal(isAgileRobotApiError(null), false);
  assert.equal(isAgileRobotApiError({ status: 401 }), false);
});

test('isAgileRobotApiError matches the optional status', () => {
  assert.equal(isAgileRobotApiError(new AgileRobotApiError('x', 401), 401), true);
  assert.equal(isAgileRobotApiError(new AgileRobotApiError('x', 401), 500), false);
});

// ============================================================
// jimengEdit
// ============================================================

test('jimengEdit throws 401 when no bootstrap is stored', async () => {
  await assert.rejects(() => jimengEdit('prompt'), (error: unknown) => {
    if (!isAgileRobotApiError(error, 401)) return false;
    assert.match(error.message, /bootstrap/);
    return true;
  });
});

test('jimengEdit POSTs the prompt to the jimeng endpoint', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const spy = installFetchMock([
    jsonResponse({
      output_path: 'orders/order-123/out.png',
      bytes_count: 1000,
      task_id: 'task-1',
    }),
  ]);

  const result = await jimengEdit('{"subject":"..."}');

  assert.equal(result.output_path, 'orders/order-123/out.png');
  assert.equal(result.bytes_count, 1000);
  assert.equal(result.task_id, 'task-1');
  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/jimeng/edit'),
    `unexpected URL: ${url}`,
  );
  assert.ok(init, 'jimengEdit request should include init');
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(String(init.body)), { prompt: '{"subject":"..."}' });
});

test('jimengEdit includes source_path when provided', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const spy = installFetchMock([
    jsonResponse({ output_path: 'out.png', bytes_count: 1, task_id: 't' }),
  ]);

  await jimengEdit('prompt', 'orders/order-123/source.png');

  assert.deepEqual(JSON.parse(String(spy.calls[0].init?.body)), {
    prompt: 'prompt',
    source_path: 'orders/order-123/source.png',
  });
});

test('jimengEdit throws with status and body on a 401 response', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  installFetchMock([jsonResponse({ message: 'unauthorized' }, 401)]);

  await assert.rejects(() => jimengEdit('x'), (error: unknown) => {
    if (!isAgileRobotApiError(error, 401)) return false;
    assert.deepEqual(error.body, { message: 'unauthorized' });
    assert.equal(error.message, 'Agile Robot API error: 401');
    return true;
  });
});

test('jimengEdit leaves body undefined for a non-JSON error response', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  installFetchMock([new Response('boom', { status: 500 })]);

  await assert.rejects(() => jimengEdit('x'), (error: unknown) => {
    if (!isAgileRobotApiError(error, 500)) return false;
    assert.equal(error.body, undefined);
    return true;
  });
});

// ============================================================
// hunyuanSubmit
// ============================================================

test('hunyuanSubmit POSTs image_path to the submit endpoint', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const spy = installFetchMock([
    jsonResponse({ job_id: 'j1', status: 'pending', trigger_source: 'studio' }, 202),
  ]);

  const result = await hunyuanSubmit('orders/order-123/img.png');

  assert.equal(result.job_id, 'j1');
  assert.equal(result.status, 'pending');
  assert.equal(result.trigger_source, 'studio');
  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/hunyuan/submit'),
    `unexpected URL: ${url}`,
  );
  assert.ok(init, 'hunyuanSubmit request should include init');
  assert.equal(init.method, 'POST');
  assert.deepEqual(JSON.parse(String(init.body)), {
    image_path: 'orders/order-123/img.png',
  });
});

test('hunyuanSubmit omits image_path when not provided', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const spy = installFetchMock([
    jsonResponse({ job_id: 'j1', status: 'pending', trigger_source: 'studio' }, 202),
  ]);

  await hunyuanSubmit();

  assert.deepEqual(JSON.parse(String(spy.calls[0].init?.body)), {});
});

// ============================================================
// hunyuanGetJob
// ============================================================

test('hunyuanGetJob GETs the job endpoint', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const spy = installFetchMock([jsonResponse({ job_id: 'j1', status: 'running' })]);

  const result = await hunyuanGetJob();

  assert.equal(result.job_id, 'j1');
  assert.equal(result.status, 'running');
  assert.equal(spy.calls.length, 1);
  const { url, init } = spy.calls[0];
  assert.ok(
    url.includes('/me/projects/order-123/studio/hunyuan/job'),
    `unexpected URL: ${url}`,
  );
  assert.ok(init, 'hunyuanGetJob request should include init');
  assert.equal(init.method, 'GET');
  assert.deepEqual(init.headers, {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
  });
});

test('formatHunyuanJobFailure prefers error_code over error_message', () => {
  assert.equal(
    formatHunyuanJobFailure({
      job_id: 'j1',
      status: 'failed',
      error_code: 'E1',
      error_message: 'boom',
    }),
    'E1',
  );
  assert.equal(
    formatHunyuanJobFailure({
      job_id: 'j1',
      status: 'failed',
      error_message: 'boom',
    }),
    'boom',
  );
  assert.equal(
    formatHunyuanJobFailure({ job_id: 'j1', status: 'failed' }),
    '3D 生成失败',
  );
});

// ============================================================
// hunyuanPollJob
// ============================================================

test('hunyuanPollJob returns immediately when the job is already done', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const spy = installFetchMock([
    jsonResponse({
      job_id: 'j1',
      status: 'done',
      preview_url: 'https://cdn.example/preview.png',
    }),
  ]);

  const result = await hunyuanPollJob();

  assert.equal(result.status, 'done');
  assert.equal(result.preview_url, 'https://cdn.example/preview.png');
  assert.equal(spy.calls.length, 1);
});

test('hunyuanPollJob returns immediately when the job failed', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  installFetchMock([
    jsonResponse({ job_id: 'j1', status: 'failed', error_code: 'E1', error_message: 'boom' }),
  ]);

  const result = await hunyuanPollJob();

  assert.equal(result.status, 'failed');
  assert.equal(result.error_code, 'E1');
  assert.equal(result.error_message, 'boom');
});

test('hunyuanPollJob polls across intervals until done', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const spy = installFetchMock([
    jsonResponse({ job_id: 'j1', status: 'running' }),
    jsonResponse({ job_id: 'j1', status: 'pending' }),
    jsonResponse({ job_id: 'j1', status: 'done' }),
  ]);

  const pollPromise = hunyuanPollJob();
  await drivePollUntilSettled(t, pollPromise, 20);

  const result = await pollPromise;
  assert.equal(result.status, 'done');
  assert.equal(spy.calls.length, 3);
});

test('hunyuanPollJob throws 408 when polling exceeds the timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  installFetchMock(
    [() => jsonResponse({ job_id: 'j1', status: 'pending' })],
    { repeatLast: true },
  );

  const pollPromise = hunyuanPollJob();
  const maxTicks = Math.ceil(HUNYUAN_POLL_TIMEOUT_MS / HUNYUAN_POLL_INTERVAL_MS) + 2;
  await drivePollUntilSettled(t, pollPromise, maxTicks);

  await assert.rejects(
    pollPromise,
    (error: unknown) =>
      isAgileRobotApiError(error, 408) &&
      /超时/.test(error.message),
  );
});

test('hunyuanPollJob throws when the signal is already aborted', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const spy = installFetchMock([]);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() => hunyuanPollJob(controller.signal), (error: unknown) => {
    if (!isAgileRobotApiError(error)) return false;
    assert.equal(error.status, 0);
    assert.match(error.message, /aborted/i);
    return true;
  });

  assert.equal(spy.calls.length, 0);
});
