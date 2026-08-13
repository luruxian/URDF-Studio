import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import OpenAI from 'openai';

import { createSingleComponentWorkspace } from '@/core/robot';
import { __setAgentOpenAIClientFactoryForTests } from '../services/aiAgent';
import { DEFAULT_MANAGED_WINDOW_ORDER, useSelectionStore, useUIStore, useWorkspaceStore } from '@/store';
import { GeometryType, JointType, type RobotState } from '@/types';
import type { AIConversationToolsConfig, ParsedToolCall } from '@/integrations/agile-robot/types';
import type { AIConversationLaunchContext } from '../types';
import { buildConversationPromptSuggestions } from '../utils/conversationPromptSuggestions';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: dom.window.sessionStorage,
    configurable: true,
  });
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement;
  (globalThis as { HTMLTextAreaElement?: typeof HTMLTextAreaElement }).HTMLTextAreaElement =
    dom.window.HTMLTextAreaElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  }

  if (!('attachEvent' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
      value: () => {},
      configurable: true,
    });
  }

  if (!('detachEvent' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
      value: () => {},
      configurable: true,
    });
  }

  if (!dom.window.HTMLTextAreaElement.prototype.setSelectionRange) {
    dom.window.HTMLTextAreaElement.prototype.setSelectionRange = () => {};
  }

  return dom;
}

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

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
  inspectionContext: undefined,
  selection: { type: 'link', id: 'base_link' },
});

const createLaunchContext = (): AIConversationLaunchContext => ({
  sessionId: 1,
  mode: 'general',
  robotSnapshot: createRobotFixture(),
  inspectionReportSnapshot: null,
  selectedEntity: null,
  focusedIssue: null,
});

const findButtonByText = (scope: ParentNode, text: string): HTMLButtonElement => {
  const match = Array.from(scope.querySelectorAll('button')).find((button) =>
    button.textContent?.trim().includes(text),
  );
  assert.ok(match, `expected button containing "${text}"`);
  return match as HTMLButtonElement;
};

const getTextarea = (scope: ParentNode): HTMLTextAreaElement => {
  const textarea = scope.querySelector('textarea');
  assert.ok(textarea, 'expected textarea to render');
  return textarea as HTMLTextAreaElement;
};

const getCopyButtons = (scope: ParentNode): HTMLButtonElement[] =>
  Array.from(scope.querySelectorAll('button')).filter(
    (button) => button.getAttribute('aria-label') === '复制到剪贴板',
  ) as HTMLButtonElement[];

const clickButton = async (button: HTMLButtonElement) => {
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};

const API_KEY_ENV_NAMES = ['API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'] as const;

const captureApiKeyEnv = (): Record<(typeof API_KEY_ENV_NAMES)[number], string | undefined> => ({
  API_KEY: process.env.API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
});

const restoreApiKeyEnv = (
  snapshot: Record<(typeof API_KEY_ENV_NAMES)[number], string | undefined>,
) => {
  for (const envName of API_KEY_ENV_NAMES) {
    const value = snapshot[envName];
    if (value === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = value;
    }
  }
};

const setDirectAiEnv = () => {
  const apiKeySnapshot = captureApiKeyEnv();
  const previousBackendUrl = process.env.AI_BACKEND_URL;
  delete process.env.API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_BACKEND_URL;
  return { apiKeySnapshot, previousBackendUrl };
};

const restoreDirectAiEnv = (env: ReturnType<typeof setDirectAiEnv>) => {
  restoreApiKeyEnv(env.apiKeySnapshot);
  if (env.previousBackendUrl === undefined) {
    delete process.env.AI_BACKEND_URL;
  } else {
    process.env.AI_BACKEND_URL = env.previousBackendUrl;
  }
};

