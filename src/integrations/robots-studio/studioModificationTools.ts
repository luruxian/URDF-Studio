// ============================================================
// Studio modification tools: AI conversation tool defs + execute pipeline
//
// When bootstrapped on a urdf_stl order, returns AIConversationToolsConfig for
// the AI conversation UI: parse propose/regenerate tool_calls and run the
// PATCH → mesh regenerate → poll → import-grant → workspace import pipeline.
// ============================================================

import { hasBootstrap } from '@/integrations/agile-robot/bootstrap';
import type {
  AIConversationToolDef,
  AIConversationToolsConfig,
  ParsedToolCall,
  ToolConfirmBannerTexts,
  ToolResult,
} from '@/integrations/agile-robot/types';
import type { Language } from '@/shared/i18n';

import {
  createMeshImportGrant,
  formatMeshJobFailure,
  pollMeshJob,
  regenerateMesh,
} from './meshRegenerateApi';
import {
  getRequirementsDocument,
  getRobotsStudioErrorCode,
  patchRequirementsDocument,
  RobotsStudioApiError,
} from './requirementsDocumentApi';
import { getStudioMeshToolTexts } from './studioMeshToolTexts';
import type { StudioPackageType } from './types';

/** Port injected by the app layer so a regenerated URDF+STL package can be
 *  routed through the standard download-asset / file-import pipeline. */
export interface UrdfPackageImportPort {
  importUrdfPackage: (params: {
    importGrantId: string;
    fromOrigin: string;
  }) => Promise<void>;
}

export interface CreateStudioModificationToolsOptions {
  lang: Language;
  importUrdfPackage: UrdfPackageImportPort['importUrdfPackage'];
  signal?: AbortSignal;
  /** When omitted, resolved once via getRequirementsDocument(). */
  packageType?: StudioPackageType;
}

interface RawToolCall {
  function: { name: string; arguments: string };
}

const TOOL_DEFS: AIConversationToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'propose_requirements_revision',
      description:
        'Propose appending a revision to the requirements document. ' +
        'Studio shows a confirmation UI before PATCH is applied.',
      parameters: {
        type: 'object',
        properties: {
          change_summary: {
            type: 'string',
            description: 'Short human-readable summary of the change.',
          },
          append_markdown: {
            type: 'string',
            description: 'Markdown block appended to the requirements document.',
          },
        },
        required: ['change_summary', 'append_markdown'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'regenerate_robot_model',
      description:
        'Trigger URDF regeneration for urdf_stl orders after the ' +
        'requirements document revision is saved.',
      parameters: {
        type: 'object',
        properties: {
          revision: {
            type: 'integer',
            description: 'Requirements document revision to regenerate.',
          },
        },
        required: ['revision'],
        additionalProperties: false,
      },
    },
  },
];

const REVISION_CONFLICT_MESSAGES: Record<Language, string> = {
  en: 'Requirements document was updated elsewhere. Refresh and try again.',
  zh: '需求确认书已在别处更新，请刷新后重试。',
  ja: '要件確認書が別の場所で更新されました。更新してから再試行してください。',
  fr: 'Le document d’exigences a été mis à jour ailleurs. Actualisez et réessayez.',
  de: 'Das Anforderungsdokument wurde anderswo aktualisiert. Bitte aktualisieren und erneut versuchen.',
  es: 'El documento de requisitos se actualizó en otro lugar. Actualice e inténtelo de nuevo.',
};

function localeFromLang(lang: Language): string {
  switch (lang) {
    case 'zh':
      return 'zh-CN';
    case 'ja':
      return 'ja-JP';
    case 'de':
      return 'de-DE';
    case 'fr':
      return 'fr-FR';
    case 'es':
      return 'es-ES';
    default:
      return 'en';
  }
}

function truncateSummary(text: string, maxLen = 80): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function buildSummary(
  toolName: string,
  args: Record<string, unknown>,
  lang: Language,
): string {
  if (toolName === 'propose_requirements_revision') {
    const summary =
      typeof args.change_summary === 'string' ? args.change_summary.trim() : '';
    return summary
      ? truncateSummary(summary)
      : getStudioMeshToolTexts(lang).studioMeshToolProposeSummary;
  }
  if (toolName === 'regenerate_robot_model') {
    const revision = args.revision;
    const revisionLabel =
      typeof revision === 'number' && Number.isFinite(revision)
        ? ` (rev ${revision})`
        : '';
    return `${getStudioMeshToolTexts(lang).studioMeshToolRegenerateSummary}${revisionLabel}`;
  }
  return toolName;
}

export function createParseToolCalls(lang: Language) {
  return function parseToolCalls(rawToolCalls: RawToolCall[]): ParsedToolCall | null {
    if (!rawToolCalls.length) return null;

    // Server-side read-only tool: BFF executes before streaming; ignore if it leaks through.
    const actionable = rawToolCalls.find(
      (tc) =>
        tc.function.name &&
        tc.function.name !== 'get_requirements_document',
    );
    if (!actionable) return null;

    const tc = actionable;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      return null;
    }

    if (args === null || typeof args !== 'object') return null;
    if (!tc.function.name) return null;

    return {
      toolName: tc.function.name,
      args,
      summary: buildSummary(tc.function.name, args, lang),
    };
  };
}

