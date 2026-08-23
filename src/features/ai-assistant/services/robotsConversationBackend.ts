import { resolveAiBackendBaseUrl } from '@/shared/hostIntegrationState';

import { resolveAiRuntimeEnv } from './aiRuntimeEnv';

/** Whether `VITE_ROBOTS_API_BASE_URL` is configured for this build/session. */
export function isRobotsApiBaseUrlConfigured(): boolean {
  return Boolean(resolveAiRuntimeEnv().robotsApiBaseUrl);
}

/** Resolved robots BFF AI prefix, e.g. `{base}/me/projects/{order_id}/studio/ai`. */
export function getRobotsAiConversationBackendUrl(): string {
  return resolveAiBackendBaseUrl().replace(/\/+$/, '');
}

/** Conversation is allowed only when robots API base is configured and bootstrap session is active. */
export function isRobotsAiConversationReady(): boolean {
  return isRobotsApiBaseUrlConfigured() && Boolean(getRobotsAiConversationBackendUrl());
}
