import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filenameFromMeshPreviewUrl,
  isExplicitlyTrustedCrossOriginMeshPreviewOrigin,
  mimeTypeForMeshPreviewFilename,
  readMeshPreviewUrlFromLocation,
  resolveAuthenticatedMeshPreviewUrl,
  resolveMeshPreviewUrl,
  stripMeshPreviewParamFromUrl,
  filenameFromContentDisposition,
} from './meshPreviewFromUrl.ts';

const PAGE = 'https://studio.example/urdf-studio/';

test('resolveMeshPreviewUrl accepts same-origin absolute paths', () => {
  assert.equal(
    resolveMeshPreviewUrl('/api/generated/robot.glb', PAGE),
    'https://studio.example/api/generated/robot.glb',
  );
});

test('resolveMeshPreviewUrl accepts same-origin absolute URLs', () => {
  assert.equal(
    resolveMeshPreviewUrl('https://studio.example/assets/preview.glb', PAGE),
    'https://studio.example/assets/preview.glb',
  );
});

test('resolveMeshPreviewUrl rejects cross-origin URLs by default', () => {
  assert.equal(resolveMeshPreviewUrl('https://evil.example/preview.glb', PAGE), null);
});

test('resolveAuthenticatedMeshPreviewUrl accepts robots API URLs without allowlist', () => {
  assert.equal(
    resolveAuthenticatedMeshPreviewUrl(
      'http://127.0.0.1:8000/api/v1/assets/models/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    ),
    'http://127.0.0.1:8000/api/v1/assets/models/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  );
});

test('resolveAuthenticatedMeshPreviewUrl accepts CDN model URLs', () => {
  assert.equal(
    resolveAuthenticatedMeshPreviewUrl('https://cdn.example.com/models/a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
    'https://cdn.example.com/models/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  );
});

test('resolveAuthenticatedMeshPreviewUrl rejects relative paths and non-http URLs', () => {
  assert.equal(resolveAuthenticatedMeshPreviewUrl('/api/models/a1'), null);
  assert.equal(resolveAuthenticatedMeshPreviewUrl('file:///tmp/a.glb'), null);
});

test('resolveMeshPreviewUrl rejects non-mesh extensions', () => {
  assert.equal(resolveMeshPreviewUrl('/api/generated/robot.zip', PAGE), null);
});

test('isExplicitlyTrustedCrossOriginMeshPreviewOrigin allows attachment URLs without extensions', () => {
  assert.equal(
    isExplicitlyTrustedCrossOriginMeshPreviewOrigin(
      'http://localhost:8000',
      'http://localhost:3000',
      ['http://localhost:8000'],
    ),
    true,
  );
});

test('filenameFromContentDisposition reads GLB filenames from attachment responses', () => {
  assert.equal(
    filenameFromContentDisposition('attachment; filename="robot-preview.glb"'),
    'robot-preview.glb',
  );
});

test('readMeshPreviewUrlFromLocation reads and validates the mesh query param', () => {
  assert.equal(
    readMeshPreviewUrlFromLocation(
      'https://studio.example/urdf-studio/?mesh=%2Fapi%2Fgenerated%2Frobot.glb',
    ),
    'https://studio.example/api/generated/robot.glb',
  );
});

test('stripMeshPreviewParamFromUrl removes the mesh query param', () => {
  assert.equal(
    stripMeshPreviewParamFromUrl(
      'https://studio.example/urdf-studio/?mesh=%2Fapi%2Fgenerated%2Frobot.glb&foo=1',
    ),
    'https://studio.example/urdf-studio/?foo=1',
  );
});

test('stripMeshPreviewParamFromUrl also removes mesh_auth', () => {
  assert.equal(
    stripMeshPreviewParamFromUrl(
      'https://studio.example/?mesh=https%3A%2F%2Fapi.example%2Fmodels%2Fa1&mesh_auth=eyJ&foo=1',
    ),
    'https://studio.example/?foo=1',
  );
});

test('filenameFromMeshPreviewUrl keeps the basename from the URL path', () => {
  assert.equal(
    filenameFromMeshPreviewUrl('https://studio.example/api/generated/my%20robot.glb'),
    'my robot.glb',
  );
});

test('mimeTypeForMeshPreviewFilename distinguishes glb and gltf', () => {
  assert.equal(mimeTypeForMeshPreviewFilename('robot.glb'), 'model/gltf-binary');
  assert.equal(mimeTypeForMeshPreviewFilename('robot.gltf'), 'model/gltf+json');
});
