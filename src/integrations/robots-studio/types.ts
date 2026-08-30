// ============================================================
// Robots Studio BFF: requirements document + mesh regenerate
// Contract: docs/integrations/studio-requirements-revision.md
// Section-patch v2: robots/docs/superpowers/specs/2026-08-30-studio-requirements-section-patch-design.md
// ============================================================

export type StudioPackageType = 'urdf_stl' | 'glb' | string;

export type RequirementsSectionId = '背景' | '机型' | '性能参数' | '其他约束';

export const REQUIREMENTS_SECTION_IDS: readonly RequirementsSectionId[] = [
  '背景',
  '机型',
  '性能参数',
  '其他约束',
];

export interface RequirementsDocumentResponse {
  order_id: string;
  revision: number;
  requirements_document: string;
  updated_at: string;
  package_type: StudioPackageType;
  sections?: Partial<Record<RequirementsSectionId, string>> | null;
  changelog?: string | null;
  parse_error?: string | null;
}

export interface RequirementsDocumentPatchRequest {
  base_revision: number;
  change_summary: string;
  section_updates: Partial<Record<RequirementsSectionId, string>>;
  history_bullets: string[];
  client_mutation_id?: string;
}

export interface RequirementsDocumentPatchResponse {
  revision: number;
  requirements_document: string;
  change_summary: string;
  updated_at: string;
}

export type MeshJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface MeshRegenerateRequest {
  revision: number;
  locale?: string;
}

export interface MeshRegenerateResponse {
  job_id: string;
  revision: number;
  status: MeshJobStatus;
  external_job_id: string;
}

export interface MeshJobResponse {
  job_id: string;
  revision: number;
  status: MeshJobStatus;
  attachment_id: string | null;
  package_type: StudioPackageType;
  error_code: string | null;
  error_message: string | null;
}

export interface MeshImportGrantRequest {
  attachment_id?: string;
}

export interface MeshImportGrantResponse {
  package_type: StudioPackageType;
  import_grant_id: string;
  from_origin: string;
  expires_at: string;
  attachment_id: string;
}

export type RequirementsRevisionConflictErrorCode = 'revision_conflict';

export type MeshRegenerateConflictErrorCode =
  | 'package_type_not_supported'
  | 'job_in_progress'
  | 'revision_mismatch';
