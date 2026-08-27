import test, { afterEach, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { GeometryType, JointType, type RobotState } from '@/types';

import {
  CONVERSATION_SNAPSHOT_SYNC_DEBOUNCE_MS,
  useConversationSession,
  type ConversationSessionApi,
} from './useConversationSession.ts';

const createRobotFixture = (): RobotState => ({
  name: 'chat-fixture',
  rootLinkId: 'base_link',
  links: {
    base_link: {
      id: 'base_link',
      name: 'base_link',
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 0.4, y: 0.2, z: 0.1 },
        color: '#9ca3af',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      collision: {
        type: GeometryType.BOX,
        dimensions: { x: 0.4, y: 0.2, z: 0.1 },
        color: '#9ca3af',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      inertial: {
        mass: 2.5,
        inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
      },
    },
  },
  joints: {
    hip_joint: {
      id: 'hip_joint',
      name: 'hip_joint',
      type: JointType.REVOLUTE,
      parentLinkId: 'world',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0.1, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 1, z: 0 },
      limit: { lower: -1, upper: 1, effort: 20, velocity: 10 },
      dynamics: { damping: 0.1, friction: 0.1 },
      hardware: { armature: 0.03, motorType: 'servo', motorId: 'M1', motorDirection: 1 },
    },
  },
});

type HookValue = ReturnType<typeof useConversationSession>;

interface RenderedHook {
  current: HookValue;
  rerender: (props?: Partial<Parameters<typeof useConversationSession>[0]>) => void;
  unmount: () => void;
}

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    writable: true,
    value: dom.window.Node,
  });
}

function renderHook(
  options: Parameters<typeof useConversationSession>[0],
): RenderedHook {
  const container = document.getElementById('root');
  assert.ok(container);

  const hookValue: { current: HookValue | null } = { current: null };
  let currentOptions = options;
  let root: Root | null = createRoot(container);

  function Probe() {
    hookValue.current = useConversationSession(currentOptions);
    return null;
  }

  act(() => {
    root!.render(React.createElement(Probe));
  });

  assert.ok(hookValue.current);

  return {
    get current() {
      assert.ok(hookValue.current);
      return hookValue.current;
    },
    rerender: (overrides = {}) => {
      currentOptions = { ...currentOptions, ...overrides };
      act(() => {
        root!.render(React.createElement(Probe));
      });
      assert.ok(hookValue.current);
    },
    unmount: () => {
      act(() => {
        root?.unmount();
        root = null;
      });
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  });
}

async function advanceDebounce(t: TestContext, ms = CONVERSATION_SNAPSHOT_SYNC_DEBOUNCE_MS): Promise<void> {
  await act(async () => {
    await t.mock.timers.tick(ms);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  });
}

