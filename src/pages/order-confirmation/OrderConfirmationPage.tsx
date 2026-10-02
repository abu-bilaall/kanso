/**
 * `/order/:id` — the order is confirmed; this page is the receipt.
 *
 * ## Where every number comes from
 *
 * `useOrder` reads `orders` and `order_items`, which hold the purchase-time
 * snapshots. Nothing here recomputes a price: `order.total_kobo` is the figure
 * `create-order` calculated, and `item.unit_price_kobo` is what the customer
 * actually paid per unit, whatever the catalogue charges today. A receipt that
 * re-derives itself from live prices is a receipt that changes.
 *
 * ## The email notice
 *
 * `emailSent` is not a column on the order. It is a fact about one attempt at
 * one moment, returned by `create-order` and carried here in router state. Three
 * outcomes, all reachable:
 *
 * - just placed, `true` — the confirmation is on its way;
 * - just placed, `false` — **the order is confirmed and the email is not coming**;
 * - opened later or reloaded, no state — we have no record, and the notice says
 *   so rather than guessing in either direction.
 *
 * The second case is the one that matters. SPEC: email delivery is a follow-up
 * side effect, not the source of truth for whether the purchase exists. This page
 * never implies a failed order, and never claims an email is on its way when none
 * was sent.
 *
 * ## Payment
 *
 * V1 takes none, and the page says so once, in the summary. It does not use the
 * word "paid", does not show a payment method, and does not imply money moved.
 */

import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PageShell } from '@/components/layout';
import { Alert, Badge, buttonClasses, ErrorState, Skeleton } from '@/components/ui';
import { emailNotice, readEmailSent, unknownEmailNotice } from '@/features/checkout';
import { useOrder } from '@/hooks';
import { formatMoney } from '@/lib/money';
import { ROUTE_PATHS } from '@/routes';

const STATUS_LABEL = {
  pending: 'Being confirmed',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
} as const;

export function OrderConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { order, items, status, error, isLoading, refresh } = useOrder(id);
  const [emailDismissed, setEmailDismissed] = useState(false);

  const sent = readEmailSent(location.state);
  const notice = sent === null ? unknownEmailNotice() : emailNotice(sent, order?.email);

  return (
    <PageShell
      title={order === null ? 'Order — Kanso' : `Order ${order.reference} — Kanso`}
      width="narrow"
    >
      <div className="flex flex-col gap-6">
        {isLoading ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <p className="sr-only" role="status">
              Loading your order
            </p>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : status === 'error' || order === null ? (
          <ErrorState
            title="We could not find that order"
            error={error}
            onRetry={() => {
              void refresh();
            }}
            action={
              <Link
                to={ROUTE_PATHS.account}
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                Your orders
              </Link>
            }
          />
        ) : (
          <>
            <header className="flex flex-col gap-2">
              <span className="font-editorial text-[11px] uppercase tracking-wider text-ink-subtle">
                Order confirmed
              </span>
              <h1 className="font-display text-heading uppercase leading-none tracking-tight text-ink">
                Thank you
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-editorial text-body-lg tracking-tight text-ink">
                  {order.reference}
                </span>
                <Badge tone={order.status === 'confirmed' ? 'outline' : 'neutral'} live={false}>
                  {STATUS_LABEL[order.status]}
                </Badge>
              </div>
              <p className="text-sm text-ink-muted">
                Placed {new Date(order.created_at).toLocaleString('en-NG', { dateStyle: 'medium' })}
                .
              </p>
            </header>

            {emailDismissed ? null : (
              <Alert
                tone={notice.tone}
                title={notice.title}
                onDismiss={() => setEmailDismissed(true)}
              >
                {notice.body}
              </Alert>
            )}

            <section aria-labelledby="order-items-heading" className="flex flex-col gap-3">
              <h2
                id="order-items-heading"
                className="font-label uppercase tracking-[0.06em] text-ink"
              >
                Items
              </h2>
              <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
                {items.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-4 py-3">
                    <span className="min-w-0 text-sm text-ink">
                      {item.product_name}
                      <span className="ml-2 font-editorial text-[11px] uppercase tracking-wider text-ink-subtle">
                        ×{item.quantity}
                      </span>
                      <span className="ml-2 text-ink-subtle">
                        {formatMoney(item.unit_price_kobo)} each
                      </span>
                    </span>
                    <span className="shrink-0 font-label tabular-nums text-ink">
                      {formatMoney(item.unit_price_kobo * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="flex flex-col gap-1.5 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">Subtotal</dt>
                  <dd className="font-label tabular-nums text-ink">
                    {formatMoney(order.subtotal_kobo)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">Delivery</dt>
                  <dd className="font-label text-ink-muted">Included</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-hairline pt-2.5">
                  <dt className="font-label uppercase tracking-[0.06em] text-ink">Total</dt>
                  <dd className="font-label text-xl tabular-nums text-ink">
                    {formatMoney(order.total_kobo)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-5 text-ink-subtle">
                No payment was collected. The total above is what Kanso calculated from the prices
                and stock in its records when your order was placed.
              </p>
            </section>

            <section aria-labelledby="order-shipping-heading" className="flex flex-col gap-2">
              <h2
                id="order-shipping-heading"
                className="font-label uppercase tracking-[0.06em] text-ink"
              >
                Shipping to
              </h2>
              <address className="flex flex-col text-sm not-italic leading-6 text-ink-muted">
                <span className="text-ink">{order.full_name}</span>
                <span>{order.address_line1}</span>
                {order.address_line2 === null ? null : <span>{order.address_line2}</span>}
                <span>
                  {order.city}, {order.state}
                </span>
                <span>{order.country}</span>
                <span className="mt-2 text-ink-subtle">{order.email}</span>
                <span className="text-ink-subtle">{order.phone}</span>
              </address>
            </section>

            <div className="flex flex-wrap gap-2 border-t border-hairline pt-5">
              <Link
                to={ROUTE_PATHS.catalog}
                className={buttonClasses({ variant: 'primary', size: 'md' })}
              >
                Continue shopping
              </Link>
              <Link
                to={ROUTE_PATHS.account}
                className={buttonClasses({ variant: 'outline', size: 'md' })}
              >
                Your orders
              </Link>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
