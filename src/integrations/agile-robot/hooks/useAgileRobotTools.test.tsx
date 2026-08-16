import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { useAgileRobotTools } from './useAgileRobotTools.ts';
import { BOOTSTRAP_STORAGE_KEY } from '../constants.ts';
import { useAssetsStore } from '@/store';
import type { MeshReloadImportPort } from '../meshReload.ts';
import type { AIConversationToolsConfig, ParsedToolCall } from '../types.ts';

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

// Node has no sessionStorage/document; install a jsdom one so the hook under
// test can read sessionStorage and React can render. Kept at module scope so
// all tests share one instance, cleared between tests below.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, 'window', {
  value: dom.window,
  configurable: true,
});
Object.defineProperty(globalThis, 'document', {
  value: dom.window.document,
  configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true,
});
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

type FetchCall = { url: string; init?: RequestInit };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** Replace globalThis.fetch with a queue-based mock. Each call consumes the
 *  next entry; a call past the end of the queue throws. */
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

beforeEach(() => {
  sessionStorage.clear();
  useAssetsStore.getState().clearAssets();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Build a MeshReloadImportPort that records the GLB files routed to it. */
function createReloadMeshSpy(): { port: MeshReloadImportPort; imported: File[] } {
  const imported: File[] = [];
  const port: MeshReloadImportPort = {
    importMeshFile: async (file: File) => {
      imported.push(file);
    },
  };
  return { port, imported };
}

/** Render the hook inside a React root so useCallback/useRef have a dispatcher. */
async function renderHook(options: Parameters<typeof useAgileRobotTools>[0]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let current: AIConversationToolsConfig | null | undefined;

  function Probe() {
    current = useAgileRobotTools(options);
    return null;
  }

  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    get current() {
      assert.notEqual(current, undefined, 'hook should have rendered');
      return current as AIConversationToolsConfig | null;
    },
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const editToolCall = (prompt = '{"subject":"改色"}'): ParsedToolCall => ({
  toolName: 'edit_robot_appearance',
  args: { prompt },
  summary: '改色',
});

const regenerateToolCall: ParsedToolCall = {
  toolName: 'regenerate_robot_3d',
  args: {},
  summary: '重新生成 3D 模型',
};

// ============================================================
// Config availability (bootstrap gating)
// ============================================================

const defaultHookOptions = { lang: 'zh' as const };

test('returns null when no bootstrap is stored', async () => {
  const rendered = await renderHook(defaultHookOptions);
  assert.equal(rendered.current, null);
  await rendered.cleanup();
});

test('returns tools config when a valid bootstrap is stored', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);
  assert.equal(config!.tools.length, 2);
  assert.equal(config!.tools[0]!.function.name, 'edit_robot_appearance');
  assert.ok(
    config!.tools[0]!.function.description.includes('subject'),
    'edit tool description should include the structured JSON prompt instructions',
  );
  assert.equal(config!.tools[1]!.function.name, 'regenerate_robot_3d');
  await rendered.cleanup();
});

// ============================================================
// parseToolCalls
// ============================================================

test('parseToolCalls extracts structured tool call and subject summary', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  const result = config!.parseToolCalls([
    {
      function: {
        name: 'edit_robot_appearance',
        arguments: '{"prompt":"{\\"subject\\":\\"改为橙色\\"}"}',
      },
    },
  ]);

  assert.notEqual(result, null);
  assert.equal(result!.toolName, 'edit_robot_appearance');
  assert.deepEqual(result!.args, { prompt: '{"subject":"改为橙色"}' });
  assert.equal(result!.summary, '改为橙色');
  await rendered.cleanup();
});

test('parseToolCalls returns null for an empty tool_calls array', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  assert.equal(config!.parseToolCalls([]), null);
  await rendered.cleanup();
});

test('parseToolCalls returns null for invalid JSON arguments', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  const result = config!.parseToolCalls([
    { function: { name: 'edit_robot_appearance', arguments: '{not json' } },
  ]);

  assert.equal(result, null);
  await rendered.cleanup();
});

