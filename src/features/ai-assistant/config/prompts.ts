import { AI_PROMPT_TEMPLATES } from './aiPromptTemplates.generated.ts'
import type { Language } from '@/shared/i18n'

function resolvePromptTemplateLanguage(lang: Language): 'en' | 'zh' {
  return lang === 'zh' ? 'zh' : 'en'
}

export const GENERATION_PROMPT_PLACEHOLDERS = {
  robot: '__ROBOT_CONTEXT__',
  motorLibrary: '__MOTOR_LIBRARY_CONTEXT__',
} as const

export const INSPECTION_PROMPT_PLACEHOLDERS = {
  criteriaDescription: '__CRITERIA_DESCRIPTION__',
  inspectionNotes: '__INSPECTION_NOTES__',
  languageInstruction: '__LANGUAGE_INSTRUCTION__',
} as const

export const CONVERSATION_PROMPT_PLACEHOLDERS = {
  mode: '__CONVERSATION_MODE__',
  context: '__CONVERSATION_CONTEXT__',
  history: '__CONVERSATION_HISTORY__',
  languageInstruction: '__LANGUAGE_INSTRUCTION__',
} as const

export const GENERATION_SYSTEM_PROMPT_TEMPLATE = AI_PROMPT_TEMPLATES.generation

export const INSPECTION_SYSTEM_PROMPT_TEMPLATES = {
  zh: AI_PROMPT_TEMPLATES.inspection.zh,
  en: AI_PROMPT_TEMPLATES.inspection.en,
} as const

export const CONVERSATION_SYSTEM_PROMPT_TEMPLATES = {
  zh: AI_PROMPT_TEMPLATES.conversation.zh,
  en: AI_PROMPT_TEMPLATES.conversation.en,
} as const

export interface GenerationContext {
  robot: unknown
  motorLibrary: unknown
}

export interface InspectionContext {
  criteriaDescription: string
  inspectionNotes?: string
}

export type ConversationMode = 'general' | 'inspection-followup'

export interface ConversationPromptContext {
  mode: ConversationMode
  context: string
  history: string
}

export function getGenerationSystemPrompt(context: GenerationContext): string {
  return GENERATION_SYSTEM_PROMPT_TEMPLATE
    .replace(GENERATION_PROMPT_PLACEHOLDERS.robot, JSON.stringify(context.robot))
    .replace(GENERATION_PROMPT_PLACEHOLDERS.motorLibrary, JSON.stringify(context.motorLibrary))
}

export function getInspectionSystemPrompt(
  lang: Language,
  context: InspectionContext
): string {
  const templateLanguage = resolvePromptTemplateLanguage(lang)
  const languageInstruction =
    lang === 'zh'
      ? '请使用中文生成所有报告内容，包括总结、问题标题和描述。'
      : lang === 'ja'
        ? 'レポート内容（要約、問題タイトル、説明）はすべて日本語で生成してください。'
        : lang === 'fr'
          ? 'Générez tout le contenu du rapport en français, y compris le résumé, les titres et les descriptions des problèmes.'
          : lang === 'de'
            ? 'Erstellen Sie den gesamten Berichtsinhalt auf Deutsch, einschließlich Zusammenfassung, Problemtitel und Beschreibungen.'
            : lang === 'es'
              ? 'Genera todo el contenido del informe en español, incluidos el resumen, los títulos y las descripciones de los problemas.'
              : 'Please generate all report content in English, including summary, issue titles and descriptions.'
  const template = INSPECTION_SYSTEM_PROMPT_TEMPLATES[templateLanguage]

  return template
    .replace(INSPECTION_PROMPT_PLACEHOLDERS.criteriaDescription, context.criteriaDescription)
    .replace(INSPECTION_PROMPT_PLACEHOLDERS.inspectionNotes, context.inspectionNotes || '')
    .replace(INSPECTION_PROMPT_PLACEHOLDERS.languageInstruction, languageInstruction)
}

export function getConversationSystemPrompt(
  lang: Language,
  context: ConversationPromptContext
): string {
  const templateLanguage = resolvePromptTemplateLanguage(lang)
  const languageInstruction =
    lang === 'zh'
      ? '请使用中文回复，简洁准确。'
      : lang === 'ja'
        ? '日本語で簡潔かつ正確に返答してください。'
        : lang === 'fr'
          ? 'Répondez en français de manière concise et précise.'
          : lang === 'de'
            ? 'Antworten Sie präzise und knapp auf Deutsch.'
            : lang === 'es'
              ? 'Responde en español de forma concisa y precisa.'
              : 'Please respond in English with concise and accurate technical language.'
  const template = CONVERSATION_SYSTEM_PROMPT_TEMPLATES[templateLanguage]

  return template
    .replace(CONVERSATION_PROMPT_PLACEHOLDERS.mode, context.mode)
    .replace(CONVERSATION_PROMPT_PLACEHOLDERS.context, context.context)
    .replace(CONVERSATION_PROMPT_PLACEHOLDERS.history, context.history)
    .replace(CONVERSATION_PROMPT_PLACEHOLDERS.languageInstruction, languageInstruction)
}
