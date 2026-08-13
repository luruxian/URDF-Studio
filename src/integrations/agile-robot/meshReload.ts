// ============================================================
// Mesh hot-reload
// ============================================================

/** Port injected by the app layer so a regenerated GLB can be routed through
 *  the standard file-import pipeline (which swaps the model in the 3D
 *  viewport). The integration layer must not depend on app/features, so the
 *  app layer supplies this narrow contract instead of the integration importing
 *  handleImport directly. */
export interface MeshReloadImportPort {
  /** Import a GLB File as the current robot, replacing the visible model. */
  importMeshFile: (file: File) => Promise<unknown>;
}

/**
 * Fetch a GLB from the given preview_url and route it through the app's
 * file-import pipeline so the 3D viewport shows the regenerated model.
 * Throws when the response is not OK or the body is empty. The provided port
 * owns the actual import (the app layer reuses handleImport with
 * forceLoadRobot, matching how ?mesh= loads a GLB into the workspace).
 */
export async function reloadMeshFromUrl(
  previewUrl: string,
  port: MeshReloadImportPort,
): Promise<void> {
  const response = await fetch(previewUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch mesh: ${response.status}`);
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error('Empty mesh response');
  }

  const file = new File([blob], 'updated_model.glb', {
    type: 'model/gltf-binary',
  });

  await port.importMeshFile(file);
}
