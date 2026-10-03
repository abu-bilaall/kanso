# Kanso — Design & Product Specification

## Product

Kanso is a small independent shop for considered tools and accessories for focused work.

V1: approximately 7–13 real products, targeting ~10, across Desk, Carry, and Write.

Core journey:

Home → Catalogue → Product → Google Auth → Cart → Checkout → Order Confirmation

> **Implementation note (`chore/deploy-docs`).** Google Auth fires on the **first
> add to cart**, not after it. A cart belongs to an account, so the account has to
> exist before there is a cart: the product page catches the `unauthenticated`
> rejection and offers sign-in inline, and the catalogue grid hides its quick-add
> button while signed out. Checkout keeps its own gate for anyone who arrives
> another way. Everything else in the journey is as drawn above. Recorded rather
 than rewritten — see [`docs/CART-CHECKOUT.md`](./docs/CART-CHECKOUT.md) § 5 for
> why the journey moved instead of the schema.

## Brand Direction

**Aesthetic:** Acid industrial minimalism.

Kanso should feel restrained, editorial, tactile, and slightly raw — not like a generic ecommerce template.

### Visual language

- Light paper-like ground.
- Ink/graphite text and surfaces.
- Restrained chrome/metallic treatment.
- Chartreuse accent used sparingly.
- Strong editorial typography.
- 8px corner radius.
- Hard 2px borders for primary interactive elements.
- Outline icons from one consistent set such as Lucide.
- Avoid excessive pills, gradients, shadows, and decorative effects.
- Product photography is a major visual element.

Keep the interface mostly neutral with chartreuse providing emphasis.

### Typography

- **Primary:** Archivo.
- **Secondary:** one complementary typeface for selected editorial/brand moments.
- Do not use the secondary typeface indiscriminately.
- Controlled skew/typographic tension may be used for hero/editorial headings; functional UI and product names remain stable and legible.

## Layout

Desktop uses a persistent left navigation rail (~160px) beside the main content.

Suggested navigation:

- KANSO
- SHOP
  - All
  - Desk
  - Carry
  - Write
- ABOUT
- CART
- ACCOUNT

At mobile widths, collapse the rail into a compact navigation/header.

Primary responsive breakpoint: approximately 700–768px.

## Required UI Surfaces

### Home / Storefront

- Brand introduction/hero.
- Featured product or collection.
- Product grid.
- Category navigation.
- Strong product imagery.
- Clear paths to catalogue and cart.

### Catalogue

- Product grid.
- Category filtering.
- Product image, name, price, and availability.
- Avoid pagination unless the catalogue grows enough to require it.

### Product Detail

- Large product imagery.
- Product name, description, price, availability.
- Quantity control.
- Add-to-cart action.
- Category/context.

### Cart

- Items and quantities.
- Product prices.
- Subtotal.
- Remove/update controls.
- Checkout CTA.
- Empty-cart state.

### Checkout

Checkout should be visually quieter than the storefront.

Collect only fulfilment information required for V1:

- Name
- Email
- Phone
- Shipping address
- City
- State/region
- Country

Show order summary and total.

V1 does not include payment processing.

### Order Confirmation

- Confirmation state.
- Order reference.
- Purchased items.
- Total.
- Shipping summary.
- Confirmation-email notice.

### Authentication

Support Google sign-in through Supabase Auth.

Keep authentication UI minimal and consistent with Kanso.

### Account

Show authenticated user information and previous orders.

## Product Catalogue

Use approximately 7–13 real products; target ~10.

Suggested categories:

- Desk
- Carry
- Write

Products should feel like one coherent Kanso collection.

Product images come from real photographic sources and are stored in Supabase Storage.

> **Implementation note (`chore/integration-3`).** Three things about photography
> are not yet as drawn, recorded rather than papered over:
>
> - **Four products have no photograph.** A3's pipeline shipped and the
>   committed manifest holds 6 of the 10 seeded products, so
>   `graphite-desk-pad`, `oak-pen-cup`, `canvas-messenger-bag` and
>   `technical-fountain-pen` render the neutral panel. The other six resolve, and
>   every derivative is committed under `public/product-images/`.
> - **One frame per product in V1.** The image pipeline understands a `main` and
>   a `thumb` variant, but the product page renders a single frame. Second angles
>   were an explicit cut-list item, so the "Product gallery" below is a
>   single-image renderer for now.
> - **Uploading to Storage is a manual deploy step.** `scripts/upload-images.ts`
>   writes the bucket and rewrites the manifest's URLs; it is not run by CI,
>   which holds no credentials. See [`docs/IMAGES.md`](./docs/IMAGES.md).

## Components

Use a small, consistent vocabulary:

- Navigation
- Product card
- Product gallery
- Button
- Input/select
- Quantity control
- Badge/status
- Cart item
- Order summary
- Empty state
- Loading state
- Error state

Do not create components merely for abstraction's sake.

## Interaction & Motion

- Subtle hover lift may use ~4px translateY with a short ease.
- Product/card entrance animation may be staggered, but restrained.
- Motion should communicate state, not decorate.
- Respect `prefers-reduced-motion`.
- Interactive targets must be comfortable on mobile.

## Accessibility

- Semantic HTML.
- Visible keyboard focus.
- Meaningful form labels.
- Useful image alt text.
- Do not rely on colour alone for status.
- Maintain readable contrast, especially around chartreuse.
- Reduced-motion support.

## Technical Product Requirements

Use:

- TypeScript.
- Supabase PostgreSQL.
- Supabase Auth with Google OAuth.
- Supabase Storage for product images.
- Supabase Edge Functions for trusted server-side operations.
- Mailgun for order confirmation email.

Core persisted entities:

- users/profile data
- products
- carts
- cart items
- orders
- order items

The database is authoritative for products, carts, orders, and inventory.

The browser must not be trusted with authoritative prices or order totals.

## V1 Order Behaviour

1. User browses products.
2. User adds products to cart.
3. User authenticates with Google.
4. User completes checkout information.
5. Server-side order creation validates the user and cart.
6. Server retrieves current product prices and inventory.
7. Server calculates the order total.
8. Server creates the order and order items.
9. Cart is closed after successful order creation.
10. Inventory is updated.
11. Mailgun confirmation is attempted.
12. User sees order confirmation.

Email failure must not corrupt an otherwise successfully persisted order.

## Security

- Never expose Mailgun credentials to the browser.
- Never expose Supabase service-role credentials to the browser.
- Use Supabase Row Level Security for user-owned data.
- Derive the authenticated user from the session/JWT rather than trusting a client-supplied user ID.
- Server-side order logic calculates prices/totals from database data.
- Users may only access their own carts, orders, and profile data.

## Scope

### V1

- Product catalogue
- Product detail
- Cart
- Google authentication
- Checkout
- Order persistence
- Confirmation email
- Basic account/order history
- Product images
- Inventory count

### Future

- Paystack test payments
- Payment verification/status
- Advanced inventory management
- Shipping integration
- Reviews
- Wishlist
- Coupons
- Admin dashboard

Do not implement future features unless required for V1.

## Design Principle

Kanso should feel like a small, deliberate design shop.

The storefront can have personality.

The checkout should have confidence.

Avoid unnecessary ecommerce complexity and visual noise.
