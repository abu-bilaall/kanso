/**
 * Money rendering for the Edge Function.
 *
 * Integer kobo in, `₦18,500.00` out — the same `Intl.NumberFormat('en-NG')`
 * call `src/lib/money.ts` makes. It is a four-line platform call rather than a
 * second implementation of the money rules: arithmetic stays in integer kobo
 * everywhere, and there is exactly one conversion, to naira, at render time.
 *
 * `docs/CONTRACT-REQUESTS.md` asks for the tsconfig change that would let this
 * import the frozen formatter instead.
 */

const KOBO_PER_NAIRA = 100;
const LOCALE = 'en-NG';
const CURRENCY = 'NGN';

const formatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Render integer kobo as naira. Non-finite input renders `—`, never `₦NaN`. */
export function formatKobo(kobo: number): string {
  if (!Number.isFinite(kobo)) return '—';
  return formatter.format(Math.round(kobo) / KOBO_PER_NAIRA);
}
