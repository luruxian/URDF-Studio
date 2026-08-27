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
}

export function AIConversationConnector({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
  onApply,
  importUrdfPackage,
}: AIConversationConnectorProps) {
  const toolsConfig = useStudioModificationTools({ importUrdfPackage, lang });

  return (
    <AIConversationModal
      isOpen={isOpen}
      onClose={onClose}
      lang={lang}
      launchContext={launchContext}
      onStartNewConversation={onStartNewConversation}
      onApply={onApply}
      toolsConfig={toolsConfig}
    />
  );
}
