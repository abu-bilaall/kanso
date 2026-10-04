/**
 * The cart's summary panel: what the cart costs, and the way out of it.
 *
 * ## On the accent
 *
 * DESIGN.md allows chartreuse once per view, and the cart spends it here — on the
 * single action the screen exists to offer. The line items stay ink, paper and
 * hairline. Checkout, which has to feel like paperwork rather than a shop,
 * spends it on nothing at all.
 *
 * ## On the number
 *
 * `subtotalKobo` comes from `useCart` and is derived from prices the server
 * fetched, but it is still a display convenience: `create-order` recomputes the
 * total from Postgres and the figure it returns is the one that becomes an
 * order. The panel says so, rather than implying the browser decided.
 */

import { Link } from 'react-router-dom';
import { ArrowForwardIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { ROUTE_PATHS } from '@/routes';

export interface CartSummaryProps {
  /** Integer kobo, from prices the server fetched. Not an authority. */
  subtotalKobo: number;
  itemCount: number;
  /**
   * Why checkout is unavailable, or `null` when it is available. A blocked cart
   * says which line and how many units exist — never "unavailable".
   */
  blockedReason: string | null;
}

export function CartSummary({ subtotalKobo, itemCount, blockedReason }: CartSummaryProps) {
  const blocked = blockedReason !== null;

  return (
    <aside className="flex flex-col gap-3 rounded-component border-hard border-hairline bg-surface-lowest p-4 md:p-5">
      <h2 className="font-editorial text-meta uppercase tracking-wider text-ink-muted">Summary</h2>

      <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3">
        <span className="text-sm text-ink-muted">
          Subtotal
          <span className="ml-2 font-editorial text-[11px] uppercase tracking-wider text-ink-subtle">
            {itemCount} {itemCount === 1 ? 'unit' : 'units'}
          </span>
        </span>
        <span className="font-label tabular-nums text-ink">{formatMoney(subtotalKobo)}</span>
      </div>

      {blocked ? (
        <p role="alert" className="text-sm leading-6 text-danger-ink">
          {blockedReason}
        </p>
      ) : null}

      {blocked ? (
        <span
          className={buttonClasses({
            variant: 'accent',
            size: 'lg',
            fullWidth: true,
            disabled: true,
          })}
          aria-disabled="true"
        >
          Proceed to checkout
          <ArrowForwardIcon size={16} />
        </span>
      ) : (
        <Link
          to={ROUTE_PATHS.checkout}
          className={buttonClasses({ variant: 'accent', size: 'lg', fullWidth: true })}
        >
          Proceed to checkout
          <ArrowForwardIcon size={16} />
        </Link>
      )}

      <p className="text-xs leading-5 text-ink-subtle">
        Kanso confirms the final total when your order is placed, against the prices and stock held
        in our records.
      </p>
    </aside>
  );
}
