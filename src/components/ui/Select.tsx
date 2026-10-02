/**
 * Select.
 *
 * A native `<select>` with Kanso's chrome. Native is the right call: it is
 * keyboard accessible everywhere, it gets the platform picker on mobile, and it
 * needs no listbox state machine. Do not replace it with a custom combobox.
 *
 * Shares {@link Input}'s accessibility contract exactly: always labelled, error
 * wired through `aria-invalid` / `aria-describedby`.
 */

import { forwardRef, type ReactNode, type SelectHTMLAttributes, useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'> {
  label: string;
  options: readonly SelectOption[];
  error?: string | undefined;
  hint?: ReactNode;
  required?: boolean;
  /** Placeholder shown when `value` is empty. Omit for a required select. */
  placeholder?: string;
}

const CONTROL_CLASSES = [
  'w-full min-h-11 appearance-none rounded-component bg-surface-container px-3 py-2 pr-9',
  'border-hard border-hairline text-ink',
  'transition-kanso',
  'hover:border-ink-subtle',
  'focus:border-ink focus:bg-surface-container-high focus:outline-none',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-surface/40',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, hint, required = false, placeholder, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const describedById = `${selectId}-description`;
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
        htmlFor={selectId}
        className="font-editorial text-meta uppercase tracking-wider text-ink-muted"
      >
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>

      <div className="relative flex items-center">
        <select
          {...rest}
          ref={ref}
          id={selectId}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy}
          className={CONTROL_CLASSES}
        >
          {placeholder === undefined ? null : (
            <option value="" disabled={required}>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        {/* Chevron drawn inline: the native one disappears with `appearance-none`. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="1em"
          height="1em"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute right-3 text-ink-subtle"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
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
