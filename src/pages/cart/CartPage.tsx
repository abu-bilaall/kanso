/**
 * `/cart` — the line items, what they cost, and the way to checkout.
 *
 * ## The four states, and why each is different
 *
 * `useCart` collapses several truths into one hook, so this page has to separate
 * them again:
 *
 * - **Loading** — skeletons shaped like the rows they replace, so the layout does
 *   not jump when the numbers arrive. Never a spinner over an empty grid.
 * - **Failed** — `ErrorState`, which offers "Try again" only when the normalised
 *   error is actually retryable. A cart that cannot be read is not an empty cart.
 * - **Empty** — `EmptyState` with the way out. An anonymous visitor genuinely has
 *   no cart, because carts belong to accounts, so this page says so rather than
 *   implying they lost something.
 * - **Ready** — the rows.
 *
 * ## Mutations fail loudly
 *
 * `useCart` rejects on failure and flips `isMutating`. Every mutation here is
 * awaited inside a `try`/`catch` and its message is rendered on the row that
 * caused it, so a rejected "reduce to 1" leaves a sentence on screen instead of a
 * number that quietly did not change. The whole list is disabled while a
 * mutation is in flight, because two concurrent writes to one cart race.
 */

import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '@/components/layout';
import { buttonClasses, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { blockingStockMessage, CartLine, CartSummary } from '@/features/cart';
import { useAuth, useCart } from '@/hooks';
import { AppError } from '@/lib/errors';
import type { CartItemWithProduct } from '@/lib/supabase.types';
import { ROUTE_PATHS } from '@/routes';

/** One row's failure, so the message lands next to the control that caused it. */
interface RowFailure {
  productId: string;
  message: string;
}

function CartSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true">
      <p className="sr-only" role="status">
        Loading your cart
      </p>
      {[0, 1].map((row) => (
        <div
          key={row}
          className="flex gap-3 border-b border-hairline py-4 last:border-b-0 md:gap-4"
        >
          <Skeleton className="w-24 shrink-0 md:w-28" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-11 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CartPage() {
  const auth = useAuth();
  const cart = useCart();
  const [failure, setFailure] = useState<RowFailure | null>(null);

  const changeQuantity = useCallback(
    async (item: CartItemWithProduct, quantity: number): Promise<void> => {
      setFailure(null);
      try {
        await cart.setItemQuantity(item.product_id, quantity);
      } catch (thrown) {
        setFailure({
          productId: item.product_id,
          message:
            thrown instanceof AppError ? thrown.message : 'That quantity could not be saved.',
        });
      }
    },
    [cart],
  );

  const remove = useCallback(
    async (item: CartItemWithProduct): Promise<void> => {
      setFailure(null);
      try {
        await cart.removeItem(item.product_id);
      } catch (thrown) {
        setFailure({
          productId: item.product_id,
          message: thrown instanceof AppError ? thrown.message : 'That item could not be removed.',
        });
      }
    },
    [cart],
  );

  const loading = cart.isLoading;
  const failed = cart.status === 'error';

  return (
    <PageShell title="Cart — Kanso" width="default">
      {/*
        PageShell's own `gap-lg` resolves to nothing: `--spacing-md`, `-lg` and
        `-xl` are not in the `@theme` block, so those utilities are never
        generated and the shell's children stack with no gap at all. This wrapper
        carries the vertical rhythm for this page rather than depending on a
        token that is not there — see `docs/CONTRACT-REQUESTS.md`.
      */}
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="font-display text-heading uppercase leading-none tracking-tight text-ink">
            Cart
          </h1>
          <span className="font-editorial text-[11px] uppercase tracking-wider text-ink-subtle">
            {loading ? '—' : `${cart.itemCount} ${cart.itemCount === 1 ? 'unit' : 'units'}`}
          </span>
        </header>

        {failed ? (
          <ErrorState
            title="Your cart did not load"
            error={cart.error}
            onRetry={() => {
              void cart.refresh();
            }}
          />
        ) : loading ? (
          <CartSkeleton />
        ) : cart.items.length === 0 ? (
          <EmptyState
            title="Your cart is empty"
            description={
              auth.status === 'anonymous'
                ? 'Nothing here yet. Your cart travels with your Kanso account, so sign in at checkout and it will be waiting.'
                : 'Nothing here yet. The catalogue is a good place to start.'
            }
            action={
              <Link
                to={ROUTE_PATHS.catalog}
                className={buttonClasses({ variant: 'primary', size: 'md' })}
              >
                Browse the catalogue
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
            <section aria-label="Items in your cart" className="flex flex-col">
              <ul className="flex flex-col">
                {cart.items.map((item) => (
                  <CartLine
                    key={item.id}
                    item={item}
                    busy={cart.isMutating}
                    error={failure?.productId === item.product_id ? failure.message : null}
                    onQuantityChange={(quantity) => {
                      void changeQuantity(item, quantity);
                    }}
                    onRemove={() => {
                      void remove(item);
                    }}
                  />
                ))}
              </ul>
            </section>

            <CartSummary
              subtotalKobo={cart.subtotalKobo}
              itemCount={cart.itemCount}
              blockedReason={blockingStockMessage(cart.items)}
            />
          </div>
        )}
      </div>
    </PageShell>
  );
}
