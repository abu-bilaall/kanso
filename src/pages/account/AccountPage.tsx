/**
 * `/account`.
 *
 * Three surfaces behind one route, because `useAuth` says there are three
 * things that can be true and collapsing them loses information the reader needs:
 *
 *   `loading`     a skeleton. Never a sign-in button — flashing one at somebody
 *                 who is already signed in is the classic OAuth bug.
 *   `anonymous`   the sign-in surface. If the session went away mid-visit, that
 *                 is said in as many words before the sign-in button appears.
 *   `error`       the session could not be read at all, which is a different
 *                 problem with a different fix and is not the same as signed out.
 *
 * Signed in, it is the profile and the order history. The orders belong to
 * `useOrders`; the profile to `useProfile`, which degrades to the Google
 * account when the `profiles` row is not there yet.
 *
 * ## Sign-out
 *
 * Sign-out is a button here and not a rail item, because it acts on this
 * account and nowhere else. It tells `useSessionExpiry` that the session drop is
 * expected, so the page can tell "you signed out" apart from "your session
 * expired" — and it says so even when the sign-out call itself fails.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { OrderHistory, ProfileCard, SignInCard } from '@/components/account';
import { PageShell } from '@/components/layout';
import { Alert, Button, buttonClasses, ErrorState, Skeleton } from '@/components/ui';
import { useProfile, useSessionExpiry } from '@/features/auth';
import { useAuth, useOrders } from '@/hooks';
import { type AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { ROUTE_PATHS } from '@/routes';

export function AccountPage() {
  const { error: authError, isAuthenticated, refresh, signOut, status, user } = useAuth();
  const orders = useOrders();
  const profile = useProfile();
  const { cancelSignOut, expectSignOut, expired } = useSessionExpiry();
  const navigate = useNavigate();

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<AppError | null>(null);

  async function handleSignOut(): Promise<void> {
    expectSignOut();
    setSigningOut(true);
    setSignOutError(null);

    const startedAt = Date.now();
    const context = {
      scope: 'auth',
      durationMs: Date.now() - startedAt,
      userId: user?.id ?? null,
      destination: ROUTE_PATHS.home,
    };

    try {
      await signOut();
      logger.info({ event: 'auth_signed_out', ...context, outcome: 'success' });
      navigate(ROUTE_PATHS.home, { replace: true });
    } catch (thrown) {
      const failure = toAppError(thrown, 'Could not sign you out');
      logger.error({ event: 'auth_signed_out', ...context, outcome: 'failure', error: failure });
      cancelSignOut();
      setSignOutError(failure);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <PageShell title="Account — Kanso" width="default">
      {status === 'loading' ? <AccountSkeleton /> : null}

      {status === 'error' ? (
        <ErrorState
          title="We could not read your session"
          error={authError}
          onRetry={() => {
            void refresh();
          }}
          action={
            <Link to={ROUTE_PATHS.catalog} className={buttonClasses({ variant: 'outline' })}>
              Back to the shop
            </Link>
          }
        />
      ) : null}

      {status === 'anonymous' ? (
        <div className="flex flex-col gap-6">
          {expired ? (
            <Alert tone="warning" title="Your session expired">
              You were signed in and the session ran out. Sign in again to pick up where you left
              off — your cart and your orders are still here.
            </Alert>
          ) : null}
          <SignInCard
            headingId="account-sign-in-heading"
            title={expired ? 'Sign in again' : undefined}
            description={
              expired
                ? 'Your orders, addresses and cart are exactly where you left them.'
                : undefined
            }
          />
        </div>
      ) : null}

      {isAuthenticated ? (
        <div className="flex flex-col gap-lg">
          <header className="flex flex-col gap-1">
            <span className="font-editorial text-meta uppercase tracking-wider text-ink-subtle">
              Account
            </span>
            <h1 className="font-display text-heading uppercase leading-tight tracking-tight text-ink">
              {profile.displayName ?? 'Your account'}
            </h1>
          </header>

          <ProfileCard profile={profile} />
          <OrderHistory orders={orders} />

          <div className="flex flex-col gap-3 border-t border-hairline pt-lg sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-prose text-sm leading-6 text-ink-muted">
              Signing out keeps your cart. Sign in again whenever you need it.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void handleSignOut();
              }}
              loading={signingOut}
              disabled={signOutError !== null}
            >
              Sign out
            </Button>
          </div>

          {signOutError === null ? null : (
            <Alert tone="danger" title="Sign-out failed">
              {signOutError.message}
            </Alert>
          )}
        </div>
      ) : null}
    </PageShell>
  );
}

function AccountSkeleton() {
  return (
    <section aria-busy className="flex flex-col gap-lg">
      <span className="sr-only" role="status">
        Loading your account
      </span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-[86px] w-full" />
      <Skeleton className="h-32 w-full" />
    </section>
  );
}
