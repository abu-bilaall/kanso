/**
 * QuantityControl.
 *
 * Minus, the number, plus. PLAN 3 requires 44px minimum tap targets, so the two
 * buttons are 44x44 even at the `sm` size, and the whole control is one
 * bordered block with a hairline divider rather than three separate boxes — the
 * Stitch prototypes draw them detached, which makes the middle number look
 * editable when it is not.
 *
 * ## Contract with the caller
 *
 * The control is **clamped, not corrected**: pressing `+` at `max` does nothing
 * and the button becomes `aria-disabled` (still focusable, so a screen-reader
 * user finds out it exists). Callers pass `max` from the product's current
 * `inventory`; `create-order` enforces the same limit again server-side.
 *
 * `onChange` is only called with a value strictly inside `[min, max]`.
 */

import { useId } from 'react';
import { MinusIcon, PlusIcon } from '@/components/icons';

export interface QuantityControlProps {
  value: number;
  /** Called with the new quantity. Never called with a value outside the bounds. */
  onChange: (quantity: number) => void;
  min?: number;
  /** Hard upper bound. Pass the product's inventory. */
  max: number;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Rendered after the control, e.g. "Only 4 left". */
  trailing?: React.ReactNode;
}

const BUTTON_BASE =
  'tap-target grid place-items-center text-ink transition-kanso hover:bg-surface-high disabled:pointer-events-none';

export function QuantityControl({
  value,
  onChange,
  min = 1,
  max,
  label = 'Quantity',
  size = 'md',
  disabled = false,
  trailing,
}: QuantityControlProps) {
  const groupId = useId();
  const atMin = value <= min;
  const atMax = value >= max;
  const soldOut = max < min;

  const step = (delta: number): void => {
    if (disabled || soldOut) return;
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex items-center gap-2">
      {/* `<fieldset>` rather than `role="group"`: it is the semantic element for
          exactly this, and it groups the buttons for assistive tech without an
          ARIA role that has to be kept in sync with the markup. */}
      <fieldset
        aria-label={label}
        className={`inline-flex items-stretch overflow-hidden rounded-component border-hard border-hairline bg-surface-container ${
          size === 'sm' ? 'text-sm' : 'text-label'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled || atMin}
          aria-disabled={atMin || undefined}
          aria-label={`Decrease ${label.toLowerCase()}`}
          className={`${BUTTON_BASE} border-r border-hairline`}
        >
          <MinusIcon />
        </button>

        <output
          id={groupId}
          aria-live="polite"
          className={`grid place-items-center px-3 font-label tabular-nums ${size === 'sm' ? 'min-w-8' : 'min-w-10'}`}
        >
          {value}
        </output>

        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled || atMax}
          aria-disabled={atMax || undefined}
          aria-label={`Increase ${label.toLowerCase()}`}
          className={`${BUTTON_BASE} border-l border-hairline`}
        >
          <PlusIcon />
        </button>
      </fieldset>

      {trailing === undefined ? null : (
        <span className="font-editorial text-[10px] uppercase tracking-wider text-ink-subtle">
          {trailing}
        </span>
      )}
    </div>
  );
}
