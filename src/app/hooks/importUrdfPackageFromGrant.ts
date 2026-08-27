import type { UrdfPackageImportPort } from '@/integrations/robots-studio';

/** Minimal contract for routing a mesh import-grant through the Bot-World download pipeline. */
export type ImportAssetFromBotWorldFn = (
  assetId: string,
  fromOrigin: string,
  forceLoadRobot?: boolean,
) => Promise<{ success: boolean }>;

/**
 * Routes a robots mesh `import-grant` through the standard download-asset /
 * file-import pipeline so the workspace reloads with the regenerated URDF+STL package.
 */
export async function importUrdfPackageFromGrant(
  params: {
    importGrantId: string;
    fromOrigin: string;
  },
  importAssetFromBotWorld: ImportAssetFromBotWorldFn,
): Promise<void> {
  const result = await importAssetFromBotWorld(
    params.importGrantId,
    params.fromOrigin,
    true,
  );
  if (!result.success) {
    throw new Error('Failed to import URDF package from grant');
  }
}

/** Builds the import port expected by `createStudioModificationTools`. */
export function createUrdfPackageImportPort(
  importAssetFromBotWorld: ImportAssetFromBotWorldFn,
): UrdfPackageImportPort['importUrdfPackage'] {
  return (params) => importUrdfPackageFromGrant(params, importAssetFromBotWorld);
}
