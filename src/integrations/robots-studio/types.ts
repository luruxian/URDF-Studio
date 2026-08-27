// ============================================================
// Robots Studio BFF: requirements document + mesh regenerate
// Contract: docs/integrations/studio-requirements-revision.md
// ============================================================

export type StudioPackageType = 'urdf_stl' | 'glb' | string;

export interface RequirementsDocumentResponse {
  order_id: string;
  revision: number;
  requirements_document: string;
  updated_at: string;
  package_type: StudioPackageType;
}

export interface RequirementsDocumentPatchRequest {
  base_revision: number;
  change_summary: string;
  append_markdown: string;
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
