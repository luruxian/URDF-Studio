import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import { resolveRobotsAiBackendBaseUrl, initRobotsAiBackend } from './robotsAiBackend.ts';
import { storeBootstrap } from './bootstrap.ts';
import {
  getAiBackendAuthToken,
  setAiBackendAuthTokenProvider,
  setAiBackendBaseUrlResolver,
} from '@/shared/hostIntegrationState';

const validBootstrap = {
  studio_token: 'tok',
  studio_expires_at: '2026-08-09T00:00:00Z',
  order_id: 'ord-9',
  attachment_id: 'a',
  conversation_id: null,
  input_image_path: 'p',
  fallback_input_image_path: 'f',
  api_base_url: 'https://api.example.com/api/v1',
};

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:3000/',
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true,
});

beforeEach(() => {
  dom.window.sessionStorage.clear();
  delete process.env.VITE_ROBOTS_API_BASE_URL;
  setAiBackendAuthTokenProvider(null);
  setAiBackendBaseUrlResolver(null);
});

test('resolveRobotsAiBackendBaseUrl returns empty without env or bootstrap', () => {
  assert.equal(resolveRobotsAiBackendBaseUrl(), '');
});

test('resolveRobotsAiBackendBaseUrl joins env base and order_id', () => {
  process.env.VITE_ROBOTS_API_BASE_URL = 'https://api.example.com/api/v1';
  storeBootstrap(validBootstrap);
  assert.equal(
    resolveRobotsAiBackendBaseUrl(),
    'https://api.example.com/api/v1/me/projects/ord-9/studio/ai',
  );
});

test('initRobotsAiBackend registers studio_token provider', () => {
  storeBootstrap(validBootstrap);
  initRobotsAiBackend();
  assert.equal(getAiBackendAuthToken(), 'tok');
});
