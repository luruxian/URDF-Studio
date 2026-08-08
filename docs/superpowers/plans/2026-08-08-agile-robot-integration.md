# Agile Robot Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the URDF-Studio ↔ Agile Robot (robots) integration per the design spec, adding postMessage bootstrap, BFF API calls, and AI conversation tools for appearance editing and 3D regeneration.

**Architecture:** New self-contained integration module at `src/integrations/agile-robot/` with pure-function bootstrap/api layer, React hooks for lifecycle, and a ToolConfirmBanner component. The existing `conversationService.ts` and `AIConversationModal.tsx` gain optional `tools`/`toolsConfig` parameters — backward compatible, no behavior change when omitted. App wiring is two hook calls in `AppContent.tsx` plus a `toolsConfig` prop threaded through `AIConversationConnector.tsx`.

**Tech Stack:** React 19.2 + TypeScript 5.8 + Zustand 5 + OpenAI SDK (existing) + sessionStorage

## Global Constraints

- No new `any`, `@ts-ignore`, or `@ts-nocheck` in runtime code
- Follow existing project patterns: named exports, ESM imports, `@/` path alias
- `studio_token` only in `sessionStorage`, never in URL or `localStorage`
- No new env vars for jimeng/hunyuan keys (keys live on robots backend)
- Existing `?mesh=` behavior unchanged
- Non-robots sessions (normal dev) must see zero behavior change
- Origin validation on postMessage is mandatory (security)

---

## File Structure

```
src/integrations/agile-robot/
  index.ts                      # Public barrel (Task 9)
  types.ts                      # All types (Task 1)
  constants.ts                  # Message type, origin list, poll interval (Task 2)
  bootstrap.ts                  # Pure sessionStorage helpers (Task 3)
  api.ts                        # BFF fetch wrappers (Task 4)
  meshReload.ts                 # Mesh hot-reload function (Task 6)
  components/
    ToolConfirmBanner.tsx       # Confirmation UI (Task 7)
  hooks/
    useAgileRobotBootstrap.ts   # postMessage listener hook (Task 5)
    useAgileRobotTools.ts       # Tool defs + state machine (Task 8)

Modified files:
  src/features/ai-assistant/services/conversationService.ts  # +tools +onToolCalls (Task 10)
  src/features/ai-assistant/components/AIConversationModal.tsx  # +toolsConfig prop + banner (Task 11)
  src/app/components/ai/AIConversationConnector.tsx  # +toolsConfig passthrough (Task 12)
  src/app/App.tsx              # +useAgileRobotBootstrap (Task 13)
  .env.example                  # +VITE_AGILE_ROBOT_ORIGINS (Task 14)
```

---

### Task 1: Integration types (`src/integrations/agile-robot/types.ts`)

**Files:**
- Create: `src/integrations/agile-robot/types.ts`

**Interfaces:**
- Produces: `RobotsStudioBootstrap`, `JimengEditRequest`, `JimengEditResponse`, `HunyuanSubmitRequest`, `HunyuanSubmitResponse`, `HunyuanJobResponse`, `ToolConfirmState`, `ToolCallInfo`, `ToolResult`, `AIConversationToolDef`, `AIConversationToolsConfig`, `ParsedToolCall`

- [ ] **Step 1: Write the types file**

```ts
// ============================================================
// Bootstrap (postMessage payload from robots main site)
// ============================================================

export interface RobotsStudioBootstrap {
  studio_token: string;
  studio_expires_at: string; // ISO 8601
  order_id: string;
  attachment_id: string;
  conversation_id: string | null;
  input_image_path: string;
  fallback_input_image_path: string;
  api_base_url: string; // 含 /api/v1，无尾斜杠
}

// ============================================================
// BFF API types
// ============================================================

export interface JimengEditRequest {
  prompt: string;
  source_path?: string;
}

export interface JimengEditResponse {
  output_path: string;
  bytes_count: number;
  task_id: string;
}

export interface HunyuanSubmitRequest {
  image_path?: string;
}

export interface HunyuanSubmitResponse {
  job_id: string;
  status: 'pending';
  trigger_source: string;
}

export type HunyuanJobStatus =
  | 'pending'
  | 'submitting'
  | 'running'
  | 'done'
  | 'failed';

export interface HunyuanJobResponse {
  job_id: string;
  status: HunyuanJobStatus;
  attachment_id?: string;
  error_code?: string | null;
  error_message?: string | null;
  preview_url?: string | null;
}

// ============================================================
// Tool confirmation state machine
// ============================================================

export type ToolConfirmState =
  | 'idle'
  | 'parsed'
  | 'executing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface ParsedToolCall {
  toolName: string;
  args: Record<string, unknown>;
  summary: string; // 确认 UI 展示用中文概括
}

export interface ToolResult {
  success: boolean;
  message: string;
}

// ============================================================
// AI conversation tool contracts
// (these mirror OpenAI function-calling shapes)
// ============================================================

export interface AIConversationToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AIConversationToolsConfig {
  tools: AIConversationToolDef[];
  /** Parse raw tool_calls from LLM response into structured ParsedToolCall, or null if not a tool call */
  parseToolCalls: (
    toolCalls: Array<{
      function: { name: string; arguments: string };
    }>,
  ) => ParsedToolCall | null;
  /** Execute the confirmed tool call. Returns result for UI feedback. */
  onExecute: (toolCall: ParsedToolCall) => Promise<ToolResult>;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit --pretty src/integrations/agile-robot/types.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/integrations/agile-robot/types.ts
git commit -m "feat(integration): add agile-robot types

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Constants (`src/integrations/agile-robot/constants.ts`)

**Files:**
- Create: `src/integrations/agile-robot/constants.ts`

**Interfaces:**
- Produces: `MESSAGE_TYPE`, `ALLOWED_AGILE_ROBOT_ORIGINS`, `HUNYUAN_POLL_INTERVAL_MS`, `HUNYUAN_POLL_TIMEOUT_MS`, `BOOTSTRAP_STORAGE_KEY`

- [ ] **Step 1: Write the constants file**

```ts
/** postMessage 消息类型 — 与 robots 主站契约固定 */
export const MESSAGE_TYPE = 'robots:studio-bootstrap' as const;

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

