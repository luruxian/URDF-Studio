/**
 * Backend transport for the managed AI mode.
 *
 * When `VITE_AI_BACKEND_URL` (or `AI_BACKEND_URL`) is set, AI features send
 * structured context to the backend AI proxy (botbase → BotPilot), which owns
 * the prompt templates and the provider key — no AI credentials exist in the
 * browser bundle. Self-hosted deployments leave it unset and use the BYOK
 * direct-to-provider mode, or point it at their own proxy speaking the same
 * contract:
 *
 *   POST {base}/generate | {base}/inspect  → { success, data: { content } }
 *
 * Conversation streaming uses robots BFF `.../v1/chat/completions` (see
 * robotsConversationCompletions.ts), not this module.
 *
 * Authentication is pluggable: the hosting shell registers a token provider
 * via `setAiBackendAuthTokenProvider` and requests carry it as a Bearer token.
 */

import {
  getAiBackendAuthToken,
  setAiBackendAuthTokenProvider,
  resolveAiBackendBaseUrl,
} from '../../../shared/hostIntegrationState';
import { resolveAiRuntimeEnv } from './aiRuntimeEnv';

// Preserve the feature-level public API while keeping the provider state in
// the import-free host facade.
export { setAiBackendAuthTokenProvider };

export function getAiBackendBaseUrl(): string {
  const resolved = resolveAiBackendBaseUrl().replace(/\/+$/, '');
  if (resolved) {
    return resolved;
  }
  return resolveAiRuntimeEnv().backendUrl;
}

export function isAiBackendEnabled(): boolean {
  return Boolean(getAiBackendBaseUrl());
}

export class AiBackendRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiBackendRequestError';
    this.status = status;
  }
}

/**
 * True when the backend rejected the call for lack of a (valid) login —
 * callers surface a "please log in" hint instead of a raw request error.
 * Deliberately 401-only: 404 can also mean the route is missing upstream.
 */
export function isAiBackendAuthError(error: unknown): boolean {
  return error instanceof AiBackendRequestError && error.status === 401;
}

const buildRequestHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAiBackendAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object') {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
};

/**
 * Non-streaming call (generate / inspect). Returns the raw model reply; JSON
 * parsing and normalization stay with the caller so managed mode and BYOK
 * mode share one pipeline.
 */
export async function requestAiBackendContent(
  path: string,
  body: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const response = await fetch(`${getAiBackendBaseUrl()}${path}`, {
    method: 'POST',
    headers: buildRequestHeaders(),
    body: JSON.stringify(body),
    signal: options.signal,
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AiBackendRequestError(
      extractErrorMessage(payload, `AI backend HTTP ${response.status}`),
      response.status,
    );
  }

  const content =
    payload && typeof payload === 'object'
      ? (payload as { data?: { content?: unknown } }).data?.content
      : undefined;
  if (typeof content !== 'string' || !content) {
    throw new AiBackendRequestError('AI backend returned an empty response', response.status);
  }
  return content;
}
