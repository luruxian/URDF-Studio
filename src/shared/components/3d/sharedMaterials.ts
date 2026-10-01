import * as THREE from 'three';

import {
  collisionBaseMaterial,
  collisionFlatShadingMaterial,
  collisionHighlightMaterial,
  highlightFaceMaterial,
  highlightMaterial,
} from './materials';

export const SHARED_MATERIALS = new Set<THREE.Material>([
  highlightMaterial,
  highlightFaceMaterial,
  collisionHighlightMaterial,
  collisionBaseMaterial,
  collisionFlatShadingMaterial,
]);
