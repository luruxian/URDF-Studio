import { useEffect, useState } from 'react';
import type { AIConversationToolsConfig } from '@/integrations/agile-robot/types';
import type { Language } from '@/shared/i18n';

import {
  createStudioModificationTools,
  type UrdfPackageImportPort,
} from '../studioModificationTools';

export interface UseStudioModificationToolsOptions {
  lang: Language;
  importUrdfPackage: UrdfPackageImportPort['importUrdfPackage'];
}

/**
 * Resolves Studio modification tools when bootstrapped on a urdf_stl order.
 * Returns null while loading or when bootstrap / package type is unsupported.
 */
export function useStudioModificationTools(
  options: UseStudioModificationToolsOptions,
): AIConversationToolsConfig | null {
  const { lang, importUrdfPackage } = options;
  const [toolsConfig, setToolsConfig] = useState<AIConversationToolsConfig | null>(null);

  useEffect(() => {
    let cancelled = false;

    void createStudioModificationTools({ lang, importUrdfPackage }).then((config) => {
      if (!cancelled) {
        setToolsConfig(config);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [importUrdfPackage, lang]);

  return toolsConfig;
}
