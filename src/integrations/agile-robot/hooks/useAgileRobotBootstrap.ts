// ============================================================
// useAgileRobotBootstrap: listen for robots:studio-bootstrap postMessage
// and expose the resulting sessionStorage state reactively.
// ============================================================

import { useEffect, useSyncExternalStore } from 'react';
import { handleBootstrapMessage, hasBootstrap } from '../bootstrap';

/**
 * Subscribers are re-notified when a valid bootstrap postMessage is handled.
 * Module-scope so useSyncExternalStore sees a stable subscribe identity and
 * any number of mounted hooks stay in sync from one window listener.
 */
const bootstrapListeners = new Set<() => void>();

function subscribeBootstrapChange(cb: () => void): () => void {
  bootstrapListeners.add(cb);
  return () => {
    bootstrapListeners.delete(cb);
  };
}

function notifyBootstrapChange(): void {
  bootstrapListeners.forEach((cb) => cb());
}

function getBootstrapSnapshot(): boolean {
  return hasBootstrap();
}

/**
 * Mount once (e.g. in AppContent) to listen for `robots:studio-bootstrap`
 * postMessage from the robots main site. The message handler validates origin,
 * type and payload via `handleBootstrapMessage`; when a bootstrap is stored the
 * module-level subscribers are notified so `hasBootstrap` re-renders only the
 * components that read it. Returns `{ hasBootstrap }` for one-off checks.
 */
export function useAgileRobotBootstrap(): { hasBootstrap: boolean } {
  const hasBootstrapValue = useSyncExternalStore(
    subscribeBootstrapChange,
    getBootstrapSnapshot,
    getBootstrapSnapshot,
  );

  useEffect(() => {
    function handler(event: MessageEvent): void {
      if (handleBootstrapMessage(event)) {
        notifyBootstrapChange();
      }
    }

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, []);

  return { hasBootstrap: hasBootstrapValue };
}
