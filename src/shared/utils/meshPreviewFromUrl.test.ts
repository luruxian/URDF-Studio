import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filenameFromMeshPreviewUrl,
  isExplicitlyTrustedCrossOriginMeshPreviewOrigin,
  mimeTypeForMeshPreviewFilename,
  readMeshPreviewUrlFromLocation,
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
