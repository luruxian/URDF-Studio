// ============================================================
// Bootstrap helpers: postMessage → sessionStorage persistence
// ============================================================

import type { RobotsStudioBootstrap } from './types';
import { BOOTSTRAP_STORAGE_KEY, MESSAGE_TYPE, isOriginAllowed } from './constants';

/** Fields the Studio actually needs to operate. The remaining fields ride along
 *  for forward compatibility without being validated here. */
const REQUIRED_BOOTSTRAP_FIELDS = [
  'studio_token',
  'api_base_url',
  'order_id',
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Narrow an untrusted payload to a usable bootstrap, or null when malformed. */
function parseBootstrap(data: unknown): RobotsStudioBootstrap | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const candidate = data as Partial<RobotsStudioBootstrap>;
  for (const field of REQUIRED_BOOTSTRAP_FIELDS) {
    if (!isNonEmptyString(candidate[field])) {
      return null;
    }
  }
  return candidate as RobotsStudioBootstrap;
}

/** Read stored bootstrap from sessionStorage. Returns null if absent or malformed. */
export function getBootstrap(): RobotsStudioBootstrap | null {
  try {
    const raw = sessionStorage.getItem(BOOTSTRAP_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parseBootstrap(parsed);
  } catch {
    return null;
  }
}

/** True when a valid bootstrap exists in sessionStorage. */
export function hasBootstrap(): boolean {
  return getBootstrap() !== null;
}

/** Remove bootstrap from sessionStorage. */
export function clearBootstrap(): void {
  sessionStorage.removeItem(BOOTSTRAP_STORAGE_KEY);
}

/**
 * Store bootstrap payload from postMessage.
 * Validates shape before writing. Returns true on success.
 */
export function storeBootstrap(data: unknown): boolean {
  const parsed = parseBootstrap(data);
  if (parsed === null) {
    return false;
  }
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(parsed));
  return true;
}

/**
 * Handle a postMessage event — validate origin, check type, store bootstrap.
 * Returns true when a valid bootstrap was stored.
 */
export function handleBootstrapMessage(event: MessageEvent): boolean {
  if (!isOriginAllowed(event.origin)) {
    return false;
  }
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as { type?: unknown; bootstrap?: unknown };
  if (candidate.type !== MESSAGE_TYPE) {
    return false;
  }
  return storeBootstrap(candidate.bootstrap);
}
