import { AIConversationModal } from '@/features/ai-assistant';
import type { AIConversationLaunchContext } from '@/features/ai-assistant';
import type { Language } from '@/shared/i18n';
import { useAgileRobotTools, type MeshReloadImportPort } from '@/integrations/agile-robot';

interface AIConversationConnectorProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
  onApply: (componentId: string, proposedUrdf: string) => boolean;
  /** Routes a regenerated GLB through the app file-import pipeline so the 3D viewport updates. */
  reloadMesh: MeshReloadImportPort;
}

export function AIConversationConnector({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
  onApply,
  reloadMesh,
}: AIConversationConnectorProps) {
  const toolsConfig = useAgileRobotTools({ reloadMesh, lang });

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
