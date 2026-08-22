/**
 * Same-origin mesh preview handoff — lets a sibling app on the same server open
 * URDF Studio with `?mesh=<url>` and auto-import a GLB/GLTF file.
 */

export const MESH_PREVIEW_QUERY_PARAM = 'mesh';

/** Preview JWT for authenticated cross-origin GLB fetch (robots mesh_auth protocol). */
export const MESH_AUTH_QUERY_PARAM = 'mesh_auth';

const ALLOWED_MESH_EXTENSIONS = ['.glb', '.gltf'] as const;

export function getMeshPreviewAllowedOrigins(): ReadonlyArray<string> {
  const meshPreviewOriginsEnv = (
    import.meta as ImportMeta & { env?: { VITE_MESH_PREVIEW_ALLOWED_ORIGINS?: string } }
  ).env?.VITE_MESH_PREVIEW_ALLOWED_ORIGINS;

  return (meshPreviewOriginsEnv ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** @deprecated Prefer getMeshPreviewAllowedOrigins(); kept for callers/tests that already import the constant. */
export const MESH_PREVIEW_ALLOWED_ORIGINS: ReadonlyArray<string> = getMeshPreviewAllowedOrigins();

function normalizeHttpOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    const isDefaultPort =
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80');
    const port = isDefaultPort || !url.port ? '' : `:${url.port}`;
    return `${url.protocol}//${url.hostname}${port}`;
  } catch {
    return null;
  }
}

function matchesMeshPreviewOriginAllowlist(
  candidateOrigin: string,
  allowedOrigins: ReadonlyArray<string>,
): boolean {
  const normalizedCandidate = normalizeHttpOrigin(candidateOrigin);
  if (!normalizedCandidate) {
    return false;
  }

  return allowedOrigins.some((pattern) => {
    if (!pattern.includes('*')) {
      return normalizeHttpOrigin(pattern) === normalizedCandidate;
    }
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i');
    return regex.test(normalizedCandidate);
  });
}

function isAllowedMeshPreviewOrigin(candidateOrigin: string, pageOrigin: string): boolean {
  const normalizedCandidate = normalizeHttpOrigin(candidateOrigin);
  const normalizedPage = normalizeHttpOrigin(pageOrigin);
  if (!normalizedCandidate || !normalizedPage) {
    return false;
  }

  if (normalizedCandidate === normalizedPage) {
    return true;
  }

  return matchesMeshPreviewOriginAllowlist(candidateOrigin, getMeshPreviewAllowedOrigins());
}

function hasAllowedMeshExtension(pathname: string): boolean {
  const lowerPath = pathname.toLowerCase();
  return ALLOWED_MESH_EXTENSIONS.some((extension) => lowerPath.endsWith(extension));
}

export function isExplicitlyTrustedCrossOriginMeshPreviewOrigin(
  candidateOrigin: string,
  pageOrigin: string,
  allowedOrigins: ReadonlyArray<string>,
): boolean {
  const normalizedCandidate = normalizeHttpOrigin(candidateOrigin);
  const normalizedPage = normalizeHttpOrigin(pageOrigin);
  if (!normalizedCandidate || !normalizedPage || normalizedCandidate === normalizedPage) {
    return false;
  }

  return matchesMeshPreviewOriginAllowlist(candidateOrigin, allowedOrigins);
}

function isExplicitlyTrustedCrossOriginMeshPreview(
  candidateOrigin: string,
  pageOrigin: string,
): boolean {
  return isExplicitlyTrustedCrossOriginMeshPreviewOrigin(
    candidateOrigin,
    pageOrigin,
    getMeshPreviewAllowedOrigins(),
  );
}

/** Resolve and validate a mesh preview URL against the current page origin. */
export function resolveMeshPreviewUrl(rawValue: string, pageHref: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const pageUrl = new URL(pageHref);

  let resolved: URL;
  try {
    resolved = trimmed.startsWith('/')
      ? new URL(trimmed, pageUrl.origin)
      : new URL(trimmed);
  } catch {
    return null;
  }

  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return null;
  }

  if (!isAllowedMeshPreviewOrigin(resolved.origin, pageUrl.origin)) {
    return null;
  }

  if (
    !hasAllowedMeshExtension(resolved.pathname) &&
    !isExplicitlyTrustedCrossOriginMeshPreview(resolved.origin, pageUrl.origin)
  ) {
    return null;
  }

  return resolved.href;
}

/** Read the mesh preview URL from a full page URL string. */
export function readMeshPreviewUrlFromLocation(url: string): string | null {
  const resolvedUrl = new URL(url, 'http://localhost');
  const rawValue = resolvedUrl.searchParams.get(MESH_PREVIEW_QUERY_PARAM)?.trim() ?? '';
  if (!rawValue) {
    return null;
  }
  return resolveMeshPreviewUrl(rawValue, url);
}

/** Remove mesh preview query parameters (`mesh`, `mesh_auth`) from a URL string. */
export function stripMeshPreviewParamFromUrl(url: string): string {
  const resolvedUrl = new URL(url);
  resolvedUrl.searchParams.delete(MESH_PREVIEW_QUERY_PARAM);
  resolvedUrl.searchParams.delete(MESH_AUTH_QUERY_PARAM);
  return resolvedUrl.toString();
}

/** Derive a stable import filename from a validated mesh preview URL. */
export function filenameFromMeshPreviewUrl(meshUrl: string): string {
  const pathname = new URL(meshUrl).pathname;
  const basename = decodeURIComponent(pathname.split('/').pop() ?? 'preview.glb');
  if (hasAllowedMeshExtension(basename)) {
    return basename;
  }
  return `${basename}.glb`;
}

/** Infer a MIME type for imported mesh preview files. */
export function mimeTypeForMeshPreviewFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.gltf')
    ? 'model/gltf+json'
    : 'model/gltf-binary';
}

/** Parse a filename from a Content-Disposition response header when present. */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const bareMatch = header.match(/filename=([^;]+)/i);
  return bareMatch?.[1]?.trim() ?? null;
}
