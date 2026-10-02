/**
 * MobileHeader.
 *
 * PLAN 3: below 768px there is a sticky header carrying the wordmark and the
 * cart. The Stitch mobile reference adds a hamburger and a cart badge; this one
 * keeps the hamburger out, because {@link MobileTabBar} already gives every top
 * level destination a fixed 44px target and a duplicate menu is a worse version
 * of the same thing.
 *
 * Two modes, both used by the prototypes:
 *   - default: wordmark on the left, cart on the right.
 *   - `back`: a back control plus a short context label (product detail,
 *     checkout). Rendered when a page passes `backTo`.
 *
 * `env(safe-area-inset-top)` padding is applied so the header clears a notch.
 */

import { Link } from 'react-router-dom';
import { ArrowBackIcon, CartIcon } from '@/components/icons';
import { useCart } from '@/hooks/useCart';

export interface MobileHeaderProps {
  /**
   * Where the back control goes. Omit it and the header shows the wordmark
   * instead. `null` and `undefined` mean the same thing.
   */
  backTo?: string | null;
  /** The context label shown beside the back control, e.g. "OBJ-014". */
  contextLabel?: string;
}

export function MobileHeader({ backTo, contextLabel }: MobileHeaderProps) {
  const { itemCount } = useCart();
  const showBack = typeof backTo === 'string' && backTo.length > 0;

  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
      <div className="flex h-14 items-center justify-between px-gutter">
        {showBack ? (
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={backTo ?? '/'}
              aria-label="Go back"
              className="tap-target -ml-2 grid place-items-center rounded-component border-hard border-hairline transition-kanso hover:bg-surface-container"
            >
              <ArrowBackIcon size={20} />
            </Link>
            <span className="truncate font-editorial text-meta uppercase tracking-wider text-ink-muted">
              {contextLabel ?? 'Back'}
            </span>
          </div>
        ) : (
          <Link
            to="/"
            className="font-display text-base uppercase leading-none tracking-[0.2em] text-ink"
            aria-label="Kanso — home"
          >
            KANSO
          </Link>
        )}

        <Link
          to="/cart"
          aria-label={`Cart${itemCount > 0 ? `, ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}`}
          className="relative tap-target grid place-items-center rounded-component border-hard border-hairline transition-kanso hover:bg-surface-container"
        >
          <CartIcon size={20} />
          {itemCount <= 0 ? null : (
            <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-hard border-ink bg-accent px-1 font-editorial text-[10px] font-bold leading-none text-ink-on-accent">
              {itemCount > 9 ? '9+' : itemCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
