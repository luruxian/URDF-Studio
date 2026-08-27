import { getBootstrap } from '@/integrations/agile-robot/bootstrap';
import { getAiBackendAuthToken } from '@/shared/hostIntegrationState';

import type {
  RequirementsDocumentPatchRequest,
  RequirementsDocumentPatchResponse,
  RequirementsDocumentResponse,
} from './types';

// ============================================================
// Error handling
// ============================================================

export class RobotsStudioApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'RobotsStudioApiError';
    this.status = status;
    this.body = body;
  }
}

export function isRobotsStudioApiError(
  error: unknown,
  status?: number,
): error is RobotsStudioApiError {
  if (!(error instanceof RobotsStudioApiError)) return false;
  if (status !== undefined && error.status !== status) return false;
  return true;
}

export function getRobotsStudioErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error_code' in body)) {
    return undefined;
  }
  const code = (body as { error_code?: unknown }).error_code;
  return typeof code === 'string' ? code : undefined;
}

// ============================================================
// Shared client helpers (used by meshRegenerateApi)
// ============================================================

export interface RobotsStudioRequestContext {
  apiBaseUrl: string;
  orderId: string;
  token: string;
}

export function requireRobotsStudioContext(): RobotsStudioRequestContext {
  const bootstrap = getBootstrap();
  if (!bootstrap) {
    throw new RobotsStudioApiError(
      'No robots-studio bootstrap found in sessionStorage',
      401,
    );
  }

  const token = getAiBackendAuthToken()?.trim();
  if (!token) {
    throw new RobotsStudioApiError('No AI backend auth token available', 401);
  }

  return {
    apiBaseUrl: bootstrap.api_base_url,
    orderId: bootstrap.order_id,
    token,
  };
}

export function robotsStudioAuthHeaders(
  context: RobotsStudioRequestContext,
): Record<string, string> {
  return {
    Authorization: `Bearer ${context.token}`,
    'Content-Type': 'application/json',
  };
}

export function robotsStudioProjectUrl(
  context: RobotsStudioRequestContext,
  path: string,
): string {
  return `${context.apiBaseUrl}/me/projects/${context.orderId}/studio${path}`;
}

export async function handleRobotsStudioResponse<T>(
  response: Response,
): Promise<T> {
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // 非 JSON 错误体时保持 body 为空
    }
    throw new RobotsStudioApiError(
      `Robots Studio API error: ${response.status}`,
      response.status,
      body,
    );
  }
  return response.json() as Promise<T>;
}

// ============================================================
// Requirements document API
// ============================================================

export async function getRequirementsDocument(): Promise<RequirementsDocumentResponse> {
  const context = requireRobotsStudioContext();
  const response = await fetch(
    robotsStudioProjectUrl(context, '/requirements-document'),
    {
      method: 'GET',
      headers: robotsStudioAuthHeaders(context),
    },
  );
  return handleRobotsStudioResponse<RequirementsDocumentResponse>(response);
}

export async function patchRequirementsDocument(
  request: RequirementsDocumentPatchRequest,
): Promise<RequirementsDocumentPatchResponse> {
  const context = requireRobotsStudioContext();
  const response = await fetch(
    robotsStudioProjectUrl(context, '/requirements-document'),
    {
      method: 'PATCH',
      headers: robotsStudioAuthHeaders(context),
      body: JSON.stringify(request),
    },
  );
  return handleRobotsStudioResponse<RequirementsDocumentPatchResponse>(response);
}
