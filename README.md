# Kanso

A small independent shop for considered tools and accessories for focused work.
V1 is one complete vertical slice — **browse → authenticate → cart → checkout →
persist order → confirmation email → confirmation** — for roughly ten products
across Desk, Carry and Write.

TypeScript + React 19 + Vite on the front, Supabase (Postgres, Auth, Storage,
Edge Functions) behind it, Netlify hosting, Mailgun for the confirmation email.

- Product and design specification: [`DESIGN.md`](./DESIGN.md)
- Technical specification: [`SPEC.md`](./SPEC.md)
- Documentation map: [`docs/README.md`](./docs/README.md)
- Agent and contributor rules: [`AGENTS.md`](./AGENTS.md)

---

## Prerequisites

| | |
| --- | --- |
| Node.js | 22 or newer (`package.json` `engines.node`). CI and Netlify both pin **24**. |
| npm | Ships with Node. `npm ci` is used everywhere, so the lockfile is authoritative. |
| Docker | Required. The Supabase local stack, the functional suite and the whole CI job run in containers. Check `docker info` first — a stopped Docker daemon produces connection errors that look like application bugs. |
| Supabase CLI | On your `PATH`; the project pins no version, so use a recent 2.x. |
| A Google account | Only for exercising Google sign-in locally. The suite never needs it. |

