import { use, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createGeometryFromSerializedStlData } from '@/core/loaders/stlGeometryData';
import { loadSerializedStlGeometryData } from '@/core/loaders/stlParseWorkerBridge';
import { materialForStlGeometry } from '@/core/utils/stlFlatShading';

interface ScaleProps {
  x: number;
  y: number;
  z: number;
}

interface STLRendererImplProps {
  url: string;
  material: THREE.Material;
  enableShadows?: boolean;
  scale?: ScaleProps;
  onResolved?: () => void;
}

export function STLRendererImpl({
  url,
  material,
  enableShadows = true,
  scale,
  onResolved,
}: STLRendererImplProps) {
  const serializedGeometry = use(useMemo(() => loadSerializedStlGeometryData(url), [url]));
  const clone = useMemo(
    () => createGeometryFromSerializedStlData(serializedGeometry),
    [serializedGeometry],
  );
  const meshMaterial = useMemo(
    () => materialForStlGeometry(clone, material),
    [clone, material],
  );

  useEffect(() => {
    onResolved?.();
  }, [clone, onResolved]);

  useEffect(
    () => () => {
      clone.dispose();
    },
    [clone],
  );

  useEffect(
    () => () => {
      if (meshMaterial !== material) {
        meshMaterial.dispose();
      }
    },
    [meshMaterial, material],
  );

  const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];

  return (
    <mesh
      geometry={clone}
      material={meshMaterial}
      rotation={[0, 0, 0]}
      scale={scaleArr}
      castShadow={enableShadows}
      receiveShadow={enableShadows}
    />
  );
}

export default STLRendererImpl;
