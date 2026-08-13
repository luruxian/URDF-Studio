import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { useAgileRobotBootstrap } from './useAgileRobotBootstrap.ts';
import { getBootstrap } from '../bootstrap.ts';
import { BOOTSTRAP_STORAGE_KEY, MESSAGE_TYPE } from '../constants.ts';

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

const ALLOWED_ORIGIN = 'https://studio.enkeebot.com';
const BLOCKED_ORIGIN = 'https://evil.example.com';

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

/** Install a jsdom window/document/sessionStorage as the test globals so the
 *  hook's window listener and bootstrap's sessionStorage reads both see the
 *  same environment. Restores the original globals on restore(). */
function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalActEnvironment = (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
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
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    writable: true,
    value: dom.window.sessionStorage,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
    value: true,
  });

  return {
    dom,
    dispatchMessage(origin: string, data: unknown) {
      const event = new dom.window.MessageEvent('message', { origin, data });
      dom.window.dispatchEvent(event);
    },
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('sessionStorage', originalSessionStorage);
      if (originalActEnvironment === undefined) {
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
      } else {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
          configurable: true,
          writable: true,
          value: originalActEnvironment,
        });
      }
    },
  };
}

async function renderHook() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let current: { hasBootstrap: boolean } | undefined;

  function Probe() {
    current = useAgileRobotBootstrap();
    return null;
  }

  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    get current() {
      assert.notEqual(current, undefined, 'hook should have rendered');
      return current as { hasBootstrap: boolean };
    },
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test('returns hasBootstrap=false when nothing is stored', async () => {
  const dom = installDomEnvironment();
  try {
    const rendered = await renderHook();
    assert.equal(rendered.current.hasBootstrap, false);
    await rendered.cleanup();
  } finally {
    dom.restore();
  }
});

test('returns hasBootstrap=true when a valid bootstrap is already stored', async () => {
  const dom = installDomEnvironment();
  try {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
    const rendered = await renderHook();
    assert.equal(rendered.current.hasBootstrap, true);
    await rendered.cleanup();
  } finally {
    dom.restore();
  }
});

test('flips to hasBootstrap=true after a valid postMessage', async () => {
  const dom = installDomEnvironment();
  try {
    const rendered = await renderHook();
    assert.equal(rendered.current.hasBootstrap, false);

    await act(async () => {
      dom.dispatchMessage(ALLOWED_ORIGIN, {
        type: MESSAGE_TYPE,
        bootstrap: validBootstrap,
      });
    });

    assert.equal(rendered.current.hasBootstrap, true);
    assert.notEqual(getBootstrap(), null);
    await rendered.cleanup();
  } finally {
    dom.restore();
  }
});

test('ignores postMessage from a non-allowed origin', async () => {
  const dom = installDomEnvironment();
  try {
    const rendered = await renderHook();

    await act(async () => {
      dom.dispatchMessage(BLOCKED_ORIGIN, {
        type: MESSAGE_TYPE,
        bootstrap: validBootstrap,
      });
    });

    assert.equal(rendered.current.hasBootstrap, false);
    assert.equal(getBootstrap(), null);
    await rendered.cleanup();
  } finally {
    dom.restore();
  }
});

test('ignores postMessage with an unrelated message type', async () => {
  const dom = installDomEnvironment();
  try {
    const rendered = await renderHook();

    await act(async () => {
      dom.dispatchMessage(ALLOWED_ORIGIN, { greeting: 'hello' });
    });

    assert.equal(rendered.current.hasBootstrap, false);
    assert.equal(getBootstrap(), null);
    await rendered.cleanup();
  } finally {
    dom.restore();
  }
});

test('removes the window listener on unmount', async () => {
  const dom = installDomEnvironment();
  try {
    const rendered = await renderHook();
    await rendered.cleanup();

    await act(async () => {
      dom.dispatchMessage(ALLOWED_ORIGIN, {
        type: MESSAGE_TYPE,
        bootstrap: validBootstrap,
      });
    });

    // The handler is gone, so nothing is stored after unmount.
    assert.equal(getBootstrap(), null);
  } finally {
    dom.restore();
  }
});
