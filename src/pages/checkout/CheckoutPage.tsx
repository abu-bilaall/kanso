/**
 * `/checkout` — the screen that converts, and the quietest screen in Kanso.
 *
 * ## Quieter than the storefront, concretely
 *
 * The storefront has photography as its main event, chartreuse on stock badges
 * and section rules, Archivo Black at hero scale, category panels and a dark
 * brand block. Checkout has none of it: one column capped at 2xl, a single
 * `font-display` line (the page title), hairline rules where the storefront uses
 * 2px panels, one spacing step between groups against the storefront's dense
 * grid, and
 * exactly one primary action. `rg accent src/features/checkout` returns nothing —
 * the cart spends the accent on its checkout button and this page spends it on
 * nothing at all.
 *
 * Two omissions are judgement calls, not accidents:
 *
 * - **No photography in the summary.** The customer chose these things one
 *   screen ago. Thumbnails would make checkout the loudest page in the shop for
 *   a decision they are no longer making.
 * - **No shipping-method picker, no discount field.** Both are in the Stitch
 *   prototype; both are out of scope in V1 (AGENTS.md), and a control that does
 *   nothing is worse than an absent one.
 *
 * ## The order of the gates
 *
 * Loading → signed out → cart error → empty cart → stock problem → form. That
 * order matters: a signed-in customer with a full cart must never be shown a
 * sign-in button, and a signed-out visitor must never be shown an empty-cart dead
 * end that implies they lost something. An empty cart is only announced *after*
 * we know who they are, because an anonymous visitor's cart is empty by
 * definition — carts belong to accounts in V1.
 *
 * ## The round trip
 *
 * `rememberReturnTo` records `/checkout` before Google is opened, and
 * `callbackUrlFor` carries it as `?returnTo=` through the `/auth/callback` URL
 * the project already allow-lists. Both are validated as same-origin paths: the
 * value is URL input, and an open redirect on a checkout button is a phishing
 * primitive.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageShell } from '@/components/layout';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { Alert, Button, buttonClasses, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { blockingStockMessage } from '@/features/cart';
import {
  CheckoutForm,
  callbackUrlFor,
  consumeReturnTo,
  createOrder,
  OrderSummary,
  rememberReturnTo,
  SignInRequired,
} from '@/features/checkout';
import { useAuth, useCart } from '@/hooks';
import { AppError, InsufficientInventoryError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { ROUTE_PATHS } from '@/routes';
import type { Address, AddressField, FieldErrors } from '@/schemas';

export function CheckoutPage() {
  const auth = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<FieldErrors | undefined>(undefined);

  // The return intent is one-shot. Reaching checkout at all means the round trip
  // finished, so the marker is spent whether or not the callback page read it —
  // and a stale marker can never bounce somebody back here next week.
  useEffect(() => {
    consumeReturnTo();
  }, []);

  const signIn = useCallback(async (): Promise<void> => {
    logger.info({
      event: 'checkout_signin_required',
      scope: 'checkout',
      outcome: 'failure',
      returnTo: ROUTE_PATHS.checkout,
    });
    rememberReturnTo(ROUTE_PATHS.checkout);
    await auth.signInWithGoogle({ redirectTo: callbackUrlFor(ROUTE_PATHS.checkout) });
  }, [auth]);

  const placeOrder = useCallback(
    async (shipping: Address): Promise<void> => {
      setIsSubmitting(true);
      setFormError(null);
      setServerFieldErrors(undefined);
      const startedAt = Date.now();
      logger.info({
        event: 'cart_checkout_started',
        scope: 'checkout',
        itemCount: cart.itemCount,
        subtotalKobo: cart.subtotalKobo,
      });

      try {
        const result = await createOrder(shipping);
        logger.info({
          event: 'cart_checkout_succeeded',
          scope: 'checkout',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
          orderId: result.orderId,
          reference: result.reference,
          totalKobo: result.totalKobo,
          emailSent: result.emailSent,
          itemCount: cart.itemCount,
        });
        // The order is durable and the cart is closed server-side. `emailSent`
        // rides along in router state because it is not on the order row, and a
        // later visit to this URL genuinely has no value to read.
        navigate(ROUTE_PATHS.order(result.orderId), {
          replace: true,
          state: { emailSent: result.emailSent, reference: result.reference },
        });
      } catch (thrown) {
        // SPEC's inventory rule: the server names the product and the count, and
        // that sentence reaches the customer unchanged.
        const message =
          thrown instanceof InsufficientInventoryError
            ? thrown.message
            : thrown instanceof AppError
              ? thrown.message
              : 'The order could not be placed. Nothing has been charged.';
        setFormError(message);
        // A `422` names the offending fields; the form renders each one under its
        // own control rather than collapsing the whole thing into one banner.
        const fieldErrors = thrown instanceof AppError ? thrown.details?.fieldErrors : undefined;
        if (typeof fieldErrors === 'object' && fieldErrors !== null) {
          setServerFieldErrors(fieldErrors as FieldErrors);
        }
        setIsSubmitting(false);
        logger.error({
          event: 'cart_checkout_failed',
          scope: 'checkout',
          durationMs: Date.now() - startedAt,
          itemCount: cart.itemCount,
          subtotalKobo: cart.subtotalKobo,
          error: thrown instanceof AppError ? thrown : thrown,
        });
      }
    },
    [cart, navigate],
  );

  const blocked = blockingStockMessage(cart.items);
  const fullName = auth.user?.user_metadata?.full_name;

  return (
    <PageShell
      title="Checkout — Kanso"
      width="narrow"
      header={<MobileHeader backTo={ROUTE_PATHS.cart} contextLabel="Cart" />}
    >
      {/*
        PageShell's own `gap-lg` resolves to nothing: `--spacing-md`, `-lg` and
        `-xl` are not in the `@theme` block, so those utilities are never
        generated and the shell's children stack with no gap at all. This wrapper
        carries the vertical rhythm for this page rather than depending on a
        token that is not there — see `docs/CONTRACT-REQUESTS.md`.
      */}
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-heading uppercase leading-none tracking-tight text-ink">
          Checkout
        </h1>

        {auth.isLoading ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <p className="sr-only" role="status">
              Checking your session
            </p>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-2/3" />
          </div>
        ) : !auth.isAuthenticated ? (
          <SignInRequired onSignIn={signIn} />
        ) : cart.status === 'error' ? (
          <ErrorState
            title="Your cart did not load"
            error={cart.error}
            onRetry={() => {
              void cart.refresh();
            }}
          />
        ) : cart.isLoading ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <p className="sr-only" role="status">
              Loading your order
            </p>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-2/3" />
          </div>
        ) : cart.items.length === 0 ? (
          <EmptyState
            title="There is nothing to check out"
            description="Your cart is empty. Add something from the catalogue and come back."
            action={
              <Link
                to={ROUTE_PATHS.catalog}
                className={buttonClasses({ variant: 'primary', size: 'md' })}
              >
                Browse the catalogue
              </Link>
            }
          />
        ) : blocked !== null ? (
          <>
            <Alert tone="danger" title="Stock changed">
              {blocked}{' '}
              <Link to={ROUTE_PATHS.cart} className="underline underline-offset-2">
                Adjust your cart
              </Link>{' '}
              before placing this order.
            </Alert>
            <OrderSummary
              items={cart.items}
              subtotalKobo={cart.subtotalKobo}
              itemCount={cart.itemCount}
            />
          </>
        ) : (
          <>
            <OrderSummary
              items={cart.items}
              subtotalKobo={cart.subtotalKobo}
              itemCount={cart.itemCount}
            />

            <CheckoutForm
              formError={formError}
              fieldErrors={serverFieldErrors}
              onFieldEdited={(field: AddressField) => {
                setServerFieldErrors((previous) => {
                  if (previous === undefined || previous[field] === undefined) return previous;
                  const next = { ...previous };
                  delete next[field];
                  return next;
                });
              }}
              isSubmitting={isSubmitting}
              defaults={{
                ...(auth.user?.email === undefined ? {} : { email: auth.user.email }),
                ...(typeof fullName === 'string' && fullName.trim().length > 0
                  ? { fullName: fullName.trim() }
                  : {}),
              }}
              onSubmit={(shipping) => {
                void placeOrder(shipping);
              }}
              action={
                <div className="flex flex-col gap-3 border-t border-hairline pt-5">
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    type="submit"
                    loading={isSubmitting}
                  >
                    Place order
                  </Button>
                  <p className="text-xs leading-5 text-ink-subtle">
                    Placing the order reserves your items. No payment is taken in this version.
                  </p>
                </div>
              }
            />
          </>
        )}
      </div>
    </PageShell>
  );
}
