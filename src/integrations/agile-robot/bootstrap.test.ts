import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  getBootstrap,
  hasBootstrap,
  clearBootstrap,
  storeBootstrap,
  handleBootstrapMessage,
  decodeBootstrapFromHash,
  clearBootstrapHashFromUrl,
  initRobotsStudioBootstrap,
} from './bootstrap.ts';
import {
  BOOTSTRAP_HASH_PREFIX,
  BOOTSTRAP_STORAGE_KEY,
  MESSAGE_TYPE,
} from './constants.ts';
import { HANDOFF_GRANT_STORAGE_KEY } from './handoffGrant.ts';

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

beforeEach(() => {
  sessionStorage.clear();
});

test('getBootstrap returns null when nothing stored', () => {
  assert.equal(getBootstrap(), null);
});

test('getBootstrap returns parsed bootstrap when valid JSON stored', () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  const result = getBootstrap();
  assert.notEqual(result, null);
  assert.equal(result!.studio_token, 'test-token');
  assert.equal(result!.api_base_url, 'https://api.example.com/api/v1');
});

test('getBootstrap returns null for malformed JSON', () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, '{not json');
  assert.equal(getBootstrap(), null);
});

test('getBootstrap returns null when a required field is missing (studio_token)', () => {
  sessionStorage.setItem(
    BOOTSTRAP_STORAGE_KEY,
    JSON.stringify({ ...validBootstrap, studio_token: '' }),
  );
  assert.equal(getBootstrap(), null);
});

test('getBootstrap returns null when a required field is missing (api_base_url)', () => {
  sessionStorage.setItem(
    BOOTSTRAP_STORAGE_KEY,
    JSON.stringify({ ...validBootstrap, api_base_url: '' }),
  );
  assert.equal(getBootstrap(), null);
});

test('hasBootstrap is false when empty and true when valid bootstrap stored', () => {
  assert.equal(hasBootstrap(), false);
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  assert.equal(hasBootstrap(), true);
});

test('clearBootstrap removes stored bootstrap', () => {
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
  clearBootstrap();
  assert.equal(hasBootstrap(), false);
});

test('storeBootstrap stores valid data and returns true', () => {
  assert.equal(storeBootstrap(validBootstrap), true);
  assert.equal(hasBootstrap(), true);
  assert.equal(getBootstrap()?.order_id, 'order-123');
});

test('storeBootstrap returns false and stores nothing for null/undefined', () => {
  assert.equal(storeBootstrap(null), false);
  assert.equal(storeBootstrap(undefined), false);
  assert.equal(hasBootstrap(), false);
});

test('storeBootstrap returns false for a payload missing studio_token', () => {
  assert.equal(storeBootstrap({ ...validBootstrap, studio_token: '' }), false);
  assert.equal(hasBootstrap(), false);
});

test('storeBootstrap rejects non-object payloads', () => {
  assert.equal(storeBootstrap('token'), false);
  assert.equal(storeBootstrap(42), false);
  assert.equal(hasBootstrap(), false);
});

test('storeBootstrap grants robots handoff', () => {
  assert.equal(storeBootstrap(validBootstrap), true);
  assert.equal(sessionStorage.getItem(HANDOFF_GRANT_STORAGE_KEY), '1');
});

test('handleBootstrapMessage stores bootstrap from an allowed origin', () => {
  const event = new MessageEvent('message', {
    origin: 'https://studio.enkeebot.com',
    data: { type: MESSAGE_TYPE, bootstrap: validBootstrap },
  });
  assert.equal(handleBootstrapMessage(event), true);
  assert.equal(hasBootstrap(), true);
});

test('handleBootstrapMessage ignores messages from non-allowed origins', () => {
  const event = new MessageEvent('message', {
    origin: 'https://evil.example.com',
    data: { type: MESSAGE_TYPE, bootstrap: validBootstrap },
  });
  assert.equal(handleBootstrapMessage(event), false);
  assert.equal(hasBootstrap(), false);
});

