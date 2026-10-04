/**
 * Alert.
 *
 * An inline, non-blocking message that belongs on the page: "your order is
 * confirmed but the email may not have arrived", "we adjusted your quantity".
 *
 * Not for form validation (that is `Input.error`) and not for a failed request
 * (that is `ErrorState`). This sits between the two: something the user should
 * read and can carry on from.
 *
 * `role="alert"` for `danger` and `warning` so it interrupts; `role="status"` for
 * the rest. Tone is never the only signal — every alert has a `title` and
 * children in words.
 */

import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from '@/components/icons';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  tone?: AlertTone;
  /** Optional short heading. Without one, the children carry the whole message. */
  title?: string;
  children?: React.ReactNode;
  /** Renders a close button when provided. */
  onDismiss?: () => void;
  className?: string;
}

const TONE_CLASSES: Record<AlertTone, string> = {
  info: 'border-hairline bg-surface-container text-ink',
  success: 'border-ink bg-accent text-ink-on-accent',
  warning: 'border-ink bg-accent text-ink-on-accent',
  danger: 'border-danger bg-danger-surface text-danger-ink',
};

const TONE_ICON = {
  info: InfoIcon,
  success: CheckIcon,
  warning: AlertIcon,
  danger: AlertIcon,
} as const;

export function Alert({ tone = 'info', title, children, onDismiss, className = '' }: AlertProps) {
  const Glyph = TONE_ICON[tone];
  const assertive = tone === 'danger' || tone === 'warning';

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      className={[
        'flex items-start gap-2.5 rounded-component border-hard p-3',
        TONE_CLASSES[tone],
        className,
      ]
        .filter((part) => part.length > 0)
        .join(' ')}
    >
      <span className="mt-0.5 shrink-0">
        <Glyph size={18} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title === undefined ? null : (
          <span className="font-label uppercase tracking-[0.06em]">{title}</span>
        )}
        {children === undefined ? null : <div className="text-sm leading-6">{children}</div>}
      </div>
      {onDismiss === undefined ? null : (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="tap-target -m-2 grid place-items-center shrink-0 rounded-tight transition-kanso hover:bg-ink/10"
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
}
