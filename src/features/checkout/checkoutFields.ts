/**
 * What the checkout form renders, declared as data.
 *
 * The seven fulfilment fields come from `ADDRESS_FIELDS` in the frozen schema —
 * this file decides nothing about *validation*, only about labels, input types
 * and grouping. Keeping the layout as a table rather than seven hand-written
 * blocks means the field-to-error mapping is one loop instead of seven
 * opportunities to wire a message to the wrong control, and the unit suite can
 * assert that every field in the schema is rendered exactly once.
 *
 * ## Why the grouping
 *
 * Stitch's desktop checkout opens with the courier's routing details and puts
 * the recipient second. That order is kept: a phone number and an email address
 * are what a dispatcher asks for first, and asking for them before the street
 * address means the customer has not yet started typing something long they may
 * have to rewrite.
 *
 * `addressLine2` is the one optional field. It is rendered, marked optional, and
 * collapses to `undefined` in the schema when left blank — an empty string and an
 * omitted line are the same thing to a courier, and the database stores NULL
 * rather than `''`.
 */

import type { AddressField } from '@/schemas';

export interface CheckoutField {
  name: AddressField;
  /** Visible label. `Input` renders it as a real `<label for>`. */
  label: string;
  type: 'text' | 'email' | 'tel';
  /** Drives browser autofill; also the mobile keyboard. */
  autoComplete: string;
  inputMode?: 'text' | 'email' | 'tel';
  required: boolean;
  placeholder?: string;
  hint?: string;
  /** Sits beside its pair on wide screens rather than taking a full row. */
  half?: boolean;
}

export interface CheckoutSection {
  id: string;
  /** The step name, in the storefront's voice. */
  title: string;
  /** Mono sub-label on the right of the heading row. */
  meta: string;
  fields: readonly CheckoutField[];
}

export const CHECKOUT_SECTIONS: readonly CheckoutSection[] = [
  {
    id: 'contact',
    title: 'Contact',
    meta: 'Order updates',
    fields: [
      {
        name: 'email',
        label: 'Email',
        type: 'email',
        autoComplete: 'email',
        inputMode: 'email',
        required: true,
        hint: 'Your order confirmation is sent here.',
      },
      {
        name: 'phone',
        label: 'Phone',
        type: 'tel',
        autoComplete: 'tel',
        inputMode: 'tel',
        required: true,
        placeholder: '0803 000 0000',
        hint: 'For delivery questions only.',
      },
    ],
  },
  {
    id: 'shipping',
    title: 'Shipping address',
    meta: 'Where it goes',
    fields: [
      {
        name: 'fullName',
        label: 'Full name',
        type: 'text',
        autoComplete: 'name',
        required: true,
        placeholder: 'Recipient’s full name',
      },
      {
        name: 'addressLine1',
        label: 'Address',
        type: 'text',
        autoComplete: 'address-line1',
        required: true,
        placeholder: 'Street and number',
      },
      {
        name: 'addressLine2',
        label: 'Apartment, suite',
        type: 'text',
        autoComplete: 'address-line2',
        required: false,
        placeholder: 'Optional',
      },
      {
        name: 'city',
        label: 'City',
        type: 'text',
        autoComplete: 'address-level2',
        required: true,
        half: true,
      },
      {
        name: 'state',
        label: 'State',
        type: 'text',
        autoComplete: 'address-level1',
        required: true,
        half: true,
      },
      {
        name: 'country',
        label: 'Country',
        type: 'text',
        autoComplete: 'country-name',
        required: true,
        half: true,
      },
    ],
  },
];

/** Every field the form renders, in document order. */
export const CHECKOUT_FIELDS: readonly CheckoutField[] = CHECKOUT_SECTIONS.flatMap(
  (section) => section.fields,
);

/** The first field carrying a message — where focus goes after a failed submit. */
export function firstInvalidField(errors: Record<string, string | undefined>): string | null {
  for (const field of CHECKOUT_FIELDS) {
    if (errors[field.name] !== undefined) return field.name;
  }
  return null;
}
