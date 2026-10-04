# Kanso — what this project actually taught me

A field guide written after building Kanso: a small shop that sells ten products, takes
Google sign-in, and completes a purchase by email confirmation.

The code is the proof. Every claim below points at a file so you can verify it yourself
rather than take my word. Read the file *after* the paragraph, not instead of it.

---

## How the whole thing fits together

One request, end to end. Learn this shape first — everything else hangs off it.

```
browser ──> Supabase PostgREST ──> Postgres (RLS decides what's readable)
   │
   └──> Edge Function (create-order) ──> Postgres
                │
                └──> Mailgun API ──> the customer's inbox
```

Two rules made this safe, and they are the whole architecture:

1. **The browser is never trusted.** Prices, totals and user identity are always
   recomputed server-side from the database.
   → `supabase/functions/_shared/create-order.ts`
2. **The database is the authority.** Row Level Security means a signed-in user can only
   ever read their own cart and orders, even if the frontend code is malicious.
   → `supabase/migrations/20261002090100_row_level_security.sql`

---

## 1. What is OAuth?

**OAuth is a permission system that lets a website act on your behalf without ever
holding your password.**

The problem it solves. To sign in with Google, Kanso needs proof you own
`gmailer@gmail.com`. The naive option — Google hands Kanso your password — means a
breach of Kanso leaks Google accounts for millions of people. Nobody accepts that.

The solution. Three parties:

| Party | Role |
|---|---|
| **The user** | Signs in to Google. Google knows who they are. |
| **Kanso (client)** | Wants a signed-in session. Never sees the password. |
| **Google (authorization server)** | The only party that checks the password. |

Kanso says to Google: *"let this person in."* Google shows its own login page — on
Google's domain, not ours. The user consents. Google then hands Kanso a short-lived
**authorization code**, and Kanso exchanges it for a **token**.

> **Analogy.** A hotel key card. You check in at reception and hand over your ID. The
> receptionist gives you a card that opens specific doors for three days. You never lend
> anyone your ID, and the receptionist keeps a log of which doors you opened. The card
> *is* the token; the receptionist *is* the authorization server.

**The key property:** tokens are scoped and revocable. A Kanso token is useless to
Twitter, and revoking one session doesn't touch the user's password. OAuth replaces
"share your password forever" with "borrow a specific capability, for a while."

### What Google OAuth adds

Google is an **OAuth 2.0 provider**. "Sign in with Google" on a website is OAuth 2.0 plus
a specific Google configuration. There's nothing exotic about using Google as the
provider — it's the same protocol as any other.

### Other OAuth providers

They're all the same protocol with a different login page and a different logo.

| Provider | Common use |
|---|---|
| Google | Consumer sign-in |
| GitHub | Developer tools (this is how many CI systems log you in) |
| Apple | "Sign in with Apple" — Apple requires it if you offer social sign-in on iOS |
| Microsoft / Azure AD | Enterprise SSO, workplaces |
| Facebook / Meta | Consumer apps |
| LinkedIn | Professional apps |
| Discord, Spotify, Strava | App-specific identity |

Each is an OAuth *provider*. The redirect URLs, scopes and consent screens differ; the
dance is identical.

**Kanso's code.** One call starts it, and it's worth reading closely —
`apps/web/src/hooks/useAuth.tsx` around line 194:

```ts
await client.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: `${window.location.origin}/auth/callback` },
});
```

Note `redirectTo`: Google sends the user *back* to us afterwards, and that URL must be
one Google has been told about in the console. That single config step is where most
"it works in dev but not in production" OAuth bugs come from — see §8.

---

## 2. How do you actually work with OAuth?

### The flow, concretely

1. User clicks "Continue with Google".
2. Our code builds a URL to Google containing: our client ID, a **redirect URI**, and a
   **state** value, then sends the browser there.
