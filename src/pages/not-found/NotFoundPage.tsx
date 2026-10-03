/**
 * The not-found page — what a mistyped or stale URL renders.
 *
 * This used to be the shared `Placeholder`, so a stranger who mistyped `/shope`
 * was told "Not built yet" and "Owned by nobody — it is not a real surface":
 * our build state, in our build voice, on a storefront. Scaffolding language is
 * for the people writing the code. A visitor gets a sentence about their URL
 * and a way back into the shop.
 *
 * ## Why it is its own page rather than `EmptyState` or `ErrorState`
 *
 * Both of those are true statements about data. `EmptyState` says the request
 * succeeded and there is nothing here; `ErrorState` says a request failed and
 * offers a retry. A URL that matched no route is neither — nothing was
 * requested and nothing failed, so there is no retry to offer and no empty list
 * to explain. What the visitor needs is a way out, so both links are navigation.
 *
 * ## The chrome is not rebuilt here
 *
 * `PageShell` owns the rail, the mobile header, the tab bar and the skip link,
 * so this screen looks like the rest of the shop on a phone and on a desktop,
 * and a not-found URL is still reachable by keyboard and by back button.
 */

import { Link } from 'react-router-dom';
import { ArrowForwardIcon } from '@/components/icons';
import { PageShell } from '@/components/layout';
import { buttonClasses } from '@/components/ui';
import { ROUTE_PATHS } from '@/routes';

export function NotFoundPage() {
  return (
    <PageShell title="Page not found — Kanso" width="narrow">
      <section className="flex flex-col items-start gap-4 rounded-component border-hard border-hairline bg-surface-lowest p-6 md:p-10">
        <p className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
          Error / 404
        </p>

        <h1 className="font-display text-heading uppercase leading-none tracking-tight text-ink md:text-hero">
          This page does not exist
        </h1>

        <p className="max-w-prose text-body leading-6 text-ink-muted">
          The address may have a typo in it, or the page may have moved since the link was made.
          Nothing is wrong with your cart or your account.
        </p>

        <div className="flex w-full flex-col gap-2 pt-2 sm:flex-row">
          <Link
            to={ROUTE_PATHS.catalog}
            className={`${buttonClasses({ variant: 'primary', size: 'lg', fullWidth: true })} sm:w-auto`}
          >
            Browse the catalogue
            <ArrowForwardIcon size={18} />
          </Link>
          <Link
            to={ROUTE_PATHS.home}
            className={`${buttonClasses({ variant: 'outline', size: 'lg', fullWidth: true })} sm:w-auto`}
          >
            Back to the store
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
