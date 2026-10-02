/**
 * The order summary shown beside the checkout form.
 *
 * ## What this deliberately does not have
 *
 * No photography, no chartreuse, no product codes, no badges, no spec strips.
 * The customer already chose these things and is now filling in seven fields;
 * the summary's only job is to let them confirm the lines and the number without
 * re-reading the cart. Photographs here would make checkout the loudest screen
 * in the shop, and the brief is that the storefront has the personality.
 *
 * ## On the total
 *
 * `subtotalKobo` is `useCart`'s figure, derived from prices the server fetched.
 * `create-order` recalculates the authoritative total from Postgres when the
 * order is placed, and the confirmation screen shows that number. The line below
 * says so in words, so nobody reads this figure as a quote.
 */

import { Link } from 'react-router-dom';
import { formatMoney } from '@/lib/money';
import type { CartItemWithProduct } from '@/lib/supabase.types';
import { ROUTE_PATHS } from '@/routes';

export interface OrderSummaryProps {
  items: readonly CartItemWithProduct[];
  subtotalKobo: number;
  itemCount: number;
}

export function OrderSummary({ items, subtotalKobo, itemCount }: OrderSummaryProps) {
  return (
    <section
      aria-labelledby="order-summary-heading"
      className="flex flex-col gap-3 rounded-component border-hard border-hairline bg-surface-low p-4 md:p-5"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="order-summary-heading" className="font-label uppercase tracking-[0.06em] text-ink">
          Order summary
        </h2>
        <span className="font-editorial text-[11px] uppercase tracking-wider text-ink-subtle">
          {itemCount} {itemCount === 1 ? 'unit' : 'units'}
        </span>
      </div>

      <ul className="flex flex-col divide-y divide-hairline">
        {items.map((item) => {
          const product = item.product;
          const name = product?.name ?? 'Unavailable product';
          return (
            <li key={item.product_id} className="flex items-baseline justify-between gap-4 py-2.5">
              <span className="min-w-0 text-sm text-ink">
                {product === null ? (
                  name
                ) : (
                  <Link
                    to={ROUTE_PATHS.product(product.slug)}
                    className="transition-kanso hover:text-accent-deep"
                  >
                    {name}
                  </Link>
                )}
                <span className="ml-2 font-editorial text-[11px] uppercase tracking-wider text-ink-subtle">
                  ×{item.quantity}
                </span>
              </span>
              <span className="shrink-0 font-label tabular-nums text-ink-muted">
                {formatMoney((product?.price_kobo ?? 0) * item.quantity)}
              </span>
            </li>
          );
        })}
      </ul>

      <dl className="flex flex-col gap-1.5 border-t border-hairline pt-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="font-label tabular-nums text-ink">{formatMoney(subtotalKobo)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-muted">Delivery</dt>
          <dd className="font-label text-ink-muted">Included</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-hairline pt-2.5">
          <dt className="font-label uppercase tracking-[0.06em] text-ink">Total</dt>
          <dd className="font-label text-xl tabular-nums text-ink">{formatMoney(subtotalKobo)}</dd>
        </div>
      </dl>

      <p className="text-xs leading-5 text-ink-subtle">
        No payment is collected in this version. We confirm the total against live prices and stock
        when your order is placed.
      </p>
    </section>
  );
}
