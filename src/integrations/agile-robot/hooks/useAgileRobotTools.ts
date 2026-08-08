// ============================================================
// useAgileRobotTools: AI conversation tool definitions + execute pipeline
//
// 当处于 robots 主站会话时，返回 AIConversationToolsConfig 供 AI 对话 UI 使用：
// - tools: OpenAI function-calling 形状的两个工具定义
// - parseToolCalls: 把 LLM 返回的 tool_calls 解析为结构化 ParsedToolCall（含中文摘要）
// - onExecute: 执行确认后的工具调用（即梦改图 → 混元生成 → 轮询 → mesh 热重载）
// 未处于 robots 会话（无 bootstrap）时返回 null。
// ============================================================

import { useCallback, useRef } from 'react';
import { hasBootstrap, getBootstrap } from '../bootstrap';
import { jimengEdit, hunyuanSubmit, hunyuanPollJob, AgileRobotApiError } from '../api';
import { reloadMeshFromUrl, type MeshReloadImportPort } from '../meshReload';
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

/** 把工具调用的 prompt 参数压缩为确认 UI 可展示的中文概括（优先取 JSON 的 subject）。 */
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

/**
 * 解析 LLM 返回的 tool_calls。取第一个调用，解析其 JSON arguments。
 * 空数组 / 非法 JSON / 缺 name 时返回 null（表示不是一次可执行的工具调用）。
 */
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

export interface UseAgileRobotToolsOptions {
  /** Port that routes a regenerated GLB through the app file-import pipeline so
   *  the 3D viewport updates. Required for hot-reload; without it a successful
   *  regeneration cannot swap the visible model. */
  reloadMesh?: MeshReloadImportPort | null;
}

export function useAgileRobotTools(options: UseAgileRobotToolsOptions = {}): AIConversationToolsConfig | null {
  const { reloadMesh = null } = options;
  const abortRef = useRef<AbortController | null>(null);
  const reloadMeshRef = useRef<MeshReloadImportPort | null>(reloadMesh);
  reloadMeshRef.current = reloadMesh;

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
          const prompt =
            typeof toolCall.args.prompt === 'string' ? toolCall.args.prompt : '';
          // Step 1: jimeng edit
          await jimengEdit(prompt, b.input_image_path);

          // Step 2: hunyuan submit
          await hunyuanSubmit('orders/' + b.order_id + '/model_input_customized.png');

          // Step 3: poll until done
          const job = await hunyuanPollJob(signal);

          if (job.status === 'done' && job.preview_url) {
            const reloadMesh = reloadMeshRef.current;
            if (!reloadMesh) {
              return {
                success: false,
                message: '3D 模型已生成，但预览刷新未接入',
              };
            }
            await reloadMeshFromUrl(job.preview_url, reloadMesh);
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
            const reloadMesh = reloadMeshRef.current;
            if (!reloadMesh) {
              return {
                success: false,
                message: '3D 模型已生成，但预览刷新未接入',
              };
            }
            await reloadMeshFromUrl(job.preview_url, reloadMesh);
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
