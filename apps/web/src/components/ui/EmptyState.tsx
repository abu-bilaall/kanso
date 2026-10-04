/**
 * EmptyState.
 *
 * "We loaded successfully and there is nothing here" — an empty cart, an empty
 * catalogue, an account with no orders. It is deliberately distinct from
 * {@link ErrorState}: same frame, different truth, different next step.
 *
 * Always names the situation and always offers the way out. "No results" with no
 * action is a dead end.
 */

import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Short, in the imperative or the noun phrase. "Your cart is empty." */
  title: string;
  /** One sentence on what to do next. Optional but strongly preferred. */
  description?: ReactNode;
  /** The way out — a link or a button. */
  action?: ReactNode;
  /** Optional outline glyph. Decorative; the title carries the meaning. */
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-component border-hard border-hairline bg-surface-lowest p-6">
      {icon === undefined ? null : <span className="text-ink-subtle">{icon}</span>}
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg uppercase tracking-tight text-ink">{title}</h2>
        {description === undefined ? null : (
          <p className="max-w-prose text-sm leading-6 text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
