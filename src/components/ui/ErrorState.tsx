/**
 * ErrorState.
 *
 * "The request failed." SPEC requires that no user is left staring at a silent
 * failure, and this is where that promise is kept: a title in plain words, the
 * normalised error's message, and — only when the error is actually retryable —
 * a "Try again" button wired to `onRetry`.
 *
 * The retry button is driven by `error.retryable`, not by `onRetry !== undefined`.
 * Offering a retry for a 404 or a validation failure is a lie about what will
 * happen next.
 */

import { AlertIcon } from '@/components/icons';
import type { AppError } from '@/lib/errors';
import { Button } from './Button';

export interface ErrorStateProps {
  /** Defaults to the error's own message, which is already written for humans. */
  title?: string;
  /** The normalised failure. Omit for a generic panel with no detail. */
  error?: AppError | null;
  action?: React.ReactNode;
  onRetry?: () => void;
  /** Set while a retry is in flight, so the button can disable itself. */
  retrying?: boolean;
}

export function ErrorState({ title, error, action, onRetry, retrying = false }: ErrorStateProps) {
  const message = error?.message;
  const canRetry = onRetry !== undefined && error?.retryable === true;

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-component border-hard border-danger bg-danger-surface/40 p-6"
    >
      <span className="text-danger-ink">
        <AlertIcon size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg uppercase tracking-tight text-danger-ink">
          {title ?? 'Something went wrong'}
        </h2>
        {message === undefined ? null : (
          <p className="max-w-prose text-sm leading-6 text-ink">{message}</p>
        )}
      </div>
      {action}
      {canRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
