/**
 * Skeleton.
 *
 * The loading state for a block of content.
 *
 * Two shapes, deliberately:
 *   - **no `label`** — decorative, `aria-hidden`. A grey box that a screen-reader
 *     user cannot perceive beats one that interrupts with a meaningless status.
 *     The owning region is expected to carry `aria-busy` and the accessible text.
 *   - **`label` given** — the block itself is the announcement, as a `status`
 *     live region. Used for a single skeleton standing in for a whole section.
 *
 * The shimmer is a two-second sweep that runs **once**, not a loop: a page that
 * loads in 300ms should not flash. It is disabled outright under
 * `prefers-reduced-motion` (see `tokens.css`).
 */

export interface SkeletonProps {
  className?: string;
  /** Announced in place of the skeleton. Makes the block a live region. */
  label?: string;
}

function skeletonClasses(className: string): string {
  return [
    'relative overflow-hidden rounded-component bg-surface-container',
    'after:absolute after:inset-0 after:bg-gradient-to-r',
    'after:from-transparent after:via-surface-high after:to-transparent',
    'motion-safe:after:animate-[kanso-skeleton_2s_ease-out_1]',
    'after:content-[""]',
    className,
  ]
    .filter((part) => part.length > 0)
    .join(' ');
}

export function Skeleton({ className = '', label }: SkeletonProps) {
  if (label !== undefined) {
    return <div role="status" aria-label={label} className={skeletonClasses(className)} />;
  }
  return <div aria-hidden className={skeletonClasses(className)} />;
}