No global install of anything else. Do not add npm's `allow-scripts` setting —
see [Rules for contributors](#rules-for-contributors).

---

## Local setup

The order matters. `npm run dev` will boot against a Supabase project that does
not exist yet and fail in a way that looks like a configuration problem rather
than a missing database.

```bash
git clone https://github.com/abu-bilaall/kanso.git
cd kanso
npm ci
cp .env.example .env.local        # then fill in the two values below

supabase start                    # boots the local stack — FIRST, before anything else
npm run db:reset                  # applies every migration, then the seed
npm run dev                       # http://localhost:5173
```

- `supabase start` takes a minute the first time. It is also `npm run db:start`.
- `supabase/config.toml` pins `project_id = "kanso"` and API port `54321` on
  purpose: every Kanso worktree on this machine shares one local stack. Do not
  change either value.
- The dev server is on **5173** (`apps/web/vite.config.ts`); the Supabase API is on
  **54321**, Postgres on **54322**, Studio on **54323**, Mailpit on **54324**.
- Stop everything with `npm run db:stop`.

`.env.local` needs exactly two values locally, and the stack already knows both:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

`npm run db:status` prints the current stack's keys if you need them.

`npm run db:functions` is **not** part of the startup order — it is a blocking
server you only start when you are exercising `create-order` yourself, and it
needs `supabase/.env.local` to exist first. See
[Edge Function, locally](#edge-function-locally).

---

## Environment variables

Two groups, and they are not interchangeable.

### Browser-safe

These two are the only values that ever reach the browser. Vite inlines anything
prefixed `VITE_` into the public bundle, so **only the publishable key belongs
here** — a service-role or secret key in a `VITE_` variable ships it to every
visitor. `apps/web/src/lib/supabase.ts` asserts at module load that no secret credential
is present and throws if one is.

| Variable | Where it is set | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local` locally; Netlify UI for deploys | Project URL. `http://127.0.0.1:54321` locally, `https://<project-ref>.supabase.co` remotely. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local` locally; Netlify UI for deploys | The `sb_publishable_…` key. Publishable by design. |

### Edge Function secrets

These belong to the `create-order` Edge Function. They are read server-side
only. **No browser code references them and no repository file contains them.**

Set them in the Supabase dashboard: **Project Settings → Edge Functions →
Secrets**. Locally, they go in `supabase/.env.local`, which is gitignored and
read by `npm run db:functions`.

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | **Injected automatically by the Edge runtime.** The `SUPABASE_` prefix is reserved — you cannot set it yourself. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side only. Never a `VITE_` variable, never in the bundle. |
| `MAILGUN_API_KEY` | for email | Mailgun → Sending → domain settings. Starts with `key-`. Missing it still creates the order, with `emailSent: false`. |
| `MAILGUN_DOMAIN` | for email | Bare hostname — no scheme, no trailing slash. `mg.example.com`, not `https://mg.example.com/`. |
| `MAILGUN_FROM` | for email | `Kanso <orders@yourdomain.com>` |
| `APP_URL` | no | Public origin, e.g. `https://kanso.netlify.app`. Adds an order link to the email. |
| `MAILGUN_API_BASE` | no | Defaults to `https://api.mailgun.net/v3`. EU accounts need `https://api.eu.mailgun.net/v3`. |

The full wire contract, including what each failure status means, is in
[`supabase/functions/create-order/README.md`](./supabase/functions/create-order/README.md).

---

## Database

Six migrations in `supabase/migrations/`, applied in filename order, and one
seed file at `supabase/seed.sql` (ten products). The authoritative description is
[`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md).

```bash
npm run db:start      # supabase start    — boot the local stack
npm run db:reset      # supabase db reset — drop, re-apply every migration, re-seed
npm run db:status     # supabase status   — connection values and service health
npm run db:stop       # supabase stop     — shut the stack down
```

**To write a migration:** add a new timestamped file to `supabase/migrations/`.
Never edit a migration that has already been applied — `supabase db reset`
replays the directory from scratch, so a changed file is a changed history.

**To change the catalogue:** edit `supabase/seed.sql` and run `npm run db:reset`.
The seed upserts on `slug`, so it is safe to re-run.

`npm run db:reset` is destructive by design. It is what CI runs, which is the
point: CI and your machine build the database the same way, so the two cannot
drift.

---

## Edge Function, locally

```bash
npm run db:start        # only if the stack is not already up
npm run db:functions    # supabase functions serve create-order --env-file supabase/.env.local
```

`db:functions` blocks until you stop it. It fails immediately if
`supabase/.env.local` is missing (`node: supabase/.env.local: not found`), so
create that file first — it is gitignored, and it takes the Mailgun and `APP_URL`
values from the table above. Local placeholder values are fine; nothing is
really delivered.

The function requires a real Supabase access token to exercise, which means a
signed-in user; create one through the admin API and sign in with the password
grant to get a token.

---

## Checks and tests

```bash
npm run typecheck       # tsc -b
npm run check           # biome check (format + lint)
npm run check:fix       # biome check --write
npm run check:classes   # audit: utility classes used in apps/web/src/ that Tailwind emits nothing for
npm run test:unit       # 272 tests. jsdom. No Docker, no network, no stack.
npm run test:func       # 35 tests against the local stack. NEEDS THE STACK RUNNING.
npm run ci:check        # typecheck + check + test:unit. What CI runs before the functional suite.
npm test                # vitest run — both projects. Read the warning below.
npm run build           # tsc -b && vite build, into apps/web/dist/
```

`npm run test:func` finds the local stack itself and **fails loudly** if it
cannot. If you see its help block instead of test results, run `npm run db:start`
and try again. There is no `eval "$(supabase status -o env)"` incantation
anywhere and there should never be one — the CLI prints bare `KEY="value"` lines
with no `export`, so `eval` sets shell variables that never reach the test
process, and the suite skips itself and reports green while verifying nothing.
`scripts/functional-env.mjs` exists to make that failure mode impossible.

`npm run check:classes` is a separate local guard, not part of `ci:check`. It
compiles the real stylesheet and fails on any class name `apps/web/src/` uses for which
Tailwind generates nothing — the failure mode where a class silently does
nothing.

**`npm test` is not the everyday command.** It is a bare `vitest run`, so it
drives the functional project directly, which requires `API_URL`,
`PUBLISHABLE_KEY` and `SECRET_KEY` to already be in the environment. Without
them the functional project fails at setup — by design, so it can never report
green having run nothing. Use `npm run test:unit` and `npm run test:func`, which
is what CI does.

---

## Deploying the frontend

The build config is committed in [`netlify.toml`](./netlify.toml): base
`apps/web`, `npm run build`, publish `dist` (which Netlify resolves against the
base, so it is `apps/web/dist`), and a rewrite of `/*` to `/index.html` so
client-side routes survive a hard refresh. Nothing secret is in that file.

To deploy, in the Netlify UI:

1. **Add new site → Import an existing project** and connect
   `https://github.com/abu-bilaall/kanso`.
2. Leave build command, publish directory and Node version as they are — the
   repo pins all three.
3. **Site configuration → Environment variables** and set exactly two:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key from the Supabase dashboard |

   Nothing else. If a third variable appears, it is wrong.

Netlify builds on every push to the connected branch and gives you a deploy
preview; the production URL is whatever the site is named.

## Deploying the Edge Function

**Manual, on purpose.** CI does not deploy it, so CI never needs the Mailgun
credentials and the workflow needs no secrets at all. Deploy by hand, after the
migrations are on the remote project:

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy create-order --project-ref <project-ref>
```

Then set the secrets in the Supabase dashboard (the table above), and — in the
same dashboard, under **Authentication → URL Configuration** — make sure the
allow-list contains the app origin's callback:

```
http://localhost:5173/auth/callback     ← local development
https://<your-site>.netlify.app/auth/callback   ← production
```

The app sends `${window.location.origin}/auth/callback` as the OAuth redirect.
Google needs the same URIs under **Authentication → Providers → Google →
Authorized redirect URIs**, or sign-in fails after the provider redirect.
`supabase/config.toml` currently lists `https://127.0.0.1:3000`, which matches
neither the Vite dev origin nor a Netlify origin; the production allow-list
lives in the dashboard, not in that file.

---

## CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every push and
pull request: `supabase start`, `supabase db reset`, `npm ci`,
`npm run ci:check`, `npm run test:func`.

It needs **no secrets, no environment, and nothing a maintainer has to click
through.** The values the functional suite uses are local dev credentials the
job itself created two steps earlier.

The load-bearing line is `supabase db reset`: CI applies migrations and seed
through the same CLI and the same `supabase/config.toml` a developer uses, so
the database CI exercises cannot drift from the database you run against.

---

## Rules for contributors

- **No force-pushing**, to any branch. **No pushes to `main`** — open a branch and
  a pull request.
- **Never commit `.env`, `.env.*` or `supabase/.env.local`.** `.env.example` is the
  only environment file in the repository and its values are empty.
- **Never commit a service-role key, a Mailgun key, or any token**, and never put
  one in a `VITE_` variable. The browser cannot be trusted with prices, totals,
  inventory or user IDs, and a leaked service-role key bypasses every Row Level
  Security policy in the database.
- **Do not set npm's `allow-scripts`.** npm 12 blocks install scripts by default
  and that is deliberate. The only install script this tree triggers is
  `esbuild`'s postinstall, it is blocked, and `npm run ci:check` and
  `npm run build` are both green anyway — `esbuild` ships prebuilt binaries.
  Allowing scripts weakens the install posture for no benefit.
- **Do not disable Row Level Security** to make a query work, and do not add an
  Edge Function deploy step to CI.
- **Use Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`).
- **Run the checks yourself** before you ask anyone to review: `npm run typecheck`,
  `npm run check`, `npm run test:unit`, and `npm run test:func` if you touched
  anything the database or the Edge Function can see. Ask before installing a
  dependency, before deleting a file, and before committing, pushing or opening
  a pull request.
- **Do not rewrite `DESIGN.md` or `SPEC.md`.** If the implementation deliberately
  diverged from one of them, say so in the pull request.

---

## Documentation

[`docs/README.md`](./docs/README.md) is the map, and it marks which documents
are current guidance and which are historical records of decisions.