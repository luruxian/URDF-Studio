import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { __setConversationTurnStreamForTests } from '../services/conversationService';
import { translations } from '@/shared/i18n';
import { setAiBackendBaseUrlResolver, setAiBackendAuthTokenProvider } from '@/shared/hostIntegrationState';
import { BOOTSTRAP_STORAGE_KEY } from '@/integrations/agile-robot/constants';
import { DEFAULT_MANAGED_WINDOW_ORDER, useUIStore } from '@/store';
import { GeometryType, JointType, type RobotState } from '@/types';
import type { AIConversationLaunchContext } from '../types';
import type { AIConversationToolsConfig, ToolResult } from '@/integrations/agile-robot/types';
import { createParseToolCalls, createStudioModificationTools } from '@/integrations/robots-studio/studioModificationTools';

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
    (button) => button.getAttribute('aria-label') === '複製到剪貼板',
  ) as HTMLButtonElement[];

const dispatchClick = (button: HTMLButtonElement) => {
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};

const clickButton = async (button: HTMLButtonElement) => {
  await act(async () => {
    dispatchClick(button);
  });
};

const ROBOTS_API_BASE = 'https://api.example.com/api/v1';
const ROBOTS_AI_BACKEND = `${ROBOTS_API_BASE}/me/projects/ord-9/studio/ai`;
const TEST_BFF_SESSION_ID = 'sess-modal-test';

const INQUIRE_ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const validBootstrap = {
  studio_token: 'test-token',
  studio_expires_at: '2026-08-09T00:00:00Z',
  order_id: 'ord-9',
  attachment_id: 'att-456',
  conversation_id: null,
  input_image_path: 'orders/ord-9/model_input.png',
  fallback_input_image_path: 'orders/ord-9/fallback.png',
  api_base_url: ROBOTS_API_BASE,
};

const inquireBootstrap = {
  ...validBootstrap,
  order_id: INQUIRE_ORDER_ID,
  can_inquire: true,
  main_site_origin: 'https://robots.test',
};

interface RobotsConversationEnvSnapshot {
  previousRobotsBase?: string;
  previousFetch?: typeof fetch;
}

const setRobotsConversationEnv = (): RobotsConversationEnvSnapshot => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  const previousFetch = globalThis.fetch;
  process.env.VITE_ROBOTS_API_BASE_URL = ROBOTS_API_BASE;
  setAiBackendBaseUrlResolver(() => ROBOTS_AI_BACKEND);
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  setAiBackendAuthTokenProvider(() => 'test-token');
  return { previousRobotsBase, previousFetch };
};

const restoreRobotsConversationEnv = (snapshot: RobotsConversationEnvSnapshot) => {
  setAiBackendBaseUrlResolver(null);
  setAiBackendAuthTokenProvider(null);
  sessionStorage.clear();
  if (snapshot.previousFetch === undefined) {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  } else {
    globalThis.fetch = snapshot.previousFetch;
  }
  if (snapshot.previousRobotsBase === undefined) {
    delete process.env.VITE_ROBOTS_API_BASE_URL;
  } else {
    process.env.VITE_ROBOTS_API_BASE_URL = snapshot.previousRobotsBase;
  }
};

