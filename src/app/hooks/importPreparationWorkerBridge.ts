import {
  type PrepareImportPayloadArgs,
  type ImportPreparationFileDescriptor,
  type PreparedDeferredImportAssetFile,
  type PreparedImportBlobFile,
  type PreparedImportPayload,
  type PrepareImportProgress,
  type ImportPreparationWorkerRequest,
  type ImportPreparationWorkerResponse,
} from '@/app/utils/importPreparation';
import { prepareImportPayload } from '@/app/utils/importPreparation';

interface PendingWorkerRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: PrepareImportProgress) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const pendingWorkerRequests = new Map<number, PendingWorkerRequest>();
let requestIdCounter = 0;
let sharedWorker: Worker | null = null;
let workerUnavailable = false;

function clearPendingWorkerRequest(requestId: number): PendingWorkerRequest | null {
  const pendingRequest = pendingWorkerRequests.get(requestId) ?? null;
  if (!pendingRequest) {
    return null;
  }

  pendingWorkerRequests.delete(requestId);
  if (pendingRequest.timeoutId !== undefined) {
    clearTimeout(pendingRequest.timeoutId);
    pendingRequest.timeoutId = undefined;
  }
  return pendingRequest;
}

function disposeSharedWorker(rejectPendingWith?: unknown): void {
  const rejectionReason = rejectPendingWith ?? new Error('Import preparation worker disposed');

  if (sharedWorker) {
    sharedWorker.removeEventListener('message', handleSharedWorkerMessage);
    sharedWorker.removeEventListener('error', handleSharedWorkerError);
    sharedWorker.removeEventListener('messageerror', handleSharedWorkerMessageError);
    sharedWorker.terminate();
    sharedWorker = null;
  }

  if (pendingWorkerRequests.size > 0) {
    Array.from(pendingWorkerRequests.entries()).forEach(([requestId, request]) => {
      clearPendingWorkerRequest(requestId);
      request.reject(rejectionReason);
    });
  }
}

function createWorkerTimeoutError(requestId: number): Error {
  return new Error(
    'Import preparation worker did not respond within the timeout '
      + `(likely a worker crash). Request id: ${requestId}. Timeout: ${REQUEST_TIMEOUT_MS} ms.`,
  );
}

function registerRequestTimeout(requestId: number, request: PendingWorkerRequest): void {
  request.timeoutId = setTimeout(() => {
    disposeSharedWorker(createWorkerTimeoutError(requestId));
  }, REQUEST_TIMEOUT_MS);
}

function handleSharedWorkerMessage(event: MessageEvent<ImportPreparationWorkerResponse>): void {
  const message = event.data;
  if (!message) {
    return;
  }

  // Log every message arriving from the worker (diagnostic). This includes
  // both the `__diag:true` self-reports and protocol messages.
  console.error('[import prep worker] msg from worker', message);

  // Diagnostic traffic from inside the worker — not part of the request protocol.
  const diag = message as unknown as { __diag?: boolean; kind?: string };
  if (diag?.__diag) {
    return;
  }

  const pendingRequest = pendingWorkerRequests.get(message.requestId) ?? null;
  if (!pendingRequest) {
    return;
  }

  if (
    message.type === 'prepare-import-progress' ||
    message.type === 'hydrate-deferred-import-assets-progress'
  ) {
    if (message.progress) {
      pendingRequest.onProgress?.(message.progress);
    }
    return;
  }

  clearPendingWorkerRequest(message.requestId);

  if (
    message.type === 'prepare-import-error' ||
    message.type === 'hydrate-deferred-import-assets-error'
  ) {
    pendingRequest.reject(new Error(message.error || 'Import preparation worker failed'));
    return;
  }

  if (message.type === 'prepare-import-result') {
    if (!message.payload) {
      pendingRequest.reject(new Error('Import preparation worker returned no payload'));
      return;
    }

    pendingRequest.resolve(message.payload);
    return;
  }

  if (message.type === 'hydrate-deferred-import-assets-result') {
    pendingRequest.resolve(message.assetFiles ?? []);
    return;
  }

  pendingRequest.reject(new Error('Import preparation worker returned an unexpected response'));
}

function handleSharedWorkerError(event: Event): void {
  workerUnavailable = true;
  const anyEvent = event as unknown as Record<string, unknown> & { type?: string };
  console.error('[import prep worker] error event', {
    eventType: anyEvent?.type,
    constructor: (event as object)?.constructor?.name,
    keys: event ? Object.keys(event) : null,
    ownProps: event ? Object.getOwnPropertyNames(event) : null,
    eventSelf: event,
    eventMessage: anyEvent?.message,
    eventFilename: anyEvent?.filename,
    eventLineno: anyEvent?.lineno,
    eventColno: anyEvent?.colno,
    eventError: anyEvent?.error,
    pageCrossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
    pageSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : null,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
  });
  const message =
    (typeof anyEvent?.message === 'string' && anyEvent.message) ||
    (anyEvent?.error instanceof Error && (anyEvent.error as Error).message) ||
    '';
  const error =
    anyEvent?.error instanceof Error
      ? (anyEvent.error as Error)
      : new Error(message || 'Import preparation worker failed');
  disposeSharedWorker(error);
}