3. Google authenticates the user and asks for consent.
4. Google redirects back to our redirect URI with either a `code` or an `error`.
5. Our backend exchanges the `code` for tokens. **The code is single-use and short-lived.**
6. Our backend issues *our own* session token, which is what the browser holds from
   then on.

**Step 5 is the part people get wrong.** Two flows exist:

- **Implicit flow** — the token comes straight back in the URL fragment. Tokens land in
  browser history and logs. Obsolete for apps; don't use it.
- **Authorization Code + PKCE** — the browser gets a one-time `code`; the backend
  exchanges it. A random `code_verifier` proves that whoever received the code is the
  same party that started the flow, so a stolen code is useless.

Kanso uses PKCE: `apps/web/src/lib/supabase.ts` sets `flowType: 'pkce'`.

### The `state` parameter

Random, single-use, checked on return. Its job is to prove the redirect you're seeing
came from the login you started — defeating CSRF-style login attacks. Supabase handles
it for us. Never skip it in a DIY implementation.

### What you'd have to build yourself

This is the honest list, because it's why nobody DIYs it casually.

- Authorization-code + PKCE flow, correctly
- Token refresh, expiry, and revocation
- Session storage in an HTTP-only, `Secure`, `SameSite` cookie — **not** `localStorage`,
  which is readable by any script on the page
- Signing and verifying tokens (JWT signing keys, rotation, clock skew)
- Consent and account-linking, where a provider email matches an existing user
- Rate limiting, abuse prevention, brute-force protection
- Facebook/Google policy compliance: privacy policy, verified redirect URIs, consent
  screens, data deletion callbacks

### Options, honestly compared

| Option | Cost | What you own | Verdict |
|---|---|---|---|
| **Supabase Auth** (Kanso) | Free to ~100k MAU | Nothing | Right choice here |
| Firebase Auth | Free tier | Nothing | Solid; heavier SDK, Google-centric |
| Clerk, Auth0, WorkOS | Freemium | Nothing | Great DX, you're inside their platform |
| Auth.js (Next.js) | Free | Session plumbing, provider quirks | Good if you're already in Next |
| **DIY** | Cheap at first | Everything above | Only to learn, or for a hard constraint |

**When DIY is right:** you must support an identity provider nobody else supports; a hard
compliance requirement; or you're building auth as the product.

**DIY auth is dangerous** for a shop. Not "risky" — the industry has breached hand-rolled
auth repeatedly. Password resets alone involve generating tokens, storing them,
single-use-ifying them, expiring them and not leaking them into logs. Kanso got that for
free from a provider that has Google's security team behind it.

---

## 3. What is serverless? And did it fit us?

**Serverless means you write functions and never think about the server.** No VM to
provision, no `systemd`, no load balancer, no "is the process alive?" — the platform runs
your code in response to events and scales to zero when idle.

**Function-as-a-Service (FaaS):** you deploy a function; the platform runs it per request
and bills by invocation.

### How FaaS fits a traditional server

This is the mental model that makes serverless click:

```
Traditional          You run the code. Always. Whether or not anyone is looking.

Serverless           The platform runs the code because something happened.
                     You run the code only when something happens.
                     Not a customer? Nothing executes. You pay nothing.
```

### The unit of work

In this project, **one function did the whole order**: validate → price → create order →
create items → close cart → decrement stock → email. One invocation, one transaction, one
job.

**Read this** — it's the heart of the project:
`supabase/functions/create-order/index.ts` and its shared logic in
`supabase/functions/_shared/create-order.ts`.

### What made it fit

1. **It was naturally bounded.** One order per request. Nothing sits waiting for hours.
2. **Traffic is spiky.** A shop is quiet then busy. Pay-per-invocation matches reality.
3. **Zero ops burden.** No server to patch, reboot, or scale. For a ten-product shop,
   a traditional server would be absurd — you'd be paying to keep a process alive at 3am
   for nobody.
4. **It scales for free.** A launch or a flash sale needs no capacity planning.

### What it cost us

