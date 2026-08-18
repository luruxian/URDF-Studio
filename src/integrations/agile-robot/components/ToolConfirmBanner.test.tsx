import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ToolConfirmBanner } from './ToolConfirmBanner.tsx';
import type { ToolConfirmBannerProps } from './ToolConfirmBanner.tsx';

const toolCall = {
  toolName: 'edit_robot_appearance',
  args: { prompt: '{"subject":"test"}' },
  summary: '将机身改为橙色，保留原视角',
};

const defaultBannerProps = {
  lang: 'zh' as const,
  toolCall,
  onConfirm: () => {},
  onCancel: () => {},
};

function restoreGlobalProperty<T extends keyof typeof globalThis>(
  key: T,
  originalValue: (typeof globalThis)[T] | undefined,
) {
  if (originalValue === undefined) {
    delete globalThis[key];
    return;
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: originalValue,
  });
}

/** Install a jsdom window/document as the test globals so createRoot renders
 *  into a real DOM. Restores the original globals on restore(). */
function installDom() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalActEnvironment = (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  return {
    dom,
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('HTMLElement', originalHTMLElement);
      if (originalActEnvironment === undefined) {
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
      } else {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
          configurable: true,
          value: originalActEnvironment,
        });
      }
    },
  };
}

interface RenderedBanner {
  /** Root DOM node produced by the component, or null when it renders nothing. */
  root: Element | null;
  /** Trimmed text content of the rendered subtree. */
  text: string;
  /** Click the <button> whose trimmed label equals `label`. */
  click: (label: string) => Promise<void>;
  unmount: () => Promise<void>;
}

async function renderBanner(
  dom: JSDOM,
  props: ToolConfirmBannerProps,
): Promise<RenderedBanner> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(ToolConfirmBanner, props));
  });

  return {
    root: container.firstElementChild,
    get text() {
      return container.textContent?.trim() ?? '';
    },
    async click(label) {
      const button = Array.from(container.querySelectorAll('button')).find(
        (el) => el.textContent?.trim() === label,
      );
      assert.notEqual(button, undefined, `expected a button labeled "${label}"`);
      await act(async () => {
        button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test('renders nothing when idle', async () => {
  const dom = installDom();
  try {
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'idle',
    });
    assert.equal(rendered.root, null);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('renders nothing when cancelled', async () => {
  const dom = installDom();
  try {
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'cancelled',
    });
    assert.equal(rendered.root, null);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('renders the parsed tool summary with confirm and cancel actions', async () => {
  const dom = installDom();
  try {
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'parsed',
    });
    assert.match(rendered.text, /将机身改为橙色，保留原视角/);
    assert.match(rendered.text, /确认/);
    assert.match(rendered.text, /取消/);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('calls onConfirm when the confirm button is clicked', async () => {
  const dom = installDom();
  try {
    let confirmed = 0;
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'parsed',
      onConfirm: () => {
        confirmed += 1;
      },
    });
    await rendered.click('确认');
    assert.equal(confirmed, 1);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('calls onCancel when the cancel button is clicked in the parsed state', async () => {
  const dom = installDom();
  try {
    let cancelled = 0;
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'parsed',
      onCancel: () => {
        cancelled += 1;
      },
    });
    await rendered.click('取消');
    assert.equal(cancelled, 1);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('renders the executing spinner text', async () => {
  const dom = installDom();
  try {
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'executing',
    });
    assert.match(rendered.text, /正在生成新的 3D 模型…/);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('renders the done success message', async () => {
  const dom = installDom();
  try {
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'done',
      result: { success: true, message: '3D 模型已更新' },
    });
    assert.match(rendered.text, /3D 模型已更新/);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('renders the error message and calls onRetry when retry is clicked', async () => {
  const dom = installDom();
  try {
    let retried = 0;
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'error',
      result: { success: false, message: '生成失败：上游错误' },
      onRetry: () => {
        retried += 1;
      },
    });
    assert.match(rendered.text, /生成失败：上游错误/);
    assert.match(rendered.text, /取消/);
    await rendered.click('重试');
    assert.equal(retried, 1);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('renders the error state without a retry button when onRetry is omitted', async () => {
  const dom = installDom();
  try {
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      state: 'error',
      result: { success: false, message: '生成失败：上游错误' },
    });
    assert.match(rendered.text, /生成失败：上游错误/);
    assert.doesNotMatch(rendered.text, /重试/);
    assert.match(rendered.text, /取消/);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});

test('renders English confirm banner labels when lang is en', async () => {
  const dom = installDom();
  try {
    const rendered = await renderBanner(dom.dom, {
      ...defaultBannerProps,
      lang: 'en',
      state: 'parsed',
    });
    assert.match(rendered.text, /Confirm/);
    assert.match(rendered.text, /Cancel/);
    await rendered.unmount();
  } finally {
    dom.restore();
  }
});
