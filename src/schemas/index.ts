/**
 * Barrel for `src/schemas`. Import from `@/schemas` everywhere.
 *
 * The Edge Function (A2) validates the *same* shapes against the *same* source
 * of truth. If the function needs a schema that does not exist here, it gets
 * added here first via `docs/CONTRACT-REQUESTS.md` — never duplicated.
 */

export {
  ADDRESS_FIELDS,
  type Address,
  type AddressField,
  type AddressInput,
  addressSchema,
  type Checkout,
  type CheckoutInput,
  type CreateOrderPayload,
  type CreateOrderResult,
  checkoutFieldErrors,
  checkoutSchema,
  createOrderPayloadSchema,
  createOrderResultSchema,
  type FieldErrors,
  FORM_ERROR_KEY,
  fieldErrorsFrom,
  hasFieldError,
  normalisePhone,
} from './checkout';
