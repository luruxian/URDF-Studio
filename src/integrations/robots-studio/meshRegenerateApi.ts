import {
  handleRobotsStudioResponse,
  requireRobotsStudioContext,
  RobotsStudioApiError,
  robotsStudioAuthHeaders,
  robotsStudioProjectUrl,
} from './requirementsDocumentApi';
import {
  MESH_JOB_POLL_INTERVAL_MS,
  MESH_JOB_POLL_TIMEOUT_MS,
} from './meshRegeneratePollConfig';
import type {
  MeshImportGrantRequest,
  MeshImportGrantResponse,
  MeshJobResponse,
  MeshRegenerateRequest,
  MeshRegenerateResponse,
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
  if (job.error_code) {
    return job.error_code;
  }
  if (job.error_message) {
    return job.error_message;
  }
  return fallback;
}

export async function regenerateMesh(
  request: MeshRegenerateRequest,
): Promise<MeshRegenerateResponse> {
  const context = requireRobotsStudioContext();
  const body: MeshRegenerateRequest = {
    revision: request.revision,
    locale: request.locale ?? 'zh-CN',
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

/**
 * Poll mesh job until done / failed / timeout.
 * Returns the final job status.
 */
export async function pollMeshJob(
  revision?: number,
  signal?: AbortSignal,
): Promise<MeshJobResponse> {
  const startedAt = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new RobotsStudioApiError('Polling aborted', 0);
    }
    if (Date.now() - startedAt > MESH_JOB_POLL_TIMEOUT_MS) {
      throw new RobotsStudioApiError(
        'URDF+STL 再生成超时，请稍后重试',
        408,
      );
    }

    const job = await getMeshJob(revision);

    if (job.status === 'done' || job.status === 'failed') {
      return job;
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
