// ============================================================
// robots handoff gate — session grant for main-site-only entry
// ============================================================

import {
  isAllowedHandoffOrigin,
  normalizeHandoffOrigin,
  readImportParamsFromUrl,
} from '@/shared/utils/popupHandoffProtocol';
import { decodeBootstrapFromHash } from './bootstrap';
import { grantRobotsHandoff, isHandoffGranted } from './handoffGrant';

const COLLECTION_PREFIX = 'collection:';

function hasMeshQueryParam(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return Boolean(params.get('mesh')?.trim());
}

function readAllowStandaloneFlag(): boolean {
  const viteAllowStandalone = (
    import.meta as ImportMeta & { env?: { VITE_ALLOW_STANDALONE?: string } }
  ).env?.VITE_ALLOW_STANDALONE;
  const processAllowStandalone =
    typeof process !== 'undefined' ? process.env.VITE_ALLOW_STANDALONE : undefined;
  return viteAllowStandalone === '1' || processAllowStandalone === '1';
}

export function isStandaloneAccessAllowed(
  location: Pick<Location, 'search'> = typeof window !== 'undefined'
    ? window.location
    : { search: '' },
): boolean {
  return (
    readAllowStandaloneFlag() ||
    new URLSearchParams(location.search).get('regressionDebug') === '1'
  );
}

function isAllowedImportHandoff(fromOrigin: string): boolean {
  const normalized = normalizeHandoffOrigin(fromOrigin);
  return Boolean(normalized && isAllowedHandoffOrigin(normalized));
}

export function detectAndGrantHandoffFromUrl(
  location: Pick<Location, 'href' | 'search' | 'hash'>,
): boolean {
  if (hasMeshQueryParam(location.search)) {
    grantRobotsHandoff();
    return true;
  }

  const importParams = readImportParamsFromUrl(location.href);
  if (importParams) {
    if (importParams.assetId.startsWith(COLLECTION_PREFIX)) {
      return false;
    }
    if (isAllowedImportHandoff(importParams.fromOrigin)) {
      grantRobotsHandoff();
      return true;
    }
  }

  if (decodeBootstrapFromHash(location.hash)) {
    grantRobotsHandoff();
    return true;
  }

  return false;
}

export function initHandoffGate(
  location: Pick<Location, 'href' | 'search' | 'hash'> = typeof window !== 'undefined'
    ? window.location
    : { href: '', search: '', hash: '' },
): { blocked: boolean } {
  if (isStandaloneAccessAllowed(location)) {
    return { blocked: false };
  }
  if (detectAndGrantHandoffFromUrl(location)) {
    return { blocked: false };
  }
  if (isHandoffGranted()) {
    return { blocked: false };
  }
  return { blocked: true };
}
