/**
 * Input.
 *
 * A labelled text control. There is no floating-label variant and no "bare"
 * variant: checkout needs one consistent, always-labelled field, and a single
 * shape is one fewer thing for six agents to disagree about.
 *
 * Accessibility contract (DESIGN.md "Meaningful form labels"):
 *   - `label` is required and rendered as a real `<label for>`.
 *   - `error` is wired to `aria-invalid` and `aria-describedby`.
 *   - `hint` and `error` share one description node so both are announced once.
 *   - The control is never `aria-hidden` and never relies on a placeholder as
 *     its only label.
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'size'> {
  /** Visible label. Always rendered. */
  label: string;
  /** Field-level message from `checkoutFieldErrors`. Presence turns the control invalid. */
  error?: string | undefined;
  /** Supporting copy under the label, e.g. "Automated Mailgun order logs route here." */
  hint?: ReactNode;
  /** Rendered at the trailing edge inside the control (e.g. a "N left" note). */
  trailing?: ReactNode;
  /** Marks the label and sets `required`/`aria-required`. */
  required?: boolean;
}

const CONTROL_CLASSES = [
  'w-full min-h-11 rounded-component bg-surface-container px-3 py-2',
  'border-hard border-hairline text-ink placeholder:text-ink-subtle',
  'transition-kanso',
  'hover:border-ink-subtle',
  'focus:border-ink focus:bg-surface-high focus:outline-none',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-surface/40',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, trailing, required = false, id, type = 'text', ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = `${inputId}-description`;

  const describedBy =
    [
      hint === undefined ? undefined : describedById,
      error === undefined ? undefined : describedById,
    ]
      .filter((value) => value !== undefined)
      .join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className="font-editorial text-meta uppercase tracking-wider text-ink-muted"
      >
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>

      <div className="relative flex items-center">
        <input
          {...rest}
          ref={ref}
          id={inputId}
          type={type}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy}
          className={CONTROL_CLASSES}
        />
        {trailing === undefined ? null : (
          <span className="pointer-events-none absolute right-3 font-editorial text-meta uppercase tracking-wider text-ink-subtle">
            {trailing}
          </span>
        )}
      </div>

      {hint === undefined && error === undefined ? null : (
        <p
          id={describedById}
          className={`font-editorial text-[10px] leading-4 ${error === undefined ? 'text-ink-subtle' : 'text-danger-ink'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
});
