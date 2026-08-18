/**
 * i18n Module
 * Internationalization support for the application
 */

export type { Language, TranslationKeys, Translations } from './types';
export { translations } from './translations';
export { en, de, es, fr, ja, zh } from './locales';
export {
  getNextLanguage,
  getLanguageShortLabel,
  isChineseLanguage,
  LANGUAGE_OPTIONS,
  resolveDateLocale,
  resolveDocumentLocale,
  SUPPORTED_LANGUAGES,
} from './languageUtils';
export {
  getRuntimeLanguageTranslations,
  normalizeLanguage,
  resolveRuntimeLanguage,
} from './runtimeLanguage';
