/**
 * Resolve an AI modification proposal: run the surgical tool-calling agent,
 * falling back to the legacy full-robot regeneration only for non-tool-calling
 * errors (network, timeout, etc.). When the endpoint rejects tool-calling,
 * the user gets a clear message instead of a silent fallback that clobbers
 * mesh data.
 *
 * Boundary: feature layer. Imports `@/core/...` (none here), same-feature
 * services (`aiService`, `aiAgent`), `@/shared/i18n`, `@/types`.
 */

import type { Language } from '@/shared/i18n';
import type { MotorSpec, RobotData, RobotState } from '@/types';
import { generateRobotFromPrompt } from '../services/aiService';
import { runRobotEditAgent, AgentToolsUnsupportedError } from '../services/aiAgent';
import { isRobotsAgentLlmConfigured } from '../services/robotsAgentLlm';

export type ModificationProposal =
  | { kind: 'change'; robot: Partial<RobotState>; explanation: string }
  | { kind: 'no-change'; explanation: string }
  | { kind: 'aborted' };

export interface ResolveModificationProposalArgs {
  message: string;
  /** Current robot (with selection stripped) for the legacy fallback path. */
  currentRobot: RobotState;
  /** Live robot data fed to the agent (re-resolved at submit time). */
  robotData: RobotData;
  motorLibrary: Record<string, MotorSpec[]>;
  lang: Language;
  signal: AbortSignal;
  /** Called for each tool call the agent makes. */
  onToolCall?: (step: string) => void;
}

/**
 * Returns `change` when there is an edited robot to apply, `no-change` when the
 * model made no tool calls (or the fallback returned only advice), and `aborted`
 * when the user cancelled mid-flight (caller should render nothing).
 */
export async function resolveModificationProposal(
  args: ResolveModificationProposalArgs,
): Promise<ModificationProposal> {
  const { message, currentRobot, robotData, motorLibrary, lang, signal, onToolCall } = args;
  try {
    const agentResult = await runRobotEditAgent(message, robotData, lang, signal, onToolCall);
    if (agentResult.robot) {
      return { kind: 'change', robot: agentResult.robot, explanation: agentResult.explanation };
    }
    return { kind: 'no-change', explanation: agentResult.explanation };
  } catch (agentError) {
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    if (agentError instanceof AgentToolsUnsupportedError) {
      const errorMessage = (agentError as Error).message || '';
      if (/api.?key/i.test(errorMessage) && !isRobotsAgentLlmConfigured()) {
        const response = await generateRobotFromPrompt(message, currentRobot, motorLibrary, lang);
        if (!response || !response.robotData) {
          return { kind: 'no-change', explanation: response?.explanation ?? '' };
        }
        return { kind: 'change', robot: response.robotData, explanation: response.explanation ?? '' };
      }
      const hint = isRobotsAgentLlmConfigured()
        ? lang === 'zh'
          ? '当前托管 LLM 不支持工具调用（function calling），无法执行精准修改。请确认 robots BFF 已暴露 OpenAI 兼容的 /chat/completions 且模型支持 function calling。'
          : 'The managed LLM does not support tool calling (function calling). Ensure the robots BFF exposes an OpenAI-compatible /chat/completions endpoint with a tool-capable model.'
        : lang === 'zh'
          ? '当前模型不支持工具调用（function calling），无法执行精准修改。请配置 VITE_ROBOTS_API_BASE_URL，或使用支持 function calling 的 BYOK 模型。'
          : 'The current model does not support tool calling (function calling). Configure VITE_ROBOTS_API_BASE_URL or a BYOK model that supports function calling.';
      return { kind: 'no-change', explanation: hint };
    }
    console.warn('AI edit agent unavailable, falling back to generation', agentError);
    const response = await generateRobotFromPrompt(message, currentRobot, motorLibrary, lang);
    if (!response || !response.robotData) {
      return { kind: 'no-change', explanation: response?.explanation ?? '' };
    }
    return { kind: 'change', robot: response.robotData, explanation: response.explanation ?? '' };
  }
}
