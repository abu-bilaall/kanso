// Placeholder for `/product/:slug`. Replaced wholesale by A4 (Storefront surfaces).
// See src/pages/_placeholder/Placeholder.tsx and docs/CONTRACTS.md.
import { Placeholder } from '../_placeholder/Placeholder';

export function ProductPage() {
  return (
    <Placeholder
      path="/product/:slug"
      owner="A4 — Storefront"
      intent="Product gallery, spec line, live stock and add to cart."
    />
  );
}
