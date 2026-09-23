import { AI_PROMPT_TEMPLATES } from './aiPromptTemplates.generated.ts'
import { isChineseLanguage, type Language } from '@/shared/i18n'

type PromptTemplateLanguage = 'en' | 'zh-Hant'

function resolvePromptTemplateLanguage(lang: Language): PromptTemplateLanguage {
  return isChineseLanguage(lang) ? 'zh-Hant' : 'en'
}

function inspectionLanguageInstruction(lang: Language): string {
  if (isChineseLanguage(lang)) {
    return '請使用繁體中文生成所有報告內容，包括總結、問題標題和描述。'
  }
  if (lang === 'ja') {
    return 'レポート内容（要約、問題タイトル、説明）はすべて日本語で生成してください。'
  }
  if (lang === 'fr') {
    return 'Générez tout le contenu du rapport en français, y compris le résumé, les titres et les descriptions des problèmes.'
  }
  if (lang === 'de') {
    return 'Erstellen Sie den gesamten Berichtsinhalt auf Deutsch, einschließlich Zusammenfassung, Problemtitel und Beschreibungen.'
  }
  if (lang === 'es') {
    return 'Genera todo el contenido del informe en español, incluidos el resumen, los títulos y las descripciones de los problemas.'
  }
  if (lang === 'ko') {
    return '보고서 요약, 이슈 제목, 설명을 포함한 모든 보고서 내용을 한국어로 작성하세요.'
  }
  return 'Please generate all report content in English, including summary, issue titles and descriptions.'
}

function conversationLanguageInstruction(lang: Language): string {
  if (isChineseLanguage(lang)) {
    return '請使用繁體中文回覆，簡潔準確。'
  }
  if (lang === 'ja') {
    return '日本語で簡潔かつ正確に返答してください。'
  }
  if (lang === 'fr') {
    return 'Répondez en français de manière concise et précise.'
  }
  if (lang === 'de') {
    return 'Antworten Sie präzise und knapp auf Deutsch.'
  }
  if (lang === 'es') {
    return 'Responde en español de forma concisa y precisa.'
  }
  if (lang === 'ko') {
    return '한국어로 간결하고 정확하게 답변하세요.'
  }
  return 'Please respond in English with concise and accurate technical language.'
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
  'zh-Hant': AI_PROMPT_TEMPLATES.inspection['zh-Hant'],
  en: AI_PROMPT_TEMPLATES.inspection.en,
} as const

export const CONVERSATION_SYSTEM_PROMPT_TEMPLATES = {
  'zh-Hant': AI_PROMPT_TEMPLATES.conversation['zh-Hant'],
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
  const template = INSPECTION_SYSTEM_PROMPT_TEMPLATES[templateLanguage]

  return template
    .replace(INSPECTION_PROMPT_PLACEHOLDERS.criteriaDescription, context.criteriaDescription)
    .replace(INSPECTION_PROMPT_PLACEHOLDERS.inspectionNotes, context.inspectionNotes || '')
    .replace(INSPECTION_PROMPT_PLACEHOLDERS.languageInstruction, inspectionLanguageInstruction(lang))
}

export function getConversationSystemPrompt(
  lang: Language,
  context: ConversationPromptContext
): string {
  const templateLanguage = resolvePromptTemplateLanguage(lang)
  const template = CONVERSATION_SYSTEM_PROMPT_TEMPLATES[templateLanguage]

  return template
    .replace(CONVERSATION_PROMPT_PLACEHOLDERS.mode, context.mode)
    .replace(CONVERSATION_PROMPT_PLACEHOLDERS.context, context.context)
    .replace(CONVERSATION_PROMPT_PLACEHOLDERS.history, context.history)
    .replace(CONVERSATION_PROMPT_PLACEHOLDERS.languageInstruction, conversationLanguageInstruction(lang))
}