Latency (milliseconds of cold start), no long-lived memory, hard execution and memory
limits, and awkward work that doesn't fit the request/response shape.

### Is serverless worse for a real shop?

**No — the opposite.** A headless shop (your frontend on Netlify, your API serverless,
your DB managed) is a well-trodden, often *better* production design than one big server
running the site, API, and database together. It scales per component, so a traffic spike
on the catalog doesn't demand more database capacity.

What a shop *does* need, and serverless can't be the whole answer:

- **A relational database** — which is exactly why Supabase Postgres is always-on. Only
  the code is serverless; the database is a normal managed service.
- **A background worker / queue** for slow or scheduled work. Serverless functions are
  built for seconds, not hours.
- **Something for very steady high throughput** — serverless bills per invocation, so
  extreme, constant volume can get expensive against a flat-rate server.

---

## 4. Your promotional-email instinct — and the part that needs correcting

> *"serverless can handle batch needs like emailing all customers, right?"*

**Half right, and the half that's wrong matters.**

**The reality for most shops: no.** Consider a list of 10,000 customers. A "batch job"
that loops over 10,000 people *inside one function invocation* is a trap:

- Serverless timeouts kill it partway through.
- One slow call (a bounced address) fails the whole batch.
- Retrying means re-sending to everyone who already got it.
- You're paying to hold a function open while it does work that has nothing to do with
  serving requests.

**The pattern that works: one message per invocation.**

```
A queue (Supabase Database)
    │
    └──> "send email to customer #4812"   ← one row, one recipient
            │
            └──> one function invocation does exactly one send
```

The trigger is a database insert, so it's triggered by real business events — an order
lands, so a confirmation row appears. It scales because row #4813 is independent of
#4812, and it retries safely because "already emailed #4812" is answerable by looking at
that row.

**Truly scheduled bulk work** — nightly digest, weekly report, a 10,000-recipient campaign
— usually wants something else: **Inngest, Trigger.dev, pg-boss, or a plain queue**
operating on Postgres. These are trigger-based jobs rather than HTTP handlers, so
scheduling, retries and observability are first-class. Note **Supabase's own Edge
Functions aren't great at long schedules** — cron-driven deployments or a dedicated job
runner fit better.

The rule of thumb: **HTTP-triggered for requests; queue-triggered for everything that
happens after the request.**

---

## 5. React, and what else you could use

Your instinct — "React is bloated" — is half right, and worth sharpening into something
precise, because "React is bad" gets you a worse answer than "React is *fine* and here
is when it's the wrong tool."

### What's actually true

**React the library is small.** React itself is roughly 6 KB. The weight you feel is
**the ecosystem around it**:

- Every React app ships React Router, a data layer, a component library, a form library,
  a state library, and often a framework on top.
- That ecosystem is genuinely valuable — but it's why "small React app" ends up at
  150–200 KB gzipped.
- **React Server Components** (the Next.js model) is the industry's answer to its own
  bloat: ship less JavaScript by rendering on the server.

### The options, honestly

| Option | Best when | Cost |
|---|---|---|
| **React + Vite** (Kanso) | SPA, rich interactivity, you're the architect | You build routing/data/config yourself |
| **Next.js** | App is mostly content plus some interactivity; you want SEO and images handled | The most JS of the options; opinionated; learning curve |
| **Svelte / SvelteKit** | Want the smallest, most approachable code | Smaller ecosystem, fewer jobs, fewer devs to hire |
| **Vue / Nuxt** | Like the structured, "batteries included" feel | Smaller job market than React |
| **HTMX + a template language** | Server-rendered HTML with islands of interactivity | Little client JS; you keep server templating |
| **Solid / Qwik** | Fine-grained reactivity, minimal JS shipped | Small ecosystem, sharp edges |
| **Plain server HTML** | Blogs, forms, content — anything without heavy interactivity | No rich client interactivity |

### My recommendation for you

**Learn React properly, then learn one server-first framework** (SvelteKit or HTMX), so
you can judge the difference instead of repeating what the industry does by default.

