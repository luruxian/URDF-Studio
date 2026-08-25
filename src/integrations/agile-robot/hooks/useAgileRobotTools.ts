// ============================================================
// useAgileRobotTools — DISABLED
//
// Agile Robot 外观改图 / 混元 3D 重生工具已从 AI 对话中停用。
// AI 对话现统一走 URDF edit agent（resolveModificationProposal）。
// 原实现保留在文件末尾块注释中，便于日后恢复。
// ============================================================

import type { Language } from '@/shared/i18n';
import type { MeshReloadImportPort } from '../meshReload';
import type { AIConversationToolsConfig } from '../types';

export interface UseAgileRobotToolsOptions {
  /** UI language for tool summaries and execution feedback. */
  lang: Language;
  /** Port that routes a regenerated GLB through the app file-import pipeline. */
  reloadMesh?: MeshReloadImportPort | null;
}

export function useAgileRobotTools(
  _options: UseAgileRobotToolsOptions,
): AIConversationToolsConfig | null {
  return null;
}

/*
// ---- Previous implementation (edit_robot_appearance / regenerate_robot_3d) ----

import { useCallback, useRef } from 'react';
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
import { reloadMeshFromUrl } from '../meshReload';
import { getAgileRobotToolTexts, type AgileRobotToolTexts } from '../agileRobotToolTexts';
import type {
  AIConversationToolDef,
  ParsedToolCall,
  ToolResult,
} from '../types';

// ... (full prior implementation)
*/
