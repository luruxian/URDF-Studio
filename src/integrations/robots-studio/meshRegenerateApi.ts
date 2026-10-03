import {
  handleRobotsStudioResponse,
  requireRobotsStudioContext,
  RobotsStudioApiError,
  robotsStudioAuthHeaders,
  robotsStudioProjectUrl,
} from './requirementsDocumentApi';
import { MESH_JOB_POLL_INTERVAL_MS } from './meshRegeneratePollConfig';
import type {
  MeshImportGrantRequest,
  MeshImportGrantResponse,
  MeshJobResponse,
  MeshRegenerateRequest,
  MeshRegenerateResponse,
  MeshResumePollResponse,
} from './types';

export {
  DEFAULT_MESH_JOB_POLL_INTERVAL_MS,
  DEFAULT_MESH_JOB_POLL_TIMEOUT_MS,
  MESH_JOB_POLL_INTERVAL_MS,
  MESH_JOB_POLL_TIMEOUT_MS,
  resolveMeshJobPollConfig,
} from './meshRegeneratePollConfig';
export type { MeshJobPollConfig, MeshJobPollEnvSource } from './meshRegeneratePollConfig';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** User-facing message for a failed mesh job (prefer API error_code). */
export function formatMeshJobFailure(
  job: MeshJobResponse,
  fallback = 'URDF+STL 再生成失败',
): string {
  const errorMessage = job.error_message?.trim();
  if (errorMessage) {
    return errorMessage;
  }
  if (job.error_code) {
    return job.error_code;
  }
  return fallback;
}

export async function regenerateMesh(
  request: MeshRegenerateRequest,
): Promise<MeshRegenerateResponse> {
  const context = requireRobotsStudioContext();
  const body: MeshRegenerateRequest = {
    revision: request.revision,
    locale: request.locale ?? 'zh-Hant',
  };

  const response = await fetch(
    robotsStudioProjectUrl(context, '/mesh/regenerate'),
    {
      method: 'POST',
      headers: robotsStudioAuthHeaders(context),
      body: JSON.stringify(body),
    },
  );
  return handleRobotsStudioResponse<MeshRegenerateResponse>(response);
}

export async function getMeshJob(revision?: number): Promise<MeshJobResponse> {
  const context = requireRobotsStudioContext();
  const url = new URL(robotsStudioProjectUrl(context, '/mesh/job'));
  if (revision !== undefined) {
    url.searchParams.set('revision', String(revision));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: robotsStudioAuthHeaders(context),
  });
  return handleRobotsStudioResponse<MeshJobResponse>(response);
}

export async function resumeMeshPoll(): Promise<MeshResumePollResponse> {
  const context = requireRobotsStudioContext();
  const response = await fetch(
    robotsStudioProjectUrl(context, '/mesh/resume-poll'),
    {
      method: 'POST',
      headers: robotsStudioAuthHeaders(context),
    },
  );
  return handleRobotsStudioResponse<MeshResumePollResponse>(response);
}

function isTerminalMeshJobStatus(status: MeshJobResponse['status']): boolean {
  return status === 'done' || status === 'failed';
}

function throwIfPollAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RobotsStudioApiError('Polling aborted', 0);
  }
}

/** Poll until the server reports done or failed. Query errors wait and retry the same revision. */
export async function pollMeshJob(
  revision?: number,
  signal?: AbortSignal,
  onProgress?: (progress: number | null) => void,
): Promise<MeshJobResponse> {
  while (true) {
    throwIfPollAborted(signal);

    try {
      const job = await getMeshJob(revision);
      if (isTerminalMeshJobStatus(job.status)) {
        return job;
      }
      onProgress?.(job.progress ?? null);
    } catch {
      // A failure during getMeshJob can race with abort. Cancellation wins; otherwise wait and query again.
      throwIfPollAborted(signal);
    }

    await sleep(MESH_JOB_POLL_INTERVAL_MS);
  }
}

export async function createMeshImportGrant(
  request: MeshImportGrantRequest = {},
): Promise<MeshImportGrantResponse> {
  const context = requireRobotsStudioContext();
  const body: MeshImportGrantRequest = {};
  if (request.attachment_id) {
    body.attachment_id = request.attachment_id;
  }

  const response = await fetch(
    robotsStudioProjectUrl(context, '/mesh/import-grant'),
    {
      method: 'POST',
      headers: robotsStudioAuthHeaders(context),
      body: JSON.stringify(body),
    },
  );
  return handleRobotsStudioResponse<MeshImportGrantResponse>(response);
}
