import assert from 'node:assert/strict';
import test from 'node:test';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Vector3 } from 'three';

import {
  createGeometryFromSerializedStlData,
  parseStlGeometryData,
} from './stlGeometryData.ts';

const TRIANGLE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];
const SECOND_TRIANGLE: ReadonlyArray<readonly [number, number, number]> = [
  [2, 0, 0],
  [3, 0, 0],
  [2, 0, 1],
];

function buildBinaryStl(
  triangles: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>,
  options: { headerPrefix?: string; extraBytes?: number } = {},
): ArrayBuffer {
  const extraBytes = options.extraBytes ?? 0;
  const buffer = new ArrayBuffer(84 + triangles.length * 50 + extraBytes);
  const bytes = new Uint8Array(buffer);
  if (options.headerPrefix) {
    bytes.set(new TextEncoder().encode(options.headerPrefix).subarray(0, 80));
  }
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, face) => {
    const start = 84 + face * 50;
    view.setFloat32(start + 8, 1, true);
    triangle.forEach((vertex, index) => {
      const offset = start + 12 + index * 12;
      view.setFloat32(offset, vertex[0], true);
      view.setFloat32(offset + 4, vertex[1], true);
      view.setFloat32(offset + 8, vertex[2], true);
    });
  });
  return buffer;
}

function loaderPositions(data: ArrayBuffer): number[] {
  const geometry = new STLLoader().parse(data);
  const position = geometry.getAttribute('position');
  assert.ok(position?.array instanceof Float32Array);
  return Array.from(position.array);
}

function loaderMaxDimension(data: ArrayBuffer): number | null {
  const geometry = new STLLoader().parse(data);
  geometry.computeBoundingBox();
  if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) {
    return null;
  }
  const size = geometry.boundingBox.getSize(new Vector3());
  return Math.max(size.x, size.y, size.z);
}

function assertMatchesLoader(data: ArrayBuffer): void {
  const before = new Uint8Array(data).slice();
  const parsed = parseStlGeometryData(data);
  assert.deepEqual(new Uint8Array(data), before);
  assert.equal('normals' in parsed, false);
  assert.deepEqual(Array.from(new Float32Array(parsed.positions)), loaderPositions(data));
  assert.equal(parsed.maxDimension, loaderMaxDimension(data));
  const geometry = createGeometryFromSerializedStlData(parsed);
  assert.equal(geometry.getAttribute('normal'), undefined);
  assert.equal(geometry.userData.requiresFlatShading, true);
  assert.deepEqual(
    Array.from(geometry.getAttribute('position').array as Float32Array),
    loaderPositions(data),
  );
}

test('parseStlGeometryData reads binary triangles without normals', () => {
  assertMatchesLoader(buildBinaryStl([TRIANGLE, SECOND_TRIANGLE]));
});

test('parseStlGeometryData reads an unaligned second binary face and ignores a trailing byte', () => {
  assertMatchesLoader(buildBinaryStl([TRIANGLE, SECOND_TRIANGLE], { extraBytes: 1 }));
});

test('parseStlGeometryData keeps a solid-prefixed exact-length file on the binary path', () => {
  assertMatchesLoader(buildBinaryStl([TRIANGLE], { headerPrefix: 'solid binary' }));
});

test('parseStlGeometryData reads ASCII STL positions without normals', () => {
  const ascii = [
    'solid triangle',
    'facet normal 0 0 1',
    ' outer loop',
    '  vertex 0 0 0',
    '  vertex 1 0 0',
    '  vertex 0 1 0',
    ' endloop',
    'endfacet',
    'endsolid triangle',
  ].join('\n');
  assertMatchesLoader(new TextEncoder().encode(ascii).buffer);
});

test('parseStlGeometryData returns an empty binary STL without a dimension', () => {
  const parsed = parseStlGeometryData(buildBinaryStl([]));
  assert.equal(parsed.positions.byteLength, 0);
  assert.equal(parsed.maxDimension, null);
  assert.equal('normals' in parsed, false);
});

test('parseStlGeometryData rejects a short buffer that is not ASCII', () => {
  assert.throws(
    () => parseStlGeometryData(new ArrayBuffer(10)),
    /STL binary data is shorter than the 84-byte header/,
  );
});

test('parseStlGeometryData rejects a binary face count that overruns the buffer', () => {
  const buffer = new ArrayBuffer(84);
  new DataView(buffer).setUint32(80, 2, true);
  assert.throws(
    () => parseStlGeometryData(buffer),
    /STL binary face count does not fit in the buffer/,
  );
});
