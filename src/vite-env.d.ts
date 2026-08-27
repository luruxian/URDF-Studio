/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** URDF+STL mesh job poll interval (ms). Default: 5000. */
  readonly VITE_MESH_JOB_POLL_INTERVAL_MS?: string;
  /** URDF+STL mesh job client poll timeout (ms). Default: 900000 (15 min). */
  readonly VITE_MESH_JOB_POLL_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Monaco ships its ESM internals without per-entry type declarations. The source
// editor intentionally imports the trimmed `edcore.main` entry (see
// src/features/code-editor/utils/monacoLoader.ts) to drop the unused language
// services. Alias its types to the package's public API surface; the imported
// namespace is only handed to `loader.config({ monaco })`, never dot-accessed
// for the language-service members edcore.main omits at runtime.
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor';
}
