/**
 * AI Assistant Feature
 *
 * Provides AI-powered robot inspection, conversation, and report follow-up capabilities.
 */

// Components
export { AIModal } from './components/AIModal'
export { AIInspectionModal } from './components/AIInspectionModal'
export { AIConversationModal } from './components/AIConversationModal'

// Services
export { generateRobotFromPrompt, runRobotInspection } from './services/aiService'
export { sendConversationTurn } from './services/conversationService'
export {
  createConversationSession,
  deleteConversationSession,
  syncConversationSnapshot,
  isRobotsStudioApiError,
  RobotsStudioApiError,
} from './services/conversationSessionApi'
export {
  isAiBackendEnabled,
  setAiBackendAuthTokenProvider,
} from './services/aiBackendTransport'

// Utilities
export {
  INSPECTION_PROFILE_DEFINITIONS,
  getInspectionProfileDefinition,
  getInspectionProfileItem,
  getInspectionProfileName,
} from './config/inspectionProfiles'
export { resolveAIWorkspaceRobotTarget } from './utils/aiWorkspaceTarget'
export {
  cloneAISnapshot,
  resolveCurrentAIRobotSnapshot,
} from './utils/aiConversationRobotSnapshot'
export {
  buildConversationContext,
} from './utils/buildConversationContext'
export type { ConversationContextOptions } from './utils/buildConversationContext'
export type {
  AIInspectableEntityRef,
  AIWorkspaceRobotTarget,
} from './utils/aiWorkspaceTarget'

// Types
export type {
  ConversationSnapshotPut,
  ConversationSnapshotPayload,
} from './services/conversationSessionApi'
export type {
  AIResponse,
  InspectionItem,
  IssueType,
  InspectionIssue,
  AIConversationMode,
  AIConversationMessage,
  AIConversationFocusedIssue,
  AIConversationSelection,
  AIConversationLaunchContext,
  AIConversationTurnResult,
} from './types'
