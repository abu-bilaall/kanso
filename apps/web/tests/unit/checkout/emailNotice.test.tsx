/**
 * The confirmation-email notice, for every state it can be in.
 *
 * `create-order` commits the order first and attempts Mailgun second, so
 * `emailSent: false` describes an order that **exists**. SPEC is unambiguous:
 * email delivery is a follow-up side effect, not the source of truth for whether
 * the purchase happened, and a failure must be surfaced "without pretending that
 * the order failed".
 *
 * These tests render the real confirmation screen so the copy under test is the
 * copy a customer reads, not a string in isolation. Three claims are pinned:
 *
 * 1. `true`  — says the confirmation is on its way.
 * 2. `false` — says the order is confirmed, says the email may not arrive, and
 *    says neither that the order failed nor that an email is on its way.
 * 3. no state (opened later, or reloaded) — says the record is unknown rather
 *    than guessing in either direction.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emailNotice, readEmailSent, unknownEmailNotice } from '@/features/checkout';
import type { Order, OrderItemWithProduct } from '@/lib/supabase.types';
import { OrderConfirmationPage } from '@/pages/order-confirmation/OrderConfirmationPage';

const ORDER: Order = {
  id: '0f6a2f6e-0a2e-4a0e-9a3e-2f1f1a1b1c1d',
  reference: 'KS-8902-DX',
  user_id: 'user-1',
  status: 'confirmed',
  email: 'marcus.v@example.com',
  phone: '+2348030000000',
  full_name: 'Marcus Vance',
  address_line1: '1044 Industrial Way',
  address_line2: 'Studio 4B',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  // Deliberately not equal to the sum of `ITEMS` (which is 840000), and not
  // equal to each other. A page that re-derived the total from the lines would
  // render neither of these figures, so the assertions below catch it.
  subtotal_kobo: 1520000,
  total_kobo: 1650000,
  created_at: '2026-10-02T09:14:00.000Z',
  updated_at: '2026-10-02T09:14:00.000Z',
};

const ITEMS: OrderItemWithProduct[] = [
  {
    id: 'oi-1',
    order_id: ORDER.id,
    product_id: 'p-1',
    product_name: 'Milled Brass Desk Weight',
    quantity: 1,
    unit_price_kobo: 840000,
    created_at: ORDER.created_at,
    product: { id: 'p-1', slug: 'brass-desk-weight', name: 'Milled Brass Desk Weight' },
  },
];

const useOrder = vi.fn();

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');
  return { ...actual, useOrder: () => useOrder() };
});

/**
 * The notice is queried inside `<main>`: the rail and the mobile header carry
 * their own `role="status"` elements (the cart badge), and a test that matched
 * those would be testing the shell rather than the order.
 */
function renderConfirmation(state?: unknown) {
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: `/order/${ORDER.id}`, state }]}>
      <Routes>
        <Route path="/order/:id" element={<OrderConfirmationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, page: within(view.getByRole('main')) };
}

beforeEach(() => {
  useOrder.mockReturnValue({
    order: ORDER,
    items: ITEMS,
    status: 'success',
    error: null,
    isLoading: false,
    refresh: vi.fn(),
  });
});

describe('emailSent: true', () => {
  it('tells the customer the confirmation is on its way, to the address on the order', () => {
    const notice = emailNotice(true, ORDER.email);

    expect(notice.tone).toBe('success');
    expect(notice.body).toContain('on its way');
    expect(notice.body).toContain('marcus.v@example.com');
  });

  it('shows that on the confirmation screen', () => {
    const { page } = renderConfirmation({ emailSent: true });

    expect(page.getByRole('status')).toHaveTextContent('Confirmation emailed');
    expect(page.getByRole('status')).toHaveTextContent('on its way to marcus.v@example.com');
  });
});

describe('emailSent: false', () => {
  it('confirms the order and says the email may not arrive — nothing more', () => {
    const notice = emailNotice(false, ORDER.email);

    expect(notice.body).toContain('Your order is confirmed');
    expect(notice.body).toContain('may not arrive');
  });

  it('never implies the order failed and never claims an email is coming', () => {
    const notice = emailNotice(false, ORDER.email);

    expect(notice.body).not.toMatch(/order (failed|could not be|was not) (placed|created)/i);
    expect(notice.body).not.toMatch(/on its way|has been sent|we emailed you/i);
  });

  it('shows that on the confirmation screen, with the order still presented as confirmed', () => {
    const { page } = renderConfirmation({ emailSent: false });

    expect(page.getByRole('alert')).toHaveTextContent('Order confirmed');
    expect(screen.getByRole('alert')).toHaveTextContent('may not arrive');
    // The order itself is unambiguous: the reference, the status and the total.
    expect(page.getByRole('heading', { name: 'Thank you' })).toBeInTheDocument();
    expect(page.getByText('KS-8902-DX')).toBeInTheDocument();
    // The total is the server's snapshot. The one line above sums to
    // ₦8,400.00, so a page that re-derived the total from the items could not
    // possibly render this figure.
    expect(page.getByText('₦16,500.00')).toBeInTheDocument();
  });
});

describe('no delivery record', () => {
  it('says the record is unknown rather than guessing either way', () => {
    const notice = unknownEmailNotice();

    expect(notice.tone).toBe('info');
    expect(notice.body).toContain('no delivery record');
    expect(notice.body).not.toMatch(/on its way|may not arrive|order failed/i);
  });

  it('renders that when the confirmation is opened without create-order state', () => {
    const { page } = renderConfirmation();

    expect(page.getByRole('status')).toHaveTextContent('no delivery record');
  });
});

describe('readEmailSent', () => {
  it('reads a boolean flag carried in router state', () => {
    expect(readEmailSent({ emailSent: true })).toBe(true);
    expect(readEmailSent({ emailSent: false })).toBe(false);
  });

  it('treats absent, malformed and hostile state as unknown', () => {
    for (const state of [undefined, null, 'emailSent', 42, {}, { emailSent: 'yes' }]) {
      expect(readEmailSent(state)).toBeNull();
    }
  });
});