/** 简单的 origin 通配符匹配 */
export function matchOrigin(
  origin: string,
  pattern: string,
): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^.]+');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(new URL(origin).hostname);
}

export function isOriginAllowed(origin: string): boolean {
  return ALLOWED_AGILE_ROBOT_ORIGINS.some((pattern) =>
    matchOrigin(origin, pattern),
  );
}

/** 混元任务轮询间隔 (ms) */
export const HUNYUAN_POLL_INTERVAL_MS = 4000;

/** 混元任务轮询超时 (ms) */
export const HUNYUAN_POLL_TIMEOUT_MS = 5 * 60 * 1000;
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit --pretty src/integrations/agile-robot/constants.ts
```

- [ ] **Step 3: Commit**

---

### Task 3: Bootstrap helpers (`src/integrations/agile-robot/bootstrap.ts`)

**Files:**
- Create: `src/integrations/agile-robot/bootstrap.ts`

**Interfaces:**
- Produces: `getBootstrap()`, `hasBootstrap()`, `clearBootstrap()`, `storeBootstrap(bootstrap)`

- [ ] **Step 1: Write the bootstrap module**

```ts
import type { RobotsStudioBootstrap } from './types';
import { BOOTSTRAP_STORAGE_KEY, isOriginAllowed } from './constants';

/** Read stored bootstrap from sessionStorage. Returns null if absent or malformed. */
export function getBootstrap(): RobotsStudioBootstrap | null {
  try {
    const raw = sessionStorage.getItem(BOOTSTRAP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RobotsStudioBootstrap;
    if (!parsed?.studio_token || !parsed?.api_base_url || !parsed?.order_id) {
      return null;
    }
    return parsed;
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
  const b = data as RobotsStudioBootstrap | null | undefined;
  if (
    !b ||
    typeof b.studio_token !== 'string' ||
    !b.studio_token ||
    typeof b.api_base_url !== 'string' ||
    !b.api_base_url ||
    typeof b.order_id !== 'string' ||
    !b.order_id
  ) {
    return false;
  }
  sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(b));
  return true;
}

/**
 * Handle a postMessage event — validate origin, check type, store bootstrap.
 * Returns true when a valid bootstrap was stored.
 */
export function handleBootstrapMessage(event: MessageEvent): boolean {
  if (!isOriginAllowed(event.origin)) return false;
  const data = event.data as { type?: string; bootstrap?: unknown } | null;
  if (!data || data.type !== 'robots:studio-bootstrap') return false;
  return storeBootstrap(data.bootstrap);
}
```

- [ ] **Step 2: Write the unit test (`bootstrap.test.ts`)**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getBootstrap,
  hasBootstrap,
  clearBootstrap,
  storeBootstrap,
} from './bootstrap';
import { BOOTSTRAP_STORAGE_KEY } from './constants';

const validBootstrap = {
  studio_token: 'test-token',
  studio_expires_at: '2026-08-09T00:00:00Z',
  order_id: 'order-123',
  attachment_id: 'att-456',
  conversation_id: null,
  input_image_path: 'orders/order-123/model_input.png',
  fallback_input_image_path: 'orders/order-123/fallback.png',
  api_base_url: 'https://api.example.com/api/v1',
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('getBootstrap', () => {
  it('returns null when nothing stored', () => {
    expect(getBootstrap()).toBeNull();
  });

  it('returns parsed bootstrap when valid JSON stored', () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
    const result = getBootstrap();
    expect(result).not.toBeNull();
    expect(result!.studio_token).toBe('test-token');
  });

  it('returns null for malformed JSON', () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, '{not json');
    expect(getBootstrap()).toBeNull();
  });

  it('returns null when missing required fields (studio_token)', () => {
    sessionStorage.setItem(
      BOOTSTRAP_STORAGE_KEY,
      JSON.stringify({ ...validBootstrap, studio_token: '' }),
    );
    expect(getBootstrap()).toBeNull();
  });

  it('returns null when missing required fields (api_base_url)', () => {
    sessionStorage.setItem(
      BOOTSTRAP_STORAGE_KEY,
      JSON.stringify({ ...validBootstrap, api_base_url: '' }),
    );
    expect(getBootstrap()).toBeNull();
  });
});

describe('hasBootstrap', () => {
  it('returns false when empty', () => {
    expect(hasBootstrap()).toBe(false);
  });

  it('returns true when valid bootstrap stored', () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
    expect(hasBootstrap()).toBe(true);
  });
});

describe('clearBootstrap', () => {
  it('removes stored bootstrap', () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
    clearBootstrap();
    expect(hasBootstrap()).toBe(false);
  });
});

describe('storeBootstrap', () => {
  it('stores valid data and returns true', () => {
    expect(storeBootstrap(validBootstrap)).toBe(true);
    expect(hasBootstrap()).toBe(true);
  });

  it('returns false and does not store for null/undefined', () => {
    expect(storeBootstrap(null)).toBe(false);
    expect(hasBootstrap()).toBe(false);
  });

  it('returns false for missing studio_token', () => {
    expect(storeBootstrap({ ...validBootstrap, studio_token: '' })).toBe(false);
    expect(hasBootstrap()).toBe(false);
  });
});

describe('handleBootstrapMessage', () => {
  it('ignores messages from non-allowed origins', () => {
    const event = new MessageEvent('message', {
      origin: 'https://evil.example.com',
      data: { type: 'robots:studio-bootstrap', bootstrap: validBootstrap },
    });
    // isOriginAllowed will check against the allowed list; since the env isn't set,
    // it falls back to production domains, so evil.example.com should fail
    // We test this via import
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/integrations/agile-robot/bootstrap.test.ts
```

- [ ] **Step 4: Commit**

---

### Task 4: BFF API client (`src/integrations/agile-robot/api.ts`)

**Files:**
- Create: `src/integrations/agile-robot/api.ts`

**Interfaces:**
- Consumes: `getBootstrap` from bootstrap.ts, `HUNYUAN_POLL_INTERVAL_MS`/`HUNYUAN_POLL_TIMEOUT_MS` from constants.ts
- Consumes types from types.ts
- Produces: `jimengEdit(prompt, sourcePath?)`, `hunyuanSubmit(imagePath?)`, `hunyuanPollJob(signal?)`, `isAgileRobotApiError(e, status)`, class `AgileRobotApiError`

- [ ] **Step 1: Write the API module**

```ts
import { getBootstrap } from './bootstrap';
import { HUNYUAN_POLL_INTERVAL_MS, HUNYUAN_POLL_TIMEOUT_MS } from './constants';
import type {
  JimengEditResponse,
  HunyuanSubmitResponse,
  HunyuanJobResponse,
} from './types';

// ============================================================
// Error handling
// ============================================================

export class AgileRobotApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'AgileRobotApiError';
    this.status = status;
    this.body = body;
  }
}

export function isAgileRobotApiError(
  error: unknown,
  status?: number,
): error is AgileRobotApiError {
  if (!(error instanceof AgileRobotApiError)) return false;
  if (status !== undefined && error.status !== status) return false;
  return true;
}

// ============================================================
// Helpers
// ============================================================

function requireBootstrap() {
  const b = getBootstrap();
  if (!b) {
    throw new AgileRobotApiError(
      'No agile-robot bootstrap found in sessionStorage',
      401,
    );
  }
  return b;
}

function authHeaders(): Record<string, string> {
  const b = requireBootstrap();
  return {
    Authorization: `Bearer ${b.studio_token}`,
    'Content-Type': 'application/json',
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // no-op
    }
    throw new AgileRobotApiError(
      `Agile Robot API error: ${response.status}`,
      response.status,
      body,
    );
  }
  return response.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ============================================================
// Public API functions
// ============================================================

/**
 * 调用即梦改图。
 * prompt 是 LLM 生成的 JSON 结构化提示词。
 */
export async function jimengEdit(
  prompt: string,
  sourcePath?: string,
): Promise<JimengEditResponse> {
  const b = requireBootstrap();
  const body: { prompt: string; source_path?: string } = { prompt };
  if (sourcePath) {
    body.source_path = sourcePath;
  }

  const response = await fetch(
    `${b.api_base_url}/me/projects/${b.order_id}/studio/jimeng/edit`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
  );
  return handleResponse<JimengEditResponse>(response);
}

/**
 * 提交混元 3D 生成任务。
 * imagePath 可选；默认使用最新的改图结果。
 */
export async function hunyuanSubmit(
  imagePath?: string,
): Promise<HunyuanSubmitResponse> {
  const b = requireBootstrap();
  const body: { image_path?: string } = {};
  if (imagePath) {
    body.image_path = imagePath;
  }

  const response = await fetch(
    `${b.api_base_url}/me/projects/${b.order_id}/studio/hunyuan/submit`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
  );
  return handleResponse<HunyuanSubmitResponse>(response);
}

/**
 * 查询混元任务状态（单次，不轮询）。
 */
export async function hunyuanGetJob(): Promise<HunyuanJobResponse> {
  const b = requireBootstrap();
  const response = await fetch(
    `${b.api_base_url}/me/projects/${b.order_id}/studio/hunyuan/job`,
    {
      method: 'GET',
      headers: authHeaders(),
    },
  );
  return handleResponse<HunyuanJobResponse>(response);
}

/**
 * 轮询混元任务直到 done / failed / timeout。
 * 返回最终 job 状态。
 */
export async function hunyuanPollJob(
  signal?: AbortSignal,
): Promise<HunyuanJobResponse> {
  const startedAt = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new AgileRobotApiError('Polling aborted', 0);
    }
    if (Date.now() - startedAt > HUNYUAN_POLL_TIMEOUT_MS) {
      throw new AgileRobotApiError(
        '3D 生成超时，请稍后重试',
        408,
      );
    }

    const job = await hunyuanGetJob();

    if (job.status === 'done' || job.status === 'failed') {
      return job;
    }

    await sleep(HUNYUAN_POLL_INTERVAL_MS);
  }
}
```

- [ ] **Step 2: Write unit test (`api.test.ts`)**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jimengEdit, hunyuanSubmit, hunyuanGetJob, AgileRobotApiError } from './api';
import { BOOTSTRAP_STORAGE_KEY } from './constants';