function createMockApi(): {
  api: ConversationSessionApi;
  createCalls: number;
  syncCalls: Array<{ sessionId: string; payload: unknown }>;
} {
  const createCalls = { count: 0 };
  const syncCalls: Array<{ sessionId: string; payload: unknown }> = [];

  const api: ConversationSessionApi = {
    createConversationSession: async () => {
      createCalls.count += 1;
      return {
        sessionId: `sess-${createCalls.count}`,
        expiresAt: '2026-08-27T10:00:00Z',
      };
    },
    syncConversationSnapshot: async (sessionId, payload) => {
      syncCalls.push({ sessionId, payload });
    },
  };

  return {
    api,
    get createCalls() {
      return createCalls.count;
    },
    syncCalls,
  };
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;
const originalNode = globalThis.Node;

beforeEach(() => {
  installDomEnvironment();
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
  if (originalHTMLElement === undefined) {
    delete globalThis.HTMLElement;
  } else {
    globalThis.HTMLElement = originalHTMLElement;
  }
  if (originalNode === undefined) {
    delete globalThis.Node;
  } else {
    globalThis.Node = originalNode;
  }
});

test('useConversationSession creates a session on mount', async () => {
  const mock = createMockApi();
  const hook = renderHook({ lang: 'zh', api: mock.api });

  await flushMicrotasks();

  assert.equal(mock.createCalls, 1);
  assert.equal(hook.current.sessionId, 'sess-1');
});

test('useConversationSession does not recreate session on rerender', async () => {
  const mock = createMockApi();
  const hook = renderHook({ lang: 'zh', api: mock.api });

  await flushMicrotasks();
  assert.equal(mock.createCalls, 1);

  hook.rerender({ lang: 'zh', api: mock.api });
  await flushMicrotasks();

  assert.equal(mock.createCalls, 1);
});

test('useConversationSession debounces syncSnapshot and increments snapshot_revision', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mock = createMockApi();
  const hook = renderHook({ lang: 'zh', api: mock.api });
  await flushMicrotasks();

  const robot = createRobotFixture();
  act(() => {
    hook.current.syncSnapshot({ mode: 'general', robot });
  });
  assert.equal(mock.syncCalls.length, 0);

  act(() => {
    hook.current.syncSnapshot({
      mode: 'general',
      robot: { ...robot, name: 'chat-fixture-v2' },
    });
  });
  assert.equal(mock.syncCalls.length, 0);

  await advanceDebounce(t);

  assert.equal(mock.syncCalls.length, 1);
  assert.equal(mock.syncCalls[0]?.sessionId, 'sess-1');
  const firstPayload = mock.syncCalls[0]?.payload as { snapshot_revision: number; snapshot: { robot: { name: string } } };
  assert.equal(firstPayload.snapshot_revision, 1);
  assert.equal(firstPayload.snapshot.robot.name, 'chat-fixture-v2');

  act(() => {
    hook.current.syncSnapshot({
      mode: 'general',
      robot: { ...robot, name: 'chat-fixture-v3' },
    });
  });
  await advanceDebounce(t);

  assert.equal(mock.syncCalls.length, 2);
  const secondPayload = mock.syncCalls[1]?.payload as { snapshot_revision: number; snapshot: { robot: { name: string } } };
  assert.equal(secondPayload.snapshot_revision, 2);
  assert.equal(secondPayload.snapshot.robot.name, 'chat-fixture-v3');
});

test('useConversationSession ensureSynced flushes pending debounced sync immediately', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mock = createMockApi();
  const hook = renderHook({ lang: 'zh', api: mock.api });
  await flushMicrotasks();

  act(() => {
    hook.current.syncSnapshot({ mode: 'general', robot: createRobotFixture() });
  });

  await act(async () => {
    await hook.current.ensureSynced();
  });

  assert.equal(mock.syncCalls.length, 1);
  const payload = mock.syncCalls[0]?.payload as { snapshot_revision: number };
  assert.equal(payload.snapshot_revision, 1);
});

test('useConversationSession resetSession POSTs a new session and resets revision counter', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mock = createMockApi();
  const hook = renderHook({ lang: 'zh', api: mock.api });
  await flushMicrotasks();

  act(() => {
    hook.current.syncSnapshot({ mode: 'general', robot: createRobotFixture() });
  });
  await advanceDebounce(t);
  assert.equal(mock.syncCalls.length, 1);

  await act(async () => {
    await hook.current.resetSession();
  });

  assert.equal(mock.createCalls, 2);
  assert.equal(hook.current.sessionId, 'sess-2');

  act(() => {
    hook.current.syncSnapshot({
      mode: 'general',
      robot: { ...createRobotFixture(), name: 'after-reset' },
    });
  });
  await advanceDebounce(t);

  assert.equal(mock.syncCalls.length, 2);
  const payload = mock.syncCalls[1]?.payload as {
    snapshot_revision: number;
    snapshot: { robot: { name: string } };
  };
  assert.equal(mock.syncCalls[1]?.sessionId, 'sess-2');
  assert.equal(payload.snapshot_revision, 1);
  assert.equal(payload.snapshot.robot.name, 'after-reset');
});
