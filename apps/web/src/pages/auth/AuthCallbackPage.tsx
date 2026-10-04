/**
 * `/auth/callback`.
 *
 * The screen most likely to fail, so it is written as four states rather than
 * one that renders when things go well. Which state it is in, and what the
 * screen says about it, comes entirely from `useAuthCallback` — this file is
 * markup, not logic.
 *
 * The one decision worth stating: **declining consent is not a failure.** A
 * reader who pressed "Cancel" on Google's screen did something ordinary, and
 * the panel they get says so in ordinary words and offers both a way to try
 * again and a way back to the shop. Nothing is red, nothing apologises.
 *
 * The destination survives the round trip in A5's convention — `?returnTo=` on
 * the callback URL, with the one-shot `sessionStorage` marker behind it, both
 * read by `readDestination` in `@/features/auth`. So somebody sent here from
 * checkout walks back into checkout rather than landing on the account page and
 * wondering what happened to their cart.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GoogleSignInButton, Wordmark } from '@/components/account';
import { PageShell } from '@/components/layout';
import { buttonClasses, Skeleton } from '@/components/ui';
import {
  CALLBACK_ERROR_BODIES,
  CALLBACK_ERROR_TITLES,
  type CallbackState,
  useAuthCallback,
} from '@/features/auth';
import { ROUTE_PATHS } from '@/routes';

export function AuthCallbackPage() {
  const { state } = useAuthCallback();

  return (
    <PageShell title="Signing in — Kanso" width="narrow">
      {state.status === 'pending' ? <PendingPanel /> : null}
      {state.status === 'success' ? <SuccessPanel state={state} /> : null}
      {state.status === 'denied' ? <DeniedPanel state={state} /> : null}
      {state.status === 'error' ? <FailurePanel state={state} /> : null}
    </PageShell>
  );
}

/** Wordmark, the mono eyebrow, the heading — the same frame in all four states. */
function Frame({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section aria-labelledby="callback-heading" className="flex flex-col gap-6">
      <Wordmark height={32} label="Kanso" />

      <div className="flex flex-col gap-2 border-t border-hairline pt-6">
        <span className="font-editorial text-meta uppercase tracking-wider text-ink-subtle">
          Auth / Callback
        </span>
        <h1
          id="callback-heading"
          className="font-display text-heading uppercase leading-tight tracking-tight text-ink"
        >
          {heading}
        </h1>
      </div>

      {children}
    </section>
  );
}

function BackToShop() {
  return (
    <Link to={ROUTE_PATHS.catalog} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
      Back to the shop
    </Link>
  );
}

/** The way on again, followed by the way out. Every terminal state offers both. */
function Recovery({ destination }: { destination: string }) {
  return (
    <div className="flex max-w-sm flex-col items-start gap-3">
      <GoogleSignInButton destination={destination} label="Try again" />
      <BackToShop />
    </div>
  );
}

function PendingPanel() {
  return (
    <Frame heading="Finishing your sign-in">
      <p className="max-w-prose text-body leading-6 text-ink-muted">
        One moment — we are confirming the account Google sent you back with.
      </p>
      <div aria-busy className="flex flex-col gap-2">
        <span role="status" className="sr-only">
          Waiting for your sign-in to complete.
        </span>
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <BackToShop />
    </Frame>
  );
}

function SuccessPanel({ state }: { state: Extract<CallbackState, { status: 'success' }> }) {
  return (
    <Frame heading="You are signed in">
      <div role="status" className="flex flex-col gap-2">
        <p className="max-w-prose text-body leading-6 text-ink-muted">Continuing in a moment.</p>
        <span className="font-editorial text-meta uppercase tracking-wider text-ink-subtle">
          Next / {state.destination}
        </span>
      </div>
      {/* The onward hop is on a short timer. This is the way through for anyone
          who would rather not wait for it. */}
      <div>
        <Link to={state.destination} className={buttonClasses({ variant: 'outline' })}>
          Continue now
        </Link>
      </div>
    </Frame>
  );
}

function DeniedPanel({ state }: { state: Extract<CallbackState, { status: 'denied' }> }) {
  return (
    <Frame heading="Sign-in cancelled">
      <p className="max-w-prose text-body leading-6 text-ink-muted">
        You chose not to continue at Google, so nothing was signed in. That is entirely fine — the
        shop is still here, and your cart will be waiting when you are ready.
      </p>
      <Recovery destination={state.destination} />
    </Frame>
  );
}

function FailurePanel({ state }: { state: Extract<CallbackState, { status: 'error' }> }) {
  return (
    <Frame heading={CALLBACK_ERROR_TITLES[state.code]}>
      <p className="max-w-prose text-body leading-6 text-ink-muted">
        {CALLBACK_ERROR_BODIES[state.code]}
      </p>
      {state.detail === null ? null : (
        <p className="max-w-prose text-sm leading-6 text-ink-subtle">{state.detail}</p>
      )}
      <Recovery destination={state.destination} />
    </Frame>
  );
}
