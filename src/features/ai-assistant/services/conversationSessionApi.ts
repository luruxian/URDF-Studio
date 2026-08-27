import {
  handleRobotsStudioResponse,
  isRobotsStudioApiError,
  requireRobotsStudioContext,
  RobotsStudioApiError,
  robotsStudioAuthHeaders,
  robotsStudioProjectUrl,
} from '@/integrations/robots-studio/requirementsDocumentApi';

import type { ConversationMode } from '../config/prompts';

export { isRobotsStudioApiError, RobotsStudioApiError };

// ============================================================
// Snapshot DTOs (mirror robots BFF ConversationSnapshotPut)
// ============================================================

export interface ConversationSnapshotAxis {
  x: number;
  y: number;
  z: number;
}

export interface ConversationSnapshotJointHardware {
  motorType: string;
  armature?: number | null;
  motorDirection?: number | null;
}

export interface ConversationSnapshotJointLimit {
  lower?: number | null;
  upper?: number | null;
  effort?: number | null;
  velocity?: number | null;
}

export interface ConversationSnapshotLink {
  id: string;
  name: string;
  visualType: string;
  collisionType: string;
  mass?: number | null;
}

export interface ConversationSnapshotJoint {
  id: string;
  name: string;
  type: string;
  parent: string;
  child: string;
  axis: ConversationSnapshotAxis;
  limit?: ConversationSnapshotJointLimit | null;
  hardware?: ConversationSnapshotJointHardware | null;
}

export interface ConversationSnapshotRobot {
  name: string;
  rootLinkId: string;
  linkCount: number;
  jointCount: number;
  links: ConversationSnapshotLink[];
  joints: ConversationSnapshotJoint[];
  inspectionContext?: Record<string, unknown> | null;
}

export interface ConversationSnapshotInspectionIssue {
  type: string;
  title: string;
  description: string;
  profileId?: string | null;
  itemId?: string | null;
  evidenceLevel?: 'L1' | 'L2' | 'L3' | 'L4' | null;
  evidenceSource?: string | null;
  score?: number | null;
  relatedIds?: string[] | null;
}

export interface ConversationSnapshotInspectionReport {
  summary: string;
  overallScore: number;
  maxScore: number;
  profileScores?: Record<string, number> | null;
  issues: ConversationSnapshotInspectionIssue[];
}

export interface ConversationSnapshotSelectedEntity {
  type: 'link' | 'joint';
  componentId: string;
  entityId: string;
  name: string;
}

export interface ConversationSnapshotFocusedIssue {
  type: string;
  title: string;
  description: string;
  profileId?: string | null;
  itemId?: string | null;
  evidenceLevel?: 'L1' | 'L2' | 'L3' | 'L4' | null;
  evidenceSource?: string | null;
  score?: number | null;
  relatedIds?: string[] | null;
}

export interface ConversationSnapshotPayload {
  robot: ConversationSnapshotRobot;
  inspectionReport?: ConversationSnapshotInspectionReport | null;
  selectedEntity?: ConversationSnapshotSelectedEntity | null;
  focusedIssue?: ConversationSnapshotFocusedIssue | null;
}

export interface ConversationSnapshotPut {
  mode: ConversationMode;
  lang: string;
  snapshot_revision: number;
  snapshot: ConversationSnapshotPayload;
}

interface ConversationSessionCreateResponseWire {
  session_id: string;
  expires_at: string;
}

interface ConversationSnapshotPutResponseWire {
  snapshot_revision: number;
}

const conversationSessionsPath = '/ai/conversation-sessions';

function conversationSessionUrl(context: ReturnType<typeof requireRobotsStudioContext>, sessionId?: string): string {
  const base = robotsStudioProjectUrl(context, conversationSessionsPath);
  return sessionId ? `${base}/${sessionId}` : base;
}

async function handleRobotsStudioEmptyResponse(response: Response): Promise<void> {
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // non-JSON error body
    }
    throw new RobotsStudioApiError(
      `Robots Studio API error: ${response.status}`,
      response.status,
      body,
    );
  }
}

// ============================================================
// Conversation session API
// ============================================================

export async function createConversationSession(): Promise<{ sessionId: string; expiresAt: string }> {
  const context = requireRobotsStudioContext();
  const response = await fetch(conversationSessionUrl(context), {
    method: 'POST',
    headers: robotsStudioAuthHeaders(context),
  });
  const body = await handleRobotsStudioResponse<ConversationSessionCreateResponseWire>(response);
  return {
    sessionId: body.session_id,
    expiresAt: body.expires_at,
  };
}

export async function syncConversationSnapshot(
  sessionId: string,
  payload: ConversationSnapshotPut,
): Promise<void> {
  const context = requireRobotsStudioContext();
  const response = await fetch(conversationSessionUrl(context, sessionId), {
    method: 'PUT',
    headers: robotsStudioAuthHeaders(context),
    body: JSON.stringify(payload),
  });
  await handleRobotsStudioResponse<ConversationSnapshotPutResponseWire>(response);
}

export async function deleteConversationSession(sessionId: string): Promise<void> {
  const context = requireRobotsStudioContext();
  const response = await fetch(conversationSessionUrl(context, sessionId), {
    method: 'DELETE',
    headers: robotsStudioAuthHeaders(context),
  });
  await handleRobotsStudioEmptyResponse(response);
}
