import { translations, type Language, type TranslationKeys } from '@/shared/i18n';

export type AgileRobotToolTexts = Pick<
  TranslationKeys,
  | 'agileRobotToolConfirm'
  | 'agileRobotToolCancel'
  | 'agileRobotToolRetry'
  | 'agileRobotToolExecuting'
  | 'agileRobotToolRegenerateSummary'
  | 'agileRobotToolSessionExpired'
  | 'agileRobotToolModelUpdated'
  | 'agileRobotToolPreviewNotConnected'
  | 'agileRobotToolGenerationFailed'
  | 'agileRobotToolCancelled'
  | 'agileRobotToolJobInProgress'
  | 'agileRobotToolUnknownTool'
  | 'agileRobotToolUnknownError'
  | 'meshPreviewNotFound'
  | 'meshPreviewUnavailable'
>;

export function getAgileRobotToolTexts(lang: Language): AgileRobotToolTexts {
  const t = translations[lang];
  return {
    agileRobotToolConfirm: t.agileRobotToolConfirm,
    agileRobotToolCancel: t.agileRobotToolCancel,
    agileRobotToolRetry: t.agileRobotToolRetry,
    agileRobotToolExecuting: t.agileRobotToolExecuting,
    agileRobotToolRegenerateSummary: t.agileRobotToolRegenerateSummary,
    agileRobotToolSessionExpired: t.agileRobotToolSessionExpired,
    agileRobotToolModelUpdated: t.agileRobotToolModelUpdated,
    agileRobotToolPreviewNotConnected: t.agileRobotToolPreviewNotConnected,
    agileRobotToolGenerationFailed: t.agileRobotToolGenerationFailed,
    agileRobotToolCancelled: t.agileRobotToolCancelled,
    agileRobotToolJobInProgress: t.agileRobotToolJobInProgress,
    agileRobotToolUnknownTool: t.agileRobotToolUnknownTool,
    agileRobotToolUnknownError: t.agileRobotToolUnknownError,
    meshPreviewNotFound: t.meshPreviewNotFound,
    meshPreviewUnavailable: t.meshPreviewUnavailable,
  };
}
