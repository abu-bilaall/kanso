import { describe, expect, it } from 'vitest';
import {
  ADDRESS_FIELDS,
  addressSchema,
  checkoutFieldErrors,
  checkoutSchema,
  createOrderPayloadSchema,
  createOrderResultSchema,
  FORM_ERROR_KEY,
  fieldErrorsFrom,
  hasFieldError,
  normalisePhone,
} from '@/schemas/checkout';

const VALID = {
  fullName: 'Marcus Vance',
  email: 'marcus.v@example.com',
  phone: '0803 000 0000',
  addressLine1: '1044 Industrial Way',
  addressLine2: 'Studio 4B',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
} as const;

describe('checkoutSchema', () => {
  it('accepts a complete fulfilment and normalises the phone', () => {
    const result = checkoutSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.phone).toBe('+2348030000000');
  });

  it('defaults the country to Nigeria', () => {
    const result = checkoutSchema.safeParse({ ...VALID, country: undefined });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.country).toBe('Nigeria');
  });

  it('treats an empty second address line as absent, not as an error', () => {
    const result = checkoutSchema.safeParse({ ...VALID, addressLine2: '' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.addressLine2).toBeUndefined();
  });

  it('normalises every accepted Nigerian phone format to the same value', () => {
    for (const input of [
      '08030000000',
      '+2348030000000',
      '2348030000000',
      '0803 000 0000',
      '(0803) 000-0000',
    ]) {
      const result = addressSchema.safeParse({ ...VALID, phone: input });
      expect(result.success, `phone: ${input}`).toBe(true);
      if (result.success) expect(result.data.phone).toBe('+2348030000000');
    }
  });

  it('rejects a phone that is not Nigerian', () => {
    const result = addressSchema.safeParse({ ...VALID, phone: '+1 555 019 2834' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = checkoutSchema.safeParse({ ...VALID, email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(hasFieldError(checkoutFieldErrors(result.error), 'email')).toBe(true);
  });

  it('requires the fields the courier actually needs', () => {
    for (const field of ['fullName', 'addressLine1', 'city', 'state'] as const) {
      const result = checkoutSchema.safeParse({ ...VALID, [field]: '  ' });
      expect(result.success, `${field} should be required`).toBe(false);
    }
  });

  it('names exactly the seven fulfilment fields the UI renders', () => {
    expect([...ADDRESS_FIELDS]).toEqual([
      'fullName',
      'email',
      'phone',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'country',
    ]);
  });
});

describe('checkoutFieldErrors', () => {
  it('flattens issues to one message per field path', () => {
    const result = checkoutSchema.safeParse({ ...VALID, email: 'nope', city: '' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const errors = checkoutFieldErrors(result.error);
    expect(errors.email).toBe('Enter a valid email address.');
    expect(errors.city).toBe('Enter the city.');
    expect(Object.keys(errors).every((key) => typeof errors[key] === 'string')).toBe(true);
  });

  it('routes an issue with no path to the form, not to a control', () => {
    const errors = checkoutFieldErrors(checkoutSchema.safeParse({}).error as never);
    expect(errors[FORM_ERROR_KEY]).toBeUndefined();
    expect(hasFieldError(errors, 'fullName')).toBe(true);
  });
});

describe('fieldErrorsFrom', () => {
  it('handles a ZodError, an Error and an unknown value', () => {
    const zodFailure = checkoutSchema.safeParse({ ...VALID, email: 'nope' });
    expect(hasFieldError(fieldErrorsFrom(zodFailure.error), 'email')).toBe(true);

    expect(fieldErrorsFrom(new Error('Boom'))[FORM_ERROR_KEY]).toBe('Boom');
    expect(fieldErrorsFrom('nope')[FORM_ERROR_KEY]).toBe('Something went wrong. Please try again.');
  });
});

describe('normalisePhone', () => {
  it('produces E.164 from each accepted shape', () => {
    expect(normalisePhone('08030000000')).toBe('+2348030000000');
    expect(normalisePhone('+2348030000000')).toBe('+2348030000000');
    expect(normalisePhone('2348030000000')).toBe('+2348030000000');
  });
});

describe('create-order payload', () => {
  it('carries only fulfilment data — nothing the client could forge', () => {
    const result = createOrderPayloadSchema.safeParse({ shipping: VALID });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // The wire format gives a hostile client nowhere to put a price, a total,
    // an inventory count or a user id. AGENTS.md is explicit that none of them
    // are ever trusted from the browser.
    expect(Object.keys(result.data)).toEqual(['shipping']);
    expect(Object.keys(result.data.shipping).sort()).toEqual([...ADDRESS_FIELDS].sort());
  });

  it('strips a smuggled total rather than accepting it', () => {
    // Zod object schemas strip unknown keys, so a hostile client that adds
    // `totalKobo` (or `userId`, or `price`) gets a payload that simply does not
    // contain it. The server never has a field to be fooled by.
    const result = createOrderPayloadSchema.safeParse({
      shipping: VALID,
      totalKobo: 1,
      userId: 'someone-elses-id',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data)).toEqual(['shipping']);
  });
});

describe('createOrderResultSchema', () => {
  it('accepts a successful creation with the email flag either way', () => {
    for (const emailSent of [true, false]) {
      const result = createOrderResultSchema.safeParse({
        orderId: '0f6a2f6e-0a2e-4a0e-9a3e-2f1f1a1b1c1d',
        reference: 'KS-8902-DX',
        totalKobo: 1850000,
        emailSent,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a negative total', () => {
    expect(
      createOrderResultSchema.safeParse({
        orderId: 'id',
        reference: 'KS-1',
        totalKobo: -1,
        emailSent: true,
      }).success,
    ).toBe(false);
  });
});
