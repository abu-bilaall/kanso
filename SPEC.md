# Kanso — Technical Requirements & Agent Specification

## Objective

Implement Kanso V1. Leverage`DESIGN.md` and the Stitch-generated UI found in stitch-designs.

The result must be a functional TypeScript web application, not merely a visual prototype.

## Stack

- TypeScript throughout application code.
- Supabase PostgreSQL.
- Supabase Auth + Google OAuth.
- Supabase Storage.
- Supabase Edge Functions.
- Mailgun for emails.
- Use the simplest suitable frontend/build setup.
- Raw SQL/migrations are preferred over introducing an ORM solely for this project.

## Architecture

### Browser

- UI and client-side interaction.
- Supabase client using only public/publishable credentials.
- Never contain service-role or Mailgun secrets.

### Supabase

- Auth: identity/session.
- Postgres: application data.
- Storage: product images.
- Edge Functions: trusted business operations.

### Mailgun

Order confirmation email only.

## Data Model

Required entities:

### Users/profile

Application-specific profile data linked 1:1 to `auth.users`.

### Products

Catalogue and current inventory/pricing.

Minimum concepts:

- id
- name
- category
- description
- price in kobo
- image reference
- inventory count

### Carts

One active cart per user.

Cart lifecycle should allow an active cart to become closed after successful checkout.

### Cart items

- cart
- product
- quantity

A product should occur at most once in a cart; changing quantity updates the existing item.

### Orders

Represents a purchase, not merely a cart.

Must preserve:

- user
- order timestamps
- shipping/customer information required by checkout
- order status
- totals

### Order items

Must preserve the purchase snapshot:

- order
- product reference
- quantity
- unit price at purchase time

Do not rely on the current product price to reconstruct historical orders.

## Business Rules

- Only authenticated users can place orders.
- One active cart per user.
- Cart quantities must be positive.
- Product quantities cannot exceed available inventory.
- Order totals are calculated server-side.
- Client-provided prices/totals are never authoritative.
- Checkout creates a durable order and order items.
- Successful checkout closes the active cart.
- Inventory is reduced as part of successful order creation.
- Historical order prices remain unchanged when catalogue prices change.

## Authentication

Use Supabase Auth with Google OAuth.

The application should:

- expose a Google sign-in action;
- establish and maintain the Supabase session;
- protect authenticated routes/actions;
- create application profile data when required;
- never implement custom password hashing/authentication.

## Row Level Security

Apply RLS to user-owned data.

At minimum:

- Users can read/update their own profile.
- Users can read/manage their own active cart and cart items.
- Users can read their own orders and order items.
- Products are publicly readable.
- Product/inventory mutation is not available to ordinary storefront users.

Do not weaken RLS merely to make frontend queries easier.

## Edge Functions

Create a server-side order operation, e.g. `create-order`.

Responsibilities:

1. Authenticate the request.
2. Resolve the authenticated user from the JWT/session.
3. Validate checkout data.
4. Retrieve the user's active cart.
5. Retrieve current product prices and inventory from Postgres.
6. Validate quantities/availability.
7. Calculate authoritative totals.
8. Create the order.
9. Create order items with purchase-time prices.
10. Close the cart.
11. Update inventory.
12. Attempt confirmation email delivery.
13. Return a useful success/error response.

Do not trust:

- user ID supplied by the client;
- product prices supplied by the client;
- order totals supplied by the client.

Keep Mailgun credentials in Edge Function secrets.

## Email

After successful order persistence, attempt a Mailgun confirmation email containing:

- Kanso branding
- order reference
- purchased products
- quantities
- prices
- total
- shipping summary

If email delivery fails, the persisted order remains valid. Surface/log the failure without pretending that the order failed.

## Storage

Create a Supabase Storage bucket for product images.

Product records reference stored images rather than embedding image data in Postgres.

Optimize images before storage.

## UI Requirements

Implement the surfaces defined in `DESIGN.md`:

- Home
- Catalogue
- Product detail
- Cart
- Checkout
- Order confirmation
- Authentication
- Account/order history

Preserve Stitch's visual direction while correcting anything necessary for accessibility, responsive behaviour, real data, loading/error states, and maintainability.

Do not blindly preserve prototype code or unnecessary dependencies.

## Error & Loading States

Handle at least:

- failed product loading
- empty catalogue
- empty cart
- authentication failure
- invalid checkout input
- insufficient inventory
- order creation failure
- email delivery failure

Do not leave users staring at silent failures.

## Deployment

The application will be deployed on Netlify for frontend, Supabase for DB, Auth, and Edge functions, and Mailgun for sending emails.

Separate environment/secrets from source code.

Document required environment variables and Supabase/Mailgun configuration.

## Verification

Before V1 is considered complete, verify:

1. Products load from Supabase.
2. Product images load from Storage.
3. Google authentication works.
4. A user can create and modify their own cart.
5. A user cannot access another user's cart/order data.
6. Checkout validates inventory.
7. Order totals are calculated server-side.
8. Orders persist correctly.
9. Order items preserve purchase-time prices.
10. Cart closes after successful checkout.
11. Inventory decreases correctly.
12. Confirmation email is sent/attempted.
13. Order remains valid if email delivery fails.
14. Responsive UI works on mobile and desktop.
15. No secrets are exposed client-side.

## Scope Discipline

Do not implement:

- Paystack payments
- admin dashboard
- reviews
- wishlist
- coupons
- shipping-provider integration
- complex analytics
- unnecessary abstractions

unless explicitly requested later.

Prioritize the complete vertical slice:

**browse → authenticate → cart → checkout → persist order → email → confirmation**