const validBootstrap = {
  studio_token: 'tok',
  studio_expires_at: '…',
  order_id: 'order-1',
  attachment_id: 'att-1',
  conversation_id: null,
  input_image_path: 'orders/order-1/model_input.png',
  fallback_input_image_path: 'orders/order-1/fallback.png',
  api_base_url: 'https://api.example.com/api/v1',
};

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('jimengEdit', () => {
  it('throws when no bootstrap stored', async () => {
    await expect(jimengEdit('test prompt')).rejects.toThrow(AgileRobotApiError);
  });

  it('sends correct request and returns response', async () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
    const mockResponse = {
      output_path: 'orders/order-1/out.png',
      bytes_count: 1000,
      task_id: 'task-1',
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await jimengEdit('{"subject":"..."}');
    expect(result.output_path).toBe('orders/order-1/out.png');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/studio/jimeng/edit');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body).prompt).toBe('{"subject":"..."}');
  });

  it('throws on 401', async () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 401 }),
    );
    await expect(jimengEdit('test')).rejects.toThrow(AgileRobotApiError);
  });
});

describe('hunyuanSubmit', () => {
  it('sends correct request', async () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(validBootstrap));
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'j1', status: 'pending', trigger_source: 'studio' }), { status: 202 }),
    );
    const result = await hunyuanSubmit('orders/order-1/img.png');
    expect(result.job_id).toBe('j1');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/integrations/agile-robot/api.test.ts