const createToolsConfig = (
  overrides?: Partial<AIConversationToolsConfig>,
): AIConversationToolsConfig => ({
  tools: [
    {
      type: 'function',
      function: {
        name: 'edit_appearance',
        description: '改图',
        parameters: { type: 'object', properties: { prompt: { type: 'string' } } },
      },
    },
  ],
  parseToolCalls: (calls) => {
    const named = calls.find((call) => call.function.name === 'edit_appearance');
    return named
      ? { toolName: 'edit_appearance', args: {}, summary: '将机身改成橙色' }
      : null;
  },
  onExecute: async () => ({ success: true, message: '改图任务已提交' }),
  ...overrides,
});

const TOOL_CALL_STREAM_CHUNKS: Array<Record<string, unknown>> = [
  {
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', function: { name: 'edit_appearance' } },
          ],
        },
      },
    ],
  },
  {
    choices: [
      {
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"prompt":"把机身改成橙色"}' } }] },
      },
    ],
  },
  { choices: [{ finish_reason: 'tool_calls' }] },
];

const PLAIN_REPLY_CHUNKS: Array<Record<string, unknown>> = [
  { choices: [{ delta: { content: '好的，已为你处理' } }] },
  { choices: [{ finish_reason: 'stop' }] },
];

const installOpenAICreateMockSequence = (sequence: Array<Array<Record<string, unknown>>>) => {
  const originalCreate = OpenAI.Chat.Completions.prototype.create;
  let capturedTools: unknown;
  let index = 0;

  OpenAI.Chat.Completions.prototype.create = async function mockCreate(
    this: unknown,
    params: { tools?: unknown },
  ) {
    capturedTools = params.tools;
    const chunks = sequence[index] ?? [];
    index += 1;
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    } as AsyncIterable<unknown>;
  } as unknown as typeof OpenAI.Chat.Completions.prototype.create;

  return {
    capturedTools: () => capturedTools,
    restore: () => {
      OpenAI.Chat.Completions.prototype.create = originalCreate;
    },
  };
};

const installOpenAICreateMock = (chunks: Array<Record<string, unknown>>) =>
  installOpenAICreateMockSequence([chunks]);

const sendFirstPrompt = async (container: ParentNode) => {
  const [firstPrompt] = buildConversationPromptSuggestions({
    lang: 'zh',
    isReportFollowup: false,
    selectedEntityName: null,
  });
  assert.ok(firstPrompt, 'expected at least one prompt suggestion');
  await clickButton(findButtonByText(container, firstPrompt));
};

const typeAndSend = async (container: ParentNode, text: string) => {
  const textarea = getTextarea(container);
  const prototype = textarea.ownerDocument.defaultView?.HTMLTextAreaElement.prototype;
  const valueSetter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    : undefined;
  assert.ok(valueSetter, 'HTMLTextAreaElement value setter should exist');

  const reactPropsKey = Object.keys(textarea).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'React props key should exist on rendered textarea');
  const reactProps = (textarea as unknown as Record<string, unknown>)[
    reactPropsKey
  ] as Record<string, unknown>;
  assert.equal(typeof reactProps.onChange, 'function', 'React onChange handler should exist');

  await act(async () => {
    valueSetter.call(textarea, text);
    (
      reactProps.onChange as (event: {
        target: HTMLTextAreaElement;
        currentTarget: HTMLTextAreaElement;
      }) => void
    )({ target: textarea, currentTarget: textarea });
  });
  await clickButton(findButtonByText(container, '发送'));
};

