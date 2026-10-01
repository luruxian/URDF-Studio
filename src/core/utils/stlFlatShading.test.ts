import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, MeshPhongMaterial } from 'three';

import { materialForStlGeometry } from './stlFlatShading.ts';

test('materialForStlGeometry leaves a shared material unchanged', () => {
  const geometry = new BufferGeometry();
  geometry.userData.requiresFlatShading = true;
  const shared = new MeshPhongMaterial();
  const assigned = materialForStlGeometry(geometry, shared);
  assert.notEqual(assigned, shared);
  assert.equal(assigned.flatShading, true);
  assert.equal(shared.flatShading, false);
});

test('materialForStlGeometry reuses a material that is already flat shaded', () => {
  const geometry = new BufferGeometry();
  geometry.userData.requiresFlatShading = true;
  const material = new MeshPhongMaterial();
  material.flatShading = true;
  assert.equal(materialForStlGeometry(geometry, material), material);
});

test('materialForStlGeometry leaves materials for other geometries unchanged', () => {
  const geometry = new BufferGeometry();
  const material = new MeshPhongMaterial();
  assert.equal(materialForStlGeometry(geometry, material), material);
  assert.equal(material.flatShading, false);
});
