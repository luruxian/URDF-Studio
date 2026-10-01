import type { BufferGeometry, Material } from 'three';

type FlatShadedMaterial = Material & { flatShading?: boolean };

export function materialForStlGeometry<T extends Material>(
  geometry: BufferGeometry,
  material: T,
): T {
  if (geometry.userData?.requiresFlatShading !== true) {
    return material;
  }
  const flatShaded = material as FlatShadedMaterial;
  if (flatShaded.flatShading === true) {
    return material;
  }
  const next = material.clone() as T & FlatShadedMaterial;
  next.flatShading = true;
  return next;
}
