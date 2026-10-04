# Repository Guidelines

## Project Overview

Kanso is a small independent shop for considered tools and accessories for focused work. V1 focuses on approximately 7–13 real products, targeting ~10, across Desk, Carry, and Write.

The product should feel like a real small commerce application, not a UI-only prototype. Prioritize a complete, maintainable vertical slice:

`browse → authenticate → cart → checkout → persist order → confirmation email → confirmation`

## Project Architecture

Use the simplest architecture that satisfies the requirements.

- Frontend: TypeScript
- Database: Supabase Postgres
- Authentication: Supabase Auth with Google OAuth
- Storage: Supabase Storage
- Server-side operations: Supabase Edge Functions
- Email: Mailgun, called only from server-side code
- Validation: Zod
- Testing: Vitest and the project's functional/E2E tooling
- Database access: SQL migrations are preferred; do not add an ORM unless there is a clear project need.

Keep the architecture understandable. Do not introduce abstractions, dependencies, services, or infrastructure merely because they are common in larger systems.

### Suggested Structure

Adapt this to the chosen frontend setup rather than forcing it:

```text
apps/web/
├── src/
│   ├── components/
│   ├── pages/
│   ├── features/
│   ├── lib/
│   ├── schemas/
│   ├── services/
│   ├── types/
│   └── utils/
└── tests/
    ├── setup/
    └── unit/

supabase/
├── migrations/
└── functions/
    └── create-order/

tests/
├── functional/
└── setup/
```

## Key Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Format + Lint: `npm run check`
- CI code quality: `npm run ci:check`
- Run all tests: `npm test`
- Unit tests: `npm run test:unit`
- Functional tests: `npm run test:func`

Do not invent commands that are not present in the repository. Inspect `package.json` first if the command set differs.

## Code Conventions

- TypeScript only. Do not introduce JavaScript unless a tool or framework explicitly requires it.
- Prefer clear, explicit types over `any`.
- Use `async`/`await` for asynchronous code.
- Keep functions focused and reasonably small.
- Prefer straightforward code over clever abstractions.
- Follow the existing project's naming and module conventions.
- Use Biome for formatting and linting. Do not add ESLint or Prettier unless explicitly requested.
- Use Zod at trust boundaries, including checkout input, Edge Function payloads, environment configuration, external API responses where appropriate, and other user-controlled data.
- Use typed application errors where errors cross service or feature boundaries.
- Never silently swallow errors.

## Database & Supabase

Supabase/Postgres is the source of truth for products, inventory, carts, profiles, orders, and order items.

The core domain model is:

- `users` / profile: one-to-one with `auth.users`
- `products`
- `carts`
- `cart_items`
- `orders`
- `order_items`

Rules:

- `users.user_id` is tied to `auth.users.id`.
- Do not implement custom password authentication. Supabase Auth owns authentication.
- A user has at most one active cart.
- A cart item represents a product and its quantity; do not create duplicate rows for the same product in one cart.
- Carts can be closed after checkout. Do not treat a cart as the authoritative purchase record.
- An order is a durable purchase record.
- `order_items` must snapshot the unit price at purchase time.
- Store monetary values as integer minor units (kobo), not floating-point currency values.
- Inventory is authoritative in the database.
- Product prices, inventory, cart ownership, order ownership, and totals must not be trusted from the browser.
- Use SQL migrations for schema changes.
- Apply Row Level Security to user-owned data.
- Products may be publicly readable as required by the storefront, but normal users must not be able to mutate products or inventory.
- Never disable RLS as a shortcut.

## Authentication

Use Supabase Auth with Google OAuth.

- The browser may use Supabase's public/publishable client credentials.
- Derive the authenticated user from the Supabase session/JWT.
- Never trust a client-supplied user ID for ownership decisions.
- Do not expose service-role credentials in frontend code.
- Handle authentication, callback, loading, and failure states explicitly.

## Edge Functions

Use Edge Functions for operations that require trusted server-side logic.

