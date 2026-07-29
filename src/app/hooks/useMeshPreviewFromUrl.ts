import { useEffect, useRef } from 'react';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';
import {
  filenameFromContentDisposition,
  filenameFromMeshPreviewUrl,
  mimeTypeForMeshPreviewFilename,
  readMeshPreviewUrlFromLocation,
  stripMeshPreviewParamFromUrl,
} from '@/shared/utils/meshPreviewFromUrl';
import type { HandleImportResult } from './useFileImport';

const MAX_MESH_PREVIEW_BYTES = 512 * 1024 * 1024;

export interface UseMeshPreviewFromUrlOptions {
  handleImport: (files: readonly File[]) => Promise<HandleImportResult>;
  onImportComplete?: (success: boolean) => void;
}

async function fetchMeshPreviewFile(meshUrl: string): Promise<File> {
  const response = await fetch(meshUrl, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Mesh preview fetch failed with HTTP ${response.status}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_MESH_PREVIEW_BYTES) {
      throw new Error(`Mesh preview exceeds ${MAX_MESH_PREVIEW_BYTES} bytes`);
    }
  }

  const blob = await response.blob();
  if (blob.size > MAX_MESH_PREVIEW_BYTES) {
    throw new Error(`Mesh preview exceeds ${MAX_MESH_PREVIEW_BYTES} bytes`);
  }

  const filename =
    filenameFromContentDisposition(response.headers.get('content-disposition')) ??
    filenameFromMeshPreviewUrl(meshUrl);
  return new File([blob], filename, {
    type: blob.type || mimeTypeForMeshPreviewFilename(filename),
  });
}

/**
 * Reads `?mesh=<same-origin-url>` on mount, fetches the GLB/GLTF file, and
 * imports it through the standard file-import workflow.
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

    const meshUrl = readMeshPreviewUrlFromLocation(window.location.href);
    if (!meshUrl) {
      return;
    }

    const nextUrl = stripMeshPreviewParamFromUrl(window.location.href);
    window.history.replaceState(window.history.state, '', nextUrl);

    void (async () => {
      try {
        const file = await fetchMeshPreviewFile(meshUrl);
        const result = await handleImportRef.current([file]);
        onImportCompleteRef.current?.(result.status === 'completed');
      } catch (error) {
        logRegressionError('[mesh-preview] Failed to import mesh from URL:', meshUrl, error);
        onImportCompleteRef.current?.(false);
      }
    })();
  }, []);
}
