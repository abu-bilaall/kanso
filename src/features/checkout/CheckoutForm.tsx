/**
 * The checkout form.
 *
 * Seven fields, two quiet groups, one primary action. Everything about *validity*
 * comes from `checkoutSchema` — this component owns no rules of its own, so the
 * browser and the Edge Function cannot disagree about what a valid checkout is.
 * A `ZodError` is flattened to `field -> message` and rendered under the control
 * it belongs to; the first invalid control takes focus, because an error that
 * appears above the fold on a phone is an error nobody finds.
 *
 * The values held here are raw strings. The phone number is normalised by the
 * schema's transform on the way out, so the courier receives `+2348030000000`
 * rather than whichever of seven shapes the customer happened to type.
 */

import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { Alert, Input } from '@/components/ui';
import { logger } from '@/lib/logger';
import {
  type Address,
  type AddressField,
  checkoutFieldErrors,
  checkoutSchema,
  type FieldErrors,
} from '@/schemas';
import { CHECKOUT_SECTIONS, firstInvalidField } from './checkoutFields';

export interface CheckoutFormProps {
  /** Called with validated, normalised fulfilment data. Never called on invalid input. */
  onSubmit: (shipping: Address) => void;
  /** A message that belongs to the form rather than a control, e.g. from the server. */
  formError?: string | null;
  isSubmitting?: boolean;
  /** Pre-fills from the signed-in session. Overridden by anything the user types. */
  defaults?: Partial<Record<AddressField, string>>;
  /**
   * The form's action row, rendered inside the `<form>` after the fields.
   *
   * The submit button lives here rather than beside the component so it stays a
   * real submit: no `form` attribute, no query selector, and Enter in any field
   * does the right thing on a phone keyboard.
   */
  action?: ReactNode;
}

type Draft = Record<AddressField, string>;

/** Nigeria is the schema's default and the only place Kanso ships in V1. */
const INITIAL: Draft = {
  fullName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  country: 'Nigeria',
};

export function CheckoutForm({
  onSubmit,
  formError = null,
  isSubmitting = false,
  defaults,
  action,
}: CheckoutFormProps) {
  const [values, setValues] = useState<Draft>(() => ({ ...INITIAL, ...defaults }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const setField = (field: AddressField, value: string): void => {
    setValues((previous) => ({ ...previous, [field]: value }));
    // Clear this control's message as soon as it is touched. Leaving a stale
    // error under a field the customer has just corrected is how a form starts
    // lying to the person filling it in.
    setErrors((previous) => {
      if (previous[field] === undefined) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isSubmitting) return;

    const result = checkoutSchema.safeParse(values);
    if (!result.success) {
      const invalid = checkoutFieldErrors(result.error);
      setErrors(invalid);
      // Field names only — never the values, which are a customer's address.
      logger.info({
        event: 'checkout_validation_failed',
        scope: 'checkout',
        outcome: 'failure',
        invalidFields: Object.keys(invalid).filter((key) => key !== 'form'),
      });
      const first = firstInvalidField(invalid);
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first ?? ''}"]`)?.focus();
      return;
    }

    setErrors({});
    onSubmit(result.data);
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-8"
      aria-busy={isSubmitting}
    >
      {formError === null ? null : <Alert tone="danger">{formError}</Alert>}

      {CHECKOUT_SECTIONS.map((section, index) => (
        <fieldset key={section.id} className="flex flex-col gap-4">
          <legend className="flex w-full items-baseline justify-between gap-4 border-b border-hairline pb-2">
            <span className="flex items-baseline gap-2.5">
              <span className="font-editorial text-[11px] tabular-nums text-ink-subtle">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="font-label uppercase tracking-[0.06em] text-ink">
                {section.title}
              </span>
            </span>
            <span className="font-editorial text-[11px] uppercase tracking-wider text-ink-subtle">
              {section.meta}
            </span>
          </legend>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {section.fields.map((field) => (
              <div
                key={field.name}
                className={field.half === true ? 'sm:col-span-1' : 'sm:col-span-2'}
              >
                <Input
                  id={`${formId}-${field.name}`}
                  name={field.name}
                  label={field.label}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  inputMode={field.inputMode}
                  required={field.required}
                  placeholder={field.placeholder}
                  hint={field.hint}
                  error={errors[field.name]}
                  value={values[field.name]}
                  disabled={isSubmitting}
                  onChange={(event) => setField(field.name, event.target.value)}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      {action}
    </form>
  );
}