const mockConversationSessionFetch = () => {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/messages') && init?.method === 'POST') {
      const body = init.body ? JSON.parse(String(init.body)) as { role?: string; content?: string } : {};
      return new Response(
        JSON.stringify({ id: 1, role: body.role, content: body.content }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.includes('/ai/conversation-sessions') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          session_id: TEST_BFF_SESSION_ID,
          expires_at: '2026-08-27T10:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.includes('/ai/conversation-sessions/') && init?.method === 'PUT') {
      return new Response(JSON.stringify({ snapshot_revision: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (requestUrl.includes('/ai/conversation-sessions/') && init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch in AIConversationModal test: ${requestUrl}`);
  }) as typeof fetch;
};

const findSendButton = (scope: ParentNode): HTMLButtonElement => {
  const match = Array.from(scope.querySelectorAll('button')).find((button) => {
    const label = button.textContent?.trim() ?? '';
    return label.includes('发送') || label.includes('發送') || label.includes('Ask AI');
  });
  assert.ok(match, 'expected send button to render');
  return match as HTMLButtonElement;
};

const fillComposer = async (container: ParentNode, text: string) => {
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
};

const typeAndSend = async (container: ParentNode, text: string) => {
  await fillComposer(container, text);
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
      (element) => element.style.position === 'fixed' && element.style.width === '507px',
    );
    assert.ok(windowRoot, 'conversation window should render with fixed positioning');
    assert.equal(windowRoot.style.left, '749px');
    assert.equal(windowRoot.style.top, '363px');
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
  Object.defineProperty(dom.window, 'innerWidth', { value: 530, configurable: true });
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
          lang="zh-Hant"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const windowRoot = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find(
      (element) => element.style.width === '506px' && element.style.height === '413px',
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
        .querySelector<HTMLButtonElement>('button[aria-label="新開對話"]')
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
          lang="zh-Hant"
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

    await clickButton(findButtonByText(container, '新開對話'));
    await flush();

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected confirmation dialog to open');
    assert.equal(confirmDialog.textContent?.includes('開始新對話？'), true);
    assert.equal(confirmDialog.textContent?.includes('後續回覆將不再參考之前的對話內容'), true);

    await clickButton(findButtonByText(confirmDialog, '新開對話'));
    await flush();

    assert.equal(onStartNewConversationCalls.length, 1);
    assert.equal(onStartNewConversationCalls[0], launchContext);
    assert.equal(getTextarea(container).value, '');
    assert.equal(container.textContent?.includes(TEST_CONVERSATION_MESSAGE), true);
    assert.equal(container.textContent?.includes('新對話從這裡開始'), true);
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
          lang="zh-Hant"
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

    await clickButton(findButtonByText(container, '清除歷史'));
    await flush();

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected confirmation dialog to open');
    assert.equal(confirmDialog.textContent?.includes('清空當前對話記錄？'), true);
    assert.equal(
      confirmDialog.textContent?.includes('這會清空窗口中的對話記錄，並重置當前問答上下文'),
      true,
    );

    await clickButton(findButtonByText(confirmDialog, '清除歷史'));
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
          lang="zh-Hant"
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
    assert.equal(
      container.textContent?.includes('請從 Agile Robot 主站打開 Studio 後再使用 AI 對話。'),
      true,
    );
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
          lang="zh-Hant"
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
          lang="zh-Hant"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const newConversationButton = findButtonByText(container, '新開對話');

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

test('shows inquire button when bootstrap can_inquire and opens orders deep link', async () => {
  const dom = installDom();
  const robotsEnv = setRobotsConversationEnv();
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(inquireBootstrap));
  mockConversationSessionFetch();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const openCalls: Array<[string, string, string]> = [];
  const previousOpen = dom.window.open;
  dom.window.open = ((url: string, target?: string, features?: string) => {
    openCalls.push([url, target ?? '', features ?? '']);
    return null;
  }) as typeof dom.window.open;

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh-Hant"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const inquireButton = findButtonByText(container, '與客服聯繫並詢價');
    assert.equal(inquireButton.textContent?.includes('與客服聯繫並詢價'), true);

    await clickButton(inquireButton);
    await flush();

    assert.equal(openCalls.length, 1);
    assert.match(openCalls[0]?.[0] ?? '', /action=inquire/);
    assert.equal(openCalls[0]?.[1], '_blank');
    assert.equal(openCalls[0]?.[2], 'noopener,noreferrer');
    assert.equal(
      openCalls[0]?.[0],
      `https://robots.test/zh-Hant/orders?order=${INQUIRE_ORDER_ID}&action=inquire`,
    );
  } finally {
    dom.window.open = previousOpen;
    await act(async () => {
      root.unmount();
    });
    restoreRobotsConversationEnv(robotsEnv);
    dom.window.close();
  }
});

test('hides inquire button when bootstrap lacks can_inquire', async () => {
  const dom = installDom();
  const robotsEnv = setRobotsConversationEnv();
  mockConversationSessionFetch();
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
          lang="zh-Hant"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
        />,
      );
    });
    await flush();

    const inquireButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.trim().includes('與客服聯繫並詢價'),
    );
    assert.equal(inquireButton, undefined);
  } finally {
    await act(async () => {
      root.unmount();
    });
    restoreRobotsConversationEnv(robotsEnv);
    dom.window.close();
  }
});

test('toolsConfig path surfaces ToolConfirmBanner when the model returns tool_calls', async () => {
  const dom = installDom();
  const robotsEnv = setRobotsConversationEnv();
  mockConversationSessionFetch();
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
            section_updates: { 性能参数: '臂展 +5cm' },
            history_bullets: ['臂展 +5cm'],
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
          lang="zh-Hant"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={toolsConfig}
        />,
      );
    });
    await flush();
    await flush();

    await typeAndSend(container, '把手臂加长 5cm');
    await flush();

    assert.match(container.textContent || '', /手臂加长 5cm/);
    assert.equal(findButtonByText(container, '確認').textContent?.includes('確認'), true);
    assert.equal(findButtonByText(container, '取消').textContent?.includes('取消'), true);
  } finally {
    __setConversationTurnStreamForTests(null);
    await act(async () => {
      root.unmount();
    });
    await flush();
    await flush();
    restoreRobotsConversationEnv(robotsEnv);
    dom.window.close();
  }
});

const MESH_TOOL_EXECUTING_BANNER = '正在重新生成仿真模型，请稍候15-30分钟';

