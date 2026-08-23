interface AiRuntimeEnvSource {
  [key: string]: string | undefined;
  VITE_API_KEY?: string;
  VITE_OPENAI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
  VITE_OPENAI_BASE_URL?: string;
  VITE_OPENAI_MODEL?: string;
  VITE_AI_BACKEND_URL?: string;
  VITE_ROBOTS_API_BASE_URL?: string;
  API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  AI_BACKEND_URL?: string;
}

export interface AiRuntimeEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * Managed AI mode: base URL of the backend AI proxy
   * (e.g. `/api/ai/urdf-studio`). When set, AI requests carry structured
   * context to the backend, which owns prompts and provider credentials —
   * no AI key lives in the browser. When empty, the direct BYOK mode above
   * (apiKey/baseUrl/model) applies.
   */
  backendUrl: string;
  /** robots 主站 API 根地址（`VITE_ROBOTS_API_BASE_URL`）。 */
  robotsApiBaseUrl: string;
}

const readImportMetaEnv = (): AiRuntimeEnvSource => {
  return ((import.meta as ImportMeta & { env?: AiRuntimeEnvSource }).env ?? {}) as AiRuntimeEnvSource;
};

const readProcessEnv = (): AiRuntimeEnvSource => {
  return typeof process !== 'undefined' ? process.env : {};
};

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const trimmedValue = value?.trim();
    if (trimmedValue) {
      return trimmedValue;
    }
  }
  return '';
};

/** OpenAI SDK requires an absolute base URL; resolve same-origin proxy paths in the browser. */
export function resolveOpenAiClientBaseUrl(
  baseUrl: string,
  pageOrigin?: string,
): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return 'https://api.openai.com/v1';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  if (trimmed.startsWith('/')) {
    const origin =
      pageOrigin ?? (typeof window !== 'undefined' ? window.location.origin : undefined);
    if (!origin) {
      return trimmed;
    }
    return new URL(trimmed, origin).href.replace(/\/+$/, '');
  }

  return trimmed;
}

export function resolveAiRuntimeEnv(
  viteEnv: AiRuntimeEnvSource = readImportMetaEnv(),
  processEnv: AiRuntimeEnvSource = readProcessEnv(),
): AiRuntimeEnv {
  return {
    apiKey: firstNonEmpty(
      viteEnv.VITE_API_KEY,
      viteEnv.VITE_OPENAI_API_KEY,
      viteEnv.VITE_GEMINI_API_KEY,
      processEnv.API_KEY,
      processEnv.OPENAI_API_KEY,
      processEnv.GEMINI_API_KEY,
    ),
    baseUrl:
      firstNonEmpty(viteEnv.VITE_OPENAI_BASE_URL, processEnv.OPENAI_BASE_URL) ||
      'https://api.openai.com/v1',
    model: firstNonEmpty(viteEnv.VITE_OPENAI_MODEL, processEnv.OPENAI_MODEL) || 'bce/deepseek-v3.2',
    backendUrl: firstNonEmpty(viteEnv.VITE_AI_BACKEND_URL, processEnv.AI_BACKEND_URL).replace(
      /\/+$/,
      '',
    ),
    robotsApiBaseUrl: firstNonEmpty(
      viteEnv.VITE_ROBOTS_API_BASE_URL,
      processEnv.VITE_ROBOTS_API_BASE_URL,
    ).replace(/\/+$/, ''),
  };
}
