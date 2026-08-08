import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { useAssetsStore } from '@/store';
import { AGILE_ROBOT_PREVIEW_ASSET_KEY, reloadMeshFromUrl } from './meshReload.ts';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  useAssetsStore.getState().clearAssets();
});

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

test('reloadMeshFromUrl fetches the URL and stores a blob URL in assetsStore', async () => {
  const mockBlob = new Blob(['fake-glb-data'], { type: 'model/gltf-binary' });
  const { calls } = installFetchMock([new Response(mockBlob, { status: 200 })]);

  await reloadMeshFromUrl('https://api.example.com/preview?token=x');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/preview?token=x');

  const storedUrl = useAssetsStore.getState().assets[AGILE_ROBOT_PREVIEW_ASSET_KEY];
  assert.ok(storedUrl, 'expected a blob URL stored for the preview key');
  assert.match(storedUrl, /^blob:/);
});

test('reloadMeshFromUrl throws when the response is not ok', async () => {
  installFetchMock([new Response(null, { status: 404 })]);

  await assert.rejects(
    () => reloadMeshFromUrl('https://api.example.com/bad'),
    /Failed to fetch mesh/,
  );
});

test('reloadMeshFromUrl throws when the response body is empty', async () => {
  installFetchMock([new Response(new Blob([]), { status: 200 })]);

  await assert.rejects(
    () => reloadMeshFromUrl('https://api.example.com/empty'),
    /Empty mesh response/,
  );
});

test('reloadMeshFromUrl replaces the stored URL when called again', async () => {
  installFetchMock([
    new Response(new Blob(['glb-v1'], { type: 'model/gltf-binary' }), { status: 200 }),
    new Response(new Blob(['glb-v2'], { type: 'model/gltf-binary' }), { status: 200 }),
  ]);

  await reloadMeshFromUrl('https://api.example.com/v1');
  const firstUrl = useAssetsStore.getState().assets[AGILE_ROBOT_PREVIEW_ASSET_KEY];

  await reloadMeshFromUrl('https://api.example.com/v2');
  const secondUrl = useAssetsStore.getState().assets[AGILE_ROBOT_PREVIEW_ASSET_KEY];

  assert.ok(firstUrl, 'expected a blob URL after the first reload');
  assert.ok(secondUrl, 'expected a blob URL after the second reload');
  assert.notEqual(secondUrl, firstUrl, 'expected the stored URL to point at the new mesh');
});
