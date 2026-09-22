import type { Language } from '@/shared/i18n';

import type { RequirementsSectionId } from './types';
import { REQUIREMENTS_SECTION_IDS } from './types';

const REQUIREMENTS_SECTION_LABELS: Record<
  Language,
  Record<RequirementsSectionId, string>
> = {
  en: {
    背景: 'Background',
    機型: 'Robot model',
    性能參數: 'Performance parameters',
    其他約束: 'Other constraints',
  },
  'zh-Hant': {
    背景: '背景',
    機型: '機型',
    性能參數: '性能參數',
    其他約束: '其他約束',
  },
  ja: {
    背景: '背景',
    機型: '機種',
    性能參數: '性能パラメータ',
    其他約束: 'その他の制約',
  },
  de: {
    背景: 'Hintergrund',
    機型: 'Modell',
    性能參數: 'Leistungsparameter',
    其他約束: 'Weitere Randbedingungen',
  },
  fr: {
    背景: 'Contexte',
    機型: 'Modèle',
    性能參數: 'Paramètres de performance',
    其他約束: 'Autres contraintes',
  },
  es: {
    背景: 'Contexto',
    機型: 'Modelo',
    性能參數: 'Parámetros de rendimiento',
    其他約束: 'Otras restricciones',
  },
  ko: {
    背景: '배경',
    機型: '기종',
    性能參數: '성능 파라미터',
    其他約束: '기타 제약',
  },
};

/** Simplified / alternate keys models may emit; canonical ids are Traditional section headings. */
export const REQUIREMENTS_SECTION_KEY_ALIASES: Readonly<
  Record<string, RequirementsSectionId>
> = {
  机型: '機型',
  性能参数: '性能參數',
  其他约束: '其他約束',
};

function localeFromLang(lang: Language): string {
  switch (lang) {
    case 'zh-Hant':
      return 'zh-Hant';
    case 'ja':
      return 'ja-JP';
    case 'de':
      return 'de-DE';
    case 'fr':
      return 'fr-FR';
    case 'es':
      return 'es-ES';
    case 'ko':
      return 'ko-KR';
    default:
      return 'en';
  }
}

export function resolveRequirementsSectionId(rawKey: string): RequirementsSectionId | null {
  const trimmed = rawKey.trim();
  if (REQUIREMENTS_SECTION_IDS.includes(trimmed as RequirementsSectionId)) {
    return trimmed as RequirementsSectionId;
  }
  return REQUIREMENTS_SECTION_KEY_ALIASES[trimmed] ?? null;
}

export function getRequirementsSectionLabel(
  sectionId: RequirementsSectionId,
  lang: Language,
): string {
  return REQUIREMENTS_SECTION_LABELS[lang][sectionId];
}

export function formatProposeRevisionSectionSummary(
  baseSummary: string,
  sectionIds: RequirementsSectionId[],
  lang: Language,
): string {
  if (sectionIds.length === 0) {
    return baseSummary;
  }

  const labels = sectionIds.map((id) => getRequirementsSectionLabel(id, lang));
  const formattedList = new Intl.ListFormat(localeFromLang(lang), {
    style: 'long',
    type: 'conjunction',
  }).format(labels);

  if (lang === 'zh-Hant' || lang === 'ja') {
    return `${baseSummary}（${formattedList}）`;
  }

  return `${baseSummary} (${formattedList})`;
}
