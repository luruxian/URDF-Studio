import { AlertCircle, Check, Loader2 } from 'lucide-react';

import { translations, type Language } from '@/shared/i18n';
import type { ParsedToolCall, ToolConfirmBannerTexts, ToolConfirmState, ToolResult } from '../types';

export interface ToolConfirmBannerProps {
  lang: Language;
  state: ToolConfirmState;
  toolCall: ParsedToolCall;
  result?: ToolResult;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry?: () => void;
  /** When set, overrides agileRobotTool* banner labels (e.g. URDF+STL mesh regenerate). */
  bannerTexts?: ToolConfirmBannerTexts;
}

/**
 * Banner that walks the AI tool-confirmation state machine.
 *
 * - idle / cancelled -> renders nothing
 * - parsed -> shows the tool summary with confirm/cancel actions
 * - executing -> spinner while the tool action runs
 * - done -> success message
 * - error -> failure message with retry/cancel actions
 *
 * The caller owns the state transitions; this component only renders the
 * current state and forwards the user's confirm/cancel/retry decisions back.
 */
export function ToolConfirmBanner({
  lang,
  state,
  toolCall,
  result,
  onConfirm,
  onCancel,
  onRetry,
  bannerTexts,
}: ToolConfirmBannerProps) {
  const t = translations[lang];
  const confirmLabel = bannerTexts?.confirm ?? t.agileRobotToolConfirm;
  const cancelLabel = bannerTexts?.cancel ?? t.agileRobotToolCancel;
  const retryLabel = bannerTexts?.retry ?? t.agileRobotToolRetry;
  const executingLabel = bannerTexts?.executing ?? t.agileRobotToolExecuting;

  if (state === 'idle' || state === 'cancelled') {
    return null;
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
      {state === 'parsed' && (
        <>
          <span className="text-base">🎨</span>
          <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
            {toolCall.summary}
          </span>
          <button
            onClick={onConfirm}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md bg-gray-200 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {cancelLabel}
          </button>
        </>
      )}

      {state === 'executing' && (
        <>
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {executingLabel}
          </span>
        </>
      )}

      {state === 'done' && result && (
        <>
          <Check className="h-5 w-5 text-green-600" />
          <span className="text-sm text-green-700 dark:text-green-400">
            {result.message}
          </span>
        </>
      )}

      {state === 'error' && result && (
        <>
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="flex-1 text-sm text-red-600 dark:text-red-400">
            {result.message}
          </span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md bg-red-100 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
            >
              {retryLabel}
            </button>
          )}
          <button
            onClick={onCancel}
            className="rounded-md bg-gray-200 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {cancelLabel}
          </button>
        </>
      )}
    </div>
  );
}
