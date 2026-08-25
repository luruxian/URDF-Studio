import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAiBackendAuthToken,
  setAiBackendAuthTokenProvider,
  setAiBackendBaseUrlResolver,
} from '@/shared/hostIntegrationState';

import {
  createRobotsAgentOpenAIClient,
  isRobotsAgentLlmConfigured,
  resolveRobotsAgentOpenAiBaseUrl,
} from './robotsAgentLlm.ts';

test('robots agent LLM uses project-scoped URL when bootstrap resolver is active', () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  process.env.VITE_ROBOTS_API_BASE_URL = 'https://api.example.com/api/v1';
  setAiBackendBaseUrlResolver(
    () => 'https://api.example.com/api/v1/me/projects/ord-9/studio/ai',
  );

  try {
    assert.equal(isRobotsAgentLlmConfigured(), true);
    assert.equal(
      resolveRobotsAgentOpenAiBaseUrl(),
      'https://api.example.com/api/v1/me/projects/ord-9/studio/ai/v1',
    );
  } finally {
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
  }
});

test('robots agent LLM falls back to VITE_ROBOTS_API_BASE_URL without bootstrap', () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  process.env.VITE_ROBOTS_API_BASE_URL = 'https://api.example.com/api/v1';
  setAiBackendBaseUrlResolver(null);

  try {
    assert.equal(isRobotsAgentLlmConfigured(), true);
    assert.equal(resolveRobotsAgentOpenAiBaseUrl(), 'https://api.example.com/api/v1');
  } finally {
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
  }
});

test('createRobotsAgentOpenAIClient forwards bootstrap studio_token as apiKey', () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  process.env.VITE_ROBOTS_API_BASE_URL = 'https://api.example.com/api/v1';
  setAiBackendBaseUrlResolver(null);
  setAiBackendAuthTokenProvider(() => 'studio-token-abc');

  try {
    const client = createRobotsAgentOpenAIClient();
    assert.equal((client as unknown as { apiKey: string }).apiKey, 'studio-token-abc');
    assert.equal(
      (client as unknown as { baseURL: string }).baseURL,
      'https://api.example.com/api/v1',
    );
  } finally {
    setAiBackendAuthTokenProvider(null);
    setAiBackendBaseUrlResolver(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
  }
});

test('createRobotsAgentOpenAIClient uses placeholder apiKey when no auth token', () => {
  const previousRobotsBase = process.env.VITE_ROBOTS_API_BASE_URL;
  process.env.VITE_ROBOTS_API_BASE_URL = 'https://api.example.com/api/v1';
  setAiBackendAuthTokenProvider(() => null);

  try {
    const client = createRobotsAgentOpenAIClient();
    assert.equal((client as unknown as { apiKey: string }).apiKey, 'robots-managed');
    assert.equal(getAiBackendAuthToken(), null);
  } finally {
    setAiBackendAuthTokenProvider(null);
    if (previousRobotsBase === undefined) {
      delete process.env.VITE_ROBOTS_API_BASE_URL;
    } else {
      process.env.VITE_ROBOTS_API_BASE_URL = previousRobotsBase;
    }
  }
});