async function runMeshRegenerateAndImport(
  revision: number,
  options: CreateStudioModificationToolsOptions,
  texts: ReturnType<typeof getStudioMeshToolTexts>,
): Promise<ToolResult> {
  const { lang, importUrdfPackage, signal } = options;

  await regenerateMesh({ revision, locale: localeFromLang(lang) });
  const job = await pollMeshJob(revision, signal);

  if (job.status === 'failed') {
    return {
      success: false,
      message: formatMeshJobFailure(job, texts.studioMeshToolGenerationFailed),
    };
  }

  if (!job.attachment_id) {
    return {
      success: false,
      message: texts.studioMeshToolGenerationFailed,
    };
  }

  const grant = await createMeshImportGrant({ attachment_id: job.attachment_id });

  if (!importUrdfPackage) {
    return {
      success: false,
      message: texts.studioMeshToolPreviewNotConnected,
    };
  }

  await importUrdfPackage({
    importGrantId: grant.import_grant_id,
    fromOrigin: grant.from_origin,
  });

  return { success: true, message: texts.studioMeshToolModelUpdated };
}

function mapExecuteError(
  error: unknown,
  lang: Language,
  texts: ReturnType<typeof getStudioMeshToolTexts>,
  signal?: AbortSignal,
): ToolResult {
  if (signal?.aborted) {
    return { success: false, message: texts.studioMeshToolCancelled };
  }
  if (error instanceof RobotsStudioApiError) {
    if (error.status === 401) {
      return { success: false, message: texts.studioMeshToolSessionExpired };
    }
    if (error.status === 409) {
      const code = getRobotsStudioErrorCode(error.body);
      if (code === 'revision_conflict') {
        return { success: false, message: REVISION_CONFLICT_MESSAGES[lang] };
      }
      if (code === 'job_in_progress') {
        return { success: false, message: texts.studioMeshToolJobInProgress };
      }
      return { success: false, message: error.message };
    }
    return { success: false, message: error.message };
  }
  return {
    success: false,
    message: error instanceof Error ? error.message : texts.studioMeshToolUnknownError,
  };
}

function createOnExecute(options: CreateStudioModificationToolsOptions) {
  const texts = getStudioMeshToolTexts(options.lang);

  return async function onExecute(toolCall: ParsedToolCall): Promise<ToolResult> {
    if (!hasBootstrap()) {
      return { success: false, message: texts.studioMeshToolSessionExpired };
    }

    try {
      if (toolCall.toolName === 'propose_requirements_revision') {
        const changeSummary =
          typeof toolCall.args.change_summary === 'string'
            ? toolCall.args.change_summary.trim()
            : '';
        const appendMarkdown =
          typeof toolCall.args.append_markdown === 'string'
            ? toolCall.args.append_markdown
            : '';
        if (!changeSummary || !appendMarkdown) {
          return { success: false, message: texts.studioMeshToolUnknownError };
        }

        const current = await getRequirementsDocument();
        const patched = await patchRequirementsDocument({
          base_revision: current.revision,
          change_summary: changeSummary,
          append_markdown: appendMarkdown,
        });

        return await runMeshRegenerateAndImport(patched.revision, options, texts);
      }

      if (toolCall.toolName === 'regenerate_robot_model') {
        const revision = toolCall.args.revision;
        if (typeof revision !== 'number' || !Number.isFinite(revision)) {
          return { success: false, message: texts.studioMeshToolUnknownError };
        }

        return await runMeshRegenerateAndImport(revision, options, texts);
      }

      return {
        success: false,
        message: texts.studioMeshToolUnknownTool.replace('{toolName}', toolCall.toolName),
      };
    } catch (error) {
      return mapExecuteError(error, options.lang, texts, options.signal);
    }
  };
}

function createBannerTexts(lang: Language): ToolConfirmBannerTexts {
  const texts = getStudioMeshToolTexts(lang);
  return {
    confirm: texts.studioMeshToolConfirm,
    cancel: texts.studioMeshToolCancel,
    retry: texts.studioMeshToolRetry,
    executing: texts.studioMeshToolExecuting,
  };
}

async function resolvePackageType(
  packageType?: StudioPackageType,
): Promise<StudioPackageType | null> {
  if (packageType !== undefined) {
    return packageType;
  }
  const doc = await getRequirementsDocument();
  return doc.package_type;
}

/**
 * Build Studio modification tools when bootstrapped on a urdf_stl order.
 * Returns null when there is no bootstrap or the order package is not urdf_stl.
 */
export async function createStudioModificationTools(
  options: CreateStudioModificationToolsOptions,
): Promise<AIConversationToolsConfig | null> {
  if (!hasBootstrap()) {
    return null;
  }

  const resolvedPackageType = await resolvePackageType(options.packageType);
  if (resolvedPackageType !== 'urdf_stl') {
    return null;
  }

  return {
    tools: TOOL_DEFS,
    parseToolCalls: createParseToolCalls(options.lang),
    onExecute: createOnExecute(options),
    bannerTexts: createBannerTexts(options.lang),
  };
}
