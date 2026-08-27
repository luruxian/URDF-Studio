import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildConversationContext,
  createConversationSession,
  syncConversationSnapshot,
  type ConversationContextOptions,
  type ConversationSnapshotPut,
} from '@/features/ai-assistant';

export const CONVERSATION_SNAPSHOT_SYNC_DEBOUNCE_MS = 300;

export interface ConversationSessionApi {
  createConversationSession: typeof createConversationSession;
  syncConversationSnapshot: typeof syncConversationSnapshot;
}

export interface UseConversationSessionOptions {
  lang: string;
  debounceMs?: number;
  api?: ConversationSessionApi;
  autoCreate?: boolean;
}

interface ParsedConversationContext {
  mode: ConversationSnapshotPut['mode'];
  robot: ConversationSnapshotPut['snapshot']['robot'];
  inspectionReport?: ConversationSnapshotPut['snapshot']['inspectionReport'];
  selectedEntity?: ConversationSnapshotPut['snapshot']['selectedEntity'];
  focusedIssue?: ConversationSnapshotPut['snapshot']['focusedIssue'];
}

function buildSnapshotPutRequest(
  lang: string,
  snapshotRevision: number,
  options: ConversationContextOptions,
): ConversationSnapshotPut {
  const parsed = JSON.parse(buildConversationContext(options)) as ParsedConversationContext;
  return {
    mode: parsed.mode,
    lang,
    snapshot_revision: snapshotRevision,
    snapshot: {
      robot: parsed.robot,
      inspectionReport: parsed.inspectionReport ?? null,
      selectedEntity: parsed.selectedEntity ?? null,
      focusedIssue: parsed.focusedIssue ?? null,
    },
  };
}

const DEFAULT_CONVERSATION_SESSION_API: ConversationSessionApi = {
  createConversationSession,
  syncConversationSnapshot,
};

export function useConversationSession({
  lang,
  debounceMs = CONVERSATION_SNAPSHOT_SYNC_DEBOUNCE_MS,
  api: apiOption,
  autoCreate = true,
}: UseConversationSessionOptions) {
  const apiRef = useRef(apiOption ?? DEFAULT_CONVERSATION_SESSION_API);
  apiRef.current = apiOption ?? DEFAULT_CONVERSATION_SESSION_API;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const snapshotRevisionRef = useRef(0);
  const pendingOptionsRef = useRef<ConversationContextOptions | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightSyncRef = useRef<Promise<void> | null>(null);
  const createSessionPromiseRef = useRef<Promise<void> | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const performSync = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    const pendingOptions = pendingOptionsRef.current;
    if (!activeSessionId || !pendingOptions) {
      return;
    }

    snapshotRevisionRef.current += 1;
    const payload = buildSnapshotPutRequest(
      lang,
      snapshotRevisionRef.current,
      pendingOptions,
    );
    pendingOptionsRef.current = null;

    const syncPromise = apiRef.current.syncConversationSnapshot(activeSessionId, payload);
    inFlightSyncRef.current = syncPromise;
    try {
      await syncPromise;
    } finally {
      if (inFlightSyncRef.current === syncPromise) {
        inFlightSyncRef.current = null;
      }
    }
  }, [lang]);

  const scheduleSync = useCallback(() => {
    clearDebounceTimer();
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void performSync();
    }, debounceMs);
  }, [clearDebounceTimer, debounceMs, performSync]);

  const resetSession = useCallback(async () => {
    if (createSessionPromiseRef.current) {
      await createSessionPromiseRef.current;
      return;
    }

    const createPromise = (async () => {
      clearDebounceTimer();
      pendingOptionsRef.current = null;
      snapshotRevisionRef.current = 0;

      const created = await apiRef.current.createConversationSession();
      sessionIdRef.current = created.sessionId;
      setSessionId(created.sessionId);
    })();

    createSessionPromiseRef.current = createPromise;
    try {
      await createPromise;
    } finally {
      if (createSessionPromiseRef.current === createPromise) {
        createSessionPromiseRef.current = null;
      }
    }
  }, [clearDebounceTimer]);

  const syncSnapshot = useCallback((contextOptions: ConversationContextOptions) => {
    if (!sessionIdRef.current) {
      return;
    }
    pendingOptionsRef.current = contextOptions;
    scheduleSync();
  }, [scheduleSync]);

  const ensureSynced = useCallback(async () => {
    clearDebounceTimer();
    if (pendingOptionsRef.current) {
      await performSync();
      return;
    }
    if (inFlightSyncRef.current) {
      await inFlightSyncRef.current;
    }
  }, [clearDebounceTimer, performSync]);

  useEffect(() => {
    return () => {
      clearDebounceTimer();
    };
  }, [clearDebounceTimer]);

  useEffect(() => {
    if (!autoCreate) {
      return undefined;
    }
    void resetSession();
    return () => {
      clearDebounceTimer();
    };
  }, [autoCreate, clearDebounceTimer, resetSession]);

  return {
    sessionId,
    syncSnapshot,
    ensureSynced,
    resetSession,
  };
}
