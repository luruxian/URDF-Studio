// ============================================================
// Bootstrap postMessage protocol constants
// ============================================================

/** postMessage 消息类型 — 与 robots 主站契约固定 */
export const MESSAGE_TYPE = 'robots:studio-bootstrap' as const;

/**
 * URL hash 键名（主路径）— 与 robots 主站 `buildModelPreviewViewerUrl` 契约固定。
 * 形式：`#robots-bootstrap=<encodeURIComponent(base64Json)>`
 */
export const BOOTSTRAP_HASH_PREFIX = 'robots-bootstrap' as const;

/** sessionStorage key for bootstrap data */
export const BOOTSTRAP_STORAGE_KEY = 'robots_studio_bootstrap';

/** Origin allowlist for postMessage validation.
 *  Loaded from VITE_AGILE_ROBOT_ORIGINS env (comma-separated, supports `*` wildcard).
 *  Falls back to production domains when env is unset. */
const originsEnv = (
  import.meta as ImportMeta & {
    env?: { VITE_AGILE_ROBOT_ORIGINS?: string };
  }
).env?.VITE_AGILE_ROBOT_ORIGINS;

export const ALLOWED_AGILE_ROBOT_ORIGINS: ReadonlyArray<string> = (
  originsEnv || 'https://*.enkeebot.com,https://*.enkeebot.cn'
)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

/**
 * Normalize an origin to `scheme://host[:port]`, stripping the default port and
 * any userinfo. Returns null when the input is not a parseable http(s) URL.
 */
function normalizeOrigin(input: string): string | null {
  try {
    const url = new URL(input);
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

/** 简单的 origin 通配符匹配：`*` 匹配任意字符序列（含多级子域）。 */
export function matchOrigin(origin: string, pattern: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }
  if (!pattern.includes('*')) {
    return pattern === normalized;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i');
  return regex.test(normalized);
}

export function isOriginAllowed(origin: string): boolean {
  return ALLOWED_AGILE_ROBOT_ORIGINS.some((pattern) =>
    matchOrigin(origin, pattern),
  );
}

// ============================================================
// 混元任务轮询
// ============================================================

/** 混元任务轮询间隔 (ms)，建议 3–5 秒 */
export const HUNYUAN_POLL_INTERVAL_MS = 5000;

/** 混元任务轮询超时 (ms) */
export const HUNYUAN_POLL_TIMEOUT_MS = 15 * 60 * 1000;
