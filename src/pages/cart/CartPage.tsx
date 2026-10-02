// Placeholder for `/cart`. Replaced wholesale by A5 (Cart, checkout, confirmation).
// See src/pages/_placeholder/Placeholder.tsx and docs/CONTRACTS.md.
import { Placeholder } from '../_placeholder/Placeholder';

export function CartPage() {
  return (
    <Placeholder
      path="/cart"
      owner="A5 — Cart & Checkout"
      intent="Line items, quantity editing, subtotal and the checkout call to action."
    />
  );
}
