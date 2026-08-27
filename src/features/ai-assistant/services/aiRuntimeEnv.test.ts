import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAiRuntimeEnv, resolveOpenAiClientBaseUrl } from './aiRuntimeEnv';

test('resolveAiRuntimeEnv reads Vite-prefixed robots API base URL first', () => {
  const runtimeEnv = resolveAiRuntimeEnv(
    { VITE_ROBOTS_API_BASE_URL: ' https://api.example.com/api/v1/ ' },
    { VITE_ROBOTS_API_BASE_URL: 'https://process.example/api/v1' },
  );

  assert.deepEqual(runtimeEnv, {
    backendUrl: '',
    robotsApiBaseUrl: 'https://api.example.com/api/v1',
  });
});

test('resolveAiRuntimeEnv prefers the Vite backend URL and strips trailing slashes', () => {
  const runtimeEnv = resolveAiRuntimeEnv(
    { VITE_AI_BACKEND_URL: ' /api/ai/urdf-studio/ ' },
    { AI_BACKEND_URL: 'https://process.example/ai' },
  );

  assert.equal(runtimeEnv.backendUrl, '/api/ai/urdf-studio');
});

test('resolveAiRuntimeEnv falls back to the process backend URL', () => {
  const runtimeEnv = resolveAiRuntimeEnv({}, { AI_BACKEND_URL: 'https://process.example/ai' });

  assert.equal(runtimeEnv.backendUrl, 'https://process.example/ai');
});

test('resolveOpenAiClientBaseUrl resolves same-origin proxy paths for the OpenAI SDK', () => {
  assert.equal(
    resolveOpenAiClientBaseUrl('/api/llm-proxy/v1', 'http://localhost:3000'),
    'http://localhost:3000/api/llm-proxy/v1',
  );
  assert.equal(
    resolveOpenAiClientBaseUrl('https://api.minimaxi.com/v1/'),
    'https://api.minimaxi.com/v1',
  );
});
