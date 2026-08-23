import test from 'node:test';
import assert from 'node:assert/strict';

import { setAiBackendBaseUrlResolver } from '@/shared/hostIntegrationState';

import {
  getRobotsAiConversationBackendUrl,
  isRobotsAiConversationReady,
  isRobotsApiBaseUrlConfigured,
} from './robotsConversationBackend.ts';

test('robots conversation readiness requires VITE_ROBOTS_API_BASE_URL and an active bootstrap resolver', () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  process.env.VITE_ROBOTS_API_BASE_URL = 'https://api.example.com/api/v1';
  setAiBackendBaseUrlResolver(null);

  try {
    assert.equal(isRobotsApiBaseUrlConfigured(), true);
    assert.equal(getRobotsAiConversationBackendUrl(), '');
    assert.equal(isRobotsAiConversationReady(), false);

    setAiBackendBaseUrlResolver(
      () => 'https://api.example.com/api/v1/me/projects/ord-9/studio/ai',
    );
    assert.equal(
      getRobotsAiConversationBackendUrl(),
      'https://api.example.com/api/v1/me/projects/ord-9/studio/ai',
    );
    assert.equal(isRobotsAiConversationReady(), true);
  } finally {
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
  }
});

test('robots conversation stays disabled when only generic AI backend env is configured', () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  const previousBackendUrl = process.env.AI_BACKEND_URL;
  delete process.env.VITE_ROBOTS_API_BASE_URL;
  process.env.AI_BACKEND_URL = 'https://backend.test/api/ai/urdf-studio';
  setAiBackendBaseUrlResolver(null);

  try {
    assert.equal(isRobotsApiBaseUrlConfigured(), false);
    assert.equal(isRobotsAiConversationReady(), false);
  } finally {
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
    if (previousBackendUrl === undefined) {
      delete process.env.AI_BACKEND_URL;
    } else {
      process.env.AI_BACKEND_URL = previousBackendUrl;
    }
  }
});
