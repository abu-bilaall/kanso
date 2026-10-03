/**
 * SignInCard.
 *
 * The sign-in surface. Deliberately the smallest thing that works: the
 * wordmark, one heading, one sentence of purpose, one button.
 *
 * It is not a landing page. DESIGN.md's storefront gets the personality; this
 * screen exists because somebody needs an account, and every extra element is
 * a reason to hesitate. No feature list, no testimonial, no second action to
 * compare the first against.
 *
 * The chartreuse accent is spent here and nowhere else on the view — one use
 * per view is the rule, and the primary action is what it is for.
 */

import type { ReactNode } from 'react';
import { ROUTE_PATHS } from '@/routes';
import { GoogleSignInButton } from './GoogleSignInButton';
import { Wordmark } from './Wordmark';

export interface SignInCardProps {
  /** Where the round trip should end up. Defaults to `/account`. */
  destination?: string;
  /** Overridden when the reader is returning after a session ended. */
  title?: string;
  description?: ReactNode;
  /** Id for the heading, so two surfaces on one route cannot collide. */
  headingId?: string;
}

export function SignInCard({
  destination = ROUTE_PATHS.account,
  title = 'Sign in to Kanso',
  description = 'Your orders, addresses and cart follow you once you are signed in.',
  headingId = 'sign-in-heading',
}: SignInCardProps) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <Wordmark height={40} label="Kanso" />

      <div className="flex flex-col gap-2 border-t border-hairline pt-6">
        <span className="font-editorial text-meta uppercase tracking-wider text-ink-subtle">
          Account / Sign in
        </span>
        <h1
          id={headingId}
          className="font-display text-heading uppercase leading-tight tracking-tight text-ink"
        >
          {title}
        </h1>
        <p className="max-w-prose text-body leading-6 text-ink-muted">{description}</p>
      </div>

      {/* The measure for a control column. `max-w-sm` is Tailwind's 24rem here,
          because the Kanso spacing scale is namespaced `k-`; see
          `src/styles/tokens.css` and `tests/unit/styles/containerWidths.test.ts`. */}
      <div className="max-w-sm">
        <GoogleSignInButton destination={destination} />
      </div>

      <p className="max-w-prose text-sm leading-6 text-ink-subtle">
        Kanso signs you in through Google. We never see or store a password.
      </p>
    </section>
  );
}
