/**
 * Badge.
 *
 * A status chip. DESIGN.md: "Do not rely on colour alone for status." So every
 * badge carries text — `children` is never optional, and `role="status"` is set
 * so a stock or order state is announced when it changes.
 *
 * Tones exist for the four states the catalogue and orders actually have:
 * in stock (accent), low stock (outline), out of stock (danger surface), and
 * everything else (neutral).
 */

import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'outline' | 'danger' | 'inverse';

export interface BadgeProps {
  /** The status in words. Required — colour never carries meaning alone. */
  children: ReactNode;
  tone?: BadgeTone;
  /**
   * Announce changes to assistive tech. Default `true`; set `false` inside a
   * list where the whole list is already announced.
   */
  live?: boolean;
  className?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-container text-ink-muted border-hairline',
  accent: 'bg-accent text-ink-on-accent border-ink',
  outline: 'bg-transparent text-ink border-ink',
  danger: 'bg-danger-surface text-danger-ink border-danger',
  inverse: 'bg-inverse text-inverse-text border-inverse',
};

export function Badge({ children, tone = 'neutral', live = true, className = '' }: BadgeProps) {
  return (
    <span
      role={live ? 'status' : undefined}
      className={[
        'inline-flex items-center gap-1 rounded-tight border-hard px-2 py-0.5',
        'font-editorial text-[10px] uppercase leading-4 tracking-wider',
        TONE_CLASSES[tone],
        className,
      ]
        .filter((part) => part.length > 0)
        .join(' ')}
    >
      {children}
    </span>
  );
}
