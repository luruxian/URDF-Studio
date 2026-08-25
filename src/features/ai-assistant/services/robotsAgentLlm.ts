/**
 * OpenAI-compatible LLM client config for the URDF edit agent when Studio uses
 * robots managed AI (`VITE_ROBOTS_API_BASE_URL`) instead of BYOK.
 *
 * With bootstrap: `{api}/me/projects/{order_id}/studio/ai/v1`
 * Standalone:     `{VITE_ROBOTS_API_BASE_URL}` (already ends with `/api/v1`)
 */

import OpenAI from 'openai';
import { getAiBackendAuthToken } from '@/shared/hostIntegrationState';
import {
  getRobotsAiConversationBackendUrl,
  isRobotsApiBaseUrlConfigured,
} from './robotsConversationBackend';
import { resolveAiRuntimeEnv, resolveOpenAiClientBaseUrl } from './aiRuntimeEnv';

/** True when robots API base is configured (bootstrap optional). */
export function isRobotsAgentLlmConfigured(): boolean {
  return isRobotsApiBaseUrlConfigured();
}

/** Resolve the OpenAI SDK base URL for agent tool-calling completions. */
export function resolveRobotsAgentOpenAiBaseUrl(): string {
  const scopedBackend = getRobotsAiConversationBackendUrl();
  if (scopedBackend) {
    return `${scopedBackend}/v1`;
  }
  return resolveAiRuntimeEnv().robotsApiBaseUrl.replace(/\/+$/, '');
}

export function createRobotsAgentOpenAIClient(): OpenAI {
  const token = getAiBackendAuthToken()?.trim();
  const baseURL = resolveOpenAiClientBaseUrl(resolveRobotsAgentOpenAiBaseUrl());
  return new OpenAI({
    // OpenAI SDK requires a non-empty apiKey; robots BFF uses Bearer studio_token.
    apiKey: token || 'robots-managed',
    baseURL,
    dangerouslyAllowBrowser: true,
    ...(token ? {} : { defaultHeaders: {} }),
  });
}
