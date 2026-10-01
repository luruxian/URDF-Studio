import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export interface SerializedStlGeometryData {
  positions: ArrayBuffer;
  maxDimension: number | null;
}

const ASCII_SOLID = [115, 111, 108, 105, 100];
const loaderScopeSizeVector = new Vector3();
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function extractTransferableBuffer(array: Float32Array): ArrayBuffer {
  if (array.byteOffset === 0 && array.byteLength === array.buffer.byteLength) {
    return array.buffer;
  }
  return array.slice().buffer;
}

function headerHasSolid(data: ArrayBuffer): boolean {
  if (data.byteLength < 5) {
    return false;
  }
  const bytes = new Uint8Array(data);
  const searchLimit = Math.min(5, data.byteLength - 4);
  for (let offset = 0; offset < searchLimit; offset += 1) {
    let matches = true;
    for (let index = 0; index < ASCII_SOLID.length; index += 1) {
      if (bytes[offset + index] !== ASCII_SOLID[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }
  return false;
}

function readBinaryFaceCount(data: ArrayBuffer): number {
  return new DataView(data).getUint32(80, true);
}

function parseBinaryStl(data: ArrayBuffer, faceCount: number): SerializedStlGeometryData {
  if (data.byteLength < 84 + faceCount * 50) {
    throw new Error('STL binary face count does not fit in the buffer');
  }
  if (faceCount === 0) {
    return { positions: new Float32Array(0).buffer, maxDimension: null };
  }

  const source = new Uint8Array(data);
  const positions = new Float32Array(faceCount * 9);
  const scratchBuffer = new ArrayBuffer(36);
  const scratchBytes = new Uint8Array(scratchBuffer);
  const scratchFloats = new Float32Array(scratchBuffer);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let face = 0; face < faceCount; face += 1) {
    const vertexStart = 96 + face * 50;
    scratchBytes.set(source.subarray(vertexStart, vertexStart + 36));
    if (!littleEndian) {
      for (let word = 0; word < 9; word += 1) {
        const offset = word * 4;
        const first = scratchBytes[offset];
        const second = scratchBytes[offset + 1];
        scratchBytes[offset] = scratchBytes[offset + 3];
        scratchBytes[offset + 1] = scratchBytes[offset + 2];
        scratchBytes[offset + 2] = second;
        scratchBytes[offset + 3] = first;
      }
    }
    const base = face * 9;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const x = scratchFloats[vertex * 3];
      const y = scratchFloats[vertex * 3 + 1];
      const z = scratchFloats[vertex * 3 + 2];
      positions[base + vertex * 3] = x;
      positions[base + vertex * 3 + 1] = y;
      positions[base + vertex * 3 + 2] = z;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }

  return {
    positions: positions.buffer,
    maxDimension: Math.max(maxX - minX, maxY - minY, maxZ - minZ),
  };
}

function parseAsciiStl(data: ArrayBuffer): SerializedStlGeometryData {
  const geometry = new STLLoader().parse(data);
  const positionAttribute = geometry.getAttribute('position');
  if (!(positionAttribute?.array instanceof Float32Array)) {
    throw new Error('Failed to parse STL geometry attributes');
  }
  geometry.computeBoundingBox();
  let maxDimension: number | null = null;
  if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
    const size = geometry.boundingBox.getSize(loaderScopeSizeVector);
    maxDimension = Math.max(size.x, size.y, size.z);
  }
  return {
    positions: extractTransferableBuffer(positionAttribute.array),
    maxDimension,
  };
}

export function parseStlGeometryData(data: ArrayBuffer): SerializedStlGeometryData {
  if (data.byteLength >= 84) {
    const faceCount = readBinaryFaceCount(data);
    if (84 + faceCount * 50 === data.byteLength) {
      return parseBinaryStl(data, faceCount);
    }
  }
  if (headerHasSolid(data)) {
    return parseAsciiStl(data);
  }
  if (data.byteLength < 84) {
    throw new Error('STL binary data is shorter than the 84-byte header');
  }
  return parseBinaryStl(data, readBinaryFaceCount(data));
}

export function createGeometryFromSerializedStlData(data: SerializedStlGeometryData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(data.positions), 3));
  geometry.userData.requiresFlatShading = true;
  return geometry;
}
