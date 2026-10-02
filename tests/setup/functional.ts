/**
 * Functional test setup.
 *
 * This file either produces a usable connection or aborts the run. It never
 * leaves the suite in a state where it reports success without having asserted
 * anything — see `tests/functional/connection.ts` for the decision and
 * `scripts/functional-env.mjs` for the runner that fills the environment in.
 *
 * `npm run test:func` obtains the values itself (from the environment, or by
 * parsing `supabase status -o env`, or by failing with an explanation), so a
 * developer does not need to know the `eval` incantation and CI does not need
 * any at all. Running `vitest run --project functional` directly still works as
 * long as the values are in the environment.
 */

import { requireConnection } from '../functional/connection';

/**
 * `process` is declared in `tests/types/node-shim.d.ts` rather than by adding
 * `@types/node`: the browser app has no legitimate use for the Node type
 * surface, and `@types/node` is not a pre-approved dependency.
 */

/** Throws, and so fails the whole functional run, when this is not configured. */
export const connection = requireConnection(process.env);
