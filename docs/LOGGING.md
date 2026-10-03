# Kanso — Logging conventions

> **Status: current guidance, and binding.** Every agent logs this way. The
> canonical event vocabulary below is what the shipped code emits. See
> [`docs/README.md`](./README.md) for the rest of the map.

Settled in Phase 1 by running the `logging-best-practices` skill once, then
cutting it down to what a ten-product shop actually needs. **Every agent logs the
same way.** If you need a convention that is not here, it is a
`docs/CONTRACT-REQUESTS.md` entry, not a local invention.

The skill is oriented at distributed systems. The principles survive; the
infrastructure does not, and we deliberately did not build it. There is one
logger, two levels, and JSON.

---

## The six rules

### 1. One wide event per operation

Emit **one context-rich event when an operation completes** — not a log line at
each step on the way there.

```ts
// Bad: a scatter of steps. Six lines, five questions unanswered.
logger.info({ event: 'create_order_started', cartId });
logger.info({ event: 'pricing_loaded', items: 3 });
logger.info({ event: 'inventory_reserved' });
logger.info({ event: 'order_created', orderId });
logger.info({ event: 'email_sent' });

// Good: one line, everything a reader needs.
logger.info({
  event: 'order_created',
  outcome: 'success',
  durationMs: 214,
  orderId, reference: 'KS-8902-DX', userId,
  itemCount: 3, subtotalKobo: 4_050_000,
  emailSent: true,
});
```

The five-line version cannot answer "why is this user's order slow?" The one-line
version can, and it is half the volume.

**Test:** if you are logging more than once inside a single function, you want one
event at the end.

### 2. Structured fields only

Every line is a JSON object. `logger` serialises it; you pass fields, never a
sentence.

```ts
logger.info({ event: 'cart_item_added', outcome: 'success', quantity: 3 });   // yes
console.log('added 3 items to the cart');                                     // no
```

Field names are camelCase. Values are scalars, arrays of scalars, or nested plain
objects.

### 3. Two levels: `info` and `error`

Nothing else. Anything more precise is a field, not a level.

```ts
logger.info(event);   // a completed operation, successful or not
logger.error(event);  // a failed operation; carries `error` and outcome: 'failure'
```

`logger.setLevel('silent')` is for tests.

### 4. High cardinality, high dimensionality

- **High cardinality** — identifiers with millions of values: `userId`,
  `sessionId`, `orderId`, `cartId`, `productId`, `requestId`. Without these a log
  cannot be tied to one person's problem.
- **High dimensionality** — many fields per event. You cannot predict which one
  you will need at 3am; carry it anyway, it costs nothing.

### 5. Business context, every time

Technical facts do not explain business failures. "A customer could not check out"
is only diagnosable if the line also carries what they were trying to buy and for
how much.

Always attach, where they apply: `itemCount`, `subtotalKobo`, `totalKobo`,
`quantity`, `provider`, `outcome`, `durationMs`.

### 6. Environment context is attached once, centrally

`src/lib/logger.ts` injects `app`, `runtime`, `env`, `release`, `userAgent` and
`timestamp` into every line. **No call site ever adds them.** If you find yourself
writing `environment: 'production'` somewhere, stop.

---

## What never goes in a log line

Not "be careful" careful. Never:

- passwords, OAuth tokens, refresh tokens, session tokens
- API keys, Mailgun credentials, the Supabase service-role key
- `Authorization` headers, cookies
- full request or response bodies
- a customer's full address, phone number or email address — an order id and a
  city are enough to investigate
- any value that identifies a payment instrument

`scrub()` redacts known-sensitive **keys** (`password`, `token`, `api_key`,
`secret`, `cookie`, `authorization`, `service_role`, …) as a backstop. It is a
safety net, not permission. It cannot see `orderNote: 'my card is 4111…'`.

When something genuinely failed and you need the detail, log the *shape*:
`{ fieldCount: 8, fields: ['fullName', 'city', …] }`, not the values.

---

## The API

```ts
logger.info({ event, outcome?, durationMs?, error?, ...fields });
logger.error({ event, outcome?, durationMs?, error?, ...fields });
logger.setContext(fields);        // merge into every subsequent line
logger.child(fields);             // a logger that also carries these fields
logger.setLevel('info' | 'error' | 'silent');
```

Pass an `Error`, an `AppError` or anything throwable as `error`; it is flattened
to `{ name, message, code?, status?, details? }`. Never read `error.cause` into a
top-level field — the cause is a chain, not a fact.

Correlate with `logger.child({ scope: 'cart' })` so a subsystem's lines are
groupable, and with high-cardinality ids on each event.

---

