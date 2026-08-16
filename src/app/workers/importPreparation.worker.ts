/// <reference lib="webworker" />

import {
  prepareImportPayload,
  hydrateDeferredImportAssets,
  type ImportPreparationWorkerRequest,
  type ImportPreparationWorkerResponse,
} from '@/app/utils/importPreparation';
import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

// Diagnostic: report module-eval failures back to the main thread BEFORE
// Chrome sanitizes them into a useless generic ErrorEvent.
try {
  ensureWorkerXmlDomApis(workerScope as unknown as typeof globalThis);
  workerScope.postMessage({
    __diag: true,
    kind: 'worker-ready',
    isolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
    hasSAB: typeof SharedArrayBuffer !== 'undefined',
  });
} catch (initError) {
  workerScope.postMessage({
    __diag: true,
    kind: 'worker-init-failed',
    error: {
      name: (initError as Error)?.name,
      message: (initError as Error)?.message,
      stack: (initError as Error)?.stack,
    },
  });
  throw initError;
}

workerScope.addEventListener('error', (event) => {
  // Captured before Chrome sanitizes / before we get the empty bridge error.
  workerScope.postMessage({
    __diag: true,
    kind: 'worker-runtime-error',
    message: event.message || null,
    filename: event.filename || null,
    lineno: event.lineno ?? null,
    colno: event.colno ?? null,
    errorName: event.error?.name ?? null,
    errorMessage: event.error?.message ?? null,
    errorStack: event.error?.stack ?? null,
  });
});

workerScope.addEventListener(
  'message',
  async (event: MessageEvent<ImportPreparationWorkerRequest>) => {
    const message = event.data;
    if (!message) {
      return;
    }

    try {
      if (message.type === 'prepare-import') {
        const payload = await prepareImportPayload({
          files: message.files,
          existingPaths: message.existingPaths,
          preResolvePreferredImport: message.preResolvePreferredImport,
          onProgress: (progress) => {
            const progressResponse: ImportPreparationWorkerResponse = {
              type: 'prepare-import-progress',
              requestId: message.requestId,
              progress,
            };
            workerScope.postMessage(progressResponse);
          },
        });
        const response: ImportPreparationWorkerResponse = {
          type: 'prepare-import-result',
          requestId: message.requestId,
          payload,
        };
        workerScope.postMessage(response);
        return;
      }

      if (message.type === 'hydrate-deferred-import-assets') {
        const assetFiles = await hydrateDeferredImportAssets(
          message.archiveFile,
          message.assetFiles,
          (progress) => {
            const progressResponse: ImportPreparationWorkerResponse = {
              type: 'hydrate-deferred-import-assets-progress',
              requestId: message.requestId,
              progress,
            };
            workerScope.postMessage(progressResponse);
          },
        );
        const response: ImportPreparationWorkerResponse = {
          type: 'hydrate-deferred-import-assets-result',
          requestId: message.requestId,
          assetFiles,
        };
        workerScope.postMessage(response);
      }
    } catch (error) {
      const response: ImportPreparationWorkerResponse = {
        type:
          message.type === 'hydrate-deferred-import-assets'
            ? 'hydrate-deferred-import-assets-error'
            : 'prepare-import-error',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : 'Import preparation worker failed',
      };
      workerScope.postMessage(response);
    }
  },
);

// Module workers must have at least one live `import` or `export` to be
// recognized as an ES module by the browser. `export {};` alone is treated
// as a dead-code side-effect-free statement and stripped by minifiers,
// which breaks `new Worker(url, { type: 'module' })` loading. Pin a live
// export to a sentinel function so the bundle keeps the export.
export const __workerSentinel = (): void => {
  /* module worker no-op */
};
