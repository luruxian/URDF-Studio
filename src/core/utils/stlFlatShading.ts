import type { BufferGeometry, Material, Object3D } from 'three';

type FlatShadedMaterial = Material & { flatShading?: boolean };

type MeshWithMaterial = Object3D & {
  isMesh: boolean;
  geometry: BufferGeometry;
  material: Material | Material[];
};

function isMeshWithMaterial(object: Object3D): object is MeshWithMaterial {
  const mesh = object as MeshWithMaterial;
  return mesh.isMesh === true && mesh.geometry != null && mesh.material != null;
}

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

/**
 * Reapply STL flat shading after a material upgrade.
 *
 * Upgrades such as `enhanceMaterials` replace the loader Phong material with a
 * shared MeshStandardMaterial that has flat shading off. Cloning here keeps
 * that shared material unchanged for meshes that still have normals.
 */
export function assignMaterialForStlGeometry(root: Object3D): void {
  root.traverse((object) => {
    if (!isMeshWithMaterial(object)) {
      return;
    }

    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) =>
        materialForStlGeometry(object.geometry, material),
      );
      return;
    }

    object.material = materialForStlGeometry(object.geometry, object.material);
  });
}
