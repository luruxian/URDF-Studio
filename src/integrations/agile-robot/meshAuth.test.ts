import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  ROBOTS_MESH_AUTH_STORAGE_KEY,
  ROBOTS_MESH_URL_STORAGE_KEY,
  fetchAuthenticatedGlb,
  getStoredMeshAuth,
  parseMeshDeepLink,
  persistMeshAuth,
  resolveMeshAuthErrorCode,
} from './meshAuth.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3000/',
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true,
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
});

test('parseMeshDeepLink reads mesh + mesh_auth from the new protocol', () => {
  const link = parseMeshDeepLink(
    '?mesh=https%3A%2F%2Fapi.example.com%2Fapi%2Fv1%2Fassets%2Fmodels%2Fa1&mesh_auth=eyJhbGciOiJIUzI1NiIs',
  );

  assert.deepEqual(link, {
    meshUrl: 'https://api.example.com/api/v1/assets/models/a1',
    previewToken: 'eyJhbGciOiJIUzI1NiIs',
  });
});

test('parseMeshDeepLink extracts legacy preview_token from the mesh URL', () => {
  const link = parseMeshDeepLink(
    '?mesh=https%3A%2F%2Fapi.example.com%2Fattach%3Fpreview_token%3Dlegacy-tok',
  );

  assert.ok(link);
  assert.equal(link.previewToken, 'legacy-tok');
  assert.equal(link.meshUrl, 'https://api.example.com/attach');
  assert.doesNotMatch(link.meshUrl, /preview_token/);
});

test('parseMeshDeepLink returns null when mesh has no auth token', () => {
  assert.equal(
    parseMeshDeepLink('?mesh=https%3A%2F%2Fapi.example.com%2Fmodels%2Fa1'),
    null,
  );
});

test('parseMeshDeepLink returns null when mesh is absent', () => {
  assert.equal(parseMeshDeepLink('?foo=1'), null);
});

test('persistMeshAuth and getStoredMeshAuth round-trip through sessionStorage', () => {
  persistMeshAuth({
    meshUrl: 'https://api.example.com/models/a1',
    previewToken: 'tok-1',
  });

  assert.equal(sessionStorage.getItem(ROBOTS_MESH_AUTH_STORAGE_KEY), 'tok-1');
  assert.equal(
    sessionStorage.getItem(ROBOTS_MESH_URL_STORAGE_KEY),
    'https://api.example.com/models/a1',
  );
  assert.deepEqual(getStoredMeshAuth(), {
    meshUrl: 'https://api.example.com/models/a1',
    previewToken: 'tok-1',
  });
});

test('getStoredMeshAuth returns null when either key is missing', () => {
  sessionStorage.setItem(ROBOTS_MESH_AUTH_STORAGE_KEY, 'tok');
  assert.equal(getStoredMeshAuth(), null);
});

test('fetchAuthenticatedGlb sends Bearer auth and omits credentials', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;

  const buffer = await fetchAuthenticatedGlb('https://api.example.com/models/a1', 'preview-jwt');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.example.com/models/a1');
  assert.equal(calls[0]?.init?.credentials, 'omit');
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer preview-jwt');
  assert.equal(buffer.byteLength, 3);
});

test('fetchAuthenticatedGlb throws preview_token_expired on 401', async () => {
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;

  await assert.rejects(
    () => fetchAuthenticatedGlb('https://api.example.com/models/a1', 'expired'),
    (error: unknown) => error instanceof Error && error.message === 'preview_token_expired',
  );
});

test('fetchAuthenticatedGlb throws glb_fetch_failed status on other errors', async () => {
  globalThis.fetch = (async () => new Response(null, { status: 502 })) as typeof fetch;

  await assert.rejects(
    () => fetchAuthenticatedGlb('https://api.example.com/models/a1', 'tok'),
    (error: unknown) => error instanceof Error && error.message === 'glb_fetch_failed:502',
  );
});

test('resolveMeshAuthErrorCode maps known fetch failures', () => {
  assert.equal(resolveMeshAuthErrorCode(new Error('preview_token_expired')), 'auth_expired');
  assert.equal(resolveMeshAuthErrorCode(new Error('missing_mesh_auth')), 'auth_missing');
  assert.equal(resolveMeshAuthErrorCode(new Error('glb_fetch_failed:404')), 'not_found');
  assert.equal(resolveMeshAuthErrorCode(new Error('glb_fetch_failed:502')), 'unavailable');
  assert.equal(resolveMeshAuthErrorCode(new Error('other')), null);
});
