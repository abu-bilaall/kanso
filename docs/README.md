# Kanso documentation

Kanso was built by six agents working in parallel against a contract frozen up
front, which leaves two very different kinds of document behind. Some describe
how the system works **now**. Others are the record of a decision someone had to
make along the way.

This page is the map, and it says which is which. If you are here to change the
application, read the first table and stop.

---

## Current guidance

Follow these. They describe the code as it is.

| Document | What it is |
| --- | --- |
| [`../README.md`](../README.md) | Setup, environment variables, every command, how to deploy. Start here. |
| [`../SPEC.md`](../SPEC.md) | Technical requirements and the verification list. |
| [`../DESIGN.md`](../DESIGN.md) | Product, brand and UI direction. The visual source of truth. |
| [`../AGENTS.md`](../AGENTS.md) | Working rules for agents and contributors. |
| [`DATA-MODEL.md`](./DATA-MODEL.md) | Tables, columns, constraints, indexes, triggers, RLS policies, migrations, seed. The database, exactly as built. |
| [`LOGGING.md`](./LOGGING.md) | The six logging rules, the API, and the canonical event vocabulary. Binding: if a convention is not here, it is not a convention. |
| [`../supabase/functions/create-order/README.md`](../supabase/functions/create-order/README.md) | The Edge Function's wire contract — request, success, every failure status, and the environment table. Authoritative for the HTTP surface. |

## Reference, accurate but historical

Still true of the code. Written for the parallel build, so the parts that were
only ever true *during* the build are marked as such.

| Document | What it is |
| --- | --- |
| [`CONTRACTS.md`](./CONTRACTS.md) | The frozen surface Phase 1 fixed: tokens, component vocabulary, `PageShell`, the route table, hooks, money, errors, schemas. The **API shapes are still the contract**. A handful of statements about the state of the world *at the time* are now stale and are called out inline — most importantly § *Placeholder pages*, which is history. |

## Resolved request logs

Decisions, not instructions. Nothing here is a rule you follow; it is why the
code is the way it is. Read them when you want to know why something is the way
it is, or before you propose changing a frozen surface.

| Document | What it is |
| --- | --- |
| [`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md) | The integration-owned change log for the frozen files. Resolution tables at the top; the original request text below, left intact so the reasoning survives. Fourteen requests, all actioned or deliberately declined — the last two closed on `chore/integration-3`. |
| [`CART-CHECKOUT.md`](./CART-CHECKOUT.md) | A5's five requests against the frozen surface. All five are now resolved — see the table at the top. Kept because § 1 records a real bug that was found and fixed, and § 5 records a product decision. |

Nothing was deleted to produce this split. Every document that existed before
still exists, at the same path, because roughly twenty source files reference
them by path in comments.

---

## Known gaps

Not documentation problems — things that are genuinely not done. Listed so
nobody discovers them at launch. Re-checked at `chore/integration-3`.

1. **Four products have no photograph.** A3's pipeline landed and
   `product-images/manifest.json` holds 6 of the 10 seeded products, so
   `graphite-desk-pad`, `oak-pen-cup`, `canvas-messenger-bag` and
   `technical-fountain-pen` render the neutral panel instead of a photograph.
   The other six resolve, and every derivative is committed under
   `apps/web/public/product-images/` and served in a built bundle. Closing this needs four
   more masters, not code.
2. **The OAuth redirect allow-list does not match any real origin.**
   `supabase/config.toml` lists `https://127.0.0.1:3000`; the app sends
   `${window.location.origin}/auth/callback`, which is
   `http://localhost:5173/auth/callback` locally and
   `https://<site>.netlify.app/auth/callback` in production. Those go in the
   Supabase dashboard and the Google console. See the README.
3. **Not yet deployed.** No Netlify site is connected and `create-order` has not
   been deployed to the remote project. Both need credentials this repository
   does not have.

**Closed on `chore/integration-3`:** `max-w-<name>` no longer resolves against
`--spacing-<name>` — the Kanso scale is `k-` namespaced, so `max-w-sm` is 24rem
([`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md) § 10) — and the catch-all route
renders a real not-found page instead of the build-state placeholder.

## Where the deploy lives

There is no `docs/DEPLOYMENT.md`. Deployment instructions are in the
[README](../README.md) and only there — a second copy in this directory would be
a second thing to keep in step, and the first one to go stale.