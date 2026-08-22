// ============================================================
// useAgileRobotTools: AI conversation tool definitions + execute pipeline
//
// 当处于 robots 主站会话时，返回 AIConversationToolsConfig 供 AI 对话 UI 使用：
// - tools: OpenAI function-calling 形状的两个工具定义
// - parseToolCalls: 把 LLM 返回的 tool_calls 解析为结构化 ParsedToolCall（含摘要）
// - onExecute: 执行确认后的工具调用（即梦改图 → 混元生成 → 轮询 → mesh 热重载）
// 未处于 robots 会话（无 bootstrap）时返回 null。
// ============================================================

import { useCallback, useRef } from 'react';
import type { Language } from '@/shared/i18n';
import { hasBootstrap, getBootstrap } from '../bootstrap';
import {
  jimengEdit,
  hunyuanSubmit,
  hunyuanPollJob,
  formatHunyuanJobFailure,
  AgileRobotApiError,
} from '../api';
import type { HunyuanJobResponse } from '../types';
import { resolveMeshAuthErrorCode } from '../meshAuth';
import { reloadMeshFromUrl, type MeshReloadImportPort } from '../meshReload';
import { getAgileRobotToolTexts, type AgileRobotToolTexts } from '../agileRobotToolTexts';
import type {
  AIConversationToolsConfig,
  AIConversationToolDef,
  ParsedToolCall,
  ToolResult,
} from '../types';

function messageForMeshAuthFailure(
  error: unknown,
  texts: AgileRobotToolTexts,
): string | null {
  const code = resolveMeshAuthErrorCode(error);
  if (!code) return null;
  switch (code) {
    case 'auth_missing':
    case 'auth_expired':
      return texts.agileRobotToolSessionExpired;
    case 'not_found':
      return texts.meshPreviewNotFound;
    case 'unavailable':
      return texts.meshPreviewUnavailable;
  }
}

// ============================================================
// Tool definitions (OpenAI function-calling shapes)
// ============================================================

