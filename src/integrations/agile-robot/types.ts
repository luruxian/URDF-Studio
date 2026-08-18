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
  /** GLB original_name; only present when status === "done". */
  filename?: string | null;
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
