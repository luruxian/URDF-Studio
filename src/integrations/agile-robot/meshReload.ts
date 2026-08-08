import { useAssetsStore } from '@/store';

// ============================================================
// Mesh hot-reload
// ============================================================

/** assetsStore key under which the hot-reloaded GLB blob URL is stored. The
 *  viewer reads this key and re-renders when the blob URL changes. */
export const AGILE_ROBOT_PREVIEW_ASSET_KEY = '__agile_robot_preview__/updated_model.glb';

/**
 * Fetch a GLB from the given preview_url and hot-reload it into the viewer.
 * Creates a blob URL and stores it in assetsStore under
 * AGILE_ROBOT_PREVIEW_ASSET_KEY, replacing any previously stored mesh. Throws
 * when the response is not OK or the body is empty. Cleanup of the replaced
 * blob URL is handled by assetsStore.addAsset, which revokes it.
 */
export async function reloadMeshFromUrl(previewUrl: string): Promise<void> {
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

  const blobUrl = URL.createObjectURL(file);
  useAssetsStore.getState().addAsset(AGILE_ROBOT_PREVIEW_ASSET_KEY, blobUrl);
}
