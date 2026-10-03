/**
 * OrderHistory.
 *
 * The reader's orders, newest first, each row a link to `/order/:id`. Order
 * detail belongs to the cart/checkout surface — this links, it does not rebuild.
 *
 * A row is one tap target: on a phone the reference, the date and the total are
 * all inside a single 44px-minimum link rather than three separate targets that
 * all do the same thing.
 *
 * Totals are rendered from `total_kobo` and never recomputed. The server
 * calculated that number against purchase-time price snapshots, and a client-side
 * recalculation would be a different number the moment a product's price moved.
 */

import { Link } from 'react-router-dom';
import { ArrowForwardIcon, BagIcon } from '@/components/icons';
import {
  Badge,
  type BadgeTone,
  buttonClasses,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui';
import type { OrdersState } from '@/hooks';
import { formatMoney } from '@/lib/money';
import type { OrderStatus } from '@/lib/supabase.types';
import { ROUTE_PATHS } from '@/routes';

const ORDER_DATE = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  // Fixed so a row reads the same on every machine. Orders are timestamps; the
  // date of the day they were placed is what a reader is checking.
  timeZone: 'UTC',
});

/**
 * Badge tones per order status.
 *
 * `confirmed` is the only tone that is not the neutral or the destructive one:
 * a full list of chartreuse chips would spend the accent the way DESIGN.md says
 * not to, and the word carries the meaning regardless.
 */
const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  confirmed: 'outline',
  pending: 'neutral',
  cancelled: 'danger',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  confirmed: 'Confirmed',
  pending: 'Pending',
  cancelled: 'Cancelled',
};

export interface OrderHistoryProps {
  orders: OrdersState;
  headingId?: string;
}

export function OrderHistory({ orders, headingId = 'orders-heading' }: OrderHistoryProps) {
  const { error, isLoading, refresh, status } = orders;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="font-display text-lg uppercase tracking-tight text-ink">
          Orders
        </h2>
        {status === 'success' ? (
          <span className="font-editorial text-meta uppercase tracking-wider text-ink-subtle">
            {orders.orders.length === 1 ? '1 order' : `${orders.orders.length} orders`}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div aria-busy className="flex flex-col gap-3">
          <Skeleton className="h-[74px] w-full" />
          <Skeleton className="h-[74px] w-full" />
        </div>
      ) : null}

      {error === null ? null : (
        <ErrorState
          title="We could not load your orders"
          error={error}
          onRetry={() => {
            void refresh();
          }}
        />
      )}

      {error === null && status === 'success' && orders.orders.length === 0 ? (
        <EmptyState
          icon={<BagIcon size={20} />}
          title="No orders yet"
          description="When you order something it will appear here, with its reference and total."
          action={
            <Link to={ROUTE_PATHS.catalog} className={buttonClasses({ variant: 'outline' })}>
              Browse the catalogue
            </Link>
          }
        />
      ) : null}

      {status !== 'success' || orders.orders.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-hairline rounded-component border-hard border-hairline bg-surface-lowest">
          {orders.orders.map((order) => {
            const placed = ORDER_DATE.format(new Date(order.created_at));
            const items = order.itemCount === 1 ? '1 item' : `${order.itemCount} items`;

            return (
              <li key={order.id}>
                <Link
                  to={ROUTE_PATHS.order(order.id)}
                  aria-label={`Order ${order.reference}, placed ${placed}, ${STATUS_LABEL[order.status]}, ${formatMoney(order.total_kobo)}, ${items}`}
                  className="tap-target flex flex-col gap-2 px-4 py-4 transition-kanso hover:bg-surface-container focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-editorial text-meta uppercase tracking-wider text-ink">
                      {order.reference}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
                      <time dateTime={order.created_at}>{placed}</time>
                      <span aria-hidden>/</span>
                      <span>{items}</span>
                    </span>
                  </span>

                  <span className="flex items-center gap-3">
                    <Badge tone={STATUS_TONE[order.status]} live={false}>
                      {STATUS_LABEL[order.status]}
                    </Badge>
                    <span className="font-label tracking-[0.06em] text-ink">
                      {formatMoney(order.total_kobo)}
                    </span>
                    <span className="shrink-0 text-ink-subtle">
                      <ArrowForwardIcon size={18} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
