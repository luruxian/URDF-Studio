import { getBootstrap } from './bootstrap';
import { HUNYUAN_POLL_INTERVAL_MS, HUNYUAN_POLL_TIMEOUT_MS } from './constants';
import type {
  JimengEditResponse,
  HunyuanSubmitResponse,
  HunyuanJobResponse,
} from './types';

// ============================================================
// Error handling
// ============================================================

export class AgileRobotApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'AgileRobotApiError';
    this.status = status;
    this.body = body;
  }
}

export function isAgileRobotApiError(
  error: unknown,
  status?: number,
): error is AgileRobotApiError {
  if (!(error instanceof AgileRobotApiError)) return false;
  if (status !== undefined && error.status !== status) return false;
  return true;
}

// ============================================================
// Helpers
// ============================================================

function requireBootstrap() {
  const b = getBootstrap();
  if (!b) {
    throw new AgileRobotApiError(
      'No agile-robot bootstrap found in sessionStorage',
      401,
    );
  }
  return b;
}

function authHeaders(): Record<string, string> {
  const b = requireBootstrap();
  return {
    Authorization: `Bearer ${b.studio_token}`,
    'Content-Type': 'application/json',
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // 非 JSON 错误体时保持 body 为空
    }
    throw new AgileRobotApiError(
      `Agile Robot API error: ${response.status}`,
      response.status,
      body,
    );
  }
  return response.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ============================================================
// Public API functions
// ============================================================

/**
 * 调用即梦改图。
 * prompt 是 LLM 生成的 JSON 结构化提示词。
 */
export async function jimengEdit(
  prompt: string,
  sourcePath?: string,
): Promise<JimengEditResponse> {
  const b = requireBootstrap();
  const body: { prompt: string; source_path?: string } = { prompt };
  if (sourcePath) {
    body.source_path = sourcePath;
  }

  const response = await fetch(
    `${b.api_base_url}/me/projects/${b.order_id}/studio/jimeng/edit`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
  );
  return handleResponse<JimengEditResponse>(response);
}

/**
 * 提交混元 3D 生成任务。
 * imagePath 可选；默认使用最新的改图结果。
 */
export async function hunyuanSubmit(
  imagePath?: string,
): Promise<HunyuanSubmitResponse> {
  const b = requireBootstrap();
  const body: { image_path?: string } = {};
  if (imagePath) {
    body.image_path = imagePath;
  }

  const response = await fetch(
    `${b.api_base_url}/me/projects/${b.order_id}/studio/hunyuan/submit`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
  );
  return handleResponse<HunyuanSubmitResponse>(response);
}

/**
 * 查询混元任务状态（单次，不轮询）。
 */
export async function hunyuanGetJob(): Promise<HunyuanJobResponse> {
  const b = requireBootstrap();
  const response = await fetch(
    `${b.api_base_url}/me/projects/${b.order_id}/studio/hunyuan/job`,
    {
      method: 'GET',
      headers: authHeaders(),
    },
  );
  return handleResponse<HunyuanJobResponse>(response);
}

/**
 * 轮询混元任务直到 done / failed / timeout。
 * 返回最终 job 状态。
 */
export async function hunyuanPollJob(
  signal?: AbortSignal,
): Promise<HunyuanJobResponse> {
  const startedAt = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new AgileRobotApiError('Polling aborted', 0);
    }
    if (Date.now() - startedAt > HUNYUAN_POLL_TIMEOUT_MS) {
      throw new AgileRobotApiError(
        '3D 生成超时，请稍后重试',
        408,
      );
    }

    const job = await hunyuanGetJob();

    if (job.status === 'done' || job.status === 'failed') {
      return job;
    }

    await sleep(HUNYUAN_POLL_INTERVAL_MS);
  }
}
