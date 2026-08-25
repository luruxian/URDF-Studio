import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { useAgileRobotTools } from './useAgileRobotTools.ts';

test('useAgileRobotTools is disabled and always returns null', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const container = dom.window.document.getElementById('root');
  assert.ok(container);

  let current: ReturnType<typeof useAgileRobotTools> | undefined;
  function Probe() {
    current = useAgileRobotTools({ lang: 'zh' });
    return null;
  }

  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
  });

  assert.equal(current, null);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
