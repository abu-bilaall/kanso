/**
 * Where the OAuth round trip should continue to.
 *
 * The destination is written by whoever sent the reader here — checkout writes
 * `/checkout` before it opens Google — and read back here. The convention is
 * A5's, not this feature's: `src/features/checkout/returnIntent.ts` owns the
 * `?returnTo=` parameter, the one-shot `sessionStorage` marker and the
 * same-origin check, and both halves of the round trip go through it so there is
 * exactly one of each. This module is the reader.
 *
 * Order matters and is A5's: the URL first, because a shared callback link
 * should carry its own destination; the stored marker second, because it is the
 * channel that survives a provider that drops the query string; `/account`
 * last, because a callback nobody sent anywhere still has to land somewhere
 * sensible.
 *
 * ## Why this is not a `useMemo`
 *
 * Reading the marker **consumes** it. React renders a component twice in
 * development, and StrictMode does it on purpose, so a memo that resolved once
 * and discarded the answer would put `/checkout` on screen and then throw it
 * away — landing on `/account` instead, in development only. That is precisely
 * the kind of bug that ships, because development is the one place nobody files
 * it. `useAuthCallback` therefore resolves once per distinct `search` and holds
 * the answer, rather than re-deriving it.
 *
 * ## Why `ROUTE_PATHS` is read inside the function
 *
 * `src/routes.ts` imports every page module, and those import the components
 * that import this. Reading `ROUTE_PATHS.account` at module scope therefore
 * evaluates it while the cycle is still open, and gets `undefined` — which is a
 * `TypeError` in every suite that imports a page. Read inside the call, after
 * every module has initialised, it is just a constant lookup.
 */

import { consumeReturnTo, isSafeReturnTo } from '@/features/checkout/returnIntent';
import { ROUTE_PATHS } from '@/routes';

/**
 * Query parameter carrying the destination through the round trip.
 *
 * Written by `callbackUrlFor` in `returnIntent.ts`, which keeps the literal to
 * itself; this is the read side of that same parameter.
 */
const RETURN_TO_PARAM = 'returnTo';

/**
 * The destination for this callback, in A5's order of preference.
 *
 * Consumes the stored marker as a side effect, which is why the caller must hold
 * on to the result rather than re-derive it — see the module note.
 */
export function readDestination(search: string): string {
  const fromUrl = new URLSearchParams(search).get(RETURN_TO_PARAM);
  if (isSafeReturnTo(fromUrl)) return fromUrl;
  return consumeReturnTo() ?? ROUTE_PATHS.account;
}
