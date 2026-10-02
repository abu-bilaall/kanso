/**
 * Money.
 *
 * Kanso stores every monetary value as an **integer number of kobo** (1 naira =
 * 100 kobo). Floats never appear in application code: no `0.1 + 0.2`, no
 * `price * 0.9`, no rounding drift between the cart, the Edge Function and the
 * email. If you need to do arithmetic on money, do it in kobo.
 *
 * Display is `₦` formatted through `Intl.NumberFormat('en-NG')`, which gives
 * `₦18,500.00` with the correct grouping for the Nigerian market.
 *
 * See docs/CONTRACTS.md for the frozen API.
 */

/** Kobo per naira. The only conversion constant in the codebase. */
export const KOBO_PER_NAIRA = 100;

/** ISO 4217 code for the Nigerian naira. */
export const CURRENCY = 'NGN';

/** BCP 47 locale used for every currency display. Nigerian English. */
export const LOCALE = 'en-NG';

const formatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Render kobo as a currency string, e.g. `1850000` -> `₦18,500.00`.
 *
 * @param kobo    Amount in integer kobo. Non-integers are rounded half-up.
 * @param options `compact: true` drops the decimals (`₦18,500`) for dense places
 *                such as a catalogue grid, where the naira unit is unambiguous
 *                and the extra two digits only add noise.
 */
export function formatMoney(kobo: number, options?: { compact?: boolean }): string {
  if (!Number.isFinite(kobo)) {
    // Rendering "₦NaN" on a price is worse than rendering nothing. Callers that
    // can be reached with a non-number should guard upstream; this is the net.
    return '—';
  }

  const naira = toNaira(kobo);
  if (options?.compact === true) {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: CURRENCY,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(naira);
  }
  return formatter.format(naira);
}

/** Convert kobo to naira. The only place the divisor is applied for display. */
export function toNaira(kobo: number): number {
  return Math.round(kobo) / KOBO_PER_NAIRA;
}

/** Convert naira to integer kobo. The inverse of {@link toNaira}. */
export function fromNaira(naira: number): number {
  return Math.round(naira * KOBO_PER_NAIRA);
}

/**
 * Parse a human-readable amount back to integer kobo.
 *
 * **The input is always in naira**, because naira is what this codebase shows
 * and what a person types; kobo only exists in the database. So `18500` means
 * eighteen thousand five hundred naira — `1_850_000` kobo — not one million
 * eight hundred and fifty thousand kobo.
 *
 * The round-trip partner of {@link formatMoney}:
 * `parseMoneyToKobo(formatMoney(k)) === k`, because `formatMoney` always emits
 * both a currency symbol and two decimal places.
 *
 * Separator handling follows en-NG, which is what `formatMoney` emits:
 *   - `.` is always the decimal point. `18.509` is 18.5 naira, truncated — NGN
 *     has no third decimal place and rounding money *up* is never right.
 *   - `,` groups thousands. `1,850` is one thousand eight hundred and fifty.
 *   - `,` that is *not* followed by exactly three digits is read as a decimal
 *     point instead, so `18,50` is eighteen-fifty.
 *   - Accounting parentheses mean negative.
 *
 * Returns `null` for anything it cannot read, rather than guessing. Callers
 * validate with Zod and show a field error.
 */
export function parseMoneyToKobo(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = (negative ? trimmed.slice(1, -1) : trimmed).replace(/[^\d.,]/g, '');
  if (cleaned === '') return null;

  const dotIndex = cleaned.lastIndexOf('.');
  const commaIndex = cleaned.lastIndexOf(',');
  const commaGroups = /^\d{1,3}(?:,\d{3})+$/.test(cleaned);

  let integerPart: string;
  let fractionPart: string;

  if (dotIndex !== -1) {
    integerPart = cleaned.slice(0, dotIndex).replace(/,/g, '');
    fractionPart = cleaned.slice(dotIndex + 1).replace(/\D/g, '');
  } else if (commaIndex === -1 || commaGroups) {
    integerPart = cleaned.replace(/,/g, '');
    fractionPart = '';
  } else {
    integerPart = cleaned.slice(0, commaIndex).replace(/,/g, '');
    fractionPart = cleaned.slice(commaIndex + 1).replace(/\D/g, '');
  }

  // Two decimal places is all NGN can express; anything longer is noise, and
  // truncating never invents money the customer did not type.
  const paddedFraction = `${fractionPart}00`.slice(0, 2);
  const magnitude = Number.parseInt(`${integerPart || '0'}${paddedFraction}`, 10);
  if (!Number.isFinite(magnitude)) return null;

  return negative ? -magnitude : magnitude;
}

/**
 * Format a kobo amount as a signed delta, e.g. `+₦1,200.00`. Used where a
 * relative change is the point. Zero renders as an em dash, because
 * "+₦0.00" is noise.
 */
export function formatMoneyDelta(kobo: number): string {
  if (!Number.isFinite(kobo) || kobo === 0) return '—';
  return `${kobo > 0 ? '+' : '−'}${formatMoney(Math.abs(kobo))}`;
}

/**
 * Sum a list of `{ quantity, unitPriceKobo }` pairs. Kept here so no component
 * ever writes a reduce that could produce a float.
 */
export function sumLineTotals(
  lines: ReadonlyArray<{ quantity: number; unitPriceKobo: number }>,
): number {
  let total = 0;
  for (const line of lines) {
    total += Math.round(line.quantity) * Math.round(line.unitPriceKobo);
  }
  return total;
}
