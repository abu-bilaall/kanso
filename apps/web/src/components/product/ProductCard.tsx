/**
 * ProductCard.
 *
 * One product, one card, used by the home page's curated strip and the
 * catalogue grid. It carries the whole record a shopper scans — photograph,
 * division, name, spec line, price, stock — and the whole card is a link to the
 * product page.
 *
 * ## Two layouts, one component
 *
 * The Stitch desktop card is a vertical card in a four-up grid. The Stitch mobile
 * catalogue row is a horizontal row with a 96px thumbnail and a full-width ADD TO
 * CART per row; PLAN §3 calls that a regression and sets 120px plus a compact
 * action, with the primary add-to-cart on the product page. So below `sm` this
 * is a row — `w-[120px]` thumb, text beside it, one hairline strip underneath
 * carrying the stock state and the action — and from `sm` up it is Stitch's
 * vertical card. Same markup, one breakpoint of `flex-row`/`flex-col`.
 *
 * ## The link and the button do not nest
 *
 * A `<button>` inside an `<a>` is invalid and breaks keyboard navigation. The
 * link therefore covers only the media and the text and is stretched over the
 * card with `after:inset-0`, while the action sits above it on `z-10`. The card
 * stays one big target; the button stays its own target.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartIcon, CheckIcon } from '@/components/icons';
import { ProductImage } from '@/components/media/ProductImage';
import { buttonClasses } from '@/components/ui';
import { isPurchasable } from '@/features/catalog/inventory';
import { useAuth, useCart } from '@/hooks';
import { categoryLabel } from '@/hooks/useProducts';
import { formatMoney } from '@/lib/money';
import type { Product } from '@/lib/supabase.types';
import { ROUTE_PATHS } from '@/routes';
import { StockBadge } from './StockBadge';

/** How long the cart icon stays on its checkmark before it resets. */
const ADDED_FEEDBACK_MS = 2000;

/**
 * The card's status strip: what the stock is, and the one action that fits on a
 * card. A quick add of a single unit — the quantity choice belongs on the
 * product page, where the full control and the specification live.
 *
 * It only appears for a signed-in visitor. An anonymous shopper cannot have a
 * cart (`useCart` gives them an empty one and rejects mutations with
 * `unauthenticated`), and a button that always fails is worse than no button:
 * DESIGN.md's journey authenticates at checkout, not in a grid.
 */
function CardActions({ product }: { product: Product }) {
  const { addItem, isMutating } = useCart();
  const { isAuthenticated } = useAuth();
  const [added, setAdded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(false), ADDED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [added]);

  // A failure replaces the stock chip rather than appearing under the card: the
  // strip has one job, and an inline message there cannot push the layout around.
  if (failure !== null) {
    return (
      <p
        role="alert"
        title={failure}
        className="mt-auto truncate border-t border-hairline p-2.5 font-editorial text-[10px] uppercase tracking-wider text-danger-ink sm:p-3"
      >
        {failure}
      </p>
    );
  }

  return (
    <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline p-2.5 sm:p-3">
      <StockBadge inventory={product.inventory} />

      {isAuthenticated && isPurchasable(product.inventory) ? (
        <button
          type="button"
          // The label is the announcement, so a screen reader hears the outcome
          // of the press rather than having to go and count the cart badge.
          aria-label={
            added ? `${product.name} added to your cart` : `Add one ${product.name} to your cart`
          }
          aria-live="polite"
          disabled={isMutating}
          onClick={() => {
            setFailure(null);
            void addItem(product.id, 1)
              .then(() => setAdded(true))
              .catch((thrown: unknown) => {
                setAdded(false);
                setFailure(thrown instanceof Error ? thrown.message : 'Could not add to cart.');
              });
          }}
          // `relative z-10` lifts the button above the link's stretched `::after`.
          // Without it that overlay — a positioned box — paints over a static
          // button and every press navigates to the product instead of adding.
          className={`${buttonClasses({ variant: 'primary', size: 'sm' })} relative z-10 shrink-0`}
        >
          {added ? <CheckIcon size={16} /> : <CartIcon size={16} />}
        </button>
      ) : null}
    </div>
  );
}

export interface ProductCardProps {
  product: Product;
  /**
   * `sizes` for the photograph. The grid knows its column count and the card
   * does not, so the caller passes it — without it the browser downloads a
   * full-width crop for a quarter-width slot.
   */
  sizes?: string;
  /** Above the fold: load eagerly rather than lazily. */
  priority?: boolean;
}

export function ProductCard({ product, sizes, priority = false }: ProductCardProps) {
  return (
    <article className="group relative flex flex-col rounded-component border-hard border-hairline bg-surface-lowest transition-kanso hover:border-ink motion-safe:hover:-translate-y-1">
      <Link
        to={ROUTE_PATHS.product(product.slug)}
        className="flex flex-1 gap-3 p-2.5 after:absolute after:inset-0 after:content-[''] sm:flex-col sm:p-0"
      >
        {/* Fixed-width on mobile so the row has the 120px thumb PLAN §3 asks for;
            `ProductImage` is `w-full`, so the width lives on this wrapper rather
            than fighting its own utility. */}
        <div className="w-[120px] shrink-0 sm:mb-3 sm:w-full">
          <ProductImage
            slug={product.slug}
            ratio="4x3"
            sizes={sizes}
            priority={priority}
            className="rounded-component"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:p-3 sm:pt-0">
          <p className="font-editorial text-[10px] uppercase tracking-wider text-ink-subtle">
            {categoryLabel(product.category)}
            {product.spec_line === null ? null : <span className="block">{product.spec_line}</span>}
          </p>

          <h3 className="font-label text-label uppercase leading-snug tracking-[0.06em] text-ink transition-colors group-hover:text-accent-deep">
            {product.name}
          </h3>

          <p className="mt-auto pt-2 font-editorial text-sm font-bold tabular-nums text-ink">
            {formatMoney(product.price_kobo)}
          </p>
        </div>
      </Link>

      <CardActions product={product} />
    </article>
  );
}
