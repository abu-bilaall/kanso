// Placeholder for `/order/:id`. Replaced wholesale by A5 (Cart, checkout, confirmation).
// See src/pages/_placeholder/Placeholder.tsx and docs/CONTRACTS.md.
import { Placeholder } from '../_placeholder/Placeholder';

export function OrderConfirmationPage() {
  return (
    <Placeholder
      path="/order/:id"
      owner="A5 — Cart & Checkout"
      intent="Order reference, purchased items, total and the honest email notice."
    />
  );
}
