/**
 * One line of the cart.
 *
 * The row a customer reads to decide whether the cart is right: photograph, name,
 * the technical spec line, the unit price, the quantity, and what that line
 * costs. Remove sits with the quantity rather than at the far edge of a wide
 * screen, because "remove" and "how many" are the same decision.
 *
 * Two failure messages can land on this row and they are not the same thing:
 *
 * - `bounds.message` — the line now holds more than exists. That is a fact about
 *   stock, and it is stated as a standing condition, not an event.
 * - `error` — a mutation the customer just attempted was rejected. That is an
 *   event, and it clears on the next attempt.
 *
 * The product name links to the product page: the standard escape from a cart you
 * are not sure about, and cheaper than abandoning the basket.
 */

import { Link } from 'react-router-dom';
import { TrashIcon } from '@/components/icons';
import { ProductImage } from '@/components/media/ProductImage';
import { Alert, Button, QuantityControl } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import type { CartItemWithProduct } from '@/lib/supabase.types';
import { ROUTE_PATHS } from '@/routes';
import { lineQuantityBounds } from './cartLine';

export interface CartLineProps {
  item: CartItemWithProduct;
  /** True while any cart mutation is in flight; disables this row's controls. */
  busy?: boolean;
  /** A rejected mutation's message, shown on this row. Cleared on the next attempt. */
  error?: string | null;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}

export function CartLine({
  item,
  busy = false,
  error = null,
  onQuantityChange,
  onRemove,
}: CartLineProps) {
  const product = item.product;
  const name = product?.name ?? 'Unavailable product';
  const slug = product?.slug;
  const unitPriceKobo = product?.price_kobo ?? 0;
  const bounds = lineQuantityBounds(
    { available: product?.inventory ?? 0, quantity: item.quantity },
    name,
  );

  return (
    <li className="flex gap-3 border-b border-hairline py-4 last:border-b-0 md:gap-4">
      {/*
        A line whose product row has gone has no slug to look up and no photo to
        resolve; `ProductImage` answers `null` for an unknown slug, which draws the
        neutral panel of the right size rather than a broken-image glyph.
      */}
      {slug === undefined ? (
        <ProductImage slug="" ratio="1x1" className="w-24 shrink-0 rounded-component md:w-28" />
      ) : (
        <Link
          to={ROUTE_PATHS.product(slug)}
          className="w-24 shrink-0 rounded-component focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:w-28"
          tabIndex={-1}
          aria-hidden="true"
        >
          <ProductImage
            slug={slug}
            ratio="1x1"
            sizes="(min-width: 768px) 112px, 96px"
            className="rounded-component border-hard border-hairline"
            decorative
          />
        </Link>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {slug === undefined ? (
            <span className="text-sm font-semibold text-ink-muted">{name}</span>
          ) : (
            <Link
              to={ROUTE_PATHS.product(slug)}
              className="text-sm font-semibold text-ink transition-kanso hover:text-accent-deep"
            >
              {name}
            </Link>
          )}
          <span className="font-editorial text-[11px] uppercase tracking-wider tabular-nums text-ink-muted">
            {formatMoney(unitPriceKobo)} each
          </span>
        </div>

        {product?.spec_line == null ? null : (
          <p className="font-editorial text-[11px] leading-4 text-ink-subtle">
            {product.spec_line}
          </p>
        )}

        {bounds.message === null ? null : (
          <p role="alert" className="text-xs leading-5 text-danger-ink">
            {bounds.message}
          </p>
        )}

        {error === null ? null : <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <QuantityControl
            value={item.quantity}
            onChange={onQuantityChange}
            max={bounds.max}
            min={1}
            disabled={busy || bounds.soldOut}
            label={`Quantity for ${name}`}
            size="sm"
          />

          <div className="flex items-center gap-2">
            <span className="font-label tabular-nums text-ink">
              {formatMoney(unitPriceKobo * item.quantity)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={busy}
              icon={<TrashIcon size={16} />}
            >
              Remove
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}
