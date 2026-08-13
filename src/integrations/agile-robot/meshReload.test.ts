import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { reloadMeshFromUrl, type MeshReloadImportPort } from './meshReload.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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

test('reloadMeshFromUrl fetches the URL and routes the GLB through the import port', async () => {
  const mockBlob = new Blob(['fake-glb-data'], { type: 'model/gltf-binary' });
  const { calls } = installFetchMock([new Response(mockBlob, { status: 200 })]);
  const { port, imported } = createImportSpy();

  await reloadMeshFromUrl('https://api.example.com/preview?token=x', port);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/preview?token=x');
  assert.equal(imported.length, 1, 'expected the GLB to be routed through the import port');
  assert.equal(imported[0]?.name, 'updated_model.glb');
  assert.equal(imported[0]?.type, 'model/gltf-binary');
  assert.equal(imported[0]?.size, mockBlob.size);
});

test('reloadMeshFromUrl throws when the response is not ok', async () => {
  installFetchMock([new Response(null, { status: 404 })]);
  const { port } = createImportSpy();

  await assert.rejects(
    () => reloadMeshFromUrl('https://api.example.com/bad', port),
    /Failed to fetch mesh/,
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
