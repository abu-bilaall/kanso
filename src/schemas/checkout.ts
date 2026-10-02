/**
 * Checkout schemas.
 *
 * FROZEN CONTRACT SURFACE. These are the shapes checkout renders inline errors
 * from *and* the shapes the `create-order` Edge Function validates the payload
 * against. One schema, two consumers — if the two ever disagreed, the server
 * would reject forms the browser had just called valid.
 *
 * ## The field-level error shape
 *
 * The UI contract is deliberately narrow so a form can render errors without a
 * translation layer:
 *
 * ```ts
 * type FieldErrors = Record<string, string | undefined>;  // field -> first message
 * ```
 *
 * {@link checkoutFieldErrors} produces exactly that from a `ZodError`, flattening
 * `issues` down to the first message per field path. `form` and `form.root` are
 * reserved for messages that belong to the form as a whole rather than a control.
 *
 * Field names are the wire names (`addressLine1`, not `address_line1`) because
 * the payload is JSON posted to an Edge Function.
 */

import { z } from 'zod';

/* ===========================================================================
   Primitives
   =========================================================================== */

/**
 * Email. `z.string().email()` is deprecated in Zod 4; `z.email()` is the current
 * API and returns its own issue shape, which {@link checkoutFieldErrors} reads
 * the same way.
 */
const email = z.email('Enter a valid email address.');

/**
 * Nigerian mobile numbers, tolerant of how people actually type them:
 * `0803…`, `+234803…`, `234803…`, `+234 803 000 0000`.
 * Stored and displayed normalised as E.164 (`+2348030000000`).
 */
const phone = z
  .string()
  .trim()
  .min(7, 'Enter a phone number.')
  // Normalise before validating, and store what the courier gets rather than
  // whichever of the seven shapes the customer happened to type.
  .transform(normalisePhone)
  .refine(isNigerianPhone, 'Enter a valid Nigerian phone number.');

function isNigerianPhone(value: string): boolean {
  const digits = value.replace(/^\+/, '');
  const local = digits.startsWith('234') ? digits.slice(3) : digits;
  // Nigerian mobile numbers are 11 digits locally: 0803…, 0703…, 0813…, 0903…
  return /^0[789]\d{9}$/.test(local) || /^[789]\d{9}$/.test(local);
}

/** Normalise any accepted phone input to E.164 for storage. */
export function normalisePhone(value: string): string {
  const compact = value.replace(/[\s()-]/g, '');
  if (compact.startsWith('+')) return compact;
  const digits = compact.startsWith('234') ? compact.slice(3) : compact;
  return `+234${digits.replace(/^0/, '')}`;
}

/* ===========================================================================
   Address
   =========================================================================== */

export const addressSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Enter the recipient’s full name.')
    .max(120, 'That name is too long.'),
  email,
  phone,
  addressLine1: z
    .string()
    .trim()
    .min(3, 'Enter the street address.')
    .max(160, 'That address is too long.'),
  // An omitted line and a blank line are the same thing to a courier, and both
  // become `undefined` so the database stores NULL rather than an empty string.
  addressLine2: z
    .string()
    .trim()
    .max(160, 'That address is too long.')
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value)),
  city: z.string().trim().min(2, 'Enter the city.').max(80, 'That city name is too long.'),
  state: z
    .string()
    .trim()
    .min(2, 'Enter the state or region.')
    .max(80, 'That state name is too long.'),
  country: z
    .string()
    .trim()
    .min(2, 'Enter the country.')
    .max(80, 'That country name is too long.')
    .default('Nigeria'),
});

export type AddressInput = z.input<typeof addressSchema>;
export type Address = z.output<typeof addressSchema>;

/** The seven fulfilment fields, in the order the checkout form renders them. */
export const ADDRESS_FIELDS = [
  'fullName',
  'email',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'country',
] as const satisfies ReadonlyArray<keyof AddressInput>;

export type AddressField = (typeof ADDRESS_FIELDS)[number];

/* ===========================================================================
   Checkout
   =========================================================================== */

export const checkoutSchema = addressSchema;

export type CheckoutInput = z.input<typeof checkoutSchema>;
export type Checkout = z.output<typeof checkoutSchema>;

/**
 * The payload posted to the `create-order` Edge Function.
 *
 * Note what is *absent*: no price, no total, no user id, no inventory. SPEC and
 * AGENTS.md are explicit that the client is never authoritative for any of them,
 * so the wire format gives it nowhere to put them.
 */
export const createOrderPayloadSchema = z.object({
  shipping: checkoutSchema,
});

export type CreateOrderPayload = z.infer<typeof createOrderPayloadSchema>;

/**
 * A successful `create-order` response.
 *
 * `emailSent` is honest by construction: the function attempts delivery *after*
 * committing the order and reports the real outcome. `false` means the order
 * exists and the email may not arrive — never that the order failed.
 */
export const createOrderResultSchema = z.object({
  orderId: z.string(),
  reference: z.string(),
  totalKobo: z.number().int().nonnegative(),
  emailSent: z.boolean(),
});

export type CreateOrderResult = z.infer<typeof createOrderResultSchema>;

/* ===========================================================================
   Error shaping
   =========================================================================== */

/** `field name -> first validation message`. `form` holds form-level messages. */
export type FieldErrors = Record<string, string | undefined>;

/** Reserved key for a message that belongs to the form rather than a control. */
export const FORM_ERROR_KEY = 'form';

/**
 * Flatten a `ZodError` into the {@link FieldErrors} shape the checkout UI
 * renders. The first issue per field wins: a control shows one message, not a
 * list. Issues with no usable path land on {@link FORM_ERROR_KEY}.
 */
export function checkoutFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? FORM_ERROR_KEY : issue.path.join('.');
    if (errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

/** The same flattening for a raw `unknown`; anything unrecognised is form-level. */
export function fieldErrorsFrom(error: unknown): FieldErrors {
  if (error instanceof z.ZodError) return checkoutFieldErrors(error);
  if (error instanceof Error) return { [FORM_ERROR_KEY]: error.message };
  return { [FORM_ERROR_KEY]: 'Something went wrong. Please try again.' };
}

/** True when `field` has a message. Saves a `!== undefined` at every call site. */
export function hasFieldError(errors: FieldErrors, field: string): boolean {
  return errors[field] !== undefined;
}
