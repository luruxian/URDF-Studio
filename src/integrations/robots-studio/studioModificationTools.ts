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
import type {
  RequirementsSectionId,
  StudioPackageType,
} from './types';
import {
  REQUIREMENTS_SECTION_IDS,
} from './types';

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

interface PhaseACacheEntry {
  revision: number;
  clientMutationId: string;
}

/** Stable cache key for propose retries (excludes post-PATCH revision). */
function buildProposePayloadCacheKey(
  parsed: {
    changeSummary: string;
    sectionUpdates: Partial<Record<RequirementsSectionId, string>>;
    historyBullets: string[];
  },
): string {
  return JSON.stringify({
    change_summary: parsed.changeSummary,
    section_updates: parsed.sectionUpdates,
    history_bullets: parsed.historyBullets,
  });
}

/** Namespace UUID for deterministic client_mutation_id (RFC 4122 v5). */
const CLIENT_MUTATION_ID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const TOOL_DEFS: AIConversationToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'propose_requirements_revision',
      description:
        'Propose section-based updates to the requirements document. ' +
        'Studio shows a confirmation UI before PATCH is applied.',
      parameters: {
        type: 'object',
        properties: {
          change_summary: {
            type: 'string',
            description: 'One-line human-readable summary of the change (≤200 chars).',
          },
          section_updates: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'Map of section name to new body (without ## heading). ' +
              'Keys: 背景, 机型, 性能参数, 其他约束. Include only sections that change.',
          },
          history_bullets: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 8,
            description:
              'Delta-only changelog bullets for this revision (≤200 chars each).',
          },
        },
        required: ['change_summary', 'section_updates', 'history_bullets'],
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

const DUPLICATE_CONTENT_MESSAGES: Record<Language, string> = {
  en: 'This revision duplicates existing requirements content. Rephrase the change and try again.',
  zh: '本次修订与现有需求内容重复，请改写变更后重试。',
  ja: 'この改訂は既存の要件内容と重複しています。変更内容を書き直して再試行してください。',
  fr: 'Cette révision duplique le contenu existant. Reformulez la modification et réessayez.',
  de: 'Diese Revision wiederholt vorhandene Anforderungsinhalte. Formulieren Sie die Änderung um und versuchen Sie es erneut.',
  es: 'Esta revisión duplica contenido existente. Reformule el cambio e inténtelo de nuevo.',
};

const INVALID_SECTION_MESSAGES: Record<Language, string> = {
  en: 'Invalid requirements section in the proposed revision.',
  zh: '提议的修订包含无效的需求章节。',
  ja: '提案された改訂に無効な要件セクションが含まれています。',
  fr: 'Section d’exigences invalide dans la révision proposée.',
  de: 'Ungültiger Anforderungsabschnitt in der vorgeschlagenen Revision.',
  es: 'Sección de requisitos no válida en la revisión propuesta.',
};

