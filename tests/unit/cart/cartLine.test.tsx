/**
 * The inventory guard on a cart line.
 *
 * The contract is one sentence: **a customer cannot select more units than
 * exist.** Two things have to hold for that to be true, and both are checked
 * here — the arithmetic that decides what the control may offer, and the control
 * itself refusing to emit a value above it.
 *
 * The shortfall message is checked for the same reason SPEC requires the server
 * to name the product and the count: "unavailable" is not something anybody can
 * act on.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { blockingStockMessage, CartLine, lineQuantityBounds } from '@/features/cart';
import type { CartItemWithProduct, Product } from '@/lib/supabase.types';

const PRODUCT: Product = {
  id: 'p-1',
  slug: 'brass-desk-weight',
  name: 'Milled Brass Desk Weight',
  category: 'desk',
  spec_line: 'Solid brass / 420g',
  description: null,
  price_kobo: 840000,
  inventory: 4,
  image_path: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

function line(quantity: number, inventory: number): CartItemWithProduct {
  return {
    id: `line-${quantity}`,
    cart_id: 'cart-1',
    product_id: PRODUCT.id,
    quantity,
    created_at: PRODUCT.created_at,
    updated_at: PRODUCT.updated_at,
    product: { ...PRODUCT, inventory },
  };
}

function renderLine(item: CartItemWithProduct, onQuantityChange = vi.fn()) {
  render(
    <MemoryRouter>
      <ul>
        <CartLine item={item} onQuantityChange={onQuantityChange} onRemove={vi.fn()} />
      </ul>
    </MemoryRouter>,
  );
  return { onQuantityChange };
}

describe('lineQuantityBounds', () => {
  it('offers exactly the available stock while the line is within it', () => {
    const bounds = lineQuantityBounds({ available: 4, quantity: 2 }, 'Milled Brass Desk Weight');

    expect(bounds.max).toBe(4);
    expect(bounds.overAvailable).toBe(false);
    expect(bounds.soldOut).toBe(false);
    expect(bounds.message).toBeNull();
  });

  it('never lets a line be raised past stock, but still lets it be lowered', () => {
    // Stock fell after the line was added. `max` rises to the quantity already
    // on the line so `+` is unreachable while `-` keeps working; the customer can
    // walk it down, and can never walk it up.
    const bounds = lineQuantityBounds({ available: 2, quantity: 3 }, 'Milled Brass Desk Weight');

    expect(bounds.max).toBe(3);
    expect(bounds.overAvailable).toBe(true);
    expect(bounds.message).toBe(
      'Only 2 of Milled Brass Desk Weight left. Reduce the quantity to continue.',
    );
  });

  it('treats zero stock as unsellable and says so by name', () => {
    const bounds = lineQuantityBounds({ available: 0, quantity: 1 }, 'Milled Brass Desk Weight');

    expect(bounds.soldOut).toBe(true);
    expect(bounds.max).toBe(0);
    expect(bounds.message).toBe('Milled Brass Desk Weight is out of stock. Remove it to continue.');
  });
});

describe('CartLine quantity control', () => {
  it('refuses to emit a quantity above the available inventory', async () => {
    const user = userEvent.setup();
    const { onQuantityChange } = renderLine(line(3, 4));

    await user.click(screen.getByRole('button', { name: /increase quantity for milled brass/i }));

    expect(onQuantityChange).toHaveBeenCalledWith(4);
    expect(onQuantityChange).not.toHaveBeenCalledWith(5);
  });

  it('disables the increase button once the line is at available stock', async () => {
    const user = userEvent.setup();
    const { onQuantityChange } = renderLine(line(4, 4));

    const increase = screen.getByRole('button', { name: /increase quantity for milled brass/i });
    expect(increase).toBeDisabled();

    await user.click(increase);
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it('locks the increase button and states the shortfall when stock has fallen below the line', async () => {
    const user = userEvent.setup();
    const { onQuantityChange } = renderLine(line(3, 2));

    expect(screen.getByRole('alert').textContent).toBe(
      'Only 2 of Milled Brass Desk Weight left. Reduce the quantity to continue.',
    );

    await user.click(screen.getByRole('button', { name: /increase quantity for milled brass/i }));
    expect(onQuantityChange).not.toHaveBeenCalled();

    // Lowering is still possible, and that is the way out of the shortfall.
    await user.click(screen.getByRole('button', { name: /decrease quantity for milled brass/i }));
    expect(onQuantityChange).toHaveBeenCalledWith(2);
  });

  it('disables the whole control for a line that has sold out', () => {
    renderLine(line(1, 0));

    expect(
      screen.getByRole('button', { name: /increase quantity for milled brass/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /decrease quantity for milled brass/i }),
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Milled Brass Desk Weight is out of stock.',
    );
  });
});

describe('blockingStockMessage', () => {
  it('is null when every line can be ordered', () => {
    expect(blockingStockMessage([line(1, 4), line(2, 2)])).toBeNull();
  });

  it('names the first line that cannot ship, with the count that exists', () => {
    const short = blockingStockMessage([line(1, 4), line(3, 2)]);
    expect(short).toBe('Only 2 of Milled Brass Desk Weight left. Reduce the quantity to continue.');
  });
});
