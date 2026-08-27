import { translations, type Language, type TranslationKeys } from '@/shared/i18n';

export type StudioMeshToolTexts = Pick<
  TranslationKeys,
  | 'studioMeshToolConfirm'
  | 'studioMeshToolCancel'
  | 'studioMeshToolRetry'
  | 'studioMeshToolExecuting'
  | 'studioMeshToolRegenerateSummary'
  | 'studioMeshToolSessionExpired'
  | 'studioMeshToolModelUpdated'
  | 'studioMeshToolPreviewNotConnected'
  | 'studioMeshToolGenerationFailed'
  | 'studioMeshToolCancelled'
  | 'studioMeshToolJobInProgress'
  | 'studioMeshToolUnknownTool'
  | 'studioMeshToolUnknownError'
>;

export type StudioMeshBannerTexts = Pick<
  StudioMeshToolTexts,
  | 'studioMeshToolConfirm'
  | 'studioMeshToolCancel'
  | 'studioMeshToolRetry'
  | 'studioMeshToolExecuting'
>;

export function getStudioMeshToolTexts(lang: Language): StudioMeshToolTexts {
  const t = translations[lang];
  return {
    studioMeshToolConfirm: t.studioMeshToolConfirm,
    studioMeshToolCancel: t.studioMeshToolCancel,
    studioMeshToolRetry: t.studioMeshToolRetry,
    studioMeshToolExecuting: t.studioMeshToolExecuting,
    studioMeshToolRegenerateSummary: t.studioMeshToolRegenerateSummary,
    studioMeshToolSessionExpired: t.studioMeshToolSessionExpired,
    studioMeshToolModelUpdated: t.studioMeshToolModelUpdated,
    studioMeshToolPreviewNotConnected: t.studioMeshToolPreviewNotConnected,
    studioMeshToolGenerationFailed: t.studioMeshToolGenerationFailed,
    studioMeshToolCancelled: t.studioMeshToolCancelled,
    studioMeshToolJobInProgress: t.studioMeshToolJobInProgress,
    studioMeshToolUnknownTool: t.studioMeshToolUnknownTool,
    studioMeshToolUnknownError: t.studioMeshToolUnknownError,
  };
}

export function getStudioMeshBannerTexts(lang: Language): StudioMeshBannerTexts {
  const texts = getStudioMeshToolTexts(lang);
  return {
    studioMeshToolConfirm: texts.studioMeshToolConfirm,
    studioMeshToolCancel: texts.studioMeshToolCancel,
    studioMeshToolRetry: texts.studioMeshToolRetry,
    studioMeshToolExecuting: texts.studioMeshToolExecuting,
  };
}