function handleSharedWorkerMessageError(event: Event): void {
  workerUnavailable = true;
  const anyEvent = event as unknown as Record<string, unknown>;
  console.error('[import prep worker] messageerror event', {
    eventType: anyEvent?.type,
    constructor: (event as object)?.constructor?.name,
    keys: event ? Object.keys(event) : null,
    eventSelf: event,
  });
  disposeSharedWorker(new Error('Import preparation worker message transfer failed'));
}

function ensureSharedWorker(): Worker {
  if (!sharedWorker) {
    workerUnavailable = false;
    try {
      sharedWorker = new Worker(new URL('../workers/importPreparation.worker.ts', import.meta.url), {
        type: 'module',
      });
      sharedWorker.addEventListener('message', handleSharedWorkerMessage);
      sharedWorker.addEventListener('error', handleSharedWorkerError as EventListener);
      sharedWorker.addEventListener('messageerror', handleSharedWorkerMessageError as EventListener);
      console.error('[import prep worker] worker created', {
        ctor: sharedWorker?.constructor?.name,
        pageCrossOriginIsolated:
          typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
        pageSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : null,
        hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      });
    } catch (creationError) {
      workerUnavailable = true;
      console.error('[import prep worker] worker creation threw', {
        name: (creationError as Error)?.name,
        message: (creationError as Error)?.message,
        stack: (creationError as Error)?.stack,
      });
      throw creationError;
    }
  }

  return sharedWorker;
}

function warnMainThreadImportFallback(reason: string): void {
  console.warn(`[import prep worker] falling back to main-thread payload preparation (${reason})`);
}

async function prepareImportPayloadOnMainThread(
  args: PrepareImportPayloadArgs,
  reason: string,
): Promise<PreparedImportPayload> {
  warnMainThreadImportFallback(reason);
  return prepareImportPayload(args);
}

function invokePrepareImportPayloadWorker(
  args: PrepareImportPayloadArgs,
): Promise<PreparedImportPayload> {
  return new Promise<PreparedImportPayload>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let worker: Worker;

    try {
      worker = ensureSharedWorker();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    const files: ImportPreparationFileDescriptor[] = [...args.files].map((input) => {
      if (input instanceof File) {
        return {
          file: input,
          relativePath: input.webkitRelativePath || input.name,
        };
      }

      return {
        file: input.file,
        relativePath: input.relativePath || input.file.webkitRelativePath || input.file.name,
      };
    });
    const request: ImportPreparationWorkerRequest = {
      type: 'prepare-import',
      requestId,
      files,
      existingPaths: [...args.existingPaths],
      preResolvePreferredImport: args.preResolvePreferredImport,
    };

    const pendingRequest: PendingWorkerRequest = {
      resolve: (value) => resolve(value as PreparedImportPayload),
      reject,
      onProgress: args.onProgress,
    };
    pendingWorkerRequests.set(requestId, pendingRequest);
    registerRequestTimeout(requestId, pendingRequest);

    try {
      worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingWorkerRequest(requestId);
      disposeSharedWorker(error);
      reject(error);
    }
  });
}

export async function prepareImportPayloadWithWorker(
  args: PrepareImportPayloadArgs,
): Promise<PreparedImportPayload> {
  // Auto-fallback to the main-thread implementation whenever the worker is
  // known to be unavailable (creation failed or sanitized error event fired).
  // Running prepareImportPayload on the main thread is slower but functionally
  // equivalent for non-archive imports; the worker provides the perf win.
  if (workerUnavailable) {
    return prepareImportPayloadOnMainThread(args, 'worker previously unavailable');
  }

  if (typeof Worker === 'undefined') {
    return prepareImportPayloadOnMainThread(args, 'Worker is undefined');
  }

  try {
    return await invokePrepareImportPayloadWorker(args);
  } catch (error) {
    if (workerUnavailable) {
      return prepareImportPayloadOnMainThread(args, 'worker request failed');
    }
    throw error;
  }
}

interface HydrateDeferredImportAssetsWithWorkerArgs {
  archiveFile: File;
  assetFiles: readonly PreparedDeferredImportAssetFile[];
  onProgress?: (progress: PrepareImportProgress) => void;
}

export async function hydrateDeferredImportAssetsWithWorker({
  archiveFile,
  assetFiles,
  onProgress,
}: HydrateDeferredImportAssetsWithWorkerArgs): Promise<PreparedImportBlobFile[]> {
  if (workerUnavailable && sharedWorker) {
    throw new Error('Import preparation worker is unavailable');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is not available in this environment');
  }

  return new Promise<PreparedImportBlobFile[]>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let worker: Worker;

    try {
      worker = ensureSharedWorker();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    const request: ImportPreparationWorkerRequest = {
      type: 'hydrate-deferred-import-assets',
      requestId,
      archiveFile,
      assetFiles: [...assetFiles],
    };

    const pendingRequest: PendingWorkerRequest = {
      resolve: (value) => resolve(value as PreparedImportBlobFile[]),
      reject,
      onProgress,
    };
    pendingWorkerRequests.set(requestId, pendingRequest);
    registerRequestTimeout(requestId, pendingRequest);

    try {
      worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingWorkerRequest(requestId);
      disposeSharedWorker(error);
      reject(error);
    }
  });
}

export function disposeImportPreparationWorker(): void {
  workerUnavailable = false;
  requestIdCounter = 0;
  disposeSharedWorker();
}
