// ============================================================
// Agile Robot integration public barrel
// Re-exports the stable surface used by App: bootstrap helpers,
// AI conversation tools, mesh hot-reload and BFF/tool types.
// ============================================================

export { useAgileRobotBootstrap } from './hooks/useAgileRobotBootstrap';
export { useAgileRobotTools } from './hooks/useAgileRobotTools';
export { reloadMeshFromUrl, type MeshReloadImportPort } from './meshReload';
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