const installMeshToolCallStream = () => {
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([
      {
        function: {
          name: 'propose_requirements_revision',
          arguments: JSON.stringify({
            change_summary: 'arm +5cm',
            section_updates: { 性能参数: '臂展 +5cm' },
            history_bullets: ['臂展 +5cm'],
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
};

const createDeferredMeshToolsConfig = () => {
  let resolveExecute: (result: {
    success: boolean;
    message: string;
    chatMessage: string;
  }) => void = () => {};
  let executeCallCount = 0;
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
    bannerTexts: {
      confirm: '确认',
      cancel: '取消',
      retry: '重试',
      executing: MESH_TOOL_EXECUTING_BANNER,
    },
    onExecute: () => {
      executeCallCount += 1;
      return new Promise((resolve) => {
        resolveExecute = resolve;
      });
    },
  };

  return {
    toolsConfig,
    resolveExecute: (result: {
      success: boolean;
      message: string;
      chatMessage: string;
    }) => resolveExecute(result),
    getExecuteCallCount: () => executeCallCount,
  };
};

const startClosedDialogMeshExecution = async () => {
  const dom = installDom();
  const robotsEnv = setRobotsConversationEnv();
  mockConversationSessionFetch();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const deferred = createDeferredMeshToolsConfig();
  const meshGenerationFailedCalls = { count: 0 };
  const onMeshGenerationFailed = () => {
    meshGenerationFailedCalls.count += 1;
  };
  installMeshToolCallStream();

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  const renderModal = async (isOpen: boolean) => {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen={isOpen}
          onClose={() => {}}
          lang="zh-CN"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={deferred.toolsConfig}
          onMeshGenerationFailed={onMeshGenerationFailed}
        />,
      );
    });
  };

  await renderModal(true);
  await flush();
  await flush();
  await typeAndSend(container, '把手臂加长 5cm');
  await flush();
  await clickButton(findButtonByText(container, '确认'));
  await flush();

  assert.match(container.textContent || '', new RegExp(MESH_TOOL_EXECUTING_BANNER));
  assert.equal(deferred.getExecuteCallCount(), 1);

  return {
    container,
    deferred,
    meshGenerationFailedCalls,
    renderModal,
    cleanup: async () => {
      __setConversationTurnStreamForTests(null);
      await act(async () => {
        root.unmount();
      });
      await flush();
      await flush();
      restoreRobotsConversationEnv(robotsEnv);
      dom.window.close();
    },
  };
};

test('closed dialog mesh failure reopens with the error banner', async () => {
  const harness = await startClosedDialogMeshExecution();

  try {
    await harness.renderModal(false);
    await act(async () => {
      harness.deferred.resolveExecute({
        success: false,
        message: 'URDF+STL regeneration failed',
        chatMessage: 'URDF+STL regeneration failed',
      });
      await Promise.resolve();
    });
    await flush();

    assert.equal(harness.meshGenerationFailedCalls.count, 1);

    await harness.renderModal(true);
    await flush();

    assert.match(harness.container.textContent || '', /URDF\+STL regeneration failed/);
    assert.equal(
      findButtonByText(harness.container, '重试').textContent?.includes('重试'),
      true,
    );
  } finally {
    await harness.cleanup();
  }
});

test('closed dialog mesh success does not reopen the dialog', async () => {
  const harness = await startClosedDialogMeshExecution();

  try {
    await harness.renderModal(false);
    await act(async () => {
      harness.deferred.resolveExecute({
        success: true,
        message: 'URDF+STL updated',
        chatMessage: 'done',
      });
      await Promise.resolve();
    });
    await flush();

    assert.equal(harness.meshGenerationFailedCalls.count, 0);
  } finally {
    await harness.cleanup();
  }
});

test('reopening while mesh generation is still running keeps the executing banner', async () => {
  const harness = await startClosedDialogMeshExecution();

  try {
    await harness.renderModal(false);
    await harness.renderModal(true);
    await flush();

    assert.match(harness.container.textContent || '', new RegExp(MESH_TOOL_EXECUTING_BANNER));
    assert.equal(harness.meshGenerationFailedCalls.count, 0);
  } finally {
    await harness.cleanup();
  }
});

test('mesh wait disables conversation reset and still shows the failure banner', async () => {
  const harness = await startClosedDialogMeshExecution();

  try {
    const newConversationButton = findButtonByText(harness.container, '新开对话');
    const clearHistoryButton = findButtonByText(harness.container, '清除历史');
    assert.equal(newConversationButton.disabled, true);
    assert.equal(clearHistoryButton.disabled, true);

    await clickButton(newConversationButton);
    await flush();
    assert.equal(
      harness.container.ownerDocument.querySelector('[role="dialog"][aria-modal="true"]'),
      null,
    );

    await act(async () => {
      harness.deferred.resolveExecute({
        success: false,
        message: 'URDF+STL regeneration failed',
        chatMessage: 'URDF+STL regeneration failed',
      });
      await Promise.resolve();
    });
    await flush();

    const failureMessage = Array.from(harness.container.querySelectorAll('span')).find((span) =>
      span.textContent?.includes('URDF+STL regeneration failed'),
    );
    assert.ok(failureMessage, 'expected the red mesh failure message');
    assert.match(failureMessage.className, /text-red-600/);
    assert.equal(
      findButtonByText(harness.container, '重试').textContent?.includes('重试'),
      true,
    );
  } finally {
    await harness.cleanup();
  }
});

const PROPOSE_MODEL_TEXT = '已整理好';
const PROPOSE_CHANGE_SUMMARY = '手臂加长';
const PROPOSE_BULLET = '手臂约 5 cm';
const PROPOSE_BUBBLE = `${PROPOSE_MODEL_TEXT}\n\n${PROPOSE_CHANGE_SUMMARY}\n- ${PROPOSE_BULLET}`;
const FAILURE_STATUS = '生成失败说明';
const RESULT_SUMMARY = '模型已更新说明';

interface RecordedFetch {
  url: string;
  init?: RequestInit;
}

const proposeToolCall = {
  function: {
    name: 'propose_requirements_revision',
    arguments: JSON.stringify({
      change_summary: PROPOSE_CHANGE_SUMMARY,
      section_updates: { 性能参数: '臂展加长' },
      history_bullets: [PROPOSE_BULLET],
    }),
  },
};

const messagePosts = (calls: RecordedFetch[]) =>
  calls.filter((call) => call.url.includes('/messages') && call.init?.method === 'POST');

const postBody = (call: RecordedFetch): { role?: string; content?: string } =>
  JSON.parse(String(call.init?.body ?? '{}')) as { role?: string; content?: string };

const chatRows = (container: ParentNode) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-conversation-role]')).map((row) => ({
    role: row.getAttribute('data-conversation-role'),
    content: row.getAttribute('data-conversation-content'),
  }));

