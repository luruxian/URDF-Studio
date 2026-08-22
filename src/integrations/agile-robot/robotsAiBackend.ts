// ============================================================
// robots BFF AI backend wiring (Mode B)
// ============================================================

import {
  setAiBackendAuthTokenProvider,
  setAiBackendBaseUrlResolver,
} from '@/shared/hostIntegrationState';
import { getBootstrap } from './bootstrap';

function readRobotsApiBaseUrl(): string {
  const viteBase = (
    import.meta as ImportMeta & { env?: { VITE_ROBOTS_API_BASE_URL?: string } }
  ).env?.VITE_ROBOTS_API_BASE_URL?.trim();
  const processBase =
    typeof process !== 'undefined' ? process.env.VITE_ROBOTS_API_BASE_URL?.trim() : '';
  const raw = viteBase || processBase || '';
  return raw.replace(/\/+$/, '');
}

export function resolveRobotsAiBackendBaseUrl(): string {
  const apiBase = readRobotsApiBaseUrl();
  const orderId = getBootstrap()?.order_id?.trim();
  if (!apiBase || !orderId) {
    return '';
  }
  return `${apiBase}/me/projects/${orderId}/studio/ai`;
}

export function initRobotsAiBackend(): void {
  setAiBackendBaseUrlResolver(() => resolveRobotsAiBackendBaseUrl());
  setAiBackendAuthTokenProvider(() => getBootstrap()?.studio_token ?? null);
}
