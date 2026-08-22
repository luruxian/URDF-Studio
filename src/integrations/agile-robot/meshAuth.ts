// ============================================================
// Robots mesh deep-link auth
// Stable ?mesh= URL + ?mesh_auth= JWT; GLB fetch uses Authorization header.
// ============================================================

export const ROBOTS_MESH_AUTH_STORAGE_KEY = 'robots_mesh_auth';
export const ROBOTS_MESH_URL_STORAGE_KEY = 'robots_mesh_url';

export type RobotsMeshDeepLink = {
  meshUrl: string;
  previewToken: string;
};

/** Machine-readable codes for Studio UX (doc §10). */
export type MeshAuthErrorCode =
  | 'auth_missing'
  | 'auth_expired'
  | 'not_found'
  | 'unavailable';

/**
 * Resolve GLB URL + preview token from ?mesh= & ?mesh_auth=.
 * Supports legacy mesh URLs that embed ?preview_token= in the mesh URL.
 */
export function parseMeshDeepLink(search: string): RobotsMeshDeepLink | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const meshRaw = params.get('mesh');
  if (!meshRaw) return null;

  const meshUrl = meshRaw;

  const meshAuth = params.get('mesh_auth');
  if (meshAuth) {
    return { meshUrl, previewToken: meshAuth };
  }

  try {
    const u = new URL(meshUrl);
    const legacyToken = u.searchParams.get('preview_token');
    if (legacyToken) {
      u.searchParams.delete('preview_token');
      return { meshUrl: u.toString(), previewToken: legacyToken };
    }
  } catch {
    /* ignore invalid URL */
  }

  return null;
}

export function persistMeshAuth(link: RobotsMeshDeepLink): void {
  sessionStorage.setItem(ROBOTS_MESH_AUTH_STORAGE_KEY, link.previewToken);
  sessionStorage.setItem(ROBOTS_MESH_URL_STORAGE_KEY, link.meshUrl);
}

export function getStoredMeshAuth(): RobotsMeshDeepLink | null {
  const previewToken = sessionStorage.getItem(ROBOTS_MESH_AUTH_STORAGE_KEY);
  const meshUrl = sessionStorage.getItem(ROBOTS_MESH_URL_STORAGE_KEY);
  if (!previewToken || !meshUrl) return null;
  return { meshUrl, previewToken };
}

/** Update cached mesh URL after hunyuan regeneration (token unchanged). */
export function updateStoredMeshUrl(meshUrl: string): void {
  sessionStorage.setItem(ROBOTS_MESH_URL_STORAGE_KEY, meshUrl);
}

/**
 * Cross-origin GLB GET with Bearer preview token.
 * credentials must be omit — Studio does not send robots session cookies.
 */
export async function fetchAuthenticatedGlb(
  meshUrl: string,
  previewToken: string,
): Promise<ArrayBuffer> {
  const res = await fetch(meshUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${previewToken}`,
    },
    credentials: 'omit',
  });

  if (res.status === 401) {
    throw new Error('preview_token_expired');
  }
  if (!res.ok) {
    throw new Error(`glb_fetch_failed:${res.status}`);
  }

  return res.arrayBuffer();
}

export function resolveMeshAuthErrorCode(error: unknown): MeshAuthErrorCode | null {
  if (!(error instanceof Error)) return null;
  const { message } = error;
  if (message === 'preview_token_expired') return 'auth_expired';
  if (message === 'missing_mesh_auth') return 'auth_missing';
  if (message === 'glb_fetch_failed:404') return 'not_found';
  if (message === 'glb_fetch_failed:502') return 'unavailable';
  if (message.startsWith('glb_fetch_failed:')) return 'unavailable';
  return null;
}
