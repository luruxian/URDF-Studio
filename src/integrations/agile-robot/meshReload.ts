// ============================================================
// Mesh hot-reload
// ============================================================

import {
  fetchAuthenticatedGlb,
  getStoredMeshAuth,
  updateStoredMeshUrl,
} from './meshAuth';

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
 * Fetch a GLB from the given preview_url (stable URL, no token) using the
 * mesh_auth JWT stored in sessionStorage, then route it through the app's
 * file-import pipeline. Throws missing_mesh_auth / preview_token_expired /
 * glb_fetch_failed:* on auth or HTTP failures.
 */
export async function reloadMeshFromUrl(
  previewUrl: string,
  port: MeshReloadImportPort,
  /** From hunyuan job.filename; CORS does not expose Content-Disposition on preview_url. */
  filename?: string | null,
): Promise<void> {
  const auth = getStoredMeshAuth();
  if (!auth) {
    throw new Error('missing_mesh_auth');
  }

  const buffer = await fetchAuthenticatedGlb(previewUrl, auth.previewToken);
  if (buffer.byteLength === 0) {
    throw new Error('Empty mesh response');
  }

  const meshFilename = filename?.trim() || 'updated_model.glb';
  const file = new File([buffer], meshFilename, {
    type: 'model/gltf-binary',
  });

  await port.importMeshFile(file);
  updateStoredMeshUrl(previewUrl);
}
