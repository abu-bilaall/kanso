/**
 * Button.
 *
 * DESIGN.md: "Hard 2px borders for primary interactive elements", "Avoid
 * excessive pills", "Interactive targets must be comfortable on mobile". Every
 * button here is therefore at least 44px tall and square-ish (4px radius at the
 * `sm` size, the 8px component radius above it) — never a pill.
 *
 * ## Two ways to use it
 *
 * ```tsx
 * <Button onClick={save}>Save</Button>                 // a real <button>
 * <Link className={buttonClasses({ variant: 'primary' })} to="/cart">
 * ```
 *
 * {@link buttonClasses} is exported for exactly that second case. Reaching for a
 * polymorphic `as` prop would be cleverer than this codebase needs; a class-name
 * helper is boring, obvious and composable.
 */

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant =
  /** Solid ink, paper text, hard 2px edge. One per view. */
  | 'primary'
  /** Chartreuse. Used for the single most important action on a screen. */
  | 'accent'
  /** Transparent with a hard 2px ink edge. Secondary actions. */
  | 'outline'
  /** Flat surface fill, hairline edge. Tertiary / in-card actions. */
  | 'surface'
  /** No chrome. Icon buttons and inline text actions. */
  | 'ghost'
  /** Destructive only. Never for "cancel". */
  | 'danger';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container. PLAN 3 requires this on mobile. */
  fullWidth?: boolean;
  /** Disable pointer events without changing layout. */
  disabled?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Hard-edged primary: 2px ink border, no radius softening below `sm`.
  primary: 'bg-ink text-ink-on-primary border-hard border-ink hover:bg-graphite',
  accent: 'bg-accent text-ink-on-accent border-hard border-ink hover:bg-accent/80',
  outline: 'bg-transparent text-ink border-hard border-ink hover:bg-surface-container',
  surface:
    'bg-surface-container text-ink border-hard border-hairline hover:bg-surface-high hover:border-ink',
  ghost:
    'bg-transparent text-ink-muted border-hard border-transparent hover:text-ink hover:bg-surface-container',
  danger:
    'bg-danger-surface text-danger-ink border-hard border-danger hover:bg-danger hover:text-ink-on-primary',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-[13px]',
  md: 'min-h-11 px-4 text-label',
  // PLAN 3: on mobile, full-width hard 2px buttons at the large size.
  lg: 'min-h-14 px-6 text-label',
};

const BASE_CLASSES = [
  'inline-flex items-center justify-center gap-2 rounded-component',
  'font-label uppercase tracking-[0.06em] select-none',
  'transition-kanso',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
  'disabled:pointer-events-none disabled:opacity-45',
].join(' ');

/**
 * The class list for a button, for anything that is not a `<button>` — a
 * `react-router` `<Link>`, or an `<a>`.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
}: ButtonClassOptions = {}): string {
  return [
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth ? 'w-full' : '',
    disabled ? 'pointer-events-none opacity-45' : '',
  ]
    .filter((part) => part.length > 0)
    .join(' ');
}

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>,
    ButtonClassOptions {
  /** Shows a busy state and blocks interaction. Sets `aria-busy` and `disabled`. */
  loading?: boolean;
  /**
   * Icon rendered before the label. Icons are outline SVGs from
   * `src/components/icons.tsx`; pass the element, not a name, so the button
   * never guesses.
   */
  icon?: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled = false,
  icon,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, disabled: disabled || loading })}
    >
      {icon}
      {children}
    </button>
  );
}