The primary V1 function is `create-order`.

It should:

1. Authenticate the caller.
2. Resolve the user from the authenticated session/JWT.
3. Validate checkout input.
4. Retrieve the user's active cart.
5. Retrieve current product prices and inventory from Postgres.
6. Validate quantities and inventory.
7. Calculate the authoritative order total server-side.
8. Create the order.
9. Create order items with purchase-time price snapshots.
10. Close the cart.
11. Update inventory safely.
12. Attempt the confirmation email through Mailgun.
13. Return a useful result to the client.

Do not trust client-supplied prices, totals, inventory, or user IDs.

If the email provider fails after the order has been persisted, the order must remain valid. Email delivery is a follow-up side effect, not the source of truth for whether the purchase exists.

## Mailgun

Mailgun is server-side infrastructure.

- Never call Mailgun directly from browser code.
- Keep Mailgun credentials in Edge Function secrets/environment configuration.
- Do not commit secrets or `.env` files.
- Confirmation emails should contain useful order information such as order reference, items, quantities, prices, total, and shipping summary.
- Email failures should be logged and surfaced appropriately without corrupting the order.

## Storage & Product Images

Use Supabase Storage for product images.

- Product images are storefront assets and may use a public bucket where appropriate.
- Store image references in product data rather than embedding large image data in database records.
- Optimize images for web delivery.
- Use real product photography for the initial catalogue.
- Do not add an image-management abstraction unless the application actually needs one.

## Logging & Observability

Use the repository's available logging skill, including the Boris Lane logging skill, when implementing logging.

The skill is primarily oriented toward larger/microservice systems, but its core principles should still be applied proportionately to Kanso. Do not blindly reproduce microservice-level infrastructure or complexity.

### Logging principles

- Log meaningful system events, not arbitrary lines of execution.
- Prefer structured logs with consistent fields.
- Log events that help answer: what happened, when it happened, which operation/request was involved, whether it succeeded or failed, and what useful context explains the result.
- Use appropriate log levels consistently.
- Include correlation/request identifiers where the runtime makes them available.
- For important business operations, prefer event-oriented logging, for example:
  - authentication failure
  - cart update failure
  - checkout validation failure
  - order creation started/completed/failed
  - inventory validation failure
  - inventory update failure
  - confirmation email attempted/succeeded/failed
- Log errors with enough context to diagnose them without exposing secrets or sensitive customer information.
- Never log passwords, OAuth tokens, API keys, service-role keys, Mailgun credentials, full authentication tokens, or unnecessary payment/customer data.
- Avoid logging entire request bodies when a small set of structured fields is sufficient.
- Do not add noisy debug logging to normal application paths.
- Logging should support debugging and operational understanding, not become an analytics system.

For a small application, simple structured application logs are sufficient. Do not introduce a full distributed tracing/observability stack unless explicitly requested.

If the Boris Lane logging skill provides more specific conventions, follow those conventions where they are compatible with Kanso's smaller architecture and security requirements.

## Frontend & UI

The implementation must use `DESIGN.md` as the visual source of truth alongside the Stitch prototype.

Preserve the established Kanso direction:

- acid industrial minimalism
- light paper ground
- ink/graphite/chrome
- restrained chartreuse accent
- strong editorial typography
- approximately 8px component radius
- hard-edged primary buttons
- outline iconography
- product photography as a major visual element
- restrained motion
- responsive layout with a persistent desktop rail and compact mobile navigation

Stitch output is a visual starting point, not an implementation contract.

The coding agent should:

1. Inspect `DESIGN.md`.
2. Inspect the Stitch-generated UI.
3. Preserve the intended visual language.
4. Replace mock/static data with real application data.
5. Connect Supabase Auth, database, Storage, and Edge Functions.
6. Add validation, loading, empty, and error states.
7. Remove unnecessary prototype code and dependencies.
8. Keep the resulting implementation maintainable.

Do not blindly preserve generated code simply because Stitch produced it.

