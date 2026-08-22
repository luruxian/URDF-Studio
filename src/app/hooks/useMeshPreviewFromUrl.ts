import { useEffect, useRef } from 'react';
import {
  fetchAuthenticatedGlb,
  parseMeshDeepLink,
  persistMeshAuth,
  resolveMeshAuthErrorCode,
  type MeshAuthErrorCode,
} from '@/integrations/agile-robot';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';
import {
  MESH_PREVIEW_QUERY_PARAM,
  filenameFromContentDisposition,
  filenameFromMeshPreviewUrl,
  mimeTypeForMeshPreviewFilename,
  resolveAuthenticatedMeshPreviewUrl,
  resolveMeshPreviewUrl,
  stripMeshPreviewParamFromUrl,
} from '@/shared/utils/meshPreviewFromUrl';
import type { HandleImportResult } from './useFileImport';

const MAX_MESH_PREVIEW_BYTES = 512 * 1024 * 1024;

export type MeshPreviewFailureReason = MeshAuthErrorCode | 'import_failed';

export interface UseMeshPreviewFromUrlOptions {
  handleImport: (files: readonly File[]) => Promise<HandleImportResult>;
  onImportComplete?: (success: boolean, failureReason?: MeshPreviewFailureReason) => void;
}

function assertMeshPreviewSize(byteLength: number): void {
  if (byteLength > MAX_MESH_PREVIEW_BYTES) {
    throw new Error(`Mesh preview exceeds ${MAX_MESH_PREVIEW_BYTES} bytes`);
  }
}

async function fetchUnauthenticatedMeshPreviewFile(meshUrl: string): Promise<File> {
  const response = await fetch(meshUrl, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`glb_fetch_failed:${response.status}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength)) {
      assertMeshPreviewSize(contentLength);
    }
  }

  const blob = await response.blob();
  assertMeshPreviewSize(blob.size);

  const filename =
    filenameFromContentDisposition(response.headers.get('content-disposition')) ??
    filenameFromMeshPreviewUrl(meshUrl);
  return new File([blob], filename, {
    type: blob.type || mimeTypeForMeshPreviewFilename(filename),
  });
}

async function fetchAuthenticatedMeshPreviewFile(
  meshUrl: string,
  previewToken: string,
): Promise<File> {
  const buffer = await fetchAuthenticatedGlb(meshUrl, previewToken);
  assertMeshPreviewSize(buffer.byteLength);

  const filename = filenameFromMeshPreviewUrl(meshUrl);
  return new File([buffer], filename, {
    type: mimeTypeForMeshPreviewFilename(filename),
  });
}

function failureReasonFromError(error: unknown): MeshPreviewFailureReason {
  return resolveMeshAuthErrorCode(error) ?? 'import_failed';
}

/**
 * Reads `?mesh=` (+ optional `?mesh_auth=`) on mount, fetches the GLB/GLTF file,
 * and imports it through the standard file-import workflow.
 *
 * Robots deep links use Bearer auth from mesh_auth (or legacy preview_token).
 * Same-origin sibling handoffs without a token keep an unauthenticated fetch.
 */
export function useMeshPreviewFromUrl(options: UseMeshPreviewFromUrlOptions): void {
  const { handleImport, onImportComplete } = options;
  const handleImportRef = useRef(handleImport);
  handleImportRef.current = handleImport;
  const onImportCompleteRef = useRef(onImportComplete);
  onImportCompleteRef.current = onImportComplete;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const rawMesh = params.get(MESH_PREVIEW_QUERY_PARAM)?.trim() ?? '';
    if (!rawMesh) {
      return;
    }

    const deepLink = parseMeshDeepLink(window.location.search);
    const nextUrl = stripMeshPreviewParamFromUrl(window.location.href);
    window.history.replaceState(window.history.state, '', nextUrl);

    void (async () => {
      let meshUrlForLog = rawMesh;
      try {
        if (deepLink) {
          const validated = resolveAuthenticatedMeshPreviewUrl(deepLink.meshUrl);
          if (!validated) {
            onImportCompleteRef.current?.(false, 'import_failed');
            return;
          }
          meshUrlForLog = validated;
          persistMeshAuth({ meshUrl: validated, previewToken: deepLink.previewToken });
          const file = await fetchAuthenticatedMeshPreviewFile(
            validated,
            deepLink.previewToken,
          );
          const result = await handleImportRef.current([file], { forceLoadRobot: true });
          onImportCompleteRef.current?.(result.status === 'completed');
          return;
        }

        const validated = resolveMeshPreviewUrl(rawMesh, window.location.href);
        if (!validated) {
          onImportCompleteRef.current?.(false, 'import_failed');
          return;
        }
        meshUrlForLog = validated;

        const meshOrigin = new URL(validated).origin;
        const pageOrigin = new URL(window.location.href).origin;
        if (meshOrigin !== pageOrigin) {
          // Cross-origin GLB without mesh_auth / legacy preview_token.
          onImportCompleteRef.current?.(false, 'auth_missing');
          return;
        }

        const file = await fetchUnauthenticatedMeshPreviewFile(validated);
        const result = await handleImportRef.current([file]);
        onImportCompleteRef.current?.(result.status === 'completed');
      } catch (error) {
        logRegressionError('[mesh-preview] Failed to import mesh from URL:', meshUrlForLog, error);
        onImportCompleteRef.current?.(false, failureReasonFromError(error));
      }
    })();
  }, []);
}