const INVALID_DOCUMENT_SCHEMA_MESSAGES: Record<Language, string> = {
  en: 'Requirements document format is invalid. Contact support.',
  zh: '需求确认书格式无效，请联系运营处理。',
  ja: '要件確認書の形式が無効です。サポートにお問い合わせください。',
  fr: 'Format du document d’exigences invalide. Contactez le support.',
  de: 'Format des Anforderungsdokuments ist ungültig. Bitte Support kontaktieren.',
  es: 'Formato del documento de requisitos no válido. Contacte con soporte.',
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

function parseUuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Deterministic UUID v5 so retries reuse the same client_mutation_id. */
export async function buildClientMutationId(
  baseRevision: number,
  payload: {
    change_summary: string;
    section_updates: Partial<Record<RequirementsSectionId, string>>;
    history_bullets: string[];
  },
): Promise<string> {
  const data = JSON.stringify({
    baseRevision,
    change_summary: payload.change_summary,
    section_updates: payload.section_updates,
    history_bullets: payload.history_bullets,
  });
  const nsBytes = parseUuidToBytes(CLIENT_MUTATION_ID_NAMESPACE);
  const nameBytes = new TextEncoder().encode(data);
  const toHash = new Uint8Array(nsBytes.length + nameBytes.length);
  toHash.set(nsBytes);
  toHash.set(nameBytes, nsBytes.length);

  const hashBuffer = await crypto.subtle.digest('SHA-1', toHash);
  const hash = new Uint8Array(hashBuffer);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function stripSectionHeadingPrefix(text: string): string {
  return text.replace(/^##\s*/, '').trim();
}

/** Models often write `\\n` in tool-call JSON; after JSON.parse that is the two characters `\` + `n`. */
function unescapeLiteralEscapes(text: string): string {
  if (!text.includes('\\')) return text;
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
}

export function normalizeSectionUpdates(
  raw: unknown,
): Partial<Record<RequirementsSectionId, string>> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const normalized: Partial<Record<RequirementsSectionId, string>> = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (typeof rawValue !== 'string') continue;
    const sectionKey = stripSectionHeadingPrefix(rawKey);
    if (!REQUIREMENTS_SECTION_IDS.includes(sectionKey as RequirementsSectionId)) {
      continue;
    }
    normalized[sectionKey as RequirementsSectionId] = unescapeLiteralEscapes(
      stripSectionHeadingPrefix(rawValue),
    );
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function parseHistoryBullets(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const bullets = raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => unescapeLiteralEscapes(item.trim()));
  return bullets.length > 0 ? bullets : null;
}

function parseProposeToolArgs(
  args: Record<string, unknown>,
): {
  changeSummary: string;
  sectionUpdates: Partial<Record<RequirementsSectionId, string>>;
  historyBullets: string[];
} | null {
  const changeSummary =
    typeof args.change_summary === 'string'
      ? unescapeLiteralEscapes(args.change_summary.trim())
      : '';
  const sectionUpdates = normalizeSectionUpdates(args.section_updates);
  const historyBullets = parseHistoryBullets(args.history_bullets);

  if (!changeSummary || !sectionUpdates || !historyBullets) {
    return null;
  }

  return { changeSummary, sectionUpdates, historyBullets };
}

function buildSummary(
  toolName: string,
  args: Record<string, unknown>,
  lang: Language,
): string {
  if (toolName === 'propose_requirements_revision') {
    const parsed = parseProposeToolArgs(args);
    const sectionNames = parsed ? Object.keys(parsed.sectionUpdates) : [];
    const base = getStudioMeshToolTexts(lang).studioMeshToolProposeSummary;
    if (sectionNames.length > 0) {
      return `${base}（${sectionNames.join('、')}）`;
    }
    const summary =
      typeof args.change_summary === 'string' ? args.change_summary.trim() : '';
    return summary ? truncateSummary(summary) : base;
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

    if (tc.function.name === 'propose_requirements_revision') {
      const parsed = parseProposeToolArgs(args);
      if (!parsed) return null;
      args = {
        change_summary: parsed.changeSummary,
        section_updates: parsed.sectionUpdates,
        history_bullets: parsed.historyBullets,
      };
    }

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

async function executePhaseA(
  baseRevision: number,
  changeSummary: string,
  sectionUpdates: Partial<Record<RequirementsSectionId, string>>,
  historyBullets: string[],
  payloadCacheKey: string,
  phaseCache: Map<string, PhaseACacheEntry>,
): Promise<number> {
  const cached = phaseCache.get(payloadCacheKey);
  if (cached) {
    return cached.revision;
  }

  const clientMutationId = await buildClientMutationId(baseRevision, {
    change_summary: changeSummary,
    section_updates: sectionUpdates,
    history_bullets: historyBullets,
  });

  const patched = await patchRequirementsDocument({
    base_revision: baseRevision,
    change_summary: changeSummary,
    section_updates: sectionUpdates,
    history_bullets: historyBullets,
    client_mutation_id: clientMutationId,
  });

  phaseCache.set(payloadCacheKey, {
    revision: patched.revision,
    clientMutationId,
  });
  return patched.revision;
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
      if (code === 'duplicate_content') {
        return { success: false, message: DUPLICATE_CONTENT_MESSAGES[lang] };
      }
      if (code === 'invalid_section') {
        return { success: false, message: INVALID_SECTION_MESSAGES[lang] };
      }
      if (code === 'invalid_document_schema') {
        return { success: false, message: INVALID_DOCUMENT_SCHEMA_MESSAGES[lang] };
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
  const phaseCache = new Map<string, PhaseACacheEntry>();

  return async function onExecute(toolCall: ParsedToolCall): Promise<ToolResult> {
    if (!hasBootstrap()) {
      return { success: false, message: texts.studioMeshToolSessionExpired };
    }

    try {
      if (toolCall.toolName === 'propose_requirements_revision') {
        const parsed = parseProposeToolArgs(toolCall.args);
        if (!parsed) {
          return { success: false, message: texts.studioMeshToolUnknownError };
        }

        const payloadCacheKey = buildProposePayloadCacheKey(parsed);
        const cachedPhaseA = phaseCache.get(payloadCacheKey);

        const revision = cachedPhaseA
          ? cachedPhaseA.revision
          : await executePhaseA(
              (await getRequirementsDocument()).revision,
              parsed.changeSummary,
              parsed.sectionUpdates,
              parsed.historyBullets,
              payloadCacheKey,
              phaseCache,
            );

        return await runMeshRegenerateAndImport(revision, options, texts);
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
