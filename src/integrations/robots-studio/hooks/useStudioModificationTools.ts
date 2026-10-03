import { useEffect, useRef, useState } from 'react';
import type { AIConversationToolsConfig } from '@/integrations/agile-robot/types';
import type { Language } from '@/shared/i18n';

import {
  createStudioModificationTools,
  type UrdfPackageImportPort,
} from '../studioModificationTools';

export interface UseStudioModificationToolsOptions {
  lang: Language;
  importUrdfPackage: UrdfPackageImportPort['importUrdfPackage'];
  onMeshProgress?: (progress: number | null) => void;
}

/**
 * Resolves Studio modification tools when bootstrapped on a urdf_stl order.
 * Returns null while loading or when bootstrap / package type is unsupported.
 */
export function useStudioModificationTools(
  options: UseStudioModificationToolsOptions,
): AIConversationToolsConfig | null {
  const { lang, importUrdfPackage, onMeshProgress } = options;
  const onMeshProgressRef = useRef(onMeshProgress);
  onMeshProgressRef.current = onMeshProgress;
  const [toolsConfig, setToolsConfig] = useState<AIConversationToolsConfig | null>(null);

  useEffect(() => {
    let cancelled = false;

    void createStudioModificationTools({
      lang,
      importUrdfPackage,
      onMeshProgress: (progress) => {
        onMeshProgressRef.current?.(progress);
      },
    }).then((config) => {
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
