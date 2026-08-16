import type { Language } from './types';

export const LANGUAGE_OPTIONS = [
  { value: 'en' as const, label: 'English', shortLabel: 'EN' },
  { value: 'zh' as const, label: '中文', shortLabel: '中' },
  { value: 'ja' as const, label: '日本語', shortLabel: '日' },
  { value: 'fr' as const, label: 'Français', shortLabel: 'FR' },
  { value: 'de' as const, label: 'Deutsch', shortLabel: 'DE' },
  { value: 'es' as const, label: 'Español', shortLabel: 'ES' },
] satisfies ReadonlyArray<{ value: Language; label: string; shortLabel: string }>;

export const SUPPORTED_LANGUAGES: readonly Language[] = LANGUAGE_OPTIONS.map((option) => option.value);

export function getNextLanguage(lang: Language): Language {
  const index = SUPPORTED_LANGUAGES.indexOf(lang);
  if (index < 0) {
    return 'en';
  }
  return SUPPORTED_LANGUAGES[(index + 1) % SUPPORTED_LANGUAGES.length];
}

export function getLanguageShortLabel(lang: Language): string {
  return LANGUAGE_OPTIONS.find((option) => option.value === lang)?.shortLabel ?? lang.toUpperCase();
}

export function resolveDocumentLocale(lang: Language): string {
  switch (lang) {
    case 'zh':
      return 'zh-CN';
    case 'ja':
      return 'ja';
    case 'fr':
      return 'fr';
    case 'de':
      return 'de';
    case 'es':
      return 'es';
    default:
      return 'en';
  }
}

export function resolveDateLocale(lang: Language): string {
  switch (lang) {
    case 'zh':
      return 'zh-CN';
    case 'ja':
      return 'ja-JP';
    case 'fr':
      return 'fr-FR';
    case 'de':
      return 'de-DE';
    case 'es':
      return 'es-ES';
    default:
      return 'en-US';
  }
}

export function isChineseLanguage(lang: Language): boolean {
  return lang === 'zh';
}