test('parseToolCalls returns null when arguments parse to a non-object value', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  const nullResult = config!.parseToolCalls([
    { function: { name: 'edit_robot_appearance', arguments: 'null' } },
  ]);
  const scalarResult = config!.parseToolCalls([
    { function: { name: 'edit_robot_appearance', arguments: '123' } },
  ]);

  assert.equal(nullResult, null, 'null arguments should not be treated as a tool call');
  assert.equal(scalarResult, null, 'scalar arguments should not be treated as a tool call');
  await rendered.cleanup();
});


test('parseToolCalls returns null when the tool name is missing', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  const result = config!.parseToolCalls([
    { function: { name: '', arguments: '{}' } },
  ]);

  assert.equal(result, null);
  await rendered.cleanup();
});

test('parseToolCalls truncates a long subject summary at 50 chars', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  const longSubject = '长'.repeat(60);
  const result = config!.parseToolCalls([
    {
      function: {
        name: 'edit_robot_appearance',
        arguments: JSON.stringify({ prompt: JSON.stringify({ subject: longSubject }) }),
      },
    },
  ]);

  assert.notEqual(result, null);
  assert.equal(result!.summary, '长'.repeat(50) + '…');
  await rendered.cleanup();
});

test('parseToolCalls falls back to the raw prompt when prompt is not JSON', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  const longPrompt = 'x'.repeat(60);
  const result = config!.parseToolCalls([
    {
      function: {
        name: 'edit_robot_appearance',
        arguments: JSON.stringify({ prompt: longPrompt }),
      },
    },
  ]);

  assert.notEqual(result, null);
  assert.equal(result!.summary, 'x'.repeat(50) + '…');
  await rendered.cleanup();
});

test('parseToolCalls summarizes regenerate_robot_3d with localized label', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const renderedZh = await renderHook(defaultHookOptions);
  const configZh = renderedZh.current;
  assert.notEqual(configZh, null);

  const zhResult = configZh!.parseToolCalls([
    { function: { name: 'regenerate_robot_3d', arguments: '{}' } },
  ]);

  assert.notEqual(zhResult, null);
  assert.equal(zhResult!.summary, '重新生成 3D 模型');
  await renderedZh.cleanup();

  const renderedEn = await renderHook({ lang: 'en' });
  const configEn = renderedEn.current;
  assert.notEqual(configEn, null);

  const enResult = configEn!.parseToolCalls([
    { function: { name: 'regenerate_robot_3d', arguments: '{}' } },
  ]);

  assert.notEqual(enResult, null);
  assert.equal(enResult!.summary, 'Regenerate 3D model');
  await renderedEn.cleanup();
});

test('parseToolCalls summarizes unknown tools as the tool name', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  const result = config!.parseToolCalls([
    { function: { name: 'some_other_tool', arguments: '{}' } },
  ]);

  assert.notEqual(result, null);
  assert.equal(result!.summary, 'some_other_tool');
  await rendered.cleanup();
});

// ============================================================
// onExecute error mapping
// ============================================================

test('onExecute reports session expired when bootstrap disappears before execution', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  sessionStorage.clear();

  const result = await config!.onExecute(editToolCall());

  assert.equal(result.success, false);
  assert.match(result.message, /会话已过期/);
  await rendered.cleanup();
});

test('onExecute maps a 401 API error to session-expired', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  installFetchMock([jsonResponse({ message: 'unauthorized' }, 401)]);

  const result = await config!.onExecute(editToolCall());

  assert.equal(result.success, false);
  assert.match(result.message, /会话已过期/);
  await rendered.cleanup();
});

test('onExecute maps a 409 API error to job-in-progress', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  installFetchMock([jsonResponse({ message: 'conflict' }, 409)]);

  const result = await config!.onExecute(editToolCall());

  assert.equal(result.success, false);
  assert.match(result.message, /正在进行中/);
  await rendered.cleanup();
});

test('onExecute propagates the API error message for other statuses', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  installFetchMock([jsonResponse({ message: 'boom' }, 500)]);

  const result = await config!.onExecute(editToolCall());

  assert.equal(result.success, false);
  assert.match(result.message, /Agile Robot API error: 500/);
  await rendered.cleanup();
});

