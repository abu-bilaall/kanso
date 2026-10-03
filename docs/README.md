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
| [`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md) | The integration-owned change log for the frozen files. Resolution tables at the top; the original request text below, left intact so the reasoning survives. Eleven requests, all actioned or deliberately declined, plus two still-open ones at § 10 and the `AuthCallbackPage` note. |
| [`CART-CHECKOUT.md`](./CART-CHECKOUT.md) | A5's five requests against the frozen surface. All five are now resolved — see the table at the top. Kept because § 1 records a real bug that was found and fixed, and § 5 records a product decision. |

Nothing was deleted to produce this split. Every document that existed before
still exists, at the same path, because roughly twenty source files reference
them by path in comments.

---

## Known gaps as of `chore/deploy-docs`

Not documentation problems — things that are genuinely not done. Listed so
nobody discovers them at launch.

1. **No product photographs.** `product-images/manifest.json` is still
   `{ "version": 1, "products": {} }` and `product-images/_masters/` is empty, so
   every product renders a neutral placeholder instead of a photograph.
   `DESIGN.md` calls product photography a major visual element and `SPEC.md`
   requires images in Supabase Storage. This is the media agent's work and it
   never landed. Note the follow-on problem before filling the manifest: the
   manifest's `webp` / `jpeg` values are repo-relative strings
   (`product-images/desk/…`), Vite does not rewrite strings inside imported
   JSON, and Netlify publishes only `dist/`. The derivatives have to land
   somewhere the bundle actually serves from, or every image 404s on deploy.
2. **`max-w-<name>` resolves against `--spacing-<name>`.** Tailwind v4 looks up
   `--container-<name>` *and* `--spacing-<name>`; `src/styles/tokens.css`
   declares the spacing scale, so `max-w-sm` resolves to `8px` instead of
   `24rem` and the named widths are unusable. Fully written up in
   [`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md) § 10. `npm run check:classes`
   cannot see it because the class does generate a rule, just with the wrong
   value.
3. **The OAuth redirect allow-list does not match any real origin.**
   `supabase/config.toml` lists `https://127.0.0.1:3000`; the app sends
   `${window.location.origin}/auth/callback`, which is
   `http://localhost:5173/auth/callback` locally and
   `https://<site>.netlify.app/auth/callback` in production. Those go in the
   Supabase dashboard and the Google console. See the README.
4. **Not yet deployed.** No Netlify site is connected and `create-order` has not
   been deployed to the remote project. Both need credentials this repository
   does not have.

## Where the deploy lives

There is no `docs/DEPLOYMENT.md`. Deployment instructions are in the
[README](../README.md) and only there — a second copy in this directory would be
a second thing to keep in step, and the first one to go stale.