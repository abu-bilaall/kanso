/**
 * The checkout form's integration with `checkoutSchema`.
 *
 * The schema is frozen contract surface shared with the `create-order` Edge
 * Function, so what matters here is that the form *uses* it rather than
 * approximating it: every field the schema declares is rendered exactly once,
 * every message the schema produces lands under the control that caused it, and
 * what leaves the form is the schema's output — normalised, trimmed, defaulted —
 * not the raw strings that were typed.
 *
 * The last point is the security-relevant one. `createOrderPayloadSchema` is what
 * guarantees the wire payload carries fulfilment data and nothing else, and that
 * guarantee only holds if the value handed to `onSubmit` has been through the
 * same parse the server performs.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui';
import { CheckoutForm, type CheckoutFormProps } from '@/features/checkout';
import { ADDRESS_FIELDS, type Address } from '@/schemas';

/** The label each schema field is rendered under, for `getByLabelText`. */
const LABELS: Record<string, string> = {
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  addressLine1: 'Address',
  addressLine2: 'Apartment, suite',
  city: 'City',
  state: 'State',
  country: 'Country',
};

const VALID = {
  fullName: 'Marcus Vance',
  email: 'marcus.v@example.com',
  phone: '0803 000 0000',
  addressLine1: '1044 Industrial Way',
  addressLine2: 'Studio 4B',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
};

function control(name: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${LABELS[name]}`, 'i'));
}

/**
 * The page supplies the submit button through the form's `action` slot, so the
 * tests do the same: what is under test is the schema, not the button.
 */
function renderForm({ onSubmit = vi.fn(), ...props }: Partial<CheckoutFormProps> = {}) {
  return render(
    <CheckoutForm
      {...props}
      onSubmit={onSubmit}
      action={
        <Button variant="primary" type="submit">
          Place order
        </Button>
      }
    />,
  );
}

/**
 * Sets a whole field in one event. `user.type` walks the string key by key, which
 * is realistic but turns an eight-field form into thousands of DOM updates and
 * pushes these tests past the timeout on a loaded machine.
 */
function fill(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    fireEvent.change(control(name), { target: { value } });
  }
}

describe('checkout field mapping', () => {
  it('renders every field the schema declares, exactly once, and nothing else', () => {
    const { container } = renderForm({ onSubmit: vi.fn() });

    for (const field of ADDRESS_FIELDS) {
      expect(container.querySelectorAll(`[name="${field}"]`)).toHaveLength(1);
    }
    expect(container.querySelectorAll('input')).toHaveLength(ADDRESS_FIELDS.length);
  });

  it('pre-fills the country, since it is the only place Kanso ships in V1', () => {
    renderForm({ onSubmit: vi.fn() });
    expect(control('country')).toHaveValue('Nigeria');
  });

  it('pre-fills from the signed-in session and lets the customer overwrite it', () => {
    renderForm({
      onSubmit: vi.fn(),
      defaults: { email: 'session@example.com', fullName: 'Marcus Vance' },
    });

    expect(control('email')).toHaveValue('session@example.com');
    expect(control('fullName')).toHaveValue('Marcus Vance');
  });
});

describe('checkout validation', () => {
  it('renders the schema’s own messages under the controls that caused them', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(control('fullName')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter the recipient’s full name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter a phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter the street address.')).toBeInTheDocument();
    expect(screen.getByText('Enter the city.')).toBeInTheDocument();
    expect(screen.getByText('Enter the state or region.')).toBeInTheDocument();
  });

  it('marks the invalid controls for assistive technology and focuses the first', async () => {
    const user = userEvent.setup();
    renderForm({ onSubmit: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(control('email')).toHaveAttribute('aria-invalid', 'true');
    // Contact is the first section, so email is the first invalid control on the
    // page — not the first field in the schema's own declaration order.
    expect(control('email')).toHaveFocus();
  });

  it('leaves the defaulted country valid while the rest report errors', async () => {
    const user = userEvent.setup();
    renderForm({ onSubmit: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(control('country')).not.toHaveAttribute('aria-invalid');
  });

  it('clears a control’s message as soon as the customer edits it', async () => {
    const user = userEvent.setup();
    renderForm({ onSubmit: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(screen.getByText('Enter the city.')).toBeInTheDocument();

    await user.type(control('city'), 'L');

    expect(screen.queryByText('Enter the city.')).not.toBeInTheDocument();
    // Untouched controls keep theirs.
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  });

  it('rejects a phone number the schema will not accept', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit, defaults: { ...VALID, phone: '+1 555 019 2834' } });

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid Nigerian phone number.')).toBeInTheDocument();
  });
});

describe('checkout submission', () => {
  it('hands onSubmit the schema’s output, not the raw input', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(shipping: Address) => void>();
    renderForm({ onSubmit });

    fill(VALID);
    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Typed as `0803 000 0000`; what the courier receives is E.164.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      phone: '+2348030000000',
      fullName: 'Marcus Vance',
    });
  });

  it('collapses a blank second address line to undefined rather than an empty string', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(shipping: Address) => void>();
    renderForm({ onSubmit });

    fill({ ...VALID, addressLine2: '' });
    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(onSubmit.mock.calls[0]?.[0]?.addressLine2).toBeUndefined();
  });

  it("renders the server's own per-field messages under the controls they name", () => {
    renderForm({
      onSubmit: vi.fn(),
      fieldErrors: {
        city: 'That city cannot be delivered to.',
        phone: 'That number is unreachable.',
      },
    });

    expect(screen.getByText('That city cannot be delivered to.')).toBeInTheDocument();
    expect(screen.getByText('That number is unreachable.')).toBeInTheDocument();
    expect(control('city')).toHaveAttribute('aria-invalid', 'true');
    expect(control('email')).not.toHaveAttribute('aria-invalid');
  });

  it("drops a server's field message as soon as the customer edits that field", () => {
    const onFieldEdited = vi.fn();
    renderForm({
      onSubmit: vi.fn(),
      onFieldEdited,
      fieldErrors: { city: 'That city cannot be delivered to.' },
    });

    expect(screen.getByText('That city cannot be delivered to.')).toBeInTheDocument();

    fireEvent.change(control('city'), { target: { value: 'Lagos' } });

    expect(onFieldEdited).toHaveBeenCalledWith('city');
  });

  it('surfaces a form-level failure from the server without marking the fields invalid', () => {
    renderForm({ onSubmit: vi.fn(), formError: 'Only 2 of Milled Brass Desk Weight left.' });

    expect(screen.getByRole('alert')).toHaveTextContent('Only 2 of Milled Brass Desk Weight left.');
    expect(control('city')).not.toHaveAttribute('aria-invalid');
  });
});
