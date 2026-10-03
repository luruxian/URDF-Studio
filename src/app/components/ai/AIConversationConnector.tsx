import { useState } from 'react';
import { AIConversationModal } from '@/features/ai-assistant';
import type { AIConversationLaunchContext } from '@/features/ai-assistant';
import type { UrdfPackageImportPort } from '@/integrations/robots-studio';
import { useStudioModificationTools } from '@/integrations/robots-studio/hooks/useStudioModificationTools';
import type { Language } from '@/shared/i18n';

interface AIConversationConnectorProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
  onApply: (componentId: string, proposedUrdf: string) => boolean;
  /** Routes a regenerated URDF+STL package through the app file-import pipeline. */
  importUrdfPackage: UrdfPackageImportPort['importUrdfPackage'];
  onMeshGenerationFailed?: () => void;
}

export function AIConversationConnector(props: AIConversationConnectorProps) {
  const {
    isOpen,
    onClose,
    lang,
    launchContext,
    onStartNewConversation,
    onApply,
    importUrdfPackage,
    onMeshGenerationFailed,
  } = props;
  const [meshProgress, setMeshProgress] = useState<number | null>(null);
  const toolsConfig = useStudioModificationTools({
    importUrdfPackage,
    lang,
    onMeshProgress: setMeshProgress,
  });

  return (
    <AIConversationModal
      isOpen={isOpen}
      onClose={onClose}
      lang={lang}
      launchContext={launchContext}
      onStartNewConversation={onStartNewConversation}
      onApply={onApply}
      toolsConfig={toolsConfig}
      onMeshGenerationFailed={onMeshGenerationFailed}
      meshProgress={meshProgress}
      onMeshProgressChange={setMeshProgress}
    />
  );
}
