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
 * The envelopes below are copied from `supabase/functions/create-order/README.md`,
 * which is the frozen wire contract: **flat**, not nested, with the machine
 * context in `details`. Reading `available` off the top level would silently
 * produce `undefined` and lose the count, so there is a test for exactly that.
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

/** Verbatim from the README's failure example. */
const SHORTFALL = {
  code: 'insufficient_inventory',
  message: 'Only 2 of Oak Pen Cup left in stock.',
  retryable: false,
  details: {
    product: 'oak-pen-cup',
    productId: 'p-9',
    productName: 'Oak Pen Cup',
    requested: 3,
    available: 2,
    shortfallCount: 1,
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
    expect(error.message).toBe('Only 2 of Oak Pen Cup left in stock.');
    expect(error.code).toBe('insufficient_inventory');
    expect(error.retryable).toBe(false);
  });

  it('reads the product and the available count out of `details`', () => {
    const shortfall = toCreateOrderError(SHORTFALL, 409) as InsufficientInventoryError;

    // The bug this pins: `details.available`, not a top-level `available`.
    expect(shortfall.available).toBe(2);
    expect(shortfall.productId).toBe('p-9');
  });

  it('renders that sentence to the customer, product name and count intact', () => {
    renderFormError(toCreateOrderError(SHORTFALL, 409).message);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Only 2 of Oak Pen Cup left in stock.');
    expect(alert).toHaveTextContent('Oak Pen Cup');
    expect(alert).toHaveTextContent('2');
  });

  it('still says something specific when the server omits its message', () => {
    const error = toCreateOrderError(
      { code: 'insufficient_inventory', details: { available: 2 } },
      409,
    );

    expect(error.message).toBe('Some of those quantities are no longer available.');
    expect((error as InsufficientInventoryError).available).toBe(2);
  });

  it('falls back to a nested envelope without losing the count', () => {
    const error = toCreateOrderError(
      {
        error: {
          code: 'insufficient_inventory',
          message: 'Only 1 of Drafting Pen left.',
          details: { available: 1 },
        },
      },
      409,
    );

    expect(error).toBeInstanceOf(InsufficientInventoryError);
    expect(error.message).toBe('Only 1 of Drafting Pen left.');
    expect((error as InsufficientInventoryError).available).toBe(1);
  });
});

describe('server field errors', () => {
  it('carries a 422’s per-field messages through so the form can place them', () => {
    const error = toCreateOrderError(
      {
        code: 'validation',
        message: 'Some details need fixing.',
        details: {
          fields: ['city', 'state'],
          fieldErrors: { city: 'Enter the city.', state: 'Enter the state or region.' },
        },
      },
      422,
    );

    expect(error.code).toBe('validation');
    expect(error.details?.fieldErrors).toEqual({
      city: 'Enter the city.',
      state: 'Enter the state or region.',
    });
  });

  it('drops a malformed fieldErrors map rather than rendering [object Object]', () => {
    const error = toCreateOrderError(
      { code: 'validation', details: { fieldErrors: { city: { nested: true } } } },
      422,
    );

    expect(error.details?.fieldErrors).toBeUndefined();
  });
});

describe('other order-creation failures', () => {
  it('passes a known code and message straight through', () => {
    const error = toCreateOrderError({ code: 'validation', message: 'Check your address.' }, 400);

    expect(error.code).toBe('validation');
    expect(error.message).toBe('Check your address.');
    expect(error.status).toBe(400);
  });

  it('honours the server’s own retryable flag', () => {
    expect(toCreateOrderError({ code: 'server', retryable: false }, 500).retryable).toBe(false);
    expect(toCreateOrderError({ code: 'server', retryable: true }, 500).retryable).toBe(true);
  });

  it('treats an expired session as unauthenticated so checkout can re-prompt', () => {
    expect(toCreateOrderError(null, 401).code).toBe('unauthenticated');
    expect(toCreateOrderError(null, 403).code).toBe('unauthenticated');
  });

  it('treats a 5xx as a retryable server failure', () => {
    const error = toCreateOrderError({ code: 'server', message: 'Transaction rolled back.' }, 500);

    expect(error.code).toBe('server');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Transaction rolled back.');
  });

  it('degrades an unrecognised code to a readable failure, never a crash', () => {
    const error = toCreateOrderError({ code: 'wibble', message: 'Something odd.' }, 409);

    expect(error.code).toBe('unknown');
    expect(error.message).toBe('Something odd.');
  });

  it('degrades an unreadable body to a failure that does not claim the order exists', () => {
    const error = toCreateOrderError(null, undefined);

    expect(error.code).toBe('unknown');
    expect(error.message).toContain('Nothing has been charged');
  });
});
