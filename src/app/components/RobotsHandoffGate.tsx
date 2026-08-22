import { useEffect, useState, type ReactNode } from 'react';
import { handleBootstrapMessage } from '@/integrations/agile-robot/bootstrap';
import { isHandoffGranted } from '@/integrations/agile-robot/handoffGrant';
import { RobotsHandoffBlockedScreen } from './RobotsHandoffBlockedScreen';

const POST_MESSAGE_GRANT_WAIT_MS = 1500;

interface RobotsHandoffGateProps {
  initialBlocked: boolean;
  children: ReactNode;
}

export function RobotsHandoffGate({ initialBlocked, children }: RobotsHandoffGateProps) {
  const [accessState, setAccessState] = useState<'allowed' | 'waiting' | 'blocked'>(() =>
    initialBlocked ? 'waiting' : 'allowed',
  );

  useEffect(() => {
    if (!initialBlocked) {
      return;
    }

    if (isHandoffGranted()) {
      setAccessState('allowed');
      return;
    }

    function onMessage(event: MessageEvent): void {
      if (handleBootstrapMessage(event) || isHandoffGranted()) {
        setAccessState('allowed');
      }
    }

    window.addEventListener('message', onMessage);
    const timeoutId = window.setTimeout(() => {
      setAccessState((current) => (current === 'waiting' ? 'blocked' : current));
    }, POST_MESSAGE_GRANT_WAIT_MS);

    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timeoutId);
    };
  }, [initialBlocked]);

  if (accessState === 'allowed') {
    return children;
  }

  if (accessState === 'blocked') {
    return <RobotsHandoffBlockedScreen />;
  }

  return null;
}
