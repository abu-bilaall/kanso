// Placeholder for `/shop`. Replaced wholesale by A4 (Storefront surfaces).
// See src/pages/_placeholder/Placeholder.tsx and docs/CONTRACTS.md.
import { Placeholder } from '../_placeholder/Placeholder';

export function CatalogPage() {
  return (
    <Placeholder
      path="/shop"
      owner="A4 — Storefront"
      intent="The full catalogue, filtered by the ?category= query param."
    />
  );
}
