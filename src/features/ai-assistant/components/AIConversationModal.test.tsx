import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { __setConversationTurnStreamForTests } from '../services/conversationService';
import { setAiBackendBaseUrlResolver } from '@/shared/hostIntegrationState';
import { DEFAULT_MANAGED_WINDOW_ORDER, useUIStore } from '@/store';
import { GeometryType, JointType, type RobotState } from '@/types';
import type { AIConversationLaunchContext } from '../types';
import type { AIConversationToolsConfig } from '@/integrations/agile-robot/types';

const TEST_CONVERSATION_MESSAGE = '请帮我检查这个机器人结构是否合理';

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

const ROBOTS_API_BASE = 'https://api.example.com/api/v1';
const ROBOTS_AI_BACKEND = `${ROBOTS_API_BASE}/me/projects/ord-9/studio/ai`;

interface RobotsConversationEnvSnapshot {
  previousRobotsBase?: string;
}

const setRobotsConversationEnv = (): RobotsConversationEnvSnapshot => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  process.env.VITE_ROBOTS_API_BASE_URL = ROBOTS_API_BASE;
  setAiBackendBaseUrlResolver(() => ROBOTS_AI_BACKEND);
  return { previousRobotsBase };
};

const restoreRobotsConversationEnv = (snapshot: RobotsConversationEnvSnapshot) => {
  setAiBackendBaseUrlResolver(null);
  if (snapshot.previousRobotsBase === undefined) {
    delete process.env.VITE_ROBOTS_API_BASE_URL;
  } else {
    process.env.VITE_ROBOTS_API_BASE_URL = snapshot.previousRobotsBase;
  }
};

const findSendButton = (scope: ParentNode): HTMLButtonElement => {
  const match = Array.from(scope.querySelectorAll('button')).find((button) => {
    const label = button.textContent?.trim() ?? '';
    return label.includes('发送') || label.includes('Ask AI');
  });
  assert.ok(match, 'expected send button to render');
  return match as HTMLButtonElement;
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
  await clickButton(findSendButton(container));
};

test('AIConversationModal opens anchored to the bottom-right corner by default', async () => {
  const previousApiKey = process.env.API_KEY;
  process.env.API_KEY = '';
  const dom = installDom();
  Object.defineProperty(dom.window, 'innerWidth', { value: 1280, writable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 800, writable: true });
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
          lang="en"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });

    const windowRoot = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find(
      (element) => element.style.position === 'fixed' && element.style.width === '760px',
    );
    assert.ok(windowRoot, 'conversation window should render with fixed positioning');
    assert.equal(windowRoot.style.left, '496px');
    assert.equal(windowRoot.style.top, '156px');
  } finally {
    await act(async () => {
      root.unmount();
    });
    process.env.API_KEY = previousApiKey;
    dom.window.close();
  }
});

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
    assert.equal(scrollViewport.childElementCount, 0, 'empty conversation should not render example prompts');

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

    await typeAndSend(container, TEST_CONVERSATION_MESSAGE);
    await flush();

    assert.equal(container.textContent?.includes(TEST_CONVERSATION_MESSAGE), true);
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
    assert.equal(container.textContent?.includes(TEST_CONVERSATION_MESSAGE), true);
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

    await typeAndSend(container, TEST_CONVERSATION_MESSAGE);
    await flush();

    assert.equal(container.textContent?.includes(TEST_CONVERSATION_MESSAGE), true);
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

test('missing robots handoff surfaces handoff-required message', async () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  delete process.env.VITE_ROBOTS_API_BASE_URL;
  setAiBackendBaseUrlResolver(null);
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

    await typeAndSend(container, TEST_CONVERSATION_MESSAGE);
    await flush();

    assert.equal(container.textContent?.includes(TEST_CONVERSATION_MESSAGE), true);
    assert.match(container.textContent || '', /Agile Robot 主站|Studio/);
    assert.equal(container.textContent?.includes('未配置 AI'), false);
    assert.equal(getCopyButtons(container).length, 2);
    assert.equal(findButtonByText(container, '重新生成').textContent?.includes('重新生成'), true);
  } finally {
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
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

test('header actions expose hover and focus border highlight styles', async () => {
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

    const newConversationButton = findButtonByText(container, '新开对话');

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
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('toolsConfig path surfaces ToolConfirmBanner when the model returns tool_calls', async () => {
  const robotsEnv = setRobotsConversationEnv();
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const toolsConfig: AIConversationToolsConfig = {
    tools: [
      {
        type: 'function',
        function: {
          name: 'propose_requirements_revision',
          description: 'Propose revision',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
    parseToolCalls: (rawToolCalls) => {
      const first = rawToolCalls[0];
      if (!first?.function?.name) return null;
      return {
        toolName: first.function.name,
        args: JSON.parse(first.function.arguments) as Record<string, unknown>,
        summary: '手臂加长 5cm',
      };
    },
    onExecute: async () => ({ success: true, message: '模型已更新' }),
  };

  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([
      {
        function: {
          name: 'propose_requirements_revision',
          arguments: JSON.stringify({
            change_summary: 'arm +5cm',
            append_markdown: '\n## v3\n',
          }),
        },
      },
    ]);
    return {
      status: 'completed',
      reply: '已生成修订建议，请确认。',
      error: null,
    };
  });

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

    await typeAndSend(container, '把手臂加长 5cm');
    await flush();

    assert.match(container.textContent || '', /手臂加长 5cm/);
    assert.equal(findButtonByText(container, '确认').textContent?.includes('确认'), true);
    assert.equal(findButtonByText(container, '取消').textContent?.includes('取消'), true);
  } finally {
    __setConversationTurnStreamForTests(null);
    restoreRobotsConversationEnv(robotsEnv);
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