## Required Product Surfaces

V1 should cover:

- Home/storefront
- Product catalogue
- Product detail
- Cart
- Google authentication
- Checkout
- Order confirmation
- Basic account/order history

The checkout should be visually quieter and more focused than the storefront.

V1 does not include payment processing yet. Paystack test integration may be explored after the complete V1 order flow works.

## Testing Rules

Write tests for new functionality where practical.

Prioritize tests around business-critical behaviour:

- validation
- cart operations
- order creation
- server-side total calculation
- price snapshots
- inventory validation/update
- authentication/ownership boundaries
- RLS behaviour
- email failure not invalidating an existing order

Tests should be deterministic and isolated.

Before marking a task complete, run the relevant checks and, where practical, the full test suite:

```bash
npm run typecheck
npm run check
npm test
```

Use the repository's actual scripts if they differ.

## Security Boundaries

Never:

- commit secrets or `.env` files
- expose Supabase service-role credentials
- expose Mailgun credentials
- trust client-provided prices or totals
- trust client-provided ownership/user IDs
- disable RLS to make a feature work
- log credentials, tokens, or unnecessary sensitive customer information
- use force-push
- modify generated/vendor/build output unnecessarily

Treat browser input as untrusted.

## Agentic Workflow

For non-trivial work:

- Work on a feature branch.
- Keep changes focused.
- Inspect the existing implementation before changing architecture.
- Reuse existing utilities/components when appropriate.
- Ask before installing or removing packages.
- Ask before deleting files when deletion is not clearly required.
- Ask before pushing, opening, or creating a PR.
- Use Conventional Commits if commits are requested.
- Run relevant checks before declaring work complete.
- Update documentation when implementation changes documented behaviour.

Do not make unrelated refactors while implementing a feature.

## Stitch → Implementation Workflow

The intended workflow is:

```text
DESIGN.md
    ↓
Google Stitch
    ↓
Visual prototype
    ↓
DESIGN.md + Stitch output + AGENTS.md
    ↓
Coding agent
    ↓
Functional Kanso application
```

The coding agent is responsible for turning the prototype into a real application. It should not treat the prototype as production-ready code.

When a visual decision conflicts with maintainability, accessibility, security, or the technical requirements in this file, preserve the product intent while implementing the safer/maintainable solution.

## Scope Discipline

Do not add features merely because they are common in ecommerce applications.

Out of scope for V1 unless explicitly requested:

- Paystack payment processing
- Admin dashboard
- Reviews
- Wishlist
- Coupons
- Shipping-provider integration
- Complex order tracking
- Multiple addresses
- Product variants
- Recommendation systems
- Complex analytics
- Full observability infrastructure
- Unnecessary microservices
- Unnecessary ORM/framework abstractions

The goal is a small, complete, credible commerce application.

## Completion Checklist

Before declaring implementation complete:

- [ ] TypeScript typechecks.
- [ ] Formatting/linting passes.
- [ ] Tests pass.
- [ ] Products load from Supabase.
- [ ] Product images load correctly.
- [ ] Google authentication works.
- [ ] Users can only access their own cart/order data.
- [ ] RLS policies are active and appropriate.
- [ ] Cart quantities work correctly.
- [ ] Checkout validates user input.
- [ ] Server recalculates prices and totals.
- [ ] Inventory is validated and updated server-side.
- [ ] Orders persist independently of carts.
- [ ] Order items preserve purchase-time prices.
- [ ] Cart closes after successful order creation.
- [ ] Mailgun confirmation email is attempted server-side.
- [ ] Email failure does not invalidate a persisted order.
- [ ] Loading, empty, and error states are handled.
- [ ] No secrets are exposed to the client.
- [ ] Logging is structured, useful, and does not expose sensitive data.
- [ ] Responsive behaviour works on desktop and mobile.
- [ ] Documentation/environment setup is clear.
- [ ] No out-of-scope complexity has been introduced.

Ask the user before committing, pushing, or creating a PR.
