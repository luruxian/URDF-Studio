/**
 * Translations Registry
 */

import type { Translations } from './types';
import { de } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { zhHant } from './locales/zh-Hant';

export const translations: Translations = {
  en,
  'zh-Hant': zhHant,
  ja,
  fr,
  de,
  es,
  ko,
};