The trap to avoid is picking a stack for its reputation or its bundle size. Pick for the
problem. **A small React SPA was the right call for Kanso** — a product grid, cart, and
checkout are exactly what React is good at. For a documentation site or a blog, Next or
even plain HTML would have been better.

One habit worth stealing from this project: Kanso's agent was forbidden from adding
dependencies without justification, and the build ended at ~190 KB gzipped. Most of that
was Zod and the Supabase client, both earning their place.

---

## 6. What Supabase actually gave us

Three services in one product, sharing one Postgres database. That shared database is
the integration point that matters, and it's the part people miss when they say "Supabase
is a backend-as-a-service."

| Piece | What it is | Where it is in Kanso |
|---|---|---|
| Postgres | The database — real SQL, real transactions | `supabase/migrations/` |
| **Row Level Security** | Authorization *inside* the database | `supabase/migrations/20261002090100_row_level_security.sql` |
| Auth | Identity, sessions, OAuth glue | `apps/web/src/hooks/useAuth.tsx` |
| Storage | File storage with access control | `scripts/upload-images.ts` |
| Edge Functions | TypeScript backend, one request each | `supabase/functions/create-order/` |
| PostgREST | Turns SQL tables into REST endpoints, for free | What `apps/web/src/lib/supabase.ts` talks to |

### The integration detail worth stealing

**RLS means authorization is enforced by the database, on every single query, no matter
which code asks.** Your frontend can't bypass it. Your Edge Function can't bypass it. A
leaked API key can't bypass it.

The proof that this is understood rather than assumed: in `supabase/migrations/20261002090100_row_level_security.sql`,
every table has a policy per operation, and `products` is **publicly readable but has no
insert/update/delete policy for regular users at all**. Catalogue changes are
service-role only. A user can read a product but cannot touch it.

Two more integration details:

- **PostgREST reads your schema automatically.** `profiles` gets `GET/POST/PATCH` because
  it exists. No API layer to write. It also means schema changes *are* API changes —
  a real trade-off.
- **The edge function and the frontend share the contract in TypeScript.** The same Zod
  schema validates checkout in both (`apps/web/src/schemas/checkout.ts`, referenced by the
  function). One rule, two places, can't drift.

### What we'd have had to build or glue otherwise

Kanso's infrastructure, assembled by hand, is roughly:

| Piece | DIY reality |
|---|---|
| Database | Postgres somewhere — RDS, or self-hosted. Comfortable. |
| **RLS** | **You'd write authorization by hand in every endpoint. This is the big one.** One forgotten check and you've leaked customer data. |
| **REST API for the tables** | **This is the largest hidden cost.** Every table needs GET/list/filter/insert/update/delete. Kanso had ~30 endpoints that nobody wrote. |
| Auth | §2's list. Weeks, and security-critical. |
| Storage + CDN + image transforms | S3 is easy; resizing, cropping and serving a responsive grid is not. |
| Function runtime | Build, package, deploy, scale, log, monitor. Netlify/Vercel functions, or containers on ECS. |
| **Secrets management** | Where do production keys live and who can read them? |
| Connection pooling | The unglamorous one: Postgres connections don't scale the way HTTP requests do. |
| Backups, replicas, PITR | |

That table is the real answer to "would we have chosen Supabase?" **Not because it's
always better** — this is lock-in and that's a genuine cost. Because the alternative is a
team owning an API layer, an auth system, an authorization strategy, and a file pipeline
before selling a single pen.

---

## 7. The bugs we hit, and what they teach

Every one of these happened on this project. This section is the most useful part.

### a) `Failed to fetch` at checkout — and the message pointed the wrong way

**What happened.** Pressing "Place Order" showed `TypeError: Failed to fetch`.