test('AIConversationModal opens at the front and remains front when activated', async () => {
  const previousApiKey = process.env.API_KEY;
  process.env.API_KEY = '';
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);
  const initialState = useUIStore.getState();

  try {
    useUIStore.setState({
      managedWindowOrder: [...DEFAULT_MANAGED_WINDOW_ORDER],
    });

    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="en"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });

    const initialZIndex = String(useUIStore.getState().getManagedWindowZIndex('aiConversation'));
    const windowRoot = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find(
      (element) => element.style.zIndex === initialZIndex,
    );
    assert.ok(windowRoot, 'conversation window should render with dynamic z-index');
    assert.equal(windowRoot.className.includes('z-[110]'), false);
    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('aiConversation') >
        useUIStore.getState().getManagedWindowZIndex('sourceCode'),
      'opened AI conversation window should start above source code',
    );

    await act(async () => {
      windowRoot.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    });

    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('aiConversation') >
        useUIStore.getState().getManagedWindowZIndex('sourceCode'),
      'activated AI conversation window should move above source code',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState(initialState);
    process.env.API_KEY = previousApiKey;
    dom.window.close();
  }
});

test('compact conversation layout fits the viewport and keeps content scrollable', async () => {
  const dom = installDom();
  Object.defineProperty(dom.window, 'innerWidth', { value: 613, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 618, configurable: true });
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const windowRoot = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find(
      (element) => element.style.width === '589px' && element.style.height === '554px',
    );
    assert.ok(windowRoot, 'expected the compact conversation window to fit inside the viewport');

    const scrollViewport = container.querySelector<HTMLElement>(
      '[data-ai-conversation-scroll-viewport]',
    );
    assert.ok(scrollViewport, 'expected a dedicated conversation scroll viewport');
    assert.equal(scrollViewport.className.includes('overflow-y-auto'), true);

    const emptyState = scrollViewport.firstElementChild as HTMLElement | null;
    assert.ok(emptyState, 'expected the prompt suggestions to render');
    assert.equal(emptyState.className.includes('justify-start'), true);

    const textarea = getTextarea(container);
    assert.equal(textarea.className.includes('min-h-[64px]'), true);
    assert.equal(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="新开对话"]')
        ?.textContent?.trim(),
      '',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('new conversation requires confirmation, preserves history, and inserts a divider', async () => {
  const previousApiKey = process.env.API_KEY;
  process.env.API_KEY = '';
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);
  const onStartNewConversationCalls: AIConversationLaunchContext[] = [];
  const launchContext = createLaunchContext();

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={launchContext}
          onStartNewConversation={(context) => {
            onStartNewConversationCalls.push(context);
          }}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const [firstMessage] = buildConversationPromptSuggestions({
      lang: 'zh',
      isReportFollowup: false,
      selectedEntityName: null,
    });
    assert.ok(firstMessage, 'expected at least one prompt suggestion');
    await clickButton(findButtonByText(container, firstMessage));
    await flush();

    assert.equal(container.textContent?.includes(firstMessage), true);
    assert.equal(getCopyButtons(container).length > 0, true);

    await clickButton(findButtonByText(container, '新开对话'));
    await flush();

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected confirmation dialog to open');
    assert.equal(confirmDialog.textContent?.includes('开始新对话？'), true);
    assert.equal(confirmDialog.textContent?.includes('后续回复将不再参考之前的对话内容'), true);

    await clickButton(findButtonByText(confirmDialog, '新开对话'));
    await flush();

    assert.equal(onStartNewConversationCalls.length, 1);
    assert.equal(onStartNewConversationCalls[0], launchContext);
    assert.equal(getTextarea(container).value, '');
    assert.equal(container.textContent?.includes(firstMessage), true);
    assert.equal(container.textContent?.includes('新对话从这里开始'), true);
    assert.equal(getCopyButtons(container).length > 0, true);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('clear history requires confirmation and removes prior messages after reset', async () => {
  const previousApiKey = process.env.API_KEY;
  process.env.API_KEY = '';
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);
  const launchContext = createLaunchContext();
  let startNewConversationCount = 0;

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={launchContext}
          onStartNewConversation={() => {
            startNewConversationCount += 1;
          }}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const [sentMessage] = buildConversationPromptSuggestions({
      lang: 'zh',
      isReportFollowup: false,
      selectedEntityName: null,
    });
    assert.ok(sentMessage, 'expected at least one prompt suggestion');
    await clickButton(findButtonByText(container, sentMessage));
    await flush();

    assert.equal(container.textContent?.includes(sentMessage), true);
    assert.equal(getCopyButtons(container).length > 0, true);

    await clickButton(findButtonByText(container, '清除历史'));
    await flush();

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected confirmation dialog to open');
    assert.equal(confirmDialog.textContent?.includes('清空当前对话记录？'), true);
    assert.equal(
      confirmDialog.textContent?.includes('这会清空窗口中的对话记录，并重置当前问答上下文'),
      true,
    );

    await clickButton(findButtonByText(confirmDialog, '清除历史'));
    await flush();

    assert.equal(startNewConversationCount, 0);
    assert.equal(getTextarea(container).value, '');
    assert.equal(getCopyButtons(container).length, 0);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('missing API key surfaces a real assistant reply instead of a banner', async () => {
  const envSnapshot = {
    API_KEY: process.env.API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  delete process.env.API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const [firstPrompt] = buildConversationPromptSuggestions({
      lang: 'zh',
      isReportFollowup: false,
      selectedEntityName: null,
    });
    assert.ok(firstPrompt, 'expected at least one prompt suggestion');

    await clickButton(findButtonByText(container, firstPrompt));
    await flush();

    // Agent (no key) throws -> falls back to generateRobotFromPrompt, which returns
    // the apiKeyMissing advice as a real assistant message (no danger banner).
    assert.equal(container.textContent?.includes(firstPrompt), true);
    assert.match(container.textContent || '', /API Key/i);
    assert.equal(container.textContent?.includes('对话服务错误：'), false);
    assert.equal(getCopyButtons(container).length, 2);
    assert.equal(findButtonByText(container, '重新生成').textContent?.includes('重新生成'), true);
  } finally {
    if (envSnapshot.API_KEY === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = envSnapshot.API_KEY;
    }

    if (envSnapshot.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = envSnapshot.OPENAI_API_KEY;
    }

    if (envSnapshot.GEMINI_API_KEY === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = envSnapshot.GEMINI_API_KEY;
    }

    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('transparent AI conversation backdrop does not intercept pointer events', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0');
    assert.ok(backdrop, 'expected transparent backdrop to render');
    assert.equal(
      backdrop.classList.contains('pointer-events-none'),
      true,
      'transparent backdrop should not block interactions with the workspace',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('suggested prompts expose hover and focus border highlight styles', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const [firstPrompt] = buildConversationPromptSuggestions({
      lang: 'zh',
      isReportFollowup: false,
      selectedEntityName: null,
    });
    assert.ok(firstPrompt, 'expected at least one prompt suggestion');

    const promptButton = findButtonByText(container, firstPrompt);
    const newConversationButton = findButtonByText(container, '新开对话');
    const promptLabel = Array.from(promptButton.querySelectorAll('span')).find(
      (span) =>
        span.className.includes('group-hover:text-text-primary') &&
        span.textContent?.trim().includes(firstPrompt),
    );

    assert.equal(
      newConversationButton.className.includes('hover:border-system-blue/35'),
      true,
      'new conversation button should highlight its border on hover',
    );
    assert.equal(
      newConversationButton.className.includes('focus:border-system-blue/35'),
      true,
      'new conversation button should preserve border emphasis on keyboard focus',
    );
    assert.equal(
      newConversationButton.className.includes('hover:text-system-blue'),
      true,
      'new conversation button should highlight its label and icon on hover',
    );
    assert.equal(
      newConversationButton.className.includes('focus:text-system-blue'),
      true,
      'new conversation button should preserve label and icon emphasis on keyboard focus',
    );
    assert.equal(
      promptButton.className.includes('hover:border-system-blue/35'),
      true,
      'suggested prompt should highlight its border on hover',
    );
    assert.equal(
      promptButton.className.includes('focus:border-system-blue/35'),
      true,
      'suggested prompt should preserve border emphasis on keyboard focus',
    );
    assert.equal(
      promptButton.className.includes('hover:-translate-y-0.5'),
      true,
      'suggested prompt should feel more interactive on hover',
    );
    assert.ok(promptLabel, 'expected suggested prompt label to render');
    assert.equal(
      promptLabel.className.includes('group-hover:text-text-primary'),
      true,
      'suggested prompt label should highlight together with the card on hover',
    );
    assert.equal(
      promptLabel.className.includes('group-focus-visible:text-text-primary'),
      true,
      'suggested prompt label should stay emphasized for keyboard focus',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('agent receives the live (post-launch) robot context', async () => {
  const previousApiKey = process.env.API_KEY;
  process.env.API_KEY = 'test-key';

  const capturedSystemPrompts: string[] = [];
  const mockOpenAiClient = {
    chat: {
      completions: {
        create: async (params: { messages: Array<{ role: string; content: string }> }) => {
          capturedSystemPrompts.push(params.messages[0]?.content ?? '');
          return {
            choices: [
              {
                message: { role: 'assistant', content: 'No changes needed.', tool_calls: null },
                finish_reason: 'stop',
              },
            ],
          };
        },
      },
    },
  };
  __setAgentOpenAIClientFactoryForTests(() => mockOpenAiClient as never);

  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const initialRobot = createRobotFixture();
  const { selection: _initialSelection, ...initialRobotData } = initialRobot;
  // The fixture assumes an implicit 'world' root link; the workspace validator
  // rejects dangling parent references, so add it here.
  initialRobotData.links['world'] = {
    ...structuredClone(initialRobotData.links['base_link']),
    id: 'world',
    name: 'world',
  };
  initialRobotData.rootLinkId = 'world';
  useWorkspaceStore.setState({
    workspace: createSingleComponentWorkspace(initialRobotData, { componentId: 'arm' }),
    activeComponentId: 'arm',
  });
  useSelectionStore.getState().setSelection(null);

  const launchContext = createLaunchContext();
  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);
  const initialUiState = useUIStore.getState();
  const initialWorkspaceState = useWorkspaceStore.getState();
  const initialSelectionState = useSelectionStore.getState();

  try {
    useUIStore.setState({ managedWindowOrder: [...DEFAULT_MANAGED_WINDOW_ORDER] });
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="en"
          launchContext={launchContext}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    // Simulate a post-launch workspace edit: add tool_link + tool_joint.
    const armComponent = useWorkspaceStore.getState().workspace.components['arm'];
    armComponent.robot.links['tool_link'] = {
      ...structuredClone(initialRobot.links['base_link']),
      id: 'tool_link',
      name: 'tool_link',
    };
    armComponent.robot.joints['tool_joint'] = {
      ...structuredClone(initialRobot.joints['hip_joint']),
      id: 'tool_joint',
      name: 'tool_joint',
      parentLinkId: 'base_link',
      childLinkId: 'tool_link',
    };

    const [prompt] = buildConversationPromptSuggestions({
      lang: 'en',
      isReportFollowup: false,
      selectedEntityName: null,
    });
    assert.ok(prompt, 'expected at least one suggested prompt');
    await clickButton(findButtonByText(container, prompt));
    await flush();

    // The agent re-resolves the live workspace robot at submit time, so its
    // system prompt must list the link/joint added AFTER the chat was opened.
    assert.equal(capturedSystemPrompts.length, 1, 'agent must run exactly one turn');
    const systemPrompt = capturedSystemPrompts[0];
    assert.ok(
      systemPrompt.includes('tool_link'),
      'agent system prompt must include the link added after launch',
    );
    assert.ok(
      systemPrompt.includes('tool_joint'),
      'agent system prompt must include the joint added after launch',
    );
    assert.ok(
      systemPrompt.includes('base_link -> tool_link'),
      'agent system prompt must show the joint parent/child wiring',
    );

    // The launch-time snapshot stays frozen so header lookups remain stable.
    assert.equal(launchContext.robotSnapshot.links['tool_link'], undefined);
  } finally {
    useUIStore.setState(initialUiState);
    useWorkspaceStore.setState(initialWorkspaceState);
    useSelectionStore.setState(initialSelectionState);
    __setAgentOpenAIClientFactoryForTests(null);
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('Auto-apply permission applies the agent edit directly without a confirmation card', async () => {
  const previousApiKey = process.env.API_KEY;
  process.env.API_KEY = 'test-key';

  let callIndex = 0;
  const mockOpenAiClient = {
    chat: {
      completions: {
        create: async () => {
          callIndex += 1;
          if (callIndex === 1) {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'c1',
                        type: 'function',
                        function: {
                          name: 'update_link_geometry',
                          arguments: JSON.stringify({
                            linkId: 'base_link',
                            geometryType: 'cylinder',
                            radius: 0.3,
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            };
          }
          return {
            choices: [
              { message: { role: 'assistant', content: 'Updated base_link radius to 0.3.', tool_calls: null }, finish_reason: 'stop' },
            ],
          };
        },
      },
    },
  };
  __setAgentOpenAIClientFactoryForTests(() => mockOpenAiClient as never);

  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const initialRobot = createRobotFixture();
  const { selection: _initialSelection, ...initialRobotData } = initialRobot;
  initialRobotData.links['world'] = {
    ...structuredClone(initialRobotData.links['base_link']),
    id: 'world',
    name: 'world',
  };
  initialRobotData.rootLinkId = 'world';
  useWorkspaceStore.setState({
    workspace: createSingleComponentWorkspace(initialRobotData, { componentId: 'arm' }),
    activeComponentId: 'arm',
  });
  useSelectionStore.getState().setSelection(null);

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);
  const initialUiState = useUIStore.getState();
  const initialWorkspaceState = useWorkspaceStore.getState();
  const initialSelectionState = useSelectionStore.getState();
  const onApplyCalls: Array<{ componentId: string; urdf: string }> = [];

  try {
    useUIStore.setState({
      managedWindowOrder: [...DEFAULT_MANAGED_WINDOW_ORDER],
      aiAutoApplyEdits: true,
    });
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="en"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={(componentId, proposedUrdf) => {
            onApplyCalls.push({ componentId, urdf: proposedUrdf });
            return true;
          }}
        />,
      );
    });
    await flush();

    const [prompt] = buildConversationPromptSuggestions({
      lang: 'en',
      isReportFollowup: false,
      selectedEntityName: null,
    });
    assert.ok(prompt, 'expected at least one suggested prompt');
    await clickButton(findButtonByText(container, prompt));
    await flush();

    assert.equal(onApplyCalls.length, 1, 'Auto mode must call onApply directly');
    assert.ok(
      onApplyCalls[0].urdf.includes('radius="0.3"'),
      'applied URDF must contain the new radius',
    );
    assert.equal(onApplyCalls[0].componentId, 'arm');
    // No confirmation card in Auto mode.
    assert.equal(container.textContent?.includes('AI modification'), false,
      'Auto mode must not render a confirmation card');
    assert.ok(
      container.textContent?.includes('Updated base_link radius to 0.3.'),
      'Auto mode must surface the agent summary',
    );
  } finally {
    useUIStore.setState(initialUiState);
    useWorkspaceStore.setState(initialWorkspaceState);
    useSelectionStore.setState(initialSelectionState);
    __setAgentOpenAIClientFactoryForTests(null);
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('toolsConfig passes tools to the stream and renders a confirmation banner', async () => {
  const directEnv = setDirectAiEnv();
  const openaiMock = installOpenAICreateMock(TOOL_CALL_STREAM_CHUNKS);
  const toolsConfig = createToolsConfig();
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={toolsConfig}
        />,
      );
    });
    await flush();
    await sendFirstPrompt(container);
    await flush();
    await flush();

    assert.deepEqual(openaiMock.capturedTools(), toolsConfig.tools);
    assert.equal(container.textContent?.includes('将机身改成橙色'), true);
    findButtonByText(container, '确认');
    findButtonByText(container, '取消');
  } finally {
    openaiMock.restore();
    restoreDirectAiEnv(directEnv);
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('confirm executes the Agile Robot tool and renders its result', async () => {
  const directEnv = setDirectAiEnv();
  const openaiMock = installOpenAICreateMock(TOOL_CALL_STREAM_CHUNKS);
  const executedCalls: ParsedToolCall[] = [];
  const toolsConfig = createToolsConfig({
    onExecute: async (call) => {
      executedCalls.push(call);
      return { success: true, message: '改图任务已提交' };
    },
  });
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={toolsConfig}
        />,
      );
    });
    await flush();
    await sendFirstPrompt(container);
    await flush();
    await flush();
    await clickButton(findButtonByText(container, '确认'));
    await flush();

    assert.equal(executedCalls.length, 1);
    assert.equal(executedCalls[0]?.toolName, 'edit_appearance');
    assert.equal(container.textContent?.includes('改图任务已提交'), true);
    assert.equal(container.textContent?.includes('将机身改成橙色'), false);
  } finally {
    openaiMock.restore();
    restoreDirectAiEnv(directEnv);
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('cancel dismisses the tool banner and records the cancellation', async () => {
  const directEnv = setDirectAiEnv();
  const openaiMock = installOpenAICreateMock(TOOL_CALL_STREAM_CHUNKS);
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={createToolsConfig()}
        />,
      );
    });
    await flush();
    await sendFirstPrompt(container);
    await flush();
    await flush();
    await clickButton(findButtonByText(container, '取消'));
    await flush();

    assert.equal(container.textContent?.includes('已取消'), true);
    assert.equal(container.textContent?.includes('将机身改成橙色'), false);
    assert.equal(container.textContent?.includes('确认'), false);
  } finally {
    openaiMock.restore();
    restoreDirectAiEnv(directEnv);
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('successful tool banner auto-dismisses after three seconds', async () => {
  const directEnv = setDirectAiEnv();
  const openaiMock = installOpenAICreateMock(TOOL_CALL_STREAM_CHUNKS);
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={createToolsConfig()}
        />,
      );
    });
    await flush();
    await sendFirstPrompt(container);
    await flush();
    await flush();
    await clickButton(findButtonByText(container, '确认'));
    await flush();
    assert.equal(container.textContent?.includes('改图任务已提交'), true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3200));
    });
    await flush();
    assert.equal(container.textContent?.includes('改图任务已提交'), false);
  } finally {
    openaiMock.restore();
    restoreDirectAiEnv(directEnv);
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('starting a new send clears a stale tool confirmation banner', async () => {
  const directEnv = setDirectAiEnv();
  const openaiMock = installOpenAICreateMockSequence([
    TOOL_CALL_STREAM_CHUNKS,
    PLAIN_REPLY_CHUNKS,
  ]);
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={createToolsConfig()}
        />,
      );
    });
    await flush();
    await sendFirstPrompt(container);
    await flush();
    await flush();
    await clickButton(findButtonByText(container, '确认'));
    await flush();
    assert.equal(container.textContent?.includes('改图任务已提交'), true);

    await typeAndSend(container, '再来一次');
    await flush();
    await flush();
    assert.equal(container.textContent?.includes('改图任务已提交'), false);
    assert.equal(container.textContent?.includes('确认'), false);
  } finally {
    openaiMock.restore();
    restoreDirectAiEnv(directEnv);
    await act(async () => root.unmount());
    dom.window.close();
  }
});
