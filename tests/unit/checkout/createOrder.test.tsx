/**
 * From a `create-order` failure envelope to the sentence on screen.
 *
 * SPEC is explicit about the one case that matters: the server must reject an
 * over-quantity order with a structured error **naming the product and the
 * available count**. The client half of that contract is to pass the server's
 * words through unchanged — a genericised "something went wrong" here tells a
 * customer their cart is wrong without telling them what to do about it, and
 * sends them back to the cart to guess.
 *
 * The rest of the file pins the degradation path: an envelope this client does
 * not recognise must still produce a readable, correctly-typed `AppError` rather
 * than a crash, a blank screen, or a lie about the order.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutForm, toCreateOrderError } from '@/features/checkout';
import { InsufficientInventoryError } from '@/lib/errors';

/** The envelope A2 is assumed to send for a stock shortfall. */
const SHORTFALL = {
  error: {
    code: 'insufficient_inventory',
    message: 'Only 2 of Milled Brass Desk Weight left.',
    productId: 'p-1',
    productName: 'Milled Brass Desk Weight',
    requested: 3,
    available: 2,
  },
};

function renderFormError(message: string) {
  render(
    <MemoryRouter>
      <CheckoutForm onSubmit={vi.fn()} formError={message} />
    </MemoryRouter>,
  );
}

describe('insufficient inventory', () => {
  it('keeps the server’s sentence, product and count rather than genericising them', () => {
    const error = toCreateOrderError(SHORTFALL, 409);

    expect(error).toBeInstanceOf(InsufficientInventoryError);
    expect(error.message).toBe('Only 2 of Milled Brass Desk Weight left.');
    expect(error.code).toBe('insufficient_inventory');

    const shortfall = error as InsufficientInventoryError;
    expect(shortfall.productId).toBe('p-1');
    expect(shortfall.available).toBe(2);
  });

  it('renders that sentence to the customer, product name and count intact', () => {
    const error = toCreateOrderError(SHORTFALL, 409);
    renderFormError(error.message);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Only 2 of Milled Brass Desk Weight left.');
    expect(alert).toHaveTextContent('2');
    expect(alert).toHaveTextContent('Milled Brass Desk Weight');
  });

  it('accepts the flat envelope shape as well as the nested one', () => {
    const error = toCreateOrderError(
      { code: 'insufficient_inventory', message: 'Only 1 of Drafting Pen left.', available: 1 },
      409,
    );

    expect(error).toBeInstanceOf(InsufficientInventoryError);
    expect(error.message).toBe('Only 1 of Drafting Pen left.');
  });

  it('still says something specific when the server omits its message', () => {
    const error = toCreateOrderError(
      { error: { code: 'insufficient_inventory', available: 2 } },
      409,
    );

    expect(error.message).toBe('Some of those quantities are no longer available.');
    expect((error as InsufficientInventoryError).available).toBe(2);
  });
});

describe('other order-creation failures', () => {
  it('passes a known code and message straight through', () => {
    const error = toCreateOrderError(
      { error: { code: 'validation', message: 'Check your address.' } },
      400,
    );

    expect(error.code).toBe('validation');
    expect(error.message).toBe('Check your address.');
    expect(error.status).toBe(400);
  });

  it('treats an expired session as unauthenticated so checkout can re-prompt', () => {
    expect(toCreateOrderError(null, 401).code).toBe('unauthenticated');
    expect(toCreateOrderError(null, 403).code).toBe('unauthenticated');
  });

  it('treats a 5xx as a retryable server failure', () => {
    const error = toCreateOrderError({ error: { message: 'Transaction rolled back.' } }, 500);

    expect(error.code).toBe('server');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Transaction rolled back.');
  });

  it('degrades an unrecognised envelope to a readable failure, never a crash', () => {
    const error = toCreateOrderError({ surprise: { nested: true } }, 418);

    expect(error.code).toBe('unknown');
    expect(error.message).toBe('The order could not be placed. Nothing has been charged.');
  });

  it('degrades an unreadable body to a failure that does not claim the order exists', () => {
    const error = toCreateOrderError(null, undefined);

    expect(error.code).toBe('unknown');
    expect(error.message).toContain('Nothing has been charged');
  });
});