**Why.** The browser blocked the request before it left the page. Our Supabase client
sets an `x-application-name` header on everything (see `apps/web/src/lib/supabase.ts`), the browser
sent a CORS preflight, and our Edge Function's allowed-header list didn't include it. The
preflight failed; the POST never happened.

**Fix.** Added the header to the allow-list, and made the preflight echo back whatever
the browser asks for, so it can't drift again.
→ `supabase/functions/_shared/http.ts`

**The lesson.** `Failed to fetch` means the network never completed — and CORS is
network-level, so the message never mentions CORS. When a browser error is this vague,
look for CORS first, and check whether the header list is actually a negotiated list.

**Why it slipped through:** my earlier curl test passed — but I'd hand-written the exact
headers we allowed. Real browsers add their own. **Always test with a browser, or replay
the exact headers the client sends.**

### b) CI failed twice in ways a local test could never have caught

**Bug 1.** `supabase/setup-action@v1` — the action in the plan didn't exist. Dead in
5 seconds. The real one is `supabase/setup-cli`.

**Bug 2, and this one's interesting.** Locally, `npm run test:func` skipped every
database test and still reported **green**. In CI it failed loudly. The cause:
`supabase status -o env` prints `API_URL="http://..."` and `>> $GITHUB_ENV` keeps the
**quotes as part of the value**, producing `"http://..."` — a URL that can't be parsed.
→ `scripts/functional-env.mjs`

**Lesson, and the biggest one here: a test suite that skips and exits 0 is worse than no
tests.** It reports success while verifying nothing. A suite must **fail loudly** when it
cannot verify. We made it do exactly that, and added a test for that test.

### c) Utilities that silently did nothing

`PageShell` used `pt-md` and `gap-lg` against tokens that were never defined, so **every
page in the app silently lost its padding and gaps** while the class names lied about it.

Then the same family again: defining `--spacing-sm` to mean 8px **hijacked Tailwind's
`max-w-sm`**, so a hero panel rendered 8 pixels wide instead of 24rem.

**Lesson.** In CSS frameworks, a class name that doesn't resolve is a silent failure —
no error, no warning, just missing layout. When you define design tokens that share a
namespace with the framework's scales, you have *overridden the framework*. We built
`npm run check:classes` (`scripts/audit-classes.mjs`) to catch dead classes
automatically. **Convert recurring silent failures into automated checks** — that's the
real fix.

### d) Three carts, one app

`useCart` ran its own fetch per component, so the rail badge, the mobile header and the
page each held independent state. The badge didn't update when you added an item
elsewhere.

**Fix.** A single external store read through `useSyncExternalStore`, so every consumer
shares one value and one in-flight request — while the public API stayed byte-for-byte
identical, because four agents were coding against it in parallel.
→ `apps/web/src/hooks/internal/cartStore.ts`

**Lesson.** Module-level state inside a hook means *one copy per caller*. If a component
should reflect shared state, the state must live outside the component. Also: **a contract
that parallel work depends on should not change shape when you fix a bug** — fix it
underneath.

### e) Images 404'd on every product

The manifest held repo-relative paths. Vite doesn't rewrite strings inside imported JSON,
Netlify publishes only `dist/`, and a relative path resolves against the *current route*
— so on `/product/oak-pen-cup` the browser looked for `/product/product-images/...`.

**Fix.** Absolute Storage URLs in the manifest, satisfying SPEC's "product images load
from Storage".
→ `apps/web/src/lib/images.ts`, `scripts/upload-images.ts`

**Lesson.** Relative URLs survive nowhere near as long as they appear to. Vite transforms
*modules*, not strings inside data files.

### f) The empty catalogue, which wasn't a bug

After deploying, the catalogue showed empty. The schema was correct, the code was
correct. `supabase db push` applies migrations — it **never runs `seed.sql`**. Nothing was
broken; the data was simply never there.

**Lesson.** Migrations change structure; seeds insert data. Deploying to an empty
production database needs both, and it's the most commonly missed step in a first deploy.

### g) A flaky test that wasn't flaky in the way I assumed

