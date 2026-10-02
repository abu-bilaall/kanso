# `create-order`

The only trusted server-side business operation in V1. Takes a signed-in
customer's active cart, turns it into a durable order, and emails the receipt.

Everything that decides anything lives in `../_shared` and is unit-tested in
`tests/unit/order/`. This directory holds only the Deno entrypoint.

---

## Request

`POST` with a Supabase access token. The user is resolved from the token; the
body cannot say who the caller is.

```http
POST /functions/v1/create-order
Authorization: Bearer <supabase access token>
Content-Type: application/json

{
  "shipping": {
    "fullName": "Adaeze Okonkwo",
    "email": "adaeze@example.com",
    "phone": "08030000000",
    "addressLine1": "14B Admiralty Way, Lekki Phase 1",
    "addressLine2": "Suite 7",
    "city": "Lagos",
    "state": "Lagos",
    "country": "Nigeria"
  }
}
```

`shipping` is validated with `createOrderPayloadSchema` from
`src/schemas/checkout.ts` — the same schema the checkout form validates against.
That schema **strips unknown keys**, so `userId`, `totalKobo` or anything else a
hostile client adds simply is not in the parsed payload. There is nowhere on the
wire to be fooled.

## Success — `200`

```jsonc
{
  "orderId": "0f5c…",              // the four keys below are the frozen
  "reference": "KS-8902-DX",       // `createOrderResultSchema`
  "totalKobo": 1990000,            // computed from products.price_kobo
  "emailSent": true,               // false means the order EXISTS
  "order": { "…": "the full order row" },
  "items": [
    { "productId": "…", "productName": "Oak Pen Cup", "quantity": 3, "unitPriceKobo": 450000 }
  ]
}
```

`emailSent: false` is an honest answer, not a soft failure. The order is
committed before the mail is attempted, so `false` means "your order is real and
the receipt may not arrive". Never word it as a failed purchase.

## Failure

Every failure has the same body, and it is the shape `AppError` serialises to,
so the browser can branch on `code` and read `details` with no translation
layer. `code` is always one of `APP_ERROR_CODES`.

```jsonc
{
  "code": "insufficient_inventory",
  "message": "Only 2 of Oak Pen Cup left in stock.",
  "retryable": false,
  "details": {
    "product": "oak-pen-cup",      // the slug, so the UI can link to it
    "productId": "…",
    "productName": "Oak Pen Cup",
    "requested": 3,
    "available": 2,
    "shortfallCount": 1
  }
}
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation` | The body is not a JSON object |
| 401 | `unauthenticated` | No bearer token, or the store will not verify it |
| 405 | `validation` | Not `POST` (`details.reason: "method_not_allowed"`) |
| 409 | `insufficient_inventory` | Stock ran out. `details` names the product and the count |
| 422 | `validation` | `details.fields` lists the bad field names; `details.fieldErrors` maps each to its message |
| 422 | `validation` | `details.reason: "cart_empty"` |
| 500 | `server` | Anything unexpected. No stack trace, no internal detail |
| 500 | `configuration` | `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset |

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Injected by the Edge runtime. Never set it yourself |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Injected by the Edge runtime. Server-side only |
| `MAILGUN_API_KEY` | for email | Missing it still creates the order, with `emailSent: false` |
| `MAILGUN_DOMAIN` | for email | Bare hostname, no scheme |
| `MAILGUN_FROM` | for email | `Kanso <orders@yourdomain.com>` |
| `APP_URL` | no | Public origin; adds an order link to the email |
| `MAILGUN_API_BASE` | no | Defaults to `https://api.mailgun.net/v3`. EU accounts use `https://api.eu.mailgun.net/v3` |

The `SUPABASE_` prefix is reserved by the runtime and cannot be set as a custom
secret. Mailgun values belong in Supabase's Edge Function secrets, or in the
gitignored `supabase/.env.local` for local serving.

---

## Why one call commits an order

Creating an order is four writes — the order, its items, closing the cart,
decrementing stock — and they have to be one transaction or a failure leaves a
half-order behind. A PostgREST client cannot open a transaction across requests,
so the only atomic mechanism available is a Postgres function,
`create_order_atomic`. Its exact signature and body are in
[`docs/CONTRACT-REQUESTS.md`](../../../docs/CONTRACT-REQUESTS.md), which is the
contract this store is written against and which has been executed and verified
against a real Postgres.

That is also why the port in `../_shared/types.ts` has exactly one mutating
method. Anything else would be an invitation to write half an order.

## Email is a side effect

The mail attempt happens after the commit and cannot change the outcome. A mail
server that is down, rejects the message, or is not configured at all returns
`200` with `emailSent: false` and logs `confirmation_email_failed` carrying
`orderPersisted: true`. Nothing in this function can roll back a committed order
because a mail server was unreachable.

## Logging

`docs/LOGGING.md`, exactly. The events reserved for this function are
`order_create_started`, `order_created`, `order_create_failed`,
`inventory_insufficient`, `inventory_update_failed`, `checkout_validation_failed`,
`confirmation_email_sent` and `confirmation_email_failed`.

No token, no service key, no Mailgun credential, no `Authorization` header. A
customer's name, street, phone and email never reach a log line; their city and
country are attached once, to every event for the request, because those are
what you actually need to investigate a failed checkout.

## Running it locally

```bash
npm run db:start        # the shared stack, if it is not already up
npm run db:functions    # serves create-order with supabase/.env.local
```

`supabase/.env.local` is gitignored and should hold local placeholders only. The
function needs a real access token, so create a user through the admin API and
sign in with the password grant to get one.
