import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  isStandaloneAccessAllowed,
  detectAndGrantHandoffFromUrl,
  initHandoffGate,
} from './handoffGate.ts';
import { grantRobotsHandoff, isHandoffGranted, HANDOFF_GRANT_STORAGE_KEY } from './handoffGrant.ts';
import { BOOTSTRAP_HASH_PREFIX } from './constants.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:3000/',
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true,
});
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });

beforeEach(() => {
  dom.window.sessionStorage.clear();
  delete process.env.VITE_ALLOW_STANDALONE;
});

test('grantRobotsHandoff persists session flag', () => {
  grantRobotsHandoff();
  assert.equal(dom.window.sessionStorage.getItem(HANDOFF_GRANT_STORAGE_KEY), '1');
  assert.equal(isHandoffGranted(), true);
});

test('detectAndGrantHandoffFromUrl grants valid import+from', () => {
  const granted = detectAndGrantHandoffFromUrl({
    href: 'http://127.0.0.1:3000/?import=pvw_1&from=https%3A%2F%2Frobots.enkeebot.com',
    search: '?import=pvw_1&from=https%3A%2F%2Frobots.enkeebot.com',
    hash: '',
  });
  assert.equal(granted, true);
  assert.equal(isHandoffGranted(), true);
});

test('detectAndGrantHandoffFromUrl rejects collection imports', () => {
  const granted = detectAndGrantHandoffFromUrl({
    href: 'http://127.0.0.1:3000/?import=collection%3Afoo&from=https%3A%2F%2Frobots.enkeebot.com',
    search: '?import=collection%3Afoo&from=https%3A%2F%2Frobots.enkeebot.com',
    hash: '',
  });
  assert.equal(granted, false);
  assert.equal(isHandoffGranted(), false);
});

test('detectAndGrantHandoffFromUrl grants ?mesh=', () => {
  const granted = detectAndGrantHandoffFromUrl({
    href: 'http://127.0.0.1:3000/?mesh=%2Fapi%2Fpreview.glb',
    search: '?mesh=%2Fapi%2Fpreview.glb',
    hash: '',
  });
  assert.equal(granted, true);
});

test('detectAndGrantHandoffFromUrl grants robots-bootstrap hash', () => {
  const payload = btoa(
    JSON.stringify({
      studio_token: 't',
      api_base_url: 'https://api.example.com/api/v1',
      order_id: 'o1',
    }),
  );
  const hash = `#${BOOTSTRAP_HASH_PREFIX}=${encodeURIComponent(payload)}`;
  const granted = detectAndGrantHandoffFromUrl({
    href: `http://127.0.0.1:3000/${hash}`,
    search: '',
    hash,
  });
  assert.equal(granted, true);
});

test('isStandaloneAccessAllowed honors VITE_ALLOW_STANDALONE and regressionDebug', () => {
  assert.equal(isStandaloneAccessAllowed({ search: '' }), false);
  process.env.VITE_ALLOW_STANDALONE = '1';
  assert.equal(isStandaloneAccessAllowed({ search: '' }), true);
  delete process.env.VITE_ALLOW_STANDALONE;
  assert.equal(isStandaloneAccessAllowed({ search: '?regressionDebug=1' }), true);
});

test('initHandoffGate blocks bare URL', () => {
  assert.deepEqual(initHandoffGate({ href: 'http://127.0.0.1:3000/', search: '', hash: '' }), {
    blocked: true,
  });
});