test('handleBootstrapMessage ignores unrelated message types', () => {
  const event = new MessageEvent('message', {
    origin: 'https://studio.enkeebot.com',
    data: { greeting: 'hello' },
  });
  assert.equal(handleBootstrapMessage(event), false);
  assert.equal(hasBootstrap(), false);
});

test('handleBootstrapMessage returns false when bootstrap is malformed', () => {
  const event = new MessageEvent('message', {
    origin: 'https://studio.enkeebot.com',
    data: { type: MESSAGE_TYPE, bootstrap: { studio_token: '' } },
  });
  assert.equal(handleBootstrapMessage(event), false);
  assert.equal(hasBootstrap(), false);
});

function encodeBootstrapHash(bootstrap: typeof validBootstrap): string {
  return `#${BOOTSTRAP_HASH_PREFIX}=${encodeURIComponent(btoa(JSON.stringify(bootstrap)))}`;
}

test('decodeBootstrapFromHash decodes a main-site encoded hash payload', () => {
  const decoded = decodeBootstrapFromHash(encodeBootstrapHash(validBootstrap));
  assert.notEqual(decoded, null);
  assert.equal(decoded!.studio_token, 'test-token');
  assert.equal(decoded!.order_id, 'order-123');
});

test('decodeBootstrapFromHash returns null for empty or unrelated hashes', () => {
  assert.equal(decodeBootstrapFromHash(''), null);
  assert.equal(decodeBootstrapFromHash('#other=1'), null);
  assert.equal(decodeBootstrapFromHash(`#${BOOTSTRAP_HASH_PREFIX}=not-base64`), null);
});

test('decodeBootstrapFromHash rejects payloads missing required fields', () => {
  const bad = encodeBootstrapHash({ ...validBootstrap, studio_token: '' });
  assert.equal(decodeBootstrapFromHash(bad), null);
});

test('initRobotsStudioBootstrap persists hash bootstrap and clears the hash', () => {
  const meshSearch = '?mesh=http%3A%2F%2Flocalhost%3A8000%2Fpreview.glb';
  const hashDom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: `http://localhost:3000/${meshSearch}${encodeBootstrapHash(validBootstrap)}`,
  });
  Object.defineProperty(globalThis, 'window', {
    value: hashDom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: hashDom.window.sessionStorage,
    configurable: true,
  });

  const result = initRobotsStudioBootstrap();
  assert.equal(result?.studio_token, 'test-token');
  assert.equal(hasBootstrap(), true);
  assert.equal(hashDom.window.location.hash, '');
  assert.equal(hashDom.window.location.search, meshSearch);

  // Restore shared test DOM for remaining postMessage tests' storage.
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: dom.window.sessionStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    configurable: true,
  });
});

test('initRobotsStudioBootstrap falls back to sessionStorage when hash is absent', () => {
  const restoreDom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000/',
  });
  Object.defineProperty(globalThis, 'window', {
    value: restoreDom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: restoreDom.window.sessionStorage,
    configurable: true,
  });
  restoreDom.window.sessionStorage.setItem(
    BOOTSTRAP_STORAGE_KEY,
    JSON.stringify(validBootstrap),
  );

  const result = initRobotsStudioBootstrap();
  assert.equal(result?.order_id, 'order-123');

  Object.defineProperty(globalThis, 'sessionStorage', {
    value: dom.window.sessionStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    configurable: true,
  });
});

test('clearBootstrapHashFromUrl is a no-op when hash is not robots-bootstrap', () => {
  const otherDom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000/?mesh=x#other=1',
  });
  Object.defineProperty(globalThis, 'window', {
    value: otherDom.window,
    configurable: true,
  });
  clearBootstrapHashFromUrl();
  assert.equal(otherDom.window.location.hash, '#other=1');

  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    configurable: true,
  });
});
