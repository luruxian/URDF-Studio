// ============================================================
// Agile Robot integration public barrel
// Re-exports the stable surface used by App: bootstrap helpers,
// mesh_auth deep-link helpers, AI conversation tools, mesh
// hot-reload and BFF/tool types.
// ============================================================

export { useAgileRobotBootstrap } from './hooks/useAgileRobotBootstrap';
export { useAgileRobotTools } from './hooks/useAgileRobotTools';
export { reloadMeshFromUrl, type MeshReloadImportPort } from './meshReload';
export {
  ROBOTS_MESH_AUTH_STORAGE_KEY,
  ROBOTS_MESH_URL_STORAGE_KEY,
  parseMeshDeepLink,
  persistMeshAuth,
  getStoredMeshAuth,
  fetchAuthenticatedGlb,
  resolveMeshAuthErrorCode,
  type RobotsMeshDeepLink,
  type MeshAuthErrorCode,
} from './meshAuth';
export {
  hasBootstrap,
  getBootstrap,
  clearBootstrap,
  initRobotsStudioBootstrap,
  decodeBootstrapFromHash,
} from './bootstrap';
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
