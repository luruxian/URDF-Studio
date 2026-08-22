import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  ROBOTS_MESH_AUTH_STORAGE_KEY,
  ROBOTS_MESH_URL_STORAGE_KEY,
  persistMeshAuth,
} from './meshAuth.ts';
import { reloadMeshFromUrl, type MeshReloadImportPort } from './meshReload.ts';

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
  persistMeshAuth({
    meshUrl: 'https://api.example.com/api/v1/assets/models/a1',
    previewToken: 'stored-jwt',
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
});

type FetchCall = { url: string; init?: RequestInit };

/** Replace globalThis.fetch with a queue-based mock. Each call consumes the next
 *  response and is recorded for assertions. */
function installFetchMock(responses: Response[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[index];
    index += 1;
    if (next === undefined) {
      throw new Error('Mock fetch called more times than responses provided');
    }
    return next;
  }) as typeof fetch;

  return { calls };
}

/** Build a MeshReloadImportPort that records the GLB files routed to it. */
function createImportSpy(): { port: MeshReloadImportPort; imported: File[] } {
  const imported: File[] = [];
  const port: MeshReloadImportPort = {
    importMeshFile: async (file: File) => {
      imported.push(file);
    },
  };
  return { port, imported };
}

test('reloadMeshFromUrl fetches with stored Bearer auth and routes the GLB', async () => {
  const mockBlob = new Blob(['fake-glb-data'], { type: 'model/gltf-binary' });
  const { calls } = installFetchMock([new Response(mockBlob, { status: 200 })]);
  const { port, imported } = createImportSpy();
  const previewUrl = 'https://api.example.com/api/v1/assets/models/a1';

  await reloadMeshFromUrl(previewUrl, port, 'abc123.glb');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, previewUrl);
  assert.equal(calls[0].init?.credentials, 'omit');
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer stored-jwt');
  assert.equal(imported.length, 1, 'expected the GLB to be routed through the import port');
  assert.equal(imported[0]?.name, 'abc123.glb');
  assert.equal(imported[0]?.type, 'model/gltf-binary');
  assert.equal(imported[0]?.size, mockBlob.size);
  assert.equal(sessionStorage.getItem(ROBOTS_MESH_URL_STORAGE_KEY), previewUrl);
  assert.equal(sessionStorage.getItem(ROBOTS_MESH_AUTH_STORAGE_KEY), 'stored-jwt');
});

test('reloadMeshFromUrl falls back to updated_model.glb when filename is omitted', async () => {
  const mockBlob = new Blob(['fake-glb-data'], { type: 'model/gltf-binary' });
  installFetchMock([new Response(mockBlob, { status: 200 })]);
  const { port, imported } = createImportSpy();

  await reloadMeshFromUrl('https://api.example.com/api/v1/assets/models/a1', port);

  assert.equal(imported[0]?.name, 'updated_model.glb');
});

test('reloadMeshFromUrl throws missing_mesh_auth when sessionStorage has no token', async () => {
  sessionStorage.clear();
  const { port } = createImportSpy();

  await assert.rejects(
    () => reloadMeshFromUrl('https://api.example.com/api/v1/assets/models/a1', port),
    (error: unknown) => error instanceof Error && error.message === 'missing_mesh_auth',
  );
});

test('reloadMeshFromUrl throws preview_token_expired on 401', async () => {
  installFetchMock([new Response(null, { status: 401 })]);
  const { port } = createImportSpy();

  await assert.rejects(
    () => reloadMeshFromUrl('https://api.example.com/api/v1/assets/models/a1', port),
    (error: unknown) => error instanceof Error && error.message === 'preview_token_expired',
  );
});

test('reloadMeshFromUrl throws when the response is not ok', async () => {
  installFetchMock([new Response(null, { status: 404 })]);
  const { port } = createImportSpy();

  await assert.rejects(
    () => reloadMeshFromUrl('https://api.example.com/bad', port),
    /glb_fetch_failed:404/,
  );
});

test('reloadMeshFromUrl throws when the response body is empty', async () => {
  installFetchMock([new Response(new Blob([]), { status: 200 })]);
  const { port } = createImportSpy();

  await assert.rejects(
    () => reloadMeshFromUrl('https://api.example.com/empty', port),
    /Empty mesh response/,
  );
});

test('reloadMeshFromUrl does not call the import port when the fetch fails', async () => {
  installFetchMock([new Response(null, { status: 500 })]);
  const { port, imported } = createImportSpy();

  await assert.rejects(() => reloadMeshFromUrl('https://api.example.com/bad', port));
  assert.equal(imported.length, 0);
});