const lastAssistantRow = (container: ParentNode) => {
  const rows = chatRows(container).filter((row) => row.role === 'assistant');
  return rows[rows.length - 1];
};

function installDialogFetch(options?: {
  failMessages?: boolean;
  holdContent?: string;
  held?: Promise<void>;
}): { calls: RecordedFetch[] } {
  const calls: RecordedFetch[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const requestUrl = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: requestUrl, init });

    if (requestUrl.includes('/messages') && method === 'POST') {
      const body = postBody({ url: requestUrl, init });
      if (options?.held && body.content === options.holdContent) {
        await options.held;
      }
      if (options?.failMessages) {
        return new Response(JSON.stringify({ detail: 'append_failed' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ id: calls.length, role: body.role, content: body.content }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }

    if (requestUrl.includes('/ai/conversation-sessions') && method === 'POST' && !requestUrl.includes('/messages')) {
      return new Response(
        JSON.stringify({
          session_id: TEST_BFF_SESSION_ID,
          expires_at: '2026-08-27T10:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.includes('/ai/conversation-sessions/') && method === 'PUT') {
      return new Response(JSON.stringify({ snapshot_revision: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (requestUrl.includes('/ai/conversation-sessions/') && method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (requestUrl.includes('/requirements-document') && method === 'GET') {
      return new Response(
        JSON.stringify({
          order_id: 'ord-9',
          revision: 3,
          requirements_document: '## doc',
          updated_at: '2026-08-27T05:00:00Z',
          package_type: 'urdf_stl',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.includes('/requirements-document') && method === 'PATCH') {
      return new Response(
        JSON.stringify({
          revision: 4,
          requirements_document: '## doc\n## v4',
          change_summary: PROPOSE_CHANGE_SUMMARY,
          updated_at: '2026-08-27T05:01:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.includes('/mesh/regenerate') && method === 'POST') {
      return new Response(
        JSON.stringify({
          job_id: 'job-1',
          revision: 4,
          status: 'queued',
          external_job_id: 'ext-1',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.includes('/mesh/job')) {
      return new Response(
        JSON.stringify({
          job_id: 'job-1',
          revision: 4,
          status: 'done',
          attachment_id: 'att-new',
          package_type: 'urdf_stl',
          error_code: null,
          error_message: null,
          result_summary: RESULT_SUMMARY,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.includes('/mesh/import-grant') && method === 'POST') {
      return new Response(
        JSON.stringify({
          package_type: 'urdf_stl',
          import_grant_id: 'pvw_abc',
          from_origin: 'https://robots.example.com',
          expires_at: '2026-08-27T06:00:00Z',
          attachment_id: 'att-new',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected fetch in dialog history test: ${method} ${requestUrl}`);
  }) as typeof fetch;
  return { calls };
}

const stubToolDef: AIConversationToolsConfig['tools'] = [
  {
    type: 'function',
    function: {
      name: 'propose_requirements_revision',
      description: 'Propose revision',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const zhCnBannerTexts = {
  confirm: translations['zh-CN'].studioMeshToolConfirm,
  cancel: translations['zh-CN'].studioMeshToolCancel,
  retry: translations['zh-CN'].studioMeshToolRetry,
  executing: translations['zh-CN'].studioMeshToolExecuting,
};

async function renderHistoryModal(options: {
  toolsConfig: AIConversationToolsConfig;
  onMeshGenerationFailed?: () => void;
  dom?: ReturnType<typeof installDom>;
  robotsEnv?: RobotsConversationEnvSnapshot;
}) {
  const dom = options.dom ?? installDom();
  const robotsEnv = options.robotsEnv ?? setRobotsConversationEnv();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  const render = async (isOpen: boolean) => {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen={isOpen}
          onClose={() => {}}
          lang="zh-CN"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={options.toolsConfig}
          onMeshGenerationFailed={options.onMeshGenerationFailed}
        />,
      );
    });
  };

  await render(true);
  await flush();
  await flush();

  return {
    dom,
    container,
    render,
    cleanup: async () => {
      __setConversationTurnStreamForTests(null);
      await act(async () => {
        root.unmount();
      });
      await flush();
      await flush();
      restoreRobotsConversationEnv(robotsEnv);
      dom.window.close();
    },
  };
}

async function waitForFetch(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flush();
  }
  assert.fail('timed out waiting for fetch');
}

test('propose tool bubble shows the revision text and not the banner summary', async () => {
  const dom = installDom();
  const robotsEnv = setRobotsConversationEnv();
  installDialogFetch();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => ({ success: true, message: 'ok' }),
  };

  __setConversationTurnStreamForTests(async (input) => {
    input.onReplyDelta?.(PROPOSE_MODEL_TEXT);
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });

  const { AIConversationModal } = await import('./AIConversationModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIConversationModal
          isOpen
          onClose={() => {}}
          lang="zh-CN"
          launchContext={createLaunchContext()}
          onStartNewConversation={() => {}}
          onApply={() => true}
          toolsConfig={toolsConfig}
        />,
      );
    });
    await flush();
    await flush();
    await typeAndSend(container, '把手臂加长');
    await flush();

    const assistant = lastAssistantRow(container);
    assert.ok(assistant, 'expected an assistant bubble');
    assert.equal(assistant.content, PROPOSE_BUBBLE);
    assert.match(assistant.content ?? '', new RegExp(`- ${PROPOSE_BULLET}`));
    assert.equal((assistant.content ?? '').includes('提交需求确认书修订'), false);
    assert.match(container.textContent ?? '', /提交需求确认书修订/);
  } finally {
    __setConversationTurnStreamForTests(null);
    await act(async () => {
      root.unmount();
    });
    await flush();
    restoreRobotsConversationEnv(robotsEnv);
    dom.window.close();
  }
});

test('confirm writes the button text before PATCH and skips PATCH when that post fails', async () => {
  const dom = installDom();
  const robotsEnv = setRobotsConversationEnv();
  let releaseConfirm = () => {};
  const held = new Promise<void>((resolve) => {
    releaseConfirm = resolve;
  });
  const successFetch = installDialogFetch({ holdContent: '确认', held });
  const toolsConfig = await createStudioModificationTools({
    lang: 'zh-CN',
    packageType: 'urdf_stl',
    importUrdfPackage: async () => {},
  });
  assert.ok(toolsConfig);

  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });

  const harness = await renderHistoryModal({ toolsConfig, dom, robotsEnv });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();

    const confirmPosts = messagePosts(successFetch.calls).filter((call) => postBody(call).content === '确认');
    assert.equal(confirmPosts.length, 1);
    assert.deepEqual(postBody(confirmPosts[0]), { role: 'user', content: '确认' });
    assert.equal(successFetch.calls.some((call) => call.init?.method === 'PATCH'), false);

    releaseConfirm();
    await waitForFetch(() => successFetch.calls.some((call) => call.url.includes('/mesh/regenerate')));

    const confirmIndex = successFetch.calls.findIndex(
      (call) => call.url.includes('/messages') && postBody(call).content === '确认',
    );
    const patchIndex = successFetch.calls.findIndex((call) => call.init?.method === 'PATCH');
    const regenerateIndex = successFetch.calls.findIndex((call) => call.url.includes('/mesh/regenerate'));
    assert.ok(confirmIndex >= 0 && confirmIndex < patchIndex && patchIndex < regenerateIndex);
  } finally {
    releaseConfirm();
    await harness.cleanup();
  }
});

test('a failed confirm post does not PATCH and is not retried', async () => {
  const dom = installDom();
  const robotsEnv = setRobotsConversationEnv();
  const fetchSpy = installDialogFetch({ failMessages: true });
  const toolsConfig = await createStudioModificationTools({
    lang: 'zh-CN',
    packageType: 'urdf_stl',
    importUrdfPackage: async () => {},
  });
  assert.ok(toolsConfig);
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig, dom, robotsEnv });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();
    await flush();

    assert.equal(messagePosts(fetchSpy.calls).length, 1);
    assert.equal(postBody(messagePosts(fetchSpy.calls)[0]).content, '确认');
    assert.equal(fetchSpy.calls.some((call) => call.init?.method === 'PATCH'), false);
    assert.equal(fetchSpy.calls.some((call) => call.url.includes('/mesh/regenerate')), false);
  } finally {
    await harness.cleanup();
  }
});

test('confirm-banner cancel posts the cancel button text and does not append 已取消', async () => {
  const fetchSpy = installDialogFetch();
  let executeCount = 0;
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => {
      executeCount += 1;
      await fetch(`${ROBOTS_API_BASE}/me/projects/ord-9/studio/requirements-document`, { method: 'PATCH' });
      return { success: true, message: 'ok' };
    },
  };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await clickButton(findButtonByText(harness.container, '取消'));
    await flush();

    const posts = messagePosts(fetchSpy.calls);
    assert.equal(posts.length, 1);
    assert.deepEqual(postBody(posts[0]), {
      role: 'user',
      content: translations['zh-CN'].studioMeshToolCancel,
    });
    assert.equal(fetchSpy.calls.some((call) => call.init?.method === 'PATCH'), false);
    assert.equal(executeCount, 0);
    assert.equal(
      chatRows(harness.container).some((row) => row.role === 'assistant' && row.content === '已取消'),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test('failure retry posts the retry button text before the next generation request', async () => {
  const fetchSpy = installDialogFetch();
  let executeCount = 0;
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => {
      executeCount += 1;
      if (executeCount === 1) {
        return { success: false, message: FAILURE_STATUS, chatMessage: FAILURE_STATUS };
      }
      await fetch(`${ROBOTS_API_BASE}/me/projects/ord-9/studio/mesh/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 4 }),
      });
      return { success: false, message: FAILURE_STATUS, chatMessage: FAILURE_STATUS };
    },
  };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();
    await clickButton(findButtonByText(harness.container, '重试'));
    await flush();

    const retryIndex = fetchSpy.calls.findIndex(
      (call) => call.url.includes('/messages') && postBody(call).content === translations['zh-CN'].studioMeshToolRetry,
    );
    const regenerateIndex = fetchSpy.calls.findIndex((call) => call.url.includes('/mesh/regenerate'));
    assert.ok(retryIndex >= 0 && regenerateIndex > retryIndex);
    assert.equal(postBody(fetchSpy.calls[retryIndex]).role, 'user');
    assert.equal(
      messagePosts(fetchSpy.calls).some((call) => postBody(call).content === FAILURE_STATUS),
      false,
    );
    assert.equal(
      messagePosts(fetchSpy.calls).some(
        (call) => postBody(call).content === translations['zh-CN'].studioMeshToolExecuting,
      ),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test('failure-banner cancel does not post and appends a local 已取消 assistant message', async () => {
  const fetchSpy = installDialogFetch();
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => ({ success: false, message: FAILURE_STATUS, chatMessage: FAILURE_STATUS }),
  };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();
    const postsBeforeCancel = messagePosts(fetchSpy.calls).length;
    await clickButton(findButtonByText(harness.container, '取消'));
    await flush();

    assert.equal(messagePosts(fetchSpy.calls).length, postsBeforeCancel);
    assert.equal(
      messagePosts(fetchSpy.calls).some((call) => postBody(call).content === '已取消'),
      false,
    );
    const cancelled = chatRows(harness.container).filter(
      (row) => row.role === 'assistant' && row.content === '已取消',
    );
    assert.equal(cancelled.length, 1);
  } finally {
    await harness.cleanup();
  }
});

test('import success posts result_summary, or the localized success line when it is absent', async () => {
  const fetchSpy = installDialogFetch();
  const results: ToolResult[] = [
    { success: true, message: 'updated', chatMessage: RESULT_SUMMARY },
    { success: true, message: translations['zh-CN'].studioMeshToolModelUpdated },
  ];
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => {
      const next = results.shift();
      assert.ok(next);
      return next;
    },
  };
  let turn = 0;
  __setConversationTurnStreamForTests(async (input) => {
    turn += 1;
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: turn === 1 ? PROPOSE_MODEL_TEXT : '第二次', error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '第一次修改');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();

    const summaryPost = messagePosts(fetchSpy.calls).find((call) => postBody(call).content === RESULT_SUMMARY);
    assert.ok(summaryPost);
    assert.equal(postBody(summaryPost).role, 'assistant');
    assert.match(harness.container.textContent ?? '', new RegExp(RESULT_SUMMARY));

    await typeAndSend(harness.container, '第二次修改');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();

    const fallback = translations['zh-CN'].studioMeshToolModelUpdated;
    const fallbackPost = messagePosts(fetchSpy.calls).find((call) => postBody(call).content === fallback);
    assert.ok(fallbackPost);
    assert.equal(postBody(fallbackPost).role, 'assistant');
    assert.match(harness.container.textContent ?? '', new RegExp(fallback.replace('+', '\\+')));
  } finally {
    await harness.cleanup();
  }
});

test('closed-dialog import success posts the assistant line and does not reopen the dialog', async () => {
  const fetchSpy = installDialogFetch();
  let resolveExecute: (result: ToolResult) => void = () => {};
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: () => new Promise((resolve) => {
      resolveExecute = resolve;
    }),
  };
  const openCalls = { count: 0 };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({
    toolsConfig,
    onMeshGenerationFailed: () => {
      openCalls.count += 1;
    },
  });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();
    await harness.render(false);
    await act(async () => {
      resolveExecute({ success: true, message: 'updated', chatMessage: RESULT_SUMMARY });
      await Promise.resolve();
    });
    await flush();

    assert.equal(openCalls.count, 0);
    const summaryPost = messagePosts(fetchSpy.calls).find(
      (call) => postBody(call).role === 'assistant' && postBody(call).content === RESULT_SUMMARY,
    );
    assert.ok(summaryPost, 'expected the success line to be posted while the dialog is closed');
  } finally {
    await harness.cleanup();
  }
});

test('sending while the confirm banner is open does not post 已取消 or PATCH', async () => {
  const fetchSpy = installDialogFetch();
  const turns: string[] = [];
  let executeCount = 0;
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => {
      executeCount += 1;
      await fetch(`${ROBOTS_API_BASE}/me/projects/ord-9/studio/requirements-document`, { method: 'PATCH' });
      return { success: true, message: 'ok' };
    },
  };
  __setConversationTurnStreamForTests(async (input) => {
    turns.push(input.userMessage);
    if (turns.length === 1) {
      input.onToolCalls?.([proposeToolCall]);
      return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
    }
    return { status: 'completed', reply: '继续', error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await typeAndSend(harness.container, '先别改，再说明一下');
    await flush();

    assert.deepEqual(turns, ['把手臂加长', '先别改，再说明一下']);
    assert.equal(executeCount, 0);
    assert.equal(fetchSpy.calls.some((call) => call.init?.method === 'PATCH'), false);
    assert.equal(
      messagePosts(fetchSpy.calls).some((call) => postBody(call).content === '已取消'),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test('the composer stays disabled while mesh generation is running', async () => {
  installDialogFetch();
  let resolveExecute: (result: ToolResult) => void = () => {};
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: () => new Promise((resolve) => {
      resolveExecute = resolve;
    }),
  };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();

    assert.equal(getTextarea(harness.container).disabled, true);
    await act(async () => {
      resolveExecute({ success: false, message: FAILURE_STATUS, chatMessage: FAILURE_STATUS });
      await Promise.resolve();
    });
    await flush();
  } finally {
    await harness.cleanup();
  }
});

test('a second confirm click while the first history POST is pending does not call onExecute twice', async () => {
  let releaseConfirm = () => {};
  const held = new Promise<void>((resolve) => {
    releaseConfirm = resolve;
  });
  const fetchSpy = installDialogFetch({ holdContent: '确认', held });
  let executeCount = 0;
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => {
      executeCount += 1;
      await fetch(`${ROBOTS_API_BASE}/me/projects/ord-9/studio/requirements-document`, { method: 'PATCH' });
      return { success: true, message: 'ok' };
    },
  };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    const confirmButton = findButtonByText(harness.container, '确认');
    // Both clicks land before paint, while the bar is still parsed.
    await act(async () => {
      dispatchClick(confirmButton);
      dispatchClick(confirmButton);
    });
    await flush();

    assert.equal(
      messagePosts(fetchSpy.calls).filter((call) => postBody(call).content === '确认').length,
      1,
    );
    assert.equal(executeCount, 0);

    releaseConfirm();
    await flush();
    await flush();
    await flush();
    assert.equal(executeCount, 1);
  } finally {
    releaseConfirm();
    await harness.cleanup();
  }
});

test('cancel while the confirm history POST is pending does not PATCH', async () => {
  let releaseConfirm = () => {};
  const held = new Promise<void>((resolve) => {
    releaseConfirm = resolve;
  });
  const fetchSpy = installDialogFetch({ holdContent: '确认', held });
  let executeCount = 0;
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => {
      executeCount += 1;
      await fetch(`${ROBOTS_API_BASE}/me/projects/ord-9/studio/requirements-document`, { method: 'PATCH' });
      return { success: true, message: 'ok' };
    },
  };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    const confirmButton = findButtonByText(harness.container, '确认');
    const cancelButton = findButtonByText(harness.container, '取消');
    await act(async () => {
      dispatchClick(confirmButton);
      dispatchClick(cancelButton);
    });

    releaseConfirm();
    await flush();
    await flush();
    await flush();
    assert.equal(executeCount, 0);
    assert.equal(fetchSpy.calls.some((call) => call.init?.method === 'PATCH'), false);
  } finally {
    releaseConfirm();
    await harness.cleanup();
  }
});

test('sending another message while the confirm history POST is pending does not PATCH', async () => {
  let releaseConfirm = () => {};
  const held = new Promise<void>((resolve) => {
    releaseConfirm = resolve;
  });
  const fetchSpy = installDialogFetch({ holdContent: '确认', held });
  let executeCount = 0;
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => {
      executeCount += 1;
      await fetch(`${ROBOTS_API_BASE}/me/projects/ord-9/studio/requirements-document`, { method: 'PATCH' });
      return { success: true, message: 'ok' };
    },
  };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await fillComposer(harness.container, '先别改，再说明一下');
    const confirmButton = findButtonByText(harness.container, '确认');
    const sendButton = findSendButton(harness.container);
    await act(async () => {
      dispatchClick(confirmButton);
      dispatchClick(sendButton);
    });

    releaseConfirm();
    await flush();
    await flush();
    await flush();
    assert.equal(executeCount, 0);
    assert.equal(fetchSpy.calls.some((call) => call.init?.method === 'PATCH'), false);
  } finally {
    releaseConfirm();
    await harness.cleanup();
  }
});

test('cancel on the failure banner while the retry history POST is pending does not start generation', async () => {
  let releaseRetry = () => {};
  const held = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  const fetchSpy = installDialogFetch({ holdContent: '重试', held });
  let executeCount = 0;
  const toolsConfig: AIConversationToolsConfig = {
    tools: stubToolDef,
    parseToolCalls: createParseToolCalls('zh-CN'),
    bannerTexts: zhCnBannerTexts,
    onExecute: async () => {
      executeCount += 1;
      if (executeCount > 1) {
        await fetch(`${ROBOTS_API_BASE}/me/projects/ord-9/studio/mesh/regenerate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: 4 }),
        });
      }
      return { success: false, message: FAILURE_STATUS, chatMessage: FAILURE_STATUS };
    },
  };
  __setConversationTurnStreamForTests(async (input) => {
    input.onToolCalls?.([proposeToolCall]);
    return { status: 'completed', reply: PROPOSE_MODEL_TEXT, error: null };
  });
  const harness = await renderHistoryModal({ toolsConfig });

  try {
    await typeAndSend(harness.container, '把手臂加长');
    await flush();
    await clickButton(findButtonByText(harness.container, '确认'));
    await flush();
    assert.equal(executeCount, 1);

    const retryButton = findButtonByText(harness.container, '重试');
    const cancelButton = findButtonByText(harness.container, '取消');
    await act(async () => {
      dispatchClick(retryButton);
      dispatchClick(cancelButton);
    });

    releaseRetry();
    await flush();
    await flush();
    await flush();
    assert.equal(executeCount, 1);
    assert.equal(fetchSpy.calls.some((call) => call.url.includes('/mesh/regenerate')), false);
  } finally {
    releaseRetry();
    await harness.cleanup();
  }
});

test('studioMeshToolExecuting asks the user to wait 15 to 30 minutes', () => {
  assert.equal(translations['zh-CN'].studioMeshToolExecuting, '正在重新生成仿真模型，请稍候15-30分钟');
  assert.equal(translations['zh-Hant'].studioMeshToolExecuting, '正在重新生成仿真模型，請稍候15-30分鐘');
  assert.equal(translations.en.studioMeshToolExecuting, 'Regenerating the simulation model. Please wait 15–30 minutes.');
  assert.equal(translations.ja.studioMeshToolExecuting, 'シミュレーションモデルを再生成しています。15〜30分ほどお待ちください。');
  assert.equal(translations.ko.studioMeshToolExecuting, '시뮬레이션 모델을 다시 생성하는 중입니다. 15–30분 정도 기다려 주세요.');
  assert.equal(translations.fr.studioMeshToolExecuting, 'Régénération du modèle de simulation. Veuillez patienter 15 à 30 minutes.');
  assert.equal(translations.de.studioMeshToolExecuting, 'Simulationsmodell wird neu generiert. Bitte warten Sie 15–30 Minuten.');
  assert.equal(translations.es.studioMeshToolExecuting, 'Regenerando el modelo de simulación. Espere 15–30 minutos.');
});
