// ============================================================
// URDF+STL mesh job poll timing (env-configurable)
// ============================================================

/** Default poll interval when env is unset or invalid (ms). */
export const DEFAULT_MESH_JOB_POLL_INTERVAL_MS = 5000;

/** Default poll timeout when env is unset or invalid (ms). */
export const DEFAULT_MESH_JOB_POLL_TIMEOUT_MS = 15 * 60 * 1000;

const MIN_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 60_000;
const MIN_POLL_TIMEOUT_MS = 10_000;
const MAX_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface MeshJobPollEnvSource {
  VITE_MESH_JOB_POLL_INTERVAL_MS?: string;
  VITE_MESH_JOB_POLL_TIMEOUT_MS?: string;
}

const readImportMetaEnv = (): MeshJobPollEnvSource => {
  return ((import.meta as ImportMeta & { env?: MeshJobPollEnvSource }).env ??
    {}) as MeshJobPollEnvSource;
};

const readProcessEnv = (): MeshJobPollEnvSource => {
  if (typeof process === 'undefined') {
    return {};
  }
  return {
    VITE_MESH_JOB_POLL_INTERVAL_MS: process.env.VITE_MESH_JOB_POLL_INTERVAL_MS,
    VITE_MESH_JOB_POLL_TIMEOUT_MS: process.env.VITE_MESH_JOB_POLL_TIMEOUT_MS,
  };
};

function parsePositiveMs(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return fallback;
  }
  return parsed;
}

export interface MeshJobPollConfig {
  intervalMs: number;
  timeoutMs: number;
}

/** Resolve poll interval/timeout from Vite or Node process env. */
export function resolveMeshJobPollConfig(
  viteEnv: MeshJobPollEnvSource = readImportMetaEnv(),
  processEnv: MeshJobPollEnvSource = readProcessEnv(),
): MeshJobPollConfig {
  const intervalMs = parsePositiveMs(
    viteEnv.VITE_MESH_JOB_POLL_INTERVAL_MS ?? processEnv.VITE_MESH_JOB_POLL_INTERVAL_MS,
    DEFAULT_MESH_JOB_POLL_INTERVAL_MS,
    { min: MIN_POLL_INTERVAL_MS, max: MAX_POLL_INTERVAL_MS },
  );

  let timeoutMs = parsePositiveMs(
    viteEnv.VITE_MESH_JOB_POLL_TIMEOUT_MS ?? processEnv.VITE_MESH_JOB_POLL_TIMEOUT_MS,
    DEFAULT_MESH_JOB_POLL_TIMEOUT_MS,
    { min: MIN_POLL_TIMEOUT_MS, max: MAX_POLL_TIMEOUT_MS },
  );

  if (timeoutMs < intervalMs) {
    timeoutMs = DEFAULT_MESH_JOB_POLL_TIMEOUT_MS;
  }

  return { intervalMs, timeoutMs };
}

const resolvedPollConfig = resolveMeshJobPollConfig();

/** Mesh regenerate job poll interval (ms). */
export const MESH_JOB_POLL_INTERVAL_MS = resolvedPollConfig.intervalMs;

/** Mesh regenerate job poll timeout (ms). */
export const MESH_JOB_POLL_TIMEOUT_MS = resolvedPollConfig.timeoutMs;
