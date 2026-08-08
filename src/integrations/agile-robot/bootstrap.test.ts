import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  getBootstrap,
  hasBootstrap,
  clearBootstrap,
  storeBootstrap,
  handleBootstrapMessage,
} from './bootstrap.ts';
import { BOOTSTRAP_STORAGE_KEY, MESSAGE_TYPE } from './constants.ts';

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