const TOOL_DEFS: AIConversationToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'edit_robot_appearance',
      description: `对机器人或 3D 模型进行局部修改（含零部件替换、局部改造等）并重新生成 3D 模型。

当用户请求对机器人或 3D 模型进行局部修改时，必须调用本工具，并生成结构化的 JSON 提示词作为 prompt 参数。适用场景包括但不限于：改某部件颜色/材质、调整局部外观、零部件替换、局部改造等；不包括在不改外观的情况下仅重生 3D，也不包括用全新模型整体替换当前机器人。
JSON包含五个字段：
- subject：将用户需求翻译为精确的视觉描述（材质、颜色、形状、结构），使用具体颜色名和色值（如"亮橙色 #FF8C00"、"哑光黑"、"拉丝金属"）
- preserve：明确列出必须保留的元素（视角、结构、关节、背景）
- size：固定为 "1024x1024"
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
            description:
              'JSON structured image editing prompt with subject, preserve, size, style, negative fields',
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

/** 把工具调用的 prompt 参数压缩为确认 UI 可展示的概括（优先取 JSON 的 subject）。 */
function buildSummary(
  toolName: string,
  args: Record<string, unknown>,
  texts: AgileRobotToolTexts,
): string {
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
    return texts.agileRobotToolRegenerateSummary;
  }
  return toolName;
}

function createParseToolCalls(texts: AgileRobotToolTexts) {
  /**
   * 解析 LLM 返回的 tool_calls。取第一个调用，解析其 JSON arguments。
   * 空数组 / 非法 JSON / 缺 name 时返回 null（表示不是一次可执行的工具调用）。
   */
  return function parseToolCalls(rawToolCalls: RawToolCall[]): ParsedToolCall | null {
    if (!rawToolCalls.length) return null;

    const tc = rawToolCalls[0];
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      return null;
    }

    // JSON.parse may legitimately return null or a scalar; buildSummary needs an
    // object to read args.prompt, so treat anything non-object as non-executable.
    if (args === null || typeof args !== 'object') return null;

    if (!tc.function.name) return null;

    return {
      toolName: tc.function.name,
      args,
      summary: buildSummary(tc.function.name, args, texts),
    };
  };
}

async function reloadDoneHunyuanJob(
  job: HunyuanJobResponse,
  reloadMesh: MeshReloadImportPort | null,
  texts: AgileRobotToolTexts,
): Promise<ToolResult> {
  if (job.status === 'done' && job.preview_url) {
    if (!reloadMesh) {
      return {
        success: false,
        message: texts.agileRobotToolPreviewNotConnected,
      };
    }
    await reloadMeshFromUrl(job.preview_url, reloadMesh, job.filename);
    return { success: true, message: texts.agileRobotToolModelUpdated };
  }

  return {
    success: false,
    message: formatHunyuanJobFailure(job, texts.agileRobotToolGenerationFailed),
  };
}

// ============================================================
// Hook
// ============================================================

export interface UseAgileRobotToolsOptions {
  /** UI language for tool summaries and execution feedback. */
  lang: Language;
  /** Port that routes a regenerated GLB through the app file-import pipeline so
   *  the 3D viewport updates. Required for hot-reload; without it a successful
   *  regeneration cannot swap the visible model. */
  reloadMesh?: MeshReloadImportPort | null;
}

export function useAgileRobotTools(
  options: UseAgileRobotToolsOptions,
): AIConversationToolsConfig | null {
  const { lang, reloadMesh = null } = options;
  const texts = getAgileRobotToolTexts(lang);
  const abortRef = useRef<AbortController | null>(null);
  const reloadMeshRef = useRef<MeshReloadImportPort | null>(reloadMesh);
  reloadMeshRef.current = reloadMesh;

  const onExecute = useCallback(
    async (toolCall: ParsedToolCall): Promise<ToolResult> => {
      const b = getBootstrap();
      if (!b) {
        return {
          success: false,
          message: texts.agileRobotToolSessionExpired,
        };
      }

      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      try {
        if (toolCall.toolName === 'edit_robot_appearance') {
          const prompt =
            typeof toolCall.args.prompt === 'string' ? toolCall.args.prompt : '';
          // Step 1: jimeng edit — prefer bootstrap source, then fallback path
          // (docs/integrations/urdf-studio.md §5). Omit empty strings so the
          // BFF can apply its own default when neither path is set.
          const sourcePath =
            b.input_image_path || b.fallback_input_image_path || undefined;
          await jimengEdit(prompt, sourcePath);

          // Step 2: hunyuan submit
          await hunyuanSubmit('orders/' + b.order_id + '/model_input_customized.png');

          // Step 3: poll until done (3–5s interval; filename from job, not preview_url)
          const job = await hunyuanPollJob(signal);
          return await reloadDoneHunyuanJob(job, reloadMeshRef.current, texts);
        }

        if (toolCall.toolName === 'regenerate_robot_3d') {
          await hunyuanSubmit();
          const job = await hunyuanPollJob(signal);
          return await reloadDoneHunyuanJob(job, reloadMeshRef.current, texts);
        }

        return {
          success: false,
          message: texts.agileRobotToolUnknownTool.replace('{toolName}', toolCall.toolName),
        };
      } catch (error) {
        if (signal.aborted) {
          return { success: false, message: texts.agileRobotToolCancelled };
        }
        if (error instanceof AgileRobotApiError) {
          if (error.status === 401) {
            return {
              success: false,
              message: texts.agileRobotToolSessionExpired,
            };
          }
          if (error.status === 409) {
            return {
              success: false,
              message: texts.agileRobotToolJobInProgress,
            };
          }
          return {
            success: false,
            message: error.message,
          };
        }
        const meshAuthMessage = messageForMeshAuthFailure(error, texts);
        if (meshAuthMessage) {
          return { success: false, message: meshAuthMessage };
        }
        return {
          success: false,
          message: error instanceof Error ? error.message : texts.agileRobotToolUnknownError,
        };
      }
    },
    [texts],
  );

  // Only return config when in a robots session
  if (!hasBootstrap()) return null;

  return {
    tools: TOOL_DEFS,
    parseToolCalls: createParseToolCalls(texts),
    onExecute,
  };
}