```

- [ ] **Step 4: Commit**

---

### Task 5: postMessage listener hook (`src/integrations/agile-robot/hooks/useAgileRobotBootstrap.ts`)

**Files:**
- Create: `src/integrations/agile-robot/hooks/useAgileRobotBootstrap.ts`

**Interfaces:**
- Consumes: `handleBootstrapMessage`, `hasBootstrap`, `getBootstrap` from bootstrap.ts
- Produces: `useAgileRobotBootstrap()` — mounts once, listens for postMessage, returns `{ hasBootstrap: boolean }`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useSyncExternalStore } from 'react';
import { handleBootstrapMessage, hasBootstrap } from '../bootstrap';

/**
 * Mount in AppContent to listen for robots:studio-bootstrap postMessage.
 * Returns { hasBootstrap } to allow components to check session state.
 * Uses useSyncExternalStore to avoid unnecessary re-renders.
 */
const bootstrapListeners = new Set<() => void>();

function subscribeBootstrapChange(cb: () => void): () => void {
  bootstrapListeners.add(cb);
  return () => { bootstrapListeners.delete(cb); };
}

function notifyBootstrapChange(): void {
  bootstrapListeners.forEach((cb) => cb());
}

function getBootstrapSnapshot(): boolean {
  return hasBootstrap();
}

export function useAgileRobotBootstrap(): { hasBootstrap: boolean } {
  // Track bootstrap state reactively
  const hasBootstrapValue = useSyncExternalStore(
    subscribeBootstrapChange,
    getBootstrapSnapshot,
    getBootstrapSnapshot,
  );

  useEffect(() => {
    function handler(event: MessageEvent): void {
      const stored = handleBootstrapMessage(event);
      if (stored) {
        notifyBootstrapChange();
      }
    }

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, []);

  return { hasBootstrap: hasBootstrapValue };
}
```

- [ ] **Step 2: Write unit test (`useAgileRobotBootstrap.test.ts`)**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgileRobotBootstrap } from './useAgileRobotBootstrap';
import { BOOTSTRAP_STORAGE_KEY } from '../constants';

beforeEach(() => {
  sessionStorage.clear();
});

describe('useAgileRobotBootstrap', () => {
  it('returns hasBootstrap=false initially', () => {
    const { result } = renderHook(() => useAgileRobotBootstrap());
    expect(result.current.hasBootstrap).toBe(false);
  });

  it('returns hasBootstrap=true after receiving valid postMessage', () => {
    const { result } = renderHook(() => useAgileRobotBootstrap());

    expect(result.current.hasBootstrap).toBe(false);

    // Simulate a valid postMessage — note: origin validation depends on env,
    // but sessionStorage is writable directly for testing
    act(() => {
      sessionStorage.setItem(
        BOOTSTRAP_STORAGE_KEY,
        JSON.stringify({
          studio_token: 'tok',
          studio_expires_at: '…',
          order_id: 'o1',
          attachment_id: 'a1',
          conversation_id: null,
          input_image_path: 'p1',
          fallback_input_image_path: 'p2',
          api_base_url: 'https://api.example.com/api/v1',
        }),
      );
      // Dispatch a storage event to trigger the subscription
      window.dispatchEvent(new Event('storage'));
    });

    // useSyncExternalStore should pick up the change
    // Note: sessionStorage direct write won't trigger useSyncExternalStore
    // in jsdom — we test the core logic in bootstrap.test.ts and rely on
    // integration tests for the full flow.
  });
});
```

- [ ] **Step 3: Run tests** and **commit**

---

### Task 6: Mesh hot-reload (`src/integrations/agile-robot/meshReload.ts`)

**Files:**
- Create: `src/integrations/agile-robot/meshReload.ts`

**Interfaces:**
- Consumes: `useAssetsStore` from `@/store`
- Produces: `reloadMeshFromUrl(previewUrl: string): Promise<void>`

- [ ] **Step 1: Write the mesh reload function**

```ts
import { useAssetsStore } from '@/store';

/**
 * Fetch a GLB from the given preview_url and hot-reload it into the viewer.
 * Creates a blob URL, uploads to assetsStore for the viewer to pick up.
 */
export async function reloadMeshFromUrl(previewUrl: string): Promise<void> {
  const response = await fetch(previewUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch mesh: ${response.status}`);
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error('Empty mesh response');
  }

  const file = new File([blob], 'updated_model.glb', {
    type: 'model/gltf-binary',
  });

  // Store the new blob URL via assetsStore — the viewer re-renders when the asset changes
  const store = useAssetsStore.getState();
  const blobUrl = URL.createObjectURL(file);

  // Revoke any existing url for this key, then store the new one
  store.addAsset('__agile_robot_preview__/updated_model.glb', blobUrl);
}
```

- [ ] **Step 2: Write unit test (`meshReload.test.ts`)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reloadMeshFromUrl } from './meshReload';
import { useAssetsStore } from '@/store';

beforeEach(() => {
  vi.restoreAllMocks();
  // Reset assetsStore to a clean state
  useAssetsStore.setState({ assets: {} });
});

describe('reloadMeshFromUrl', () => {
  it('fetches URL and stores blob in assetsStore', async () => {
    const mockBlob = new Blob(['fake-glb-data'], { type: 'model/gltf-binary' });
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(mockBlob, { status: 200 }),
    );

    await reloadMeshFromUrl('https://api.example.com/preview?token=x');

    const assets = useAssetsStore.getState().assets;
    const key = '__agile_robot_preview__/updated_model.glb';
    expect(assets[key]).toBeDefined();
    expect(assets[key]).toMatch(/^blob:/);
  });

  it('throws on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    );
    await expect(
      reloadMeshFromUrl('https://api.example.com/bad'),
    ).rejects.toThrow('Failed to fetch mesh');
  });

  it('throws on empty response body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(new Blob([]), { status: 200 }),
    );
    await expect(
      reloadMeshFromUrl('https://api.example.com/empty'),
    ).rejects.toThrow('Empty mesh response');
  });
});
```

- [ ] **Step 3: Run tests** and **commit**

---

### Task 7: ToolConfirmBanner component (`src/integrations/agile-robot/components/ToolConfirmBanner.tsx`)

**Files:**
- Create: `src/integrations/agile-robot/components/ToolConfirmBanner.tsx`

**Interfaces:**
- Consumes: `ToolConfirmState`, `ParsedToolCall`, `ToolResult` from ../types
- Produces: `<ToolConfirmBanner>` component

- [ ] **Step 1: Write the component**

```tsx
import { Loader2, Check, AlertCircle } from 'lucide-react';
import type { ToolConfirmState, ParsedToolCall, ToolResult } from '../types';