test('onExecute returns unknown-tool message for an unhandled tool', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  const result = await config!.onExecute({
    toolName: 'some_other_tool',
    args: {},
    summary: 'some_other_tool',
  });

  assert.equal(result.success, false);
  assert.match(result.message, /未知工具/);
  await rendered.cleanup();
});

// ============================================================
// onExecute pipelines
// ============================================================

test('onExecute edit_robot_appearance runs jimeng → hunyuan → mesh reload', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const { port, imported } = createReloadMeshSpy();
  const rendered = await renderHook({ ...defaultHookOptions, reloadMesh: port });
  const config = rendered.current;
  assert.notEqual(config, null);

  const spy = installFetchMock([
    jsonResponse({ output_path: 'orders/order-123/out.png', bytes_count: 1, task_id: 't1' }),
    jsonResponse({ job_id: 'j1', status: 'pending', trigger_source: 'studio' }, 202),
    jsonResponse({
      job_id: 'j1',
      status: 'done',
      preview_url: 'https://cdn.example/preview.png',
    }),
    new Response(new Blob(['glb']), { status: 200 }),
  ]);

  const result = await config!.onExecute(editToolCall());

  assert.equal(result.success, true);
  assert.equal(result.message, '3D 模型已更新');
  assert.equal(spy.calls.length, 4);
  assert.equal(imported.length, 1, 'expected the regenerated GLB to be routed through the reload port');
  assert.equal(imported[0]?.name, 'updated_model.glb');
  await rendered.cleanup();
});

test('onExecute regenerate_robot_3d runs hunyuan → mesh reload', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const { port, imported } = createReloadMeshSpy();
  const rendered = await renderHook({ ...defaultHookOptions, reloadMesh: port });
  const config = rendered.current;
  assert.notEqual(config, null);

  const spy = installFetchMock([
    jsonResponse({ job_id: 'j1', status: 'pending', trigger_source: 'studio' }, 202),
    jsonResponse({
      job_id: 'j1',
      status: 'done',
      preview_url: 'https://cdn.example/preview.png',
    }),
    new Response(new Blob(['glb']), { status: 200 }),
  ]);

  const result = await config!.onExecute(regenerateToolCall);

  assert.equal(result.success, true);
  assert.equal(result.message, '3D 模型已更新');
  assert.equal(spy.calls.length, 3);
  assert.equal(imported.length, 1, 'expected the regenerated GLB to be routed through the reload port');
  await rendered.cleanup();
});

test('onExecute reports the job error message when the job fails', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const rendered = await renderHook(defaultHookOptions);
  const config = rendered.current;
  assert.notEqual(config, null);

  installFetchMock([
    jsonResponse({ output_path: 'orders/order-123/out.png', bytes_count: 1, task_id: 't1' }),
    jsonResponse({ job_id: 'j1', status: 'pending', trigger_source: 'studio' }, 202),
    jsonResponse({
      job_id: 'j1',
      status: 'failed',
      error_message: '生成失败：模型解析错误',
    }),
  ]);

  const result = await config!.onExecute(editToolCall());

  assert.equal(result.success, false);
  assert.equal(result.message, '生成失败：模型解析错误');
  await rendered.cleanup();
});

test('onExecute propagates a generic error message when the mesh reload fails', async () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const { port } = createReloadMeshSpy();
  const rendered = await renderHook({ ...defaultHookOptions, reloadMesh: port });
  const config = rendered.current;
  assert.notEqual(config, null);

  installFetchMock([
    jsonResponse({ output_path: 'orders/order-123/out.png', bytes_count: 1, task_id: 't1' }),
    jsonResponse({ job_id: 'j1', status: 'pending', trigger_source: 'studio' }, 202),
    jsonResponse({
      job_id: 'j1',
      status: 'done',
      preview_url: 'https://cdn.example/preview.png',
    }),
    new Response('boom', { status: 500 }),
  ]);

  const result = await config!.onExecute(editToolCall());

  assert.equal(result.success, false);
  assert.match(result.message, /Failed to fetch mesh/);
  await rendered.cleanup();
});