## Canonical event names

Snake_case, past tense, `entity_action`. **These are a vocabulary, not a
suggestion** — a stable name is what makes a log searchable, and inventing a new
one mid-project is how log search dies. Adding an event is fine; renaming one is
not.

### Already emitted by Phase 1

| Event | Level | Emitted by |
| --- | --- | --- |
| `supabase_client_created` | info | `lib/supabase.ts` |
| `session_read` | info | `AuthProvider`, once on boot |
| `session_changed` | info | `AuthProvider`, on any auth state change |
| `auth_signin_started` | info / error | `useAuth.signInWithGoogle` |
| `auth_signout` | info / error | `useAuth.signOut` |
| `catalogue_loaded` | info / error | `useProducts` |
| `product_loaded` | info / error | `useProduct` |
| `cart_loaded` | info / error | `useCart` |
| `cart_created` | info | `useCart`, on first-use creation |
| `cart_item_added` / `_updated` / `_removed` | info / error | `useCart` |
| `cart_cleared` | info / error | `useCart` |
| `order_loaded` | info / error | `useOrder` |
| `orders_loaded` | info / error | `useOrders` |

Each already carries the identifying fields: `userId`, `cartId`, `orderId`,
`slug`, `category`, `durationMs`.

### Shipped with Phase 2

These names are claimed and these are the surfaces that emit them. The names are
the contract; the split by agent is history.

**A2 — `create-order` Edge Function**

| Event | Level | Notes |
| --- | --- | --- |
| `order_create_started` | info | `cartId`, `itemCount` |
| `order_created` | info | `orderId`, `reference`, `itemCount`, `totalKobo`, `emailSent` |
| `order_create_failed` | error | `error`, `stage` — which of the 13 steps failed |
| `inventory_insufficient` | error | `productId`, `productName`, `requested`, `available` |
| `inventory_update_failed` | error | `error`, `productId` |
| `checkout_validation_failed` | error | `error`, `fields` — **field names only** |
| `confirmation_email_sent` | info | `orderId`, `reference` |
| `confirmation_email_failed` | error | `orderId`, `reference`, `error` — the order still stands |

**A4 — storefront** · `catalogue_filter_applied`, `product_quantity_clamped`

**A5 — cart and checkout** · `cart_checkout_started`, `cart_checkout_succeeded`,
`cart_checkout_failed`, `checkout_validation_failed`, `checkout_signin_required`

**A6 — account and auth** · `auth_callback_completed`, `auth_callback_failed`,
`auth_callback_denied`, `auth_session_expired`, `auth_signed_out`

**Three of these are claimed but not currently emitted.** Recorded rather than
silently corrected, because a reserved name stays reserved:

| Event | Why it does not fire |
| --- | --- |
| `inventory_update_failed` | `create_order_atomic` decrements stock inside the same transaction as the order write, so a stock failure cannot leave the order behind. It surfaces as `order_create_failed` with `stage: 'evaluate_cart'`, with `inventory_insufficient` alongside it. There is no separate stock-write failure to report. |
| `catalogue_filter_applied` | The category filter is a pure derivation from the `?category=` search param. There is no event. |
| `product_quantity_clamped` | Quantity is clamped by `clampQuantity` during render, not in an effect. |

If one of these ever becomes a real event, emit it under the name already
reserved. Renaming a name already in use is what makes log search die.

---

## Worked examples

**A load that succeeded.** Wide, business-aware, one line.

```ts
logger.info({
  event: 'catalogue_loaded',
  scope: 'catalog',
  outcome: 'success',
  durationMs: 41,
  category: 'desk',
  itemCount: 4,
});
```

**A mutation that failed.** The error is flattened; the business context says what
the user was trying to do.

```ts
logger.error({
  event: 'cart_item_added',
  scope: 'cart',
  durationMs: 63,
  cartId, userId,
  productId, requested: 5,
  error: insufficientInventoryError,   // { name, code: 'insufficient_inventory', available: 2 }
});
```

**Email failure after a committed order.** The event says the order is fine. This
is the single most important distinction in the codebase — SPEC is explicit that
email delivery is a follow-up side effect, not the source of truth for whether the
purchase exists.

```ts
logger.error({
  event: 'confirmation_email_failed',
  orderId, reference: 'KS-8902-DX',
  durationMs: 1420,
  outcome: 'failure',
  error,                    // never the Mailgun API key
  orderPersisted: true,     // so nobody reads this line as "the order failed"
});
```

**A form validation failure.** Field names, never values.

```ts
logger.info({
  event: 'checkout_validation_failed',
  outcome: 'failure',
  invalidFields: ['city', 'phone'],
});
```