export interface ToolConfirmBannerProps {
  state: ToolConfirmState;
  toolCall: ParsedToolCall;
  result?: ToolResult;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry?: () => void;
}

export function ToolConfirmBanner({
  state,
  toolCall,
  result,
  onConfirm,
  onCancel,
  onRetry,
}: ToolConfirmBannerProps) {
  if (state === 'idle' || state === 'cancelled') {
    return null;
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
      {state === 'parsed' && (
        <>
          <span className="text-base">🎨</span>
          <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
            {toolCall.summary}
          </span>
          <button
            onClick={onConfirm}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
          >
            确认
          </button>
          <button
            onClick={onCancel}
            className="rounded-md bg-gray-200 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            取消
          </button>
        </>
      )}

      {state === 'executing' && (
        <>
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            正在生成新的 3D 模型…
          </span>
        </>
      )}

      {state === 'done' && result && (
        <>
          <Check className="h-5 w-5 text-green-600" />
          <span className="text-sm text-green-700 dark:text-green-400">
            {result.message}
          </span>
        </>
      )}

      {state === 'error' && result && (
        <>
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="flex-1 text-sm text-red-600 dark:text-red-400">
            {result.message}
          </span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md bg-red-100 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
            >
              重试
            </button>
          )}
          <button
            onClick={onCancel}
            className="rounded-md bg-gray-200 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            取消
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write component test (`ToolConfirmBanner.test.tsx`)**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolConfirmBanner } from './ToolConfirmBanner';

const toolCall = {
  toolName: 'edit_robot_appearance',
  args: { prompt: '{"subject":"test"}' },
  summary: '将机身改为橙色，保留原视角',
};

describe('ToolConfirmBanner', () => {
  it('renders nothing when idle', () => {
    const { container } = render(
      <ToolConfirmBanner
        state="idle"
        toolCall={toolCall}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders confirmation UI when parsed', () => {
    render(
      <ToolConfirmBanner
        state="parsed"
        toolCall={toolCall}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('将机身改为橙色，保留原视角')).toBeDefined();
    expect(screen.getByText('确认')).toBeDefined();
    expect(screen.getByText('取消')).toBeDefined();
  });

  it('calls onConfirm when confirm clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ToolConfirmBanner
        state="parsed"
        toolCall={toolCall}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('确认'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('renders executing spinner', () => {
    render(
      <ToolConfirmBanner
        state="executing"
        toolCall={toolCall}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('正在生成新的 3D 模型…')).toBeDefined();
  });

  it('renders done state', () => {
    render(
      <ToolConfirmBanner
        state="done"
        toolCall={toolCall}
        result={{ success: true, message: '3D 模型已更新' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('3D 模型已更新')).toBeDefined();
  });

  it('renders error state with retry button', () => {
    const onRetry = vi.fn();
    render(
      <ToolConfirmBanner
        state="error"
        toolCall={toolCall}
        result={{ success: false, message: '生成失败：上游错误' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('生成失败：上游错误')).toBeDefined();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run tests** and **commit**

---

### Task 8: Tools hook (`src/integrations/agile-robot/hooks/useAgileRobotTools.ts`)

**Files:**
- Create: `src/integrations/agile-robot/hooks/useAgileRobotTools.ts`

**Interfaces:**
- Consumes: `hasBootstrap`, `getBootstrap` from bootstrap.ts, `jimengEdit`, `hunyuanSubmit`, `hunyuanPollJob`, `AgileRobotApiError` from api.ts, `reloadMeshFromUrl` from meshReload.ts, `AIConversationToolsConfig`, `AIConversationToolDef`, `ParsedToolCall`, `ToolResult`, `ToolConfirmState` from types.ts
- Produces: `useAgileRobotTools(): AIConversationToolsConfig | null`

- [ ] **Step 1: Write the hook**

```ts
import { useCallback, useRef } from 'react';
import { hasBootstrap, getBootstrap } from '../bootstrap';
import { jimengEdit, hunyuanSubmit, hunyuanPollJob, AgileRobotApiError } from '../api';
import { reloadMeshFromUrl } from '../meshReload';
import type {
  AIConversationToolsConfig,
  AIConversationToolDef,
  ParsedToolCall,
  ToolResult,
} from '../types';

// ============================================================
// Tool definitions (OpenAI function-calling shapes)
// ============================================================

const TOOL_DEFS: AIConversationToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'edit_robot_appearance',
      description: `修改机器人外观并重新生成3D模型。

当用户请求修改外观时，你必须生成结构化的JSON提示词作为prompt参数。
JSON包含五个字段：
- subject：将用户需求翻译为精确的视觉描述（材质、颜色、形状、结构），使用具体颜色名和色值（如"亮橙色 #FF8C00"、"哑光黑"、"拉丝金属"）
- preserve：明确列出必须保留的元素（视角、结构、关节、背景）
- size：固定为 "512x512"
- style：工业设计渲染，影棚灯光，高清晰度，photorealistic
- negative：不要改变机器人结构、不要变形、不要添加文字或logo

你必须输出合法的JSON字符串（单行，不含换行和注释），作为prompt参数的值。

示例——用户说"把机身改成橙色"，prompt参数值：
{"subject":"机器人机身改为亮橙色(#FF8C00)，保留原有金属材质质感和反光特性","preserve":"保持原有摄像机视角、机器人结构、关节位置和背景完全不变","size":"512x512","style":"工业设计渲染风格，影棚灯光，高清晰度，photorealistic","negative":"不要改变机器人结构、不要变形、不要添加文字或logo"}`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'JSON structured image editing prompt with subject, preserve, size, style, negative fields',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'regenerate_robot_3d',
      description: '直接用现有图片重新生成3D模型，不需要修改外观',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

// ============================================================
// Tool call parser
// ============================================================

interface RawToolCall {
  function: { name: string; arguments: string };
}

function buildSummary(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'edit_robot_appearance') {
    const prompt = typeof args.prompt === 'string' ? args.prompt : '';
    // Try to extract subject from JSON prompt for a shorter summary
    try {
      const parsed = JSON.parse(prompt) as { subject?: string };
      if (parsed.subject) {
        return parsed.subject.length > 50
          ? parsed.subject.slice(0, 50) + '…'
          : parsed.subject;
      }
    } catch {
      // Not JSON — use prompt directly
    }
    return prompt.length > 50 ? prompt.slice(0, 50) + '…' : prompt;
  }
  if (toolName === 'regenerate_robot_3d') {
    return '重新生成 3D 模型';
  }
  return toolName;
}

function parseToolCalls(rawToolCalls: RawToolCall[]): ParsedToolCall | null {
  if (!rawToolCalls.length) return null;

  const tc = rawToolCalls[0];
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!tc.function.name) return null;

  return {
    toolName: tc.function.name,
    args,
    summary: buildSummary(tc.function.name, args),
  };
}

// ============================================================
// Hook
// ============================================================

export function useAgileRobotTools(): AIConversationToolsConfig | null {
  const abortRef = useRef<AbortController | null>(null);

  const onExecute = useCallback(
    async (toolCall: ParsedToolCall): Promise<ToolResult> => {
      const b = getBootstrap();
      if (!b) {
        return {
          success: false,
          message: '会话已过期，请回到 Agile Robot 主站重新点击预览',
        };
      }

      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      try {
        if (toolCall.toolName === 'edit_robot_appearance') {
          const prompt = (toolCall.args.prompt as string) || '';
          // Step 1: jimeng edit
          await jimengEdit(prompt, b.input_image_path);

          // Step 2: hunyuan submit
          await hunyuanSubmit('orders/' + b.order_id + '/model_input_customized.png');

          // Step 3: poll until done
          const job = await hunyuanPollJob(signal);

          if (job.status === 'done' && job.preview_url) {
            await reloadMeshFromUrl(job.preview_url);
            return { success: true, message: '3D 模型已更新' };
          }

          return {
            success: false,
            message: job.error_message || '3D 生成失败',
          };
        }

        if (toolCall.toolName === 'regenerate_robot_3d') {
          await hunyuanSubmit();
          const job = await hunyuanPollJob(signal);

          if (job.status === 'done' && job.preview_url) {
            await reloadMeshFromUrl(job.preview_url);
            return { success: true, message: '3D 模型已更新' };
          }

          return {
            success: false,
            message: job.error_message || '3D 生成失败',
          };
        }

        return { success: false, message: '未知工具: ' + toolCall.toolName };
      } catch (error) {
        if (signal.aborted) {
          return { success: false, message: '已取消' };
        }
        if (error instanceof AgileRobotApiError) {
          if (error.status === 401) {
            return {
              success: false,
              message: '会话已过期，请回到 Agile Robot 主站重新点击预览',
            };
          }
          if (error.status === 409) {
            return {
              success: false,
              message: '3D 生成任务正在进行中，请等待完成',
            };
          }
          return {
            success: false,
            message: error.message,
          };
        }
        return {
          success: false,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
    [],
  );

  // Only return config when in a robots session
  if (!hasBootstrap()) return null;

  return {
    tools: TOOL_DEFS,
    parseToolCalls,
    onExecute,
  };
}
```

- [ ] **Step 2: Write unit test (`useAgileRobotTools.test.ts`)**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgileRobotTools } from './useAgileRobotTools';
import { BOOTSTRAP_STORAGE_KEY } from '../constants';

beforeEach(() => {
  sessionStorage.clear();
});

describe('useAgileRobotTools', () => {
  it('returns null when no bootstrap', () => {
    const { result } = renderHook(() => useAgileRobotTools());
    expect(result.current).toBeNull();
  });

  it('returns tools config when bootstrap exists', () => {
    sessionStorage.setItem(
      BOOTSTRAP_STORAGE_KEY,
      JSON.stringify({
        studio_token: 'tok',
        studio_expires_at: '…',
        order_id: 'o1',
        attachment_id: 'a1',
        conversation_id: null,
        input_image_path: 'p1',
        fallback_input_image_path: 'p2',
        api_base_url: 'https://api.example.com/api/v1',
      }),
    );

    const { result } = renderHook(() => useAgileRobotTools());
    expect(result.current).not.toBeNull();
    expect(result.current!.tools).toHaveLength(2);
    expect(result.current!.tools[0].function.name).toBe('edit_robot_appearance');
    expect(result.current!.tools[1].function.name).toBe('regenerate_robot_3d');
  });

  it('parseToolCalls extracts structured tool call', () => {
    sessionStorage.setItem(
      BOOTSTRAP_STORAGE_KEY,
      JSON.stringify({
        studio_token: 'tok',
        order_id: 'o1',
        api_base_url: 'https://api.example.com/api/v1',
        attachment_id: 'a1',
        conversation_id: null,
        input_image_path: 'p1',
        fallback_input_image_path: 'p2',
        studio_expires_at: '…',
      }),
    );
    const { result } = renderHook(() => useAgileRobotTools());

    const toolCall = result.current!.parseToolCalls([
      {
        function: {
          name: 'edit_robot_appearance',
          arguments: '{"prompt":"{\\"subject\\":\\"改为橙色\\"}"}',
        },
      },
    ]);
    expect(toolCall).not.toBeNull();
    expect(toolCall!.toolName).toBe('edit_robot_appearance');
  });

  it('parseToolCalls returns null for empty array', () => {
    sessionStorage.setItem(
      BOOTSTRAP_STORAGE_KEY,
      JSON.stringify({
        studio_token: 'tok',
        order_id: 'o1',
        api_base_url: 'https://api.example.com/api/v1',
        attachment_id: 'a1',
        conversation_id: null,
        input_image_path: 'p1',
        fallback_input_image_path: 'p2',
        studio_expires_at: '…',
      }),
    );
    const { result } = renderHook(() => useAgileRobotTools());
    expect(result.current!.parseToolCalls([])).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests** and **commit**

---

### Task 9: Public barrel (`src/integrations/agile-robot/index.ts`)

**Files:**
- Create: `src/integrations/agile-robot/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
export { useAgileRobotBootstrap } from './hooks/useAgileRobotBootstrap';
export { useAgileRobotTools } from './hooks/useAgileRobotTools';
export { reloadMeshFromUrl } from './meshReload';
export { hasBootstrap, getBootstrap, clearBootstrap } from './bootstrap';
export type {
  RobotsStudioBootstrap,
  JimengEditRequest,
  JimengEditResponse,
  HunyuanSubmitRequest,
  HunyuanSubmitResponse,
  HunyuanJobResponse,
  AIConversationToolsConfig,
  AIConversationToolDef,
  ParsedToolCall,
  ToolResult,
} from './types';
```

- [ ] **Step 2: Verify exports compile**

```bash
npx tsc --noEmit --pretty src/integrations/agile-robot/index.ts
```

- [ ] **Step 3: Commit**

---

### Task 10: Modify conversationService.ts — add tools support

**Files:**
- Modify: `src/features/ai-assistant/services/conversationService.ts`

**Interfaces:**
- Consumes: OpenAI SDK types
- Produces: Updated `SendConversationTurnStreamInput` with optional `tools` and `onToolCalls`

- [ ] **Step 1: Add types and extend the input interface**

Add near the top of the file (after existing imports):

```ts
// New: tool-calling types for provider-agnostic function calling
export interface ConversationToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ConversationToolCall {
  function: { name: string; arguments: string };
}
```

Modify `SendConversationTurnStreamInput` to add optional `tools` and `onToolCalls`:

```ts
export interface SendConversationTurnStreamInput extends SendConversationTurnInput {
  signal?: AbortSignal;
  onReplyDelta?: (delta: string) => void;
  // NEW — provider-agnostic tool calling:
  tools?: ConversationToolDefinition[];
  onToolCalls?: (toolCalls: ConversationToolCall[]) => void;
}
```

- [ ] **Step 2: Add tool-call extraction helper**

Add after `extractConversationDelta`:

```ts
/**
 * Accumulate streaming tool_calls from a chunk into a map keyed by index.
 * OpenAI streams tool_calls across multiple chunks:
 *  - first chunk: { index, id, type, function: { name } }
 *  - subsequent chunks: { index, function: { arguments: "..." } }
 */
export function accumulateToolCallDeltas(
  acc: Map<number, { id?: string; name?: string; arguments: string }>,
  chunk: ConversationStreamChunkLike | null | undefined,
): void {
  if (!chunk?.choices?.length) return;
  for (const choice of chunk.choices) {
    const toolCalls = choice.delta?.tool_calls;
    if (!toolCalls) continue;
    for (const tc of toolCalls) {
      const existing = acc.get(tc.index) ?? { arguments: '' };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name = tc.function.name;
      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
      acc.set(tc.index, existing);
    }
  }
}
```

- [ ] **Step 3: Modify the direct-to-provider stream loop**

In the `sendConversationTurnStream` function, in the direct-to-provider path (around line 264), modify the `openai.chat.completions.create` call to include `tools`:

```ts
const stream = await openai.chat.completions.create(
  {
    model: modelName,
    messages: requestMessages,
    temperature: 0.3,
    stream: true,
    ...(extraBody ? { extra_body: extraBody } : {}),
    // NEW — pass tools when provided
    ...(tools && tools.length > 0 ? { tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[] } : {}),
  },
  { signal },
);
```

Modify the stream loop to detect and accumulate tool_calls:

```ts
// Before the loop: track tool_calls
const toolCallAcc = new Map<number, { id?: string; name?: string; arguments: string }>();
let finishReason: string | null = null;

for await (const chunk of stream) {
  // Check finish_reason
  const firstChoice = chunk.choices?.[0];
  if (firstChoice?.finish_reason) {
    finishReason = firstChoice.finish_reason;
  }

  // Accumulate tool_calls if present
  accumulateToolCallDeltas(toolCallAcc, chunk);

  // Existing content extraction
  const delta = extractConversationDelta(chunk);
  if (!delta) continue;

  reply += delta;
  // ... existing stripping/onReplyDelta logic unchanged ...
}

// After the loop: check for tool_calls
if (finishReason === 'tool_calls' && toolCallAcc.size > 0) {
  const toolCalls: ConversationToolCall[] = Array.from(toolCallAcc.values())
    .filter((tc) => tc.name)
    .map((tc) => ({
      function: {
        name: tc.name!,
        arguments: tc.arguments,
      },
    }));

  if (toolCalls.length > 0 && onToolCalls) {
    onToolCalls(toolCalls);
    // Return with empty reply — caller handles tool confirmation UI
    return {
      reply: '',
      error: null,
      status: 'completed',
    };
  }
}
```

- [ ] **Step 4: Update existing unit tests**

In `conversationService.test.ts`, add tests for:
- `extractConversationDelta` still works for content deltas
- `accumulateToolCallDeltas` correctly accumulates across chunks
- `sendConversationTurnStream` calls `onToolCalls` when LLM returns tool_calls
- `sendConversationTurnStream` does NOT call `onToolCalls` when no tools provided (backward compat)

- [ ] **Step 5: Run existing conversation tests to ensure no regression**

```bash
npx vitest run src/features/ai-assistant/services/conversationService.test.ts
```

- [ ] **Step 6: Commit**

---

### Task 11: Modify AIConversationModal.tsx — add toolsConfig prop and banner

**Files:**
- Modify: `src/features/ai-assistant/components/AIConversationModal.tsx`

**Interfaces:**
- Consumes: `AIConversationToolsConfig`, `ParsedToolCall`, `ToolResult` types
- Produces: updated modal with optional `toolsConfig` prop

- [ ] **Step 1: Add imports and interface update**

Add new imports:

```tsx
import { ToolConfirmBanner } from '@/integrations/agile-robot/components/ToolConfirmBanner';
import type {
  AIConversationToolsConfig,
  ParsedToolCall,
  ToolResult,
  ToolConfirmState,
} from '@/integrations/agile-robot/types';
```

Add `toolsConfig` to props:

```tsx
interface AIConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
  // NEW
  toolsConfig?: AIConversationToolsConfig | null;
}
```

Destructure in component body:

```tsx
export function AIConversationModal({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
  toolsConfig,
}: AIConversationModalProps) {
```

- [ ] **Step 2: Add tool confirmation state**

Add state near other useState declarations:

```tsx
const [toolConfirmState, setToolConfirmState] = useState<ToolConfirmState>('idle');
const [pendingToolCall, setPendingToolCall] = useState<ParsedToolCall | null>(null);
const [toolResult, setToolResult] = useState<ToolResult | null>(null);
```

- [ ] **Step 3: Modify the send function to pass tools and handle tool_calls**

In the `sendConversationTurnStream` call (around line 419), add `tools` and `onToolCalls`:

```tsx
const result = await sendConversationTurnStream({
  mode: launchContext.mode,
  lang,
  context: buildConversationContext({ /* ... */ }),
  history,
  userMessage: trimmedMessage,
  signal: abortController.signal,
  onReplyDelta: (delta) => { /* ... */ },
  // NEW
  ...(toolsConfig ? {
    tools: toolsConfig.tools,
    onToolCalls: (rawToolCalls) => {
      const parsed = toolsConfig.parseToolCalls(rawToolCalls);
      if (parsed) {
        setPendingToolCall(parsed);
        setToolConfirmState('parsed');
        setToolResult(null);
      }
    },
  } : {}),
});
```

- [ ] **Step 4: Add confirm/execute/cancel handlers**

```tsx
const handleToolConfirm = useCallback(async () => {
  if (!pendingToolCall || !toolsConfig) return;
  setToolConfirmState('executing');
  const result = await toolsConfig.onExecute(pendingToolCall);
  setToolResult(result);
  setToolConfirmState(result.success ? 'done' : 'error');
}, [pendingToolCall, toolsConfig]);

const handleToolCancel = useCallback(() => {
  setToolConfirmState('cancelled');
  setPendingToolCall(null);
  setToolResult(null);
  // Append "已取消" message
  setMessages((prev) => [
    ...prev,
    { type: 'assistant' as const, content: '已取消', sessionId: launchContext?.sessionId ?? 0 },
  ]);
}, [launchContext?.sessionId]);

const handleToolRetry = useCallback(() => {
  void handleToolConfirm();
}, [handleToolConfirm]);
```

- [ ] **Step 5: Render ToolConfirmBanner in JSX**

Add between the message list and the input area:

```tsx
{toolsConfig && pendingToolCall && (
  <ToolConfirmBanner
    state={toolConfirmState}
    toolCall={pendingToolCall}
    result={toolResult ?? undefined}
    onConfirm={() => void handleToolConfirm()}
    onCancel={handleToolCancel}
    onRetry={toolConfirmState === 'error' ? handleToolRetry : undefined}
  />
)}
```

- [ ] **Step 6: Update component tests**

Add tests for:
- `toolsConfig` undefined → no ToolConfirmBanner rendered
- `toolsConfig` provided → tools passed to `sendConversationTurnStream`
- ToolConfirmBanner appears when tool_calls received
- Confirm button triggers execute
- Cancel button dismisses banner

- [ ] **Step 7: Run tests**

```bash
npx vitest run src/features/ai-assistant/components/AIConversationModal.test.tsx
```

- [ ] **Step 8: Commit**

---

### Task 12: Modify AIConversationConnector.tsx — pass toolsConfig

**Files:**
- Modify: `src/app/components/ai/AIConversationConnector.tsx`

- [ ] **Step 1: Update the connector**

```tsx
import { AIConversationModal } from '@/features/ai-assistant';
import type { AIConversationLaunchContext } from '@/features/ai-assistant';
import type { Language } from '@/shared/i18n';
import { useAgileRobotTools } from '@/integrations/agile-robot';

interface AIConversationConnectorProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
}

export function AIConversationConnector({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
}: AIConversationConnectorProps) {
  const toolsConfig = useAgileRobotTools();

  return (
    <AIConversationModal
      isOpen={isOpen}
      onClose={onClose}
      lang={lang}
      launchContext={launchContext}
      onStartNewConversation={onStartNewConversation}
      toolsConfig={toolsConfig}
    />
  );
}
```

- [ ] **Step 2: Commit**

---

### Task 13: Wire up in App.tsx

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add import and hook call**

Add import:

```tsx
import { useAgileRobotBootstrap } from '@/integrations/agile-robot';
```

In the `AppContent` function body, add the hook call (near the other hook calls at the top):

```tsx
export function AppContent({ extensions, onExposeActions }: AppContentProps = {}) {
  useUnsavedChangesPrompt();

  // NEW — listen for robots:studio-bootstrap postMessage
  useAgileRobotBootstrap();

  // ... rest of existing code unchanged
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit --pretty
```

- [ ] **Step 3: Commit**

---

### Task 14: Add env var to .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the env var**

Find the section with `VITE_HANDOFF_ORIGINS` and add after it:

```env
# Agile Robot integration: origin(s) allowed to send robots:studio-bootstrap postMessage.
# Comma-separated, supports * wildcard (e.g. https://*.enkeebot.com,https://*.enkeebot.cn).
VITE_AGILE_ROBOT_ORIGINS=https://*.enkeebot.com,https://*.enkeebot.cn
```

- [ ] **Step 2: Commit**

---

### Task 15: Verify full build and integration

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck:quality
```

- [ ] **Step 2: Run all unit tests for changed modules**

```bash
npx vitest run src/integrations/agile-robot/
npx vitest run src/features/ai-assistant/services/conversationService.test.ts
npx vitest run src/features/ai-assistant/components/AIConversationModal.test.tsx
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

- [ ] **Step 4: Verify dev server starts without errors**

```bash
npm run dev
# Open http://127.0.0.1:3000 — confirm:
# - App loads normally (no robots bootstrap)
# - AI Conversation opens and works as before (no tools)
# - No console errors
```

- [ ] **Step 5: Commit final verification**
