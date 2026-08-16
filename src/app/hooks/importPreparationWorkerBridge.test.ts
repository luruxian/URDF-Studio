import test from 'node:test';
import assert from 'node:assert/strict';

import {
  disposeImportPreparationWorker,
  prepareImportPayloadWithWorker,
} from './importPreparationWorkerBridge.ts';

type WorkerEventHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

class FakeWorker {
  private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

  public readonly postedMessages: unknown[] = [];

  public terminated = false;

  addEventListener(type: string, handler: WorkerEventHandler): void {
    const handlers = this.listeners.get(type) ?? new Set<WorkerEventHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: WorkerEventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessageError(error: Error): void {
    this.listeners.get('messageerror')?.forEach((handler) => {
      handler({ error, message: error.message });
    });
  }

  emitError(): void {
    this.listeners.get('error')?.forEach((handler) => {
      handler({ type: 'error' });
    });
  }
}

test('import preparation worker bridge falls back to main thread when worker errors during the first request', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    queueMicrotask(() => {
      worker.emitError();
    });
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });

  try {
    const result = await prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });

    assert.deepEqual(result, {
      robotFiles: [],
      assetFiles: [],
      deferredAssetFiles: [],
      usdSourceFiles: [],
      libraryFiles: [],
      textFiles: [],
      preferredFileName: null,
      preResolvedImports: [],
    });
    assert.equal(fakeWorkers[0]?.terminated, true);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('import preparation worker bridge uses main thread when Worker is undefined', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    const result = await prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });

    assert.deepEqual(result, {
      robotFiles: [],
      assetFiles: [],
      deferredAssetFiles: [],
      usdSourceFiles: [],
      libraryFiles: [],
      textFiles: [],
      preferredFileName: null,
      preResolvedImports: [],
    });
  } finally {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('import preparation worker bridge falls back when message transfer fails', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });

  try {
    const resultPromise = prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });

    const fakeWorker = fakeWorkers[0];
    assert.ok(fakeWorker);
    assert.equal(fakeWorker.postedMessages.length, 1);
    fakeWorker.emitMessageError(new Error('structured clone failed'));

    const result = await resultPromise;
    assert.deepEqual(result, {
      robotFiles: [],
      assetFiles: [],
      deferredAssetFiles: [],
      usdSourceFiles: [],
      libraryFiles: [],
      textFiles: [],
      preferredFileName: null,
      preResolvedImports: [],
    });
    assert.equal(fakeWorker.terminated, true);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});
