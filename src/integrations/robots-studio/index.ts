// ============================================================
// Robots Studio BFF integration (requirements revision + mesh)
// ============================================================

export {
  RobotsStudioApiError,
  getRequirementsDocument,
  getRobotsStudioErrorCode,
  isRobotsStudioApiError,
  patchRequirementsDocument,
} from './requirementsDocumentApi';

export {
  DEFAULT_MESH_JOB_POLL_INTERVAL_MS,
  DEFAULT_MESH_JOB_POLL_TIMEOUT_MS,
  MESH_JOB_POLL_INTERVAL_MS,
  MESH_JOB_POLL_TIMEOUT_MS,
  resolveMeshJobPollConfig,
  createMeshImportGrant,
  formatMeshJobFailure,
  getMeshJob,
  pollMeshJob,
  regenerateMesh,
} from './meshRegenerateApi';

export {
  createParseToolCalls,
  createStudioModificationTools,
} from './studioModificationTools';

export { useStudioModificationTools } from './hooks/useStudioModificationTools';

export type {
  CreateStudioModificationToolsOptions,
  UrdfPackageImportPort,
} from './studioModificationTools';

export type {
  MeshImportGrantRequest,
  MeshImportGrantResponse,
  MeshJobResponse,
  MeshJobStatus,
  MeshRegenerateConflictErrorCode,
  MeshRegenerateRequest,
  MeshRegenerateResponse,
  RequirementsDocumentPatchRequest,
  RequirementsDocumentPatchResponse,
  RequirementsDocumentResponse,
  RequirementsRevisionConflictErrorCode,
  RequirementsSectionId,
  StudioPackageType,
} from './types';
