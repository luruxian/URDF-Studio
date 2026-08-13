// ============================================================
// Bootstrap helpers: URL hash (primary) + postMessage fallback
// → sessionStorage persistence
//
// Contract: docs/integrations/urdf-studio.md §3.2–3.3
//           docs/integrations/urdf-studio-bootstrap-hash.md
// ============================================================

import type { RobotsStudioBootstrap } from './types';
import {
  BOOTSTRAP_HASH_PREFIX,
  BOOTSTRAP_STORAGE_KEY,
  MESSAGE_TYPE,
  isOriginAllowed,
} from './constants';

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

/**
 * Decode `#robots-bootstrap=<encodeURIComponent(base64Json)>`.
 * Returns null when the hash is absent or malformed.
 */
export function decodeBootstrapFromHash(hash: string): RobotsStudioBootstrap | null {
  const prefix = `#${BOOTSTRAP_HASH_PREFIX}=`;
  if (!hash.startsWith(prefix)) {
    return null;
  }
  try {
    const base64 = decodeURIComponent(hash.slice(prefix.length));
    const parsed: unknown = JSON.parse(atob(base64));
    return parseBootstrap(parsed);
  } catch {
    return null;
  }
}

/** Strip the bootstrap hash while preserving pathname + search (`?mesh=`). */
export function clearBootstrapHashFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const { pathname, search, hash } = window.location;
  if (!hash.startsWith(`#${BOOTSTRAP_HASH_PREFIX}=`)) {
    return;
  }
  window.history.replaceState(window.history.state, '', pathname + search);
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
 * Store bootstrap payload from hash / postMessage.
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
 * Optional fallback for older main-site builds; hash path takes precedence.
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

/**
 * Call once at app startup — before React mount and before any BFF call.
 *
 * Priority (docs/integrations/urdf-studio-bootstrap-hash.md):
 * 1. `#robots-bootstrap=` on the current URL (same navigation as `?mesh=`)
 * 2. Existing `sessionStorage` (user refreshed after hash was cleared)
 *
 * postMessage fallback is owned by `useAgileRobotBootstrap` so the listener
 * can be cleaned up with the React tree.
 */
export function initRobotsStudioBootstrap(): RobotsStudioBootstrap | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const fromHash = decodeBootstrapFromHash(window.location.hash);
  if (fromHash) {
    storeBootstrap(fromHash);
    clearBootstrapHashFromUrl();
    return fromHash;
  }

  return getBootstrap();
}