One unit test failed intermittently. My first guess was "Testing Library's 1-second
`findBy` timeout" and raising it made things worse. The real cause: the **functional**
project set `testTimeout: 30_000` but the **unit** project inherited Vitest's 5-second
default. Under load it crossed 5s. Two GitHub runners later would have flaked too.
→ `vitest.config.ts`

**Lesson.** Read the actual error before theorising. And **test timeouts should reflect
the CI machine**, which is usually weaker than yours.

---

## 8. Things worth learning next

**Understand deeply, in this order:**

1. **SQL and Postgres** — joins, indexes, transactions, `select for update`. Every backend
   question eventually becomes a SQL question. `supabase/seed.sql` and the migrations are
   a readable introduction.
2. **HTTP properly** — methods, status codes, headers, CORS, caching. Most "mysterious"
   bugs are here. The CORS bug above was 20 minutes of learning.
3. **Authentication vs authorization** — the difference between "who are you" and "what
   may you do". RLS is authorization in the database.
4. **Transactions and concurrency.** Read `create_order_atomic` and ask: why must the
   order, its items, closing the cart and decrementing stock be one unit? What breaks if
   two people buy the last item simultaneously? (We tested exactly this — §7/constraint
   tests.)
5. **Testing as a design tool.** Our RLS tests deliberately break a policy and confirm the
   suite goes red. A test you never saw fail is a test you cannot trust.

**Build deliberately to learn:**

- Add an admin "resend confirmation email" feature — forces you into queues and idempotency
- Add order cancellation with inventory restoration — teaches state machines and transactions
- Write a product page that shows "low stock" — teaches caching and invalidation

**Read, eventually:** Stripe's API design (excellent reference for trustworthy payment
APIs), the OWASP Cheat Sheet, and anything by_auth.

---

## 9. Honest lessons about how this was built

You should know how the code came to exist, because it affects how much you trust it.

**The truth:** this codebase was written by AI agents in parallel, under a written contract
(`docs/CONTRACTS.md`), with me orchestrating, reviewing and merging. That approach made
this much faster than one person typing for weeks, and it taught a *lot*.

**And it had consequences you can see in the bugs above:**

- The CORS bug, the image-URL bug, the `setup-action` typo — none were caught by
  reviewing the logic. They were caught by *running the real thing*: an actual CI run, a
  real browser, a real deploy.
- **Every one of those bugs was found by verifying, not by reading.** That's the single
  biggest lesson in this document, and it's not specific to AI-written code. Humans skip
  verification under deadline pressure too.

**What that means for you:** treat this repo as a working example of a system, and as a
source of real bugs that survived review. Reading it will teach you the shape of a correct
design. Deploying and poking at it will teach you where design meets reality — which is
the part no document can give you.

---

## Where to look, in order

| To understand | Read |
|---|---|
| The database | `supabase/migrations/20261002090000_core_schema.sql`, then `..._row_level_security.sql` |
| The atomic order | `supabase/migrations/20261002090500_create_order_atomic.sql` |
| OAuth start | `apps/web/src/hooks/useAuth.tsx` (~line 194) |
| OAuth return | `apps/web/src/features/auth/callbackMachine.ts`, `apps/web/src/pages/auth/AuthCallbackPage.tsx` |
| The serverless function | `supabase/functions/create-order/index.ts` |
| Order logic + email | `supabase/functions/_shared/create-order.ts`, `_shared/mailgun.ts` |
| The CORS bug | `supabase/functions/_shared/http.ts` |
| RLS proving itself | `tests/functional/db/rls.test.ts` |
| Inventory race | `tests/functional/db/inventory.test.ts` |
| Honest failure wording | `apps/web/src/features/checkout/emailNotice.ts` |
| Money as integers | `apps/web/src/lib/money.ts` |
| The quiet CI bug | `scripts/functional-env.mjs` |
| Every agent's open questions | `docs/CONTRACT-REQUESTS.md` |